# Supabase Integration Guide

## Overview

This guide explains how Sparky Trading Bot integrates with Supabase and the TradeFI dashboard to provide real-time trade logging, analytics, and monitoring.

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌───────────────────┐
│  TradingView    │         │  Sparky Bot      │         │    Supabase       │
│   Webhook       │────────▶│  (Port 3000)     │────────▶│    Database       │
│   Alerts        │         │                  │         │                   │
└─────────────────┘         │  - Logs trades   │         │  - trades table   │
                            │  - Saves positions│         │  - positions      │
                            │  - Updates prices │         │  - stats views    │
                            └──────────────────┘         └───────────────────┘
                                     │                             ▲
                                     │                             │
                                     ▼                             │
                            ┌──────────────────┐                  │
                            │  TradeFI         │──────────────────┘
                            │  Dashboard       │   (Read-only)
                            │  (Port 3001)     │
                            └──────────────────┘
```

---

## 📊 Database Schema

### Tables

#### 1. `trades` - Completed Trades
Stores all closed trades with P&L calculations.

**Key Fields:**
- `symbol` - Trading pair (BTCUSDT, ETHUSDT, etc.)
- `side` - BUY or SELL
- `entry_price` / `exit_price` - Trade prices
- `entry_time` / `exit_time` - Timestamps
- `quantity` - Position size in crypto
- `position_size_usd` - Position size in USD
- `stop_loss_price` / `take_profit_price` - Risk management levels
- `pnl_usd` / `pnl_percent` - Profit/Loss
- `is_winner` - Boolean (profit or loss)
- `exit_reason` - STOP_LOSS, TAKE_PROFIT, or MANUAL

#### 2. `positions` - Open Positions
Tracks currently open positions with real-time updates.

**Key Fields:**
- `symbol` - Trading pair (unique constraint)
- `side` - BUY or SELL
- `entry_price` - Entry price
- `current_price` - Latest market price (updated every 30s)
- `unrealized_pnl_usd` / `unrealized_pnl_percent` - Current P&L
- `stop_loss_order_id` / `take_profit_order_id` - Order IDs
- `last_price_update` - Last update timestamp

#### 3. `trade_stats` - View (Analytics)
Aggregate statistics for all-time performance.

**Metrics:**
- `total_trades` - Total completed trades
- `winning_trades` / `losing_trades` - Win/loss count
- `win_rate_percent` - Win rate %
- `total_pnl_usd` - Total P&L
- `avg_pnl_per_trade` - Average P&L per trade
- `largest_win` / `largest_loss` - Best/worst trades
- `avg_win` / `avg_loss` - Average win/loss size

---

## ⚙️ Bot Configuration

### Required Environment Variables

Add these to your bot's `.env` file:

```env
# Supabase Configuration
SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Optional: Dashboard URL for CORS
DASHBOARD_URL=http://localhost:3001
```

**Important Notes:**
- ✅ Use **SERVICE_ROLE_KEY** (not anon key) for the bot
- ✅ Service role key has full read/write access
- ✅ Keep this key secret - never expose it publicly
- ✅ Get keys from: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/settings/api

### Getting Your Service Role Key

1. Go to https://app.supabase.com
2. Select your project: **yfzfdvghkhctzqjtwajy**
3. Go to **Settings** → **API**
4. Copy the **service_role** key (NOT the anon key)
5. Add it to your `.env` file

---

## 🔄 How Integration Works

### 1. Trade Logging Flow

**When Opening a Position:**
```
1. TradingView sends webhook
2. Bot validates and executes trade
3. Bot saves to positions table:
   - savePosition() in supabaseClient.js
   - Records entry price, SL, TP, etc.
4. Position tracked in-memory
5. Price updater starts monitoring
```

**While Position is Open:**
```
1. Position Updater runs every 30 seconds
2. Fetches current price from exchange
3. Calculates unrealized P&L
4. Updates positions table:
   - updatePositionPnL() in supabaseClient.js
   - Updates current_price
   - Updates unrealized_pnl_usd
   - Updates unrealized_pnl_percent
5. Dashboard refreshes every 30s to show updates
```

**When Closing a Position:**
```
1. Position hit TP/SL or manual close
2. Bot calculates final P&L
3. Bot logs to trades table:
   - logTrade() in supabaseClient.js
   - Records exit price, P&L, exit reason
4. Bot removes from positions table:
   - removePosition() in supabaseClient.js
