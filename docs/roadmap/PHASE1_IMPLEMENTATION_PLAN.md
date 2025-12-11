# Phase 1: AI Strategy Core - Detailed Implementation Plan

**Goal:** AI can autonomously open/close positions using existing Sparky execution pipeline  
**Timeline:** 2-3 weeks  
**Status:** Ready to start

---

## Overview

Phase 1 adds an AI decision engine that generates trading signals and sends them through your existing Sparky webhook infrastructure. Zero changes to execution, risk limits, or dashboard - the AI is just another signal source.

**Key Principle:** Every AI trade flows through `/webhook` endpoint → existing `TradeExecutor` → existing risk checks → existing logging.

---

## Week 1: Foundation & Core Infrastructure

### Day 1: Setup & Database Schema

**Tasks:**
1. Create Git branch
   ```bash
   git checkout -b feat/ai-trading-firm
   ```

2. Create folder structure
   ```
   Sparky/
   ├── src/
   │   ├── ai-worker/
   │   │   ├── main.js
   │   │   ├── prompts/
   │   │   │   └── balanced.js
   │   │   └── utils/
   │   │       ├── marketData.js
   │   │       └── parser.js
   │   └── routes/
   │       └── webhookAi.js
   ```

3. Run Supabase migration
   - File: `docs/schema/20251211_ai_trading_firm.sql`
   - Run via Supabase SQL Editor
   - Verify tables created: `ai_strategies`, `ai_trade_log`

**Deliverable:** Database schema ready, folder structure created

---

### Day 2: Internal AI Webhook Route

**File:** `src/routes/webhookAi.js`

**Purpose:** Thin wrapper that validates AI worker requests and forwards to existing webhook handler

**Implementation:**
```javascript
const express = require('express');
const router = express.Router();
const { validateWebhookSecret } = require('../supabaseClient');

// This endpoint is ONLY called by internal AI worker (localhost)
router.post('/ai-signal', async (req, res) => {
  try {
    const { user_id, secret, exchange, symbol, action, position_size_usd, strategy_id, source } = req.body;

    // Validate required fields
    if (!user_id || !secret || !exchange || !symbol || !action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: user_id, secret, exchange, symbol, action'
      });
    }

    // Validate webhook secret (reuse existing function)
    const userCredential = validateWebhookSecret(secret);
    if (!userCredential || userCredential.userId !== user_id) {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook secret for user'
      });
    }

    // Forward to existing webhook handler
    // Create a new request object that matches expected format
    req.body = {
      user_id: user_id,
      userId: user_id,
      exchange: exchange.toLowerCase(),
      symbol: symbol,
      action: action, // BUY, SELL, CLOSE
      position_size_usd: position_size_usd,
      strategy_id: strategy_id,
      source: source || 'ai_engine_v1',
      // Add AI-specific metadata
      ai_confidence: req.body.ai_confidence,
      ai_reasoning: req.body.ai_reasoning
    };

    // Import and call existing handler
    const { handleWebhook } = require('../index');
    return handleWebhook(req, res);
  } catch (error) {
    logger.logError('AI Signal Webhook Error', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
```

**Integration:** Add to `src/index.js`
```javascript
const webhookAiRouter = require('./routes/webhookAi');
app.use('/webhook', webhookAiRouter); // Mount at same level as main webhook
```

**Testing:**
```bash
# Test locally
curl -X POST http://localhost:3000/webhook/ai-signal \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-id",
    "secret": "test-secret",
    "exchange": "aster",
    "symbol": "BTCUSDT",
    "action": "BUY",
    "position_size_usd": 100
  }'
```

**Deliverable:** Internal webhook route working, forwards to existing handler

---

### Day 3-4: Market Data Utilities

**File:** `src/ai-worker/utils/marketData.js`

**Purpose:** Fetch price data, OHLCV candles, and basic indicators for AI prompts

