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

  try {
    const tradeData = {
      symbol: trade.symbol,
      side: trade.side,
      
      // Asset Classification (REQUIRED for TradeFI dashboard)
      asset_class: trade.assetClass || 'crypto', // Default to crypto for Aster DEX and Lighter DEX
      exchange: trade.exchange || 'aster', // Default to aster for Aster DEX
      
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

  try {
    // Check if position already exists to preserve entry_time
    let existingEntryTime = null;
    if (position.preserveEntryTime !== false) { // Default to preserving entry_time
      const { data: existing } = await supabase
        .from('positions')
        .select('entry_time')
        .eq('symbol', position.symbol)
        .single();
      
      if (existing && existing.entry_time) {
        existingEntryTime = existing.entry_time;
      }
    }
    
    const positionData = {
      symbol: position.symbol,
      side: position.side,
      
      // Asset Classification (REQUIRED for TradeFI dashboard)
      asset_class: position.assetClass || 'crypto', // Default to crypto for Aster DEX and Lighter DEX
      exchange: position.exchange || 'aster', // Default to aster for Aster DEX
      
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
    const { data, error } = await supabase
      .from('positions')
      .upsert([positionData], { onConflict: 'symbol' })
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
 * @returns {Promise<Object>} - Result from Supabase
 */
async function removePosition(symbol) {
  if (!supabase) {
    console.warn('Supabase not configured, skipping position removal');
    return { error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('positions')
      .delete()
      .eq('symbol', symbol)
      .select();

    if (error) {
      console.error('❌ Error removing position from Supabase:', error);
      return { error };
    }

    console.log('✅ Position removed from database:', symbol);
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
 * Fetch global trade settings (or defaults if none/config missing)
 * @returns {Promise<Object>}
 */
async function getTradeSettingsGlobal() {
  if (!supabase) {
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }

  try {
    const { data, error } = await supabase
      .from('trade_settings_global')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error fetching global trade settings:', error);
      return { ...DEFAULT_GLOBAL_SETTINGS };
    }

    if (!data) {
      return { ...DEFAULT_GLOBAL_SETTINGS };
    }

    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      ...data,
      trading_window: parseJsonArray(data.trading_window, DEFAULT_GLOBAL_SETTINGS.trading_window),
      extra_settings: data.extra_settings || {},
    };
  } catch (error) {
    console.error('❌ Exception fetching global trade settings:', error);
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
}

/**
 * Fetch exchange-specific trade settings (or defaults)
 * @param {string} exchange
 * @returns {Promise<Object>}
 */
async function getExchangeTradeSettings(exchange) {
  const defaults = buildDefaultExchangeSettings(exchange);

  if (!supabase) {
    return { ...defaults };
  }

  try {
    const { data, error } = await supabase
      .from('trade_settings_exchange')
      .select('*')
      .eq('exchange', exchange)
      .maybeSingle();

    if (error) {
      console.error(`❌ Error fetching trade settings for ${exchange}:`, error);
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
    console.error(`❌ Exception fetching trade settings for ${exchange}:`, error);
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
 * Validate webhook secret by looking it up in Supabase bot_credentials table
 * @param {string} secret - Webhook secret to validate
 * @returns {Promise<Object|null>} - User credential object if valid, null otherwise
 */
async function validateWebhookSecret(secret) {
  if (!supabase) {
    console.warn('Supabase not configured, cannot validate webhook secret');
    return null;
  }

  if (!secret) {
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
  validateWebhookSecret,
  saveOptionTrade,
  updateOptionTrade,
  getOptionTradesByStatus,
  testConnection
};

