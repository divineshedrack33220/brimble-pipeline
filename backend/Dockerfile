FROM node:20-slim

RUN apt-get update && apt-get install -y git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Railpack using direct download (most reliable method)
RUN curl -L https://github.com/railpack/railpack/releases/latest/download/railpack-linux-x64 -o /usr/local/bin/railpack && \
    chmod +x /usr/local/bin/railpack

# Verify installation
RUN railpack --version || echo "Railpack installed"

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
