# Quick Start Guide - Getting AI Trading Live

**Question:** After adding API key and strategy, will AI start trading?

**Answer:** Almost! You need a few more steps. Here's exactly what to do:

---

## Prerequisites Checklist

Before AI starts making decisions, you need:

1. ✅ **Dependencies installed** (`groq-sdk`, `node-fetch`)
2. ✅ **Environment variables configured** (`GROQ_API_KEY`, `WEBHOOK_URL`)
3. ✅ **AI Worker running** (PM2 or direct)
4. ✅ **Sparky bot running** (to receive signals)
5. ✅ **AI Strategy created** (with `status = 'running'`)
6. ✅ **User has webhook secret** (in `bot_credentials` table)
7. ✅ **User has exchange credentials** (for the exchange you're trading on)

---

## Step-by-Step Setup

### Step 1: Install Dependencies

```bash
cd Sparky
npm install
```

This installs:
- `groq-sdk` (for Groq API)
- `node-fetch` (for webhook calls)

### Step 2: Configure Environment

Add to your `.env` file:

```bash
# Required for AI worker
GROQ_API_KEY=gsk_your_groq_api_key_here
WEBHOOK_URL=http://localhost:3000/webhook  # Or your production URL

# Already should exist (for Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Get Groq API Key:** https://console.groq.com/

### Step 3: Start Sparky Bot (if not already running)

```bash
# If using PM2
pm2 start ecosystem.config.js --only aster-bot

# Or directly
npm start
```

**Why:** The AI worker sends signals to Sparky's `/webhook` endpoint. Sparky must be running to receive them.

### Step 4: Start AI Worker

```bash
# Option A: Using PM2 (recommended for production)
pm2 start ecosystem.config.js --only ai-signal-engine

# Option B: Direct (for testing)
node src/ai-worker/main.js
```

**What happens:** AI worker starts, checks for active strategies every 45 seconds.

### Step 5: Verify User Has Webhook Secret

The AI worker needs the user's webhook secret to send signals. Check:

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

### Step 6: Verify User Has Exchange Credentials

The AI will trade on the exchange specified in the strategy. User must have credentials:

```sql
SELECT * FROM bot_credentials 
WHERE user_id = 'your-user-id' 
AND exchange = 'aster'  -- or whatever exchange you're using
AND environment = 'production';
```

If missing, add via SignalStudio → Account → Exchanges

### Step 7: Create AI Strategy

**Option A: Via SignalStudio UI**
1. Go to `/ai-strategies`
2. Click "New AI Strategy"
3. Fill in details
4. Set status to "Running" (or start it after creation)

**Option B: Via Supabase SQL**
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

---

## What Happens Next

Once everything is set up:

1. **AI Worker checks every 45 seconds:**
   - Fetches strategies with `status = 'running'`
   - For each strategy:
     - Gets market data (OHLCV candles)
     - Calculates indicators (SMA, RSI)
     - Calls Groq API for decision
     - Parses response (LONG/SHORT/CLOSE/HOLD)

2. **If decision is not HOLD:**
   - AI worker sends signal to Sparky `/webhook`
   - Sparky validates webhook secret
   - Sparky loads user's exchange credentials
   - Sparky executes trade (existing pipeline)
   - Trade appears in dashboard

3. **All decisions logged:**
   - Every decision (including HOLDs) saved to `ai_trade_log`
   - Viewable in SignalStudio detail page

---

## Verification Steps

### Check AI Worker is Running

```bash
# PM2
pm2 status
pm2 logs ai-signal-engine --lines 20

# Should see:
# 🤖 AI Signal Engine v1 starting...
# === 🤖 AI Worker Cycle Start ===
# Found 1 active strategy(ies)
```

### Check Health Endpoint

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

---

## Common Issues

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

---

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

---

## Summary

**To get AI trading live, you need:**

1. ✅ Install dependencies: `npm install`
2. ✅ Add `GROQ_API_KEY` to `.env`
3. ✅ Start Sparky bot (if not running)
4. ✅ Start AI worker: `pm2 start ecosystem.config.js --only ai-signal-engine`
5. ✅ Create strategy with `status = 'running'`
6. ✅ Verify user has webhook secret
7. ✅ Verify user has exchange credentials

**Once all steps are done:**
- AI will check every 45 seconds
- Make decisions based on market data
- Send signals to Sparky
- Execute trades automatically

**You're live!** 🚀

---

## Next Steps After Setup

1. **Monitor first few decisions** - Watch logs to see AI reasoning
2. **Check decision log** - View in SignalStudio detail page
3. **Verify trades** - Confirm they appear in dashboard
4. **Adjust strategy** - Tweak risk profile, target assets, etc.
5. **Scale up** - Add more strategies or increase position sizes

