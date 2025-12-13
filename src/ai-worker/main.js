/**
 * AI Signal Engine - Main Worker
 * 
 * This worker runs continuously, processing active AI strategies:
 * 1. Fetches active strategies from Supabase
 * 2. Gets market data for each strategy
 * 3. Calls Groq API for trading decisions
 * 4. Sends signals to Sparky webhook endpoint
 * 5. Logs all decisions for audit and training
 * 
 * Runs every 45 seconds via setInterval
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const logger = require('../utils/logger');
const { Groq } = require('groq-sdk');
const { get1mOHLCV, getUserPositions, calculateIndicators, getOrderBookSnapshot } = require('./utils/marketData');
const { buildPrompt } = require('./prompts/balanced');
const { parseDecision } = require('./utils/parser');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Groq client
if (!process.env.GROQ_API_KEY) {
  logger.error('❌ GROQ_API_KEY not found in environment variables');
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Configuration
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
const CYCLE_INTERVAL_MS = 45_000; // 45 seconds

// Metrics tracking
const metrics = {
  strategiesProcessed: 0,
  signalsSent: 0,
  holds: 0,
  errors: 0,
  groqCalls: 0,
  groqLatency: []
};

/**
 * Get active AI strategies from database
 * @returns {Promise<Array>} Array of active strategy objects
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
 * Get user's webhook secret from Supabase
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Webhook secret or null if not found
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

    if (error) {
      logger.warn(`Error fetching webhook secret for user ${userId}:`, error);
      return null;
    }

    if (!data || !data.webhook_secret) {
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
 * @param {Object} strategy - Strategy configuration from database
 */
