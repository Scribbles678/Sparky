/**
 * Settings Service Update for Pending Order Management
 * 
 * This file shows the changes needed to support pending order management.
 * Apply these changes to your existing settingsService.js
 */

// ADD these two lines to getFallbackExchangeSettings() function:
function getFallbackExchangeSettings(exchange) {
  const exchangeConfig = fallbackConfig[exchange] || {};
  return {
    exchange,
    enabled: exchangeConfig.enabled !== false,
    trading_hours_preset: exchangeConfig.tradingHours || '24/5',
    trading_window: normalizeTradingWindow(exchangeConfig.tradingWindow),
    customWindow: normalizeTradingWindow(exchangeConfig.tradingWindow),
    max_trades_per_day: exchangeConfig.maxTrades || 0,
    max_position_size_usd: exchangeConfig.maxPositionSize || 0,
    take_profit_percent: exchangeConfig.takeProfit || 0,
    stop_loss_percent: exchangeConfig.stopLoss || 0,
    allow_weekends: Boolean(exchangeConfig.allowWeekends),
    news_filter: Boolean(exchangeConfig.newsFilter),
    notes: exchangeConfig.notes || null,
    position_size_percent: exchangeConfig.positionSizePercent || 0,
    strike_tolerance_percent: exchangeConfig.strikeTolerancePercent || 1,
    entry_limit_offset_percent: exchangeConfig.entryLimitOffsetPercent || 1,
    tp_percent: exchangeConfig.tpPercent || exchangeConfig.takeProfit || 0,
    sl_percent: exchangeConfig.slPercent || exchangeConfig.stopLoss || 0,
    max_signal_age_sec: exchangeConfig.maxSignalAgeSec || 10,
    auto_close_outside_window: exchangeConfig.autoCloseOutsideWindow !== false,
    max_open_positions: exchangeConfig.maxOpenPositions || 0,
    extra_settings: exchangeConfig.extra_settings || {},
    
    // NEW: Pending Order Management
    cancel_pending_orders: exchangeConfig.cancelPendingOrders ?? false,
    cancel_pending_after: exchangeConfig.cancelPendingAfter ?? '15m',
  };
}

// In refreshSettings() function, the new fields will be automatically loaded from Supabase
// No changes needed as the function already loads all columns from trade_settings_exchange

// EXAMPLE: How the settings will look after loading from DB
async function refreshSettings() {
  try {
    globalSettings = await getTradeSettingsGlobal();

    for (const exchange of trackedExchanges) {
      const settings = await getExchangeTradeSettings(exchange);
      const normalized = {
        ...settings,
        trading_window: normalizeTradingWindow(settings.trading_window),
        customWindow: normalizeTradingWindow(settings.trading_window),
        // The new fields will be included automatically:
        // cancel_pending_orders: settings.cancel_pending_orders || false,
        // cancel_pending_after: settings.cancel_pending_after || '15m',
      };
      exchangeSettingsCache.set(exchange, normalized);
    }

    lastLoadedAt = new Date();
    logger.info(
      `Trade settings refreshed from Supabase at ${lastLoadedAt.toISOString()}`
    );
  } catch (error) {
    logger.warn(
      `Failed to refresh trade settings from Supabase: ${error.message}`
    );
  }
}

// EXAMPLE: Usage in your monitors
/*
const settingsService = require('./settings/settingsService');

// Get exchange settings
const settings = settingsService.getExchangeSettings('tradier_options');

// Check if pending order cancellation is enabled
if (settings.cancel_pending_orders) {
  const cancelAfter = settings.cancel_pending_after; // '15m', '1h', 'before_session', etc.
  
  // Your cancellation logic here
  console.log(`Pending orders will be cancelled after: ${cancelAfter}`);
}
*/

module.exports = {
  // No changes to exports needed
};

