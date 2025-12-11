# Sparky Trading Bot 🚀

A headless trading bot that receives TradingView webhook alerts and executes trades on multiple exchanges (Aster DEX, Lighter DEX, OANDA, Tradier) with simple percentage-based stop loss and take profit.

**Part of the SignalStudio Trading Ecosystem:**
- **SignalStudio Dashboard** - Real-time analytics, strategy management, and webhook processing (`app.signal-studio.co`)
- **Sparky Bot** (this repo) - Executes trades on multiple exchanges (VPS/DigitalOcean)

## System Architecture

```
TradingView Alerts → SignalStudio (/api/webhook) → Sparky Bot → Multiple Exchanges
                          ↓                              ↓
                    Redis Cache (Phase 2)          Supabase Database
                          ↓                              ↑
                    Supabase Database          SignalStudio Dashboard (Analytics)

Supported Exchanges:
- Aster DEX (Crypto Futures)
- Lighter DEX (Crypto Perps on zkSync)
- OANDA (Forex)
- Tradier (Stocks/Options)
- Tasty Trade (Futures)
```

**Key Changes:**
- TradingView now sends alerts to **SignalStudio** (`https://app.signal-studio.co/api/webhook`)
- SignalStudio builds complete orders from strategy configurations
- SignalStudio forwards pre-built orders to Sparky Bot **asynchronously**
- Sparky Bot validates webhook secrets per-user from Supabase (with in-memory cache)

## Features

### Trading Bot (Sparky)
- 🔔 Receives **pre-built orders** from SignalStudio (async forwarding)
- 📊 Executes market/limit orders on multiple exchanges
- 🛡️ **Simple percentage-based stop loss and take profit** (% of position value)
- 📈 Position management (1 position per symbol, closes existing before opening new)
- 💰 Position sizing from SignalStudio orders (falls back to `config.json` for direct webhooks)
- 🔐 Multi-exchange authentication (HMAC-SHA256, API keys, etc.)
- 🔐 **Per-user webhook secret validation** from Supabase (with in-memory cache - 30s refresh)
- 🗄️ **Supabase integration** – Logs all trades/positions and powers the dashboard
- 🧮 **Tradier options OTCO flow** – Executor + monitor manage entry/TP/SL legs automatically (pulls trade settings from Supabase when available)
- ⚡ **Position price updater** – Refreshes every 30 seconds when Supabase is configured
- 📝 Comprehensive logging with Winston
- 🔄 Auto-restart with PM2
- 🌐 Nginx reverse proxy support for webhooks
- 🔒 Rate limiting on webhook endpoint (per-user when using Supabase validation)
- ⚡ **Connection pooling** – Reuses HTTP connections for faster processing

## Documentation & Maintenance

- [docs/MULTI_TENANT.md](docs/MULTI_TENANT.md) – **Multi-tenant credential loading from SignalStudio**
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) – **Server-side notifications system**
- [docs/ORDER_BUILDER_INTEGRATION.md](docs/ORDER_BUILDER_INTEGRATION.md) – **How SignalStudio builds orders for Sparky**
- [docs/EXCHANGES.md](docs/EXCHANGES.md) – Exchange-specific auth, sizing, and quirks
- [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) – Project structure overview
- [docs/STRATEGIES.md](docs/STRATEGIES.md) – Strategy metadata, trailing stops, options
- [docs/TRADINGVIEW.md](docs/TRADINGVIEW.md) – Webhook payload expectations + troubleshooting
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) – VPS deployment guide
- Supabase/SQL migrations live in [`docs/schema/`](docs/schema/).

> **Whenever you change behavior or schema, update the related markdown or SQL in this repo.**  
> This repository is the single source of truth—no private Notion/Google Docs.

### Dashboard Integration (SignalStudio)
- 📊 Real-time P&L tracking
- 📈 Win rate analytics
- 📉 Cumulative P&L charts
- 🔴 Live position monitoring
- 📜 Trade history
- ⏱️ Auto-refresh every 30 seconds
- 🎯 Strategy management and order configuration
- 🔔 Webhook activity monitoring

## Prerequisites

