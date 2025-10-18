# Deployment Guide for Sparky Trading Bot

## Prerequisites

- DigitalOcean account
- Domain name (optional but recommended)
- Aster DEX API credentials
- TradingView account with alerts

## Step 1: Create DigitalOcean Droplet

1. Log in to DigitalOcean
2. Create new Droplet:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic ($6/month - 1GB RAM, 1 vCPU)
   - **Data center**: Choose closest to you
   - **Authentication**: SSH keys (recommended) or password
   - **Hostname**: sparky-trading-bot

3. Note down the droplet's IP address

## Step 2: Initial Server Setup

SSH into your droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

### Update system packages
```bash
apt update && apt upgrade -y
```

### Install Node.js v18
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs
```

Verify installation:
```bash
node --version  # Should show v18.x.x
npm --version
```

### Install PM2 globally
```bash
npm install -g pm2
```

### Setup firewall
```bash
ufw allow OpenSSH
ufw allow 3000
ufw enable
```

## Step 3: Deploy the Bot

### Option A: Clone from Git (Recommended)

```bash
cd /opt
git clone YOUR_REPOSITORY_URL sparky-bot
cd sparky-bot
```

### Option B: Upload files manually

```bash
# On your local machine
scp -r ./sparky-trading-bot root@YOUR_DROPLET_IP:/opt/sparky-bot
```

### Install dependencies
```bash
cd /opt/sparky-bot
npm install --production
```

## Step 4: Configure the Bot

### Create environment file
```bash
cp .env.example .env
nano .env
```

Edit with your actual credentials:
```env
NODE_ENV=production
PORT=3000
ASTER_API_KEY=your_actual_api_key_here
ASTER_API_SECRET=your_actual_api_secret_here
ASTER_API_URL=https://api.aster.finance
WEBHOOK_SECRET=your_secure_random_string
LOG_LEVEL=info
```

### Create config file
```bash
cp config.json.example config.json
nano config.json
```

Edit trading parameters:
```json
{
  "tradeAmount": 100,
  "leverage": {
    "BTCUSDT": 20,
    "ETHUSDT": 20,
    "SOLUSDT": 10,
    "default": 5
  },
  "webhookSecret": "same_as_env_file",
  "aster": {
    "apiUrl": "https://api.aster.finance",
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET"
  },
  "riskManagement": {
    "maxPositions": 10,
    "minMarginPercent": 20
  }
}
```

### Secure the files
```bash
chmod 600 .env config.json
```

## Step 5: Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Follow the command shown by `pm2 startup` to enable auto-start on reboot.

### Verify it's running
```bash
pm2 status
pm2 logs aster-bot
```

### Test the health endpoint
```bash
curl http://localhost:3000/health
```

## Step 6: Setup Nginx Reverse Proxy (Optional but Recommended)

### Install Nginx
```bash
apt install -y nginx
```

### Create Nginx configuration
```bash
nano /etc/nginx/sites-available/sparky-bot
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Enable the site
```bash
ln -s /etc/nginx/sites-available/sparky-bot /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Update firewall
```bash
ufw allow 'Nginx Full'
ufw delete allow 3000  # Close direct access to port 3000
```

## Step 7: Setup SSL with Let's Encrypt (If using domain)

### Install Certbot
```bash
apt install -y certbot python3-certbot-nginx
```

### Obtain SSL certificate
```bash
certbot --nginx -d your-domain.com
```

Follow the prompts. Certbot will automatically update your Nginx config.

## Step 8: Configure TradingView Webhooks

1. Go to TradingView
2. Create or edit an alert
3. In the "Notifications" tab, enable "Webhook URL"
4. Enter your webhook URL:
   - With domain + SSL: `https://your-domain.com/webhook`
   - Without domain: `http://YOUR_DROPLET_IP:3000/webhook`

5. Set the message body:
```json
{
  "secret": "your-webhook-secret",
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0,
  "price": {{close}}
}
```

