/**
 * Risk Management Utilities for AI Worker
 * 
 * Phase 1: Risk checks before executing trades
 * - Drawdown limits
 * - Position size limits
 * - Leverage checks
 * - Circuit breakers
 */

const logger = require('../../utils/logger');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Calculate current drawdown percentage for a strategy
 * @param {string} strategyId - Strategy ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Current drawdown percentage (0-100)
 */
async function getCurrentDrawdown(strategyId, userId) {
  try {
    // Get all trades for this strategy
    const { data: trades, error } = await supabase
      .from('trades')
      .select('pnl_usd, exit_time')
      .eq('strategy_id', strategyId)
      .eq('user_id', userId)
      .not('pnl_usd', 'is', null)
      .order('exit_time', { ascending: true });

    if (error || !trades || trades.length === 0) {
      return 0; // No trades = no drawdown
    }

    // Calculate cumulative P&L over time
    let cumulativePnL = 0;
    let peakPnL = 0;
    let maxDrawdown = 0;

    for (const trade of trades) {
      cumulativePnL += trade.pnl_usd || 0;
      
      // Track peak
      if (cumulativePnL > peakPnL) {
        peakPnL = cumulativePnL;
      }
      
      // Calculate drawdown from peak
      const drawdown = peakPnL > 0 
        ? ((peakPnL - cumulativePnL) / Math.abs(peakPnL)) * 100
        : cumulativePnL < 0 
          ? Math.abs(cumulativePnL) 
          : 0;
      
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Also check current unrealized P&L from positions
    const { data: positions } = await supabase
      .from('positions')
      .select('unrealized_pnl_usd, strategy_id')
      .eq('strategy_id', strategyId)
      .eq('user_id', userId);

    if (positions && positions.length > 0) {
      const totalUnrealizedPnL = positions.reduce((sum, p) => sum + (p.unrealized_pnl_usd || 0), 0);
      const totalPnL = cumulativePnL + totalUnrealizedPnL;
      
      if (totalPnL < peakPnL) {
        const currentDrawdown = peakPnL > 0
          ? ((peakPnL - totalPnL) / Math.abs(peakPnL)) * 100
          : Math.abs(totalPnL);
        
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
        }
      }
    }

    return Math.max(0, maxDrawdown);
  } catch (error) {
    logger.logError('Failed to calculate drawdown', error);
    return 0; // Fail safe - allow trading if calculation fails
  }
}

/**
 * Check if strategy has exceeded drawdown limit
 * @param {Object} strategy - Strategy configuration
 * @returns {Promise<{exceeded: boolean, currentDrawdown: number, limit: number}>}
 */
async function checkDrawdownLimit(strategy) {
  const currentDrawdown = await getCurrentDrawdown(strategy.id, strategy.user_id);
  const maxDrawdown = strategy.max_drawdown_percent || 20.0;
  
  const exceeded = currentDrawdown >= maxDrawdown;
  
  if (exceeded) {
    logger.warn(`⚠️ Drawdown limit exceeded for strategy ${strategy.name}:`, {
      current: currentDrawdown.toFixed(2) + '%',
      limit: maxDrawdown + '%'
    });
  }
  
  return {
    exceeded,
    currentDrawdown,
    limit: maxDrawdown
  };
}

/**
 * Calculate total position size for user across all positions
 * @param {string} userId - User ID
 * @returns {Promise<number>} Total position size in USD
 */
async function getTotalPositionSize(userId) {
  try {
    const { data: positions, error } = await supabase
      .from('positions')
      .select('position_size_usd, value_usd')
      .eq('user_id', userId);

    if (error || !positions) {
      return 0;
    }

    // Sum up position sizes or values
    return positions.reduce((sum, p) => {
      return sum + (p.position_size_usd || p.value_usd || 0);
    }, 0);
  } catch (error) {
    logger.logError('Failed to calculate total position size', error);
    return 0;
  }
}

/**
 * Check if new position would exceed portfolio limits
 * @param {Object} strategy - Strategy configuration
 * @param {number} newPositionSize - Size of new position in USD
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function checkPositionSizeLimit(strategy, newPositionSize) {
  try {
    const totalSize = await getTotalPositionSize(strategy.user_id);
    const newTotal = totalSize + newPositionSize;
    
    // For now, no hard limit - but log warning if very large
    // TODO: Add portfolio size limit per strategy in future
    if (newTotal > 100000) { // $100k warning threshold
      logger.warn(`Large position size for strategy ${strategy.name}:`, {
        newPosition: newPositionSize,
        totalSize: totalSize,
        newTotal: newTotal
      });
    }
    
    return { allowed: true };
  } catch (error) {
    logger.logError('Failed to check position size limit', error);
    return { allowed: true }; // Fail open
  }
}

/**
 * Check leverage limits
 * @param {Object} strategy - Strategy configuration
 * @param {number} requestedLeverage - Requested leverage
 * @returns {boolean} Whether leverage is allowed
 */