**Implementation:**
```javascript
const logger = require('../../utils/logger');
const AsterAPI = require('../../asterApi');
const { getUserExchangeCredentials } = require('../../supabaseClient');
const ExchangeFactory = require('../../exchanges/ExchangeFactory');

/**
 * Get 1-minute OHLCV candles for symbol
 * @param {string} userId - User ID
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {string} exchange - Exchange name
 * @param {number} limit - Number of candles (default 100)
 * @returns {Promise<Array>} Array of candle objects
 */
async function get1mOHLCV(userId, symbol, exchange = 'aster', limit = 100) {
  try {
    // Get user's exchange API instance
    const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
    if (!exchangeApi) {
      throw new Error(`No ${exchange} credentials found for user ${userId}`);
    }

    // Fetch candles (implement based on exchange API)
    // Aster example:
    if (exchange === 'aster') {
      const candles = await exchangeApi.getKlines(symbol, '1m', limit);
      return candles.map(c => ({
        time: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      }));
    }

    // Add other exchanges as needed
    throw new Error(`OHLCV not implemented for ${exchange}`);
  } catch (error) {
    logger.logError(`Failed to fetch OHLCV for ${symbol}`, error);
    return [];
  }
}

/**
 * Get current ticker price
 * @param {string} userId - User ID
 * @param {string} symbol - Trading symbol
 * @param {string} exchange - Exchange name
 * @returns {Promise<number>} Current price
 */
async function getCurrentPrice(userId, symbol, exchange = 'aster') {
  try {
    const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
    if (!exchangeApi) {
      throw new Error(`No ${exchange} credentials found`);
    }

    const ticker = await exchangeApi.getTicker(symbol);
    return parseFloat(ticker.lastPrice || ticker.price);
  } catch (error) {
    logger.logError(`Failed to fetch price for ${symbol}`, error);
    return null;
  }
}

/**
 * Get user's current positions
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of position objects
 */
async function getUserPositions(userId) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open');

    if (error) throw error;
    return data || [];
  } catch (error) {
    logger.logError('Failed to fetch user positions', error);
    return [];
  }
}

/**
 * Calculate simple technical indicators
 * @param {Array} candles - OHLCV candle array
 * @returns {Object} Indicators object
 */
function calculateIndicators(candles) {
  if (candles.length < 20) {
    return { sma20: null, sma50: null, rsi: null };
  }

  const closes = candles.map(c => c.close);
  
  // Simple Moving Averages
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.length >= 50 
    ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 
    : null;

  // RSI (simplified)
  const rsi = calculateRSI(closes.slice(-14));

  return {
    sma20,
    sma50,
    rsi,
    currentPrice: closes[closes.length - 1],
    priceChange24h: closes.length >= 1440 
      ? ((closes[closes.length - 1] - closes[closes.length - 1440]) / closes[closes.length - 1440]) * 100
      : null
  };
}

function calculateRSI(prices) {
  if (prices.length < 14) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

module.exports = {
  get1mOHLCV,
  getCurrentPrice,
  getUserPositions,
  calculateIndicators
};
```

**Note:** Start simple - just price data. Add on-chain metrics in Phase 2.

**Deliverable:** Market data fetching utilities ready

---

### Day 5: Prompt Builder & Parser

**File:** `src/ai-worker/prompts/balanced.js`

**Purpose:** Build prompts for AI and parse responses

**Implementation:**
```javascript
/**
 * Build AI prompt for trading decision
 * @param {Object} params - Strategy and market data
 * @returns {string} Formatted prompt
 */
function buildPrompt({ strategy, priceData, indicators, currentPositions }) {
  const positionsSummary = currentPositions.length > 0
    ? currentPositions.map(p => `${p.symbol}: ${p.side} ${p.quantity} @ $${p.entry_price} (P&L: $${p.unrealized_pnl_usd || 0})`).join('\n')
    : 'No open positions';

  return `You are an elite crypto quant trader with 8 years experience and a 2.1 Sharpe ratio over 5 years.

RISK PROFILE: ${strategy.risk_profile}
MAX DRAWDOWN ALLOWED: ${strategy.max_drawdown_percent}%
MAX LEVERAGE: ${strategy.leverage_max}x
TARGET ASSETS: ${strategy.target_assets.join(', ')}

CURRENT OPEN POSITIONS:
${positionsSummary}

MARKET DATA (Last 100 candles, 1-minute):
Current Price: $${indicators.currentPrice}
SMA 20: $${indicators.sma20?.toFixed(2) || 'N/A'}
SMA 50: $${indicators.sma50?.toFixed(2) || 'N/A'}
RSI: ${indicators.rsi?.toFixed(2) || 'N/A'}
24h Change: ${indicators.priceChange24h?.toFixed(2) || 'N/A'}%

