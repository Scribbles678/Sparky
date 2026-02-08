/**
 * Supabase Client for Sparky Trading Bot
 * Connects to Supabase database to log trades and positions
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️  Missing Supabase credentials in .env file');
  console.error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your .env');
}

// Create Supabase client with service role key (full access)
const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const DEFAULT_GLOBAL_SETTINGS = {
  enabled: true,
  trading_hours_preset: '24/5',
  trading_window: ['00:00', '23:59'],
  max_trades_per_day: 0,
  max_position_size_usd: 0,
  take_profit_percent: 0,
  stop_loss_percent: 0,
  allow_weekends: false,
  news_filter: false,
  notes: null,
  extra_settings: {},
};

function buildDefaultExchangeSettings(exchange = 'default') {
  return {
    exchange,
    enabled: true,
    trading_hours_preset: '24/5',
    trading_window: ['00:00', '23:59'],
    max_trades_per_day: 0,
    max_position_size_usd: 0,
    take_profit_percent: 0,
    stop_loss_percent: 0,
    allow_weekends: false,
    news_filter: false,
    notes: null,
    position_size_percent: 0,
    strike_tolerance_percent: 1,
    entry_limit_offset_percent: 1,
    tp_percent: 5,
    sl_percent: 8,
    max_signal_age_sec: 10,
    auto_close_outside_window: true,
    max_open_positions: 3,
    extra_settings: {},
  };
}

/**
 * Log a completed trade to the database
 * @param {Object} trade - Trade data
 * @returns {Promise<Object>} - Result from Supabase
 */
async function logTrade(trade) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping trade log');
    return { error: 'Supabase not configured' };
  }

  // CRITICAL: user_id is required for multi-tenant data isolation
  if (!trade.userId) {
    console.error('❌ CRITICAL: user_id is required for trade logging! Trade will not be visible to user.');
  }

  try {
    const tradeData = {
      // MULTI-TENANT: user_id is REQUIRED for RLS policies
      user_id: trade.userId || null,
      
      symbol: trade.symbol,
      side: trade.side,
      
      // Asset Classification (REQUIRED for SignalStudio dashboard)
      asset_class: trade.assetClass || 'crypto',
      exchange: trade.exchange || 'aster',
      
      // Strategy tracking
      strategy_id: trade.strategyId || null,
      
      // Entry
      entry_price: trade.entryPrice,
      entry_time: trade.entryTime || new Date().toISOString(),
      
      // Exit
      exit_price: trade.exitPrice,
      exit_time: trade.exitTime || new Date().toISOString(),
      
      // Position
      quantity: trade.quantity,
      position_size_usd: trade.positionSizeUsd,
      
      // Risk Management
      stop_loss_price: trade.stopLossPrice || null,
      take_profit_price: trade.takeProfitPrice || null,
      stop_loss_percent: trade.stopLossPercent || null,
      take_profit_percent: trade.takeProfitPercent || null,
      
      // Results
      pnl_usd: trade.pnlUsd,
      pnl_percent: trade.pnlPercent,
      is_winner: trade.pnlUsd > 0,
      
      // Exit reason
      exit_reason: trade.exitReason || 'MANUAL',
      
      // Metadata
      order_id: trade.orderId || null,
      notes: trade.notes || null
    };

    const { data, error } = await supabase
      .from('trades')
      .insert([tradeData])
      .select();

    if (error) {
      console.error('❌ Error logging trade to Supabase:', error);
      return { error };
    }

    console.log('✅ Trade logged to database:', data[0]?.id);
    return { data };
  } catch (error) {
    console.error('❌ Exception logging trade:', error);
    return { error };
  }
}

/**
 * Save or update an open position
 * @param {Object} position - Position data
 * @returns {Promise<Object>} - Result from Supabase
 */
