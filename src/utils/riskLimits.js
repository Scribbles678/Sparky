/**
 * Risk Limits Utility
 * 
 * Checks weekly trade limits and weekly loss limits before executing trades.
 * These limits are configured per-exchange in SignalStudio's Trade Settings page.
 * 
 * DESIGN PRINCIPLES:
 * - Fast: Uses Redis caching for counts
 * - Non-blocking: Failures don't prevent trade execution (graceful degradation)
 * - Accurate: Counts from trades table (realized trades only)
 */

const { supabase } = require('../supabaseClient');
const logger = require('./logger');
const {
  notifyWeeklyTradeLimitReached,
  notifyWeeklyLossLimitReached,
} = require('./notifications');

// In-memory cache for weekly counts (fallback if Redis unavailable)
const weeklyCountCache = new Map();
const COUNT_CACHE_TTL = 300000; // 5 minutes

// Redis client (optional, lazy-loaded)
let redisClient = null;

/**
 * Initialize Redis for caching (optional)
 */
function initRedis() {
  try {
    const { getRedisClient, isRedisAvailable } = require('./redis');
    if (isRedisAvailable()) {
      redisClient = getRedisClient();
      logger.debug('[RiskLimits] Redis available for caching');
    }
  } catch (error) {
    logger.debug('[RiskLimits] Redis not available, using in-memory cache');
  }
}

// Try to init Redis on load (lazy - only if needed)
let redisInitialized = false;
function ensureRedisInitialized() {
  if (!redisInitialized) {
    initRedis();
    redisInitialized = true;
  }
}

/**
 * Get the start of the current week (Monday 00:00:00 UTC)
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

/**
 * Get weekly trade count for a user/exchange (with caching)
 * Only counts closed/filled trades (realized trades)
 * @param {string} userId 
 * @param {string} exchange 
 * @returns {Promise<number>} Count of trades this week
 */
async function getWeeklyTradeCount(userId, exchange) {
  if (!userId || !exchange) return 0;

  const weekStart = getWeekStart();
  const weekStartStr = weekStart.toISOString();
  const cacheKey = `risk:${userId}:${exchange}:weekly_trades:${weekStartStr}`;

  // Try Redis cache first
  ensureRedisInitialized();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) {
        const count = parseInt(cached, 10);
        logger.debug(`[RiskLimits] Cache HIT for weekly trades: user ${userId}, exchange ${exchange}: ${count}`);
        return count;
      }
    } catch (error) {
      logger.debug('[RiskLimits] Redis cache miss:', error.message);
    }
  }

  // Try in-memory cache
  const memCached = weeklyCountCache.get(cacheKey);
  if (memCached && memCached.expiry > Date.now()) {
    logger.debug(`[RiskLimits] Memory cache HIT for weekly trades: user ${userId}, exchange ${exchange}: ${memCached.count}`);
    return memCached.count;
  }

  // Fetch from database
  if (!supabase) {
    logger.warn('[RiskLimits] Supabase not configured, cannot count weekly trades');
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('exchange', exchange)
      .gte('entry_time', weekStartStr);

    if (error) {
      logger.debug('[RiskLimits] Error counting weekly trades:', error.message);
      return 0;
    }

    const tradeCount = count || 0;

    // Cache it
    cacheWeeklyCount(cacheKey, tradeCount);
    logger.debug(`[RiskLimits] Fetched from DB for weekly trades: user ${userId}, exchange ${exchange}: ${tradeCount}`);
    return tradeCount;
  } catch (error) {
    logger.debug('[RiskLimits] Exception counting weekly trades:', error.message);
    return 0;
  }
}

/**
 * Get weekly loss total for a user/exchange (with caching)
 * Only counts realized losses (closed trades with negative P&L)
 * @param {string} userId 
 * @param {string} exchange 
 * @returns {Promise<number>} Total loss in USD this week
 */
async function getWeeklyLossTotal(userId, exchange) {
  if (!userId || !exchange) return 0;

  const weekStart = getWeekStart();
  const weekStartStr = weekStart.toISOString();
  const cacheKey = `risk:${userId}:${exchange}:weekly_loss:${weekStartStr}`;

  // Try Redis cache first
  ensureRedisInitialized();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) {
        const loss = parseFloat(cached);
        logger.debug(`[RiskLimits] Cache HIT for weekly loss: user ${userId}, exchange ${exchange}: $${loss}`);
        return loss;
      }
    } catch (error) {
      logger.debug('[RiskLimits] Redis cache miss:', error.message);
    }
  }

  // Try in-memory cache
  const memCached = weeklyCountCache.get(cacheKey);
  if (memCached && memCached.expiry > Date.now()) {
    logger.debug(`[RiskLimits] Memory cache HIT for weekly loss: user ${userId}, exchange ${exchange}: $${memCached.loss}`);
    return memCached.loss;
  }

  // Fetch from database
  if (!supabase) {
    logger.warn('[RiskLimits] Supabase not configured, cannot calculate weekly loss');
    return 0;
  }

  try {
    const { data, error } = await supabase
      .from('trades')
      .select('pnl_usd')
      .eq('user_id', userId)
      .eq('exchange', exchange)
      .gte('entry_time', weekStartStr)
      .lt('pnl_usd', 0); // Only losses (negative P&L)

    if (error) {
      logger.debug('[RiskLimits] Error calculating weekly loss:', error.message);
      return 0;
    }

    if (!data || data.length === 0) {
      cacheWeeklyLoss(cacheKey, 0);
      return 0;
    }

    // Sum all losses (they're already negative, so we sum absolute values)
    const totalLoss = data.reduce((sum, trade) => {
      const loss = trade.pnl_usd || 0;
      return sum + Math.abs(loss); // Convert to positive for total loss amount
    }, 0);

    // Cache it
    cacheWeeklyLoss(cacheKey, totalLoss);
    logger.debug(`[RiskLimits] Fetched from DB for weekly loss: user ${userId}, exchange ${exchange}: $${totalLoss}`);
    return totalLoss;
  } catch (error) {
    logger.debug('[RiskLimits] Exception calculating weekly loss:', error.message);
    return 0;
  }
}