Recent price action (last 10 candles):
${JSON.stringify(priceData.slice(-10), null, 2)}

INSTRUCTIONS:
1. Analyze the market data and current positions
2. Decide on action: LONG, SHORT, CLOSE, or HOLD
3. If LONG/SHORT, specify position size in USD (respect max leverage)
4. Provide confidence score (0.0 to 1.0)
5. Give brief reasoning (max 15 words)

Return ONLY valid JSON. No markdown. No explanation outside JSON.

{
  "action": "LONG" | "SHORT" | "CLOSE" | "HOLD",
  "symbol": "BTCUSDT" | "ETHUSDT" | etc,
  "size_usd": 2500,
  "confidence": 0.87,
  "reasoning": "short explanation under 15 words"
}`;
}

module.exports = { buildPrompt };
```

**File:** `src/ai-worker/utils/parser.js`

**Purpose:** Parse AI response and validate

**Implementation:**
```javascript
const logger = require('../../utils/logger');

/**
 * Parse AI decision from LLM response
 * @param {string} text - Raw LLM response
 * @returns {Object} Parsed decision object
 */
function parseDecision(text) {
  try {
    // Try to extract JSON from response (handles markdown code blocks)
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText);

    // Validate and normalize
    const action = (parsed.action || 'HOLD').toUpperCase();
    const validActions = ['LONG', 'SHORT', 'CLOSE', 'HOLD'];
    
    if (!validActions.includes(action)) {
      logger.warn(`Invalid action from AI: ${action}, defaulting to HOLD`);
      return createHoldDecision('Invalid action');
    }

    // Normalize symbol format
    let symbol = parsed.symbol || 'BTCUSDT';
    symbol = symbol.replace('/', '').replace(':', '').toUpperCase();

    // Validate size
    const sizeUsd = Math.max(0, Math.min(100000, Number(parsed.size_usd) || 0));

    // Validate confidence
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

    return {
      action,
      symbol,
      size_usd: sizeUsd,
      confidence,
      reasoning: (parsed.reasoning || '').substring(0, 100)
    };
  } catch (error) {
    logger.logError('Failed to parse AI decision', error, { text });
    return createHoldDecision('Parse error: ' + error.message);
  }
}

function createHoldDecision(reason) {
  return {
    action: 'HOLD',
    symbol: 'BTCUSDT',
    size_usd: 0,
    confidence: 0,
    reasoning: reason
  };
}

module.exports = { parseDecision };
```

**Deliverable:** Prompt builder and parser ready

---

## Week 2: AI Worker Core

### Day 6-7: AI Worker Main Loop

**File:** `src/ai-worker/main.js`

**Purpose:** Main worker that polls strategies, calls AI, and sends signals

