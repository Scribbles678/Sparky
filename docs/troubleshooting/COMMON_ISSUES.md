# Troubleshooting - Common Issues

**Sparky Trading Bot** - Common problems and solutions

---

## Setup Issues

### "Supabase client not initialized"

**Symptoms:**
- Error: `Supabase client not initialized`
- Bot fails to start or log trades

**Solutions:**
1. Check `.env` file exists in Sparky root
2. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
3. Check for typos or extra spaces
4. Restart bot after changing `.env`

---

### "GROQ_API_KEY not found"

**Symptoms:**
- AI Worker fails to start
- Error: `GROQ_API_KEY not found in environment variables`

**Solutions:**
1. Add to `.env`:
   ```env
   GROQ_API_KEY=gsk_your_key_here
   ```
2. Get key from: https://console.groq.com/
3. Restart AI Worker: `pm2 restart ai-signal-engine`

---

## Trading Issues

### "Trades not executing"

**Symptoms:**
- Webhooks received but no trades executed
- No errors in logs

**Solutions:**
1. Check exchange credentials in Supabase:
   ```sql
   SELECT * FROM bot_credentials 
   WHERE user_id = 'your-user-id' 
   AND exchange = 'aster';
   ```
2. Verify sufficient margin in exchange account
3. Check risk limits not exceeded:
   - Weekly trade limit
   - Weekly loss limit
   - Daily trade limit (from strategy config)
4. Check logs: `pm2 logs aster-bot | tail -50`

---

### "Webhook secret validation failed"

**Symptoms:**
- 401 Unauthorized errors
- Webhooks rejected

**Solutions:**
1. Verify webhook secret in Supabase:
   ```sql
   SELECT * FROM bot_credentials 
   WHERE user_id = 'your-user-id' 
   AND exchange = 'webhook';
   ```
2. Check webhook secret matches in TradingView alert
3. Verify `environment = 'production'` in database
4. Check Redis cache (if using): May need to clear cache

---

### "Position not closing"

**Symptoms:**
- TP/SL orders placed but position remains open
- Manual close fails

**Solutions:**
1. Check exchange API status
2. Verify TP/SL orders are active on exchange
3. Check position size matches order size
4. Try manual close via exchange UI
5. Check logs for exchange-specific errors

---

## AI Worker Issues

### "AI not making decisions"

**Symptoms:**
- No decisions in `ai_trade_decisions` table
- AI Worker running but no activity

**Solutions:**
1. Check strategy status is `'running'`:
   ```sql
   SELECT * FROM ai_strategies WHERE status = 'running';
   ```
2. Verify AI Worker is running: `pm2 status`
3. Check AI Worker logs: `pm2 logs ai-signal-engine`
4. Verify GROQ_API_KEY is set
5. Check user has webhook secret in `bot_credentials`

---

### "ML predictions not working"

**Symptoms:**
- All decisions using LLM (no ML)
- ML service errors in logs

**Solutions:**
1. Verify Arthur ML is running: `pm2 status arthur-ml-service`
2. Check `ML_SERVICE_URL` in `.env`:
   ```env
   ML_SERVICE_URL=http://localhost:8001
   ```
3. Test ML service: `curl http://localhost:8001/health`
4. Check ML confidence threshold in strategy config
5. Verify strategy has trained model (if using per-strategy ML)

---

### "Auto-retrain not working"

**Symptoms:**
- Models not retraining automatically
- No retrain logs

**Solutions:**
1. Check auto-retrain scheduler is running:
   ```bash
   pm2 logs aster-bot | grep "auto-retrain"
   ```
2. Verify strategy has `ml_training_enabled = true`
3. Check strategy has enough trades (100+)
4. Verify SignalStudio API is accessible:
   ```env
   SIGNALSTUDIO_API_URL=http://localhost:3000
   ```
5. Check Arthur ML service is running

---

## Integration Issues

### "SignalStudio not forwarding webhooks"

**Symptoms:**
- TradingView alerts sent but Sparky doesn't receive them
- No webhook activity in SignalStudio

**Solutions:**
1. Verify webhook URL in TradingView:
   ```
   https://app.signal-studio.co/api/webhook
   ```
