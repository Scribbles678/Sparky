/**
 * Risk Limits Utility
 *
 * Pre-trade safety checks derived from per-exchange settings in
 * SignalStudio's Trade Settings page (trade_settings_exchange table).
 *
 * Checks performed (in order):
 *  1. Kill switch                  — immediate halt flag
 *  2. Weekend trading              — allow_weekends
 *  3. Signal age                   — max_signal_age_sec
 *  4. Kill switch (from settings)  — kill_switch DB column
 *  5. Max daily loss               — max_daily_loss_usd
 *  6. Max consecutive failures     — max_consecutive_failures (in-memory)
 *  7. Max concurrent positions     — max_concurrent_positions
 *  8. Max position size            — max_position_size_usd (cap, not block)
 *  9. Max trades per week          — max_trades_per_week
 * 10. Max loss per week            — max_loss_per_week_usd
 *
 * DESIGN PRINCIPLES:
 * - Fast: Uses Redis + in-memory caching for counts
 * - Non-blocking on infra failure: DB errors allow trade (graceful degradation)
 * - Accurate: Counts from trades/positions tables (realized data)
 */

const { supabase } = require('../supabaseClient');
const logger = require('./logger');
const {
  notifyWeeklyTradeLimitReached,
  notifyWeeklyLossLimitReached,
} = require('./notifications');

// In-memory consecutive-failure tracker: userId:exchange → { count, lastFailAt }
const consecutiveFailures = new Map();

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
      .from('production_trades')
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
      .from('production_trades')
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
 * Get total realized losses for the current UTC day for a user/exchange.
 * Returns the total loss as a positive number (e.g. 250 means $250 lost).
 */
async function getDailyLossTotal(userId, exchange) {
  if (!userId || !exchange || !supabase) return 0;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const cacheKey = `risk:${userId}:${exchange}:daily_loss:${todayStart.toISOString()}`;
  ensureRedisInitialized();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) return parseFloat(cached);
    } catch (_) {}
  }
  const memCached = weeklyCountCache.get(cacheKey);
  if (memCached && memCached.expiry > Date.now()) return memCached.loss ?? 0;

  try {
    const { data, error } = await supabase
      .from('production_trades')
      .select('pnl_usd')
      .eq('user_id', userId)
      .eq('exchange', exchange)
      .gte('entry_time', todayStart.toISOString())
      .lt('pnl_usd', 0);

    if (error) return 0;
    const total = (data || []).reduce((sum, t) => sum + Math.abs(t.pnl_usd || 0), 0);
    cacheWeeklyLoss(cacheKey, total); // Reuse existing cache helper
    return total;
  } catch (_) {
    return 0;
  }
}

/**
 * Count open positions for a user on a given exchange.
 * Queries the `positions` table filtered by user_id + exchange.
 */