5. Position removed from in-memory tracker
```

### 2. Key Components

#### Bot Side (`src/`)

**supabaseClient.js:**
- `logTrade()` - Log completed trade
- `savePosition()` - Save/update open position
- `removePosition()` - Remove closed position
- `updatePositionPnL()` - Update position price
- `getOpenPositions()` - Fetch all positions
- `testConnection()` - Test database connection

**positionUpdater.js** (NEW):
- Runs every 30 seconds
- Updates all open position prices
- Calculates unrealized P&L
- Syncs with Supabase automatically

**index.js:**
- Initializes Supabase connection on startup
- Starts position updater if DB connected
- Stops updater on shutdown

#### Dashboard Side (`c:\Users\mjjoh\TradeFI\tradefi\`)

**app/utils/supabase.ts:**
- `getOpenPositions()` - Fetch open positions
- `getRecentTrades()` - Fetch recent trades
- `getTodaysStats()` - Today's performance
- `getTradeStats()` - All-time stats
- `getCumulativePnL()` - P&L chart data

**server/api/sparky/health.ts:**
- Checks bot health status
- Returns balance, uptime, API status

**server/api/sparky/positions.ts:**
- Fetches positions from bot's REST API
- Alternative to Supabase queries

**app/pages/sparky-dashboard.vue:**
- Real-time dashboard
- Auto-refreshes every 30 seconds
- Shows open positions, recent trades, P&L chart

---

## 🚀 Setup Instructions

### Step 1: Run SQL Schema

1. Go to https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
2. Open SQL Editor
3. Copy contents of `supabase-schema.sql`
4. Run the SQL
5. Verify tables created: `trades`, `positions`

### Step 2: Configure Bot

1. Add Supabase credentials to bot's `.env`:
   ```env
   SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```

2. Deploy updated bot code to VPS:
   ```bash
   cd /opt/sparky-bot
   git pull origin main
   npm install  # In case new dependencies added
   pm2 restart aster-bot
   ```

3. Check logs for confirmation:
   ```bash
   pm2 logs aster-bot --lines 20
   ```

   You should see:
   ```
   ✅ Database connection successful
   ✅ Position price updater started (updates every 30s)
   ```

### Step 3: Configure Dashboard

1. Create `.env` file in dashboard directory:
   ```env
   # Supabase (read-only access)
   SUPABASE_URL=https://yfzfdvghkhctzqjtwajy.supabase.co
   SUPABASE_ANON_KEY=your_anon_key_here
   
   # Sparky Bot URL
   SPARKY_BOT_URL=http://your-vps-ip:3000
   ```

2. Install dependencies:
   ```bash
   cd c:\Users\mjjoh\TradeFI\tradefi
   npm install
   ```

3. Run dashboard:
   ```bash
   npm run dev
   ```

4. Open browser: http://localhost:3001/sparky-dashboard

### Step 4: Test Integration

#### Test 1: Bot Database Connection

```bash
# SSH into VPS
ssh root@your-vps-ip

# Check bot logs
pm2 logs aster-bot --lines 50

# Look for:
✅ Database connection successful
✅ Position price updater started
```

#### Test 2: Execute a Trade

1. Trigger a trade from TradingView or use curl:
   ```bash
   curl -X POST http://localhost:3000/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "secret": "your-secret",
       "action": "buy",
       "symbol": "BTCUSDT",
       "stop_loss_percent": 1.5,
       "take_profit_percent": 4.0
     }'
   ```

2. Check Supabase:
   - Go to https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
   - Select `positions` table
   - You should see the new position

3. Check dashboard:
   - Go to http://localhost:3001/sparky-dashboard
   - Position should appear in "Open Positions"

#### Test 3: Price Updates

1. Wait 30 seconds
2. Refresh Supabase `positions` table
3. Check `current_price` and `unrealized_pnl_usd` updated
4. Dashboard should show updated P&L

#### Test 4: Close Position

1. Close the position:
   ```bash
   curl -X POST http://localhost:3000/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "secret": "your-secret",
       "action": "close",
       "symbol": "BTCUSDT"
     }'
   ```

2. Check Supabase:
   - Position removed from `positions` table
   - New trade in `trades` table with P&L

3. Check dashboard:
   - Position removed from "Open Positions"
   - Appears in "Recent Trades"

---

## 📊 Dashboard Features

### Real-Time Metrics

**Top Stats Cards:**
- Today's P&L (green/red)
- Win Rate %
- Open Positions Count
- Total Trades Today

**Open Positions Table:**
- Symbol
- Side (Long/Short)
- Entry Price
- Current Price
- Position Size
- Unrealized P&L ($)
- Unrealized P&L (%)
- Time Open

**Cumulative P&L Chart:**
- Line chart showing profit over time
- 7-day or 30-day views
- Green for profit, red for loss

**Recent Trades List:**
- Last 20 closed trades
- Symbol, side, P&L
- Time ago (relative)
- Color-coded wins/losses

### Auto-Refresh

Dashboard auto-refreshes every 30 seconds to show:
- Updated position prices
- New trades
- Real-time stats

---

## 🔍 Monitoring & Troubleshooting

### Check Bot Status

```bash
# Health check
curl http://localhost:3000/health | python -m json.tool

# Check positions
curl http://localhost:3000/positions | python -m json.tool
```

### Check Database Connection

```bash
# From bot logs
pm2 logs aster-bot | grep -i database
pm2 logs aster-bot | grep -i supabase

