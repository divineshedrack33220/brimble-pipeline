import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
const Database = sqlite3.Database;
import { exec } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;
const docker = new Docker();

// Serve static frontend files
const frontendPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log(`Serving frontend from: ${frontendPath}`);
}

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'deployments.db'));

// Database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    git_url TEXT NOT NULL,
    branch TEXT DEFAULT 'main',
    project_type TEXT,
    image_tag TEXT,
    url TEXT,
    port INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    logs TEXT,
    metadata TEXT,
    env_vars TEXT,
    domain TEXT
  )
`);

app.use(cors());
app.use(express.json());

const clients = new Map();

const addLog = (deploymentId: string, message: string, level: 'info' | 'error' | 'warn' | 'success' = 'info') => {
  const row = db.prepare('SELECT logs FROM deployments WHERE id = ?').get(deploymentId) as any;
  const logs = row?.logs ? JSON.parse(row.logs) : [];
  logs.push({ timestamp: new Date().toISOString(), level, message });
  db.prepare('UPDATE deployments SET logs = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(logs),
    new Date().toISOString(),
    deploymentId
  );
  const client = clients.get(deploymentId);
  if (client) client.write(`data: ${JSON.stringify({ message, level })}\n\n`);
};

const updateStatus = (deploymentId: string, status: string, imageTag?: string, url?: string, port?: number, projectType?: string) => {
  db.prepare(`UPDATE deployments SET status = ?, updated_at = ?, image_tag = COALESCE(?, image_tag), url = COALESCE(?, url), port = COALESCE(?, port), project_type = COALESCE(?, project_type) WHERE id = ?`)
    .run(status, new Date().toISOString(), imageTag || null, url || null, port || null, projectType || null, deploymentId);
};

async function cloneRepo(gitUrl: string, targetPath: string, onLog: (msg: string) => void): Promise<void> {
  onLog(`🔗 Cloning repository: ${gitUrl}`);
  const { stdout, stderr } = await execAsync(`git clone --depth 1 ${gitUrl} ${targetPath}`);
  if (stdout) onLog(stdout);
  if (stderr && !stderr.includes('warning')) onLog(stderr);
  onLog('✅ Repository cloned successfully');
}

async function detectProjectType(projectPath: string, onLog: (msg: string) => void): Promise<any> {
  const files = fs.readdirSync(projectPath);
  
  if (fs.existsSync(path.join(projectPath, 'Dockerfile'))) {
    onLog('🐳 Found existing Dockerfile');
    return { type: 'docker', port: 8080, dockerfile: '', envVars: [] };
  }
  
  // Check for static site
  const hasHtml = files.some(f => f.endsWith('.html'));
  if (hasHtml && !fs.existsSync(path.join(projectPath, 'package.json'))) {
    onLog('🌐 Detected static website');
    return {
      type: 'static',
      port: 80,
      dockerfile: `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]`,
      envVars: []
    };
  }
  
  // Node.js
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    onLog('📦 Detected Node.js project');
    return {
      type: 'node',
      port: 3000,
      dockerfile: `FROM node:20-bookworm-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --legacy-peer-deps --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]`,
      envVars: ['NODE_ENV=production']
    };
  }
  
  // Python
  if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    onLog('🐍 Detected Python project');
    return {
      type: 'python',
      port: 5000,
      dockerfile: `FROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nEXPOSE 5000\nCMD ["python", "app.py"]`,
      envVars: ['PYTHONUNBUFFERED=1']
    };
  }
  
  // Go
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    onLog('🔷 Detected Go project');
    return {
      type: 'go',
      port: 8080,
      dockerfile: `FROM golang:1.21-alpine AS builder\nWORKDIR /app\nCOPY go.mod ./\nRUN go mod download\nCOPY . .\nRUN go build -o app\nFROM alpine:latest\nCOPY --from=builder /app/app .\nEXPOSE 8080\nCMD ["./app"]`,
      envVars: []
    };
  }
  
  // Default fallback
  onLog('❓ Unknown project type');
  return {
    type: 'unknown',
    port: 3000,
    dockerfile: `FROM node:20-slim\nWORKDIR /app\nCOPY . .\nRUN npm install || true\nEXPOSE 3000\nCMD ["node", "index.js"]`,
    envVars: []
  };
}

async function startDeployment(id: string, gitUrl: string) {
  try {
    updateStatus(id, 'building');
    addLog(id, '🚀 Starting deployment pipeline...', 'info');
    
    const projectPath = path.join('/tmp', `deploy-${id}`);
    await cloneRepo(gitUrl, projectPath, (msg) => addLog(id, msg, 'info'));
    
    const config = await detectProjectType(projectPath, (msg) => addLog(id, msg, 'info'));
    updateStatus(id, 'building', undefined, undefined, undefined, config.type);
    addLog(id, `🎯 Detected: ${config.type.toUpperCase()} on port ${config.port}`, 'success');
    
    let buildContext = projectPath;
    if (fs.existsSync(path.join(projectPath, 'backend'))) {
      buildContext = path.join(projectPath, 'backend');
      addLog(id, '📁 Using backend folder', 'info');
    }
    
    const dockerfilePath = path.join(buildContext, 'Dockerfile');
    if (!fs.existsSync(dockerfilePath) && config.dockerfile) {
      fs.writeFileSync(dockerfilePath, config.dockerfile);
      addLog(id, '✅ Created Dockerfile', 'success');
    }
    
    const imageTag = `deploy-${id}:${Date.now()}`;
    addLog(id, `🔨 Building Docker image: ${imageTag}`, 'info');
    
    const buildStream = await docker.buildImage(
      { context: buildContext, src: ['.'] },
      { t: imageTag }
    );
    
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(buildStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }, (event) => {
        if (event.stream) addLog(id, event.stream.trim(), 'info');
        if (event.error) addLog(id, event.error, 'error');
      });
    });
    
    addLog(id, '✅ Image built', 'success');
    updateStatus(id, 'deploying');
    addLog(id, '🐳 Starting container...', 'info');
    
    const containerName = `deploy-${id}`;
    try { await docker.getContainer(containerName).remove({ force: true }); } catch(e) {}
    
    const container = await docker.createContainer({
      Image: imageTag,
      name: containerName,
      ExposedPorts: { [`${config.port}/tcp`]: {} },
      HostConfig: {
        PortBindings: { [`${config.port}/tcp`]: [{ HostPort: '0' }] },
        RestartPolicy: { Name: 'unless-stopped' }
      },
      Env: [...config.envVars, `PORT=${config.port}`]
    });
    
    await container.start();
    const inspect = await container.inspect();
    const hostPort = inspect.NetworkSettings.Ports[`${config.port}/tcp`]?.[0]?.HostPort;
    const url = `http://localhost:${hostPort}`;
    
    updateStatus(id, 'running', imageTag, url, parseInt(hostPort));
    addLog(id, `✅ DEPLOYMENT SUCCESSFUL!`, 'success');
    addLog(id, `🌐 App running at: ${url}`, 'success');
    
    if (fs.existsSync(projectPath)) fs.rmSync(projectPath, { recursive: true, force: true });
  } catch (error: any) {
    updateStatus(id, 'failed');
    addLog(id, `❌ Failed: ${error.message}`, 'error');
  }
}

