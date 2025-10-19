# Sparky Trading Bot 🚀

A headless trading bot that receives TradingView webhook alerts and executes trades on Aster DEX futures with leverage-adjusted stop loss and take profit.

## Features

- 🔔 Receives TradingView webhook alerts via HTTP
- 📊 Executes market/limit orders on Aster DEX
- 🛡️ **Leverage-adjusted stop loss and take profit** (profit/loss based on margin, not price)
- 📈 Position management (1 position per symbol, closes existing before opening new)
- ⚙️ Configurable leverage per symbol (set via Aster API)
- 🔐 HMAC-SHA256 authentication for Aster API
- 📝 Comprehensive logging with Winston
- 🔄 Auto-restart with PM2
- 🌐 Nginx reverse proxy support for webhooks
- 🔒 Rate limiting on webhook endpoint

## Prerequisites

- Node.js v18 or higher
- Aster DEX API credentials ([Get API key](https://www.asterdex.com/))
- TradingView account (for webhook alerts)
- DigitalOcean droplet or VPS (for 24/7 deployment)

## Installation

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/sparky-bot.git
cd sparky-bot
npm install
```

### 2. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
NODE_ENV=production
PORT=3000
ASTER_API_KEY=your_actual_api_key
ASTER_API_SECRET=your_actual_api_secret
ASTER_API_URL=https://fapi.asterdex.com
WEBHOOK_SECRET=your_webhook_secret_here
LOG_LEVEL=info
```

### 3. Configure Trading Parameters

Copy the example config file:
```bash
cp config.json.example config.json
```

Edit `config.json`:
```json
{
  "tradeAmount": 100,
  "leverage": {
    "BTCUSDT": 20,
    "ETHUSDT": 5,
    "SOLUSDT": 10,
    "default": 5
  },
  "webhookSecret": "your_webhook_secret_here",
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "riskManagement": {
    "maxPositions": 10,
    "minMarginPercent": 20
  }
}
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### With PM2 (Recommended for Production)
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## TradingView Webhook Setup

### Understanding Leverage-Adjusted TP/SL ⚡

**Important:** The `stopLoss` and `takeProfit` values represent **percentage profit/loss on your margin**, NOT price movement.

The bot automatically converts these to price movements using your leverage:
```
Price Move % = Desired Margin % ÷ Leverage
```

**Example with $100 margin at 5x leverage:**
- `"stopLoss": 20` → 20% loss on margin = **$20 loss** → 4% price move
- `"takeProfit": 50` → 50% profit on margin = **$50 profit** → 10% price move

### 1. Alert Format for Opening Positions

**Basic Format (supports both camelCase and snake_case):**
```json
{
  "secret": "your-webhook-secret",
  "symbol": "ETHUSDT",
  "action": "BUY",
  "orderType": "MARKET",
  "stopLoss": 20,
  "takeProfit": 50
}
```

**Alternative snake_case format:**
```json
{
  "secret": "your-webhook-secret",
  "symbol": "BTCUSDT",
  "action": "SELL",
  "order_type": "market",
  "stop_loss_percent": 20,
  "take_profit_percent": 50
}
```

**With LIMIT order:**
```json
{
  "secret": "your-webhook-secret",
  "symbol": "ETHUSDT",
  "action": "BUY",
  "orderType": "LIMIT",
  "price": 3500,
  "stopLoss": 20,
  "takeProfit": 50
}
```

### 2. Alert Format for Closing Positions

```json
{
  "secret": "your-webhook-secret",
  "action": "CLOSE",
  "symbol": "ETHUSDT"
}
```

### 3. TradingView Pine Script Example

```javascript
//@version=5
strategy("Sparky Trading Bot", overlay=true)

// Your strategy logic here
fastMA = ta.sma(close, 20)
slowMA = ta.sma(close, 50)

bullSignal = ta.crossover(fastMA, slowMA)
bearSignal = ta.crossunder(fastMA, slowMA)

if bullSignal
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-webhook-secret","symbol":"ETHUSDT","action":"BUY","orderType":"MARKET","stopLoss":20,"takeProfit":50}', alert.freq_once_per_bar)

if bearSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-webhook-secret","symbol":"ETHUSDT","action":"SELL","orderType":"MARKET","stopLoss":20,"takeProfit":50}', alert.freq_once_per_bar)
```

### 4. Webhook URL

Point your TradingView alerts to:
```
http://your-droplet-ip/webhook
```

Or with Nginx reverse proxy (recommended):
```
http://your-domain.com/webhook
```

## API Endpoints

- `POST /webhook` - Receives TradingView alerts (rate limited: 30 req/min)
- `GET /health` - Health check and bot status
- `GET /positions` - View current open positions

## Trading Logic Flow

1. **Webhook Received** → Validate secret and payload
2. **Check Existing Position** → Close if exists for same symbol (waits 1s)
3. **Set Leverage** → Calls `/fapi/v1/leverage` endpoint
4. **Check Margin** → Verify sufficient available margin
5. **Fetch Price** → Get current market price (for MARKET orders)
6. **Calculate Position Size** → Based on fixed amount × leverage
7. **Open Position** → Execute market/limit order
8. **Place Stop Loss** → STOP_MARKET order with reduceOnly
9. **Place Take Profit** → TAKE_PROFIT_MARKET order with reduceOnly
10. **Track Position** → Store in memory for management

## Position Sizing & TP/SL Calculation

### Position Size Formula
```javascript
// Example: $100 margin, 5x leverage, ETH at $4,000
const notionalValue = $100 × 5 = $500
const quantity = $500 / $4,000 = 0.125 ETH (rounded to 0.013 ETH for precision)
```

### Leverage-Adjusted TP/SL Formula

**For Take Profit:**
```javascript
// You want 50% profit on $100 margin with 5x leverage
const marginProfitPercent = 50  // 50% = $50 profit
const priceMovePct = marginProfitPercent / leverage  // 50 / 5 = 10%

// LONG: TP above entry
takeProfitPrice = entryPrice × (1 + 0.10)  // $4,000 × 1.10 = $4,400

// SHORT: TP below entry
takeProfitPrice = entryPrice × (1 - 0.10)  // $4,000 × 0.90 = $3,600
```

**For Stop Loss:**
```javascript
// You risk 20% loss on $100 margin with 5x leverage
const marginLossPercent = 20  // 20% = $20 loss
const priceMovePct = marginLossPercent / leverage  // 20 / 5 = 4%

// LONG: SL below entry
stopLossPrice = entryPrice × (1 - 0.04)  // $4,000 × 0.96 = $3,840

// SHORT: SL above entry
stopLossPrice = entryPrice × (1 + 0.04)  // $4,000 × 1.04 = $4,160
```

### TP/SL Examples by Leverage

| Leverage | Margin | Stop Loss (20%) | Take Profit (50%) |
|----------|--------|-----------------|-------------------|
| 5x | $100 | $20 loss (4% price) | $50 profit (10% price) |
| 10x | $100 | $20 loss (2% price) | $50 profit (5% price) |
| 20x | $100 | $20 loss (1% price) | $50 profit (2.5% price) |

## DigitalOcean Deployment

### 1. Create Droplet
- **OS:** Ubuntu 22.04 LTS
- **Plan:** Basic - $6/month (1GB RAM, 25GB SSD) - minimum recommended
- **Datacenter:** Choose closest to you
- **Authentication:** SSH keys (recommended) or password

### 2. Initial Server Setup

```bash
# SSH into droplet
ssh root@your-droplet-ip

# Update system
apt update && apt upgrade -y

# Install Node.js v18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x
npm --version

# Install PM2 globally
npm install -g pm2

# Setup basic firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### 3. Clone and Setup Bot

```bash
# Create app directory
mkdir -p /opt/sparky-bot
cd /opt/sparky-bot

# Clone repository
git clone https://github.com/your-username/sparky-bot.git .

# Install dependencies
npm install --production

# Create environment file
cp .env.example .env
nano .env  # Edit with your API credentials

# Create config file
cp config.json.example config.json
nano config.json  # Edit trading parameters

# Create logs directory
mkdir -p logs
```

### 4. Setup Nginx Reverse Proxy (Recommended)

```bash
# Install Nginx
apt install nginx -y

# Create Nginx config
nano /etc/nginx/sites-available/sparky-bot
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # or use your IP

    location /webhook {
        proxy_pass http://localhost:3000/webhook;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /health {
        proxy_pass http://localhost:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

Enable the site:
```bash
ln -s /etc/nginx/sites-available/sparky-bot /etc/nginx/sites-enabled/
nginx -t  # Test configuration
systemctl restart nginx
```

### 5. Start Bot with PM2

```bash
cd /opt/sparky-bot
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions to enable auto-start on reboot

# Check status
pm2 status
pm2 logs aster-bot --lines 50
```

### 6. Test Deployment

```bash
# Local health check
curl http://localhost:3000/health

# External health check (via Nginx)
curl http://your-droplet-ip/health
```

## Monitoring & Maintenance

### View Logs
```bash
# PM2 logs
pm2 logs aster-bot

# Last 50 lines
pm2 logs aster-bot --lines 50

# Application logs
tail -f /opt/sparky-bot/logs/combined.log
tail -f /opt/sparky-bot/logs/error.log
```

### Check Status
```bash
pm2 status
pm2 monit  # Real-time monitoring
```

### Health Check
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 3600,
  "uptimeFormatted": "1h 0m",
  "apiStatus": "connected",
  "balance": 1250.50,
  "openPositions": 2,
  "positions": [...],
  "timestamp": "2025-10-19T12:00:00.000Z"
}
```

### Update Bot

```bash
cd /opt/sparky-bot
git pull origin main
npm install --production
pm2 restart aster-bot
```

## Security Best Practices

- ✅ Never commit `.env` or `config.json` to git
- ✅ Use strong webhook secret (min 32 characters)
- ✅ Restrict Aster API key to droplet IP if possible
- ✅ Disable withdrawal permissions on Aster API key
- ✅ Setup UFW firewall (only ports 22, 80, 443)
- ✅ Use HTTPS in production (Let's Encrypt with Certbot)
- ✅ Rate limit webhook endpoint (30 req/min by default)
- ✅ Disable root SSH login after setup
- ✅ Use SSH keys only (no password authentication)
- ✅ Keep Node.js and dependencies updated
- ✅ Monitor logs regularly for suspicious activity

## Error Handling

The bot handles various error scenarios:

| Error Type | Response | Action |
|------------|----------|--------|
| Invalid webhook secret | 401 Unauthorized | Alert rejected |
| Missing required fields | 400 Bad Request | Alert rejected |
| Insufficient margin | Log error | Skip trade |
| API failures | Retry 3x | Exponential backoff |
| Network errors | Log error | Continue operation |
| Position size precision | Auto-round | Round to 3 decimals |
| Leverage set failure | Log error | Retry with API call |

## Testing

### Local Testing

1. Start bot in dev mode: `npm run dev`
2. Use test script:

```bash
node test/testWebhook.js
```

### Testing with curl

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-webhook-secret",
    "symbol": "ETHUSDT",
    "action": "BUY",
    "orderType": "MARKET",
    "stopLoss": 20,
    "takeProfit": 50
  }'
```

## File Structure

```
sparky-bot/
├── src/
│   ├── index.js              # Express server & webhook endpoint
│   ├── asterApi.js           # Aster API client (HMAC SHA256)
│   ├── tradeExecutor.js      # Trading logic & TP/SL placement
│   ├── positionTracker.js    # Track open positions in memory
│   └── utils/
│       ├── logger.js         # Winston logger configuration
│       └── calculations.js   # Position size & leverage-adjusted TP/SL
├── test/
│   └── testWebhook.js        # Local webhook testing
├── logs/                     # Log files (auto-created)
│   ├── combined.log          # All logs
│   ├── error.log             # Errors only
│   └── .gitkeep
├── config.json               # Trading configuration (not in git)
├── .env                      # Environment variables (not in git)
├── .env.example              # Template for .env
├── config.json.example       # Template for config.json
├── .gitignore
├── package.json
├── ecosystem.config.js       # PM2 configuration
├── DEPLOYMENT.md             # Detailed deployment guide
├── QUICKSTART.md             # Quick start guide
├── PROJECT_STRUCTURE.md      # Project structure overview
└── README.md                 # This file
```

## Troubleshooting

### Bot not receiving webhooks
1. Check firewall: `ufw status`
2. Check Nginx: `systemctl status nginx`
3. Check bot logs: `pm2 logs aster-bot`
4. Test locally: `curl http://localhost:3000/health`

### Trades not executing
1. Check API credentials in `.env`
2. Verify sufficient margin in Aster account
3. Check logs for errors: `tail -50 logs/error.log`
4. Verify leverage is set correctly for symbol

### TP/SL triggering too fast/slow
- Remember: values are **margin profit/loss %**, not price %
- Adjust based on your leverage and risk tolerance
- Example: With 5x leverage, `stopLoss: 20` = 4% price move

### Signature errors
- Verify API key and secret are correct
- Check that `ASTER_API_URL` is `https://fapi.asterdex.com`
- Ensure system time is synchronized: `timedatectl`

## Future Enhancements

- [ ] Web dashboard for position monitoring
- [ ] Telegram bot integration for trade alerts
- [ ] Database for trade history and analytics
- [ ] Backtesting mode with historical data
- [ ] Multiple account support
- [ ] Dynamic position sizing based on account balance
- [ ] Trailing stop losses
- [ ] Break-even automation after TP1
- [ ] Multiple TP levels (TP1, TP2, TP3)
- [ ] ATR-based stop loss calculation
- [ ] Webhook signature verification (HMAC)

## Support & Documentation

For issues with:
- **Aster API**: Check [Aster API Docs](https://fapi.asterdex.com) or contact support
- **TradingView Webhooks**: See [TradingView Documentation](https://www.tradingview.com/support/solutions/43000529348-i-want-to-know-more-about-webhooks/)
- **Bot Issues**: Check logs with `pm2 logs aster-bot`

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Disclaimer

⚠️ **IMPORTANT RISK DISCLAIMER**

- Trading cryptocurrency futures involves substantial risk of loss
- This bot is provided as-is with NO guarantees or warranties
- Past performance does not indicate future results
- Always test with SMALL amounts first
- Never trade more than you can afford to lose
- The developers assume NO liability for trading losses
- Use at your own risk

**Remember:** Leverage amplifies both gains AND losses. A 20% adverse price move with 5x leverage = 100% loss of margin.
