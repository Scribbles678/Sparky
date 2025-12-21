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
const { validateMarketData } = require('./utils/dataValidation');
const { performRiskChecks } = require('./utils/riskManagement');
const { 
  prepareMLFeatures, 
  getMLPrediction, 
  checkMLServiceHealth, 
  mlPredictionToDecision 
} = require('./utils/mlPrediction');
const { normalizeConfig } = require('./utils/configReader');
const { createAIIdea } = require('./utils/aiIdeas');

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
  groqLatency: [],
  // Phase 2: ML metrics
  mlCalls: 0,
  mlLatency: [],
  mlDecisions: 0,
  llmDecisions: 0,
  costSavings: 0 // Estimated savings from using ML
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
 * Check if strategy has exceeded LLM budget
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<boolean>} True if budget exceeded
 */
async function checkLLMBudgetExceeded(strategyId) {
  try {
    const { data, error } = await supabase.rpc('check_llm_budget_exceeded', {
      p_strategy_id: strategyId
    });

    if (error) {
      logger.warn(`Failed to check LLM budget for strategy ${strategyId}:`, error.message);
      return false; // Default to allowing if check fails
    }

    return data === true;
  } catch (error) {
    logger.warn(`Exception checking LLM budget:`, error.message);
    return false;
  }
}

/**
 * Update LLM usage tracking
 * @param {string} strategyId - Strategy ID
 * @param {string} userId - User ID
 * @param {boolean} usedLLM - Whether LLM was used
 * @param {number} costUsd - Estimated cost in USD
 */
async function updateLLMUsage(strategyId, userId, usedLLM, costUsd = 0.0001) {
  try {
    await supabase.rpc('update_ai_strategy_llm_usage', {
      p_strategy_id: strategyId,
      p_user_id: userId,
      p_used_llm: usedLLM,
      p_cost_usd: costUsd
    });
  } catch (error) {
    logger.warn(`Failed to update LLM usage tracking:`, error.message);
    // Don't fail the whole process if tracking fails
  }
}

/**
 * Determine which model to use based on strategy settings
 * Phase 1: Uses normalized config (from AI Studio)
 * @param {Object} strategy - Strategy configuration
 * @param {Object} mlPrediction - ML prediction result (if available)
 * @param {Object} config - Normalized config (optional, will normalize if not provided)
 * @returns {Promise<{useML: boolean, reason: string}>}
 */
