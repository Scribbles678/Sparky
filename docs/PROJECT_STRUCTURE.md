# Sparky Trading Bot - Project Structure

## Overview
```
sparky-trading-bot/
├── docs/                         # Consolidated documentation
│   ├── EXCHANGES.md              # Exchange auth/notes
│   ├── STRATEGIES.md             # Strategy + automation notes
│   ├── TRADINGVIEW.md            # Webhook payload guide
│   ├── DEPLOYMENT.md             # VPS setup
│   ├── PROJECT_STRUCTURE.md      # (this file)
│   ├── alert templates.md        # Copy-paste alert JSON
│   └── schema/                   # Supabase SQL migrations
│
├── src/                          # Source code
│   ├── index.js                  # Main Express server
│   ├── tradeExecutor.js          # Generic trade executor
│   ├── executors/tradierOptionsExecutor.js
│   ├── monitors/tradierOptionsMonitor.js
│   ├── exchanges/                # Aster, OANDA, Tradier, etc.
│   ├── settings/settingsService.js
│   ├── supabaseClient.js
│   ├── positionTracker.js
│   ├── positionUpdater.js
│   └── utils/ (logger, calculations)
│
├── test/                         # Manual test helpers
│   ├── testWebhook.js            # Webhook smoke tests
│   ├── testHyperliquidIntegration.js
│   └── testLighterIntegration.js
│
├── logs/                         # Runtime logs (gitignored)
├── .env.example                  # Template for environment vars
├── config.json.example           # Template for config
├── ecosystem.config.js           # PM2 configuration
├── package.json / package-lock.json
└── README.md                     # Entry point / quickstart
```

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         TradingView                              │
│                    (Sends webhook alerts)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /webhook
                           │ { action, symbol, price, ... }
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express Server                              │
│                     (src/index.js)                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • Webhook validation (secret check)                       │ │
│  │  • Rate limiting (30 req/min)                              │ │
│  │  • Request routing                                         │ │
│  │  • Health check endpoint                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Trade Executor                                │
│                  (src/tradeExecutor.js)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  1. Check existing position                                │ │
│  │  2. Close if exists                                        │ │
│  │  3. Calculate position size                                │ │
│  │  4. Open new position                                      │ │
│  │  5. Place stop loss                                        │ │
│  │  6. Place take profit                                      │ │
│  │  7. Track position                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────┬────────────────────────────┬────────────────────────┘
            │                            │
            │                            │
            ▼                            ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│   Position Tracker       │   │      Aster API Client            │
│ (positionTracker.js)     │   │     (asterApi.js)                │
├──────────────────────────┤   ├──────────────────────────────────┤
│ • In-memory positions    │   │ • HMAC-SHA256 authentication     │
│ • Add/Remove/Update      │   │ • Retry logic (3 attempts)       │
│ • Get summary            │   │ • Exponential backoff            │
│ • Sync with exchange     │   │ • Place orders                   │
└──────────────────────────┘   │ • Get positions                  │
                               │ • Get balance                    │
                               │ • Close positions                │
                               └────────────┬─────────────────────┘
                                            │ HTTPS + HMAC
                                            ▼
                               ┌──────────────────────────────────┐
                               │      Aster DEX API               │
                               │   (api.aster.finance)            │
                               └──────────────────────────────────┘
```

### TradeFI Dashboard Linkage

- **Repo:** `c:\Users\mjjoh\TradeFI\tradefi\` (Nuxt 3 + Nuxt UI). The dashboard reads/writes Supabase through `app/utils/supabase.ts`; whenever Supabase credentials change, update that file plus the `.env`.
- **Shared schema:** TradeFI expects the same tables Sparky manages (`positions`, `trades`, `trade_stats`, `strategies`, `trade_settings_global`, `trade_settings_exchange`, `tradier_option_trades`). Regenerate the SQL snapshots in both repos whenever the schema evolves.
- **Bot touchpoints:** TradeFI server routes proxy Sparky endpoints for health, positions, and strategy reloads (`/api/sparky/health`, `/api/sparky/positions`, `/api/sparky/strategies/reload`). Operator utilities (`/api/trades/sync`, `/api/trades/fix-pnl`) call back into Sparky/Supabase to reconcile data.
- **Refresh cadence:** TradeFI auto-refreshes every 30 s to match Sparky’s `positionUpdater`. If Supabase credentials are absent in Sparky, the updater—and therefore the dashboard—will not show live data.

## Data Flow

### Opening a Position

```
TradingView Alert
    ↓
Webhook Received (POST /webhook)
    ↓
[Validate Secret] ──✗─→ Return 401 Unauthorized
    ↓ ✓
[Validate Fields] ──✗─→ Return 400 Bad Request
    ↓ ✓
