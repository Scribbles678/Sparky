# Sparky Trading Bot - Project Structure

## Overview
```
sparky-trading-bot/
├── docs/                         # Consolidated documentation
│   ├── README.md                 # Main documentation index
│   ├── guides/                   # How-to guides and setup instructions
│   │   ├── DEPLOYMENT.md         # VPS setup
│   │   ├── TRADINGVIEW.md        # Webhook payload guide
│   │   ├── MULTI_TENANT.md       # Multi-tenant credential loading
│   │   ├── NOTIFICATIONS.md      # Server-side notifications
│   │   ├── ORDER_BUILDER_INTEGRATION.md  # SignalStudio integration
│   │   └── alert templates.md    # Copy-paste alert JSON
│   ├── reference/                # Technical reference documentation
│   │   ├── EXCHANGES.md          # Exchange auth/notes
│   │   ├── STRATEGIES.md         # Strategy + automation notes
│   │   └── PROJECT_STRUCTURE.md  # (this file)
│   ├── roadmap/                  # Future plans and implementation notes
│   └── schema/                   # Supabase SQL migrations
│
├── src/                          # Source code
│   ├── index.js                  # Main Express server
│   ├── tradeExecutor.js          # Generic trade executor
│   ├── executors/tradierOptionsExecutor.js
│   ├── monitors/tradierOptionsMonitor.js
│   ├── exchanges/                # Aster, OANDA, Tradier, CCXT, etc.
│   ├── settings/settingsService.js
│   ├── supabaseClient.js
│   ├── positionTracker.js
│   ├── positionUpdater.js
│   ├── strategyManager.js
│   ├── ai-worker/                # AI Signal Engine
│   │   ├── main.js              # Main worker loop
│   │   ├── prompts/            # Prompt builders
│   │   └── utils/               # Market data, parsers
│   └── utils/                    # Utilities
│       ├── logger.js
│       ├── calculations.js
│       ├── notifications.js
│       ├── redis.js
│       ├── riskLimits.js         # Risk limit checks
│       └── webhookLimits.js      # Webhook limit checks
│
├── test/                         # Manual test helpers
│   └── testWebhook.js            # Webhook smoke tests
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
                           │ POST /api/webhook
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SignalStudio Dashboard                          │
│              (app.signal-studio.co - Netlify)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • Validates webhook secret                               │ │
│  │  • Checks subscription limits                             │ │
│  │  • Builds order from strategy config                      │ │
│  │  • Forwards to Sparky Bot asynchronously                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /webhook (async forward)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Sparky Trading Bot                          │
│                     (VPS - Express.js)                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • Validates webhook (trusts SignalStudio if user_id)     │ │
│  │  • Loads user's exchange credentials from Supabase        │ │
│  │  • Executes trade on exchange                             │ │
│  │  • Logs to Supabase (positions/trades tables)             │ │
│  │  • Sends notifications                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────┬────────────────────────────┬────────────────────────┘
            │                            │
            ▼                            ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│   Position Tracker       │   │      Exchange APIs                │
│ (positionTracker.js)     │   │ (ExchangeFactory.js)             │
├──────────────────────────┤   ├──────────────────────────────────┤
│ • In-memory positions    │   │ • Aster DEX (Crypto)             │
│ • Add/Remove/Update      │   │ • OANDA (Forex)                  │
│ • Get summary            │   │ • Tradier (Stocks/Options)       │
│ • Sync with exchange     │   │ • CCXT Exchanges (100+)          │
└──────────────────────────┘   └────────────┬─────────────────────┘
                                            │ HTTPS
                                            ▼
                               ┌──────────────────────────────────┐
                               │      Exchange APIs               │
                               │   (Aster, OANDA, Tradier, etc.)  │
                               └──────────────────────────────────┘
```

### SignalStudio Dashboard Integration

- **Repository:** SignalStudio dashboard (Nuxt 3) reads/writes Supabase through `app/utils/supabase.ts`
- **Shared schema:** SignalStudio expects the same tables Sparky manages (`positions`, `trades`, `trade_stats`, `strategies`, `trade_settings_exchange`, `tradier_option_trades`, `webhook_requests`, `bot_credentials`, `subscriptions`, `notifications`, `notification_preferences`)
- **Webhook flow:** TradingView → SignalStudio (`/api/webhook`) → Sparky Bot (async forwarding)
- **Data sync:** SignalStudio auto-refreshes every 30s to match Sparky's `positionUpdater` refresh rate

## Data Flow

### Opening a Position

