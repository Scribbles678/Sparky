# Quick Start Guide - Sparky Trading Bot

Get your trading bot up and running in 5 minutes!

## Prerequisites

- Node.js v18+ installed
- Aster DEX API credentials
- Basic understanding of trading

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Setup Environment

Create your `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
NODE_ENV=development
PORT=3000
ASTER_API_KEY=your_api_key_here
ASTER_API_SECRET=your_api_secret_here
ASTER_API_URL=https://api.aster.finance
WEBHOOK_SECRET=create_a_random_secure_string
LOG_LEVEL=info
```

**Important**: Generate a strong random string for `WEBHOOK_SECRET`. You can use:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 3: Configure Trading Parameters

Create your `config.json`:

```bash
cp config.json.example config.json
```

Edit `config.json`:

```json
{
  "tradeAmount": 10,
  "leverage": {
    "BTCUSDT": 5,
    "ETHUSDT": 5,
    "SOLUSDT": 3,
    "default": 2
  },
  "webhookSecret": "same_as_your_env_file",
  "aster": {
    "apiUrl": "https://api.aster.finance",
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET"
  },
  "riskManagement": {
    "maxPositions": 5,
    "minMarginPercent": 30
  }
}
```

**⚠️ Start with small amounts!** Set `tradeAmount` to $10-20 for initial testing.

## Step 4: Start the Bot

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

You should see:
```
🚀 Sparky Trading Bot started on port 3000
✅ API connection successful. Available margin: $XXX.XX
```

## Step 5: Test the Bot

Open a new terminal and run the test script:

```bash
npm test
```

Or test manually:

### Check health
```bash
curl http://localhost:3000/health
```

### Test webhook (manual)
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-webhook-secret",
    "action": "buy",
    "symbol": "BTCUSDT",
    "order_type": "market",
    "stop_loss_percent": 2.0,
    "take_profit_percent": 5.0,
    "price": 45000
  }'
```

## Step 6: Setup TradingView Alerts

### Example Alert Message for BUY/SELL

In TradingView, create an alert with this webhook message:

```json
{
  "secret": "your-webhook-secret",
  "action": "buy",
  "symbol": "BTCUSDT",
  "order_type": "market",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0,
  "price": {{close}}
}
```

### Example Alert Message for CLOSE

```json
{
  "secret": "your-webhook-secret",
  "action": "close",
  "symbol": "BTCUSDT"
}
```

### Dynamic Fields in TradingView

You can use these placeholders:
- `{{close}}` - Current close price
- `{{ticker}}` - Symbol (e.g., "BTCUSDT")
- `{{timenow}}` - Current timestamp

## Understanding the Logs

The bot creates three log files in the `logs/` directory:

1. **combined.log** - All activity
2. **error.log** - Errors only
3. **trades.log** - Trade execution details

View live logs:
```bash
# On Linux/Mac
tail -f logs/combined.log

# On Windows PowerShell
Get-Content logs/combined.log -Wait -Tail 50
```

## Trading Logic Flow

Here's what happens when a webhook is received:

1. ✅ **Validate** webhook secret
2. ✅ **Check** if position exists for symbol
3. 🔄 **Close** existing position if found
4. 💰 **Calculate** position size (amount × leverage ÷ price)
5. 📈 **Open** new position (market or limit order)
6. 🛡️ **Place** stop loss order
7. 🎯 **Place** take profit order (optional)
8. 📊 **Track** position in memory

## Common Issues & Solutions

### ❌ "Missing API credentials"
- Make sure `.env` file exists and has `ASTER_API_KEY` and `ASTER_API_SECRET`
- Values should not have quotes or spaces

### ❌ "Insufficient margin"
- Check your available balance on Aster
- Reduce `tradeAmount` in config.json
- Lower leverage values

### ❌ "Unauthorized webhook"
- Verify `WEBHOOK_SECRET` matches in both .env and TradingView alert
- Check for extra spaces or characters

### ❌ "Port 3000 already in use"
- Change `PORT` in .env to different number (e.g., 3001)
- Or stop the process using port 3000

### ❌ API connection fails
- Verify API credentials are correct
- Check if Aster API is accessible
- Test: `curl https://api.aster.finance/fapi/v1/ping`

## Safety Tips

### For Testing
- ✅ Start with **small amounts** ($10-20)
- ✅ Use **low leverage** (2x-3x)
- ✅ Test with **one symbol** first
- ✅ Monitor for **24-48 hours** before increasing size
- ✅ Keep `minMarginPercent` at 30-50% initially

### For Production
- ✅ Never risk more than you can afford to lose
- ✅ Always use stop losses
- ✅ Monitor the bot regularly
- ✅ Keep leverage reasonable (5-10x max)
- ✅ Diversify across symbols
- ✅ Review logs daily

## Next Steps

### Local Testing Complete?
1. Review logs to ensure everything works
2. Verify positions are tracked correctly
3. Test closing positions manually

### Ready for Production?
1. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for DigitalOcean setup
2. Setup SSL certificate for security
3. Configure monitoring and alerts
4. Start with small amounts even in production

## API Endpoints

Your bot exposes these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Bot status and balance |
| `/positions` | GET | Current open positions |
| `/positions/sync` | POST | Sync with exchange |
| `/webhook` | POST | TradingView alerts |

## Monitoring

### Check bot status
```bash
curl http://localhost:3000/health | python -m json.tool
```

### View positions
```bash
curl http://localhost:3000/positions | python -m json.tool
```

### Sync positions (after manual trades)
```bash
curl -X POST http://localhost:3000/positions/sync | python -m json.tool
```

## Development Tips

### Auto-reload on code changes
```bash
npm run dev
```

### Check for syntax errors
```bash
node --check src/index.js
```

### View all npm scripts
```bash
npm run
```

## Need Help?

1. Check logs: `logs/error.log`
2. Test webhook: `npm test`
3. Verify API: Check Aster API status
4. Review [README.md](README.md) for detailed docs
5. See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup

## Configuration Reference

### Leverage Settings
- Lower leverage = Lower risk, smaller profits/losses
- Higher leverage = Higher risk, larger profits/losses
- Recommendation: Start with 2-5x

### Trade Amount
- Fixed dollar amount per trade
- Example: $100 with 10x leverage = $1000 position
- Start small, increase gradually

### Stop Loss Percent
- Sent from TradingView in each alert
- Example: 2.0 means 2% from entry
- Typical range: 1-5%

### Take Profit Percent
- Optional profit target
- Example: 5.0 means 5% profit target
- Typical range: 3-10%

## Example Workflow

1. **Morning**: Check bot health and positions
   ```bash
   curl http://localhost:3000/health
   ```

2. **TradingView sends signal** → Webhook received

3. **Bot executes**:
   - Validates signal
   - Closes old position if exists
   - Opens new position
   - Sets stop loss
   - Sets take profit

4. **Monitor**: Watch logs for execution
   ```bash
   tail -f logs/trades.log
   ```

5. **Evening**: Review day's trades and P&L

---

**Remember**: This bot trades real money. Always:
- ✅ Test thoroughly
- ✅ Start small
- ✅ Use stop losses
- ✅ Monitor regularly
- ✅ Never trade more than you can afford to lose

Happy trading! 🚀

