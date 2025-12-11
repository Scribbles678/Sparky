# Phase 1 Implementation Checklist

Quick reference checklist for Phase 1 implementation. See `PHASE1_IMPLEMENTATION_PLAN.md` for detailed instructions.

## Week 1: Foundation

### Day 1: Setup
- [ ] Create Git branch: `feat/ai-trading-firm`
- [ ] Create folder structure (`src/ai-worker/`, `src/routes/`)
- [ ] Run Supabase migration (`20251211_ai_trading_firm.sql`)
- [ ] Verify tables created: `ai_strategies`, `ai_trade_log`

### Day 2: Internal Webhook Route
- [ ] Create `src/routes/webhookAi.js`
- [ ] Add route to `src/index.js`
- [ ] Test route with curl/Postman
- [ ] Verify signals forward to existing handler

### Day 3-4: Market Data Utilities
- [ ] Create `src/ai-worker/utils/marketData.js`
- [ ] Implement `get1mOHLCV()` function
- [ ] Implement `getCurrentPrice()` function
- [ ] Implement `getUserPositions()` function
- [ ] Implement `calculateIndicators()` function
- [ ] Test market data fetching

### Day 5: Prompt Builder & Parser
- [ ] Create `src/ai-worker/prompts/balanced.js`
- [ ] Create `src/ai-worker/utils/parser.js`
- [ ] Test prompt generation
- [ ] Test JSON parsing with various formats

## Week 2: AI Worker Core

### Day 6-7: AI Worker Main Loop
- [ ] Create `src/ai-worker/main.js`
- [ ] Implement `getActiveStrategies()` function
- [ ] Implement `getUserWebhookSecret()` function
- [ ] Implement `processStrategy()` function
- [ ] Implement `runCycle()` function
- [ ] Integrate Groq API calls
- [ ] Test end-to-end flow

### Day 8: PM2 & Environment
- [ ] Update `ecosystem.config.js` with AI worker
- [ ] Add `GROQ_API_KEY` to `.env`
- [ ] Install dependencies: `groq-sdk`, `node-fetch`
- [ ] Test PM2 start/stop/restart

### Day 9-10: Testing
- [ ] Unit tests for market data utilities
- [ ] Unit tests for parser
- [ ] Integration test: AI worker → Sparky webhook
- [ ] End-to-end test: Create strategy → AI trades → Dashboard
- [ ] Paper trading mode test

## Week 3: Polish

### Day 11-12: Error Handling
- [ ] Add Groq API rate limiting
- [ ] Add circuit breaker for failed strategies
- [ ] Add retry logic for API calls
- [ ] Add graceful error handling

### Day 13-14: Monitoring
- [ ] Add metrics collection
- [ ] Add health check endpoint (`/health/ai-worker`)
- [ ] Set up log monitoring
- [ ] Add alerting for failures

### Day 15: Documentation
- [ ] Create `src/ai-worker/README.md`
- [ ] Update main README with AI section
- [ ] Update DEPLOYMENT.md
- [ ] Code review and cleanup

## Testing Checklist

### Basic Functionality
- [ ] AI worker starts successfully
- [ ] Can fetch active strategies from Supabase
- [ ] Can fetch market data
- [ ] Can call Groq API
- [ ] Can parse AI responses
- [ ] Can send signals to Sparky webhook
- [ ] Sparky executes AI signals
- [ ] Trades appear in dashboard

### Error Scenarios
- [ ] Handles Groq API failures gracefully
- [ ] Handles market data failures gracefully
- [ ] Handles parse errors gracefully
- [ ] Handles missing webhook secrets
- [ ] Handles invalid strategy configs

### Production Readiness
- [ ] PM2 auto-restart works
- [ ] Logs are properly formatted
- [ ] Metrics are collected
- [ ] Health check responds correctly
- [ ] No memory leaks (run for 24h)

## Quick Test Commands

```bash
# Test AI worker locally
node src/ai-worker/main.js

# Start with PM2
pm2 start ecosystem.config.js --only ai-signal-engine

# Monitor logs
pm2 logs ai-signal-engine --lines 50

# Check health
curl http://localhost:3000/health/ai-worker

# Create test strategy (Supabase SQL)
INSERT INTO ai_strategies (user_id, name, status, target_assets)
VALUES ('your-user-id', 'Test Strategy', 'running', '{BTCUSDT}');
```

## Success Criteria

Phase 1 is complete when:
- ✅ AI worker runs continuously
- ✅ Strategies can be created/started/paused
- ✅ AI generates decisions every 45 seconds
- ✅ Signals flow through Sparky webhook
- ✅ Trades execute with risk limits
- ✅ All trades logged correctly
- ✅ Dashboard shows AI trades
- ✅ Error handling prevents failures
- ✅ Monitoring shows health

---

**Estimated Time:** 15 days (3 weeks)  
**Status:** Ready to start  
**Next:** Phase 2 (Dashboard Integration)

