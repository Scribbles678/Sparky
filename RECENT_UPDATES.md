# Recent Updates - Sparky Trading Bot

**Date:** October 20, 2025

## 🎯 Issue Resolved

**Problem:** All TradingView alerts were trading ETHUSDT regardless of which chart they came from.

**Root Cause:** Alert message had hardcoded `"symbol": "ETHUSDT"` instead of using TradingView's dynamic `{{ticker}}` variable.

**Solution:** Updated alert messages to use `{{ticker}}` for universal ticker support.

---

## 🚀 New Features Added

### 1. **Enhanced Webhook Error Handling**
- ✅ Detects empty webhook bodies
- ✅ Provides helpful error messages
- ✅ Shows hints for fixing TradingView configuration
- ✅ Logs more debugging information

### 2. **Test Endpoint for Debugging**
- **Endpoint:** `POST /webhook/test`
- **Purpose:** See exactly what data your TradingView alert is sending
- **Usage:** Temporarily change webhook URL to test what's being received

Example:
```bash
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"secret":"test","action":"buy","symbol":"BTCUSDT"}'
```

### 3. **Automatic Symbol Cleanup**
- Handles `BINANCE:BTCUSDT` → `BTCUSDT`
- Handles `BYBIT:ETHUSDT` → `ETHUSDT`
- Strips exchange prefix automatically

### 4. **Flexible Action Types**
- Accepts `"action": "long"` → converts to `"buy"`
- Accepts `"action": "short"` → converts to `"sell"`
- Works with `{{strategy.order.action}}` variable

---

## 📝 Files Modified

1. **src/index.js**
   - Added empty body detection
   - Added exchange prefix stripping
   - Added action normalization (long→buy, short→sell)
   - Added test webhook endpoint
   - Enhanced error messages

2. **WEBHOOK_TROUBLESHOOTING.md** (NEW)
   - Complete troubleshooting guide
   - Common issues and solutions
   - Testing procedures
   - Alert message templates

3. **TRADINGVIEW_SETUP.md** (NEW)
   - Step-by-step setup guide
   - Alert message examples for your strategy
   - Dynamic variable reference
   - Multi-ticker strategy guide

---

## 🔧 What You Need to Do

### Step 1: Update Your Alert Messages

In your "Sparky Ajay" Pine Script, update the alert message inputs:

