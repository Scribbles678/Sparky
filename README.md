# Sparky Trading Bot 🚀

A headless trading bot that receives TradingView webhook alerts and executes trades on Aster DEX futures.

## Features

- 🔔 Receives TradingView webhook alerts
- 📊 Executes market/limit orders on Aster DEX
- 🛡️ Automatic stop loss and take profit placement
- 📈 Position management (1 position per symbol)
- ⚙️ Configurable leverage per symbol
- 🔐 HMAC-SHA256 authentication
- 📝 Comprehensive logging with Winston
- 🔄 Auto-restart with PM2

## Prerequisites

- Node.js v18 or higher
- Aster DEX API credentials
- TradingView account (for webhook alerts)
- DigitalOcean droplet (for deployment)

## Installation

### 1. Clone & Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
ASTER_API_KEY=your_actual_api_key
ASTER_API_SECRET=your_actual_api_secret
WEBHOOK_SECRET=your_webhook_secret
```

### 3. Configure Trading Parameters

Copy the example config file:
```bash
cp config.json.example config.json
```

Edit `config.json` to set:
- Trade amount per position
- Leverage per symbol
- Risk management parameters

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

### 1. Alert Format for Opening Positions

```json
{
  "secret": "your-webhook-secret",
  "action": "buy",
  "symbol": "BTCUSDT",
  "order_type": "market",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0,
  "price": 45000
}
```

### 2. Alert Format for Closing Positions

```json
{
  "secret": "your-webhook-secret",
  "action": "close",
  "symbol": "BTCUSDT"
}
```

### 3. Webhook URL

Point your TradingView alerts to:
```
http://your-droplet-ip:3000/webhook
```

Or with domain/SSL:
```
https://your-domain.com/webhook
```

## API Endpoints

- `POST /webhook` - Receives TradingView alerts
- `GET /health` - Health check and status
- `GET /positions` - View current open positions

## Trading Logic

1. **Webhook Received** → Validate secret and payload
2. **Check Existing Position** → Close if exists for same symbol
3. **Calculate Position Size** → Based on fixed amount × leverage
4. **Open Position** → Execute market/limit order
5. **Place Stop Loss** → Immediate protective order
6. **Place Take Profit** → Optional profit target
7. **Track Position** → Store in memory for management

## Position Sizing Example

```javascript
// Example: $100 trade amount, 20x leverage, BTC at $50,000
const notionalValue = $100 × 20 = $2,000
const quantity = $2,000 / $50,000 = 0.04 BTC
```

## DigitalOcean Deployment

### 1. Create Droplet
- Ubuntu 22.04 LTS
- $6/month tier (1GB RAM)
- Enable SSH keys

### 2. Server Setup

```bash
# SSH into droplet
ssh root@your-droplet-ip

# Install Node.js v18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Setup firewall
sudo ufw allow 3000
sudo ufw enable

# Clone your repository
git clone your-repo-url
cd sparky-trading-bot

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env  # Edit with your credentials

# Setup config
cp config.json.example config.json
nano config.json  # Edit trading parameters

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions
```

## Security Best Practices

- ✅ Never commit `.env` or `config.json`
- ✅ Use strong webhook secret
- ✅ Restrict API key to droplet IP
- ✅ Disable withdrawal permissions on Aster
- ✅ Setup UFW firewall
- ✅ Use HTTPS in production (nginx reverse proxy)
- ✅ Rate limit webhook endpoint
- ✅ Disable root SSH login
- ✅ Use SSH keys (no passwords)

## Monitoring

### View Logs
```bash
pm2 logs aster-bot
```

### Check Status
```bash
pm2 status
```

### Monitor Resources
```bash
pm2 monit
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Error Handling

The bot handles:
- Invalid webhook secrets → 401 Unauthorized
- Missing required fields → 400 Bad Request
- Insufficient margin → Skip trade, log error
- API failures → Retry 3 times with exponential backoff
- Network errors → Log and continue

## Testing

### Local Testing with Postman

1. Start bot: `npm run dev`
2. Send POST request to `http://localhost:3000/webhook`
3. Include test payload with correct secret

### Test Script
```bash
npm test
```

## File Structure

```
sparky-trading-bot/
├── src/
│   ├── index.js              # Express server & webhook endpoint
│   ├── asterApi.js           # Aster API client with HMAC auth
│   ├── tradeExecutor.js      # Trading logic & position management
│   ├── positionTracker.js    # Track open positions
│   └── utils/
│       ├── logger.js         # Winston logger setup
│       └── calculations.js   # Position size & stop loss calculations
├── logs/                     # Log files (created automatically)
├── config.json               # Configuration (not in git)
├── .env                      # API keys (not in git)
├── .env.example              # Template for .env
├── package.json
├── ecosystem.config.js       # PM2 configuration
└── README.md
```

## Future Enhancements

- [ ] Web dashboard for position monitoring
- [ ] Telegram bot integration for alerts
- [ ] Database for trade history
- [ ] Backtesting mode
- [ ] Multiple account support
- [ ] Dynamic position sizing
- [ ] Trailing stop losses
- [ ] Break-even automation

## Support

For issues with:
- **Aster API**: Contact Aster support
- **TradingView Webhooks**: Check TradingView documentation
- **Bot Issues**: Check logs with `pm2 logs`

## License

MIT License

## Disclaimer

⚠️ **Trading involves risk. This bot is provided as-is with no guarantees. Always test with small amounts first. Never trade more than you can afford to lose.**

