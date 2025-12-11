/**
 * Webhook Limit Checking Utility
 * 
 * Checks monthly webhook limits based on user subscription plan.
 * Creates notifications when limits are reached or warnings at 80%.
 * 
 * DESIGN PRINCIPLES:
 * - Fast: Uses Redis caching for subscription plans and counts
 * - Non-blocking: Failures don't prevent trade execution (graceful degradation)
 * - Accurate: Counts webhooks from webhook_requests table
 */

const { supabase } = require('../supabaseClient');
const logger = require('./logger');
const {
  notifyWebhookLimitWarning,
  notifyWebhookLimitReached,
} = require('./notifications');

// In-memory cache for subscription plans (fallback if Redis unavailable)
const subscriptionCache = new Map();
const SUBSCRIPTION_CACHE_TTL = 60000; // 1 minute

// In-memory cache for webhook counts (fallback if Redis unavailable)
const webhookCountCache = new Map();
const COUNT_CACHE_TTL = 30000; // 30 seconds

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
      logger.debug('[WebhookLimits] Redis available for caching');
    }
  } catch (error) {
    logger.debug('[WebhookLimits] Redis not available, using in-memory cache');
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
 * Get user's subscription plan (with caching)
 * @param {string} userId 
 * @returns {Promise<string>} Plan name ('Free', 'Basic', 'Premium', 'Pro')
 */
async function getUserSubscriptionPlan(userId) {
  if (!userId) return 'Free';

  const cacheKey = `sub:${userId}`;

  // Try Redis cache first
  ensureRedisInitialized();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      logger.debug('[WebhookLimits] Redis cache miss:', error.message);
    }
  }

  // Try in-memory cache
  const memCached = subscriptionCache.get(userId);
  if (memCached && memCached.expiry > Date.now()) {
    return memCached.plan;
  }

  // Fetch from database
  if (!supabase) {
    logger.warn('[WebhookLimits] Supabase not configured, defaulting to Free plan');
    return 'Free';
  }

  try {
    // Try database function first (handles upgrades/downgrades correctly)
    // This function prioritizes active subscriptions and handles scheduled plans
    const { data: planFromFunction, error: functionError } = await supabase
      .rpc('get_user_subscription_plan_safe', { p_user_id: userId });

    if (!functionError && planFromFunction) {
      const plan = planFromFunction;
      // Cache it
      cacheSubscriptionPlan(userId, plan);
      logger.debug(`[WebhookLimits] Got plan from function for user ${userId}: ${plan}`);
      return plan;
    }

    // Fallback: Query subscriptions table directly
    // SignalStudio uses upsert with onConflict: 'user_id', so there's only one row per user
    // The plan field is updated directly when plans change (upgrades immediately, downgrades at period end)
    const { data: activeSub, error: activeError } = await supabase
      .from('subscriptions')
      .select('plan')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (!activeError && activeSub && activeSub.plan) {
      const plan = activeSub.plan;
      cacheSubscriptionPlan(userId, plan);
      logger.debug(`[WebhookLimits] Got plan from table for user ${userId}: ${plan}`);
      return plan;
    }

    // Default to Free if no subscription found
    const plan = 'Free';
    cacheSubscriptionPlan(userId, plan);
    logger.debug(`[WebhookLimits] No subscription found for user ${userId}, defaulting to Free`);
    return plan;
  } catch (error) {
    logger.debug('[WebhookLimits] Error fetching subscription:', error.message);
    return 'Free'; // Default to Free on error
  }
}

/**
 * Cache subscription plan
 */
function cacheSubscriptionPlan(userId, plan) {
  // Cache in Redis (1 min TTL - short TTL to catch plan changes quickly)
  ensureRedisInitialized();
  if (redisClient) {
    redisClient.setex(`sub:${userId}`, 60, plan).catch(() => {});
  }

  // Cache in memory as fallback
  subscriptionCache.set(userId, {
    plan,
    expiry: Date.now() + SUBSCRIPTION_CACHE_TTL,
  });
}

/**
 * Invalidate subscription plan cache for a user (call when plan changes)
 * This ensures Sparky picks up plan changes immediately
 * @param {string} userId 
 */
function invalidateSubscriptionPlanCache(userId) {
  if (!userId) return;

  ensureRedisInitialized();
  
  // Clear Redis cache
  if (redisClient) {
    redisClient.del(`sub:${userId}`).catch(() => {});
  }

  // Clear in-memory cache
  subscriptionCache.delete(userId);
  
  logger.debug(`[WebhookLimits] Invalidated subscription plan cache for user ${userId}`);
}