Adjust the message based on your strategy and needs.

## Step 9: Monitoring & Maintenance

### View logs
```bash
pm2 logs aster-bot
pm2 logs aster-bot --lines 100
```

### Monitor resources
```bash
pm2 monit
```

### Check status
```bash
pm2 status
curl http://localhost:3000/health
```

### Restart bot
```bash
pm2 restart aster-bot
```

### Update bot code
```bash
cd /opt/sparky-bot
git pull  # If using git
npm install
pm2 restart aster-bot
```

## Security Best Practices

### 1. Change SSH port (optional)
```bash
nano /etc/ssh/sshd_config
# Change Port 22 to something else like 2222
systemctl restart sshd
ufw allow 2222
```

### 2. Disable root login
```bash
# Create a new user first
adduser tradingbot
usermod -aG sudo tradingbot
# Then disable root
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
systemctl restart sshd
```

### 3. Setup automatic security updates
```bash
apt install -y unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

### 4. Setup log rotation
PM2 handles log rotation automatically, but you can adjust:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 10
```

### 5. Restrict API keys on Aster
- Restrict API key to your droplet's IP address
- Disable withdrawal permissions
- Enable only trading permissions

## Troubleshooting

### Bot won't start
```bash
# Check logs
pm2 logs aster-bot --err

# Check if port is available
netstat -tuln | grep 3000

# Verify Node.js version
node --version
```

### Webhooks not received
```bash
# Check firewall
ufw status

# Check Nginx
systemctl status nginx
nginx -t

# Test locally
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"secret":"your-secret","action":"buy","symbol":"BTCUSDT","price":45000}'
```

### High memory usage
```bash
# Check memory
free -h
pm2 monit

# Restart if needed
pm2 restart aster-bot
```

### API connection issues
```bash
# Test API connectivity
curl -v https://api.aster.finance/fapi/v1/ping

# Check DNS
nslookup api.aster.finance
```

## Backup & Recovery

### Backup configuration
```bash
# Create backup directory
mkdir -p /opt/backups

# Backup configs
cp /opt/sparky-bot/.env /opt/backups/env.backup
cp /opt/sparky-bot/config.json /opt/backups/config.backup

# Backup logs
tar -czf /opt/backups/logs-$(date +%Y%m%d).tar.gz /opt/sparky-bot/logs/
```

### Automated daily backups
```bash
# Create backup script
nano /opt/backup-sparky.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d)

# Backup configs
cp /opt/sparky-bot/.env $BACKUP_DIR/env.backup.$DATE
cp /opt/sparky-bot/config.json $BACKUP_DIR/config.backup.$DATE

# Backup logs (older than 1 day)
tar -czf $BACKUP_DIR/logs.$DATE.tar.gz /opt/sparky-bot/logs/ --exclude='*.log'

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.backup.*" -mtime +7 -delete
find $BACKUP_DIR -name "logs.*.tar.gz" -mtime +7 -delete
```

```bash
chmod +x /opt/backup-sparky.sh

# Add to crontab (run daily at 2 AM)
crontab -e
0 2 * * * /opt/backup-sparky.sh
```

## Support & Resources

- **Aster Finance Docs**: Check their official documentation
- **PM2 Docs**: https://pm2.keymetrics.io/docs/usage/quick-start/
- **TradingView Webhooks**: https://www.tradingview.com/support/solutions/43000529348/
- **Bot Logs**: `/opt/sparky-bot/logs/`

## Quick Reference Commands

```bash
# Start bot
pm2 start ecosystem.config.js

# Stop bot
pm2 stop aster-bot

# Restart bot
pm2 restart aster-bot

# View logs
pm2 logs aster-bot

# Monitor
pm2 monit

# Health check
curl http://localhost:3000/health

# View positions
curl http://localhost:3000/positions

# Sync positions
curl -X POST http://localhost:3000/positions/sync
```

