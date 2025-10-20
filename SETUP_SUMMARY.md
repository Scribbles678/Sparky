# Sparky Bot + TradeFI Dashboard - Setup Summary

## ✅ What Was Completed

### Bot Enhancements (Sparky)
1. ✅ **Position Price Updater** (`src/positionUpdater.js`)
   - Auto-updates position prices every 30 seconds
   - Calculates real-time unrealized P&L
   - Syncs with Supabase automatically

2. ✅ **CORS Support**
   - Dashboard can now query bot API endpoints
   - Configured for localhost:3001 (dashboard port)

3. ✅ **Better Error Handling**
   - Improved webhook validation
   - Symbol cleanup (strips exchange prefix)
   - Action normalization (long→buy, short→sell)

### Dashboard Enhancements (TradeFI)
1. ✅ **Chart.js Installed**
   - Required for P&L charts on dashboard

2. ✅ **Sparky API Endpoints** (`server/api/sparky/`)
   - `/api/sparky/health` - Bot health status
   - `/api/sparky/positions` - Current positions

3. ✅ **Runtime Config Updated**
   - Added `sparkyBotUrl` config
   - Added public Supabase credentials

### Documentation
1. ✅ **SUPABASE_INTEGRATION.md** - Complete integration guide
2. ✅ **TRADINGVIEW_SETUP.md** - Alert configuration guide
3. ✅ **WEBHOOK_TROUBLESHOOTING.md** - Debug common issues

---

## 🔧 What You Need To Do

### 1. Add Supabase Credentials to Bot

In your bot's `.env` file (on VPS), add:

```env
# Supabase Configuration
SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**To get your service role key:**
1. Go to: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/settings/api
2. Copy the **service_role** key (NOT the anon key)
3. Paste it in your `.env` file

### 2. Deploy Updated Bot

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Navigate to bot directory
cd /opt/sparky-bot

# Pull latest changes
git pull origin main

# Install any new dependencies (if needed)
npm install

# Restart bot
pm2 restart aster-bot

# Check logs
pm2 logs aster-bot --lines 30
```

### 3. Verify Bot Integration

You should see in the logs:

```
✅ API connection successful. Available margin: $XX.XX
✅ Database connection successful
✅ Positions synced with exchange on startup
✅ Position price updater started (updates every 30s)
```

### 4. Update TradingView Alerts

Replace hardcoded symbol with `{{ticker}}`:

**Before (❌ Wrong):**
```json
{
  "secret": "your-secret",
  "action": "buy",
  "symbol": "ETHUSDT",
  ...
}
```

**After (✅ Correct):**
```json
{
  "secret": "your-secret",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

Now each chart will trade its own symbol!

### 5. Configure Dashboard (Optional)

Create `.env` file in `c:\Users\mjjoh\TradeFI\tradefi\`:

```env
# Supabase (already has defaults, but you can override)
SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here

# Sparky Bot URL (change if bot is on VPS)
SPARKY_BOT_URL=http://your-vps-ip:3000
```

### 6. Run Dashboard

```bash
# Navigate to dashboard
cd c:\Users\mjjoh\TradeFI\tradefi

# Install dependencies (if not already)
npm install

# Run development server
npm run dev
```

Dashboard will be available at: **http://localhost:3001**

---

## 📊 Testing the Integration

### Test 1: Execute a Trade

From your VPS:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-actual-webhook-secret",
    "action": "buy",
    "symbol": "BTCUSDT",
    "stop_loss_percent": 1.5,
    "take_profit_percent": 4.0
  }'
```

### Test 2: Check Supabase

1. Go to: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
2. Select `positions` table
3. You should see your BTCUSDT position

### Test 3: Check Dashboard

1. Go to: http://localhost:3001/sparky-dashboard
2. You should see:
   - Position in "Open Positions" table
   - Updated stats (open positions count)
   - Real-time price updates (every 30s)

### Test 4: Close Position

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-actual-webhook-secret",
    "action": "close",
    "symbol": "BTCUSDT"
  }'
