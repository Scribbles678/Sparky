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
    const positionData = {
      symbol: position.symbol,
      side: position.side,
      
      // Entry
      entry_price: position.entryPrice,
      entry_time: position.entryTime || new Date().toISOString(),
      
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
  testConnection
};

