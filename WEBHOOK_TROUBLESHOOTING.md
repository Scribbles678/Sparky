# Webhook Troubleshooting Guide

## Quick Diagnosis

### Problem: Trades Not Executing

Run this command on your VPS to check recent webhook activity:
```bash
tail -40 /opt/sparky-bot/logs/combined.log
```

Look for these patterns:

## Common Issues & Solutions

### ❌ Issue 1: Empty Webhook Body

**Log Pattern:**
```json
{"body":"{}","contentType":"text/plain; charset=utf-8","level":"info","message":"Webhook received"}
{"ip":"52.32.178.7","level":"warn","message":"Unauthorized webhook attempt","secret":"[MISSING]"}
```

**What This Means:**
TradingView is sending webhooks, but they're arriving empty. Your bot never receives the trade instructions.

**Root Cause:**
Your TradingView alert message is not configured correctly.

**Solution:**

1. **Open TradingView** → Go to your alert
2. **Check the "Message" field** - it should contain JSON like this:

```json
{
  "secret": "your-webhook-secret-from-env-file",
  "action": "buy",
  "symbol": "BTCUSDT",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 4
}
```

3. **Make sure:**
   - ✅ Message field is NOT empty
   - ✅ Message is valid JSON (use [JSONLint](https://jsonlint.com/) to validate)
   - ✅ `secret` matches exactly what's in your `.env` file
   - ✅ No extra spaces, quotes, or characters
   - ✅ Alert is set to "Webhook URL" (not just notification)

4. **Webhook URL should be:**
   ```
   http://your-vps-ip:3000/webhook
   ```
   Or if using Nginx:
   ```
   http://your-domain.com/webhook
   ```

---

### ❌ Issue 2: Wrong Secret

**Log Pattern:**
```json
{"ip":"52.32.178.7","level":"warn","message":"Unauthorized webhook attempt","secret":"[PROVIDED]"}
```

**What This Means:**
Webhook body is received, but the secret doesn't match.

**Solution:**

1. Check your webhook secret in `.env` or `config.json`:
   ```bash
   cat /opt/sparky-bot/.env | grep WEBHOOK_SECRET
   ```

2. Make sure TradingView alert message uses **exact same secret**:
   ```json
   {
     "secret": "copy-exactly-from-env-file",
     ...
   }
   ```

3. Common mistakes:
   - Extra spaces before/after secret
   - Different secret in `.env` vs `config.json`
   - Using wrong quotes (use regular " not fancy quotes)

---

### ❌ Issue 3: Invalid JSON Format

**Log Pattern:**
```json
{"level":"error","message":"Webhook processing failed","error":"Unexpected token..."}
```

**What This Means:**
TradingView is sending data, but it's not valid JSON.

**Solution:**

1. **Test your JSON** at [JSONLint.com](https://jsonlint.com/)

2. **Common JSON mistakes:**
   ```json
   // ❌ WRONG - Single quotes
   {'secret': 'test'}
   
   // ✅ CORRECT - Double quotes
   {"secret": "test"}
   
   // ❌ WRONG - Trailing comma
   {"secret": "test", "action": "buy",}
   
   // ✅ CORRECT - No trailing comma
   {"secret": "test", "action": "buy"}
   
   // ❌ WRONG - Missing quotes on keys
   {secret: "test"}
   
   // ✅ CORRECT - Quotes on keys
   {"secret": "test"}
   ```

---

### ❌ Issue 4: Missing Required Fields

**Log Pattern:**
```json
{"level":"error","message":"Missing required field: action"}
```

**What This Means:**
JSON is received but missing required fields.

**Required Fields:**
- `secret` - Your webhook authentication token
- `action` - Must be "buy", "sell", or "close"
- `symbol` - Trading pair (e.g., "BTCUSDT")

**Optional Fields:**
- `orderType` - "market" or "limit" (defaults to "market")
- `price` - Required for limit orders
- `stop_loss_percent` - Stop loss percentage
- `take_profit_percent` - Take profit percentage

---

## Testing Your Webhook

### Step 1: Test with the Test Endpoint

Use the new test endpoint to see exactly what your webhook is sending:

**Change your TradingView webhook URL temporarily to:**
```
http://your-vps-ip:3000/webhook/test
```

Fire the alert and check logs:
```bash
tail -20 /opt/sparky-bot/logs/combined.log
```

You'll see exactly what data the bot received.

### Step 2: Test Locally with curl

SSH into your VPS and run:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-webhook-secret",
    "action": "buy",
    "symbol": "BTCUSDT",
    "orderType": "market",
    "stop_loss_percent": 2,
    "take_profit_percent": 4
  }'
```

**Expected Success Response:**
```json
{
  "success": true,
  "action": "opened",
  "position": {...}
}
```

### Step 3: Test Test Endpoint

```bash
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "test",
    "action": "buy",
    "symbol": "BTCUSDT"
  }'
```

This will show you exactly what the bot receives.

---

## TradingView Alert Configuration

### ✅ Correct Setup

**Alert Conditions:**
- Set your technical indicators/strategy as usual

**Alert Actions:**
- ☑️ Check "Webhook URL"
- URL: `http://your-vps-ip:3000/webhook` or `http://your-domain.com/webhook`

**Message Field (most important!):**

For **BUY/SELL** signals:
```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "BTCUSDT",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 4
}
```

For **CLOSE** signals:
```json
{
  "secret": "your-webhook-secret-here",
  "action": "close",
  "symbol": "BTCUSDT"
}
```

### Using TradingView Variables

You can use TradingView's built-in variables:

```json
{
  "secret": "your-webhook-secret-here",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 4,
  "price": {{close}}
}
```

**Available Variables:**
- `{{ticker}}` - Symbol (e.g., "BTCUSDT")
- `{{close}}` - Close price
- `{{open}}` - Open price
- `{{high}}` - High price
- `{{low}}` - Low price
- `{{volume}}` - Volume
- `{{time}}` - Bar time

---

## Checking Bot Status

### 1. Is the bot running?
```bash
pm2 status
```

Should show "online" status.

### 2. Check recent activity
```bash
tail -50 /opt/sparky-bot/logs/combined.log
```

### 3. Check API connection
```bash
curl http://localhost:3000/health
```

Should return:
```json
{
  "status": "ok",
  "apiStatus": "connected",
  "balance": 95.59,
  ...
}
```

### 4. Check open positions
```bash
curl http://localhost:3000/positions
```

---

## Common TradingView Mistakes

### ❌ Mistake 1: Alert Message Left Empty
Many users set the webhook URL but forget to add the JSON message.

**Fix:** Add the JSON payload to the "Message" field.

### ❌ Mistake 2: Using Notification Instead of Webhook
Alert is set to send notification/email but not webhook.

**Fix:** Make sure "Webhook URL" is checked and filled in.

### ❌ Mistake 3: Testing with Alert Window
Clicking "Test" in the alert creation window doesn't always send webhook.

**Fix:** Save the alert and trigger it naturally, or use the alert history to check if webhooks were sent.

### ❌ Mistake 4: Wrong Symbol Format
Using "BTC/USDT" instead of "BTCUSDT" or "BTC-USDT" instead of "BTCUSDT".

**Fix:** Use the exact format your exchange expects (usually no separators: "BTCUSDT").

### ❌ Mistake 5: Firewall Blocking TradingView
Your VPS firewall is blocking TradingView's IP addresses.

**Fix:** 
```bash
# Check firewall
ufw status

# Make sure port 80 or your bot's port is open
ufw allow 80
ufw allow 3000
```

---

## Network & Infrastructure Issues

### Issue: Nginx Not Forwarding Webhooks

**Check Nginx Status:**
```bash
systemctl status nginx
```

**Check Nginx Logs:**
```bash
tail -f /var/log/nginx/error.log
```

**Test Nginx Config:**
```bash
nginx -t
```

**Restart Nginx:**
```bash
systemctl restart nginx
```

### Issue: Port Not Open

**Check if port is accessible:**
```bash
# From another machine
curl http://your-vps-ip:3000/health

# Or use online tools like:
# https://www.yougetsignal.com/tools/open-ports/
```

**Open port if needed:**
```bash
ufw allow 3000
```

---

## Advanced Debugging

### Enable Detailed Logging

1. Edit your `.env`:
   ```env
   LOG_LEVEL=debug
   ```

2. Restart bot:
   ```bash
   pm2 restart aster-bot
   ```

3. Watch logs in real-time:
   ```bash
   pm2 logs aster-bot --lines 100
   ```

### Capture Full Request

Add this temporarily to `src/index.js` after line 74:

```javascript
// Temporary: Log ALL incoming requests with full details
app.use((req, res, next) => {
  console.log('=== INCOMING REQUEST ===');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================');
  next();
});
```

Then restart and check output.

---

## Quick Reference: Alert Message Templates

### Template 1: Basic Market Order
```json
{
  "secret": "your-secret-here",
  "action": "buy",
  "symbol": "BTCUSDT",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Template 2: With Dynamic Symbol
```json
{
  "secret": "your-secret-here",
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Template 3: Limit Order
```json
{
  "secret": "your-secret-here",
  "action": "buy",
  "symbol": "BTCUSDT",
  "orderType": "limit",
  "price": {{close}},
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Template 4: Close Position
```json
{
  "secret": "your-secret-here",
  "action": "close",
  "symbol": "BTCUSDT"
}
```

---

## Still Having Issues?

### Checklist:

- [ ] Bot is running (`pm2 status` shows "online")
- [ ] API connected (`curl http://localhost:3000/health` returns apiStatus: "connected")
- [ ] Webhook URL correct in TradingView
- [ ] Alert message contains valid JSON
- [ ] Secret matches exactly between TradingView and .env
- [ ] Port is open (firewall allows traffic)
- [ ] TradingView alert is active (not paused)
- [ ] Sufficient margin in Aster account
- [ ] Logs show webhook attempts (`tail -f logs/combined.log`)

### Get Help:

1. **Share your logs:**
   ```bash
   tail -100 /opt/sparky-bot/logs/combined.log
   ```

2. **Share your test results:**
   ```bash
   curl -X POST http://localhost:3000/webhook/test \
     -H "Content-Type: application/json" \
     -d '{"secret":"test","action":"buy","symbol":"BTCUSDT"}'
   ```

3. **Sanitize sensitive data** (remove API keys, secrets) before sharing!

---

## Success! Webhooks Working

When everything is configured correctly, you'll see logs like:

```json
{"level":"info","message":"Webhook received","body":"{'secret':'[PROVIDED]','action':'buy',...}"}
{"level":"info","message":"Processing webhook","action":"buy","symbol":"BTCUSDT"}
{"level":"info","message":"Opening BUY position for BTCUSDT"}
{"level":"info","message":"Position size calculated: 0.001 at 45000"}
{"level":"info","message":"Trade opened","type":"trade","action":"opened","symbol":"BTCUSDT"}
{"level":"info","message":"Stop loss placed at 44100","orderId":"12345"}
{"level":"info","message":"Take profit placed at 47250","orderId":"12346"}
{"level":"info","message":"Position opened successfully for BTCUSDT"}
```

Happy Trading! 🚀