async function savePosition(position) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping position save');
    return { error: 'Supabase not configured' };
  }

  // CRITICAL: user_id is required for multi-tenant data isolation
  if (!position.userId) {
    console.error('❌ CRITICAL: user_id is required for position saving! Position will not be visible to user.');
  }

  try {
    // Check if position already exists to preserve entry_time
    // MULTI-TENANT: Filter by user_id AND symbol
    let existingEntryTime = null;
    if (position.preserveEntryTime !== false && position.userId) {
      const { data: existing } = await supabase
        .from('positions')
        .select('entry_time')
        .eq('user_id', position.userId)
        .eq('symbol', position.symbol)
        .single();
      
      if (existing && existing.entry_time) {
        existingEntryTime = existing.entry_time;
      }
    }
    
    const positionData = {
      // MULTI-TENANT: user_id is REQUIRED for RLS policies
      user_id: position.userId || null,
      
      symbol: position.symbol,
      side: position.side,
      
      // Asset Classification (REQUIRED for SignalStudio dashboard)
      asset_class: position.assetClass || 'crypto',
      exchange: position.exchange || 'aster',
      
      // Strategy tracking
      strategy_id: position.strategyId || null,
      
      // Entry
      entry_price: position.entryPrice,
      // Preserve existing entry_time if position exists, otherwise use provided or current time
      entry_time: existingEntryTime || position.entryTime || new Date().toISOString(),
      
      // Position
      quantity: position.quantity,
      position_size_usd: position.positionSizeUsd,
      
      // Risk Management
      stop_loss_price: position.stopLossPrice || null,
      take_profit_price: position.takeProfitPrice || null,
      stop_loss_percent: position.stopLossPercent || null,
      take_profit_percent: position.takeProfitPercent || null,
      
      // Order IDs
      entry_order_id: position.entryOrderId || null,
      stop_loss_order_id: position.stopLossOrderId || null,
      take_profit_order_id: position.takeProfitOrderId || null,
      
      // Current status
      current_price: position.currentPrice || position.entryPrice,
      unrealized_pnl_usd: position.unrealizedPnlUsd || 0,
      unrealized_pnl_percent: position.unrealizedPnlPercent || 0,
      last_price_update: new Date().toISOString(),
      
      // Metadata
      notes: position.notes || null,
      
      updated_at: new Date().toISOString()
    };

    // Use upsert to insert or update if exists
    // MULTI-TENANT: Conflict on user_id + symbol (requires positions_user_symbol_unique constraint)
    // Note: If migration hasn't been run yet, this will fail - run positions_multiuser_migration.sql
    const conflictColumns = position.userId ? 'user_id,symbol' : 'symbol';
    const { data, error } = await supabase
      .from('positions')
      .upsert([positionData], { onConflict: conflictColumns })
      .select();

    if (error) {
      console.error('❌ Error saving position to Supabase:', error);
      return { error };
    }

    console.log('✅ Position saved to database:', data[0]?.symbol);
    return { data };
  } catch (error) {
    console.error('❌ Exception saving position:', error);
    return { error };
  }
}

async function saveOptionTrade(trade) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping option trade save');
    return { error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('tradier_option_trades')
      .insert([{
        status: trade.status || 'pending_entry',
        strategy: trade.strategy || null,
        underlying_symbol: trade.underlyingSymbol,
        option_symbol: trade.optionSymbol,
        option_type: trade.optionType,
        strike_price: trade.strikePrice,
        expiration_date: trade.expirationDate,
        contract_size: trade.contractSize || 100,
        quantity_contracts: trade.quantityContracts,
        entry_order_id: trade.entryOrderId,
        tp_order_id: trade.tpOrderId,
        sl_order_id: trade.slOrderId,
        time_exit_order_id: trade.timeExitOrderId || null,
        entry_order: trade.entryOrder || null,
        tp_leg: trade.tpLeg || null,
        sl_leg: trade.slLeg || null,
        time_exit_order: trade.timeExitOrder || null,
        entry_limit_price: trade.entryLimitPrice,
        tp_limit_price: trade.tpLimitPrice,
        sl_stop_price: trade.slStopPrice,
        sl_limit_price: trade.slLimitPrice,
        cost_usd: trade.costUsd,
        pnl_usd: trade.pnlUsd || null,
        pnl_percent: trade.pnlPercent || null,
        config_snapshot: trade.configSnapshot || {},
        extra_metadata: trade.extraMetadata || {},
      }])
      .select()
      .single();

    if (error) {
      console.error('❌ Error saving option trade to Supabase:', error);
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('❌ Exception saving option trade:', error);
    return { error };
  }
}

async function updateOptionTrade(id, updates = {}) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping option trade update');
    return { error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('tradier_option_trades')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating option trade:', error);
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('❌ Exception updating option trade:', error);
    return { error };
  }
}

