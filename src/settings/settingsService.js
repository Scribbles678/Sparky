const logger = require('../utils/logger');
const {
  getTradeSettingsGlobal,
  getExchangeTradeSettings,
} = require('../supabaseClient');

const DEFAULT_TRADING_WINDOW = ['00:00', '23:59'];

let trackedExchanges = [];
let refreshIntervalMs = 60_000;
let refreshHandle = null;
let globalSettings = null;
const exchangeSettingsCache = new Map();
let lastLoadedAt = null;
let fallbackConfig = {};

function normalizeTradingWindow(windowValue) {
  if (!windowValue) return [...DEFAULT_TRADING_WINDOW];
  if (Array.isArray(windowValue) && windowValue.length === 2) {
    return windowValue;
  }
  try {
    const parsed = JSON.parse(windowValue);
    if (Array.isArray(parsed) && parsed.length === 2) {
      return parsed;
    }
  } catch (_) {
    // ignore parse errors
  }
  return [...DEFAULT_TRADING_WINDOW];
}

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
    cancel_pending_orders: exchangeConfig.cancelPendingOrders || false,
    cancel_pending_after: exchangeConfig.cancelPendingAfter || '15m',
    close_orphaned_positions: exchangeConfig.closeOrphanedPositions || false,
    orphan_grace_minutes: exchangeConfig.orphanGraceMinutes || 5,
    kill_switch: exchangeConfig.killSwitch || false,
    max_daily_loss_usd: exchangeConfig.maxDailyLossUsd || 0,
    max_consecutive_failures: exchangeConfig.maxConsecutiveFailures || 0,
    max_concurrent_positions: exchangeConfig.maxConcurrentPositions || 0,
    max_position_size_usd: exchangeConfig.maxPositionSizeUsd || 0,
    max_trades_per_week: exchangeConfig.maxTradesPerWeek || 0,
    max_loss_per_week_usd: exchangeConfig.maxLossPerWeekUsd || 0,
    extra_settings: exchangeConfig.extra_settings || {},
  };
}

async function refreshSettings() {
  try {
    globalSettings = await getTradeSettingsGlobal();

    for (const exchange of trackedExchanges) {
      const settings = await getExchangeTradeSettings(exchange);
      const normalized = {
        ...settings,
        trading_window: normalizeTradingWindow(settings.trading_window),
        customWindow: normalizeTradingWindow(settings.trading_window),
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

function startAutoRefresh() {
  if (refreshHandle || refreshIntervalMs <= 0) {
    return;
  }

  refreshHandle = setInterval(refreshSettings, refreshIntervalMs);
  if (refreshHandle.unref) {
    refreshHandle.unref();
  }
}

async function initialize({
  exchanges = [],
  intervalMs = 60_000,
  config = {},
} = {}) {
  trackedExchanges = exchanges;
  refreshIntervalMs = intervalMs;
  fallbackConfig = config;

  await refreshSettings();
  startAutoRefresh();
}

function getGlobalTradeSettings() {
  return (
    globalSettings || {
      enabled: true,
      trading_hours_preset: '24/5',
      trading_window: [...DEFAULT_TRADING_WINDOW],
      max_trades_per_day: 0,
      max_position_size_usd: 0,
      take_profit_percent: 0,
      stop_loss_percent: 0,
      allow_weekends: false,
      news_filter: false,
      notes: null,
      extra_settings: {},
    }
  );
}

function getExchangeSettings(exchange) {
  if (exchangeSettingsCache.has(exchange)) {
    return exchangeSettingsCache.get(exchange);
  }

  return getFallbackExchangeSettings(exchange);
}

module.exports = {
  initialize,
  refreshSettings,
  getGlobalTradeSettings,
  getExchangeSettings,
  getLastLoadedAt: () => lastLoadedAt,
};