/**
 * Cache weekly trade count
 */
function cacheWeeklyCount(cacheKey, count) {
  // Cache in Redis (5 min TTL)
  ensureRedisInitialized();
  if (redisClient) {
    redisClient.setex(cacheKey, 300, count.toString()).catch(() => {});
  }

  // Cache in memory as fallback
  weeklyCountCache.set(cacheKey, {
    count,
    expiry: Date.now() + COUNT_CACHE_TTL,
  });
}

/**
 * Cache weekly loss total
 */
function cacheWeeklyLoss(cacheKey, loss) {
  // Cache in Redis (5 min TTL)
  ensureRedisInitialized();
  if (redisClient) {
    redisClient.setex(cacheKey, 300, loss.toString()).catch(() => {});
  }

  // Cache in memory as fallback
  weeklyCountCache.set(cacheKey, {
    loss,
    expiry: Date.now() + COUNT_CACHE_TTL,
  });
}

/**
 * Check risk limits before executing a trade
 * @param {string} userId 
 * @param {string} exchange 
 * @param {Object} settings - Exchange trade settings from database
 * @returns {Promise<{allowed: boolean, reason?: string, limitType?: string, current?: number, limit?: number}>}
 */
async function checkRiskLimits(userId, exchange, settings) {
  // If no settings provided, allow the trade
  if (!settings) {
    return { allowed: true };
  }

  const maxTradesPerWeek = settings.max_trades_per_week ?? 0;
  const maxLossPerWeek = settings.max_loss_per_week_usd ?? 0;

  // If both limits are 0 (unlimited), allow the trade
  if (maxTradesPerWeek === 0 && maxLossPerWeek === 0) {
    return { allowed: true };
  }

  // Check max trades per week (if limit is set)
  if (maxTradesPerWeek > 0) {
    const weeklyTradeCount = await getWeeklyTradeCount(userId, exchange);

    if (weeklyTradeCount >= maxTradesPerWeek) {
      const weekStart = getWeekStart();
      const nextMonday = new Date(weekStart);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

      // Create notification (async, fire-and-forget)
      notifyWeeklyTradeLimitReached(userId, weeklyTradeCount, maxTradesPerWeek, exchange).catch(err => {
        logger.debug('[RiskLimits] Failed to create notification:', err.message);
      });

      return {
        allowed: false,
        reason: `Maximum trades per week limit exceeded. You have executed ${weeklyTradeCount} trades this week (limit: ${maxTradesPerWeek}). Limit resets on ${nextMonday.toLocaleDateString()}.`,
        limitType: 'max_trades_per_week',
        current: weeklyTradeCount,
        limit: maxTradesPerWeek,
      };
    }
  }

  // Check max loss per week (if limit is set)
  if (maxLossPerWeek > 0) {
    const weeklyLossTotal = await getWeeklyLossTotal(userId, exchange);

    if (weeklyLossTotal >= maxLossPerWeek) {
      const weekStart = getWeekStart();
      const nextMonday = new Date(weekStart);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

      // Create notification (async, fire-and-forget)
      notifyWeeklyLossLimitReached(userId, weeklyLossTotal, maxLossPerWeek, exchange).catch(err => {
        logger.debug('[RiskLimits] Failed to create notification:', err.message);
      });

      return {
        allowed: false,
        reason: `Maximum loss per week limit exceeded. You have lost $${weeklyLossTotal.toFixed(2)} this week (limit: $${maxLossPerWeek.toFixed(2)}). Limit resets on ${nextMonday.toLocaleDateString()}.`,
        limitType: 'max_loss_per_week',
        current: weeklyLossTotal,
        limit: maxLossPerWeek,
      };
    }
  }

  // All checks passed
  return { allowed: true };
}

/**
 * Invalidate risk limit caches for a user/exchange (call after trade completes)
 * @param {string} userId 
 * @param {string} exchange 
 */
function invalidateRiskLimitCache(userId, exchange) {
  if (!userId || !exchange) return;

  ensureRedisInitialized();
  const weekStart = getWeekStart();
  const weekStartStr = weekStart.toISOString();

  const tradeCountKey = `risk:${userId}:${exchange}:weekly_trades:${weekStartStr}`;
  const lossKey = `risk:${userId}:${exchange}:weekly_loss:${weekStartStr}`;

  // Clear Redis cache
  if (redisClient) {
    redisClient.del(tradeCountKey, lossKey).catch(() => {});
  }

  // Clear in-memory cache
  weeklyCountCache.delete(tradeCountKey);
  weeklyCountCache.delete(lossKey);

  logger.debug(`[RiskLimits] Invalidated cache for user ${userId}, exchange ${exchange}`);
}

module.exports = {
  checkRiskLimits,
  getWeeklyTradeCount,
  getWeeklyLossTotal,
  invalidateRiskLimitCache,
  getWeekStart, // Exported for testing
};