function checkLeverageLimit(strategy, requestedLeverage) {
  const maxLeverage = strategy.leverage_max || 10;
  
  if (requestedLeverage > maxLeverage) {
    logger.warn(`⚠️ Leverage limit exceeded for strategy ${strategy.name}:`, {
      requested: requestedLeverage,
      limit: maxLeverage
    });
    return false;
  }
  
  return true;
}

/**
 * Check for circuit breaker conditions (large losses, rapid losses)
 * @param {Object} strategy - Strategy configuration
 * @returns {Promise<{triggered: boolean, reason?: string}>}
 */
async function checkCircuitBreaker(strategy) {
  try {
    // Get recent trades (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const { data: recentTrades, error } = await supabase
      .from('trades')
      .select('pnl_usd, exit_time')
      .eq('strategy_id', strategy.id)
      .eq('user_id', strategy.user_id)
      .gte('exit_time', oneDayAgo.toISOString())
      .not('pnl_usd', 'is', null);

    if (error || !recentTrades || recentTrades.length === 0) {
      return { triggered: false };
    }

    // Check for large loss in single trade (>10% of typical position)
    const largeLossThreshold = -500; // $500 loss
    const largeLosses = recentTrades.filter(t => t.pnl_usd < largeLossThreshold);
    
    if (largeLosses.length >= 3) {
      return {
        triggered: true,
        reason: `3+ large losses in 24h (${largeLosses.length} losses > $${Math.abs(largeLossThreshold)})`
      };
    }

    // Check for rapid consecutive losses (5 losses in a row)
    const last5Trades = recentTrades.slice(-5);
    if (last5Trades.length === 5 && last5Trades.every(t => t.pnl_usd < 0)) {
      return {
        triggered: true,
        reason: '5 consecutive losing trades'
      };
    }

    // Check for total daily loss > $1000
    const totalDailyLoss = recentTrades.reduce((sum, t) => sum + Math.min(0, t.pnl_usd), 0);
    if (totalDailyLoss < -1000) {
      return {
        triggered: true,
        reason: `Daily loss exceeded: $${Math.abs(totalDailyLoss).toFixed(2)}`
      };
    }

    return { triggered: false };
  } catch (error) {
    logger.logError('Failed to check circuit breaker', error);
    return { triggered: false }; // Fail open
  }
}

/**
 * Comprehensive risk check before executing trade
 * @param {Object} strategy - Strategy configuration
 * @param {Object} decision - AI decision
 * @returns {Promise<{allowed: boolean, reason?: string, checks: Object}>}
 */
async function performRiskChecks(strategy, decision) {
  // Skip risk checks for HOLD decisions
  if (decision.action === 'HOLD') {
    return { allowed: true, checks: {} };
  }

  // Skip risk checks for paper trading
  if (strategy.is_paper_trading) {
    return { allowed: true, checks: { paperTrading: true } };
  }

  const checks = {};

  // 1. Check drawdown limit
  const drawdownCheck = await checkDrawdownLimit(strategy);
  checks.drawdown = drawdownCheck;
  if (drawdownCheck.exceeded) {
    return {
      allowed: false,
      reason: `Drawdown limit exceeded: ${drawdownCheck.currentDrawdown.toFixed(2)}% >= ${drawdownCheck.limit}%`,
      checks
    };
  }

  // 2. Check position size limit
  const positionSize = decision.size_usd || 100; // Default $100
  const positionCheck = await checkPositionSizeLimit(strategy, positionSize);
  checks.positionSize = positionCheck;
  if (!positionCheck.allowed) {
    return {
      allowed: false,
      reason: positionCheck.reason || 'Position size limit exceeded',
      checks
    };
  }

  // 3. Check leverage (if specified in decision)
  if (decision.leverage) {
    const leverageCheck = checkLeverageLimit(strategy, decision.leverage);
    checks.leverage = { allowed: leverageCheck };
    if (!leverageCheck) {
      return {
        allowed: false,
        reason: `Leverage limit exceeded: ${decision.leverage}x > ${strategy.leverage_max}x`,
        checks
      };
    }
  }

  // 4. Check circuit breaker
  const circuitBreaker = await checkCircuitBreaker(strategy);
  checks.circuitBreaker = circuitBreaker;
  if (circuitBreaker.triggered) {
    return {
      allowed: false,
      reason: `Circuit breaker triggered: ${circuitBreaker.reason}`,
      checks
    };
  }

  return {
    allowed: true,
    checks
  };
}

module.exports = {
  getCurrentDrawdown,
  checkDrawdownLimit,
  getTotalPositionSize,
  checkPositionSizeLimit,
  checkLeverageLimit,
  checkCircuitBreaker,
  performRiskChecks
};