// API Routes
app.post('/api/deployments', async (req, res) => {
  try {
    const { gitUrl, branch = 'main' } = req.body;
    if (!gitUrl) return res.status(400).json({ error: 'gitUrl required' });
    
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO deployments (id, status, git_url, branch, created_at, updated_at, logs) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, 'pending', gitUrl, branch, now, now, JSON.stringify([]));
    
    res.json({ id, status: 'pending', message: 'Deployment started' });
    startDeployment(id, gitUrl);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/deployments', (req, res) => {
  try {
    const deployments = db.prepare('SELECT * FROM deployments ORDER BY created_at DESC').all();
    res.json(deployments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

app.get('/api/deployments/:id/logs', (req, res) => {
  const { id } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  clients.set(id, res);
  
  const row = db.prepare('SELECT logs FROM deployments WHERE id = ?').get(id) as any;
  if (row?.logs) {
    const logs = JSON.parse(row.logs);
    logs.forEach((log: any) => {
      res.write(`data: ${JSON.stringify({ message: log.message, level: log.level })}\n\n`);
    });
  }
  
  req.on('close', () => clients.delete(id));
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// Catch-all to serve React frontend
app.get('*', (req, res) => {
  const indexPath = path.join(frontendPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run npm run build in frontend folder first.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API at /api/deployments`);
  console.log(`🎨 Frontend served at /`);
});