/**
 * Get current month identifier (YYYY-MM format)
 * @returns {string} Month identifier like "2025-01"
 */
function getCurrentMonthId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get webhook count for current month (with caching)
 * @param {string} userId 
 * @returns {Promise<number>} Count of webhooks this month
 */
async function getWebhookCountThisMonth(userId) {
  if (!userId) return 0;

  const monthId = getCurrentMonthId();
  const cacheKey = `webhook_count:${userId}:${monthId}`; // Include month ID in cache key
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Try Redis cache first
  ensureRedisInitialized();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) {
        const count = parseInt(cached, 10);
        logger.debug(`[WebhookLimits] Cache HIT for user ${userId}, month ${monthId}: ${count}`);
        return count;
      }
    } catch (error) {
      logger.debug('[WebhookLimits] Redis cache miss:', error.message);
    }
  }

  // Try in-memory cache
  const memCached = webhookCountCache.get(userId);
  if (memCached && memCached.expiry > Date.now()) {
    // Check if month matches (handles month transitions)
    if (memCached.monthId === monthId && memCached.monthStart === monthStart) {
      logger.debug(`[WebhookLimits] Memory cache HIT for user ${userId}, month ${monthId}: ${memCached.count}`);
      return memCached.count;
    } else {
      // Month changed - invalidate stale cache
      logger.debug(`[WebhookLimits] Month transition detected for user ${userId} (${memCached.monthId} -> ${monthId}), invalidating cache`);
      webhookCountCache.delete(userId);
    }
  }

  // Fetch from database
  if (!supabase) {
    logger.warn('[WebhookLimits] Supabase not configured, cannot count webhooks');
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from('webhook_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart)
      .neq('status', 'rate_limited'); // Don't count rate-limited requests

    if (error) {
      logger.debug('[WebhookLimits] Error counting webhooks:', error.message);
      return 0;
    }

    const webhookCount = count || 0;

    // Cache it
    cacheWebhookCount(userId, webhookCount, monthStart, monthId);
    logger.debug(`[WebhookLimits] Fetched from DB for user ${userId}, month ${monthId}: ${webhookCount}`);
    return webhookCount;
  } catch (error) {
    logger.debug('[WebhookLimits] Exception counting webhooks:', error.message);
    return 0;
  }
}

/**
 * Cache webhook count
 */
function cacheWebhookCount(userId, count, monthStart, monthId) {
  const cacheKey = `webhook_count:${userId}:${monthId}`;
  
  // Cache in Redis (30 sec TTL)
  ensureRedisInitialized();
  if (redisClient) {
    redisClient.setex(cacheKey, 30, count.toString()).catch(() => {});
  }

  // Cache in memory as fallback
  webhookCountCache.set(userId, {
    count,
    monthStart,
    monthId, // Store month ID for validation
    expiry: Date.now() + COUNT_CACHE_TTL,
  });
}

/**
 * Get webhook limit for a plan
 * @param {string} plan 
 * @returns {number} Monthly webhook limit
 */
function getWebhookLimit(plan) {
  const limits = {
    Pro: 999999999, // Unlimited
    Premium: 5000,
    Basic: 1000,
    Free: 5,
  };

  return limits[plan] || limits.Free;
}

/**
 * Check webhook limit using database function (if available)
 * @param {string} userId 
 * @param {string} plan 
 * @returns {Promise<boolean>} True if under limit, false if over limit
 */
async function checkWebhookLimitFunction(userId, plan) {
  if (!supabase) return true; // Allow if Supabase not configured

  try {
    const { data, error } = await supabase.rpc('check_webhook_limit', {
      p_user_id: userId,
      p_plan: plan,
    });

    if (error) {
      logger.debug('[WebhookLimits] RPC function error:', error.message);
      return null; // Return null to indicate fallback needed
    }

    return data === true; // Function returns true if under limit
  } catch (error) {
    logger.debug('[WebhookLimits] RPC function exception:', error.message);
    return null; // Return null to indicate fallback needed
  }
}

/**
 * Check if user is under webhook limit
 * @param {string} userId 
 * @returns {Promise<{allowed: boolean, current: number, limit: number, plan: string, reason?: string}>}
 */
