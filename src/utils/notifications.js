/**
 * Sparky Notifications Utility
 * 
 * Creates notifications in Supabase for trade events.
 * Uses Redis caching for preferences and async writes for speed.
 * 
 * DESIGN PRINCIPLES:
 * - Never block trade execution
 * - Fire-and-forget notification inserts
 * - Fail silently (notification failure shouldn't affect trading)
 * - Cache preferences in Redis for fast lookups
 */

const { supabase } = require('../supabaseClient');
const logger = require('./logger');

// In-memory preference cache (fallback if Redis unavailable)
const preferencesCache = new Map();
const CACHE_TTL = 300000; // 5 minutes

// Redis client (optional, lazy-loaded)
let redisClient = null;

/**
 * Initialize Redis for preference caching (optional)
 */
function initRedis() {
  try {
    const { getRedisClient, isRedisAvailable } = require('./redis');
    if (isRedisAvailable()) {
      redisClient = getRedisClient();
      logger.info('[Notifications] Redis available for preference caching');
    }
  } catch (error) {
    logger.debug('[Notifications] Redis not available, using in-memory cache');
  }
}

// Try to init Redis on load
initRedis();

/**
 * Get user's notification preferences (with caching)
 * @param {string} userId 
 * @returns {Promise<Object|null>}
 */