[Check Existing Position]
    ↓
    ├─→ [If exists] → Close Position → Wait 1s
    └─→ [If not] → Continue
    ↓
[Check Available Margin] ──✗─→ Return Error
    ↓ ✓
[Calculate Position Size]
    tradeAmount ÷ price = quantity (leverage is managed directly on the exchange)
    ↓
[Place Entry Order]
    Market or Limit order
    ↓ ✓
[Place Stop Loss]
    Type: STOP_MARKET
    Side: Opposite of entry
    reduceOnly: true
    ↓
[Place Take Profit] (Optional)
    Type: TAKE_PROFIT_MARKET
    Side: Opposite of entry
    reduceOnly: true
    ↓
[Track Position]
    Store in PositionTracker
    ↓
[Return Success]
    Response to TradingView
```

### Closing a Position

```
Close Signal Received
    ↓
[Get Position from Exchange]
    ↓
    ├─→ [Not found] → Return "No position to close"
    └─→ [Found] → Continue
    ↓
[Place Market Order]
    Side: Opposite of position
    reduceOnly: true
    ↓
[Cancel Stop Loss & Take Profit]
    (If order IDs exist)
    ↓
[Remove from Tracker]
    ↓
[Return Success]
```

## Key Files Explained

### `src/index.js` (Main Server)
- **Purpose**: Express HTTP server, receives webhooks
- **Key Functions**:
  - `POST /webhook` - Main webhook endpoint
  - `GET /health` - Health check + status
  - `GET /positions` - View tracked positions
  - `POST /positions/sync` - Sync with exchange
- **Security**: Rate limiting, secret validation
- **Startup**: Tests API connection, syncs positions

### `src/asterApi.js` (API Client)
- **Purpose**: Communicate with Aster DEX
- **Authentication**: HMAC-SHA256 signatures
- **Key Methods**:
  - `placeMarketOrder()` - Market execution
  - `placeStopLoss()` - Protective stop
  - `placeTakeProfit()` - Profit target
  - `getPositions()` - Fetch open positions
  - `getBalance()` - Check available margin
- **Error Handling**: Retry logic, exponential backoff

### `src/tradeExecutor.js` (Trading Logic)
- **Purpose**: Execute trading decisions
- **Key Methods**:
  - `executeWebhook()` - Main entry point
  - `openPosition()` - Full position opening flow
  - `closePosition()` - Close existing position
- **Logic**: 
  1. Validate & check existing
  2. Close if needed
  3. Calculate size
  4. Execute trade
  5. Set risk management
  6. Track position

### `src/positionTracker.js` (State Management)
- **Purpose**: Track open positions in memory
- **Storage**: Map keyed by `exchange:symbol`
- **Key Methods**:
  - `addPosition()` - Store new position
  - `removePosition()` - Remove closed position
  - `getPosition()` - Get by symbol + exchange
  - `syncWithExchange()` - Reconcile with API
- **Use Case**: Fast lookups, prevent duplicates

### `src/utils/logger.js` (Logging)
- **Purpose**: Winston-based logging
- **Outputs**:
  - Console (development)
  - combined.log (all logs)
  - error.log (errors only)
  - trades.log (trade execution)
- **Features**: Timestamps, JSON format, rotation

### `src/utils/calculations.js` (Math)
- **Purpose**: Trading calculations
- **Functions**:
  - `calculatePositionSize()` - amount × leverage ÷ price
  - `calculateStopLoss()` - Entry ± percent
  - `calculateTakeProfit()` - Entry ± percent
  - `getOppositeSide()` - BUY ↔ SELL
  - `hasSufficientMargin()` - Risk check

## Configuration Files

### `.env` (Environment Variables)
```env
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_ANON_KEY=your_anon_key_here

WEBHOOK_SECRET=your_secure_random_string

