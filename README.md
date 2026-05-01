# 🚀 Brimble Deployment Pipeline

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-20.10-blue.svg)](https://www.docker.com/)
[![React](https://img.shields.io/badge/React-18.2-61dafb.svg)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express-4.18-green.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Render](https://img.shields.io/badge/Render-Deployed-purple.svg)](https://brimble-pipeline.onrender.com)

A **production-ready deployment platform** that automatically detects, builds, and deploys applications from GitHub repositories. Supports 10+ programming languages and frameworks with zero configuration.

## 🌟 Live Demo

**Frontend UI:** [https://brimble-pipeline.onrender.com](https://brimble-pipeline.onrender.com)

**API Health Check:** [https://brimble-pipeline.onrender.com/health](https://brimble-pipeline.onrender.com/health)

**Deployments API:** [https://brimble-pipeline.onrender.com/api/deployments](https://brimble-pipeline.onrender.com/api/deployments)

> ⚠️ **Note:** The deployment feature requires Docker socket access. On Render, only the UI and API are functional. For full deployment capabilities, run locally or deploy to Railway/Fly.io.

## ✨ Features

- 🎯 **Auto-Detection** - Automatically detects project type (Node.js, Python, Go, Rust, Java, PHP, Ruby, .NET, Static sites)
- 🐳 **Docker Native** - Creates optimized Dockerfiles for each project type
- 📡 **Live Log Streaming** - Real-time build and deployment logs via SSE
- 🔄 **Git Integration** - Deploy any public GitHub repository
- 📊 **Deployment Dashboard** - Modern UI with deployment history and stats
- 🗑️ **One-Click Delete** - Remove deployments with container cleanup
- 🎨 **Modern UI** - Built with React, Tailwind CSS, and Lucide icons
- 🚀 **Zero Config** - Works with most repositories out of the box
- 💾 **SQLite Database** - Lightweight, file-based storage

## 🛠️ Supported Technologies

| Language/Framework | Detection | Docker Image | Default Port |
|-------------------|-----------|--------------|--------------|
| **Node.js** | `package.json` | Node 20-bookworm | 3000 |
| **Static Sites** | `*.html` | Nginx Alpine | 80 |
| **Python** | `requirements.txt` | Python 3.11-slim | 5000 |
| **Go** | `go.mod` | Golang 1.21-alpine | 8080 |
| **Rust** | `Cargo.toml` | Rust 1.75 | 8080 |
| **Java/Spring** | `pom.xml` | OpenJDK 17 | 8080 |
| **PHP** | `composer.json` | PHP 8.2-apache | 80 |
| **Ruby/Rails** | `Gemfile` | Ruby 3.2-slim | 3000 |
| **.NET Core** | `*.csproj` | .NET 8.0 | 5000 |
| **Docker** | `Dockerfile` | User-defined | Configurable |

## 📋 Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local development and deployment)
- [Node.js](https://nodejs.org/) 20+
- [Git](https://git-scm.com/)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/divineshedrack33220/brimble-pipeline.git
cd brimble-pipeline
2. Start the platform with Docker Compose
bash
docker compose up --build
3. Access the dashboard
Open your browser to: http://localhost:5173

4. Deploy your first app
Enter a Git URL and click "Deploy":

text
https://github.com/heroku/node-js-getting-started.git
Watch the live logs and access your deployed app at the provided URL!

🏗️ Architecture
text
┌─────────────────────────────────────────────────────────────┐
│                         User Browser                        │
│                    http://localhost:5173                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Caddy Proxy                         │
│                    Routes /api → Backend                    │
│                     Routes /* → Frontend                    │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────┐
│     Frontend (React)    │    │      Backend (Express)      │
│   - Vite Build Tool     │    │     - TypeScript            │
│   - TanStack Query      │◄───│     - SQLite Database       │
│   - Tailwind CSS        │    │     - Docker API Client     │
│   - Lucide Icons        │    │     - SSE Log Streaming     │
└─────────────────────────┘    └─────────────────────────────┘
                                              │
                                              ▼
                              ┌─────────────────────────────┐
                              │      Docker Engine          │
                              │   - Build Images            │
                              │   - Run Containers          │
                              │   - Port Management         │
                              └─────────────────────────────┘
                                              │
                                              ▼
                              ┌─────────────────────────────┐
                              │     Deployed Containers     │
                              │   - Node.js Apps            │
                              │   - Static Sites            │
                              │   - Python/Go/Rust/etc.     │
                              └─────────────────────────────┘

📁 Project Structure
text
brimble-pipeline/
├── backend/
│   ├── src/
│   │   └── index.ts          # Main API server
│   ├── Dockerfile             # Backend container
│   ├── package.json           # Dependencies
│   └── tsconfig.json          # TypeScript config
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main React component
│   │   ├── main.tsx           # Entry point
│   │   └── index.css          # Tailwind styles
│   ├── Dockerfile             # Frontend container
│   └── package.json           # Dependencies
├── docker-compose.yml         # Orchestration
├── Caddyfile                  # Reverse proxy config
├── render.yaml                # Render deployment config
└── README.md                  # This file
🔧 API Endpoints
Method	Endpoint	Description
POST	/api/deployments	Create new deployment
GET	/api/deployments	List all deployments
GET	/api/deployments/:id	Get deployment details
GET	/api/deployments/:id/logs	Stream live logs (SSE)
DELETE	/api/deployments/:id	Delete deployment
GET	/api/stats	Deployment statistics
GET	/health	Health check
📊 Deployment Flow
```
1. Submit Git URL
   │
   ▼
2. Clone Repository
   │
   ▼
3. Detect Project Type
   │
   ▼
4. Create Optimized Dockerfile
   │
   ▼
5. Build Docker Image
   │
   ▼
6. Start Container on Available Port
   │
   ▼
7. Configure Reverse Proxy
   │
   ▼
8. Stream Live Logs to UI
   │
   ▼
9. Deployment Complete ✓
🎯 Example Deployments
Deploy a Node.js App

https://github.com/heroku/node-js-getting-started.git
Deploy a Static Website

https://github.com/divineshedrack33220/vault.git
Deploy a Python App

https://github.com/python-poetry/poetry.git
Deploy with Custom Dockerfile

https://github.com/yourusername/your-repo.git (with Dockerfile)
🚢 Deployment Options
Local Development (Docker Compose)
bash
docker compose up --build
Render (Limited - No Docker Socket)

yaml
# render.yaml
services:
  - type: web
    name: brimble-pipeline
    runtime: node
    buildCommand: |
      cd frontend && npm install && npm run build
      cd ../backend && npm install && npm run build
    startCommand: cd backend && node dist/index.js
⚠️ Note: Render does not expose the Docker socket. For full deployment capabilities, use Railway or Fly.io.

Railway (Recommended for Production)
bash
npm install -g @railway/cli
railway login
railway init
railway up
Fly.io
bash
flyctl auth login
flyctl launch
🐛 Troubleshooting
Docker not running
bash
# Start Docker Desktop
systemctl start docker  # Linux
# Or launch Docker Desktop app on Windows/Mac
Port conflicts
bash
# Check if ports are in use
netstat -an | grep 3000
netstat -an | grep 5173
Build fails
bash
# Rebuild without cache
docker compose build --no-cache
docker compose up
View logs
bash
# Backend logs
docker logs brimble-pipeline-backend-1

# Frontend logs
docker logs brimble-pipeline-frontend-1
CORS errors
Make sure your frontend uses relative paths:

typescript
const API = axios.create({ baseURL: '/api' })
🛡️ Security Considerations
⚠️ For production use, consider:

Add authentication and API keys

Implement rate limiting

Use isolated build runners (Firecracker/gVisor)

Add image vulnerability scanning (Trivy)

Implement resource limits and quotas

Add audit logging

Use secrets management (Vault)

Regular security updates

🤝 Contributing
Fork the repository

Create your feature branch (git checkout -b feature/amazing)

Commit your changes (git commit -m 'Add amazing feature')

Push to the branch (git push origin feature/amazing)

Open a Pull Request

📝 License
MIT License - see LICENSE file for details

🙏 Acknowledgments
Brimble - For the inspiring take-home task

Docker - Containerization platform

React - UI Framework

Tailwind CSS - Styling

Express - Backend framework

SQLite - Database

📧 Contact
GitHub: @divineshedrack33220

Email: divineshedrack33220@gmail.com

Live Demo: https://brimble-pipeline.onrender.com

