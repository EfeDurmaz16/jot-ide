# Deployment Guide

## Development Setup

### Quick Start

```bash
# 1. Start Redis
redis-server

# 2. Start Worker
cd workers && node worker.js

# 3. Start PHP Development Server
php -S localhost:8000 -t public

# 4. Open browser
open http://localhost:8000
```

## Production Deployment (Bare Metal)

### Prerequisites

- Ubuntu 22.04+ or Debian 12+
- 4+ CPU cores recommended
- 8GB+ RAM recommended
- SSD storage

### Step 1: System Setup

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install dependencies
sudo apt-get install -y \
    nginx \
    redis-server \
    php8.1-fpm \
    php8.1-redis \
    nodejs \
    npm \
    nsjail \
    gcc \
    g++ \
    openjdk-17-jdk \
    golang-go \
    rustc \
    python3

# Verify nsjail installation
nsjail --version
```

### Step 2: Application Setup

```bash
# Create application directory
sudo mkdir -p /var/www/code-executor
sudo chown $USER:$USER /var/www/code-executor

# Copy application files
cp -r . /var/www/code-executor/

# Install dependencies
cd /var/www/code-executor
composer install --no-dev
cd workers && npm install --production

# Create sandbox directories
sudo mkdir -p /var/www/code-executor/sandbox/{jobs,root}
sudo chown -R www-data:www-data /var/www/code-executor/sandbox
sudo chmod 755 /var/www/code-executor/sandbox/jobs
```

### Step 3: Nginx Configuration

Create `/etc/nginx/sites-available/code-executor`:

```nginx
server {
    listen 80;
    server_name code.example.com;
    root /var/www/code-executor/public;
    index index.html;

    # Static files
    location / {
        try_files $uri $uri/ =404;
    }

    # PHP API
    location /api/ {
        try_files $uri /api/$uri.php$is_args$args;
    }

    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_intercept_errors on;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/code-executor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 4: Systemd Service for Worker

Create `/etc/systemd/system/code-executor-worker.service`:

```ini
[Unit]
Description=Jotform Code Executor Worker
After=network.target redis-server.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/code-executor/workers
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Environment
Environment=NODE_ENV=production
Environment=REDIS_HOST=127.0.0.1
Environment=REDIS_PORT=6379
Environment=WORKER_CONCURRENCY=4

# Security
NoNewPrivileges=false
CapabilityBoundingSet=CAP_SYS_ADMIN CAP_NET_ADMIN CAP_SETUID CAP_SETGID
AmbientCapabilities=CAP_SYS_ADMIN CAP_NET_ADMIN CAP_SETUID CAP_SETGID

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable code-executor-worker
sudo systemctl start code-executor-worker
sudo systemctl status code-executor-worker
```

### Step 5: Redis Configuration

Edit `/etc/redis/redis.conf`:

```conf
# Memory limit
maxmemory 1gb
maxmemory-policy allkeys-lru

# Persistence (optional, for caching)
save ""
appendonly no

# Security
bind 127.0.0.1
```

Restart Redis:

```bash
sudo systemctl restart redis-server
```

### Step 6: PHP-FPM Configuration

Edit `/etc/php/8.1/fpm/pool.d/www.conf`:

```ini
pm = dynamic
pm.max_children = 50
pm.start_servers = 5
pm.min_spare_servers = 5
pm.max_spare_servers = 35
pm.max_requests = 500
```

Restart PHP-FPM:

```bash
sudo systemctl restart php8.1-fpm
```

### Step 7: SSL/TLS (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d code.example.com
```

## Cloud Deployment

### AWS (EC2 + ElastiCache)

1. **EC2 Instance**: t3.medium or larger
2. **ElastiCache**: Redis cluster for high availability
3. **Load Balancer**: ALB with SSL termination
4. **Security Groups**:
   - Allow 80/443 from anywhere
   - Allow 6379 only from EC2 security group

### DigitalOcean (Droplet + Managed Redis)

1. **Droplet**: 4GB RAM minimum
2. **Managed Redis**: For production reliability
3. **Firewall**: Enable DO Cloud Firewall

## Scaling

### Horizontal Scaling (Workers)

```bash
# Run multiple workers on same machine
WORKER_ID=1 node worker.js &
WORKER_ID=2 node worker.js &
WORKER_ID=3 node worker.js &
```

Or use PM2:

```bash
npm install -g pm2
pm2 start worker.js -i 4 --name "code-worker"
pm2 save
pm2 startup
```

### Vertical Scaling

- Increase worker concurrency: `WORKER_CONCURRENCY=8`
- Add more RAM for Redis cache
- Use faster CPUs for compilation

## Monitoring

### Prometheus Metrics (Optional)

Add to worker.js:

```javascript
const client = require('prom-client');
const jobsProcessed = new client.Counter({
    name: 'code_executor_jobs_total',
    help: 'Total jobs processed',
    labelNames: ['language', 'status']
});
```

### Health Check Endpoint

Create `/var/www/code-executor/public/health.php`:

```php
<?php
header('Content-Type: application/json');

$redis = new Redis();
$redisOk = $redis->connect('127.0.0.1', 6379);

echo json_encode([
    'status' => $redisOk ? 'healthy' : 'unhealthy',
    'redis' => $redisOk,
    'timestamp' => time()
]);
```

### Log Aggregation

Configure journald forwarding to centralized logging:

```bash
# View worker logs
journalctl -u code-executor-worker -f

# Export to file
journalctl -u code-executor-worker --since today > /var/log/worker.log
```

## Backup & Recovery

### What to Backup

1. **Application code**: Git repository
2. **nsjail configs**: `/var/www/code-executor/config/nsjail/`
3. **Environment config**: `.env` file (if used)

### What NOT to Backup

1. **Sandbox jobs**: Temporary, deleted after execution
2. **Redis data**: Cache, not persistent storage

## Troubleshooting

### Worker Not Processing Jobs

```bash
# Check worker status
sudo systemctl status code-executor-worker

# Check Redis connection
redis-cli ping

# Check queue
redis-cli llen bull:code-execution:waiting
```

### nsjail Permission Errors

```bash
# Ensure capabilities
sudo setcap cap_sys_admin,cap_net_admin,cap_setuid,cap_setgid+ep /usr/bin/nsjail

# Or run worker as root (not recommended)
```

### High Memory Usage

```bash
# Reduce worker concurrency
Environment=WORKER_CONCURRENCY=2

# Reduce Redis memory
maxmemory 512mb
```
