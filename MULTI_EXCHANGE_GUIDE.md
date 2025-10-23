# Multi-Exchange Trading Bot Guide

## 🎯 Overview

Your Sparky bot now supports **multiple exchanges simultaneously**! Trade crypto on Aster DEX, forex on OANDA, and stocks/options on Tradier (coming soon) - all from ONE bot.

---

## 🏗️ Architecture

```
TradingView Alerts → Sparky Bot → Routes to Exchange
                         ↓
        ┌────────────────┼────────────────┐
        ↓                ↓                 ↓
   Aster DEX         OANDA API       Tradier API
  (Crypto Futures)   (Forex/CFDs)  (Stocks/Options)
        ↓                ↓                 ↓
        All tracked in unified dashboard
```

---

## 📋 Configuration

### config.json Structure

```json
{
  "tradeAmount": 100,
  "webhookSecret": "your-secret-token",
  
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "YOUR_ASTER_API_KEY",
    "apiSecret": "YOUR_ASTER_API_SECRET"
  },
  
  "oanda": {
    "accountId": "YOUR_OANDA_ACCOUNT_ID",
    "accessToken": "YOUR_OANDA_ACCESS_TOKEN",
    "environment": "practice"
  },
  
  "tradier": {
    "accountId": "YOUR_TRADIER_ACCOUNT_ID",
    "accessToken": "YOUR_TRADIER_ACCESS_TOKEN",
    "environment": "sandbox"
  },
  
  "riskManagement": {
    "maxPositions": 10
  }
}
```

### Notes:
- ✅ **Configure only the exchanges you want to use**
- ✅ Bot initializes all configured exchanges on startup
- ✅ Each exchange is optional (you can use just one or all)
- ✅ `tradeAmount` applies to all exchanges ($100 per position)

---

## 🔔 TradingView Alert Format

### Key Addition: `exchange` Field

Now specify which exchange to use in your alert message:

```json
{
  "secret": "your-webhook-secret",
  "exchange": "aster",
  "action": "buy",
  "symbol": "BTCUSDT",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

### Examples for Each Exchange:

#### Aster DEX (Crypto)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "buy",
  "symbol": "BTCUSDT",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

#### OANDA (Forex)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}
```

#### Tradier (Stocks) - Coming Soon
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "tradier",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0
}
```

### Default Behavior:
If you **omit** the `exchange` field, it defaults to **"aster"**:
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "action": "buy",
  "symbol": "BTCUSDT"
}
```
This will execute on Aster DEX (for backward compatibility).

---

## 📊 Symbol Formats by Exchange

| Exchange | Symbol Format | Examples |
|----------|--------------|----------|
| **Aster** | CRYPTO**USDT** | BTCUSDT, ETHUSDT, SOLUSDT |
| **OANDA** | BASE**_**QUOTE | EUR_USD, GBP_USD, USD_JPY |
| **Tradier** | TICKER | AAPL, TSLA, SPY |

---

## 🎯 Position Tracking

The bot tracks positions per exchange + symbol:
- **Aster: BTCUSDT** → Independent position
- **OANDA: EUR_USD** → Independent position
- **Tradier: AAPL** → Independent position

### You Can Have:
- ✅ **BTCUSDT** on Aster + **EUR_USD** on OANDA (different symbols)
- ✅ **BTCUSDT** on Aster + **BTCUSD** on OANDA (different exchanges)
- ❌ **Two BTCUSDT** on Aster (only one per symbol per exchange)

---

## 🔄 Auto-Reverse Feature

Works independently on each exchange:

**Aster DEX:**
- Long BTCUSDT → Short signal → Closes long, opens short ✅

**OANDA (same time):**
- Short EUR_USD → Long signal → Closes short, opens long ✅

**Both positions flip independently!**

---

## 🚀 Getting Started

### 1. Get API Credentials

#### Aster DEX
1. Go to https://www.asterdex.com/
2. Create account
3. Generate API key with **Trading** permissions
4. Copy API Key and Secret

#### OANDA
1. Go to https://www.oanda.com/
2. Create practice or live account
3. Login to Account Management Portal
4. Generate Personal Access Token
5. Copy Account ID and Token

#### Tradier (Coming Soon)
1. Go to https://tradier.com/
2. Create sandbox or live account
3. Generate API token
4. Copy Account ID and Token

### 2. Update config.json

Add credentials for exchanges you want to use:

```bash
nano /opt/sparky-bot/config.json
```

### 3. Restart Bot

```bash
pm2 restart aster-bot
pm2 logs aster-bot --lines 30
```

### 4. Verify Initialization

You should see:
```
✅ ASTER API initialized
✅ OANDA API initialized
✅ aster executor initialized
✅ oanda executor initialized
Configured exchanges: aster, oanda
```

---

## 🧪 Testing Multi-Exchange

### Test Aster DEX:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-secret",
    "exchange": "aster",
    "action": "buy",
    "symbol": "BTCUSDT",
    "stop_loss_percent": 1.5,
    "take_profit_percent": 4.0
  }'
