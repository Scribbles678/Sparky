/**
 * Pending Order Cleanup — Multi-Tenant Scheduled Job
 *
 * Runs every 60 seconds. For each user that has `cancel_pending_orders = true`
 * configured in trade_settings_exchange, this job:
 *   1. Loads the user's exchange credentials from bot_credentials
 *   2. Fetches all pending/open orders from the exchange
 *   3. Cancels orders that have exceeded the configured timeout
 *
 * Supports: tradier, tradier_options, oanda, apex, aster
 * Timeout options: 1m, 5m, 15m, 30m, 1h, before_session
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const ExchangeFactory = require('../exchanges/ExchangeFactory');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Exchanges this job handles
const SUPPORTED_EXCHANGES = ['tradier', 'tradier_options', 'oanda', 'apex', 'aster'];

// Order statuses that are considered "pending" across all supported exchanges
// Tradier: 'pending', 'open', 'partially_filled'
// Aster v1/v3: 'new', 'partially_filled'
// Apex (CCXT): 'open'
// OANDA: 'pending'
const PENDING_STATUSES = new Set(['pending', 'open', 'new', 'partially_filled']);

let _timer = null;

// ─── helpers ────────────────────────────────────────────────────────────────

function parseTimeoutMs(value) {
  const match = String(value).match(/^(\d+)([mh])$/);
  if (!match) return 15 * 60 * 1000; // default 15 min
  const n = parseInt(match[1], 10);
  return match[2] === 'h' ? n * 3600000 : n * 60000;
}

function parseTimeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function resolveSessionWindow(preset, customWindow) {
  switch (preset) {
    case '24/7':
    case '24/5':
      return ['00:00', '23:59'];
    case 'market-hours':
      return ['09:30', '16:00'];
    case 'forex-hours':
      return ['00:00', '23:59'];
    case 'custom':
      if (Array.isArray(customWindow) && customWindow.length === 2) return customWindow;
      return ['00:00', '23:59'];
    default:
      return ['09:30', '16:00'];
  }
}

function isBeforeSessionCancel(settings) {
  const preset = settings.trading_hours_preset || 'market-hours';
  let window = settings.trading_window;
  if (typeof window === 'string') {
    try { window = JSON.parse(window); } catch { window = null; }
  }
  const [, end] = resolveSessionWindow(preset, window);
  const endMins = parseTimeToMinutes(end);

  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etString);
  const nowMins = etDate.getHours() * 60 + etDate.getMinutes();

  return nowMins >= endMins - 5;
}

function shouldCancel(order, settings) {
  const cancelAfter = settings.cancel_pending_after || '15m';

  // Resolve order creation time across all exchange formats:
  //   Tradier:      order.create_date  (ISO string)
  //   OANDA:        order.createTime   (RFC3339 string)
  //   Aster v1/v3:  order.time         (millisecond number)
  //   Apex (CCXT):  order.timestamp    (millisecond number) or order.datetime (ISO string)
  //   Generic:      order.created_at
  const orderTimeRaw =
    order.create_date ||
    order.created_at  ||
    order.createTime  ||
    order.datetime    ||
    order.time        ||
    order.timestamp;
  if (!orderTimeRaw) return false;

  const orderTime = new Date(orderTimeRaw);
  if (isNaN(orderTime.getTime())) return false;

  if (cancelAfter === 'before_session') {
    return isBeforeSessionCancel(settings);
  }

  const timeoutMs = parseTimeoutMs(cancelAfter);
  return (Date.now() - orderTime.getTime()) >= timeoutMs;
}

// ─── core tick ──────────────────────────────────────────────────────────────

async function runCleanup() {
  try {
    // Load all exchange settings rows with auto-cancel enabled
    const { data: rows, error } = await supabase
      .from('trade_settings_exchange')
      .select('user_id, exchange, cancel_pending_after, trading_hours_preset, trading_window')
      .eq('cancel_pending_orders', true)
      .in('exchange', SUPPORTED_EXCHANGES);

    if (error) {
      logger.warn('[PendingOrderCleanup] Failed to query trade_settings_exchange:', error.message);
      return;
    }

    if (!rows || rows.length === 0) return;

    logger.debug(`[PendingOrderCleanup] Checking ${rows.length} user-exchange pair(s) with auto-cancel enabled`);

    for (const row of rows) {
      try {
        await processUserExchange(row);
      } catch (err) {
        logger.warn(`[PendingOrderCleanup] Error processing user=${row.user_id} exchange=${row.exchange}:`, err.message);
      }
    }
  } catch (err) {
    logger.warn('[PendingOrderCleanup] Unexpected error in runCleanup:', err.message);
  }
}

async function processUserExchange(row) {
  const { user_id, exchange } = row;

  // Load this user's credentials for the exchange
  const api = await ExchangeFactory.createExchangeForUser(user_id, exchange, 'sandbox')
    .catch(() => null)
    || await ExchangeFactory.createExchangeForUser(user_id, exchange, 'production')
    .catch(() => null);

  if (!api) {
    logger.debug(`[PendingOrderCleanup] No credentials for user=${user_id} exchange=${exchange} — skipping`);
    return;
  }

  // Fetch open/pending orders — all exchanges now expose getOpenOrders().
  // Fall back to Tradier-style getOrders() if available (returns all orders including filled).
  let orders = [];
  if (typeof api.getOpenOrders === 'function') {
    orders = await api.getOpenOrders();
  } else if (typeof api.getOrders === 'function') {
    orders = await api.getOrders();
  }

  if (!orders || orders.length === 0) return;

  // Filter to only truly pending / unfilled orders
  const pending = orders.filter(o => PENDING_STATUSES.has(String(o.status).toLowerCase()));
  if (pending.length === 0) return;

  logger.debug(`[PendingOrderCleanup] user=${user_id} exchange=${exchange}: ${pending.length} pending order(s) found`);

  for (const order of pending) {
    if (!shouldCancel(order, row)) continue;

    const orderId = order.id;
    const symbol = order.symbol || 'unknown';

    try {
      // All Sparky API wrappers use cancelOrder(symbol, orderId) — the CCXT wrapper handles
      // the internal argument reversal for exchanges that use id-first conventions.
      await api.cancelOrder(symbol, orderId);
      logger.info(`[PendingOrderCleanup] ✅ Cancelled order ${orderId} (${symbol}) for user=${user_id} — exceeded timeout "${row.cancel_pending_after}"`);
    } catch (err) {
      logger.warn(`[PendingOrderCleanup] Failed to cancel order ${orderId} for user=${user_id}: ${err.message}`);
    }
  }
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

function startPendingOrderCleanup(intervalMs = 60_000) {
  if (_timer) return;

  logger.info(`[PendingOrderCleanup] Started — checking every ${intervalMs / 1000}s`);

  // Run immediately on start, then on interval
  runCleanup().catch(err => logger.warn('[PendingOrderCleanup] Initial run failed:', err.message));
  _timer = setInterval(runCleanup, intervalMs);

  // Allow process to exit even if timer is running
  if (_timer.unref) _timer.unref();
}

function stopPendingOrderCleanup() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('[PendingOrderCleanup] Stopped');
  }
}

module.exports = { startPendingOrderCleanup, stopPendingOrderCleanup };