```
TradingView Alert
    ↓
SignalStudio /api/webhook
    ↓
[Validate Secret] ──✗─→ Return 401 Unauthorized
    ↓ ✓
[Build Order from Strategy Config]
    ↓
Forward to Sparky Bot (async)
    ↓
Sparky /webhook
    ↓
[Load User's Exchange Credentials]
    ↓
[ML Pre-Trade Validation] (if strategy has ml_assistance_enabled)
    ├─→ [Load Strategy from DB]
    ├─→ [Get Market Context]
    ├─→ [Call Arthur ML Service]
    ├─→ [Check Confidence vs Threshold]
    ├─→ [If blocked] → Return blocked response + notification
    └─→ [If allowed or error] → Continue (fail-open)
    ↓
[Check Existing Position]
    ├─→ [If exists] → Close Position → Wait 1s
    └─→ [If not] → Continue
    ↓
[Check Available Margin] ──✗─→ Return Error
    ↓ ✓
[Calculate Position Size]
    position_size_usd ÷ price = quantity
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
[Save to Supabase + Track Position]
    ↓
[Send Notification]
    ↓
[Return Success]
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
[Log Trade to Supabase]
    ↓
[Remove from Tracker + Database]
    ↓
[Send Notification]
    ↓
[Return Success]
```

## Key Files Explained

### `src/index.js` (Main Server)
- **Purpose**: Express HTTP server, receives webhooks
- **Key Functions**:
  - `POST /webhook` - Main webhook endpoint (receives from SignalStudio or direct)
  - `GET /health` - Health check + status
  - `GET /positions` - View tracked positions
- **Security**: Rate limiting, secret validation, multi-tenant credential loading
- **Startup**: Tests DB connection, initializes credential cache

### `src/exchanges/ExchangeFactory.js` (Exchange Factory)
- **Purpose**: Create exchange API instances dynamically per-user
- **Key Methods**:
  - `createExchangeForUser()` - Load user's credentials from Supabase, create API instance
  - `createExchange()` - Create instance from provided config (legacy)
  - `getSupportedExchanges()` - List of supported exchanges
- **Supported**: aster, oanda, tradier, tradier_options, plus 100+ via CCXT

### `src/tradeExecutor.js` (Trading Logic)
- **Purpose**: Execute trading decisions
- **Key Methods**:
  - `executeWebhook()` - Main entry point
  - `openPosition()` - Full position opening flow
  - `closePosition()` - Close existing position
  - `validateWithML()` - ML pre-trade validation
  - `getMarketContext()` - Fetch market data for ML
  - `logValidationAttempt()` - Log ML validation results
- **Features**: 
  - Multi-tenant (uses user_id for all DB operations)
  - ML pre-trade validation (optional, per-strategy)
  - Sends notifications on trade events
  - Logs to Supabase positions/trades tables
  - Fail-open error handling (trades proceed if ML fails)

### `src/supabaseClient.js` (Database Client)
- **Purpose**: All Supabase database operations
- **Key Functions**:
  - `logTrade()` - Log completed trade
  - `savePosition()` - Save/update open position
  - `removePosition()` - Remove closed position
  - `getUserExchangeCredentials()` - Load user's exchange API keys (with Redis caching)
  - `validateWebhookSecret()` - Per-user webhook secret validation (with in-memory cache)

### `src/positionTracker.js` (State Management)
- **Purpose**: Track open positions in memory
- **Storage**: Map keyed by `exchange:symbol`
- **Key Methods**:
  - `addPosition()` - Store new position
  - `removePosition()` - Remove closed position
  - `getPosition()` - Get by symbol + exchange
  - `syncWithExchange()` - Reconcile with API

### `src/positionUpdater.js` (Background Service)
- **Purpose**: Keep position data current
- **Features**:
  - Updates prices every 30 seconds
  - Syncs with exchange every 5 minutes
  - Detects manually opened/closed positions
  - Calculates unrealized P&L

### `src/utils/notifications.js` (Notifications)
- **Purpose**: Create notifications in Supabase
- **Features**:
  - Fire-and-forget (never blocks trades)
  - Redis-cached preferences
  - Respects user notification settings

### `src/utils/riskLimits.js` (Risk Management)
- **Purpose**: Enforce weekly trade/loss limits
- **Key Functions**:
  - `checkRiskLimits()` - Checks limits before trade execution
  - `getWeeklyTradeCount()` - Gets weekly trade count (cached)
  - `getWeeklyLossTotal()` - Gets weekly loss total (cached)
- **Features**:
  - Redis caching for performance
  - Graceful degradation on errors
  - Automatic cache invalidation

### ML Validation System
- **Purpose**: Pre-trade validation using Arthur ML service
- **Integration**: `src/tradeExecutor.js`
- **Flow**:
  1. Check if strategy has `ml_assistance_enabled = true`
  2. Fetch current market context (price, volume)
  3. Call Arthur ML service `/validate-strategy-signal`
  4. Compare confidence score to threshold
  5. Block trade if confidence < threshold
  6. Log validation attempt to `strategy_validation_log` table
  7. Send notification if blocked