async function getOptionTradesByStatus(status = 'open', limit = 100) {
  if (!supabase) {
    return [];
  }

  try {
    let query = supabase
      .from('tradier_option_trades')
      .select('*');

    if (Array.isArray(status)) {
      query = query.in('status', status);
    } else {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ Error fetching option trades:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ Exception fetching option trades:', error);
    return [];
  }
}

/**
 * Remove a position from the database (when closed)
 * @param {String} symbol - Symbol to remove
 * @param {String} userId - User ID (required for multi-tenant)
 * @returns {Promise<Object>} - Result from Supabase
 */
async function removePosition(symbol, userId = null) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping position removal');
    return { error: 'Supabase not configured' };
  }

  // CRITICAL: user_id should be provided for multi-tenant safety
  if (!userId) {
    console.warn('⚠️ removePosition called without userId - may remove wrong user\'s position!');
  }

  try {
    let query = supabase
      .from('positions')
      .delete()
      .eq('symbol', symbol);
    
    // MULTI-TENANT: Filter by user_id if provided
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    const { data, error } = await query.select();

    if (error) {
      console.error('❌ Error removing position from Supabase:', error);
      return { error };
    }

    console.log('✅ Position removed from database:', symbol, userId ? `(user: ${userId})` : '');
    return { data };
  } catch (error) {
    console.error('❌ Exception removing position:', error);
    return { error };
  }
}

/**
 * Update position's unrealized P&L
 * @param {String} symbol - Symbol to update
 * @param {Number} currentPrice - Current market price
 * @param {Number} unrealizedPnlUsd - Unrealized P&L in USD
 * @param {Number} unrealizedPnlPercent - Unrealized P&L percent
 * @returns {Promise<Object>} - Result from Supabase
 */
