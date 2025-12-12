# AI Signal Engine Guide

The AI Signal Engine is a background worker that processes active AI trading strategies, makes trading decisions using Groq's LLM, and sends signals to Sparky's webhook endpoint for execution.

## Overview

```
AI Worker (main.js)
    ↓
1. Fetch active strategies from Supabase (status='running')
    ↓
2. Get market data (OHLCV candles, indicators)
    ↓
3. Call Groq API for trading decision
    ↓
4. Parse decision (LONG/SHORT/CLOSE/HOLD)
    ↓
5. Send signal to Sparky /webhook endpoint
    ↓
6. Sparky executes trade (existing pipeline)
    ↓
7. Log decision to ai_trade_log table
```

## Architecture

**File:** `src/ai-worker/main.js`

The AI worker runs continuously, processing strategies every 45 seconds:

1. **Strategy Discovery**: Fetches all strategies with `status = 'running'`
2. **Market Data**: Gets 1-minute OHLCV candles (100 bars) for each strategy
3. **Indicators**: Calculates technical indicators (SMA, RSI, etc.)
4. **AI Decision**: Calls Groq LLM with market data and strategy context
5. **Signal Generation**: If decision is not HOLD, sends webhook to Sparky
6. **Logging**: All decisions (including HOLDs) logged to database

## Setup

### 1. Install Dependencies

```bash
npm install groq-sdk node-fetch
```

### 2. Environment Variables

Add to `.env`:

```bash
# Required for AI worker
GROQ_API_KEY=gsk_your_groq_api_key_here
WEBHOOK_URL=http://localhost:3000/webhook  # Or production URL

# Already should exist (for Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Get Groq API Key:** https://console.groq.com/

### 3. Start AI Worker

**Option A: Using PM2 (Recommended)**

```bash
pm2 start ecosystem.config.js --only ai-signal-engine
pm2 logs ai-signal-engine
```

**Option B: Direct (for testing)**

```bash
node src/ai-worker/main.js
```

### 4. Verify User Has Webhook Secret

The AI worker needs the user's webhook secret to send signals:

```sql
SELECT * FROM bot_credentials 
WHERE user_id = 'your-user-id' 
AND exchange = 'webhook' 
AND environment = 'production';
```

If missing, create one in SignalStudio or manually:

```sql
INSERT INTO bot_credentials (user_id, exchange, webhook_secret, environment)
VALUES (
  'your-user-id',
  'webhook',
  'your-secret-here',
  'production'
);
```

### 5. Verify User Has Exchange Credentials

The AI will trade on the exchange specified in the strategy. User must have credentials:

```sql
SELECT * FROM bot_credentials 
WHERE user_id = 'your-user-id' 
AND exchange = 'aster'  -- or whatever exchange you're using
AND environment = 'production';
```

If missing, add via SignalStudio → Account → Exchanges

## Creating AI Strategies

### Via SignalStudio UI

1. Go to `/ai-strategies`
2. Click "New AI Strategy"
3. Fill in details:
   - Name
   - Risk profile (conservative, balanced, aggressive)
   - Target assets (e.g., BTCUSDT, ETHUSDT)
   - Max drawdown percent
   - Leverage max
4. Set status to "Running" (or start it after creation)

### Via Supabase SQL

```sql
INSERT INTO ai_strategies (
  user_id,
  name,
  status,
  risk_profile,
  target_assets,
  max_drawdown_percent,
  leverage_max
)
VALUES (
  'your-user-id',
  'My First AI Strategy',
  'running',  -- ⚠️ Must be 'running' for AI to process it
  'balanced',
  '{BTCUSDT}',
  20.00,
  10
);
```

## How It Works

### Decision Cycle

Every 45 seconds, the AI worker:

1. **Fetches Active Strategies**
   ```sql
   SELECT * FROM ai_strategies 
   WHERE status = 'running'
   ```

2. **Gets Market Data**
   - Fetches 100 bars of 1-minute OHLCV data
   - Calculates indicators (SMA, RSI, etc.)
   - Gets current positions for the user

3. **Calls Groq API**
   - Builds prompt with market data, indicators, strategy context
   - Sends to Groq LLM for decision
   - Parses response: `{ action, symbol, size_usd, confidence, reasoning }`

4. **Processes Decision**
   - **HOLD**: Logs decision, no action
   - **LONG/SHORT/CLOSE**: Sends signal to Sparky webhook

5. **Logs Decision**
   - All decisions logged to `ai_trade_log` table
   - Includes confidence, reasoning, market data snapshot

### Signal Format

When AI decides to trade, it sends this payload to Sparky:

```json
{
  "user_id": "user-uuid",
  "userId": "user-uuid",
  "secret": "webhook-secret",
  "exchange": "aster",
  "symbol": "BTCUSDT",
  "action": "BUY",  // or SELL, CLOSE
  "position_size_usd": 100,
  "strategy_id": "strategy-uuid",
  "source": "ai_engine_v1",
  "ai_confidence": 0.85,
  "ai_reasoning": "Strong bullish momentum..."
}
```

Sparky processes this like any other webhook, executing the trade with the user's credentials.

## Monitoring

### Check AI Worker Status

```bash
# PM2
pm2 status
pm2 logs ai-signal-engine --lines 20