2. Check SignalStudio logs (Netlify functions)
3. Verify webhook secret validation in SignalStudio
4. Check subscription limits not exceeded
5. Verify Redis cache (if using) is working

---

### "Config changes not taking effect"

**Symptoms:**
- Changed config in AI Studio but behavior unchanged
- Old settings still being used

**Solutions:**
1. Wait for next AI cycle (45 seconds)
2. Check config was saved: Query `ai_strategies.config` JSONB
3. Verify `normalizeConfig()` is being called
4. Check AI Worker logs for config loading
5. Restart AI Worker if needed: `pm2 restart ai-signal-engine`

---

## Performance Issues

### "Slow webhook processing"

**Symptoms:**
- Webhooks take > 5 seconds to process
- Timeout errors

**Solutions:**
1. Check exchange API latency
2. Verify Supabase connection speed
3. Check Redis cache (if using) is working
4. Monitor server resources (CPU, memory)
5. Check for rate limiting on exchange APIs

---

### "High memory usage"

**Symptoms:**
- PM2 restarts due to memory limit
- Bot becomes slow

**Solutions:**
1. Increase PM2 memory limit:
   ```javascript
   max_memory_restart: '1G'  // In ecosystem.config.js
   ```
2. Check for memory leaks in logs
3. Restart bot periodically
4. Monitor position tracking (in-memory)

---

## Deployment Issues

### "Bot not starting on reboot"

**Symptoms:**
- Bot works but doesn't start after server restart

**Solutions:**
1. Setup PM2 startup:
   ```bash
   pm2 startup
   pm2 save
   ```
2. Follow PM2 instructions to enable systemd service
3. Verify PM2 is in system PATH
4. Check PM2 logs: `pm2 logs`

---

### "Port already in use"

**Symptoms:**
- Error: `EADDRINUSE: address already in use :::3000`
- Bot fails to start

**Solutions:**
1. Check what's using the port:
   ```bash
   lsof -i :3000
   # Or
   netstat -ano | findstr :3000
   ```
2. Kill existing process or change port:
   ```env
   PORT=3001
   ```
3. Update any reverse proxy configs

---

## Database Issues

### "Trade not logging to Supabase"

**Symptoms:**
- Trades execute but don't appear in dashboard
- No entries in `trades` table

**Solutions:**
1. Check Supabase credentials in `.env`
2. Verify `SUPABASE_SERVICE_ROLE_KEY` (not anon key)
3. Check RLS policies allow service role
4. Verify `savePosition()` and `logTrade()` are being called
5. Check Supabase logs for errors

---

### "Position not updating"

**Symptoms:**
- Positions show stale prices
- Unrealized P&L not updating

**Solutions:**
1. Check position updater is running:
   ```bash
   pm2 logs aster-bot | grep "position"
   ```
2. Verify position updater interval (every 30s)
3. Check exchange API for price data
4. Verify Supabase connection
5. Check for errors in position updater logs

---

## General Debugging

### Check Service Status

```bash
# PM2 status
pm2 status

# Check logs
pm2 logs aster-bot --lines 100
pm2 logs ai-signal-engine --lines 100

# Health check
curl http://localhost:3000/health
```

### Verify Environment

```bash
# Check environment variables
echo $SUPABASE_URL
echo $GROQ_API_KEY
echo $ML_SERVICE_URL

# Or in Node.js
node -e "require('dotenv').config(); console.log(process.env.SUPABASE_URL)"
```

### Test Connections

```bash
# Test Supabase
# (Use Supabase client in Node.js)

# Test Arthur ML
curl http://localhost:8001/health

# Test SignalStudio API
curl http://localhost:3000/api/health
```

---

## Getting Help

If issues persist:

1. **Check Documentation:**
   - [Deployment Guide](../guides/DEPLOYMENT.md)
   - [AI Worker Guide](../guides/AI_WORKER.md)
   - [API Reference](../reference/API_REFERENCE.md)

2. **Review Logs:**
   - PM2 logs: `pm2 logs aster-bot`
   - Application logs: `logs/combined.log`
   - Error logs: `logs/error.log`

3. **Verify Setup:**
   - Environment variables
   - Database connectivity
   - Exchange credentials
   - Service status

---

**Last Updated:** January 2025

