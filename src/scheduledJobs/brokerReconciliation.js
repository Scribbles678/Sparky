/**
 * Broker Reconciliation Scheduler — READ-ONLY AUDIT MODE
 *
 * Runs every 5 minutes. For each user with exchange credentials, fetches
 * closed trades from the broker and COMPARES with internal P&L data.
 *
 * Does NOT overwrite paper_trades or production_trades. Instead, logs
 * divergences to reconciliation_log for monitoring. The TradeLifecycleManager
 * is now the single authoritative writer for trade P&L.
 *
 * Supports: tradier (equity), oanda, aster (via CCXT fills)
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const ExchangeFactory = require('../exchanges/ExchangeFactory');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const SUPPORTED_EXCHANGES = ['tradier', 'oanda', 'aster'];
const LOG_PREFIX = '[BrokerReconciliation]';

let _timer = null;

// ─── broker-specific closed trade fetchers ──────────────────────────────────

async function fetchTradierClosedTrades(api) {
  try {
    const positions = await api.getGainLoss(1, 250);
    return (positions || []).map(t => ({
      symbol: t.symbol,
      quantity: Math.abs(parseFloat(t.quantity || 0)),
      cost: parseFloat(t.cost || 0),
      proceeds: parseFloat(t.proceeds || 0),
      gain_loss: parseFloat(t.gain_loss || 0),
      gain_loss_percent: parseFloat(t.gain_loss_percent || 0),
      open_date: t.open_date || null,
      close_date: t.close_date || null,
    }));
  } catch (err) {
    logger.warn(`${LOG_PREFIX} Tradier getGainLoss failed: ${err.message}`);
    return [];
  }
}

async function fetchOandaClosedTrades(api) {
  try {
    if (typeof api.getClosedTrades === 'function') {
      const trades = await api.getClosedTrades(250);
      return (trades || []).map(t => ({
        symbol: t.instrument || t.symbol || '',
        quantity: Math.abs(parseFloat(t.initialUnits || t.units || 0)),
        gain_loss: parseFloat(t.realizedPL || t.realizedPnl || 0),
        gain_loss_percent: 0,
        open_date: t.openTime || null,
        close_date: t.closeTime || null,
      }));
    }
    // Fallback: use trade history
    const fills = await api.getTradeHistory(null, 250);
    return (fills || []).filter(f => f.realizedPnl !== 0).map(f => ({
      symbol: f.symbol || '',
      quantity: Math.abs(parseFloat(f.quantity || f.qty || 0)),
      gain_loss: parseFloat(f.realizedPnl || 0),
      gain_loss_percent: 0,
      open_date: f.time || null,
      close_date: f.time || null,
    }));
  } catch (err) {
    logger.warn(`${LOG_PREFIX} OANDA closed trades failed: ${err.message}`);
    return [];
  }
}

async function fetchAsterClosedTrades(api) {
  try {
    const fills = await api.getTradeHistory(null, 250);
    return (fills || []).filter(f => parseFloat(f.realizedPnl || 0) !== 0).map(f => ({
      symbol: f.symbol || '',
      quantity: Math.abs(parseFloat(f.quantity || f.qty || 0)),
      gain_loss: parseFloat(f.realizedPnl || 0),
      gain_loss_percent: 0,
      open_date: f.time || null,
      close_date: f.time || null,
      orderId: f.orderId || f.id || null,
    }));
  } catch (err) {
    logger.warn(`${LOG_PREFIX} Aster trade history failed: ${err.message}`);
    return [];
  }
}

function fetchClosedTrades(exchange, api) {
  switch (exchange) {
    case 'tradier': return fetchTradierClosedTrades(api);
    case 'oanda':   return fetchOandaClosedTrades(api);
    case 'aster':   return fetchAsterClosedTrades(api);
    default:        return Promise.resolve([]);
  }
}

// ─── symbol normalization ───────────────────────────────────────────────────

function normalizeSymbol(sym) {
  return String(sym || '').trim().toUpperCase().replace(/\//g, '_').replace(/-/g, '');
}

// ─── matching logic ─────────────────────────────────────────────────────────

function withinTimeWindow(dateA, dateB, windowMinutes) {
  if (!dateA || !dateB) return true; // assume match if no time data
  const diff = Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime());
  return diff <= windowMinutes * 60_000;
}

// ─── core reconciliation per user+exchange ──────────────────────────────────

async function reconcileUserExchange(userId, exchange, environment, targetTable) {
  const startTime = Date.now();
  const DIVERGENCE_THRESHOLD_PCT = 2.0;
  const logEntry = {
    broker: exchange,
    environment,
    user_id: userId,
    target_table: targetTable,
    trades_checked: 0,
    trades_matched: 0,
    trades_updated: 0,
    trades_missing: 0,
    divergences_detected: 0,
    total_pnl_delta: 0,
    details: {},
    error_message: null,
    duration_ms: 0,
  };

  try {
    const api = await ExchangeFactory.createExchangeForUser(userId, exchange, environment)
      .catch(() => null);

    if (!api) {
      logEntry.error_message = `No credentials for ${exchange}/${environment}`;
      return logEntry;
    }

    const brokerTrades = await fetchClosedTrades(exchange, api);
    logEntry.trades_checked = brokerTrades.length;

    if (brokerTrades.length === 0) {
      logEntry.duration_ms = Date.now() - startTime;
      return logEntry;
    }

    const { data: internalTrades, error: dbError } = await supabase
      .from(targetTable)
      .select('id, symbol, exchange, exchange_order_id, entry_time, exit_time, status, pnl_usd, realized_pnl_usd, quantity, direction, user_id')
      .eq('exchange', exchange)
      .eq('user_id', userId)
      .in('status', ['active', 'exited', 'closed'])
      .order('entry_time', { ascending: false })
      .limit(500);

    if (dbError) {
      logEntry.error_message = `DB query failed: ${dbError.message}`;
      return logEntry;
    }

    const internalBySymbol = new Map();
    for (const t of internalTrades || []) {
      const key = normalizeSymbol(t.symbol);
      if (!internalBySymbol.has(key)) internalBySymbol.set(key, []);
      internalBySymbol.get(key).push(t);
    }

    const matchedIds = new Set();
    const divergences = [];

    for (const brokerTrade of brokerTrades) {
      const brokerSymbol = normalizeSymbol(brokerTrade.symbol);
      const candidates = internalBySymbol.get(brokerSymbol) || [];

      let bestMatch = null;
      let bestScore = -1;

      for (const candidate of candidates) {
        if (matchedIds.has(candidate.id)) continue;

        let score = 0;

        if (brokerTrade.orderId && candidate.exchange_order_id &&
            String(brokerTrade.orderId) === String(candidate.exchange_order_id)) {
          score += 100;
        }

        const timeField = candidate.exit_time || candidate.entry_time;
        const brokerTime = brokerTrade.close_date || brokerTrade.open_date;
        if (withinTimeWindow(timeField, brokerTime, 48 * 60)) {
          score += 20;
        } else {
          score -= 10;
        }

        const bQty = Math.abs(brokerTrade.quantity || 0);
        const iQty = Math.abs(parseFloat(candidate.quantity || 0));
        if (bQty > 0 && iQty > 0) {
          const qtyRatio = Math.min(bQty, iQty) / Math.max(bQty, iQty);
          if (qtyRatio > 0.8) score += 10;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      if (bestMatch && bestScore >= 10) {
        logEntry.trades_matched++;
        matchedIds.add(bestMatch.id);

        const brokerPnl = parseFloat(brokerTrade.gain_loss || 0);
        const internalPnl = parseFloat(bestMatch.realized_pnl_usd || bestMatch.pnl_usd || 0);
        const pnlDelta = brokerPnl - internalPnl;
        const denominator = Math.abs(internalPnl) > 0.01 ? Math.abs(internalPnl) : 1;
        const divergencePct = Math.abs(pnlDelta / denominator) * 100;

        if (divergencePct > DIVERGENCE_THRESHOLD_PCT && Math.abs(pnlDelta) > 0.50) {
          logEntry.divergences_detected++;
          divergences.push({
            paper_trade_id: bestMatch.id,
            symbol: bestMatch.symbol,
            internal_pnl: internalPnl,
            broker_pnl: brokerPnl,
            delta: Math.round(pnlDelta * 100) / 100,
            divergence_pct: Math.round(divergencePct * 100) / 100,
          });

          logger.warn(
            `${LOG_PREFIX} DIVERGENCE: ${bestMatch.symbol} (${bestMatch.id}) ` +
            `internal=$${internalPnl.toFixed(2)} broker=$${brokerPnl.toFixed(2)} ` +
            `delta=$${pnlDelta.toFixed(2)} (${divergencePct.toFixed(1)}%)`
          );
        }

        logEntry.total_pnl_delta += pnlDelta;
      } else {
        logEntry.trades_missing++;
      }
    }

    if (divergences.length > 0) {
      logEntry.details = { divergences };
    }

    logEntry.total_pnl_delta = Math.round(logEntry.total_pnl_delta * 100) / 100;
  } catch (err) {
    logEntry.error_message = err.message;
    logger.error(`${LOG_PREFIX} Error reconciling ${exchange}/${environment} for user ${userId}: ${err.message}`);
  }

  logEntry.duration_ms = Date.now() - startTime;
  return logEntry;
}

// ─── main reconciliation loop ───────────────────────────────────────────────

async function runReconciliation() {
  try {
    // Get all unique user+exchange pairs from bot_credentials
    const { data: credentials, error } = await supabase
      .from('bot_credentials')
      .select('user_id, exchange, environment')
      .in('exchange', SUPPORTED_EXCHANGES)
      .not('user_id', 'is', null);

    if (error) {
      logger.warn(`${LOG_PREFIX} Failed to query bot_credentials: ${error.message}`);
      return;
    }

    if (!credentials || credentials.length === 0) return;

    // Build unique user+exchange+environment pairs
    const pairs = new Map();
    for (const cred of credentials) {
      const key = `${cred.user_id}:${cred.exchange}:${cred.environment}`;
      if (!pairs.has(key)) {
        pairs.set(key, {
          userId: cred.user_id,
          exchange: cred.exchange,
          environment: cred.environment,
        });
      }
    }

    logger.info(`${LOG_PREFIX} Starting reconciliation for ${pairs.size} user-exchange pair(s)`);

    let totalUpdated = 0;
    const logEntries = [];

    for (const [, pair] of pairs) {
      // Determine target table based on environment
      const targetTable = pair.environment === 'production' ? 'production_trades' : 'paper_trades';

      const result = await reconcileUserExchange(
        pair.userId,
        pair.exchange,
        pair.environment,
        targetTable,
      );

      totalUpdated += result.divergences_detected || 0;
      logEntries.push(result);

      if (result.trades_matched > 0 || result.divergences_detected > 0) {
        logger.info(
          `${LOG_PREFIX} ${pair.exchange}/${pair.environment}: ` +
          `checked=${result.trades_checked} matched=${result.trades_matched} ` +
          `divergences=${result.divergences_detected || 0} missing=${result.trades_missing} ` +
          `pnl_delta=$${result.total_pnl_delta}`
        );
      }
    }

    // Log reconciliation results
    if (logEntries.length > 0) {
      const logsToInsert = logEntries.map(e => ({
        broker: e.broker,
        environment: e.environment,
        user_id: e.user_id,
        target_table: e.target_table,
        trades_checked: e.trades_checked,
        trades_matched: e.trades_matched,
        trades_updated: e.trades_updated,
        trades_missing: e.trades_missing,
        total_pnl_delta: e.total_pnl_delta,
        details: e.details,
        error_message: e.error_message,
        duration_ms: e.duration_ms,
      }));

      await supabase.from('reconciliation_log').insert(logsToInsert).catch(err => {
        logger.warn(`${LOG_PREFIX} Failed to log reconciliation results: ${err.message}`);
      });
    }

    if (totalUpdated > 0) {
      logger.info(`${LOG_PREFIX} Audit complete: ${totalUpdated} divergence(s) detected across all exchanges`);
    } else {
      logger.debug(`${LOG_PREFIX} Audit complete: no divergences found`);
    }
  } catch (err) {
    logger.error(`${LOG_PREFIX} Unexpected error in runReconciliation: ${err.message}`);
  }
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

function startBrokerReconciliation(intervalMs = RECONCILE_INTERVAL_MS) {
  if (_timer) return;

  logger.info(`${LOG_PREFIX} Started — reconciling every ${intervalMs / 1000}s`);

  // Run immediately, then on interval
  runReconciliation().catch(err =>
    logger.warn(`${LOG_PREFIX} Initial run failed: ${err.message}`)
  );
  _timer = setInterval(runReconciliation, intervalMs);

  if (_timer.unref) _timer.unref();
}

function stopBrokerReconciliation() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info(`${LOG_PREFIX} Stopped`);
  }
}

module.exports = { startBrokerReconciliation, stopBrokerReconciliation, runReconciliation };
