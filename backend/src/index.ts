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

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Initialize SQLite database
const db = new sqlite3.Database(path.join(dataDir, 'deployments.db'));

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS deployments (
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
    logs TEXT
  )`);
});

// Promise wrappers for SQLite
const dbGet = (sql: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql: string, params: any[] = []): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbRun = (sql: string, params: any[] = []): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Serve frontend static files
const frontendPath = path.join(__dirname, '../../frontend/dist');
console.log(`📁 Frontend path: ${frontendPath}`);
console.log(`📁 Frontend exists: ${fs.existsSync(frontendPath)}`);

if (fs.existsSync(frontendPath)) {
  app.use('/assets', express.static(path.join(frontendPath, 'assets')));
  app.use(express.static(frontendPath));
  console.log(`✅ Serving frontend from: ${frontendPath}`);
}

// CORS configuration
app.use(cors({
  origin: ['https://brimble-pipeline.onrender.com', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// SSE clients
const clients = new Map();

// Helper functions
const addLog = async (deploymentId: string, message: string, level: string = 'info') => {
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

const updateStatus = async (deploymentId: string, status: string, imageTag?: string, url?: string) => {
  await dbRun(
    'UPDATE deployments SET status = ?, updated_at = ?, image_tag = ?, url = ? WHERE id = ?',
    [status, new Date().toISOString(), imageTag || null, url || null, deploymentId]
  );
};

// Clone repository
async function cloneRepo(gitUrl: string, targetPath: string, onLog: (msg: string) => void): Promise<void> {
  onLog(`🔗 Cloning repository: ${gitUrl}`);
  const { stdout, stderr } = await execAsync(`git clone --depth 1 ${gitUrl} ${targetPath}`);
  if (stdout) onLog(stdout);
  if (stderr && !stderr.includes('warning')) onLog(stderr);
  onLog('✅ Repository cloned successfully');
}

// Detect project type
async function detectProjectType(projectPath: string, onLog: (msg: string) => void): Promise<any> {
  const files = fs.readdirSync(projectPath);
  
  // Dockerfile
  if (fs.existsSync(path.join(projectPath, 'Dockerfile'))) {
    onLog('🐳 Found existing Dockerfile');
    return { type: 'docker', port: 8080, dockerfile: '', envVars: [] };
  }
  
  // Static site
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
  
  // Fallback
  onLog('❓ Unknown project type, using generic fallback');
  return {
    type: 'unknown',
    port: 3000,
    dockerfile: `FROM node:20-slim\nWORKDIR /app\nCOPY . .\nRUN npm install || true\nEXPOSE 3000\nCMD ["node", "index.js"]`,
    envVars: []
  };
}

// Deployment pipeline
async function startDeployment(id: string, gitUrl: string) {
  try {
    await updateStatus(id, 'building');
    await addLog(id, '🚀 Starting deployment pipeline...', 'info');
    
    const projectPath = path.join('/tmp', `deploy-${id}`);
    await cloneRepo(gitUrl, projectPath, (msg) => addLog(id, msg, 'info'));
    
    const config = await detectProjectType(projectPath, (msg) => addLog(id, msg, 'info'));
    await updateStatus(id, 'building');
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
    
    await updateStatus(id, 'running', imageTag, url);
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

app.get('/api/deployments/:id', async (req, res) => {
  try {
    const deployment = await dbGet('SELECT * FROM deployments WHERE id = ?', [req.params.id]);
    if (!deployment) return res.status(404).json({ error: 'Not found' });
    res.json(deployment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployment' });
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

app.delete('/api/deployments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM deployments WHERE id = ?', [id]);
    res.json({ message: 'Deployment deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete deployment' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const total = await dbGet('SELECT COUNT(*) as count FROM deployments');
    const running = await dbGet('SELECT COUNT(*) as count FROM deployments WHERE status = "running"');
    const failed = await dbGet('SELECT COUNT(*) as count FROM deployments WHERE status = "failed"');
    res.json({ 
      total: total?.count || 0, 
      running: running?.count || 0, 
      failed: failed?.count || 0 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

// Serve React app for all other routes (must be after API routes)
app.get('*', (req, res) => {
  const indexPath = path.join(frontendPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run "npm run build" in frontend folder.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API at /api/deployments`);
  console.log(`🎨 Frontend served at /`);
  console.log(`📁 Frontend path: ${frontendPath}`);
});
