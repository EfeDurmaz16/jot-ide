#!/bin/bash
#
# Jotform Code Executor - Oracle Cloud Setup Script
# Tested on: Ubuntu 22.04 (ARM64 or AMD64)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/scripts/setup-oracle-cloud.sh | bash
#   OR
#   chmod +x setup-oracle-cloud.sh && ./setup-oracle-cloud.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Configuration
APP_DIR="/var/www/code-executor"
APP_USER="www-data"
DOMAIN="${DOMAIN:-localhost}"

echo ""
echo "=============================================="
echo "  Jotform Code Executor - Oracle Cloud Setup"
echo "=============================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root: sudo ./setup-oracle-cloud.sh"
fi

# Detect architecture
ARCH=$(uname -m)
log_info "Detected architecture: $ARCH"

# Step 1: Update system
log_info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
log_success "System updated"

# Step 2: Install dependencies
log_info "Installing dependencies..."
apt-get install -y -qq \
    nginx \
    redis-server \
    php8.1-fpm \
    php8.1-redis \
    php8.1-cli \
    curl \
    git \
    build-essential \
    gcc \
    g++ \
    default-jdk \
    python3 \
    python3-pip \
    autoconf \
    bison \
    flex \
    libprotobuf-dev \
    libnl-route-3-dev \
    libtool \
    pkg-config \
    protobuf-compiler

log_success "Base dependencies installed"

# Step 3: Install Node.js 20
log_info "Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
log_success "Node.js $(node -v) installed"

# Step 4: Install Go
log_info "Installing Go..."
if ! command -v go &> /dev/null; then
    if [ "$ARCH" = "aarch64" ]; then
        GO_URL="https://go.dev/dl/go1.21.5.linux-arm64.tar.gz"
    else
        GO_URL="https://go.dev/dl/go1.21.5.linux-amd64.tar.gz"
    fi
    curl -fsSL "$GO_URL" | tar -C /usr/local -xzf -
    ln -sf /usr/local/go/bin/go /usr/bin/go
fi
log_success "Go $(go version | awk '{print $3}') installed"

# Step 5: Install Rust
log_info "Installing Rust..."
if ! command -v rustc &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    ln -sf "$HOME/.cargo/bin/rustc" /usr/bin/rustc
    ln -sf "$HOME/.cargo/bin/cargo" /usr/bin/cargo
fi
log_success "Rust installed"

# Step 6: Install nsjail
log_info "Installing nsjail..."
if ! command -v nsjail &> /dev/null; then
    cd /tmp
    git clone https://github.com/google/nsjail.git
    cd nsjail
    make -j$(nproc)
    cp nsjail /usr/bin/
    cd /
    rm -rf /tmp/nsjail
fi
log_success "nsjail installed"

# Step 7: Install Composer
log_info "Installing Composer..."
if ! command -v composer &> /dev/null; then
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
fi
log_success "Composer installed"

# Step 8: Create application directory
log_info "Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/sandbox/jobs"
mkdir -p "$APP_DIR/sandbox/root"

