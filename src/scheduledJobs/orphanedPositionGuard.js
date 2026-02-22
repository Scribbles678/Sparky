/**
 * Orphaned Position Guard — Multi-Tenant Scheduled Job
 *
 * Runs every 60 seconds. For each user with `close_orphaned_positions = true`
 * in trade_settings_exchange, this job:
 *   1. Fetches all open positions from the exchange
 *   2. Fetches all open/pending orders from the exchange
 *   3. For each position, checks whether a matching active exit order exists
 *      (sell, stop, trailing stop for the same symbol)
 *   4. Tracks how long the position has been "orphaned" using an in-memory map
 *   5. Once the orphan has persisted for longer than `orphan_grace_minutes`,
 *      closes the position at market price
 *
 * Supports: tradier (equity), tradier_options
 *
 * Detection logic:
 *   LONG equity position → needs at least one active sell / stop / trailing_stop order
 *   SHORT equity position → needs at least one active buy-to-cover order
 *
 * The grace period prevents false positives immediately after entry fills, while
 * bracket/OCO exit orders are being confirmed by the exchange.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const ExchangeFactory = require('../exchanges/ExchangeFactory');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPPORTED_EXCHANGES = ['tradier', 'tradier_options'];

// Active-order statuses — these are the only ones that "protect" a position
const ACTIVE_STATUSES = new Set(['pending', 'open', 'partially_filled']);

// Exit-side order types for equity (Tradier conventions)
// A LONG position is protected by: sell, sell_to_close, stop, stop_limit, trailing_stop
// A SHORT position is protected by: buy, buy_to_cover, stop, stop_limit, trailing_stop
const EXIT_SIDES_LONG  = new Set(['sell', 'sell_to_close']);
const EXIT_TYPES_ANY   = new Set(['stop', 'stop_limit', 'trailing_stop']);
const EXIT_SIDES_SHORT = new Set(['buy', 'buy_to_cover', 'buy_to_open']);

/**
 * In-memory map: `${userId}:${exchange}:${symbol}` → Date first seen as orphan
 * Cleared when position is closed or an exit order reappears.
 */
const orphanFirstSeen = new Map();

// ─── helpers ────────────────────────────────────────────────────────────────

function isLong(position) {
  // Tradier: positionAmt > 0, or we can check the 'quantity' field
  const qty = parseFloat(position.quantity || position.positionAmt || position.long_quantity || 0);
  return qty > 0;
}

function hasActiveExitOrder(symbol, isLongPosition, orders) {
  return orders.some(order => {
    // Must be for the same symbol and in an active state
    if (order.symbol !== symbol) return false;
    if (!ACTIVE_STATUSES.has(String(order.status || '').toLowerCase())) return false;

    const side = String(order.side || '').toLowerCase();
    const type = String(order.type || '').toLowerCase();

    // Stop / stop-limit / trailing-stop orders protect any direction
    if (EXIT_TYPES_ANY.has(type)) return true;

    // Direction-specific sell/buy orders
    if (isLongPosition && EXIT_SIDES_LONG.has(side)) return true;
    if (!isLongPosition && EXIT_SIDES_SHORT.has(side)) return true;

    return false;
  });
}

// ─── core tick ──────────────────────────────────────────────────────────────

async function runGuard() {
  try {
    const { data: rows, error } = await supabase
      .from('trade_settings_exchange')
      .select('user_id, exchange, orphan_grace_minutes')
      .eq('close_orphaned_positions', true)
      .in('exchange', SUPPORTED_EXCHANGES);

    if (error) {
      logger.warn('[OrphanGuard] Failed to query trade_settings_exchange:', error.message);
      return;
    }

    if (!rows || rows.length === 0) return;

    logger.debug(`[OrphanGuard] Checking ${rows.length} user-exchange pair(s) for orphaned positions`);

    for (const row of rows) {
      try {
        await processUserExchange(row);
      } catch (err) {
        logger.warn(`[OrphanGuard] Error processing user=${row.user_id} exchange=${row.exchange}:`, err.message);
      }
    }
  } catch (err) {
    logger.warn('[OrphanGuard] Unexpected error in runGuard:', err.message);
  }
}