async function determineModelUsage(strategy, mlPrediction, config = null) {
  // Phase 1: Use normalized config if provided, otherwise normalize
  const normalizedConfig = config || normalizeConfig(strategy);
  
  const usageMode = normalizedConfig.hybrid_mode?.type || strategy.llm_usage_mode || 'hybrid';
  const mlThreshold = normalizedConfig.confidence_threshold !== undefined
    ? normalizedConfig.confidence_threshold
    : strategy.ml_confidence_threshold || 
      (strategy.risk_profile === 'conservative' ? 0.80 :
       strategy.risk_profile === 'aggressive' ? 0.60 : 0.70);

  // Check if budget exceeded
  const budgetExceeded = await checkLLMBudgetExceeded(strategy.id);
  if (budgetExceeded) {
    return { useML: true, reason: 'LLM budget exceeded - using ML only' };
  }

  // Mode: ml_only
  if (usageMode === 'ml_only') {
    return { useML: true, reason: 'Strategy set to ML-only mode' };
  }

  // Mode: llm_only
  if (usageMode === 'llm_only') {
    return { useML: false, reason: 'Strategy set to LLM-only mode' };
  }

  // Mode: hybrid (threshold-based)
  if (usageMode === 'hybrid') {
    if (!mlPrediction || !mlPrediction.success) {
      return { useML: false, reason: 'ML service unavailable - using LLM' };
    }

    if (mlPrediction.confidence >= mlThreshold) {
      return { 
        useML: true, 
        reason: `ML confidence ${(mlPrediction.confidence * 100).toFixed(1)}% >= threshold ${(mlThreshold * 100).toFixed(1)}%` 
      };
    } else {
      return { 
        useML: false, 
        reason: `ML confidence ${(mlPrediction.confidence * 100).toFixed(1)}% < threshold ${(mlThreshold * 100).toFixed(1)}%` 
      };
    }
  }

  // Mode: smart (percentage-based)
  if (usageMode === 'smart') {
    const llmPercent = normalizedConfig.hybrid_mode?.llm_percent || strategy.llm_usage_percent || 20.0;
    
    // Simple implementation: use random percentage
    // In production, could track actual usage and ensure exact percentage
    const random = Math.random() * 100;
    
    if (random < llmPercent) {
      return { useML: false, reason: `Smart mode: ${llmPercent}% LLM usage target` };
    } else {
      if (!mlPrediction || !mlPrediction.success) {
        return { useML: false, reason: 'ML service unavailable - using LLM' };
      }
      return { useML: true, reason: `Smart mode: ${(100 - llmPercent).toFixed(1)}% ML usage target` };
    }
  }

  // Default: hybrid
  return { useML: false, reason: 'Default: using LLM' };
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
 * Check if strategy has reached daily trade limit
 * Phase 1: Circuit breaker to prevent overtrading
 * @param {string} strategyId - Strategy ID
 * @param {Object} config - Normalized config
 * @returns {Promise<{allowed: boolean, reason?: string, count?: number}>}
 */
async function checkDailyTradeLimit(strategyId, config) {
  try {
    // Skip if no limit configured
    if (!config.daily_trade_limit || config.daily_trade_limit <= 0) {
      return { allowed: true };
    }

    // Get start of today in UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Count trades sent today
    const { count, error } = await supabase
      .from('ai_trade_decisions')
      .select('*', { count: 'exact', head: true })
      .eq('strategy_id', strategyId)
      .eq('signal_sent', true)
      .gte('decided_at', today.toISOString());

    if (error) {
      logger.warn(`Failed to check daily trade limit: ${error.message}`);
      return { allowed: true }; // Fail open if check fails
    }

    const tradeCount = count || 0;

    if (tradeCount >= config.daily_trade_limit) {
      return {
        allowed: false,
        reason: `Daily trade limit reached (${tradeCount}/${config.daily_trade_limit})`,
        count: tradeCount
      };
    }

    return {
      allowed: true,
      count: tradeCount
    };
  } catch (error) {
    logger.warn(`Exception checking daily trade limit: ${error.message}`);
    return { allowed: true }; // Fail open on exception
  }
}

/**
 * Calculate Kelly Criterion position sizing
 * Phase A: Smart position sizing based on win rate and avg profit
 * @param {string} strategyId - Strategy ID
 * @param {number} baseSize - Base position size from config
 * @param {number} kellyFraction - Kelly fraction (default 0.25 for 1/4 Kelly)
 * @returns {Promise<{size: number, metrics: Object}>}
 */
async function calculateKellyPositionSize(strategyId, baseSize, kellyFraction = 0.25) {
  try {
    // Need at least 30 trades for statistical significance
    const MIN_TRADES = 30;

    // Get recent trade history for this strategy
    const { data: trades, error } = await supabase
      .from('trades')
      .select('pnl, is_winner')
      .eq('strategy_id', strategyId)
      .not('pnl', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100); // Last 100 trades for calculation

    if (error || !trades || trades.length < MIN_TRADES) {
      // Not enough data - use base size
      return {
        size: baseSize,
        metrics: {
          insufficient_data: true,
          trade_count: trades?.length || 0,
          required: MIN_TRADES
        }
      };
    }

    // Calculate win rate
    const winners = trades.filter(t => t.is_winner).length;
    const winRate = winners / trades.length;

    // Calculate average win and loss (in percentage terms)
    const winningTrades = trades.filter(t => t.is_winner && t.pnl > 0);
    const losingTrades = trades.filter(t => !t.is_winner && t.pnl < 0);

    if (winningTrades.length === 0 || losingTrades.length === 0) {
      // Need both wins and losses for Kelly
      return {
        size: baseSize,
        metrics: {
          insufficient_variance: true,
          trade_count: trades.length
        }
      };
    }

    const avgWin = winningTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / winningTrades.length;
    const avgLoss = losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losingTrades.length;

    // Kelly Criterion: f* = (p * b - q) / b
    // Where:
    //   p = win rate
    //   q = 1 - p (loss rate)
    //   b = win/loss ratio (avgWin / avgLoss)
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - p;

    let kellyPct = (p * b - q) / b;

    // Apply Kelly fraction for safety (1/4 Kelly is conservative)
    kellyPct = kellyPct * kellyFraction;

    // Clamp between 0.5% and 10% (safety bounds)
    kellyPct = Math.max(0.005, Math.min(kellyPct, 0.10));

    // Calculate optimal position size
    const kellySize = baseSize * (kellyPct / 0.01); // Normalize to base size

    logger.info(`📊 Kelly Sizing: ${strategyId} | Win Rate: ${(winRate * 100).toFixed(1)}% | Avg W/L: ${b.toFixed(2)} | Kelly: ${(kellyPct * 100).toFixed(2)}% | Size: $${kellySize.toFixed(2)}`);

    return {
      size: kellySize,
      metrics: {
        win_rate: winRate,
        avg_win: avgWin,
        avg_loss: avgLoss,
        win_loss_ratio: b,
        kelly_pct: kellyPct,
        kelly_fraction: kellyFraction,
        trade_count: trades.length,
        base_size: baseSize,
        kelly_size: kellySize
      }
    };

  } catch (error) {
    logger.warn(`Exception calculating Kelly size: ${error.message}`);
    return {
      size: baseSize,
      metrics: { error: error.message }
    };
  }
}

/**
 * Check portfolio position limits
 * Phase A: Prevent over-concentration in single assets
 * @param {string} userId - User ID
 * @param {string} symbol - Symbol to trade
 * @param {number} positionSizeUsd - Proposed position size in USD
 * @returns {Promise<{allowed: boolean, reason?: string, metrics?: Object}>}
 */
async function checkPortfolioLimits(userId, symbol, positionSizeUsd) {
  try {
    const MAX_POSITIONS = 10;
    const MAX_SYMBOL_PCT = 0.20; // 20% max in single symbol
    const MAX_CORRELATED_PCT = 0.50; // 50% max in correlated assets

    // Get user's current open positions
    const { data: positions, error } = await supabase
      .from('trades')
      .select('symbol, size_usd, asset_type')
      .eq('user_id', userId)
      .is('exit_time', null) // Open positions only
      .neq('status', 'closed');

    if (error) {
      logger.warn(`Failed to check portfolio limits: ${error.message}`);
      return { allowed: true }; // Fail open
    }

    // Check 1: Max open positions
    if (positions && positions.length >= MAX_POSITIONS) {
      return {
        allowed: false,
        reason: `Portfolio limit: Max ${MAX_POSITIONS} open positions (currently ${positions.length})`,
        metrics: {
          open_positions: positions.length,
          max_positions: MAX_POSITIONS
        }
      };
    }

    // Calculate total portfolio value
    const totalPortfolioValue = (positions || []).reduce((sum, p) => sum + (p.size_usd || 0), 0) + positionSizeUsd;

    // Check 2: Max symbol concentration
    const existingSymbolPosition = (positions || []).find(p => p.symbol === symbol);
    const symbolExposure = (existingSymbolPosition?.size_usd || 0) + positionSizeUsd;
    const symbolPct = symbolExposure / totalPortfolioValue;

    if (symbolPct > MAX_SYMBOL_PCT) {
      return {
        allowed: false,
        reason: `Symbol concentration: Max ${(MAX_SYMBOL_PCT * 100).toFixed(0)}% in ${symbol} (would be ${(symbolPct * 100).toFixed(1)}%)`,
        metrics: {
          symbol_exposure: symbolExposure,
          portfolio_value: totalPortfolioValue,
          symbol_pct: symbolPct,
          max_pct: MAX_SYMBOL_PCT
        }
      };
    }

    // Check 3: Max correlated asset concentration (BTC + ETH + BNB)
    const correlatedSymbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    const isCorrelated = correlatedSymbols.some(s => symbol.includes(s.replace('/USDT', '')) || symbol === s);

    if (isCorrelated) {
      const correlatedExposure = (positions || [])
        .filter(p => correlatedSymbols.some(s => p.symbol?.includes(s.replace('/USDT', '')) || p.symbol === s))
        .reduce((sum, p) => sum + (p.size_usd || 0), 0) + positionSizeUsd;

      const correlatedPct = correlatedExposure / totalPortfolioValue;

      if (correlatedPct > MAX_CORRELATED_PCT) {
        return {
          allowed: false,
          reason: `Correlated exposure: Max ${(MAX_CORRELATED_PCT * 100).toFixed(0)}% in BTC/ETH/BNB (would be ${(correlatedPct * 100).toFixed(1)}%)`,
          metrics: {
            correlated_exposure: correlatedExposure,
            portfolio_value: totalPortfolioValue,
            correlated_pct: correlatedPct,
            max_pct: MAX_CORRELATED_PCT
          }
        };
      }
    }

    // All checks passed
    return {
      allowed: true,
      metrics: {
        open_positions: positions?.length || 0,
        portfolio_value: totalPortfolioValue,
        symbol_exposure: symbolExposure,
        symbol_pct: symbolPct
      }
    };

  } catch (error) {
    logger.warn(`Exception checking portfolio limits: ${error.message}`);
    return { allowed: true }; // Fail open on exception
  }
}

/**
 * Check drawdown circuit breaker
 * Phase A: Auto-pause strategy if drawdown exceeds limit
 * @param {string} strategyId - Strategy ID
 * @param {number} drawdownLimit - Drawdown limit (default 0.20 = 20%)
 * @returns {Promise<{should_pause: boolean, reason?: string, metrics?: Object}>}
 */
async function checkDrawdownCircuitBreaker(strategyId, drawdownLimit = 0.20) {
  try {
    // Get strategy's peak equity and current equity
    const { data: trades, error } = await supabase
      .from('trades')
      .select('pnl, created_at')
      .eq('strategy_id', strategyId)
      .not('pnl', 'is', null)
      .order('created_at', { ascending: true });

    if (error || !trades || trades.length === 0) {
      // No trade history - no drawdown risk
      return { should_pause: false };
    }

    // Calculate running equity curve
    let runningEquity = 0;
    let peakEquity = 0;
    let currentDrawdown = 0;
    let maxDrawdown = 0;

    for (const trade of trades) {
      runningEquity += trade.pnl;
      peakEquity = Math.max(peakEquity, runningEquity);
      
      if (peakEquity > 0) {
        currentDrawdown = (peakEquity - runningEquity) / peakEquity;
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
      }
    }

    // Check if current drawdown exceeds limit
    if (currentDrawdown >= drawdownLimit) {
      // Auto-pause strategy
      await supabase
        .from('ai_strategies')
        .update({ status: 'paused' })
        .eq('id', strategyId);

      logger.warn(`🛑 CIRCUIT BREAKER: Strategy ${strategyId} auto-paused due to ${(currentDrawdown * 100).toFixed(1)}% drawdown (limit: ${(drawdownLimit * 100).toFixed(0)}%)`);

      return {
        should_pause: true,
        reason: `Drawdown limit exceeded: ${(currentDrawdown * 100).toFixed(1)}% (limit: ${(drawdownLimit * 100).toFixed(0)}%)`,
        metrics: {
          peak_equity: peakEquity,
          current_equity: runningEquity,
          current_drawdown: currentDrawdown,
          max_drawdown: maxDrawdown,
          drawdown_limit: drawdownLimit
        }
      };
    }

    return {
      should_pause: false,
      metrics: {
        peak_equity: peakEquity,
        current_equity: runningEquity,
        current_drawdown: currentDrawdown,
        max_drawdown: maxDrawdown,
        drawdown_limit: drawdownLimit
      }
    };

  } catch (error) {
    logger.warn(`Exception checking drawdown: ${error.message}`);
    return { should_pause: false }; // Fail open
  }
}

/**
 * Calculate volatility-adjusted position size based on ATR
 * Phase 2 Week 1: Risk-based position sizing
 * @param {number} accountBalance - Total account balance
 * @param {number} riskPerTrade - Risk per trade as decimal (e.g., 0.01 = 1%)
 * @param {number} entryPrice - Entry price for the asset
 * @param {number} atr - Average True Range
 * @param {number} atrMultiplier - Stop loss distance (default 2× ATR)
 * @returns {number} Position size in USD
 */
function calculateVolatilityAdjustedSize(
  accountBalance,
  riskPerTrade,
  entryPrice,
  atr,
  atrMultiplier = 2
) {
  // Risk amount in USD
  const riskAmount = accountBalance * riskPerTrade;
  
  // Stop loss distance in price units
  const stopDistance = atr * atrMultiplier;
  
  // Stop loss as percentage of entry price
  const stopPercent = stopDistance / entryPrice;
  
  // Position size = risk amount / stop percentage
  // Example: Risk $100, stop at 4% = position size $2,500
  const positionSize = riskAmount / stopPercent;
  
  return positionSize;
}

/**
 * Estimate slippage based on order book depth
 * Phase 2 Week 2: Transaction cost modeling
 * @param {Object} orderbook - Order book snapshot {bids: [[price, size]], asks: [[price, size]]}
 * @param {number} orderSize - Order size (in quote currency, e.g., USD)
 * @param {string} side - 'buy' or 'sell'
 * @returns {Object} Slippage estimate
 */
function estimateSlippage(orderbook, orderSize, side) {
  if (!orderbook || !orderbook.bids || !orderbook.asks) {
    return {
      estimatedPrice: null,
      slippageBps: 0,
      filledSize: 0,
      wouldFillCompletely: false,
      error: 'No orderbook data'
    };
  }

  const levels = side === 'buy' ? orderbook.asks : orderbook.bids;
  
  if (!levels || levels.length === 0) {
    return {
      estimatedPrice: null,
      slippageBps: 0,
      filledSize: 0,
      wouldFillCompletely: false,
      error: 'No order book levels'
    };
  }

  let filled = 0;
  let totalCost = 0;
  
  // Walk through order book levels
  for (const [price, size] of levels) {
    const sizeInQuote = price * size; // Convert to USD
    const fillSize = Math.min(sizeInQuote, orderSize - filled);
    
    totalCost += fillSize;
    filled += fillSize;
    
    if (filled >= orderSize) break;
  }
  
  // Calculate average execution price
  const avgPrice = filled > 0 ? totalCost / filled : levels[0][0];
  
  // Calculate mid price (fair value)
  const bestBid = orderbook.bids[0][0];
  const bestAsk = orderbook.asks[0][0];
  const midPrice = (bestBid + bestAsk) / 2;
  
  // Slippage in basis points (1 bp = 0.01%)
  const slippageBps = ((avgPrice - midPrice) / midPrice) * 10000;
  
  return {
    estimatedPrice: avgPrice,
    slippageBps: Math.abs(slippageBps),
    filledSize: filled,
    wouldFillCompletely: filled >= orderSize,
    midPrice: midPrice
  };
}

/**
 * Calculate all transaction costs for a trade
 * Phase 2 Week 2: Cost modeling
 * @param {number} orderValueUsd - Order value in USD
 * @param {string} exchange - Exchange name
 * @param {number} slippageBps - Estimated slippage in basis points
 * @returns {Object} Cost breakdown
 */
function calculateTradeCosts(orderValueUsd, exchange, slippageBps = 5) {
  // Exchange fee structures (typical values)
  const feeStructures = {
    binance: { maker: 0.001, taker: 0.002 },
    coinbase: { maker: 0.004, taker: 0.006 },
    kraken: { maker: 0.0016, taker: 0.0026 },
    default: { maker: 0.001, taker: 0.002 }
  };
  
  const fees = feeStructures[exchange?.toLowerCase()] || feeStructures.default;
  
  const costs = {
    // Exchange fees (assume taker for market orders)
    makerFee: orderValueUsd * fees.maker,
    takerFee: orderValueUsd * fees.taker,
    
    // Network/blockchain fees (for crypto withdrawals - not per trade)
    networkFee: 0, // Typically only on withdrawals
    
    // Slippage (from order book analysis)
    slippage: orderValueUsd * (slippageBps / 10000),
    
    // Opportunity cost (time value - negligible for fast execution)
    opportunityCost: orderValueUsd * 0.0001 // 1 bp
  };
  
  // Total cost (using taker fee since we use market orders)
  costs.total = costs.takerFee + costs.slippage + costs.opportunityCost;
  costs.totalBps = (costs.total / orderValueUsd) * 10000;
  
  return costs;
}

/**
 * Execute TWAP (Time-Weighted Average Price) order
 * Phase 2 Week 3: Smart order routing
 * @param {string} userId - User ID
 * @param {string} symbol - Symbol to trade
 * @param {string} exchange - Exchange name
 * @param {number} totalSizeUsd - Total order size in USD
 * @param {number} durationMin - Duration in minutes
 * @param {number} numSlices - Number of slices (default 5)
 * @returns {Promise<Object>} Execution result with avg fill price
 */
async function executeTWAP(
  userId,
  symbol,
  exchange,
  totalSizeUsd,
  durationMin = 5,
  numSlices = 5
) {
  const sliceSizeUsd = totalSizeUsd / numSlices;
  const intervalMs = (durationMin * 60 * 1000) / numSlices;
  
  const fills = [];
  let totalFilled = 0;
  let totalCost = 0;
  
  logger.info(`📊 TWAP: Executing ${symbol} order $${totalSizeUsd} over ${durationMin}min in ${numSlices} slices`);
  
  for (let i = 0; i < numSlices; i++) {
    try {
      // Send each slice as a separate webhook call
      const slicePayload = {
        userId: userId,
        exchange: exchange,
        symbol: symbol,
        action: 'BUY',
        position_size_usd: sliceSizeUsd,
        source: 'ai_twap',
        slice: `${i + 1}/${numSlices}`
      };
      
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slicePayload),
        timeout: 10000
      });
      
      if (response.ok) {
        const result = await response.json();
        fills.push({
          slice: i + 1,
          size: sliceSizeUsd,
          price: result.price || 0,
          timestamp: new Date()
        });
        
        totalFilled += sliceSizeUsd;
        totalCost += sliceSizeUsd; // Simplified - would need actual fill price
        
        logger.info(`  ✓ TWAP slice ${i + 1}/${numSlices} filled`);
      } else {
        logger.warn(`  ✗ TWAP slice ${i + 1}/${numSlices} failed`);
      }
      
      // Wait before next slice (except last one)
      if (i < numSlices - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    } catch (error) {
      logger.error(`TWAP slice ${i + 1} error:`, error.message);
    }
  }
  
  const avgPrice = fills.length > 0 
    ? fills.reduce((sum, f) => sum + f.price, 0) / fills.length 
    : 0;
  
  return {
    strategy: 'TWAP',
    totalSizeUsd: totalSizeUsd,
    filledSizeUsd: totalFilled,
    avgPrice: avgPrice,
    slicesExecuted: fills.length,
    slicesTotal: numSlices,
    fills: fills
  };
}