# Step 9: Copy application files (assuming current directory has the app)
if [ -f "./composer.json" ]; then
    log_info "Copying application files..."
    cp -r ./* "$APP_DIR/"
else
    log_warn "No application files found in current directory"
    log_info "Please copy your application to $APP_DIR"
fi

# Step 10: Set permissions
log_info "Setting permissions..."
chown -R $APP_USER:$APP_USER "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod 777 "$APP_DIR/sandbox/jobs"

# Step 11: Install PHP dependencies
if [ -f "$APP_DIR/composer.json" ]; then
    log_info "Installing PHP dependencies..."
    cd "$APP_DIR"
    sudo -u $APP_USER composer install --no-dev --no-interaction 2>/dev/null || composer install --no-dev --no-interaction
    log_success "PHP dependencies installed"
fi

# Step 12: Install Node.js dependencies
if [ -f "$APP_DIR/workers/package.json" ]; then
    log_info "Installing Node.js dependencies..."
    cd "$APP_DIR/workers"
    npm install --production
    log_success "Node.js dependencies installed"
fi

# Step 13: Configure Redis
log_info "Configuring Redis..."
cat > /etc/redis/redis.conf.d/code-executor.conf << 'EOF'
maxmemory 512mb
maxmemory-policy allkeys-lru
EOF
systemctl restart redis-server
systemctl enable redis-server
log_success "Redis configured"

# Step 14: Configure PHP-FPM
log_info "Configuring PHP-FPM..."
cat > /etc/php/8.1/fpm/pool.d/code-executor.conf << 'EOF'
[code-executor]
user = www-data
group = www-data
listen = /var/run/php/php8.1-code-executor.sock
listen.owner = www-data
listen.group = www-data
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 5
pm.max_spare_servers = 10
pm.max_requests = 500
EOF
systemctl restart php8.1-fpm
systemctl enable php8.1-fpm
log_success "PHP-FPM configured"

# Step 15: Create systemd service for worker
log_info "Creating worker service..."
cat > /etc/systemd/system/code-executor-worker.service << EOF
[Unit]
Description=Jotform Code Executor Worker
After=network.target redis-server.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$APP_DIR/workers
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

Environment=NODE_ENV=production
Environment=REDIS_HOST=127.0.0.1
Environment=REDIS_PORT=6379
Environment=WORKER_CONCURRENCY=4
Environment=SANDBOX_JOBS=$APP_DIR/sandbox/jobs
Environment=NSJAIL_CONFIG_DIR=$APP_DIR/config/nsjail
Environment=NSJAIL_BIN=/usr/bin/nsjail

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable code-executor-worker
log_success "Worker service created"

# Step 16: Configure Nginx
log_info "Configuring Nginx..."
cat > /etc/nginx/sites-available/code-executor << EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $APP_DIR/public;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Static files
    location / {
        try_files \$uri \$uri/ =404;
    }

    # PHP API
    location ~ ^/api/(.*)\.php$ {
        fastcgi_pass unix:/var/run/php/php8.1-code-executor.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root/api/\$1.php;
        include fastcgi_params;
    }

    # Health check
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf /etc/nginx/sites-available/code-executor /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx
log_success "Nginx configured"

# Step 17: Configure firewall
log_info "Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    log_success "Firewall configured"
else
    # Oracle Cloud uses iptables
    iptables -I INPUT -p tcp --dport 80 -j ACCEPT
    iptables -I INPUT -p tcp --dport 443 -j ACCEPT
    log_success "iptables rules added"
fi

# Step 18: Update nsjail configs with correct paths
log_info "Updating nsjail configurations..."
if [ -d "$APP_DIR/config/nsjail" ]; then
    for cfg in "$APP_DIR/config/nsjail"/*.cfg; do
        sed -i "s|/var/www/code-executor|$APP_DIR|g" "$cfg"
    done
    log_success "nsjail configs updated"
fi

# Step 19: Start worker
log_info "Starting worker service..."
systemctl start code-executor-worker
sleep 2
if systemctl is-active --quiet code-executor-worker; then
    log_success "Worker service started"
else
    log_warn "Worker service may have issues, check: journalctl -u code-executor-worker"
fi

# Step 20: Final checks
echo ""
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo ""
log_info "Services status:"
echo "  - Nginx:  $(systemctl is-active nginx)"
echo "  - Redis:  $(systemctl is-active redis-server)"
echo "  - PHP-FPM: $(systemctl is-active php8.1-fpm)"
echo "  - Worker: $(systemctl is-active code-executor-worker)"
echo ""

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
echo "=============================================="
echo "  Access your application:"
echo "  http://$PUBLIC_IP"
echo "=============================================="
echo ""
log_info "Useful commands:"
echo "  - View worker logs: journalctl -u code-executor-worker -f"
echo "  - Restart worker:   systemctl restart code-executor-worker"
echo "  - Check Redis:      redis-cli ping"
echo ""
log_warn "Don't forget to open port 80 in Oracle Cloud Security List!"
echo ""