async function processUserExchange(row) {
  const { user_id, exchange } = row;
  const graceMs = (Number(row.orphan_grace_minutes) || 5) * 60_000;

  // Load credentials — try sandbox first (paper trading), then production
  const api = await ExchangeFactory.createExchangeForUser(user_id, exchange, 'sandbox').catch(() => null)
    || await ExchangeFactory.createExchangeForUser(user_id, exchange, 'production').catch(() => null);

  if (!api) {
    logger.debug(`[OrphanGuard] No credentials for user=${user_id} exchange=${exchange} — skipping`);
    return;
  }

  // Fetch open positions
  let positions = [];
  if (typeof api.getPositions === 'function') {
    positions = await api.getPositions();
  }
  positions = (positions || []).filter(p => {
    const qty = parseFloat(p.quantity || p.positionAmt || p.long_quantity || p.short_quantity || 0);
    return Math.abs(qty) > 0;
  });

  if (positions.length === 0) {
    // Clear any tracked orphan keys for this user+exchange (positions all gone)
    for (const key of orphanFirstSeen.keys()) {
      if (key.startsWith(`${user_id}:${exchange}:`)) {
        orphanFirstSeen.delete(key);
      }
    }
    return;
  }

  // Fetch all orders
  let orders = [];
  if (typeof api.getOrders === 'function') {
    orders = await api.getOrders();
  } else if (typeof api.fetchOpenOrders === 'function') {
    orders = await api.fetchOpenOrders();
  }
  orders = orders || [];

  const now = Date.now();

  for (const position of positions) {
    const symbol = position.symbol || position.instrument;
    if (!symbol) continue;

    const longPosition = isLong(position);
    const orphanKey = `${user_id}:${exchange}:${symbol}`;

    if (hasActiveExitOrder(symbol, longPosition, orders)) {
      // Exit order exists — clear orphan tracking if it was set
      if (orphanFirstSeen.has(orphanKey)) {
        logger.debug(`[OrphanGuard] Exit order reappeared for ${symbol} (user=${user_id}) — cleared orphan flag`);
        orphanFirstSeen.delete(orphanKey);
      }
      continue;
    }

    // No active exit order — start or check grace timer
    if (!orphanFirstSeen.has(orphanKey)) {
      orphanFirstSeen.set(orphanKey, now);
      logger.info(`[OrphanGuard] No exit orders for ${symbol} (user=${user_id} ${exchange}) — starting ${row.orphan_grace_minutes}m grace period`);
      continue;
    }

    const orphanAge = now - orphanFirstSeen.get(orphanKey);
    if (orphanAge < graceMs) {
      logger.debug(`[OrphanGuard] ${symbol} orphaned for ${Math.round(orphanAge / 1000)}s — grace period not yet elapsed`);
      continue;
    }

    // Grace period exceeded — close the position at market
    logger.warn(`[OrphanGuard] ⚠️  ${symbol} has been orphaned (no exit orders) for ${Math.round(orphanAge / 60000)}m — closing at market (user=${user_id})`);

    try {
      await closePositionAtMarket(api, position, symbol, longPosition);
      orphanFirstSeen.delete(orphanKey);
      logger.info(`[OrphanGuard] ✅ Closed orphaned position: ${symbol} for user=${user_id}`);
    } catch (err) {
      logger.error(`[OrphanGuard] Failed to close orphaned ${symbol} for user=${user_id}: ${err.message}`);
    }
  }
}

async function closePositionAtMarket(api, position, symbol, isLongPosition) {
  // Determine quantity to close
  const qty = Math.abs(parseFloat(
    position.quantity || position.positionAmt || position.long_quantity || 0
  ));

  if (qty <= 0) return;

  const closeSide = isLongPosition ? 'sell' : 'buy';

  // Tradier: use placeMarketOrder(symbol, side, quantity)
  if (typeof api.placeMarketOrder === 'function') {
    return await api.placeMarketOrder(symbol, closeSide, qty);
  }

  // Generic fallback
  if (typeof api.placeOrder === 'function') {
    return await api.placeOrder({ symbol, side: closeSide.toUpperCase(), type: 'MARKET', quantity: qty, reduceOnly: true });
  }

  throw new Error(`No market order method available on API for ${symbol}`);
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

let _timer = null;

function startOrphanedPositionGuard(intervalMs = 60_000) {
  if (_timer) return;

  logger.info(`[OrphanGuard] Started — checking every ${intervalMs / 1000}s`);

  runGuard().catch(err => logger.warn('[OrphanGuard] Initial run failed:', err.message));
  _timer = setInterval(runGuard, intervalMs);

  if (_timer.unref) _timer.unref();
}

function stopOrphanedPositionGuard() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    orphanFirstSeen.clear();
    logger.info('[OrphanGuard] Stopped');
  }
}

module.exports = { startOrphanedPositionGuard, stopOrphanedPositionGuard };
