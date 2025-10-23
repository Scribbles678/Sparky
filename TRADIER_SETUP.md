# Tradier Integration Guide

## 🎯 Overview

Trade **stocks, ETFs, and options** on Tradier directly from TradingView alerts! Your Sparky bot now supports equities trading alongside crypto and forex.

**Documentation**: https://docs.tradier.com/docs/getting-started

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Create Tradier Account

1. Go to https://tradier.com/
2. Sign up for an account:
   - **Sandbox** (recommended for testing) - Free, paper trading
   - **Live** - Real money trading

### Step 2: Get Your API Token

1. Login to https://dash.tradier.com/settings/api
2. Generate your API token:
   - **Sandbox Token** - For testing
   - **Production Token** - For live trading
3. Copy your:
   - **Account ID** (e.g., `VA12345678`)
   - **Access Token** (long string starting with `Bearer`)

### Step 3: Update config.json

Add Tradier section to your `/opt/sparky-bot/config.json`:

```json
{
  "tradeAmount": 100,
  "webhookSecret": "your-secret",
  
  "aster": {
    "apiKey": "your-aster-key",
    "apiSecret": "your-aster-secret",
    "apiUrl": "https://fapi.asterdex.com"
  },
  
  "tradier": {
    "accountId": "VA12345678",
    "accessToken": "YOUR_TRADIER_ACCESS_TOKEN",
    "environment": "sandbox"
  }
}
```

**Environments:**
- `"sandbox"` - Paper trading (default, recommended for testing)
- `"live"` - Real money trading

### Step 4: Restart Bot

```bash
cd /opt/sparky-bot
git pull origin main
pm2 restart aster-bot
pm2 logs aster-bot --lines 20
```

You should see:
```
✅ TRADIER API initialized
Configured exchanges: aster, tradier
```

---

## 📋 TradingView Alert Format

### Basic Stock Trade

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "tradier",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0
}
```

### Important Notes:

**Symbol Format:**
- ✅ Use ticker symbols: `AAPL`, `TSLA`, `SPY`, `QQQ`
- ✅ Uppercase recommended
- ❌ No suffixes or special characters

**Quantity Calculation:**
- Automatically calculates **whole shares** only
- Example: $100 position ÷ $150/share = 0.66 → **0 shares** (rounds down)
- Example: $500 position ÷ $150/share = 3.33 → **3 shares**

**Minimum Position:**
- Make sure `tradeAmount` is high enough to buy at least 1 share
- For high-priced stocks (like TSLA, NVDA), increase `tradeAmount`

---

## 🎯 Strategy Examples

### Day Trading Strategy (Market Hours Only)

```javascript
//@version=5
strategy("Day Trading - Stocks", overlay=true)

// Your day trading logic
rsi = ta.rsi(close, 14)

longCondition = ta.crossover(rsi, 30)
shortCondition = ta.crossunder(rsi, 70)

if longCondition
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-secret","exchange":"tradier","action":"buy","symbol":"{{ticker}}","stop_loss_percent":2,"take_profit_percent":5}')

if shortCondition
    strategy.close("Long")
    alert('{"secret":"your-secret","exchange":"tradier","action":"close","symbol":"{{ticker}}"}')
```

### Swing Trading Strategy (Multi-Day)

```javascript
//@version=5
strategy("Swing Trading - Stocks", overlay=true)

// Moving average crossover
fastMA = ta.sma(close, 10)
slowMA = ta.sma(close, 30)

longSignal = ta.crossover(fastMA, slowMA)
shortSignal = ta.crossunder(fastMA, slowMA)

if longSignal
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-secret","exchange":"tradier","action":"buy","symbol":"{{ticker}}","stop_loss_percent":3,"take_profit_percent":10}')

if shortSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-secret","exchange":"tradier","action":"sell","symbol":"{{ticker}}","stop_loss_percent":3,"take_profit_percent":10}')
```

---

## 🕒 Market Hours

### Stock Market Hours (Eastern Time):
- **Regular**: 9:30 AM - 4:00 PM ET
- **Pre-Market**: 8:00 AM - 9:30 AM ET (some brokers)
- **After-Hours**: 4:00 PM - 8:00 PM ET (some brokers)

### Trading Considerations:
- ✅ Orders placed during market hours execute immediately
- ⚠️ Orders placed outside hours are queued for market open
- ✅ Tradier supports extended hours (check your account)
- 📅 Markets closed: Weekends, US holidays

### Check Market Status:
```bash
curl -X GET "https://api.tradier.com/v1/markets/clock" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Accept: application/json"
```

---

## 💡 Position Sizing for Stocks

### How It Works:

**Example 1: Affordable Stock (AAPL @ $150)**
```
tradeAmount: $500
Stock Price: $150
Calculation: $500 ÷ $150 = 3.33 shares
Rounded: 3 shares (whole shares only)
Actual Position: 3 × $150 = $450
```

**Example 2: Expensive Stock (NVDA @ $450)**
```
tradeAmount: $500
Stock Price: $450
Calculation: $500 ÷ $450 = 1.11 shares
Rounded: 1 share
Actual Position: 1 × $450 = $450
```

**Example 3: Too Expensive (TSLA @ $250 with $100 position)**
```
tradeAmount: $100
Stock Price: $250
Calculation: $100 ÷ $250 = 0.4 shares
Rounded: 0 shares ❌
Result: Trade rejected (can't buy fractional shares)
```

### Recommendations:
- **Low-priced stocks** ($5-$50): `tradeAmount: 100-500`
- **Mid-priced stocks** ($50-$200): `tradeAmount: 500-1000`
- **High-priced stocks** ($200+): `tradeAmount: 1000+` or use cheaper alternatives

---

## 🧪 Testing Your Setup

### Test 1: Check Market Status
```bash
curl -X GET "https://sandbox.tradier.com/v1/markets/clock" \
     -H "Authorization: Bearer YOUR_SANDBOX_TOKEN" \
     -H "Accept: application/json"
```

### Test 2: Get Account Balance
```bash
curl -X GET "https://sandbox.tradier.com/v1/accounts/YOUR_ACCOUNT_ID/balances" \
     -H "Authorization: Bearer YOUR_SANDBOX_TOKEN" \
     -H "Accept: application/json"
```

### Test 3: Get Stock Quote
```bash
curl -X GET "https://sandbox.tradier.com/v1/markets/quotes?symbols=AAPL" \
     -H "Authorization: Bearer YOUR_SANDBOX_TOKEN" \
     -H "Accept: application/json"
```

### Test 4: Place Test Order via Bot
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-secret",
    "exchange": "tradier",
    "action": "buy",
    "symbol": "AAPL",
    "stop_loss_percent": 2,
    "take_profit_percent": 5
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "action": "opened",
  "position": {
    "symbol": "AAPL",
    "side": "BUY",
    "quantity": 3,
    "entryPrice": 150.25,
    "orderId": "12345"
  }
}
```

---

## 📊 Popular Stock Symbols

### Tech Stocks (FAANG+)
- **AAPL** - Apple
- **MSFT** - Microsoft
- **GOOGL** - Google
- **AMZN** - Amazon
- **META** - Meta (Facebook)
- **NVDA** - NVIDIA
- **TSLA** - Tesla

### Index ETFs
- **SPY** - S&P 500
- **QQQ** - NASDAQ 100
- **DIA** - Dow Jones
- **IWM** - Russell 2000

### Sector ETFs
- **XLF** - Financials
- **XLE** - Energy
- **XLK** - Technology
- **XLV** - Healthcare

---

## 🔍 Monitoring Tradier Trades

### View All Positions
```bash
curl http://localhost:3000/positions | jq
```

### Filter Tradier Only
```bash
grep "TRADIER" /opt/sparky-bot/logs/combined.log | tail -20
```

### Check Open Orders
```bash
curl -X GET "https://sandbox.tradier.com/v1/accounts/YOUR_ACCOUNT_ID/orders" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Accept: application/json"
```

---

## ⚠️ Important Differences: Stocks vs Crypto

| Feature | Crypto (Aster) | Stocks (Tradier) |
|---------|---------------|------------------|
| **Trading Hours** | 24/7 | 9:30 AM - 4:00 PM ET |
| **Weekends** | Open | Closed |
| **Holidays** | Open | Closed |
| **Shares** | Fractional (0.001) | Whole shares only |
| **Leverage** | Up to 125x | Up to 2x (margin) |
| **Settlement** | Instant | T+2 (2 days) |
| **Pattern Day Trading** | No rules | <$25k account limited |

### Pattern Day Trading Rule (PDT):
- **Applies to**: Accounts under $25,000
- **Limit**: 3 day trades per 5 trading days
- **Day Trade**: Buy and sell same stock in same day
- **Workaround**: Use swing trading (hold overnight)

---

## 🐛 Troubleshooting

### "Market is Closed" Error
**Problem**: Order placed outside market hours.

**Solutions:**
1. Wait for market open (9:30 AM ET)
2. Use extended hours (if your account supports)
3. Check market calendar:
```bash
curl https://sandbox.tradier.com/v1/markets/calendar
```

### "Insufficient Funds" Error
**Problem**: Not enough buying power.

**Solution:** Check your balance:
```bash
curl https://sandbox.tradier.com/v1/accounts/YOUR_ACCOUNT_ID/balances
```

### "0 Shares Calculated" Error
**Problem**: Stock too expensive for `tradeAmount`.

**Solution:** Increase `tradeAmount` in config.json or choose cheaper stocks.

### "PDT Rule Violation"
**Problem**: Too many day trades with <$25k account.

**Solutions:**
1. Deposit to reach $25k
2. Switch to swing trading (hold overnight)
3. Space out trades (max 3 per 5 days)

---

## 🎓 Best Practices

### 1. Start with Sandbox
- ✅ Always test with sandbox first
- ✅ Verify your strategies work
- ✅ Then switch to live: `"environment": "live"`

### 2. Position Sizing
```json
{
  "tradeAmount": 500,  // Enough for 1-3 shares of most stocks
}
```

### 3. Stop Losses for Stocks
- **Tech stocks**: 2-3% (volatile)
- **Blue chips**: 1-2% (stable)
- **Penny stocks**: 5-10% (very volatile)

### 4. Watch Market Hours
- Set TradingView alerts to only fire during market hours
- Or accept that orders will queue until market open

### 5. Monitor PDT
- Track your day trades if under $25k
- Use swing strategies to avoid PDT issues

---

## 📈 Going Live

### Sandbox to Production Checklist:

- [ ] Tested all strategies in sandbox
- [ ] Verified position sizing works
- [ ] Checked account has sufficient funds
- [ ] Understand PDT rules (if <$25k)
- [ ] Generated production API token
- [ ] Updated config.json:
  ```json
  {
    "tradier": {
      "accountId": "YOUR_LIVE_ACCOUNT_ID",
      "accessToken": "YOUR_PRODUCTION_TOKEN",
      "environment": "live"
    }
  }
  ```
- [ ] Restarted bot: `pm2 restart aster-bot`
- [ ] Started with small positions
- [ ] Monitoring closely for first week

---

## 🚀 Multi-Asset Trading Example

Trade crypto, forex, AND stocks from one bot:

**Crypto (Volatile, 24/7):**
```json
{"exchange":"aster","symbol":"BTCUSDT","stop_loss_percent":2,"take_profit_percent":5}
```

**Forex (Medium volatility, 24/5):**
```json
{"exchange":"oanda","symbol":"EUR_USD","stop_loss_percent":0.5,"take_profit_percent":1.5}
```

**Stocks (Lower volatility, Market hours):**
```json
{"exchange":"tradier","symbol":"AAPL","stop_loss_percent":2,"take_profit_percent":5}
```

**Diversification across all three markets!** 🎯

---

## 📞 Support

**Tradier Support:**
- Email: [email protected]
- Docs: https://docs.tradier.com/
- Status: https://status.tradier.com/

**Bot Issues:**
```bash
pm2 logs aster-bot
tail -50 /opt/sparky-bot/logs/combined.log
```

---

**Happy Stock Trading!** 📈🚀

*Disclaimer: Stock trading involves significant risk. Start with sandbox/paper trading and only risk capital you can afford to lose.*

