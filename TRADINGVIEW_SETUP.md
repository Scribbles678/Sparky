# TradingView Alert Setup for Sparky Trading Bot

## Quick Setup Guide

### Step 1: Update Your Pine Script Alert Messages

In your **Sparky Ajay** strategy, locate the "Alerts" section inputs and paste these:

#### Long Entry Message:
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

#### Short Entry Message:
```json
{
  "secret": "your-webhook-secret-here",
  "action": "sell",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

**Important Notes:**
- Replace `your-webhook-secret-here` with your actual webhook secret from your `.env` file
- `{{ticker}}` will automatically use the chart's symbol (BTCUSDT, ETHUSDT, etc.)
- The SL/TP percentages (1.5% and 4.0%) match your Pine Script settings

---

### Step 2: Create Alert in TradingView

1. **Add your strategy** to any chart (BTC, ETH, SOL, etc.)
2. **Click the Alert button** (clock icon) or press `Alt+A`
3. **Configure the alert:**
   - **Condition:** Select your strategy → "Any alert() function call"
   - **Webhook URL:** `http://your-vps-ip:3000/webhook` or `http://your-domain.com/webhook`
   - **Message:** Can be left empty if you configured it in Pine Script inputs, OR paste the message here

4. **Name your alert:** e.g., "Sparky - BTCUSDT" (optional, for organization)
5. **Click Create**

---

### Step 3: Test Your Setup

#### Test with a Single Ticker First

1. Create alert on **BTCUSDT** chart
2. Wait for signal or manually trigger
3. Check your bot logs:
   ```bash
   tail -f /opt/sparky-bot/logs/combined.log
   ```

4. You should see:
   ```json
   {"message":"Webhook received","symbol":"BTCUSDT","action":"buy"}
   {"message":"Opening BUY position for BTCUSDT"}
   {"message":"Position opened successfully for BTCUSDT"}
   ```

#### Then Add More Tickers

Once confirmed working:
- Repeat for ETHUSDT, SOLUSDT, etc.
- Each chart will automatically use its own symbol
- No need to modify the alert message!

---

## Dynamic Variables Available

TradingView provides these variables you can use:

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{{ticker}}` | Current chart symbol | BTCUSDT |
| `{{exchange}}` | Exchange name | BINANCE |
| `{{close}}` | Close price | 45000.50 |
| `{{open}}` | Open price | 44950.25 |
| `{{high}}` | High price | 45100.00 |
| `{{low}}` | Low price | 44900.00 |
| `{{volume}}` | Volume | 1234.56 |
| `{{time}}` | Bar timestamp | 1708444800 |
| `{{timenow}}` | Current time | 2024-10-20T19:00:00Z |
| `{{strategy.order.action}}` | Order action from strategy | buy, sell |
| `{{strategy.position_size}}` | Current position size | 0.001 |

---

## Advanced: Using Strategy Variables

If you want TradingView to automatically determine buy/sell based on your strategy:

```json
{
  "secret": "your-webhook-secret-here",
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

This will automatically send "buy" or "sell" based on whether your strategy enters long or short.

---

## Matching Your Pine Script Settings

Your current strategy settings:
- **Take Profit:** 4.0% (tpPercent)
- **Stop Loss:** 1.5% (slPercent)
- **Trailing Stop:** 1.5% (optional - bot doesn't support this yet)
- **Position Size:** 10% of equity (this is handled by `tradeAmount` in bot config)

Make sure your webhook message matches these:
```json
{
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

---

## Troubleshooting

### ❌ Problem: Still trading wrong symbol

**Check:**
1. Make sure you're using `{{ticker}}` not hardcoded "ETHUSDT"
2. Check the bot logs to see what symbol it received
3. Test with curl:
   ```bash
   curl -X POST http://localhost:3000/webhook/test \
     -H "Content-Type: application/json" \
     -d '{"secret":"test","action":"buy","symbol":"BTCUSDT"}'
   ```

### ❌ Problem: Symbol format issues

The bot now automatically handles:
- `BINANCE:BTCUSDT` → `BTCUSDT` ✅
- `BYBIT:ETHUSDT` → `ETHUSDT` ✅
- `BTC/USDT` → Works as-is (but might not match exchange format)

If your exchange uses different format, check the exchange API documentation.

### ❌ Problem: Wrong action (long vs buy)

The bot now automatically converts:
- `"action": "long"` → `"buy"` ✅
- `"action": "short"` → `"sell"` ✅

---

## Example Alert Messages for Different Scenarios

### Scenario 1: Basic Market Order (Recommended)
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

### Scenario 2: Using Dynamic Strategy Action
```json
{
  "secret": "your-webhook-secret-here",
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

### Scenario 3: Limit Order with Dynamic Price
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "limit",
  "price": {{close}},
  "stop_loss_percent": 1.5,
  "take_profit_percent": 4.0
}
```

### Scenario 4: Close Position Only
```json
{
  "secret": "your-webhook-secret-here",
  "action": "close",
  "symbol": "{{ticker}}"
}
```

### Scenario 5: Aggressive (Higher Risk/Reward)
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 2.5,
  "take_profit_percent": 7.5
}
```

### Scenario 6: Conservative (Lower Risk/Reward)
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 2.0
}
```

---

## Multi-Ticker Strategy

Since your bot only keeps **1 position open at a time per symbol**, you can run alerts on multiple tickers simultaneously:

### Example Setup:
1. **BTCUSDT chart** → Alert with strategy → Uses `{{ticker}}` → Trades BTC
2. **ETHUSDT chart** → Alert with strategy → Uses `{{ticker}}` → Trades ETH
3. **SOLUSDT chart** → Alert with strategy → Uses `{{ticker}}` → Trades SOL

Each ticker runs independently! ✅

### ⚠️ Important Note:
Your bot config has `maxPositions: 10`, so you can have up to 10 different symbols open at once. But each symbol can only have 1 position (no pyramiding).

If you want to limit total positions, modify `config.json`:
```json
{
  "riskManagement": {
    "maxPositions": 3  // Only 3 symbols at once
  }
}
```

---

## Checklist Before Going Live

- [ ] Updated Pine Script alert messages with `{{ticker}}`
- [ ] Replaced `your-webhook-secret-here` with actual secret
- [ ] Tested on 1 ticker (BTCUSDT) first
- [ ] Verified bot logs show correct symbol
- [ ] Checked positions with `curl http://localhost:3000/positions`
- [ ] Started with small position size (`tradeAmount: 10` or less)
- [ ] Deployed updated bot code to VPS
- [ ] Restarted bot with `pm2 restart aster-bot`
- [ ] Monitoring logs: `pm2 logs aster-bot`

---

## Quick Reference: Bot Configuration

Your `config.json` should look like:
```json
{
  "tradeAmount": 100,
  "webhookSecret": "same-as-your-tradingview-secret",
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  },
  "riskManagement": {
    "maxPositions": 10
  }
}
```

Where:
- `tradeAmount`: Position size in USD (e.g., 100 = $100 per trade)
- `maxPositions`: Max number of different symbols you can trade at once

---

## Support

If you need help:
1. Check logs: `tail -50 /opt/sparky-bot/logs/combined.log`
2. Test endpoint: `curl http://localhost:3000/webhook/test -X POST -H "Content-Type: application/json" -d '{"test":"data"}'`
3. Health check: `curl http://localhost:3000/health`
4. See `WEBHOOK_TROUBLESHOOTING.md` for detailed debugging

Happy Trading! 🚀