```

### Test OANDA:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-secret",
    "exchange": "oanda",
    "action": "buy",
    "symbol": "EUR_USD",
    "stop_loss_percent": 0.5,
    "take_profit_percent": 1.5
  }'
```

### Check Positions:
```bash
curl http://localhost:3000/positions | jq
```

Should show positions from all exchanges.

---

## 📝 TradingView Pine Script Examples

### Crypto Strategy (Aster)
```javascript
//@version=5
strategy("Crypto Strategy", overlay=true)

// Your strategy logic
longSignal = ta.crossover(ta.sma(close, 20), ta.sma(close, 50))
shortSignal = ta.crossunder(ta.sma(close, 20), ta.sma(close, 50))

if longSignal
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-secret","exchange":"aster","action":"buy","symbol":"{{ticker}}","stop_loss_percent":1.5,"take_profit_percent":4.0}')

if shortSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-secret","exchange":"aster","action":"sell","symbol":"{{ticker}}","stop_loss_percent":1.5,"take_profit_percent":4.0}')
```

### Forex Strategy (OANDA)
```javascript
//@version=5
strategy("Forex Strategy", overlay=true)

// Your forex strategy
longSignal = ta.crossover(ta.rsi(close, 14), 30)
shortSignal = ta.crossunder(ta.rsi(close, 14), 70)

if longSignal
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-secret","exchange":"oanda","action":"buy","symbol":"{{ticker}}","stop_loss_percent":0.5,"take_profit_percent":1.5}')

if shortSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-secret","exchange":"oanda","action":"sell","symbol":"{{ticker}}","stop_loss_percent":0.5,"take_profit_percent":1.5}')
```

---

## 🔍 Monitoring

### Check Bot Status
```bash
pm2 status
```

### View Logs (All Exchanges)
```bash
pm2 logs aster-bot
```

### Filter by Exchange
```bash
# Aster trades only
grep "ASTER" /opt/sparky-bot/logs/combined.log | tail -20

# OANDA trades only
grep "OANDA" /opt/sparky-bot/logs/combined.log | tail -20
```

### Check Specific Exchange Health
```bash
curl http://localhost:3000/health | jq
```

---

## ⚠️ Important Notes

### Position Limits
- `maxPositions: 10` applies **across all exchanges**
- If you have 5 positions on Aster and 5 on OANDA = 10 total
- Adjust in `config.json` if needed

### Trade Amount
- `tradeAmount: 100` applies to **all exchanges**
- All trades are $100 positions (or your configured amount)
- Can't set different amounts per exchange yet

### Risk Management
**Example with $1000 account:**
- 10 positions × $100 each = $1000 total exposure
- Spread across exchanges: 5 Aster + 5 OANDA
- Diversified across crypto and forex

### Auto-Sync
- Runs every 5 minutes on **all exchanges**
- Detects closed positions on each exchange
- Logs trades per exchange to Supabase

---

## 🎓 Best Practices

### 1. Start with Practice Accounts
- ✅ Aster DEX: Use small amounts
- ✅ OANDA: Use practice account first
- ✅ Tradier: Use sandbox account

### 2. Test One Exchange at a Time
1. Configure Aster only → Test
2. Add OANDA → Test
3. Add Tradier → Test

### 3. Use Different Strategies
- **Aster**: Trend-following crypto
- **OANDA**: Mean-reversion forex
- **Tradier**: Swing trading stocks

### 4. Monitor Regularly
```bash
# Check positions across all exchanges
curl http://localhost:3000/positions | jq

# View today's trades
grep "closed:" /opt/sparky-bot/logs/combined.log | grep $(date +%Y-%m-%d)
```

---

## 🐛 Troubleshooting

### "Exchange not configured" Error
**Problem:** Bot doesn't recognize the exchange.

**Solution:** 
1. Check `config.json` has the exchange section
2. Verify credentials are correct
3. Restart bot: `pm2 restart aster-bot`

### No Positions Showing for OANDA
**Problem:** OANDA positions not tracked.

**Solution:**
1. Check OANDA credentials in config
2. Verify account ID is correct
3. Check logs: `grep "OANDA" /opt/sparky-bot/logs/combined.log`

### Symbol Format Errors
**Problem:** "Invalid symbol" error.

**Solutions:**
- **Aster**: Use `BTCUSDT` (not `BTC-USDT`)
- **OANDA**: Use `EUR_USD` (underscore, not slash)
- **Tradier**: Use `AAPL` (uppercase ticker)

---

## 🚀 Coming Soon

### Tradier Integration
Stock and options trading support is coming! Features will include:
- ✅ Stock market orders
- ✅ Options trading
- ✅ Market hours checking
- ✅ Extended hours support

### Per-Exchange Settings
```json
{
  "exchanges": {
    "aster": {
      "tradeAmount": 100,
      "maxPositions": 5
    },
    "oanda": {
      "tradeAmount": 50,
      "maxPositions": 3
    }
  }
}
```

---

## 📞 Support

**Issues?**
1. Check logs: `pm2 logs aster-bot`
2. Test webhook: `curl http://localhost:3000/webhook/test`
3. Verify config: `cat /opt/sparky-bot/config.json`

**Happy Multi-Exchange Trading!** 🎯📈🚀