/**
 * Calculate correlation between two assets
 * Phase 2 Week 4: Portfolio correlation management
 * @param {Array<number>} returns1 - Returns array for asset 1
 * @param {Array<number>} returns2 - Returns array for asset 2
 * @returns {number} Pearson correlation coefficient (-1 to 1)
 */
function calculateCorrelation(returns1, returns2) {
  if (returns1.length !== returns2.length || returns1.length === 0) {
    return 0;
  }
  
  const n = returns1.length;
  
  // Calculate means
  const mean1 = returns1.reduce((sum, r) => sum + r, 0) / n;
  const mean2 = returns2.reduce((sum, r) => sum + r, 0) / n;
  
  // Calculate correlation
  let numerator = 0;
  let sumSq1 = 0;
  let sumSq2 = 0;
  
  for (let i = 0; i < n; i++) {
    const diff1 = returns1[i] - mean1;
    const diff2 = returns2[i] - mean2;
    
    numerator += diff1 * diff2;
    sumSq1 += diff1 * diff1;
    sumSq2 += diff2 * diff2;
  }
  
  const denominator = Math.sqrt(sumSq1 * sumSq2);
  
  if (denominator === 0) return 0;
  
  return numerator / denominator;
}

/**
 * Calculate returns from price array
 * @param {Array<number>} prices - Price array
 * @returns {Array<number>} Returns array
 */
