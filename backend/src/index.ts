import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
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

// Serve static frontend files from dist folder
const frontendPath = path.join(__dirname, '../../frontend/dist');
console.log(`Frontend path: ${frontendPath}`);
console.log(`Frontend exists: ${fs.existsSync(frontendPath)}`);

if (fs.existsSync(frontendPath)) {
  // Serve assets folder first (CSS, JS files)
  app.use('/assets', express.static(path.join(frontendPath, 'assets')));
  // Serve other static files
  app.use(express.static(frontendPath));
  console.log(`✅ Serving frontend from: ${frontendPath}`);
}

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, 'deployments.db'));

// Initialize database tables
db.serialize(() => {
  db.run(`
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
});

app.use(cors());
app.use(express.json());

const clients = new Map();

// Helper function to run database queries with promises
function dbGet(sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function dbRun(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

function dbAll(sql: string, params: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const addLog = async (deploymentId: string, message: string, level: 'info' | 'error' | 'warn' | 'success' = 'info') => {
  const row = await dbGet('SELECT logs FROM deployments WHERE id = ?', [deploymentId]);
  const logs = row?.logs ? JSON.parse(row.logs) : [];
  logs.push({ timestamp: new Date().toISOString(), level, message });
  await dbRun('UPDATE deployments SET logs = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(logs),
    new Date().toISOString(),
    deploymentId
  ]);
  const client = clients.get(deploymentId);
  if (client) {
    client.write(`data: ${JSON.stringify({ message, level })}\n\n`);
  }
};

const updateStatus = async (deploymentId: string, status: string, imageTag?: string, url?: string, port?: number, projectType?: string) => {
  await dbRun(
    `UPDATE deployments SET status = ?, updated_at = ?, image_tag = COALESCE(?, image_tag), url = COALESCE(?, url), port = COALESCE(?, port), project_type = COALESCE(?, project_type) WHERE id = ?`,
    [status, new Date().toISOString(), imageTag || null, url || null, port || null, projectType || null, deploymentId]
  );
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
    await updateStatus(id, 'building');
    await addLog(id, '🚀 Starting deployment pipeline...', 'info');
    
    const projectPath = path.join('/tmp', `deploy-${id}`);
    await cloneRepo(gitUrl, projectPath, (msg) => addLog(id, msg, 'info'));
    
    const config = await detectProjectType(projectPath, (msg) => addLog(id, msg, 'info'));
    await updateStatus(id, 'building', undefined, undefined, undefined, config.type);
    await addLog(id, `🎯 Detected: ${config.type.toUpperCase()} on port ${config.port}`, 'success');
    
    let buildContext = projectPath;
    if (fs.existsSync(path.join(projectPath, 'backend'))) {
      buildContext = path.join(projectPath, 'backend');
      await addLog(id, '📁 Using backend folder', 'info');
    }
    
    const dockerfilePath = path.join(buildContext, 'Dockerfile');
    if (!fs.existsSync(dockerfilePath) && config.dockerfile) {
      fs.writeFileSync(dockerfilePath, config.dockerfile);
      await addLog(id, '✅ Created Dockerfile', 'success');
    }
    
    const imageTag = `deploy-${id}:${Date.now()}`;
    await addLog(id, `🔨 Building Docker image: ${imageTag}`, 'info');
    
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
    
    await addLog(id, '✅ Image built', 'success');
    await updateStatus(id, 'deploying');
    await addLog(id, '🐳 Starting container...', 'info');
    
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
    
    await updateStatus(id, 'running', imageTag, url, parseInt(hostPort));
    await addLog(id, `✅ DEPLOYMENT SUCCESSFUL!`, 'success');
    await addLog(id, `🌐 App running at: ${url}`, 'success');
    
    if (fs.existsSync(projectPath)) fs.rmSync(projectPath, { recursive: true, force: true });
  } catch (error: any) {
    await updateStatus(id, 'failed');
    await addLog(id, `❌ Failed: ${error.message}`, 'error');
  }
}

// API Routes
app.post('/api/deployments', async (req, res) => {
  try {
    const { gitUrl, branch = 'main' } = req.body;
    if (!gitUrl) return res.status(400).json({ error: 'gitUrl required' });
    
    const id = uuidv4();
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO deployments (id, status, git_url, branch, created_at, updated_at, logs) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'pending', gitUrl, branch, now, now, JSON.stringify([])]
    );
    
    res.json({ id, status: 'pending', message: 'Deployment started' });
    startDeployment(id, gitUrl);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/deployments', async (req, res) => {
  try {
    const deployments = await dbAll('SELECT * FROM deployments ORDER BY created_at DESC');
    res.json(deployments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

app.get('/api/deployments/:id/logs', async (req, res) => {
  const { id } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  clients.set(id, res);
  
  const row = await dbGet('SELECT logs FROM deployments WHERE id = ?', [id]);
  if (row?.logs) {
    const logs = JSON.parse(row.logs);
    logs.forEach((log: any) => {
      res.write(`data: ${JSON.stringify({ message: log.message, level: log.level })}\n\n`);
    });
  }
  
  req.on('close', () => clients.delete(id));
});

app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

// Catch-all to serve React frontend (must be after API routes)
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
  console.log(`📁 Frontend path: ${frontendPath}`);
});

export default app;