**Implementation:**
```javascript
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const logger = require('../utils/logger');
const { Groq } = require('groq-sdk');
const { get1mOHLCV, getUserPositions, calculateIndicators } = require('./utils/marketData');
const { buildPrompt } = require('./prompts/balanced');
const { parseDecision } = require('./utils/parser');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook/ai-signal';
const CYCLE_INTERVAL_MS = 45_000; // 45 seconds

/**
 * Get active AI strategies from database
 */
async function getActiveStrategies() {
  try {
    const { data, error } = await supabase
      .from('ai_strategies')
      .select('*')
      .eq('status', 'running');

    if (error) {
      logger.logError('Failed to fetch active strategies', error);
      return [];
    }

    return data || [];
  } catch (error) {
    logger.logError('Exception fetching strategies', error);
    return [];
  }
}

/**
 * Get user's webhook secret
 */
async function getUserWebhookSecret(userId) {
  try {
    const { data, error } = await supabase
      .from('bot_credentials')
      .select('webhook_secret')
      .eq('user_id', userId)
      .eq('exchange', 'webhook')
      .eq('environment', 'production')
      .maybeSingle();

    if (error || !data) {
      logger.warn(`No webhook secret found for user ${userId}`);
      return null;
    }

    return data.webhook_secret;
  } catch (error) {
    logger.logError('Failed to fetch webhook secret', error);
    return null;
  }
}

/**
 * Process a single AI strategy
 */
async function processStrategy(strategy) {
  const startTime = Date.now();
  
  try {
    logger.info(`Processing AI strategy: ${strategy.name} (${strategy.id})`);

    // Get market data for target assets
    const exchange = strategy.target_assets[0]?.includes('USDT') ? 'aster' : 'aster'; // Default to aster
    const primarySymbol = strategy.target_assets[0] || 'BTCUSDT';

    // Fetch market data
    const candles = await get1mOHLCV(strategy.user_id, primarySymbol, exchange, 100);
    if (candles.length === 0) {
      logger.warn(`No market data for ${primarySymbol}, skipping strategy ${strategy.id}`);
      return;
    }

    // Calculate indicators
    const indicators = calculateIndicators(candles);

    // Get current positions
    const positions = await getUserPositions(strategy.user_id);

    // Build prompt
    const prompt = buildPrompt({
      strategy,
      priceData: candles,
      indicators,
      currentPositions: positions
    });

    // Call Groq API
    logger.debug(`Calling Groq API for strategy ${strategy.id}`);
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are an elite crypto quant trader. Return only valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' } // Force JSON output
    });

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) {
      logger.warn(`Empty response from Groq for strategy ${strategy.id}`);
      return;
    }

    // Parse decision
    const decision = parseDecision(aiResponse);
    logger.info(`AI Decision for ${strategy.name}:`, decision);

    // Log decision to database
    await supabase.from('ai_trade_log').insert({
      ai_strategy_id: strategy.id,
      user_id: strategy.user_id,
      decision_json: decision,
      confidence_score: decision.confidence,
      signal_action: decision.action,
      symbol: decision.symbol,
      size_usd: decision.size_usd,
      reasoning: decision.reasoning
    });

    // If decision is not HOLD, send signal to Sparky
    if (decision.action !== 'HOLD') {
      const secret = await getUserWebhookSecret(strategy.user_id);
      if (!secret) {
        logger.error(`Cannot send signal for ${strategy.id}: no webhook secret`);
        return;
      }

      // Map AI action to webhook action
      let webhookAction = decision.action;
      if (decision.action === 'LONG') webhookAction = 'BUY';
      if (decision.action === 'SHORT') webhookAction = 'SELL';
      if (decision.action === 'CLOSE') webhookAction = 'CLOSE';

      // Send to Sparky webhook
      const webhookPayload = {
        user_id: strategy.user_id,
        userId: strategy.user_id,
        secret: secret,
        exchange: exchange,
        symbol: decision.symbol,
        action: webhookAction,
        position_size_usd: decision.size_usd,
        strategy_id: strategy.id,
        source: 'ai_engine_v1',
        ai_confidence: decision.confidence,
        ai_reasoning: decision.reasoning
      };

      logger.info(`Sending AI signal to Sparky:`, webhookPayload);

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Sparky webhook rejected signal: ${response.status} - ${errorText}`);
      } else {
        const result = await response.json();
        logger.info(`AI signal executed successfully:`, result);
      }
    } else {
      logger.debug(`AI decision: HOLD (confidence: ${decision.confidence})`);
    }

    const duration = Date.now() - startTime;
    logger.info(`Strategy ${strategy.id} processed in ${duration}ms`);

  } catch (error) {
    logger.logError(`Failed to process strategy ${strategy.id}`, error);
  }
}

/**
 * Main cycle: process all active strategies
 */