function calculateReturns(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(ret);
  }
  return returns;
}

/**
 * Check if new position increases correlation risk
 * Phase 2 Week 4: Correlation management
 * @param {Array<Object>} currentPositions - Current open positions
 * @param {string} newSymbol - New symbol to trade
 * @param {Object} priceHistory - Price history for correlation calculation
 * @param {number} maxCorrelation - Max correlation threshold (default 0.7)
 * @param {number} maxCorrelatedExposure - Max % in correlated assets (default 0.5)
 * @returns {Promise<Object>} Check result
 */
async function checkCorrelationRisk(
  currentPositions,
  newSymbol,
  priceHistory,
  maxCorrelation = 0.7,
  maxCorrelatedExposure = 0.5
) {
  if (!currentPositions || currentPositions.length === 0) {
    return { allowed: true, reason: 'No existing positions' };
  }
  
  if (!priceHistory || !priceHistory[newSymbol]) {
    // Fallback: Use simple symbol matching for known correlated pairs
    const correlatedSymbols = ['BTC', 'ETH', 'BNB'];
    const newBase = newSymbol.replace('/USDT', '').replace('USDT', '');
    
    if (correlatedSymbols.includes(newBase)) {
      const totalExposure = currentPositions.reduce((sum, p) => sum + (p.size_usd || 0), 0);
      const correlatedExposure = currentPositions
        .filter(p => {
          const base = p.symbol?.replace('/USDT', '').replace('USDT', '');
          return correlatedSymbols.includes(base);
        })
        .reduce((sum, p) => sum + (p.size_usd || 0), 0);
      
      const correlatedPct = totalExposure > 0 ? correlatedExposure / totalExposure : 0;
      
      if (correlatedPct > maxCorrelatedExposure) {
        return {
          allowed: false,
          reason: `Correlation risk: ${(correlatedPct * 100).toFixed(1)}% already in correlated crypto (BTC/ETH/BNB)`,
          correlatedExposure: correlatedExposure,
          correlatedPct: correlatedPct
        };
      }
    }
    
    return { allowed: true, reason: 'No price history available, using fallback' };
  }
  
  // Calculate actual correlations using price history
  const newPrices = priceHistory[newSymbol];
  const newReturns = calculateReturns(newPrices);
  
  let highlyCorrelatedExposure = 0;
  const totalExposure = currentPositions.reduce((sum, p) => sum + (p.size_usd || 0), 0);
  
  for (const position of currentPositions) {
    if (!priceHistory[position.symbol]) continue;
    
    const posPrices = priceHistory[position.symbol];
    const posReturns = calculateReturns(posPrices);
    
    // Calculate correlation
    const correlation = calculateCorrelation(newReturns, posReturns);
    
    // If highly correlated (> 0.7), count exposure
    if (Math.abs(correlation) > maxCorrelation) {
      highlyCorrelatedExposure += position.size_usd || 0;
      logger.debug(`High correlation detected: ${newSymbol} <-> ${position.symbol} = ${correlation.toFixed(3)}`);
    }
  }
  
  const correlatedPct = totalExposure > 0 ? highlyCorrelatedExposure / totalExposure : 0;
  
  if (correlatedPct > maxCorrelatedExposure) {
    return {
      allowed: false,
      reason: `Correlation risk: ${(correlatedPct * 100).toFixed(1)}% of portfolio in correlated assets`,
      correlatedExposure: highlyCorrelatedExposure,
      correlatedPct: correlatedPct
    };
  }
  
  return {
    allowed: true,
    correlatedExposure: highlyCorrelatedExposure,
    correlatedPct: correlatedPct
  };
}

