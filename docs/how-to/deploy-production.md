<!-- SCOPE: How-to guide — Production deployment steps -->
<!-- TYPE: How-to -->

# Deploy to Production

Deploy the Extension Security Analyzer to a production environment.

## Goal

Deploy the analyzer with proper security, monitoring, and reliability for production use.

## Prerequisites

Before deploying:
- Node.js 18+ installed on target server
- Reverse proxy (nginx, Apache, or cloud load balancer)
- SSL certificate (Let's Encrypt recommended)
- Process manager (PM2, systemd, or Docker)

## Deployment Options

| Method | Complexity | Best For |
|--------|------------|----------|
| **Docker** | Low | Containerized environments |
| **PM2** | Medium | Traditional VPS/cloud servers |
| **systemd** | Medium | Linux servers with systemd |
| **Cloud** | Variable | AWS, Azure, GCP, etc. |

## Option 1: Docker Deployment (Recommended)

### Step 1: Create Dockerfile

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .
RUN npm run build

# Create reports directory
RUN mkdir -p /app/reports

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:8001/api/health || exit 1

# Run server
CMD ["node", "dist/index.js"]
```

### Step 2: Build and Run

```bash
# Build image
docker build -t extension-security-analyzer .

# Run container
docker run -d \
  --name esa \
  -p 8001:8001 \
  -v $(pwd)/reports:/app/reports \
  -e NODE_ENV=production \
  -e LLM_URL=http://host.docker.internal:11434 \
  extension-security-analyzer
```

### Step 3: Docker Compose (Optional)

```yaml
# docker-compose.yml
version: '3.8'

services:
  esa:
    build: .
    ports:
      - "8001:8001"
    environment:
      - NODE_ENV=production
      - PORT=8001
      - LLM_URL=http://ollama:11434
    volumes:
      - ./reports:/app/reports
    depends_on:
      - ollama
    restart: unless-stopped
    
  ollama:
    image: ollama/ollama
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama-data:
```

Run:
```bash
docker-compose up -d
```

## Option 2: PM2 Deployment

### Step 1: Install PM2

```bash
npm install -g pm2
```

### Step 2: Create Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'extension-security-analyzer',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 8001
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '10s',
    watch: false,
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
```

### Step 3: Deploy

```bash
# Build
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Setup startup script
pm2 startup
```

### Step 4: Monitor

```bash
# View logs
pm2 logs extension-security-analyzer

# Monitor resources
pm2 monit

# Restart
pm2 restart extension-security-analyzer
```

## Option 3: systemd Deployment

### Step 1: Create Service File

```ini
# /etc/systemd/system/extension-security-analyzer.service
[Unit]
Description=Extension Security Analyzer
After=network.target

[Service]
Type=simple
User=esa
WorkingDirectory=/opt/extension-security-analyzer
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=8001
Environment=HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
```

### Step 2: Setup and Start

```bash
# Create user
sudo useradd -r -s /bin/false esa

# Set permissions
sudo chown -R esa:esa /opt/extension-security-analyzer

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable extension-security-analyzer
sudo systemctl start extension-security-analyzer

# Check status
sudo systemctl status extension-security-analyzer
```

## Reverse Proxy Configuration

### nginx

```nginx
# /etc/nginx/sites-available/extension-security-analyzer
server {
    listen 80;
    server_name analyzer.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name analyzer.example.com;

    ssl_certificate /etc/letsencrypt/live/analyzer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analyzer.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/extension-security-analyzer \
  /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Security Hardening

### Environment Variables

Create `.env` file with production values:

```bash
# .env
NODE_ENV=production
PORT=8001
HOST=127.0.0.1
ALLOWED_ORIGINS=https://analyzer.example.com

# LLM (use cloud API or internal network)
LLM_URL=http://internal-llm-server:11434
LLM_CONCURRENCY=20

# Security
MAX_EXTENSIONS_BATCH=50
SCAN_TIMEOUT=600000
MAX_FILE_SIZE=20971520

# Reports
REPORTS_DIR=/var/reports
KEEP_REPORTS=90
```

### File Permissions

```bash
# Set restrictive permissions
chmod 600 .env
chmod 755 reports/
chown -R esa:esa /opt/extension-security-analyzer
```

### Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Monitoring

### Health Checks

The server provides a health endpoint:

```bash
curl https://analyzer.example.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-29T10:30:00Z"
}
```

### Log Monitoring

```bash
# View logs
pm2 logs

# Or with systemd
sudo journalctl -u extension-security-analyzer -f
```

### Metrics (Optional)

Add Prometheus metrics endpoint:

```bash
npm install prom-client
```

Then expose metrics at `/metrics` for scraping.

## Backup

### Reports Backup

```bash
# Daily backup cron job
0 2 * * * tar -czf /backups/reports-$(date +\%Y\%m\%d).tar.gz /var/reports/
```

### Configuration Backup

```bash
# Backup important files
cp .env /backups/env.backup
cp docs/patterns.yaml /backups/patterns-$(date +%Y%m%d).yaml
```

## Troubleshooting

### Server won't start

Check logs:
```bash
pm2 logs
# or
sudo journalctl -u extension-security-analyzer
```

Common issues:
- Port already in use
- Missing environment variables
- Permission denied on reports directory

### High memory usage

1. Reduce `LLM_CONCURRENCY`
2. Enable PM2 memory restart: `max_memory_restart: '1G'`
3. Monitor with `pm2 monit`

### SSL certificate errors

Ensure certificates are valid and nginx config is correct:
```bash
sudo nginx -t
sudo certbot renew --dry-run
```

## Maintenance

| Trigger | Action |
|---------|--------|
| New version released | Update and restart |
| Security advisory | Update dependencies |
| Certificate expiry | Renew with certbot |
| Disk space low | Clean old reports |

Last Updated: 2026-03-29