**Long Entry Message:**
```json
{
  "secret": "your-actual-webhook-secret",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

**Short Entry Message:**
```json
{
  "secret": "your-actual-webhook-secret",
  "action": "sell",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

**Key Changes:**
- ❌ OLD: `"symbol": "ETHUSDT"` (hardcoded)
- ✅ NEW: `"symbol": "{{ticker}}"` (dynamic)

### Step 2: Deploy Updated Code to VPS

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Navigate to bot directory
cd /opt/sparky-bot

# Save any local changes
git stash

# Pull latest updates
git pull origin main

# Restart the bot
pm2 restart aster-bot

# Watch the logs
pm2 logs aster-bot --lines 50
```

### Step 3: Test Your Setup

**Option A: Test with curl**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-actual-secret",
    "action": "buy",
    "symbol": "BTCUSDT",
    "stop_loss_percent": 1.5,
    "take_profit_percent": 4.0
  }'
```

Expected response:
```json
{
  "success": true,
  "action": "opened",
  "position": {...}
}
```

**Option B: Test with TradingView**
1. Create alert on BTCUSDT chart
2. Wait for signal or trigger manually
3. Check logs: `tail -f /opt/sparky-bot/logs/combined.log`

---

## 📊 Expected Log Output (Success)

When everything works correctly:

```json
{"level":"info","message":"Webhook received","symbol":"BTCUSDT","action":"buy","isEmpty":false}
{"level":"info","message":"Processing webhook","action":"buy","symbol":"BTCUSDT"}
{"level":"info","message":"Opening BUY position for BTCUSDT"}
{"level":"info","message":"Fetched current market price for BTCUSDT: 45000"}
{"level":"info","message":"Position size calculated: 0.002 at 45000 ($100 position)"}
{"level":"info","message":"Trade opened","type":"trade","action":"opened","symbol":"BTCUSDT"}
{"level":"info","message":"Stop loss placed at 44325","percent":1.5}
{"level":"info","message":"Take profit placed at 46800","percent":4.0}
{"level":"info","message":"Position opened successfully for BTCUSDT"}
```

---

## ⚠️ Important Notes

### Multi-Ticker Trading
Now that you're using `{{ticker}}`, each chart will trade its own symbol:
- **BTCUSDT chart** → Trades BTC ✅
- **ETHUSDT chart** → Trades ETH ✅
- **SOLUSDT chart** → Trades SOL ✅

Each can have **1 position open at a time** (no pyramiding per symbol).

### Position Limits
Your config allows up to **10 simultaneous positions** across different symbols. If you want to limit this, edit `config.json`:

```json
{
  "riskManagement": {
    "maxPositions": 3  // Limit to 3 symbols max
  }
}
```

### Risk Management
With multi-ticker trading:
- Each position is $100 (or your configured `tradeAmount`)
- 3 open positions = $300 total exposure
- 10 open positions = $1,000 total exposure

**Recommendation:** Start with lower `tradeAmount` or `maxPositions` until you're comfortable.

---

## 🎓 Learning Resources

- **TRADINGVIEW_SETUP.md** - Complete setup guide for your Pine Script
- **WEBHOOK_TROUBLESHOOTING.md** - Debug common webhook issues
- **README.md** - Full bot documentation

---

## 🚀 Next Steps

### Immediate:
1. ✅ Update TradingView alert messages with `{{ticker}}`
2. ✅ Deploy updated bot code
3. ✅ Test with 1 ticker first (BTCUSDT)
4. ✅ Verify in logs that correct symbol is being traded

### Soon:
- [ ] Set up Supabase integration for trade logging
- [ ] Add more tickers once comfortable
- [ ] Adjust position sizing if needed
- [ ] Monitor performance over 1-2 weeks

### Later (Optional):
- [ ] Implement trailing stops
- [ ] Add Telegram notifications
- [ ] Create dashboard for monitoring
- [ ] Set up alerts for bot errors

---

## 📈 Quick Commands Reference

**Check bot status:**
```bash
pm2 status
```

**View live logs:**
```bash
pm2 logs aster-bot
```

**Check bot health:**
```bash
curl http://localhost:3000/health | python -m json.tool
```

**View current positions:**
```bash
curl http://localhost:3000/positions | python -m json.tool
```

**Restart bot:**
```bash
pm2 restart aster-bot
```

**View last 50 log lines:**
```bash
tail -50 /opt/sparky-bot/logs/combined.log
```

---

## 🐛 If Something Goes Wrong

1. **Check logs first:**
   ```bash
   tail -50 /opt/sparky-bot/logs/error.log
   ```

2. **Test webhook format:**
   ```bash
   curl -X POST http://localhost:3000/webhook/test \
     -H "Content-Type: application/json" \
     -d '{"secret":"test","action":"buy","symbol":"BTCUSDT"}'
   ```

3. **Verify bot is running:**
   ```bash
   pm2 status
   ```

4. **Check API connection:**
   ```bash
   curl http://localhost:3000/health
   ```

5. **See detailed troubleshooting:**
   - Read `WEBHOOK_TROUBLESHOOTING.md`
   - Read `TRADINGVIEW_SETUP.md`

---

## 💡 Pro Tips

### Tip 1: Test with Small Amounts
Set `tradeAmount: 10` in config.json for testing.

### Tip 2: One Ticker at a Time
Get comfortable with one ticker before adding more.

### Tip 3: Monitor Regularly
Check logs daily: `pm2 logs aster-bot`

### Tip 4: Track Performance
Note your win rate and adjust TP/SL percentages accordingly.

### Tip 5: Use Alerts
Set up alerts for:
- Low balance
- Bot restart
- API connection issues

---

## 🎉 Success Criteria

You'll know everything is working when:
- ✅ Each ticker trades its own symbol (not all trading ETH)
- ✅ Logs show correct symbol names
- ✅ Positions open with correct TP/SL
- ✅ No "unauthorized" errors in logs
- ✅ Bot responds within 1-2 seconds to alerts

Happy Trading! 🚀

---

**Last Updated:** October 20, 2025  
**Bot Version:** 1.0.0  
**Status:** Production Ready ✅

