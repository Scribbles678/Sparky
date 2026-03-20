/**
 * Protection Orders — Exchange-native SL/TP lifecycle management.
 *
 * Endpoints:
 *   POST /orders/protection — Place, amend, or cancel SL/TP orders
 *   GET  /orders/protection/:exchange/:symbol — List active protection orders
 *
 * These endpoints are called by Arthur's ExitManager to ensure every position
 * has crash-safe exchange-native stop-loss protection.
 *
 * Uses existing exchange API methods: placeStopLoss(), placeTakeProfit(),
 * placeTrailingStop(), cancelOrder(), getOpenOrders()
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const ExchangeFactory = require('../exchanges/ExchangeFactory');
const { notifyProtectionOrderPlaced } = require('../utils/notifications');

function _getAssetClassForExchange(exchangeName) {
  const m = { oanda: 'forex', tradier: 'stocks', alpaca: 'stocks', aster: 'crypto', apex: 'crypto' };
  return m[(exchangeName || '').toLowerCase()] || undefined;
}

/**
 * POST /orders/protection
 *
 * Place, amend, or cancel protection orders (SL/TP) on any exchange.
 *
 * Body:
 * {
 *   action: 'place' | 'cancel',
 *   exchange: 'aster' | 'oanda' | 'tradier' | 'apex',
 *   credential_id: string,        // Used to look up the right API credentials
 *   user_id: string,
 *   secret: string,               // Webhook secret for auth
 *   symbol: string,               // Exchange-native symbol (e.g., BTCUSDT)
 *   environment: 'testnet' | 'production',
 *   orders: [                     // For 'place' action
 *     { type: 'stop_loss', price: number, quantity: number, side: 'BUY'|'SELL' },
 *     { type: 'take_profit', price: number, quantity: number, side: 'BUY'|'SELL' },
 *     { type: 'trailing_stop', callback_rate: number, quantity: number, side: 'BUY'|'SELL' }
 *   ],
 *   existing_order_ids: {         // For 'cancel' action
 *     sl: string,
 *     tp: string
 *   }
 * }
 */
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      action,
      exchange: exchangeName,
      credential_id: credentialId,
      user_id: userId,
      symbol,
      environment = 'testnet',
      orders = [],
      existing_order_ids: existingOrderIds = {},
    } = req.body;

    if (!action || !exchangeName || !userId || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: action, exchange, user_id, symbol',
      });
    }

    // Create exchange API instance for this user's credential
    let api;
    try {
      api = await ExchangeFactory.createExchangeForUser(
        userId,
        exchangeName.toLowerCase(),
        environment,
        credentialId
      );
    } catch (err) {
      logger.error(`[PROTECTION] Failed to create ${exchangeName} API for user ${userId}: ${err.message}`);
      return res.status(503).json({
        success: false,
        error: `Failed to create ${exchangeName} API: ${err.message}`,
      });
    }

    if (!api) {
      return res.status(503).json({
        success: false,
        error: `${exchangeName} ${environment} API not available for user`,
      });
    }

    // ── CANCEL ACTION ──
    if (action === 'cancel') {
      const results = {};

      if (existingOrderIds.sl) {
        try {
          await api.cancelOrder(symbol, existingOrderIds.sl);
          results.sl_cancelled = true;
          logger.info(`[PROTECTION] Cancelled SL order ${existingOrderIds.sl} on ${exchangeName} ${symbol}`);
        } catch (err) {
          results.sl_cancelled = false;
          results.sl_error = err.message;
          logger.warn(`[PROTECTION] Failed to cancel SL ${existingOrderIds.sl}: ${err.message}`);
        }
      }

      if (existingOrderIds.tp) {
        try {
          await api.cancelOrder(symbol, existingOrderIds.tp);
          results.tp_cancelled = true;
          logger.info(`[PROTECTION] Cancelled TP order ${existingOrderIds.tp} on ${exchangeName} ${symbol}`);
        } catch (err) {
          results.tp_cancelled = false;
          results.tp_error = err.message;
          logger.warn(`[PROTECTION] Failed to cancel TP ${existingOrderIds.tp}: ${err.message}`);
        }
      }

      return res.json({
        success: true,
        action: 'cancel',
        ...results,
        duration_ms: Date.now() - startTime,
      });
    }

    // ── PLACE ACTION ──
    if (action === 'place') {
      if (!orders || orders.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No orders to place',
        });
      }

      const result = {
        success: true,
        sl_order_id: null,
        tp_order_id: null,
        tp_orders: {},  // Per-lot TP: { lot_id: order_id }
        errors: [],
      };

      for (const order of orders) {
        try {
          let qty = order.quantity;
          if (exchangeName.toLowerCase() === 'tradier') {
            qty = Math.max(1, Math.floor(Math.abs(qty)));
          }
          if (order.type === 'stop_loss') {
            const slResult = await api.placeStopLoss(
              symbol,
              order.side,
              qty,
              order.price
            );
            result.sl_order_id = _extractOrderId(slResult);
            if (!result.sl_order_id) {
              logger.error(
                `[PROTECTION] SL placed but no order ID extracted on ${exchangeName} ${symbol}: ` +
                `price=${order.price} qty=${qty} side=${order.side} ` +
                `raw_result=${JSON.stringify(slResult)}`
              );
            } else {
              logger.info(
                `[PROTECTION] Placed SL on ${exchangeName} ${symbol}: ` +
                `price=${order.price} qty=${qty} side=${order.side} ` +
                `orderId=${result.sl_order_id}`
              );
              if (userId) {
                notifyProtectionOrderPlaced(userId, symbol, exchangeName, 'stop_loss', {
                  orderId: result.sl_order_id,
                  price: order.price,
                  quantity: qty,
                  side: order.side,
                  assetClass: _getAssetClassForExchange(exchangeName),
                }).catch(() => {});
              }
            }
          } else if (order.type === 'take_profit') {
            const tpResult = await api.placeTakeProfit(
              symbol,
              order.side,
              qty,
              order.price
            );
            const tpOrderId = _extractOrderId(tpResult);
            if (!tpOrderId) {
              logger.error(
                `[PROTECTION] TP placed but no order ID extracted on ${exchangeName} ${symbol}: ` +
                `price=${order.price} qty=${qty} side=${order.side} ` +
                `lot_id=${order.lot_id || 'none'} raw_result=${JSON.stringify(tpResult)}`
              );
            } else {
              logger.info(
                `[PROTECTION] Placed TP on ${exchangeName} ${symbol}: ` +
                `price=${order.price} qty=${qty} side=${order.side} ` +
                `lot_id=${order.lot_id || 'none'} orderId=${tpOrderId}`
              );
              if (userId) {
                notifyProtectionOrderPlaced(userId, symbol, exchangeName, 'take_profit', {
                  orderId: tpOrderId,
                  price: order.price,
                  quantity: qty,
                  side: order.side,
                  assetClass: _getAssetClassForExchange(exchangeName),
                }).catch(() => {});
              }
            }
            // Per-lot TP: store in tp_orders map keyed by lot_id
            if (order.lot_id) {
              result.tp_orders[order.lot_id] = tpOrderId;
            } else {
              // Single TP (backward compat for single-lot positions)
              result.tp_order_id = tpOrderId;
            }
          } else if (order.type === 'trailing_stop') {
            if (typeof api.placeTrailingStop === 'function') {
              const tsResult = await api.placeTrailingStop(
                symbol,
                order.side,
                qty,
                order.callback_rate
              );
              // Trailing stop counts as the SL order
              result.sl_order_id = _extractOrderId(tsResult);
              logger.info(
                `[PROTECTION] Placed Trailing Stop on ${exchangeName} ${symbol}: ` +
                `rate=${order.callback_rate}% qty=${qty} ` +
                `orderId=${result.sl_order_id}`
              );
              if (userId && result.sl_order_id) {
                notifyProtectionOrderPlaced(userId, symbol, exchangeName, 'trailing_stop', {
                  orderId: result.sl_order_id,
                  quantity: qty,
                  side: order.side,
                  assetClass: _getAssetClassForExchange(exchangeName),
                }).catch(() => {});
              }
            } else {
              result.errors.push(
                `${exchangeName} does not support placeTrailingStop`
              );
              logger.warn(
                `[PROTECTION] ${exchangeName} missing placeTrailingStop, skipping`
              );
            }
          } else {
            result.errors.push(`Unknown order type: ${order.type}`);
          }
        } catch (err) {
          result.errors.push(`${order.type}: ${err.message}`);
          logger.error(
            `[PROTECTION] Failed to place ${order.type} on ${exchangeName} ${symbol}: ${err.message}`
          );
        }
      }

      // If no SL was placed, mark as failure
      if (!result.sl_order_id && orders.some(o => o.type === 'stop_loss' || o.type === 'trailing_stop')) {
        result.success = false;
      }

      result.duration_ms = Date.now() - startTime;
      return res.json(result);
    }

    return res.status(400).json({
      success: false,
      error: `Unknown action: ${action}. Use 'place' or 'cancel'.`,
    });
  } catch (error) {
    logger.logError('[PROTECTION] Unhandled error in protection orders endpoint', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /orders/protection/:exchange/:symbol
 *
 * List active protection orders (open SL/TP) for verification.
 * Query params: credential_id, user_id, environment
 */
router.get('/:exchange/:symbol', async (req, res) => {
  try {
    const exchangeName = req.params.exchange.toLowerCase();
    const symbol = req.params.symbol;
    const userId = req.query.user_id;
    const credentialId = req.query.credential_id;
    const environment = req.query.environment || 'testnet';

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id query parameter is required',
      });
    }

    let api;
    try {
      api = await ExchangeFactory.createExchangeForUser(
        userId,
        exchangeName,
        environment,
        credentialId
      );
    } catch (err) {
      return res.status(503).json({
        success: false,
        error: `Failed to create ${exchangeName} API: ${err.message}`,
      });
    }

    if (!api) {
      return res.status(503).json({
        success: false,
        error: `${exchangeName} ${environment} API not available`,
      });
    }

    let openOrders = [];
    if (typeof api.getOpenOrders === 'function') {
      const rawOrders = await api.getOpenOrders(symbol);
      openOrders = Array.isArray(rawOrders) ? rawOrders : [];
    } else if (typeof api.getOrders === 'function') {
      const rawOrders = await api.getOrders(symbol);
      openOrders = Array.isArray(rawOrders) ? rawOrders : [];
    }

    // Filter to only open SL/TP/trailing type orders (exclude rejected/filled/cancelled)
    const openStatuses = ['open', 'pending', 'partially_filled', 'new', 'partially_filled'];
    const protectionOrders = openOrders.filter(o => {
      const type = String(o.type || o.orderType || '').toUpperCase();
      const status = String(o.status || o.state || '').toLowerCase();
      const typeOk = (
        type.includes('STOP') ||
        type.includes('TAKE_PROFIT') ||
        type.includes('TRAILING') ||
        type.includes('LIMIT')  // TP is often a limit order
      );
      const statusOk = !status || openStatuses.includes(status);
      return typeOk && statusOk;
    }).map(o => ({
      id: o.orderId || o.order_id || o.id || o.clientOrderId,
      type: o.type || o.orderType,
      side: o.side,
      price: o.stopPrice || o.price || o.triggerPrice,
      quantity: o.origQty || o.quantity || o.units || o.amount,
      status: o.status || o.state,
      symbol: o.symbol || o.instrument,
    }));

    res.json({
      success: true,
      exchange: exchangeName,
      symbol,
      count: protectionOrders.length,
      orders: protectionOrders,
    });
  } catch (error) {
    logger.logError('[PROTECTION] Failed to get protection orders', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Extract order ID from various exchange response formats.
 */
function _extractOrderId(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return (
    result.orderId ||
    result.order_id ||
    result.id ||
    result.clientOrderId ||
    (result.orderReport && result.orderReport.orderId) ||
    null
  );
}

module.exports = router;