- **Error Handling**: Fail-open (allows trades if ML service unavailable)
- **Configuration**: Per-strategy via `ml_config.confidence_threshold` (default: 70%)

### `src/utils/webhookLimits.js` (Subscription Limits)
- **Purpose**: Enforce monthly webhook limits by subscription plan
- **Key Functions**:
  - `checkWebhookLimit()` - Checks limit before processing webhook
  - `getWebhookCountThisMonth()` - Gets monthly count (cached)
  - `getUserSubscriptionPlan()` - Gets user's plan (cached)
- **Features**:
  - Plan-based limits (Free: 5/month, Pro: unlimited)
  - Warning notifications at 80% threshold
  - Month transition handling

### `src/ai-worker/main.js` (AI Signal Engine)
- **Purpose**: Background worker for AI trading strategies
- **Features**:
  - Processes active AI strategies every 45 seconds
  - Fetches market data and calculates indicators
  - Calls Groq LLM for trading decisions
  - Sends signals to Sparky webhook endpoint
  - Logs all decisions to database

### `src/utils/logger.js` (Logging)
- **Purpose**: Winston-based logging
- **Outputs**:
  - Console (development)
  - combined.log (all logs)
  - error.log (errors only)
  - trades.log (trade execution)

## Configuration Files

### `.env` (Environment Variables)
```env
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Required for multi-tenant mode
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Optional (for caching)
REDIS_URL=redis://...

# Legacy (optional - for backward compatibility)
WEBHOOK_SECRET=your_secure_random_string
```

### `config.json` (Trading Parameters)

In **multi-tenant mode**, config.json can be empty or minimal:
```json
{}
```

All credentials come from SignalStudio's `bot_credentials` table.

For **legacy/testing mode**:
```json
{
  "webhookSecret": "your_webhook_secret",
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET",
    "tradeAmount": 600
  },
  "oanda": {
    "accountId": "YOUR_ACCOUNT_ID",
    "accessToken": "YOUR_TOKEN",
    "environment": "practice",
    "tradeAmount": 10000
  },
  "riskManagement": {
    "maxPositions": 20
  }
}
```

### `ecosystem.config.js` (PM2)
```javascript
{
  name: 'sparky-bot',
  script: './src/index.js',
  autorestart: true,
  max_memory_restart: '500M',
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
│    ├─ Per-user secrets from Supabase │
│    ├─ In-memory cache (30s refresh)  │
│    └─ Trusts SignalStudio if user_id │
├──────────────────────────────────────┤
│ 2. Rate Limiting                     │
│    ├─ Max 30 requests/minute         │
│    └─ Prevents abuse                 │
├──────────────────────────────────────┤
│ 3. Subscription Limits                │
│    ├─ Monthly webhook limits         │
│    ├─ Free: 5/month, Pro: unlimited  │
│    └─ Enforced before processing     │
├──────────────────────────────────────┤
│ 4. Risk Limits                       │
│    ├─ Weekly trade count limits      │
│    ├─ Weekly loss limits             │
│    └─ Per-exchange configuration     │
├──────────────────────────────────────┤
│ 5. Multi-Tenant Data Isolation       │
│    ├─ All data tagged with user_id   │
│    ├─ RLS policies in Supabase       │
│    └─ Credentials per-user           │
├──────────────────────────────────────┤
│ 6. Exchange Authentication           │
│    ├─ HMAC-SHA256 (Aster)            │
│    ├─ Bearer tokens (OANDA, Tradier) │
│    └─ Credentials from Supabase      │
├──────────────────────────────────────┤
│ 7. Environment Variables             │
│    ├─ Secrets in .env (not git)      │
│    └─ File permissions: 600          │
├──────────────────────────────────────┤
│ 8. SSL/TLS (Production)              │
│    ├─ HTTPS via Nginx                │
│    └─ Let's Encrypt certificates     │
└──────────────────────────────────────┘
```

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
DigitalOcean Droplet (or VPS)
  ├─ PM2 process manager
  ├─ Nginx reverse proxy
  ├─ SSL/TLS (Let's Encrypt)
  ├─ UFW firewall
  └─ Automatic restarts
```

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

## Error Recovery

### Automatic Recovery
- ✅ API request failures → Retry 3x
- ✅ Network errors → Exponential backoff
- ✅ Process crash → PM2 auto-restart
- ✅ High memory → PM2 restart at 500MB

### Manual Recovery
- 📝 Check logs: `pm2 logs sparky-bot`
- 🔄 Restart: `pm2 restart sparky-bot`
- 📊 Health check: `GET /health`
- 📊 Positions: `GET /positions` (auto-synced every 5 minutes)

---

**Last Updated**: December 2025
**Version**: 1.1.0
**Status**: Production Ready ✅