# Should see:
# 🤖 AI Signal Engine v1 starting...
# === 🤖 AI Worker Cycle Start ===
# Found 1 active strategy(ies)
```

### Health Endpoint

```bash
curl http://localhost:3000/health/ai-worker
```

Response:
```json
{
  "status": "ok",
  "activeStrategies": 1,
  "timestamp": "2025-12-11T..."
}
```

### Watch Logs for Decisions

```bash
# AI Worker logs
pm2 logs ai-signal-engine --lines 50

# Look for:
# 📊 Processing AI strategy: My First AI Strategy
# 🤖 AI Decision: { action: 'LONG', symbol: 'BTCUSDT', ... }
# 📤 Sending AI signal to Sparky
# ✅ AI signal executed successfully
```

### Check Sparky Logs

```bash
pm2 logs aster-bot --lines 50

# Look for:
# Webhook received { source: 'ai_engine_v1', ... }
# 🔐 Loading aster credentials for user...
# Webhook processed successfully
```

## Configuration

### Cycle Interval

Default: 45 seconds (defined in `main.js`)

To change:
```javascript
const CYCLE_INTERVAL = 60000; // 60 seconds
```

### Groq Model

Default: `llama-3.1-70b-versatile` (defined in `main.js`)

To change:
```javascript
const model = 'llama-3.1-8b-instant'; // Faster, less accurate
```

### Paper Trading Mode

Enable paper trading to log decisions without executing trades:

```sql
UPDATE ai_strategies 
SET is_paper_trading = true 
WHERE id = 'your-strategy-id';
```

## Database Schema

### ai_strategies

Stores AI strategy configurations:

```sql
CREATE TABLE ai_strategies (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'paused',  -- 'running', 'paused', 'stopped'
  risk_profile TEXT DEFAULT 'balanced',  -- 'conservative', 'balanced', 'aggressive'
  target_assets TEXT[],  -- Array of symbols
  max_drawdown_percent NUMERIC(5,2) DEFAULT 20.00,
  leverage_max INTEGER DEFAULT 10,
  is_paper_trading BOOLEAN DEFAULT false,
  copy_override_percent NUMERIC(4,2) DEFAULT 15.00,  -- For copy trading
  is_public_leader BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ai_trade_log

Logs all AI decisions (including HOLDs):

```sql
CREATE TABLE ai_trade_log (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES ai_strategies,
  decision_action TEXT,  -- 'LONG', 'SHORT', 'CLOSE', 'HOLD'
  symbol TEXT,
  confidence NUMERIC(3,2),  -- 0.00 to 1.00
  reasoning TEXT,
  market_data JSONB,  -- Snapshot of market data used
  indicators JSONB,  -- Calculated indicators
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Troubleshooting

### "No active strategies found"

- **Check:** Strategy status must be `'running'` (not `'paused'`)
- **Fix:** Update strategy status in SignalStudio or Supabase

### "GROQ_API_KEY not found"

- **Check:** `.env` file has `GROQ_API_KEY=...`
- **Fix:** Add the key and restart AI worker

### "No webhook secret found"

- **Check:** User has webhook secret in `bot_credentials`
- **Fix:** Create webhook secret in SignalStudio → Account → Webhook

### "No aster credentials found"

- **Check:** User has exchange credentials configured
- **Fix:** Add exchange API keys in SignalStudio → Account → Exchanges

### "AI worker not starting"

- **Check:** Dependencies installed (`npm install`)
- **Check:** Node version >= 18 (`node --version`)
- **Check:** Logs for error messages

### "Signals not executing"

- **Check:** Sparky bot is running
- **Check:** Webhook URL is correct in `.env`
- **Check:** User's webhook secret matches
- **Check:** User's exchange credentials are valid
- **Check:** Risk limits and webhook limits not exceeded

## Safety Recommendations

### Start with Paper Trading

When creating your first strategy, enable paper trading:

```sql
UPDATE ai_strategies 
SET is_paper_trading = true 
WHERE id = 'your-strategy-id';
```

This logs all decisions but doesn't execute trades. Perfect for testing!

### Start with Small Position Sizes

The AI will use the `position_size_usd` from its decision, but you can also set limits in trade settings.

### Monitor Closely

For the first 24 hours:
- Watch logs frequently
- Check decision log in SignalStudio
- Verify trades are executing correctly
- Check for any errors

### Set Risk Limits

Configure weekly trade/loss limits in SignalStudio Trade Settings to prevent over-trading.

## Integration with Copy Trading

When an AI strategy generates a signal:
1. Leader's trade executes normally
2. If `source = 'ai_engine_v1'`, copy trading fan-out is triggered
3. All active followers receive scaled versions of the trade
4. See [COPY_TRADING.md](COPY_TRADING.md) for details

---

**Version:** 1.0  
**Last Updated:** December 2025