/**
 * Retry helper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error; // Last attempt failed
      }
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Process market data for a single symbol
 * @param {Object} strategy - Strategy configuration
 * @param {string} symbol - Symbol to analyze
 * @param {string} exchange - Exchange name
 * @returns {Promise<{candles: Array, indicators: Object, valid: boolean, reason?: string}>}
 */
async function processSymbolData(strategy, symbol, exchange) {
  try {
    // Fetch market data with retry
    const candles = await retryWithBackoff(
      () => get1mOHLCV(strategy.user_id, symbol, exchange, 100),
      3,
      1000
    );

    if (candles.length === 0) {
      return { valid: false, reason: `No market data for ${symbol}` };
    }

    // Validate data quality
    const validation = validateMarketData(candles, null);
    if (!validation.valid) {
      logger.warn(`⚠️ Data validation failed for ${symbol}:`, validation.reason);
      return { valid: false, reason: validation.reason };
    }

    // Calculate indicators
    const indicators = calculateIndicators(candles);

    return {
      valid: true,
      candles,
      indicators,
      symbol
    };
  } catch (error) {
    logger.logError(`Failed to process data for ${symbol}`, error);
    return { valid: false, reason: error.message };
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

    // Phase 1: Use exchange from strategy (default to aster for backward compatibility)
    const exchange = strategy.exchange || 'aster';
    
    // Phase 1: Process ALL target assets, not just first
    const targetAssets = strategy.target_assets && strategy.target_assets.length > 0
      ? strategy.target_assets.map(asset => asset.replace(/\//g, '').replace(/:PERP$/, '').toUpperCase())
      : ['BTCUSDT'];

    logger.debug(`Processing ${filteredAssets.length} target asset(s): ${filteredAssets.join(', ')}`);

    // Process all target assets and collect market data
    const assetData = [];
    for (const symbol of filteredAssets) {
      const data = await processSymbolData(strategy, symbol, exchange);
      if (data.valid) {
        assetData.push(data);
      } else {
        logger.warn(`Skipping ${symbol}: ${data.reason}`);
      }
    }

    if (assetData.length === 0) {
      logger.warn(`No valid market data for any target assets, skipping strategy ${strategy.id}`);
      metrics.errors++;
      return;
    }

    // Use primary symbol (first valid asset) for decision
    const primaryData = assetData[0];
    const primarySymbol = primaryData.symbol;
    const candles = primaryData.candles;
    const indicators = primaryData.indicators;

    // Get current positions
    const positions = await getUserPositions(strategy.user_id);

    // Phase 2: Get orderbook for ML features (optional, but improves ML accuracy)
    let orderbook = null;
    try {
      orderbook = await getOrderBookSnapshot(strategy.user_id, primarySymbol, exchange, 10);
    } catch (orderbookError) {
      logger.debug(`Orderbook unavailable for ${primarySymbol}, continuing without it`);
    }

    // Phase 2: Get ML prediction first
    let mlPrediction = null;
    let usedML = false;
    let decision = null;
    let modelVersions = [];
    let rawResponses = {};

    try {
      const mlFeatures = prepareMLFeatures(indicators, orderbook, positions, strategy);
      // Phase 2: Pass strategy ID for per-strategy model lookup
      mlPrediction = await getMLPrediction(mlFeatures, strategy.id);
      
      if (mlPrediction.success) {
        metrics.mlCalls++;
        metrics.mlLatency.push(mlPrediction.latency);
        if (metrics.mlLatency.length > 100) {
          metrics.mlLatency.shift();
        }
      }
    } catch (mlError) {
      logger.warn(`ML prediction failed for strategy ${strategy.id}:`, mlError.message);
      // Continue with LLM fallback
    }

    // Phase 2: Determine which model to use
    const modelDecision = await determineModelUsage(strategy, mlPrediction);
    usedML = modelDecision.useML;

    if (usedML && mlPrediction && mlPrediction.success) {
      // Use ML decision
      decision = mlPredictionToDecision(mlPrediction, primarySymbol, strategy);
      modelVersions = [mlPrediction.model_version || 'lightgbm'];
      metrics.mlDecisions++;
      
      logger.info(`🤖 ML Decision for ${strategy.name}:`, {
        action: decision.action,
        symbol: decision.symbol,
        size_usd: decision.size_usd,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        reason: modelDecision.reason
      });

      // Track usage (ML used, no LLM cost)
      await updateLLMUsage(strategy.id, strategy.user_id, false, 0);
      
      // Estimate cost savings (one LLM call avoided)
      metrics.costSavings += 0.0001; // ~$0.0001 per LLM call saved
      
    } else {
      // Use LLM decision (fallback or by design)
      logger.debug(`Using LLM for strategy ${strategy.id}: ${modelDecision.reason}`);
      
      // Phase 1: Extract custom prompt from config (LLM modes only)
      const config = normalizeConfig(strategy);
      const customPrompt = config.custom_prompt || '';
      
      // Build prompt
      const prompt = buildPrompt({
        strategy,
        priceData: candles,
        indicators,
        currentPositions: positions,
        customPrompt // Phase 1: Inject custom instructions
      });
      
      if (customPrompt && customPrompt.trim()) {
        logger.info(`📝 Custom prompt injected for ${strategy.name} (${customPrompt.length} chars)`);
      }

      // Call Groq API with retry
      logger.debug(`Calling Groq API for strategy ${strategy.id}...`);
      const groqStartTime = Date.now();
      
      let completion;
      try {
        completion = await retryWithBackoff(
          () => groq.chat.completions.create({
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
          }),
          3,
          2000
        );
        
        const groqLatency = Date.now() - groqStartTime;
        metrics.groqCalls++;
        metrics.llmDecisions++;
        metrics.groqLatency.push(groqLatency);
        
        // Keep only last 100 latency measurements
        if (metrics.groqLatency.length > 100) {
          metrics.groqLatency.shift();
        }
      } catch (groqError) {
        logger.logError(`Groq API error for strategy ${strategy.id} after retries`, groqError);
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
      decision = parseDecision(aiResponse);
      modelVersions = ['llama-3.1-70b-versatile'];
      rawResponses = { llama: aiResponse };
      
      logger.info(`🤖 LLM Decision for ${strategy.name}:`, {
        action: decision.action,
        symbol: decision.symbol,
        size_usd: decision.size_usd,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        reason: modelDecision.reason
      });

      // Track usage (LLM used, incur cost)
      await updateLLMUsage(strategy.id, strategy.user_id, true, 0.0001);
    }

    // Phase 1: Apply risk profile position sizing
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const config = normalizeConfig(strategy);
      const riskValue = config.risk_profile_value !== undefined ? config.risk_profile_value : 50;
      let multiplier = 1.0;
      
      if (riskValue < 33) {
        // Conservative: 0.5x
        multiplier = 0.5;
      } else if (riskValue >= 67) {
        // Aggressive: 1.5x to 3.0x (linear scale)
        multiplier = 1.5 + ((riskValue - 67) / 33) * 1.5;
      }
      // Balanced (33-66): 1.0x (no change)
      
      const originalSize = decision.size_usd;
      decision.size_usd = decision.size_usd * multiplier;
      
      logger.info(`💰 Risk Profile Applied: ${riskValue} → ${multiplier.toFixed(2)}x multiplier ($${originalSize.toFixed(2)} → $${decision.size_usd.toFixed(2)})`);
    }

    // Phase A: Apply Kelly Criterion position sizing
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const config = normalizeConfig(strategy);
      const kellyFraction = config.kelly_fraction || 0.25; // 1/4 Kelly by default
      const kellyResult = await calculateKellyPositionSize(strategy.id, decision.size_usd, kellyFraction);
      
      if (kellyResult.metrics.insufficient_data || kellyResult.metrics.insufficient_variance) {
        logger.debug(`📊 Kelly: Insufficient data for ${strategy.name}, using base size`);
      } else {
        const originalSize = decision.size_usd;
        decision.size_usd = kellyResult.size;
        logger.info(`📊 Kelly Sizing Applied: $${originalSize.toFixed(2)} → $${decision.size_usd.toFixed(2)} (${(kellyResult.metrics.kelly_pct * 100).toFixed(2)}% Kelly)`);
      }
    }

    // Phase 2 Week 1: Apply Volatility-Adjusted Position Sizing
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const config = normalizeConfig(strategy);
      
      if (config.use_volatility_sizing) {
        const accountBalance = 10000; // TODO: Get from user account
        const riskPerTrade = config.risk_per_trade || 0.01; // 1% default
        const atrMultiplier = config.atr_multiplier || 2; // 2× ATR stop loss
        const currentPrice = indicators.currentPrice;
        const atr = indicators.atr;
        
        if (atr && currentPrice) {
          const volatilitySize = calculateVolatilityAdjustedSize(
            accountBalance,
            riskPerTrade,
            currentPrice,
            atr,
            atrMultiplier
          );
          
          const originalSize = decision.size_usd;
          decision.size_usd = volatilitySize;
          
          logger.info(`📉 Volatility Sizing: ATR=${atr.toFixed(2)}, Risk=${(riskPerTrade * 100).toFixed(1)}%, $${originalSize.toFixed(2)} → $${decision.size_usd.toFixed(2)}`);
        }
      }
    }

    // Phase 2 Week 2: Check Transaction Costs
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const config = normalizeConfig(strategy);
      
      if (config.skip_high_cost_trades) {
        // Get orderbook if available
        let slippageBps = 5; // Default 5 bps
        
        if (orderbook && orderbook.bids && orderbook.asks) {
          const slippageEstimate = estimateSlippage(
            orderbook,
            decision.size_usd,
            decision.action === 'LONG' ? 'buy' : 'sell'
          );
          
          if (slippageEstimate.slippageBps) {
            slippageBps = slippageEstimate.slippageBps;
            logger.debug(`📊 Estimated slippage: ${slippageBps.toFixed(2)} bps`);
          }
        }
        
        // Calculate total costs
        const costs = calculateTradeCosts(decision.size_usd, exchange, slippageBps);
        const maxCostBps = config.max_cost_bps || 50; // 0.5% default
        
        if (costs.totalBps > maxCostBps) {
          logger.warn(`💸 Trade costs too high: ${costs.totalBps.toFixed(2)} bps > ${maxCostBps} bps limit. Skipping trade.`);
          decision.action = 'HOLD';
          decision.reasoning = (decision.reasoning || '') + ` [COSTS: ${costs.totalBps.toFixed(1)}bps > ${maxCostBps}bps limit]`;
          metrics.holds++;
        } else {
          logger.debug(`✅ Trade costs acceptable: ${costs.totalBps.toFixed(2)} bps (${costs.total.toFixed(2)} USD)`);
        }
      }
    }

    // Phase 2 Week 4: Check Correlation Risk
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const config = normalizeConfig(strategy);
      
      if (config.enforce_correlation_limits) {
        const maxCorrelation = config.max_correlation || 0.7;
        const maxCorrelatedExposure = config.max_correlated_exposure || 0.5;
        
        // Get current positions
        const { data: currentPositions } = await supabase
          .from('trades')
          .select('symbol, size_usd')
          .eq('user_id', strategy.user_id)
          .is('exit_time', null)
          .neq('status', 'closed');
        
        // Check correlation risk (using fallback for now - full price history would need caching)
        const correlationCheck = await checkCorrelationRisk(
          currentPositions || [],
          primarySymbol,
          null, // Price history not available in real-time, using fallback
          maxCorrelation,
          maxCorrelatedExposure
        );
        
        if (!correlationCheck.allowed) {
          logger.warn(`🔗 Correlation limit blocked for ${strategy.name}: ${correlationCheck.reason}`);
          decision.action = 'HOLD';
          decision.reasoning = (decision.reasoning || '') + ` [CORRELATION: ${correlationCheck.reason}]`;
          metrics.holds++;
        } else {
          logger.debug(`✅ Correlation risk acceptable: ${(correlationCheck.correlatedPct * 100).toFixed(1)}% correlated exposure`);
        }
      }
    }

    // Phase A: Check drawdown circuit breaker BEFORE trading
    const config = normalizeConfig(strategy);
    const drawdownLimit = config.drawdown_limit || 0.20; // 20% default
    const drawdownCheck = await checkDrawdownCircuitBreaker(strategy.id, drawdownLimit);
    
    if (drawdownCheck.should_pause) {
      logger.error(`🛑 CIRCUIT BREAKER ACTIVATED: ${strategy.name} - ${drawdownCheck.reason}`);
      // Strategy already paused in checkDrawdownCircuitBreaker
      // Skip this cycle
      return;
    } else if (drawdownCheck.metrics && drawdownCheck.metrics.current_drawdown > 0.15) {
      // Warn if approaching limit (> 15%)
      logger.warn(`⚠️  Approaching drawdown limit for ${strategy.name}: ${(drawdownCheck.metrics.current_drawdown * 100).toFixed(1)}% (limit: ${(drawdownLimit * 100).toFixed(0)}%)`);
    }

    // Phase A: Check portfolio limits BEFORE trading
    if (decision.action !== 'HOLD' && decision.size_usd) {
      const portfolioCheck = await checkPortfolioLimits(strategy.user_id, primarySymbol, decision.size_usd);
      
      if (!portfolioCheck.allowed) {
        logger.warn(`🚫 Portfolio limit blocked for ${strategy.name}: ${portfolioCheck.reason}`);
        decision.action = 'HOLD';
        decision.reasoning = (decision.reasoning || '') + ` [PORTFOLIO: ${portfolioCheck.reason}]`;
        metrics.holds++;
      } else {
        logger.debug(`✅ Portfolio limits OK: ${portfolioCheck.metrics.open_positions} positions, $${portfolioCheck.metrics.portfolio_value.toFixed(0)} total`);
      }
    }

    // Phase 1: Check daily trade limit
    if (decision.action !== 'HOLD') {
      const config = normalizeConfig(strategy);
      const limitCheck = await checkDailyTradeLimit(strategy.id, config);
      
      if (!limitCheck.allowed) {
        logger.warn(`🚫 Daily trade limit blocked for ${strategy.name}: ${limitCheck.reason}`);
        decision.action = 'HOLD';
        decision.reasoning = (decision.reasoning || '') + ` [LIMIT: ${limitCheck.reason}]`;
        metrics.holds++;
      } else if (limitCheck.count !== undefined) {
        logger.debug(`📊 Daily trade count: ${limitCheck.count}/${config.daily_trade_limit || 'unlimited'}`);
      }
    }

    // Phase 1: Risk checks before execution
    if (decision.action !== 'HOLD') {
      const riskCheck = await performRiskChecks(strategy, decision);
      if (!riskCheck.allowed) {
        logger.warn(`🚫 Risk check failed for ${strategy.name}:`, riskCheck.reason);
        // Override decision to HOLD
        decision.action = 'HOLD';
        decision.reasoning = (decision.reasoning || '') + ` [RISK: ${riskCheck.reason}]`;
        metrics.holds++;
      } else {
        logger.debug(`✅ Risk checks passed for ${strategy.name}`);
      }
    }

    // ML-READY LOGGING — This is your permanent moat (Tier 3 ready)
    try {
      // Fetch orderbook for microstructure edge (with error handling)
      let orderbook = null;
      try {
        orderbook = await getOrderBookSnapshot(strategy.user_id, primarySymbol, exchange, 10);
        if (!orderbook) {
          logger.warn(`Orderbook unavailable for ${primarySymbol}, continuing without it`);
        }
      } catch (orderbookError) {
        logger.warn(`Failed to fetch orderbook for ${primarySymbol}:`, orderbookError.message);
        // Continue without orderbook - it's optional for ML logging
      }

      await supabase.from('ai_trade_decisions').insert({
        user_id: strategy.user_id,
        strategy_id: strategy.id,
        decided_at: new Date(),

        // Full market context
        market_snapshot: {
          symbol: primarySymbol,
          candles: candles.slice(-100),
          current_price: indicators.currentPrice,
          price_change_24h: indicators.priceChange24h,
          // Include all analyzed assets
          all_assets: assetData.map(d => ({
            symbol: d.symbol,
            current_price: d.indicators.currentPrice,
            price_change_24h: d.indicators.priceChange24h
          }))
        },
        orderbook_snapshot: orderbook, // Microstructure alpha (may be null)
        technical_indicators: indicators,

        // Portfolio state
        portfolio_state: {
          open_positions: positions,
          total_unrealized_pnl: positions.reduce((sum, p) => sum + (p.unrealized_pnl_usd || 0), 0),
          position_count: positions.length
        },

        // Model provenance (Phase 2: Track which model was used)
        model_versions: modelVersions,
        raw_responses: rawResponses,
        parsed_decision: decision,
        confidence_final: decision.confidence,
        
        // Phase 2: Track model decision metadata
        model_decision_metadata: {
          used_ml: usedML,
          ml_confidence: mlPrediction?.confidence || null,
          ml_prediction_success: mlPrediction?.success || false,
          decision_reason: modelDecision?.reason || 'unknown'
        },

        // Execution flag
        signal_sent: decision.action !== 'HOLD'
      });

      logger.info('Decision logged to ai_trade_decisions (ML-ready with orderbook)');
    } catch (logError) {
      logger.logError('Failed to log rich AI decision', logError);
      // Don't crash the whole cycle if logging fails
    }

    // Create AI idea for high-confidence signals (>= 70%)
    if (decision.action !== 'HOLD' && (decision.confidence || 0) >= 0.70) {
      try {
        // Calculate similar trade stats (simplified - in production, query historical data)
        const similarTradeCount = Math.floor(Math.random() * 1000) + 500; // Mock for now
        const similarTradeWinRate = (decision.confidence || 0.7) * 100; // Use confidence as proxy

        await createAIIdea({
          userId: strategy.user_id,
          strategyId: strategy.id,
          decision: {
            ...decision,
            exchange: exchange
          },
          indicators: indicators,
          marketSnapshot: {
            symbol: primarySymbol,
            current_price: indicators.currentPrice,
            price_change_24h: indicators.priceChange24h
          },
          similarTradeCount: similarTradeCount,
          similarTradeWinRate: similarTradeWinRate
        });
      } catch (ideaError) {
        logger.warn('Failed to create AI idea (non-critical):', ideaError.message);
        // Don't fail the whole cycle if idea creation fails
      }
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
        // Phase 2 Week 3: Check if we should use TWAP execution
        const config = normalizeConfig(strategy);
        const useTWAP = config.use_smart_routing && decision.size_usd > (config.twap_threshold_usd || 10000);
        
        if (useTWAP) {
          // Use TWAP for large orders
          const twapDuration = config.twap_duration_min || 5;
          const twapSlices = config.twap_slices || 5;
          
          logger.info(`📊 Large order detected ($${decision.size_usd}). Using TWAP execution over ${twapDuration}min`);
          
          const twapResult = await executeTWAP(
            strategy.user_id,
            decision.symbol,
            exchange,
            decision.size_usd,
            twapDuration,
            twapSlices
          );
          
          logger.info(`✅ TWAP execution complete: ${twapResult.slicesExecuted}/${twapResult.slicesTotal} slices filled, avg price: $${twapResult.avgPrice.toFixed(2)}`);
          metrics.signalsSent++;
          
        } else {
          // Regular market order execution
          // Call main webhook endpoint with retry
          const response = await retryWithBackoff(
            () => fetch(WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookPayload),
              timeout: 10000 // 10 second timeout
            }),
            2,
            2000
          );

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
        }
      } catch (fetchError) {
        logger.logError('Failed to send signal to Sparky after retries', fetchError);
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
      const avgGroqLatency = metrics.groqLatency.length > 0
        ? metrics.groqLatency.reduce((a, b) => a + b, 0) / metrics.groqLatency.length
        : 0;
      
      const avgMLLatency = metrics.mlLatency.length > 0
        ? metrics.mlLatency.reduce((a, b) => a + b, 0) / metrics.mlLatency.length
        : 0;
      
      const totalDecisions = metrics.mlDecisions + metrics.llmDecisions;
      const mlPercent = totalDecisions > 0 
        ? ((metrics.mlDecisions / totalDecisions) * 100).toFixed(1)
        : 0;
      
      logger.info('📊 AI Worker Metrics:', {
        strategiesProcessed: metrics.strategiesProcessed,
        signalsSent: metrics.signalsSent,
        holds: metrics.holds,
        errors: metrics.errors,
        // LLM metrics
        groqCalls: metrics.groqCalls,
        llmDecisions: metrics.llmDecisions,
        avgGroqLatency: `${avgGroqLatency.toFixed(0)}ms`,
        // ML metrics (Phase 2)
        mlCalls: metrics.mlCalls,
        mlDecisions: metrics.mlDecisions,
        avgMLLatency: `${avgMLLatency.toFixed(0)}ms`,
        mlUsagePercent: `${mlPercent}%`,
        // Cost savings
        estimatedCostSavings: `$${metrics.costSavings.toFixed(4)}`
      });
    }

  } catch (error) {
    logger.logError('AI Worker cycle failed', error);
    metrics.errors++;
  }
}

// Start worker
logger.info('🤖 AI Signal Engine v2 (Hybrid ML + LLM) starting...');
logger.info(`Webhook URL: ${WEBHOOK_URL}`);
logger.info(`Cycle interval: ${CYCLE_INTERVAL_MS}ms`);
logger.info(`Groq Model: llama-3.1-70b-versatile`);
logger.info(`ML Service URL: ${process.env.ML_SERVICE_URL || 'http://localhost:8001'}`);

// Phase 2: Check ML service health on startup
checkMLServiceHealth().then(healthy => {
  if (healthy) {
    logger.info('✅ ML Service is healthy and ready');
  } else {
    logger.warn('⚠️  ML Service is unavailable - will use LLM-only fallback');
  }
});

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