# Should see:
✅ Database connection successful
✅ Position saved to database: BTCUSDT
✅ Trade logged to database: abc123
```

### Common Issues

#### Issue 1: "Database not configured"

**Symptom:**
```
⚠️  Database not configured. Trades will not be logged to Supabase.
```

**Solution:**
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env`
- Restart bot: `pm2 restart aster-bot`

#### Issue 2: "Database connection failed"

**Symptom:**
```
❌ Database connection test failed
```

**Solution:**
- Check Supabase credentials are correct
- Verify Supabase project is not paused
- Check network connectivity from VPS
- Verify service role key (not anon key)

#### Issue 3: Position prices not updating

**Symptom:**
- Dashboard shows stale prices
- `last_price_update` in database is old

**Solution:**
- Check bot logs: `pm2 logs aster-bot | grep -i "Updating prices"`
- Restart bot if updater stopped
- Check for API rate limiting
- Verify exchange API is accessible

#### Issue 4: Dashboard shows "No data"

**Symptom:**
- Dashboard is blank or shows "No trades yet"

**Solution:**
- Check Supabase anon key in dashboard `.env`
- Verify RLS policies allow anon read access
- Check browser console for errors
- Verify bot has logged trades (check Supabase table directly)

---

## 📈 Performance Considerations

### Database Writes

**During Normal Operation:**
- Position saved: Once per trade open
- Position updated: Every 30 seconds (per open position)
- Trade logged: Once per trade close

**Example Load:**
- 5 open positions = 10 writes/minute (position updates)
- Low load on Supabase free tier ✅

### Dashboard Reads

**Per Page Load:**
- Fetch open positions: 1 query
- Fetch recent trades: 1 query
- Fetch today's stats: 1 query
- Fetch chart data: 1 query

**With Auto-Refresh (30s):**
- ~8 queries/minute per active user
- Supabase free tier: 50,000 reads/month ✅

---

## 🔐 Security Best Practices

### Bot (Server-Side):
- ✅ Use **SERVICE_ROLE_KEY** (full access)
- ✅ Store in `.env` file (not committed to git)
- ✅ Keep key secret - never expose publicly
- ✅ Rotate keys if compromised

### Dashboard (Client-Side):
- ✅ Use **ANON_KEY** (read-only access)
- ✅ Can be exposed in browser (RLS protects data)
- ✅ RLS policies allow SELECT only
- ✅ No write access from dashboard

### Row Level Security (RLS):
```sql
-- Already configured in schema

-- Service role: Full access
CREATE POLICY "Allow all for service_role" ON trades
  FOR ALL TO service_role USING (true);

-- Anon: Read-only
CREATE POLICY "Allow read for anon" ON trades
  FOR SELECT TO anon USING (true);
```

---

## 🎯 Next Steps

### Enhancements You Can Add:

1. **Telegram Notifications:**
   - Send alerts when trades open/close
   - Daily P&L summaries
   - Error notifications

2. **Advanced Analytics:**
   - Win rate by symbol
   - Best/worst performing pairs
   - Time-of-day performance
   - Monthly reports

3. **Multi-Bot Support:**
   - Add `bot_id` column to tables
   - Track multiple bot instances
   - Compare performance

4. **Backtesting Integration:**
   - Import historical trades
   - Compare live vs backtest results
   - Strategy validation

5. **Alerting System:**
   - Email alerts for large losses
   - Low balance warnings
   - Bot offline notifications

---

## 📞 Support

### Useful Links:
- Supabase Dashboard: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy
- Supabase Docs: https://supabase.com/docs
- Bot Health: http://your-vps-ip:3000/health
- Dashboard: http://localhost:3001/sparky-dashboard

### Quick Commands:

```bash
# Bot Status
pm2 status

# Bot Logs
pm2 logs aster-bot

# Database Tables
# Go to: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor

# Test Bot API
curl http://localhost:3000/health
curl http://localhost:3000/positions

# Dashboard Dev
cd c:\Users\mjjoh\TradeFI\tradefi
npm run dev
```

---

## ✅ Integration Checklist

### Bot Setup:
- [ ] Supabase schema created (ran SQL)
- [ ] Service role key added to `.env`
- [ ] Bot code updated and deployed
- [ ] Database connection test passed
- [ ] Position updater started

### Dashboard Setup:
- [ ] Chart.js installed (`npm install chart.js`)
- [ ] Supabase anon key in `.env` or `nuxt.config.ts`
- [ ] Bot URL configured (`SPARKY_BOT_URL`)
- [ ] Dashboard running (`npm run dev`)
- [ ] Can see Sparky dashboard page

### Testing:
- [ ] Test trade executed
- [ ] Position appears in database
- [ ] Position appears in dashboard
- [ ] Prices update every 30s
- [ ] Closed trade logged correctly
- [ ] Dashboard shows trade history

---

**Last Updated:** October 20, 2025  
**Status:** Production Ready ✅

Happy Trading with Real-Time Analytics! 🚀📊