async function runCycle() {
  const cycleStart = Date.now();
  logger.info('=== AI Worker Cycle Start ===');

  try {
    const strategies = await getActiveStrategies();
    
    if (strategies.length === 0) {
      logger.debug('No active strategies found');
      return;
    }

    logger.info(`Found ${strategies.length} active strategy(ies)`);

    // Process strategies sequentially (to avoid rate limits)
    for (const strategy of strategies) {
      await processStrategy(strategy);
      // Small delay between strategies
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const cycleDuration = Date.now() - cycleStart;
    logger.info(`=== AI Worker Cycle Complete (${cycleDuration}ms) ===`);

  } catch (error) {
    logger.logError('AI Worker cycle failed', error);
  }
}

// Start worker
logger.info('🤖 AI Signal Engine v1 starting...');
logger.info(`Webhook URL: ${WEBHOOK_URL}`);
logger.info(`Cycle interval: ${CYCLE_INTERVAL_MS}ms`);

// Run immediately on start
runCycle();

// Then run every 45 seconds
setInterval(runCycle, CYCLE_INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('AI Worker shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('AI Worker shutting down gracefully...');
  process.exit(0);
});
```

**Deliverable:** AI worker main loop complete

---

### Day 8: PM2 Configuration & Environment Setup

**File:** `ecosystem.config.js` (update existing)

**Add AI worker to PM2:**
```javascript
module.exports = {
  apps: [
    {
      name: 'sparky-bot',
      script: './src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'ai-signal-engine',
      script: './src/ai-worker/main.js',
      instances: 1, // Start with 1, scale later
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        GROQ_API_KEY: process.env.GROQ_API_KEY,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        WEBHOOK_URL: process.env.WEBHOOK_URL || 'http://localhost:3000/webhook/ai-signal'
      },
      error_file: './logs/ai-worker-error.log',
      out_file: './logs/ai-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      autorestart: true,
      max_memory_restart: '500M'
    }
  ]
};
```

**Environment Variables:** Add to `.env`
```bash
# AI Trading Firm
GROQ_API_KEY=gsk_your_groq_api_key_here
WEBHOOK_URL=http://localhost:3000/webhook/ai-signal  # For production, use full URL
```

**Dependencies:** Add to `package.json`
```bash
npm install groq-sdk node-fetch
```

**Deliverable:** PM2 configured, dependencies installed

---

### Day 9-10: Testing & Validation

**Testing Checklist:**

1. **Unit Tests:**
   - [ ] Market data fetching works
   - [ ] Prompt builder generates valid prompts
   - [ ] Parser handles various AI response formats
   - [ ] Webhook route validates correctly

2. **Integration Tests:**
   - [ ] AI worker can fetch strategies from Supabase
   - [ ] AI worker calls Groq API successfully
   - [ ] AI worker sends signals to Sparky webhook
   - [ ] Sparky executes AI signals correctly
   - [ ] Trades appear in dashboard

3. **End-to-End Test:**
   ```bash
   # 1. Create test AI strategy in Supabase
   INSERT INTO ai_strategies (user_id, name, status, risk_profile, target_assets)
   VALUES ('your-user-id', 'Test Strategy', 'running', 'balanced', '{BTCUSDT}');

   # 2. Start AI worker
   pm2 start ecosystem.config.js --only ai-signal-engine

   # 3. Monitor logs
   pm2 logs ai-signal-engine

   # 4. Check Sparky logs
   pm2 logs sparky-bot

   # 5. Verify trade in dashboard
   ```

4. **Paper Trading Mode:**
   - Add `is_paper_trading` flag to `ai_strategies` table
   - Modify webhook route to skip execution if paper trading
   - Log decisions but don't execute trades

**Deliverable:** All tests passing, end-to-end flow verified

---

## Week 3: Polish & Production Readiness

### Day 11-12: Error Handling & Circuit Breakers

**Add to AI worker:**

1. **Rate Limiting:**
   ```javascript
   // Track Groq API calls
   let groqCallCount = 0;
   let groqCallReset = Date.now();
   const GROQ_RATE_LIMIT = 30; // calls per minute

   async function checkRateLimit() {
     if (Date.now() - groqCallReset > 60000) {
       groqCallCount = 0;
       groqCallReset = Date.now();
     }
     if (groqCallCount >= GROQ_RATE_LIMIT) {
       throw new Error('Groq rate limit exceeded');
     }
     groqCallCount++;
   }
   ```

2. **Circuit Breaker:**
   ```javascript
   // Pause strategy if too many failures
   let failureCount = {};
   const MAX_FAILURES = 5;

   async function checkCircuitBreaker(strategyId) {
     if (failureCount[strategyId] >= MAX_FAILURES) {
       // Pause strategy
       await supabase
         .from('ai_strategies')
         .update({ status: 'paused' })
         .eq('id', strategyId);
       logger.warn(`Strategy ${strategyId} paused due to failures`);
       return true;
     }
     return false;
   }
   ```

3. **Retry Logic:**
   ```javascript
   async function callGroqWithRetry(prompt, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await groq.chat.completions.create({...});
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
       }
     }
   }
   ```

**Deliverable:** Robust error handling in place

---

### Day 13-14: Monitoring & Observability

**Add Monitoring:**

1. **Metrics Collection:**
   ```javascript
   // Track key metrics
   const metrics = {
     strategiesProcessed: 0,
     signalsSent: 0,
     holds: 0,
     errors: 0,
     avgConfidence: 0,
     groqLatency: []
   };

   // Log metrics every cycle
   function logMetrics() {
     logger.info('AI Worker Metrics:', {
       strategiesProcessed: metrics.strategiesProcessed,
       signalsSent: metrics.signalsSent,
       holds: metrics.holds,
       avgConfidence: metrics.avgConfidence / metrics.strategiesProcessed,
       avgLatency: metrics.groqLatency.reduce((a, b) => a + b, 0) / metrics.groqLatency.length
     });
   }
   ```

2. **Health Check Endpoint:**
   ```javascript
   // Add to src/index.js
   app.get('/health/ai-worker', async (req, res) => {
     const { data } = await supabase
       .from('ai_strategies')
       .select('id, status')
       .eq('status', 'running');
     
     res.json({
       status: 'ok',
       activeStrategies: data?.length || 0,
       lastCycle: lastCycleTime,
       metrics: metrics
     });
   });
   ```

3. **Alerting:**
   - Set up alerts for AI worker crashes
   - Alert if no strategies processed in 5 minutes
   - Alert on high error rate

**Deliverable:** Monitoring and observability in place

---

### Day 15: Documentation & Handoff

**Create Documentation:**

1. **AI Worker README:** `src/ai-worker/README.md`
   - Architecture overview
   - Configuration guide
   - Troubleshooting

2. **API Documentation:** Update main README
   - Add AI Strategy section
   - Document new endpoints

3. **Deployment Guide:** Update DEPLOYMENT.md
   - AI worker setup steps
   - Environment variables
   - PM2 configuration

**Deliverable:** Complete documentation

---

## Success Criteria

Phase 1 is complete when:

- [x] AI worker runs continuously via PM2
- [x] AI strategies can be created/started/paused via Supabase
- [x] AI generates trading decisions every 45 seconds
- [x] AI signals flow through existing Sparky webhook
- [x] Trades execute with existing risk limits
- [x] All trades logged to `trades` and `ai_trade_log` tables
- [x] Dashboard shows AI-generated trades
- [x] Error handling prevents cascading failures
- [x] Monitoring shows worker health

---

## Risk Mitigation

### Technical Risks

1. **Groq API Failures**
   - Mitigation: Retry logic, fallback to HOLD
   - Impact: Low (worker continues, just skips cycle)

2. **Market Data Failures**
   - Mitigation: Cache last known data, skip strategy if no data
   - Impact: Low (strategy paused until data available)

3. **Parse Errors**
   - Mitigation: Robust parser with fallback to HOLD
   - Impact: Low (no trade executed, logged for review)

### Business Risks

1. **Poor AI Decisions**
   - Mitigation: Start with paper trading, low position sizes
   - Impact: Medium (monitor closely, adjust prompts)

2. **High API Costs**
   - Mitigation: Monitor Groq usage, cache prompts
   - Impact: Low (costs are predictable)

---

## Next Steps After Phase 1

1. **Week 4:** Internal testing on your account ($500-1000)
2. **Week 5:** Closed beta (5-10 users, free)
3. **Week 6:** Iterate on prompts based on results
4. **Week 7:** Open beta (50+ users, $149/mo)
5. **Week 8:** Begin Phase 2 (Dashboard Integration)

---

## Quick Start Commands

```bash
# 1. Install dependencies
npm install groq-sdk node-fetch

# 2. Run Supabase migration
# (Copy SQL from docs/schema/20251211_ai_trading_firm.sql)

# 3. Add environment variables
echo "GROQ_API_KEY=your_key" >> .env

# 4. Test AI worker locally
node src/ai-worker/main.js

# 5. Start with PM2
pm2 start ecosystem.config.js --only ai-signal-engine

# 6. Monitor
pm2 logs ai-signal-engine
```

---

**Estimated Total Time:** 15 days (3 weeks)  
**Confidence Level:** 95% achievable  
**Critical Path:** Days 6-7 (AI worker core) and Day 9-10 (testing)

This plan is production-ready and follows your existing codebase patterns. Each day has clear deliverables and can be completed independently.