async function updatePositionPnL(symbol, currentPrice, unrealizedPnlUsd, unrealizedPnlPercent) {
  if (!supabase) {
    return { error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('positions')
      .update({
        current_price: currentPrice,
        unrealized_pnl_usd: unrealizedPnlUsd,
        unrealized_pnl_percent: unrealizedPnlPercent,
        last_price_update: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('symbol', symbol)
      .select();

    if (error) {
      console.error('❌ Error updating position P&L:', error);
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('❌ Exception updating position P&L:', error);
    return { error };
  }
}

/**
 * Get all open positions from database
 * @returns {Promise<Array>} - Array of positions
 */
async function getOpenPositions() {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching positions:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ Exception fetching positions:', error);
    return [];
  }
}

/**
 * Fetch global trade settings
 * NOTE: Global settings are now managed in SignalStudio UI, not a separate table.
 * This function returns defaults - per-user settings come from strategies/order_config.
 * @returns {Promise<Object>}
 */
async function getTradeSettingsGlobal() {
  // Global settings managed in SignalStudio - return defaults
  return { ...DEFAULT_GLOBAL_SETTINGS };
}

/**
 * Fetch exchange-specific trade settings (or defaults)
 * MULTI-TENANT: Now requires userId to fetch user-specific settings
 * @param {string} exchange
 * @param {string} userId - User ID (required for multi-tenant)
 * @returns {Promise<Object>}
 */
async function getExchangeTradeSettings(exchange, userId = null) {
  const defaults = buildDefaultExchangeSettings(exchange);

  if (!supabase) {
    return { ...defaults };
  }

  // If no userId provided, return defaults (legacy mode)
  if (!userId) {
    console.warn(`⚠️ getExchangeTradeSettings called without userId for ${exchange} - returning defaults`);
    return { ...defaults };
  }

  try {
    let query = supabase
      .from('trade_settings_exchange')
      .select('*')
      .eq('exchange', exchange)
      .eq('user_id', userId); // MULTI-TENANT: Filter by user_id

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error(`❌ Error fetching trade settings for ${exchange} (user ${userId}):`, error);
      return { ...defaults };
    }

    if (!data) {
      return { ...defaults };
    }

    return {
      ...defaults,
      ...data,
      trading_window: parseJsonArray(data.trading_window, defaults.trading_window),
      extra_settings: data.extra_settings || {},
    };
  } catch (error) {
    console.error(`❌ Exception fetching trade settings for ${exchange} (user ${userId}):`, error);
    return { ...defaults };
  }
}

/**
 * Fetch stored bot credentials (API keys, webhook secret, etc.)
 * @returns {Promise<Array>} Array of credential rows
 */
async function getBotCredentials() {
  if (!supabase) {
    console.warn('Supabase not configured, skipping credential fetch');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('bot_credentials')
      .select('*');

    if (error) {
      console.error('❌ Error fetching bot credentials:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('❌ Exception fetching bot credentials:', error);
    return [];
  }
}

/**
 * Fetch a specific user's exchange credentials
 * This is the CORE function for multi-tenant credential loading.
 * Each user's API keys are stored in SignalStudio (bot_credentials table).
 * 
 * CACHING: Uses Redis to cache credentials for 60 seconds to reduce DB queries.
 * 
 * @param {string} userId - The user's UUID
 * @param {string} exchange - The exchange name (e.g., 'aster', 'oanda')
 * @returns {Promise<Object|null>} - Credentials object or null if not found
 */
async function getUserExchangeCredentials(userId, exchange, environment = 'production') {
  if (!supabase) {
    console.error('❌ Supabase not configured, cannot fetch user credentials');
    return null;
  }

  if (!userId) {
    console.error('❌ userId is required to fetch exchange credentials');
    return null;
  }

  if (!exchange) {
    console.error('❌ exchange is required to fetch credentials');
    return null;
  }

  const exchangeLower = exchange.toLowerCase();
  const cacheKey = `credentials:${userId}:${exchangeLower}:${environment}`;

  // Try to use Redis cache if available
  try {
    const { getOrSetCache, isRedisAvailable } = require('./utils/redis');
    
    if (isRedisAvailable()) {
      return await getOrSetCache(
        cacheKey,
        () => fetchCredentialsFromDb(userId, exchangeLower, environment),
        60 // Cache for 60 seconds
      );
    }
  } catch (error) {
    // Redis not available - fall through to direct DB fetch
    console.debug('[Credentials] Redis not available, fetching from DB directly');
  }

  // Direct DB fetch (fallback if Redis not available)
  return await fetchCredentialsFromDb(userId, exchangeLower, environment);
}

/**
 * Internal function to fetch credentials from Supabase
 * @private
 */
async function fetchCredentialsFromDb(userId, exchange, environment = 'production') {
  try {
    const { data, error } = await supabase
      .from('bot_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('exchange', exchange)
      .eq('environment', environment)
      .maybeSingle();

    if (error) {
      console.error(`❌ Error fetching ${exchange} credentials for user ${userId}:`, error);
      return null;
    }

    if (!data) {
      console.warn(`⚠️ No ${exchange} credentials found for user ${userId}`);
      return null;
    }

    // Merge extra_config and extra_metadata (extra_metadata takes precedence)
    const extraConfig = data.extra_config || {};
    const extraMetadata = data.extra_metadata || {};
    const mergedExtra = { ...extraConfig, ...extraMetadata };
    
    const apiVersion = mergedExtra.api_version || 'v1';
    console.log(`✅ Loaded ${exchange} credentials for user ${userId} (label: ${data.label || 'default'}, version: ${apiVersion})`);
    
    return {
      userId: data.user_id,
      exchange: data.exchange,
      label: data.label,
      apiKey: data.api_key,
      apiSecret: data.api_secret,
      // Additional fields that might be needed for specific exchanges
      accountId: data.account_id,
      accessToken: data.access_token,
      environment: data.environment,
      extra: mergedExtra,
      extra_metadata: extraMetadata,
    };
  } catch (error) {
    console.error(`❌ Exception fetching ${exchange} credentials for user ${userId}:`, error);
    return null;
  }
}

/**
 * In-memory cache for webhook credentials
 * Maps webhook_secret -> { userId, exchange, label }
 */
let credentialsCache = new Map();
let cacheInitialized = false;
let lastCacheRefresh = null;

/**
 * Initialize credential cache by loading all webhook credentials from Supabase
 * @returns {Promise<void>}
 */
async function initializeCredentialCache() {
  if (!supabase) {
    console.warn('Supabase not configured, cannot initialize credential cache');
    return;
  }

  try {
    const { data, error } = await supabase
      .from('bot_credentials')
      .select('user_id, exchange, label, webhook_secret')
      .eq('exchange', 'webhook')
      .eq('environment', 'production');

    if (error) {
      console.error('❌ Error loading credentials for cache:', error);
      return;
    }

    // Clear existing cache
    credentialsCache.clear();

    // Populate cache
    if (data && data.length > 0) {
      data.forEach(cred => {
        if (cred.webhook_secret) {
          credentialsCache.set(cred.webhook_secret, {
            userId: cred.user_id,
            exchange: cred.exchange,
            label: cred.label
          });
        }
      });
      console.log(`✅ Credential cache initialized with ${credentialsCache.size} webhook secrets`);
    } else {
      console.log('⚠️  No webhook credentials found in database');
    }

    cacheInitialized = true;
    lastCacheRefresh = new Date();
  } catch (error) {
    console.error('❌ Exception initializing credential cache:', error);
  }
}

/**
 * Refresh credential cache by reloading from Supabase
 * @returns {Promise<void>}
 */
async function refreshCredentialCache() {
  await initializeCredentialCache();
}

/**
 * Validate webhook secret by looking it up in cache (fast) or Supabase (fallback)
 * @param {string} secret - Webhook secret to validate
 * @param {boolean} forceDbQuery - If true, always query Supabase (bypass cache)
 * @returns {Object|null|Promise<Object|null>} - User credential object if valid, null otherwise
 */
function validateWebhookSecret(secret, forceDbQuery = false) {
  if (!secret) {
    return null;
  }

  // If cache not initialized or force DB query, query Supabase
  if (!cacheInitialized || forceDbQuery) {
    return validateWebhookSecretFromDb(secret);
  }

  // Try cache first (fast, no DB query)
  const cached = credentialsCache.get(secret);
  if (cached) {
    return cached;
  }

  // Not in cache, return null (caller can fall back to DB query if needed)
  return null;
}

/**
 * Validate webhook secret by querying Supabase directly (fallback)
 * @param {string} secret - Webhook secret to validate
 * @returns {Promise<Object|null>} - User credential object if valid, null otherwise
 */
async function validateWebhookSecretFromDb(secret) {
  if (!supabase) {
    console.warn('Supabase not configured, cannot validate webhook secret');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('bot_credentials')
      .select('user_id, exchange, label, webhook_secret')
      .eq('webhook_secret', secret)
      .eq('exchange', 'webhook')
      .eq('environment', 'production')
      .maybeSingle();

    if (error) {
      console.error('❌ Error validating webhook secret:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    // Add to cache for future use
    credentialsCache.set(secret, {
      userId: data.user_id,
      exchange: data.exchange,
      label: data.label
    });

    return {
      userId: data.user_id,
      exchange: data.exchange,
      label: data.label
    };
  } catch (error) {
    console.error('❌ Exception validating webhook secret:', error);
    return null;
  }
}

function parseJsonArray(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Log webhook request to database
 * Used for limit tracking and analytics
 * @param {Object} webhookData - Webhook request data
 * @returns {Promise<Object>} - Result from Supabase
 */
async function logWebhookRequest(webhookData) {
  if (!supabase) {
    return { error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('webhook_requests')
      .insert({
        user_id: webhookData.userId,
        webhook_secret: webhookData.webhookSecret,
        exchange: webhookData.exchange || 'unknown',
        action: webhookData.action || 'unknown',
        symbol: webhookData.symbol || 'unknown',
        strategy_id: webhookData.strategyId || null,
        payload: webhookData.payload || {},
        status: webhookData.status || 'pending',
        error_message: webhookData.errorMessage || null,
        processed_at: webhookData.status === 'success' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Error logging webhook request:', error);
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('❌ Exception logging webhook request:', error);
    return { error };
  }
}

/**
 * Test database connection
 * @returns {Promise<Boolean>} - True if connected
 */
async function testConnection() {
  if (!supabase) {
    return false;
  }

  try {
    const { data, error } = await supabase
      .from('trades')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Database connection test failed:', error.message);
      return false;
    }

    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message);
    return false;
  }
}

module.exports = {
  supabase,
  logTrade,
  savePosition,
  removePosition,
  updatePositionPnL,
  getOpenPositions,
  getTradeSettingsGlobal,
  getExchangeTradeSettings,
  getBotCredentials,
  getUserExchangeCredentials,  // NEW: Per-user credential loading for multi-tenant
  validateWebhookSecret,
  validateWebhookSecretFromDb,
  initializeCredentialCache,
  refreshCredentialCache,
  saveOptionTrade,
  updateOptionTrade,
  getOptionTradesByStatus,
  logWebhookRequest,  // NEW: Log webhook requests for limit tracking
  testConnection
};