async function getOpenPositionCount(userId, exchange) {
  if (!userId || !exchange || !supabase) return 0;
  try {
    const { count, error } = await supabase
      .from('positions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('exchange', exchange);
    if (error) return 0;
    return count || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Record a trade failure for a user/exchange (for consecutive failure tracking).
 * Call this when a trade execution fails.
 */
function recordTradeFailure(userId, exchange) {
  if (!userId || !exchange) return;
  const key = `${userId}:${exchange}`;
  const existing = consecutiveFailures.get(key) || { count: 0, lastFailAt: null };
  consecutiveFailures.set(key, { count: existing.count + 1, lastFailAt: Date.now() });
}

/**
 * Reset the consecutive failure counter after a successful trade.
 */
function resetTradeFailures(userId, exchange) {
  if (!userId || !exchange) return;
  consecutiveFailures.delete(`${userId}:${exchange}`);
}

/**
 * Check risk limits before executing a trade.
 *
 * @param {string} userId
 * @param {string} exchange
 * @param {Object} settings - Exchange trade settings from database
 * @param {Object} [opts]
 * @param {number} [opts.signalTimestamp]  - Unix ms timestamp when signal was created
 * @param {string} [opts.action]           - 'buy' | 'sell' | 'close'
 * @returns {Promise<{allowed: boolean, reason?: string, limitType?: string, current?: number, limit?: number, positionSizeCap?: number}>}
 */
async function checkRiskLimits(userId, exchange, settings, opts = {}) {
  if (!settings) return { allowed: true };

  const action = (opts.action || '').toLowerCase();
  const isEntry = ['buy', 'sell', 'long', 'short'].includes(action);

  // ------------------------------------------------------------------
  // 1. KILL SWITCH — immediate halt, checked first for lowest latency
  // ------------------------------------------------------------------
  if (settings.kill_switch) {
    return {
      allowed: false,
      reason: `Kill switch is active on ${exchange}. All trading is halted. Disable it in Exchange Settings → Circuit Breaker.`,
      limitType: 'kill_switch',
    };
  }

  // ------------------------------------------------------------------
  // 2. WEEKEND CHECK — block entries on weekends if not allowed
  // ------------------------------------------------------------------
  if (isEntry && settings.allow_weekends === false) {
    const dayOfWeek = new Date().getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        allowed: false,
        reason: `Weekend trading is disabled for ${exchange}. Enable "Extended Hours Trading" in Exchange Settings to allow weekend entries.`,
        limitType: 'allow_weekends',
      };
    }
  }

  // ------------------------------------------------------------------
  // 3. SIGNAL AGE — reject stale signals before wasting an API call
  // ------------------------------------------------------------------
  const maxSignalAgeSec = settings.max_signal_age_sec ?? 0;
  if (isEntry && maxSignalAgeSec > 0 && opts.signalTimestamp) {
    const ageMs = Date.now() - opts.signalTimestamp;
    if (ageMs > maxSignalAgeSec * 1000) {
      return {
        allowed: false,
        reason: `Signal is too old (${Math.round(ageMs / 1000)}s). Max allowed age is ${maxSignalAgeSec}s. Check your TradingView alert timing.`,
        limitType: 'max_signal_age_sec',
        current: Math.round(ageMs / 1000),
        limit: maxSignalAgeSec,
      };
    }
  }

  // ------------------------------------------------------------------
  // 4. DAILY LOSS LIMIT (circuit breaker)
  // ------------------------------------------------------------------
  if (isEntry) {
    const maxDailyLoss = settings.max_daily_loss_usd ?? 0;
    if (maxDailyLoss > 0) {
      const dailyLoss = await getDailyLossTotal(userId, exchange);
      if (dailyLoss >= maxDailyLoss) {
        return {
          allowed: false,
          reason: `Daily loss limit reached. You have lost $${dailyLoss.toFixed(2)} today (limit: $${maxDailyLoss.toFixed(2)}). Trading resumes tomorrow.`,
          limitType: 'max_daily_loss_usd',
          current: dailyLoss,
          limit: maxDailyLoss,
        };
      }
    }
  }

  // ------------------------------------------------------------------
  // 5. CONSECUTIVE FAILURES (circuit breaker)
  // ------------------------------------------------------------------
  if (isEntry) {
    const maxFailures = settings.max_consecutive_failures ?? 0;
    if (maxFailures > 0) {
      const failState = consecutiveFailures.get(`${userId}:${exchange}`);
      if (failState && failState.count >= maxFailures) {
        return {
          allowed: false,
          reason: `Circuit breaker tripped: ${failState.count} consecutive execution failures on ${exchange}. Fix any API / credential issues and re-enable trading in Exchange Settings.`,
          limitType: 'max_consecutive_failures',
          current: failState.count,
          limit: maxFailures,
        };
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. MAX CONCURRENT POSITIONS
  // ------------------------------------------------------------------
  if (isEntry) {
    const maxConcurrent = settings.max_concurrent_positions ?? 0;
    if (maxConcurrent > 0) {
      const openCount = await getOpenPositionCount(userId, exchange);
      if (openCount >= maxConcurrent) {
        return {
          allowed: false,
          reason: `Max concurrent positions reached on ${exchange}: ${openCount}/${maxConcurrent} positions open. Close some positions before opening new ones.`,
          limitType: 'max_concurrent_positions',
          current: openCount,
          limit: maxConcurrent,
        };
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. MAX POSITION SIZE — returns positionSizeCap so caller can cap
  //    the position size rather than blocking the trade outright.
  // ------------------------------------------------------------------
  let positionSizeCap = null;
  const maxPositionSize = settings.max_position_size_usd ?? 0;
  if (isEntry && maxPositionSize > 0) {
    positionSizeCap = maxPositionSize;
  }

  // ------------------------------------------------------------------
  // 8. MAX TRADES PER WEEK
  // ------------------------------------------------------------------
  const maxTradesPerWeek = settings.max_trades_per_week ?? 0;
  if (isEntry && maxTradesPerWeek > 0) {
    const weeklyTradeCount = await getWeeklyTradeCount(userId, exchange);
    if (weeklyTradeCount >= maxTradesPerWeek) {
      const weekStart = getWeekStart();
      const nextMonday = new Date(weekStart);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

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

  // ------------------------------------------------------------------
  // 9. MAX LOSS PER WEEK
  // ------------------------------------------------------------------
  const maxLossPerWeek = settings.max_loss_per_week_usd ?? 0;
  if (isEntry && maxLossPerWeek > 0) {
    const weeklyLossTotal = await getWeeklyLossTotal(userId, exchange);
    if (weeklyLossTotal >= maxLossPerWeek) {
      const weekStart = getWeekStart();
      const nextMonday = new Date(weekStart);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

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
  return { allowed: true, positionSizeCap };
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
  getDailyLossTotal,
  getOpenPositionCount,
  recordTradeFailure,
  resetTradeFailures,
  invalidateRiskLimitCache,
  getWeekStart,
};