```

Check:
- Position removed from `positions` table
- Trade logged in `trades` table
- Appears in dashboard "Recent Trades"

---

## 📂 Files Changed/Added

### Sparky Bot (`c:\Users\mjjoh\Sparky\`)

**New Files:**
- `src/positionUpdater.js` - Price updater service
- `SUPABASE_INTEGRATION.md` - Integration guide
- `TRADINGVIEW_SETUP.md` - Alert setup guide
- `WEBHOOK_TROUBLESHOOTING.md` - Troubleshooting guide
- `RECENT_UPDATES.md` - Recent changes summary

**Modified Files:**
- `src/index.js` - Added position updater, CORS support
- `src/supabaseClient.js` - (Already existed, no changes needed)

### TradeFI Dashboard (`c:\Users\mjjoh\TradeFI\tradefi\`)

**New Files:**
- `server/api/sparky/health.ts` - Bot health endpoint
- `server/api/sparky/positions.ts` - Bot positions endpoint

**Modified Files:**
- `nuxt.config.ts` - Added Supabase and bot URL config
- `package.json` - Added Chart.js dependency

**Existing Files (No Changes):**
- `app/utils/supabase.ts` - Already properly configured
- `app/pages/sparky-dashboard.vue` - Already working

---

## 🚀 Quick Command Reference

### Bot Commands (VPS)

```bash
# Status
pm2 status

# Logs (live)
pm2 logs aster-bot

# Logs (recent)
pm2 logs aster-bot --lines 50

# Restart
pm2 restart aster-bot

# Health check
curl http://localhost:3000/health

# Check positions
curl http://localhost:3000/positions
```

### Dashboard Commands (Local)

```bash
# Run dashboard
cd c:\Users\mjjoh\TradeFI\tradefi
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Supabase

- Dashboard: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy
- Table Editor: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
- API Settings: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/settings/api

---

## ⚠️ Important Notes

### Bot Environment Variables Needed:

```env
# Required for trading
ASTER_API_KEY=your_api_key
ASTER_API_SECRET=your_api_secret
WEBHOOK_SECRET=your_webhook_secret

# Required for Supabase integration
SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # ⚠️ NOT anon key!

# Optional
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

### Dashboard Works Without Bot Running

- Dashboard reads from Supabase (not directly from bot)
- Bot API endpoints are optional (for real-time status)
- Dashboard will work even if bot is offline (shows last known data)

### Multi-Ticker Trading

With `{{ticker}}` in alerts:
- Each chart trades its own symbol independently
- Bot can handle up to 10 simultaneous positions (configurable)
- Each symbol can only have 1 open position at a time

---

## 📖 Detailed Documentation

For more information, see:

- **SUPABASE_INTEGRATION.md** - Complete integration guide, troubleshooting
- **TRADINGVIEW_SETUP.md** - Alert configuration, examples, templates
- **WEBHOOK_TROUBLESHOOTING.md** - Common webhook issues and solutions
- **README.md** - Full bot documentation
- **DEPLOYMENT.md** - VPS deployment guide

---

## 🎉 What's Next?

After setup is complete, you can:

1. **Run Alerts on Multiple Tickers**
   - BTC, ETH, SOL, etc.
   - Each trades independently

2. **Monitor Performance**
   - Real-time P&L tracking
   - Win rate analytics
   - Trade history

3. **Future Enhancements**
   - Add Telegram notifications
   - Multi-bot support
   - Advanced analytics
   - Backtesting integration

---

## 🆘 Need Help?

**What's in your bot's `.env` file?**

Please share (with secrets redacted):
```env
ASTER_API_KEY=xxx...
ASTER_API_SECRET=xxx...
WEBHOOK_SECRET=xxx...
SUPABASE_URL=???
SUPABASE_SERVICE_ROLE_KEY=???
```

This will help me verify your configuration is correct!

---

**Last Updated:** October 20, 2025  
**Status:** Ready for Deployment ✅

