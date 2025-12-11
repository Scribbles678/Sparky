# AI Signal Engine

The AI Signal Engine is a background worker that processes active AI trading strategies, makes trading decisions using Groq's LLM, and sends signals to Sparky's webhook endpoint for execution.

## Architecture

```
AI Worker (main.js)
    ↓
1. Fetch active strategies from Supabase
    ↓
2. Get market data (OHLCV, indicators)
    ↓
3. Call Groq API for trading decision
    ↓
4. Parse decision (LONG/SHORT/CLOSE/HOLD)
    ↓
5. Send signal to Sparky /webhook endpoint
    ↓
6. Sparky executes trade (existing pipeline)
```

## Setup

### 1. Install Dependencies

```bash
npm install groq-sdk node-fetch
```

### 2. Environment Variables

Add to `.env`:

```bash
GROQ_API_KEY=gsk_your_groq_api_key_here
WEBHOOK_URL=http://localhost:3000/webhook  # For production, use full URL
```

### 3. Create AI Strategy

In Supabase, insert a test strategy:

```sql
INSERT INTO ai_strategies (user_id, name, status, risk_profile, target_assets)
VALUES (
  'your-user-id',
  'Test AI Strategy',
  'running',
  'balanced',
  '{BTCUSDT,ETHUSDT}'
);
```

### 4. Start with PM2

```bash
pm2 start ecosystem.config.js --only ai-signal-engine
pm2 logs ai-signal-engine
```

## Testing

### Test Locally

```bash
# Run worker directly (for debugging)
node src/ai-worker/main.js
```

### Test Webhook Integration

```bash
# Create a test strategy in Supabase with status='running'
# Watch logs to see AI decisions
pm2 logs ai-signal-engine --lines 50
```

## Monitoring

### Health Check

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

### Logs

```bash
# View AI worker logs
pm2 logs ai-signal-engine

# View Sparky bot logs (to see executed trades)
pm2 logs aster-bot
```

## Configuration

### Cycle Interval

Default: 45 seconds (defined in `main.js`)

To change:
```javascript
const CYCLE_INTERVAL_MS = 60_000; // 1 minute
```

### Groq Model

Default: `llama-3.1-70b-versatile`

To change:
```javascript
completion = await groq.chat.completions.create({
  model: 'llama-3.1-8b-instant', // Faster, cheaper
  // ...
});
```

## Troubleshooting

### "No active strategies found"
- Check Supabase: `SELECT * FROM ai_strategies WHERE status = 'running'`
- Verify user_id is correct

### "No webhook secret found"
- User must have webhook secret in `bot_credentials` table
- Check: `SELECT * FROM bot_credentials WHERE user_id = '...' AND exchange = 'webhook'`

### "Groq API error"
- Verify `GROQ_API_KEY` is set correctly
- Check Groq API status and rate limits
- Review logs for specific error messages

### "No market data"
- Verify user has exchange credentials configured
- Check exchange API connection
- Verify symbol format matches exchange (e.g., BTCUSDT not BTC/USDT)

## File Structure

```
src/ai-worker/
├── main.js              # Main worker loop
├── prompts/
│   └── balanced.js      # Prompt builder
└── utils/
    ├── marketData.js    # Market data fetching
    └── parser.js         # Decision parser
```

## Next Steps

- Phase 2: Dashboard integration (UI for managing strategies)
- Phase 3: Performance fee billing
- Phase 4: Prop firm mode