async function processStrategy(strategy) {
  const startTime = Date.now();
  
  try {
    logger.info(`📊 Processing AI strategy: ${strategy.name} (${strategy.id})`);

    // Determine exchange (default to aster for crypto)
    const exchange = 'aster'; // Can be made dynamic later
    const primarySymbol = strategy.target_assets && strategy.target_assets.length > 0
      ? strategy.target_assets[0].replace(/\//g, '').replace(/:PERP$/, '').toUpperCase()
      : 'BTCUSDT';

    // Fetch market data
    logger.debug(`Fetching market data for ${primarySymbol}...`);
    const candles = await get1mOHLCV(strategy.user_id, primarySymbol, exchange, 100);
    
    if (candles.length === 0) {
      logger.warn(`No market data for ${primarySymbol}, skipping strategy ${strategy.id}`);
      metrics.errors++;
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
    logger.debug(`Calling Groq API for strategy ${strategy.id}...`);
    const groqStartTime = Date.now();
    
    let completion;
    try {
      completion = await groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an elite crypto quant trader. Return only valid JSON, no markdown, no explanation.'
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
      
      const groqLatency = Date.now() - groqStartTime;
      metrics.groqCalls++;
      metrics.groqLatency.push(groqLatency);
      
      // Keep only last 100 latency measurements
      if (metrics.groqLatency.length > 100) {
        metrics.groqLatency.shift();
      }
    } catch (groqError) {
      logger.logError(`Groq API error for strategy ${strategy.id}`, groqError);
      metrics.errors++;
      return;
    }

    const aiResponse = completion.choices[0]?.message?.content;
    if (!aiResponse) {
      logger.warn(`Empty response from Groq for strategy ${strategy.id}`);
      metrics.errors++;
      return;
    }

    // Parse decision
    const decision = parseDecision(aiResponse);
    logger.info(`🤖 AI Decision for ${strategy.name}:`, {
      action: decision.action,
      symbol: decision.symbol,
      size_usd: decision.size_usd,
      confidence: decision.confidence,
      reasoning: decision.reasoning
    });

            // ML-READY LOGGING — This is your permanent moat (Tier 3 ready)
    try {
      // Fetch orderbook for microstructure edge
      const orderbook = await getOrderBookSnapshot(strategy.user_id, primarySymbol, exchange, 10);

      await supabase.from('ai_trade_decisions').insert({
        user_id: strategy.user_id,
        strategy_id: strategy.id,
        decided_at: new Date(),

        // Full market context
        market_snapshot: {
          symbol: primarySymbol,
          candles: candles.slice(-100),
          current_price: indicators.currentPrice,
          price_change_24h: indicators.priceChange24h
        },
        orderbook_snapshot: orderbook, // Microstructure alpha
        technical_indicators: indicators,

        // Portfolio state
        portfolio_state: {
          open_positions: positions,
          total_unrealized_pnl: positions.reduce((sum, p) => sum + (p.unrealized_pnl_usd || 0), 0),
          position_count: positions.length
        },

        // Model provenance
        model_versions: ['llama-3.1-70b-versatile'],
        raw_responses: { llama: aiResponse },
        parsed_decision: decision,
        confidence_final: decision.confidence,

        // Execution flag
        signal_sent: decision.action !== 'HOLD'
      });

      logger.info('Decision logged to ai_trade_decisions (ML-ready with orderbook)');
    } catch (logError) {
      logger.logError('Failed to log rich AI decision', logError);
      // Don't crash the whole cycle if logging fails
    }

    // If decision is not HOLD, send signal to Sparky
    if (decision.action !== 'HOLD') {
      const secret = await getUserWebhookSecret(strategy.user_id);
      if (!secret) {
        logger.error(`Cannot send signal for ${strategy.id}: no webhook secret`);
        metrics.errors++;
        return;
      }

      // Map AI action to webhook action
      let webhookAction = decision.action;
      if (decision.action === 'LONG') webhookAction = 'BUY';
      if (decision.action === 'SHORT') webhookAction = 'SELL';
      if (decision.action === 'CLOSE') webhookAction = 'CLOSE';

      // Prepare webhook payload (matches format expected by main webhook handler)
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
        // AI-specific metadata (will be logged but not used in execution)
        ai_confidence: decision.confidence,
        ai_reasoning: decision.reasoning
      };

      logger.info(`📤 Sending AI signal to Sparky:`, {
        exchange,
        symbol: decision.symbol,
        action: webhookAction,
        size_usd: decision.size_usd,
        confidence: decision.confidence
      });

      try {
        // Call main webhook endpoint directly
        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
          timeout: 10000 // 10 second timeout
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Sparky webhook rejected signal: ${response.status} - ${errorText}`);
          metrics.errors++;
        } else {
          const result = await response.json();
          logger.info(`✅ AI signal executed successfully:`, {
            success: result.success,
            message: result.message
          });
          metrics.signalsSent++;
        }
      } catch (fetchError) {
        logger.logError('Failed to send signal to Sparky', fetchError);
        metrics.errors++;
      }
    } else {
      logger.debug(`AI decision: HOLD (confidence: ${decision.confidence})`);
      metrics.holds++;
    }

    const duration = Date.now() - startTime;
    logger.info(`✅ Strategy ${strategy.id} processed in ${duration}ms`);
    metrics.strategiesProcessed++;

  } catch (error) {
    logger.logError(`Failed to process strategy ${strategy.id}`, error);
    metrics.errors++;
  }
}

/**
 * Main cycle: process all active strategies
 */
async function runCycle() {
  const cycleStart = Date.now();
  logger.info('=== 🤖 AI Worker Cycle Start ===');

  try {
    const strategies = await getActiveStrategies();
    
    if (strategies.length === 0) {
      logger.debug('No active strategies found');
      return;
    }

    logger.info(`Found ${strategies.length} active strategy(ies)`);

    // Process strategies sequentially (to avoid rate limits and ensure proper logging)
    for (const strategy of strategies) {
      await processStrategy(strategy);
      // Small delay between strategies to avoid overwhelming APIs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const cycleDuration = Date.now() - cycleStart;
    logger.info(`=== ✅ AI Worker Cycle Complete (${cycleDuration}ms) ===`);

    // Log metrics every 10 cycles
    if (metrics.strategiesProcessed % 10 === 0) {
      const avgLatency = metrics.groqLatency.length > 0
        ? metrics.groqLatency.reduce((a, b) => a + b, 0) / metrics.groqLatency.length
        : 0;
      
      logger.info('📊 AI Worker Metrics:', {
        strategiesProcessed: metrics.strategiesProcessed,
        signalsSent: metrics.signalsSent,
        holds: metrics.holds,
        errors: metrics.errors,
        groqCalls: metrics.groqCalls,
        avgGroqLatency: `${avgLatency.toFixed(0)}ms`
      });
    }

  } catch (error) {
    logger.logError('AI Worker cycle failed', error);
    metrics.errors++;
  }
}

// Start worker
logger.info('🤖 AI Signal Engine v1 starting...');
logger.info(`Webhook URL: ${WEBHOOK_URL}`);
logger.info(`Cycle interval: ${CYCLE_INTERVAL_MS}ms`);
logger.info(`Groq Model: llama-3.1-70b-versatile`);

// Validate environment
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.error('❌ Missing Supabase credentials in environment variables');
  process.exit(1);
}

// Run immediately on start
runCycle().catch(error => {
  logger.logError('Initial cycle failed', error);
  process.exit(1);
});

// Then run every 45 seconds
const intervalId = setInterval(() => {
  runCycle().catch(error => {
    logger.logError('Scheduled cycle failed', error);
  });
}, CYCLE_INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('AI Worker shutting down gracefully...');
  clearInterval(intervalId);
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('AI Worker shutting down gracefully...');
  clearInterval(intervalId);
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.logError('Uncaught exception in AI worker', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in AI worker', { reason, promise });
});

