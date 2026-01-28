# Oracle Cloud Free Tier Setup Guide

## Step 1: Create Oracle Cloud Account

1. Go to [cloud.oracle.com](https://cloud.oracle.com)
2. Click **Start for free**
3. Complete registration (credit card required but won't be charged)
4. Wait for account activation (~5 minutes)

## Step 2: Create a Free VM

1. Go to **Compute** → **Instances** → **Create Instance**

2. Configure:
   | Setting | Value |
   |---------|-------|
   | Name | `code-executor` |
   | Image | Ubuntu 22.04 |
   | Shape | VM.Standard.A1.Flex (ARM) |
   | OCPUs | 2 |
   | RAM | 12 GB |
   | Boot Volume | 50 GB |

3. **Networking**: Create new VCN or use existing

4. **SSH Keys**:
   - Generate new key pair, OR
   - Upload your public key (`~/.ssh/id_rsa.pub`)

5. Click **Create**

## Step 3: Open Firewall Ports

### In Oracle Cloud Console:

1. Go to **Networking** → **Virtual Cloud Networks**
2. Click your VCN → **Security Lists** → **Default Security List**
3. **Add Ingress Rules**:

   | Source CIDR | Protocol | Dest Port | Description |
   |-------------|----------|-----------|-------------|
   | 0.0.0.0/0 | TCP | 80 | HTTP |
   | 0.0.0.0/0 | TCP | 443 | HTTPS |

## Step 4: Connect to VM

```bash
# Find public IP in instance details
ssh ubuntu@YOUR_PUBLIC_IP
```

## Step 5: Deploy Application

### Option A: Clone from Git (Recommended)

```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/jot-ide.git
cd jot-ide

# Run setup script
sudo chmod +x scripts/setup-oracle-cloud.sh
sudo ./scripts/setup-oracle-cloud.sh
```

### Option B: Upload files via SCP

```bash
# From your Mac
scp -r ~/jot-ide ubuntu@YOUR_PUBLIC_IP:~/

# On the server
cd ~/jot-ide
sudo chmod +x scripts/setup-oracle-cloud.sh
sudo ./scripts/setup-oracle-cloud.sh
```

## Step 6: Verify Installation

```bash
# Check all services
sudo systemctl status nginx redis-server php8.1-fpm code-executor-worker

# Test the API
curl http://localhost/api/languages.php

# View worker logs
sudo journalctl -u code-executor-worker -f
```

## Step 7: Access Your App

Open in browser:
```
http://YOUR_PUBLIC_IP
```

## Troubleshooting

### Worker not starting?
```bash
sudo journalctl -u code-executor-worker -n 50
```

### nsjail permission errors?
```bash
# nsjail needs root for namespaces
sudo systemctl restart code-executor-worker
```

### Can't connect to port 80?
1. Check Oracle Cloud Security List (Step 3)
2. Check iptables: `sudo iptables -L -n`

### Redis connection failed?
```bash
redis-cli ping  # Should return PONG
sudo systemctl restart redis-server
```

## Optional: Add SSL (HTTPS)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate (replace with your domain)
sudo certbot --nginx -d code.yourdomain.com

# Auto-renewal is configured automatically
```

## Costs

| Resource | Cost |
|----------|------|
| VM (A1.Flex, 2 OCPU, 12GB) | **Free** |
| Boot Volume (50GB) | **Free** |
| Bandwidth (10TB/month) | **Free** |
| Public IP | **Free** |

Total: **$0/month** forever