ASTER_API_KEY=...
ASTER_API_SECRET=...
OANDA_API_KEY=...
TRADIER_TOKEN=...
LIGHTER_API_KEY=...
```

### `config.json` (Trading Parameters)
```json
{
  "webhookSecret": "same_as_env_file",
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET",
    "tradeAmount": 600
  },
  "oanda": {
    "accountId": "101-001-28692540-001",
    "accessToken": "YOUR_OANDA_TOKEN",
    "environment": "practice",
    "tradeAmount": 10000
  },
  "tradier": {
    "accountId": "VA55402267",
    "accessToken": "YOUR_TRADIER_TOKEN",
    "environment": "sandbox",
    "tradeAmount": 2000
  },
  "tradierOptions": {
    "accountId": "VA55402267",
    "accessToken": "YOUR_TRADIER_TOKEN",
    "environment": "sandbox"
  },
  "hyperliquid": {
    "apiKey": "YOUR_WALLET",
    "privateKey": "YOUR_PRIVATE_KEY",
    "baseUrl": "https://api.hyperliquid.xyz",
    "isTestnet": false,
    "tradeAmount": 300
  },
  "lighter": {
    "apiKey": "YOUR_LIGHTER_API_KEY",
    "privateKey": "YOUR_ETH_PRIVATE_KEY",
    "accountIndex": 0,
    "apiKeyIndex": 2,
    "baseUrl": "https://mainnet.zklighter.elliot.ai",
    "tradeAmount": 500
  },
  "riskManagement": {
    "maxPositions": 20
  }
}
```

### `ecosystem.config.js` (PM2)
```javascript
{
  name: 'aster-bot',
  script: './src/index.js',
  autorestart: true,            # Auto-restart on crash
  max_memory_restart: '500M',   # Restart if >500MB
  error_file: './logs/pm2-error.log',
  out_file: './logs/pm2-out.log'
}
```

## Security Model

```
┌──────────────────────────────────────┐
│         Security Layers              │
├──────────────────────────────────────┤
│ 1. Webhook Secret Validation         │
│    ├─ Every request must include     │
│    └─ Matches configured secret      │
├──────────────────────────────────────┤
│ 2. Rate Limiting                     │
│    ├─ Max 30 requests/minute         │
│    └─ Prevents abuse                 │
├──────────────────────────────────────┤
│ 3. HMAC Authentication (Aster)       │
│    ├─ API Key + Secret               │
│    ├─ Timestamp + Signature          │
│    └─ Prevents replay attacks        │
├──────────────────────────────────────┤
│ 4. Environment Variables             │
│    ├─ Secrets in .env (not git)      │
│    └─ File permissions: 600          │
├──────────────────────────────────────┤
│ 5. Firewall (Production)             │
│    ├─ Only expose necessary ports    │
│    └─ UFW rules                      │
├──────────────────────────────────────┤
│ 6. SSL/TLS (Production)              │
│    ├─ HTTPS via Nginx                │
│    └─ Let's Encrypt certificates     │
└──────────────────────────────────────┘
```

## Scaling & Performance

### Current Design (Single Instance)
- ✅ Handles 30 webhooks/minute
- ✅ In-memory position tracking
- ✅ Sequential order execution
- ✅ Suitable for most use cases

### Future Scaling Options
- 🔄 Redis for position tracking (multi-instance)
- 🔄 Queue system (Bull/BullMQ) for order processing
- 🔄 Database (PostgreSQL) for trade history
- 🔄 Horizontal scaling with load balancer

## Monitoring Points

1. **Health Endpoint** (`/health`)
   - Uptime
   - API connection status
   - Available balance
   - Open positions count

2. **Log Files**
   - Error rate
   - Trade execution success
   - API latency
   - Memory usage

3. **PM2 Monitoring**
   - Process status
   - CPU usage
   - Memory consumption
   - Restart count

## Deployment Targets

### Development
```
Local machine
  ├─ npm run dev (nodemon)
  ├─ Environment: development
  └─ Logs to console + files
```

### Production
```
DigitalOcean Droplet
  ├─ PM2 process manager
  ├─ Nginx reverse proxy
  ├─ SSL/TLS (Let's Encrypt)
  ├─ UFW firewall
  └─ Automatic restarts
```

## Testing Strategy

### Phase 1: Local Testing
- ✅ Test webhook validation
- ✅ Test API connection
- ✅ Mock trades (dry run)
- ✅ Use test script

### Phase 2: Paper Trading
- ✅ Small amounts ($10-20)
- ✅ Low leverage (2-3x)
- ✅ Monitor for 1 week
- ✅ Verify all features

### Phase 3: Production
- ✅ Gradually increase size
- ✅ Monitor closely
- ✅ Review logs daily
- ✅ Track performance

## Dependencies

### Production
```json
{
  "express": "^4.18.2",          # Web server
  "axios": "^1.6.0",             # HTTP client
  "dotenv": "^16.3.1",           # Environment vars
  "winston": "^3.11.0",          # Logging
  "express-rate-limit": "^7.1.5" # Rate limiting
}
```

### Development
```json
{
  "nodemon": "^3.0.1"            # Auto-reload
}
```

### Global (for deployment)
```
pm2                              # Process manager
```

## Error Recovery

### Automatic Recovery
- ✅ API request failures → Retry 3x
- ✅ Network errors → Exponential backoff
- ✅ Process crash → PM2 auto-restart
- ✅ High memory → PM2 restart at 500MB

### Manual Recovery
- 📝 Check logs: `pm2 logs`
- 🔄 Restart: `pm2 restart aster-bot`
- 🔄 Sync positions: `POST /positions/sync`
- 📊 Health check: `GET /health`

---

**Last Updated**: 2024
**Version**: 1.0.0
**Status**: Production Ready ✅