- Node.js v18 or higher
- Exchange API credentials:
  - **Aster DEX**: [Get API key](https://www.asterdex.com/)
  - **Lighter DEX**: [Get API key](https://lighter.xyz) (zkSync)
  - **OANDA**: [Get API key](https://www.oanda.com/)
  - **Tradier**: [Get API key](https://tradier.com/)
- TradingView account (for webhook alerts)
- DigitalOcean droplet or VPS (for 24/7 deployment)

## Installation

### 🆕 New: Lighter DEX Integration

The bot now supports **Lighter DEX** - a decentralized perpetual exchange on zkSync with up to 100x leverage!

**Quick Setup:**
1. Get Lighter API credentials at [lighter.xyz](https://lighter.xyz)
2. Add to your `config.json`:
```json
{
  "lighter": {
    "apiKey": "YOUR_LIGHTER_API_KEY",
    "privateKey": "YOUR_ETH_PRIVATE_KEY",
    "accountIndex": 0,
    "apiKeyIndex": 2,
    "baseUrl": "https://mainnet.zklighter.elliot.ai",
    "tradeAmount": 500
  }
}
```
3. Trade with webhook: `{"exchange": "lighter", "symbol": "BTC-USD", "action": "BUY"}`

📖 **Full Guide**: See [docs/EXCHANGES.md](docs/EXCHANGES.md#lighter-dex-zk-rollup)

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
  "webhookSecret": "your_webhook_secret_here",
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret",
    "tradeAmount": 600
  },
  "riskManagement": {
    "maxPositions": 10
  }
}
```

**Configuration:**
- `tradeAmount`: Legacy fallback that is only surfaced in startup logs
- `aster.tradeAmount` (and equivalent blocks for other exchanges): Fixed position size in dollars used for live orders (e.g., 600 = $600 position per trade)
- `webhookSecret`: Secret token for TradingView webhook authentication
- `aster`: Your Aster DEX API credentials
- `riskManagement.maxPositions`: Maximum number of concurrent positions

**Note:** Set your desired leverage (e.g., 25x) directly on the Aster DEX exchange. The bot will use whatever leverage is configured there.

### 4. Configure Supabase Integration (Optional but Recommended)

Add these to your `.env` file for database logging and dashboard integration:

```env
# Supabase Database (for trade logging & SignalStudio dashboard)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**Why Supabase?**
- Logs all trades with entry/exit prices and P&L
- Tracks open positions in real-time
- Powers the SignalStudio analytics dashboard
- Enables performance tracking and analysis
- Stores per-user webhook secrets for validation
- Stores strategy configurations and order configs

**Get Supabase Credentials:**
1. Go to https://app.supabase.com
2. Create a new project or use existing
3. Go to Settings → API
4. Copy `URL` and `service_role` key (NOT anon key)
5. Run the `supabase-schema.sql` to create tables

**Without Supabase:**
- Bot still works and executes trades
- No trade history logging or dashboard integration
- Position price updater & auto-sync services are skipped
- Trades/events are only written to Winston log files

## Integration with SignalStudio Dashboard

### Overview
The **SignalStudio Dashboard** is a separate Nuxt 3 application that provides real-time analytics, strategy management, and webhook processing for Sparky bot trades.

**Repository:** `c:\Users\mjjoh\SignalStudio\signal\`  
**Domain:** `https://app.signal-studio.co`

### How They Work Together

```
┌─────────────────────────────────────────────────────────────────┐
│                    TradingView Platform                          │
│              (User's Trading Strategies)                         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ Webhook Alerts
                        │ POST /api/webhook
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│            SignalStudio Dashboard (Netlify)                      │
│            Domain: app.signal-studio.co                           │
│                                                                 │
│  1. Receives TradingView webhook                                │
│  2. Validates webhook secret (Redis cached)                     │
│  3. Builds order from strategy config (Redis cached)            │
│  4. Forwards to Sparky Bot asynchronously                       │
│  5. Responds to TradingView immediately (< 1 second)           │
└───────────────────────┬─────────────────────────────────────────┘
                        │ Async Forwarding
                        │ POST /webhook (fire-and-forget)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Sparky Trading Bot (VPS)                    │
│                                                                 │
│  1. Receives pre-built order from SignalStudio                  │
│  2. Validates webhook secret (per-user from Supabase)          │
│  3. Executes trade on exchange                                 │
│  4. Saves position to Supabase (positions table)                │
│  5. Updates prices every 30s (positionUpdater.js)              │
│  6. On close: logs to Supabase (trades table)                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │ writes to
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase Database (Cloud)                    │
│                                                                 │
│  Tables:                                                        │
│  - positions (open positions, updated every 30s)                │
│  - trades (completed trades with P&L)                           │
│  - trade_stats (aggregate statistics view)                      │
│  - webhook_requests (webhook activity logs)                     │
│  - bot_credentials (per-user webhook secrets)                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │ reads from
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│            SignalStudio Dashboard (Netlify)                      │
│                                                                 │
│  1. Reads from Supabase (read-only, anon key)                   │
│  2. Displays real-time positions & P&L                          │
│  3. Shows cumulative P&L charts                                 │
│  4. Auto-refreshes every 30 seconds                             │
│  5. Tracks win rate, trades today, etc.                        │
│  6. Shows webhook activity logs                                │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files for Integration

**Sparky Bot:**
- `src/supabaseClient.js` - Database connection & logging functions
- `src/positionUpdater.js` - Updates position prices every 30s
- `src/tradeExecutor.js` - Calls savePosition() and logTrade()
- `src/index.js` - Initializes position updater on startup

**SignalStudio Dashboard:**
- `app/utils/supabase.ts` - Read-only database client
- `app/pages/index.vue` - Main dashboard
- `server/api/webhook/index.ts` - Webhook handler (receives TradingView alerts)
- `server/services/orderBuilder.ts` - Builds orders from strategy configs
- `server/utils/redis.ts` - Redis caching for performance
- `nuxt.config.ts` - Supabase and Redis config

### SignalStudio Dashboard Expectations

- **Repository:** `c:\Users\mjjoh\SignalStudio\signal\` (Nuxt 3 + ShadCN UI frontend, Nitro server routes under `signal/server/api`).
- **Domain:** `https://app.signal-studio.co` (deployed on Netlify)
- **Supabase contract:** `signal/app/utils/supabase.ts` is the single source for read/write calls. Anytime we rotate keys or move projects, update that file (and the `.env`) so the dashboard stays in sync.
- **Shared schema:** Dashboard queries exactly the same tables Sparky writes to (`positions`, `trades`, `trade_stats`, `trade_settings_exchange`, `strategies`, `tradier_option_trades`, `webhook_requests`, `bot_credentials`). Keep the SQL snapshots in both repos aligned; a schema drift will break dashboard auto-refreshes.
- **Webhook processing:** SignalStudio receives TradingView webhooks at `/api/webhook`, builds orders from strategy configurations, and forwards to Sparky Bot asynchronously.
- **Redis caching:** SignalStudio uses Redis to cache credentials, subscriptions, strategies, and exchange settings for faster webhook processing.
- **Bot-facing endpoints:** SignalStudio can call Sparky's HTTP API for health/positions:
  - `GET /api/sparky/health` – for status cards (optional)
  - `GET /api/sparky/positions` – used to reconcile Supabase vs. live positions (optional)
- **Live balances:** Dashboard balance cards (`/api/balance/*`) expect Sparky-side environment variables for Aster, OANDA, Tradier, and Tastytrade to be present so it can proxy those calls. If an exchange is disabled in config, the associated dashboard card will show "Error/Not Connected".

### Data Flow Example

**When Opening a Position:**
```javascript
// 1. TradingView sends webhook
POST /webhook {
  "action": "buy",
  "symbol": "BTCUSDT",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}

// 2. Bot executes trade (tradeExecutor.js)
await this.api.placeMarketOrder(symbol, side, quantity)

// 3. Bot saves to Supabase (supabaseClient.js)
await savePosition({
  symbol: "BTCUSDT",
  side: "BUY",
  entry_price: 95000,
  quantity: 0.00105,
  position_size_usd: 100,
  stop_loss_price: 93575,
  take_profit_price: 98800,
  // ...
})

// 4. Dashboard reads within 30s (supabase.ts)
const positions = await getOpenPositions()
// Shows: BTCUSDT, $100, Unrealized P&L: $0
```

**Every 30 Seconds:**
```javascript
// positionUpdater.js automatically:
const currentPrice = await this.api.getTicker(symbol)
const unrealizedPnL = calculatePnL(position, currentPrice)

await updatePositionPnL(symbol, currentPrice, unrealizedPnL)
// Dashboard auto-refreshes and shows updated P&L
```

**When Closing:**
```javascript
// 1. Position hits TP/SL or manual close
await this.api.closePosition(symbol, side, quantity)

// 2. Bot logs final trade
await logTrade({
  symbol: "BTCUSDT",
  entry_price: 95000,
  exit_price: 98800,
  pnl_usd: 4.00,
  pnl_percent: 4.0,
  is_winner: true,
  exit_reason: "TAKE_PROFIT"
})

// 3. Bot removes from positions
await removePosition(symbol)

// 4. Dashboard shows in "Recent Trades"
// Stats update: today's P&L, win rate, etc.
```

### Database Schema

**positions table** (open positions):
- `symbol` (unique) - Trading pair
- `side` - BUY or SELL
- `entry_price` - Entry price
- `current_price` - Latest price (updated every 30s)
- `unrealized_pnl_usd` - Current profit/loss
- `stop_loss_price`, `take_profit_price`
- `last_price_update` - Last update timestamp

**trades table** (completed trades):
- `symbol` - Trading pair
- `entry_price`, `exit_price`
- `entry_time`, `exit_time`
- `pnl_usd`, `pnl_percent`
- `is_winner` - Boolean
- `exit_reason` - STOP_LOSS, TAKE_PROFIT, or MANUAL

### Setup SignalStudio Dashboard

See the **Documentation & Maintenance** section above for links to the latest Supabase/schema notes.

**Quick Start:**
```bash
# Navigate to dashboard
cd c:\Users\mjjoh\SignalStudio\signal

# Install dependencies
npm install

# Add .env file with Supabase credentials
# SUPABASE_URL=...
# SUPABASE_ANON_KEY=... (use anon key, NOT service role)
# REDIS_URL=... (optional but recommended for performance)

# Run dashboard
npm run dev

# Open http://localhost:3000
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

### ⚠️ Important: Webhook URL Change

**TradingView alerts now go to SignalStudio, not directly to Sparky Bot.**

**Webhook URL:** `https://app.signal-studio.co/api/webhook`

SignalStudio will:
1. Validate your webhook secret
2. Build the complete order from your strategy configuration
3. Forward the order to Sparky Bot asynchronously
4. Respond to TradingView immediately (< 1 second)

### Understanding Simple TP/SL 💡

**The `stopLoss` and `takeProfit` values are simple price movement percentages.**

With a $100 position:
- `"stopLoss": 2` → 2% price move against you = **$2 loss**
- `"takeProfit": 5` → 5% price move in your favor = **$5 profit**

It's that simple! No leverage calculations needed.

### 1. Simple Alert Format (Recommended)

**If you have a strategy configured in SignalStudio:**
```json
{
  "secret": "your-webhook-secret",
  "strategy": "My Strategy Name",
  "action": "BUY",
  "symbol": "ETHUSDT"
}
```

SignalStudio will automatically:
- Look up your strategy configuration
- Build the complete order (position size, TP/SL, order type)
- Forward to Sparky Bot

### 2. Full Alert Format (Still Supported)

**For direct webhooks or alert overrides:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "aster",
  "symbol": "ETHUSDT",
  "action": "BUY",
  "orderType": "MARKET",
  "stopLoss": 2,
  "takeProfit": 5
}
```

**Alternative snake_case format:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "aster",
  "symbol": "BTCUSDT",
  "action": "SELL",
  "order_type": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**With LIMIT order:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "aster",
  "symbol": "ETHUSDT",
  "action": "BUY",
  "orderType": "LIMIT",
  "price": 3500,
  "stopLoss": 2,
  "takeProfit": 5
}
```

### 2. Alert Format for Closing Positions

```json
{
  "secret": "your-webhook-secret",
  "exchange": "aster",
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
    alert('{"secret":"your-webhook-secret","exchange":"aster","symbol":"ETHUSDT","action":"BUY","orderType":"MARKET","stopLoss":2,"takeProfit":5}', alert.freq_once_per_bar)

if bearSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-webhook-secret","exchange":"aster","symbol":"ETHUSDT","action":"SELL","orderType":"MARKET","stopLoss":2,"takeProfit":5}', alert.freq_once_per_bar)
```

### 4. Webhook URL

**Point your TradingView alerts to SignalStudio:**
```
https://app.signal-studio.co/api/webhook
```

**Note:** Sparky Bot still supports direct webhooks for backward compatibility, but the recommended flow is through SignalStudio for:
- Strategy-based order configuration
- Centralized rate limiting
- Order building from saved configurations
- Better performance with Redis caching

## API Endpoints

- `POST /webhook` - Receives TradingView alerts (rate limited: 30 req/min)
- `GET /health` - Health check and bot status
- `GET /positions` - View current open positions

## Trading Logic Flow

1. **Webhook Received** → Validate secret and payload
2. **Check Existing Position** → Close if exists for same symbol (waits 1s)
3. **Check Margin** → Verify sufficient available margin
4. **Fetch Price** → Get current market price (for MARKET orders)
5. **Calculate Position Size** → `quantity = tradeAmount / price`
6. **Open Position** → Execute market/limit order (exchange uses its leverage setting)
7. **Place Stop Loss** → STOP_MARKET order with reduceOnly
8. **Place Take Profit** → TAKE_PROFIT_MARKET order with reduceOnly
9. **Track Position** → Store in memory for management

## Position Sizing & TP/SL Calculation

### Position Size Formula

**When receiving orders from SignalStudio:**
- Position size comes from `position_size_usd` in the pre-built order
- SignalStudio calculates this from your strategy configuration

**For direct webhooks (backward compatibility):**
```javascript
// Example: $100 position, ETH at $4,000
const quantity = $100 / $4,000 = 0.025 ETH (rounded to 0.025 for precision)
```

**That's it!** No leverage multiplication needed. The exchange handles margin requirements based on your leverage settings.

### Simple TP/SL Formula

**For Take Profit:**
```javascript
// You want 5% profit on $100 position
const takeProfitPercent = 5  // 5% price move = $5 profit

// LONG: TP above entry
takeProfitPrice = entryPrice × (1 + 0.05)  // $4,000 × 1.05 = $4,200

// SHORT: TP below entry
takeProfitPrice = entryPrice × (1 - 0.05)  // $4,000 × 0.95 = $3,800
```

**For Stop Loss:**
```javascript
// You risk 2% loss on $100 position
const stopLossPercent = 2  // 2% price move = $2 loss

// LONG: SL below entry
stopLossPrice = entryPrice × (1 - 0.02)  // $4,000 × 0.98 = $3,920

// SHORT: SL above entry
stopLossPrice = entryPrice × (1 + 0.02)  // $4,000 × 1.02 = $4,080
```

### TP/SL Examples with $100 Position

| Entry Price | Stop Loss (2%) | Take Profit (5%) | Risk | Reward | R:R |
|-------------|----------------|------------------|------|--------|-----|
| $4,000 | $3,920 (-$2) | $4,200 (+$5) | $2 | $5 | 1:2.5 |
| $60,000 | $58,800 (-$2) | $63,000 (+$5) | $2 | $5 | 1:2.5 |
| $150 | $147 (-$2) | $157.50 (+$5) | $2 | $5 | 1:2.5 |

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
    "stopLoss": 2,
    "takeProfit": 5
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
│       └── calculations.js   # Position size & simple TP/SL calculations
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
4. Verify leverage is set on the exchange (e.g., 25x for max)

### TP/SL triggering too fast/slow
- Values are simple **price movement percentages**
- `stopLoss: 2` = 2% price move against you
- `takeProfit: 5` = 5% price move in your favor
- Adjust based on asset volatility and your risk tolerance

### Signature errors
- Verify API key and secret are correct
- Check that `ASTER_API_URL` is `https://fapi.asterdex.com`
- Ensure system time is synchronized: `timedatectl`

## Future Enhancements

- [x] Web dashboard for position monitoring (SignalStudio Dashboard - deployed!)
- [ ] Telegram bot integration for trade alerts
- [x] Database for trade history and analytics (Supabase - implemented)
- [ ] Backtesting mode with historical data
- [x] Multiple account support (Multi-tenant per-user credentials)
- [x] Dynamic position sizing based on account balance (Strategy configs)
- [x] Trailing stops (OANDA support)
- [ ] Break-even automation after TP1
- [ ] Multiple TP levels (TP1, TP2, TP3)
- [ ] ATR-based stop loss calculation
- [x] Webhook signature verification (Per-user secrets from Supabase)

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

**Remember:** Leverage amplifies both gains AND losses. Always use appropriate stop losses and never risk more than you can afford to lose.

---

**Version:** 1.1  
**Last Updated:** December 2025