/**
 * Strategy Executor V2 for Sparky Trading Bot
 * 
 * Supports StrategyDNA v2 format with:
 * - Compound conditions (AND/OR/NOT logic)
 * - Separate long/short entries
 * - Market structure features
 * - Position management modes (flip_on_signal, hold_until_exit)
 * - Context filters (higher timeframe, volatility regime)
 * - Trailing stops with activation threshold
 * 
 * Phase 6 of Advanced Strategy Support implementation.
 * 
 * @module executors/strategyExecutorV2
 */

const logger = require('../utils/logger');

/**
 * StrategyExecutorV2 - Enhanced strategy execution supporting v2 DNA format
 */
class StrategyExecutorV2 {
  /**
   * @param {Object} strategy - StrategyDNA v2 object
   * @param {Object} exchange - Exchange API instance
   * @param {Object} [options] - Additional options
   */
  constructor(strategy, exchange, options = {}) {
    this.strategy = strategy;
    this.exchange = exchange;
    this.options = options;
    
    // Extract position management settings
    this.positionMode = strategy.position_management?.mode || 'flip_on_signal';
    this.maxPositions = strategy.position_management?.max_positions || 1;
    
    // Cache context filters
    this.contextFilters = strategy.context_filters || null;
    
    // Previous values for crossover detection
    this.previousFeatures = {};
    
    logger.info(`[V2 Executor] Initialized for strategy: ${strategy.name || 'Unnamed'}`);
    logger.info(`[V2 Executor] Position mode: ${this.positionMode}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONDITION EVALUATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Evaluate a condition group with AND/OR/NOT logic
   * @param {Object} group - ConditionGroup object
   * @param {Object} features - Feature values
   * @returns {Promise<boolean>}
   */
  async evaluateConditionGroup(group, features) {
    if (!group || !group.conditions || group.conditions.length === 0) {
      return false;
    }

    const results = await Promise.all(
      group.conditions.map(async (item) => {
        if (item.logic) {
          // Nested ConditionGroup
          return this.evaluateConditionGroup(item, features);
        } else {
          // Single Condition
          return this.evaluateCondition(item, features);
        }
      })
    );

    // Apply logic operator
    const logic = group.logic || 'AND';
    
    switch (logic) {
      case 'AND':
        return results.every(r => r === true);
      case 'OR':
        return results.some(r => r === true);
      case 'NOT':
        return !results[0];
      default:
        logger.warn(`[V2 Executor] Unknown logic operator: ${logic}`);
        return results.every(r => r === true); // Default to AND
    }
  }

  /**
   * Evaluate a single condition
   * @param {Object} condition - Condition object {feature, operator, value}
   * @param {Object} features - Feature values
   * @returns {boolean}
   */
  evaluateCondition(condition, features) {
    const { feature, operator, value } = condition;
    const currentValue = features[feature];
    const prevValue = this.previousFeatures[feature];

    // Check if feature exists
    if (currentValue === undefined || currentValue === null) {
      logger.debug(`[V2 Executor] Feature "${feature}" not found in features`);
      return false;
    }

    switch (operator) {
      // Comparison operators
      case '<':
        return currentValue < value;
      case '>':
        return currentValue > value;
      case '<=':
        return currentValue <= value;
      case '>=':
        return currentValue >= value;
      case '==':
        return currentValue === value || currentValue == value;
      case '!=':
        return currentValue !== value && currentValue != value;

      // Crossover operators (need previous value)
      case 'crossover':
        if (prevValue === undefined) return false;
        if (typeof value === 'string' && features[value] !== undefined) {
          // Crossover with another feature
          const otherCurrent = features[value];
          const otherPrev = this.previousFeatures[value];
          return currentValue > otherCurrent && prevValue <= otherPrev;
        }
        // Crossover with static value
        return currentValue > value && prevValue <= value;

      case 'crossunder':
        if (prevValue === undefined) return false;
        if (typeof value === 'string' && features[value] !== undefined) {
          const otherCurrent = features[value];
          const otherPrev = this.previousFeatures[value];
          return currentValue < otherCurrent && prevValue >= otherPrev;
        }
        return currentValue < value && prevValue >= value;

      // Market structure operators
      case 'in_zone':
        // value should be 'demand' or 'supply'
        const zoneFeature = `ms_in_${value}_zone`;
        return features[zoneFeature] === true;

      case 'breaks':
        // value should be 'bullish' or 'bearish'
        const breakFeature = `ms_bos_${value}`;
        return features[breakFeature] === true;

      default:
        logger.warn(`[V2 Executor] Unknown operator: ${operator}`);
        return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT FILTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if context filters pass
   * @param {Object} features - Current feature values
   * @returns {boolean}
   */
  checkContextFilters(features) {
    if (!this.contextFilters) {
      return true;
    }

    // Higher timeframe trend alignment
    if (this.contextFilters.trend_alignment_required) {
      const currentTrend = features.ms_trend || 'ranging';
      const htfTrend = features.htf_trend || features.ms_trend;
      
      if (currentTrend !== htfTrend) {
        logger.debug(`[V2 Executor] Trend alignment failed: ${currentTrend} vs ${htfTrend}`);
        return false;
      }
    }

    // Volatility regime filter
    if (this.contextFilters.volatility_regime && this.contextFilters.volatility_regime !== 'any') {
      const currentVolatility = features.volatility_regime || 'normal';
      if (currentVolatility !== this.contextFilters.volatility_regime) {
        logger.debug(`[V2 Executor] Volatility filter failed: ${currentVolatility} vs ${this.contextFilters.volatility_regime}`);
        return false;
      }
    }

    // Session filter (if implemented)
    if (this.contextFilters.session_filter && this.contextFilters.session_filter.length > 0) {
      const currentSession = features.trading_session;
      if (!this.contextFilters.session_filter.includes(currentSession)) {
        logger.debug(`[V2 Executor] Session filter failed: ${currentSession}`);
        return false;
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTRY SIGNAL DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check for long entry signal
   * @param {Object} features - Current feature values
   * @returns {Promise<boolean>}
   */
  async checkLongEntry(features) {
    const entryConditions = this.strategy.entry_long;
    
    if (!entryConditions) {
      return false;
    }

    // Check context filters first
    if (!this.checkContextFilters(features)) {
      return false;
    }

    return this.evaluateConditionGroup(entryConditions, features);
  }

  /**
   * Check for short entry signal
   * @param {Object} features - Current feature values
   * @returns {Promise<boolean>}
   */
  async checkShortEntry(features) {
    const entryConditions = this.strategy.entry_short;
    
    if (!entryConditions) {
      return false;
    }

    // Check context filters first
    if (!this.checkContextFilters(features)) {
      return false;
    }

    return this.evaluateConditionGroup(entryConditions, features);
  }

  /**
   * Check for entry signal (either direction)
   * @param {Object} features - Current feature values
   * @returns {Promise<{shouldEnter: boolean, direction: string|null}>}
   */
  async checkEntry(features) {
    const longEntry = await this.checkLongEntry(features);
    const shortEntry = await this.checkShortEntry(features);

    if (longEntry) {
      return { shouldEnter: true, direction: 'long' };
    }
    if (shortEntry) {
      return { shouldEnter: true, direction: 'short' };
    }
    return { shouldEnter: false, direction: null };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POSITION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine if we should ignore opposite signals (hold_until_exit mode)
   * @returns {boolean}
   */
  shouldIgnoreOppositeSignal() {
    return this.positionMode === 'hold_until_exit';
  }

  /**
   * Get exit conditions for the strategy
   * @returns {Object}
   */
  getExitConditions() {
    const exitCond = this.strategy.exit_conditions || {};
    
    return {
      takeProfitPct: exitCond.tp_pct || null,
      stopLossPct: exitCond.sl_pct || null,
      trailingEnabled: exitCond.trailing_enabled || false,
      trailingActivationPct: exitCond.trailing_activation_pct || null,
      trailingStopPct: exitCond.trailing_stop_pct || null,
      maxBars: exitCond.max_bars || null,
      exitOnSessionClose: exitCond.exit_on_session_close || false
    };
  }

  /**
   * Calculate trailing stop price
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current market price
   * @param {string} direction - 'long' or 'short'
   * @param {number} highestPriceSinceEntry - For long positions
   * @param {number} lowestPriceSinceEntry - For short positions
   * @returns {{trailingActive: boolean, stopPrice: number|null}}
   */
  calculateTrailingStop(entryPrice, currentPrice, direction, highestPriceSinceEntry, lowestPriceSinceEntry) {
    const exitCond = this.getExitConditions();
    
    if (!exitCond.trailingEnabled || !exitCond.trailingStopPct) {
      return { trailingActive: false, stopPrice: null };
    }

    const activationPct = exitCond.trailingActivationPct || 0;
    const trailingPct = exitCond.trailingStopPct / 100;

    if (direction === 'long') {
      // Check if trailing should be activated
      const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      if (profitPct < activationPct) {
        return { trailingActive: false, stopPrice: null };
      }

      // Calculate trailing stop from highest price
      const stopPrice = highestPriceSinceEntry * (1 - trailingPct);
      return { trailingActive: true, stopPrice };
    } else {
      // Short position
      const profitPct = ((entryPrice - currentPrice) / entryPrice) * 100;
      
      if (profitPct < activationPct) {
        return { trailingActive: false, stopPrice: null };
      }

      // Calculate trailing stop from lowest price
      const stopPrice = lowestPriceSinceEntry * (1 + trailingPct);
      return { trailingActive: true, stopPrice };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE UPDATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update previous features for crossover detection
   * @param {Object} features - Current feature values
   */
  updatePreviousFeatures(features) {
    this.previousFeatures = { ...features };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN EVALUATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Evaluate strategy and return trading decision
   * @param {Object} features - Current feature values
   * @param {Object} currentPosition - Current position info (if any)
   * @returns {Promise<Object>} Trading decision
   */
  async evaluate(features, currentPosition = null) {
    const result = {
      action: 'hold', // 'buy', 'sell', 'close_long', 'close_short', 'hold'
      direction: null,
      reason: '',
      exitConditions: this.getExitConditions()
    };

    // Check for entry signals
    const entrySignal = await this.checkEntry(features);

    if (!currentPosition) {
      // No position - check for entry
      if (entrySignal.shouldEnter) {
        result.action = entrySignal.direction === 'long' ? 'buy' : 'sell';
        result.direction = entrySignal.direction;
        result.reason = `V2 ${entrySignal.direction} entry signal`;
        logger.info(`[V2 Executor] Entry signal: ${result.action}`);
      }
    } else {
      // Have position - check for exit or flip
      const positionDirection = currentPosition.side?.toLowerCase() || 
                                (currentPosition.qty > 0 ? 'long' : 'short');
      
      if (this.positionMode === 'hold_until_exit') {
        // Only exit on TP/SL, ignore opposite signals
        result.action = 'hold';
        result.reason = 'Holding position (hold_until_exit mode)';
      } else {
        // Flip on opposite signal
        if (positionDirection === 'long' && entrySignal.direction === 'short') {
          result.action = 'sell'; // Close long and go short
          result.direction = 'short';
          result.reason = 'Flip from long to short';
          logger.info(`[V2 Executor] Flip signal: long → short`);
        } else if (positionDirection === 'short' && entrySignal.direction === 'long') {
          result.action = 'buy'; // Close short and go long
          result.direction = 'long';
          result.reason = 'Flip from short to long';
          logger.info(`[V2 Executor] Flip signal: short → long`);
        }
      }
    }

    // Update previous features for next evaluation
    this.updatePreviousFeatures(features);

    return result;
  }
}

module.exports = StrategyExecutorV2;