async function getUserPreferences(userId) {
  if (!userId) return null;

  // Try Redis cache first
  if (redisClient) {
    try {
      const cached = await redisClient.get(`notif_prefs:${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.debug('[Notifications] Redis cache miss:', error.message);
    }
  }

  // Try in-memory cache
  const memCached = preferencesCache.get(userId);
  if (memCached && memCached.expiry > Date.now()) {
    return memCached.prefs;
  }

  // Fetch from database
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      // No preferences = use defaults (all true except bot_reconnected)
      return null;
    }

    // Cache in Redis (5 min TTL)
    if (redisClient) {
      redisClient.setex(`notif_prefs:${userId}`, 300, JSON.stringify(data)).catch(() => {});
    }

    // Cache in memory as fallback
    preferencesCache.set(userId, { prefs: data, expiry: Date.now() + CACHE_TTL });

    return data;
  } catch (error) {
    logger.debug('[Notifications] Error fetching preferences:', error.message);
    return null;
  }
}

/**
 * Check if user wants this notification type
 * @param {string} userId 
 * @param {string} preferenceKey - e.g., 'notify_trade_success'
 * @returns {Promise<boolean>}
 */
async function shouldNotify(userId, preferenceKey) {
  if (!preferenceKey) return true;

  const prefs = await getUserPreferences(userId);
  if (!prefs) return true; // Default to true if no preferences

  const value = prefs[preferenceKey];
  return value !== false; // Default to true if undefined
}

/**
 * Create a notification (async, fire-and-forget)
 * @param {Object} params
 */
async function createNotification(params) {
  const { userId, type, title, message, metadata, preferenceKey } = params;

  if (!supabase || !userId) {
    return null;
  }

  // Check preference (async but fast with cache)
  if (preferenceKey) {
    const shouldSend = await shouldNotify(userId, preferenceKey);
    if (!shouldSend) {
      logger.debug(`[Notifications] Skipped (user preference): ${title}`);
      return null;
    }
  }

  // Fire-and-forget insert (don't await in production paths)
  supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: type || 'info',
      title,
      message,
      metadata: metadata || {},
    })
    .then(({ error }) => {
      if (error) {
        logger.debug(`[Notifications] Insert error: ${error.message}`);
      } else {
        logger.info(`[Notifications] Created: ${title}`);
      }
    })
    .catch((err) => {
      logger.debug(`[Notifications] Exception: ${err.message}`);
    });

  return true; // Return immediately, don't wait for DB
}

// ============================================================================
// TRADE EXECUTION NOTIFICATIONS
// ============================================================================

/**
 * Trade executed successfully
 */
function notifyTradeSuccess(userId, symbol, action, exchange, quantity, price) {
  const priceInfo = price ? ` at $${price.toFixed(2)}` : '';
  const quantityInfo = quantity ? ` (${quantity})` : '';

  return createNotification({
    userId,
    type: 'trade',
    title: `${action.toUpperCase()} ${symbol}`,
    message: `Successfully opened ${action.toUpperCase()} position for ${symbol}${quantityInfo}${priceInfo} on ${exchange.toUpperCase()}`,
    metadata: { symbol, action, exchange, quantity, price },
    preferenceKey: 'notify_trade_success',
  });
}

/**
 * Trade execution failed
 */
function notifyTradeFailed(userId, symbol, action, exchange, errorMessage) {
  return createNotification({
    userId,
    type: 'error',
    title: `Trade Failed: ${symbol}`,
    message: `Failed to execute ${action.toUpperCase()} for ${symbol} on ${exchange.toUpperCase()}: ${errorMessage}`,
    metadata: { symbol, action, exchange, error: errorMessage },
    preferenceKey: 'notify_trade_failed',
  });
}

/**
 * Position closed with profit
 */
function notifyPositionClosedProfit(userId, symbol, exchange, pnl, pnlPercent) {
  const percentInfo = pnlPercent ? ` (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)` : '';

  return createNotification({
    userId,
    type: 'success',
    title: `📈 Profit: ${symbol}`,
    message: `Position closed with +$${pnl.toFixed(2)}${percentInfo} profit on ${exchange.toUpperCase()}`,
    metadata: { symbol, exchange, pnl, pnlPercent },
    preferenceKey: 'notify_position_closed_profit',
  });
}

/**
 * Position closed with loss
 */
function notifyPositionClosedLoss(userId, symbol, exchange, pnl, pnlPercent) {
  const percentInfo = pnlPercent ? ` (${pnlPercent.toFixed(2)}%)` : '';

  return createNotification({
    userId,
    type: 'warning',
    title: `📉 Loss: ${symbol}`,
    message: `Position closed with -$${Math.abs(pnl).toFixed(2)}${percentInfo} loss on ${exchange.toUpperCase()}`,
    metadata: { symbol, exchange, pnl, pnlPercent },
    preferenceKey: 'notify_position_closed_loss',
  });
}

/**
 * Take profit triggered
 */
function notifyTakeProfitTriggered(userId, symbol, exchange, price, pnl) {
  const pnlInfo = pnl ? ` Profit: +$${pnl.toFixed(2)}` : '';

  return createNotification({
    userId,
    type: 'success',
    title: `🎯 Take Profit: ${symbol}`,
    message: `Take profit triggered at $${price.toFixed(2)} on ${exchange.toUpperCase()}.${pnlInfo}`,
    metadata: { symbol, exchange, price, pnl },
    preferenceKey: 'notify_take_profit_triggered',
  });
}

/**
 * Stop loss triggered
 */
function notifyStopLossTriggered(userId, symbol, exchange, price, pnl) {
  const pnlInfo = pnl ? ` Loss: -$${Math.abs(pnl).toFixed(2)}` : '';

  return createNotification({
    userId,
    type: 'warning',
    title: `🛑 Stop Loss: ${symbol}`,
    message: `Stop loss triggered at $${price.toFixed(2)} on ${exchange.toUpperCase()}.${pnlInfo}`,
    metadata: { symbol, exchange, price, pnl },
    preferenceKey: 'notify_stop_loss_triggered',
  });
}

// ============================================================================
// RISK MANAGEMENT NOTIFICATIONS
// ============================================================================

/**
 * Weekly trade limit reached
 */
function notifyWeeklyTradeLimitReached(userId, currentCount, limit, exchange) {
  return createNotification({
    userId,
    type: 'limit',
    title: 'Weekly Trade Limit Reached',
    message: `You've executed ${currentCount}/${limit} trades this week on ${exchange.toUpperCase()}. Trading paused until next week.`,
    metadata: { limitType: 'weekly_trades', current: currentCount, limit, exchange },
    preferenceKey: 'notify_weekly_trade_limit',
  });
}

/**
 * Weekly loss limit reached
 */
function notifyWeeklyLossLimitReached(userId, currentLoss, limit, exchange) {
  return createNotification({
    userId,
    type: 'limit',
    title: 'Weekly Loss Limit Reached',
    message: `You've lost $${currentLoss.toFixed(2)}/$${limit.toFixed(2)} this week on ${exchange.toUpperCase()}. Trading paused until next week.`,
    metadata: { limitType: 'weekly_loss', current: currentLoss, limit, exchange },
    preferenceKey: 'notify_weekly_loss_limit',
  });
}

// ============================================================================
// CONNECTION/SYSTEM NOTIFICATIONS
// ============================================================================

/**
 * Exchange API error
 */
function notifyExchangeApiError(userId, exchange, errorMessage) {
  return createNotification({
    userId,
    type: 'error',
    title: `${exchange.toUpperCase()} API Error`,
    message: `Failed to connect to ${exchange.toUpperCase()}: ${errorMessage}`,
    metadata: { exchange, error: errorMessage },
    preferenceKey: 'notify_exchange_api_error',
  });
}

/**
 * Invalid credentials
 */
function notifyInvalidCredentials(userId, exchange) {
  return createNotification({
    userId,
    type: 'error',
    title: 'Invalid API Credentials',
    message: `Your ${exchange.toUpperCase()} API credentials are invalid or expired. Please update them in Settings → Bot Credentials.`,
    metadata: { exchange },
    preferenceKey: 'notify_invalid_credentials',
  });
}

/**
 * Bot disconnected
 */
function notifyBotDisconnected(userId, reason) {
  const reasonInfo = reason ? `: ${reason}` : '';

  return createNotification({
    userId,
    type: 'warning',
    title: 'Trading Bot Disconnected',
    message: `Connection to trading bot lost${reasonInfo}. Trades will not execute until reconnected.`,
    metadata: { reason },
    preferenceKey: 'notify_bot_disconnected',
  });
}

/**
 * Bot reconnected
 */
function notifyBotReconnected(userId) {
  return createNotification({
    userId,
    type: 'success',
    title: 'Trading Bot Reconnected',
    message: 'Connection to trading bot restored. Trading is now active.',
    metadata: {},
    preferenceKey: 'notify_bot_reconnected',
  });
}

module.exports = {
  createNotification,
  getUserPreferences,
  shouldNotify,
  // Trade execution
  notifyTradeSuccess,
  notifyTradeFailed,
  notifyPositionClosedProfit,
  notifyPositionClosedLoss,
  notifyTakeProfitTriggered,
  notifyStopLossTriggered,
  // Risk management
  notifyWeeklyTradeLimitReached,
  notifyWeeklyLossLimitReached,
  // Connection/system
  notifyExchangeApiError,
  notifyInvalidCredentials,
  notifyBotDisconnected,
  notifyBotReconnected,
};