async function checkWebhookLimit(userId) {
  if (!userId) {
    return {
      allowed: true,
      current: 0,
      limit: 5,
      plan: 'Free',
      reason: 'No userId provided - allowing (legacy mode)',
    };
  }

  try {
    // Get subscription plan (cached)
    const plan = await getUserSubscriptionPlan(userId);
    const limit = getWebhookLimit(plan);

    // Pro plan is unlimited
    if (plan === 'Pro') {
      return {
        allowed: true,
        current: 0,
        limit,
        plan,
      };
    }

    // Try database function first (fastest)
    const functionResult = await checkWebhookLimitFunction(userId, plan);
    if (functionResult !== null) {
      // Function returned a result
      if (functionResult) {
        // Under limit
        const current = await getWebhookCountThisMonth(userId);
        return {
          allowed: true,
          current,
          limit,
          plan,
        };
      } else {
        // Over limit
        const current = await getWebhookCountThisMonth(userId);
        
        // Create notification (async, fire-and-forget)
        notifyWebhookLimitReached(userId, current, limit, plan).catch(err => {
          logger.debug('[WebhookLimits] Failed to create notification:', err.message);
        });

        return {
          allowed: false,
          current,
          limit,
          plan,
          reason: `Monthly webhook limit exceeded: ${current}/${limit}`,
        };
      }
    }

    // Fallback: Manual count and check
    const current = await getWebhookCountThisMonth(userId);

    // Check for warning threshold (80%)
    const warningThreshold = Math.floor(limit * 0.8);
    if (current >= warningThreshold && current < limit) {
      // Create warning notification (async, fire-and-forget)
      const percentUsed = Math.round((current / limit) * 100);
      const resetDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
      notifyWebhookLimitWarning(userId, current, limit, plan, percentUsed, resetDate).catch(err => {
        logger.debug('[WebhookLimits] Failed to create warning notification:', err.message);
      });
    }

    // Check if over limit
    if (current >= limit) {
      // Create notification (async, fire-and-forget)
      notifyWebhookLimitReached(userId, current, limit, plan).catch(err => {
        logger.debug('[WebhookLimits] Failed to create notification:', err.message);
      });

      return {
        allowed: false,
        current,
        limit,
        plan,
        reason: `Monthly webhook limit exceeded: ${current}/${limit}`,
      };
    }

    return {
      allowed: true,
      current,
      limit,
      plan,
    };
  } catch (error) {
    logger.error('[WebhookLimits] Error checking limit:', error);
    // On error, allow the webhook (graceful degradation)
    return {
      allowed: true,
      current: 0,
      limit: 5,
      plan: 'Free',
      reason: `Error checking limit: ${error.message} - allowing (graceful degradation)`,
    };
  }
}

/**
 * Invalidate webhook count cache for a user (call after logging a webhook)
 * This ensures the next limit check sees the updated count
 * @param {string} userId 
 */
function invalidateWebhookCountCache(userId) {
  if (!userId) return;

  ensureRedisInitialized();
  
  const monthId = getCurrentMonthId();
  const cacheKey = `webhook_count:${userId}:${monthId}`;
  
  // Clear Redis cache for current month
  if (redisClient) {
    redisClient.del(cacheKey).catch(() => {});
  }

  // Clear in-memory cache
  webhookCountCache.delete(userId);
  
  logger.debug(`[WebhookLimits] Invalidated cache for user ${userId}, month ${monthId}`);
}

/**
 * Clean up old month caches (call periodically or on month transition)
 * This prevents Redis from accumulating old month cache keys
 */
async function cleanupOldMonthCaches() {
  ensureRedisInitialized();
  
  if (!redisClient) return;
  
  try {
    const currentMonthId = getCurrentMonthId();
    const [currentYear, currentMonth] = currentMonthId.split('-').map(Number);
    
    // Get previous month ID
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const prevMonthId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    
    // Find and delete old month cache keys
    const pattern = `webhook_count:*:${prevMonthId}`;
    const keys = await redisClient.keys(pattern);
    
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug(`[WebhookLimits] Cleaned up ${keys.length} old month cache keys for ${prevMonthId}`);
    }
  } catch (error) {
    logger.debug('[WebhookLimits] Error cleaning up old caches:', error.message);
  }
}

module.exports = {
  checkWebhookLimit,
  getUserSubscriptionPlan,
  getWebhookCountThisMonth,
  getWebhookLimit,
  invalidateWebhookCountCache,
  invalidateSubscriptionPlanCache, // NEW: For plan change invalidation
  cleanupOldMonthCaches,
  getCurrentMonthId, // Exported for testing
};

