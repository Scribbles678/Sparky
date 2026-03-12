/**
 * Trade Lifecycle Manager
 *
 * Single authoritative module for closing trades and recording exits.
 * Handles both paper_trades and production_trades (via the `trades` table).
 *
 * Responsibilities:
 *   1. Verify exit price (fetch from exchange if raw value is 0/null/NaN)
 *   2. Compute P&L correctly (using actual position_size_usd, not config defaults)
 *   3. Look up paper_trade by ID (no fuzzy symbol-only fallback)
 *   4. Write exit data exactly once to paper_trades + trades
 *   5. Validate sanity before write (exit_price > 0, |pnl_pct| < 500 guard)
 */

const logger = require('./utils/logger');
const { supabase, logTrade } = require('./supabaseClient');

const PNL_PCT_SANITY_LIMIT = 500;

class TradeLifecycleManager {
  /**
   * @param {Object} exchangeApi - Exchange API instance (TradierAPI, AsterAPI, etc.)
   * @param {Object} config - Bot configuration (used only as last-resort fallback)
   * @param {string} exchangeName - Exchange name (e.g., 'tradier', 'aster')
   */
  constructor(exchangeApi, config, exchangeName) {
    this.api = exchangeApi;
    this.config = config;
    this.exchangeName = exchangeName;
  }

  /**
   * Close a trade: verify price, compute P&L, persist to DB.
   *
   * For netting-managed trades (source starts with 'netting_'), DB writes
   * are skipped because the NettingEngine owns P&L in the position_lots table.
   *
   * @returns {{ pnlUsd: number, pnlPercent: number, exitPrice: number, tradeId: string|null }}
   */
  async closeTrade({
    symbol,
    side,
    entryPrice,
    exitPrice: rawExitPrice,
    quantity,
    positionSizeUsd,
    userId,
    paperTradeId,
    orderId,
    exitReason = 'MANUAL',
    assetClass,
    exchange,
    strategyId,
    entryTime,
    source,
  }) {
    const isNettingManaged = (source || '').startsWith('netting_');

    const exitPrice = await this.getVerifiedExitPrice(symbol, rawExitPrice);

    const actualPositionSize = await this._resolvePositionSizeUsd(
      positionSizeUsd, paperTradeId
    );

    const { pnlUsd, pnlPct } = this.computePnL(
      side, entryPrice, exitPrice, quantity, actualPositionSize
    );

    if (Math.abs(pnlPct) > PNL_PCT_SANITY_LIMIT) {
      logger.warn(
        `[LIFECYCLE] P&L sanity warning: ${symbol} pnl_pct=${pnlPct.toFixed(2)}% ` +
        `(entry=${entryPrice}, exit=${exitPrice}, qty=${quantity}, size=$${actualPositionSize})`
      );
    }

    if (isNettingManaged) {
      logger.info(
        `[LIFECYCLE] Netting-managed trade ${symbol}: skipping DB writes ` +
        `(P&L: $${pnlUsd.toFixed(2)}, ${pnlPct.toFixed(2)}%)`
      );
      return { pnlUsd, pnlPercent: pnlPct, exitPrice, tradeId: null };
    }

    let tradeId = null;

    const tradeResult = await logTrade({
      userId,
      symbol,
      side,
      entryPrice,
      entryTime: entryTime || new Date().toISOString(),
      exitPrice,
      exitTime: new Date().toISOString(),
      quantity,
      positionSizeUsd: actualPositionSize,
      pnlUsd,
      pnlPercent: pnlPct,
      orderId,
      exitReason,
      assetClass: assetClass || this._getAssetClass(),
      exchange: exchange || this.exchangeName,
      strategyId,
    });

    if (tradeResult?.data?.[0]?.id) {
      tradeId = tradeResult.data[0].id;
    }

    if (paperTradeId) {
      await this._updatePaperTradeById(paperTradeId, userId, {
        exitPrice,
        exitTime: new Date().toISOString(),
        exitReason,
        pnlUsd,
        pnlPct,
        entryTime,
      });
    } else {
      logger.warn(
        `[LIFECYCLE] No paperTradeId for ${symbol} — cannot update paper_trades. ` +
        `Trade logged to trades table only (id=${tradeId}).`
      );
    }

    logger.info(
      `[LIFECYCLE] ${symbol} closed: exit=$${exitPrice.toFixed(4)}, ` +
      `P&L=$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%), reason=${exitReason}`
    );

    return { pnlUsd, pnlPercent: pnlPct, exitPrice, tradeId };
  }

  /**
   * Verify the exit price. If the raw value is invalid (0, null, NaN),
   * fetch a live quote from the exchange.
   */
  async getVerifiedExitPrice(symbol, rawExitPrice) {
    const price = parseFloat(rawExitPrice);
    if (price && price > 0 && isFinite(price)) {
      return price;
    }

    logger.warn(
      `[LIFECYCLE] Invalid exit price (${rawExitPrice}) for ${symbol}, fetching live quote`
    );

    try {
      const ticker = await this.api.getTicker(symbol);
      const livePrice = parseFloat(ticker.lastPrice || ticker.price);
      if (livePrice && livePrice > 0 && isFinite(livePrice)) {
        logger.info(`[LIFECYCLE] Using live price for ${symbol}: $${livePrice}`);
        return livePrice;
      }
    } catch (err) {
      logger.logError(`[LIFECYCLE] Failed to fetch live price for ${symbol}`, err);
    }

    throw new Error(
      `[LIFECYCLE] Cannot determine exit price for ${symbol}. ` +
      `Raw=${rawExitPrice}, live quote also failed. Aborting trade close.`
    );
  }

  /**
   * Compute P&L from first principles.
   * @returns {{ pnlUsd: number, pnlPct: number }}
   */
  computePnL(side, entryPrice, exitPrice, quantity, positionSizeUsd) {
    let pnlUsd;
    const normalizedSide = (side || '').toUpperCase();

    if (normalizedSide === 'BUY' || normalizedSide === 'LONG') {
      pnlUsd = (exitPrice - entryPrice) * quantity;
    } else {
      pnlUsd = (entryPrice - exitPrice) * quantity;
    }

    const safeDenominator = positionSizeUsd > 0 ? positionSizeUsd : (entryPrice * quantity);
    const pnlPct = (pnlUsd / safeDenominator) * 100;

    return {
      pnlUsd: parseFloat(pnlUsd.toFixed(4)),
      pnlPct: parseFloat(pnlPct.toFixed(4)),
    };
  }

  /**
   * Resolve the actual position_size_usd. Priority:
   *   1. Caller-provided value (if > 0)
   *   2. Fetched from paper_trades row (by paperTradeId)
   *   3. Computed from entryPrice * quantity (last resort)
   */
  async _resolvePositionSizeUsd(callerValue, paperTradeId) {
    if (callerValue && callerValue > 0) {
      return callerValue;
    }

    if (paperTradeId && supabase) {
      try {
        const { data, error } = await supabase
          .from('paper_trades')
          .select('position_size_usd')
          .eq('id', paperTradeId)
          .single();

        if (!error && data && parseFloat(data.position_size_usd) > 0) {
          const dbSize = parseFloat(data.position_size_usd);
          logger.info(`[LIFECYCLE] Resolved position_size_usd=$${dbSize} from paper_trade ${paperTradeId}`);
          return dbSize;
        }
      } catch (err) {
        logger.logError('[LIFECYCLE] Failed to fetch position_size_usd from paper_trades', err);
      }
    }

    logger.warn('[LIFECYCLE] No position_size_usd available — will use entryPrice * quantity');
    return 0;
  }

  /**
   * Update paper_trades by ID. No symbol-only fallback — if the ID doesn't
   * match, we log an error instead of guessing.
   */
  async _updatePaperTradeById(paperTradeId, userId, { exitPrice, exitTime, exitReason, pnlUsd, pnlPct, entryTime }) {
    if (!supabase) return;

    try {
      const exitPayload = {
        status: 'exited',
        exit_price: exitPrice,
        exit_time: exitTime || new Date().toISOString(),
        exit_reason: exitReason || 'MANUAL',
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        realized_pnl_usd: pnlUsd,
        realized_pnl_pct: pnlPct,
        hold_time_minutes: entryTime
          ? Math.round((new Date(exitTime || Date.now()) - new Date(entryTime)) / 60000)
          : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('paper_trades')
        .update(exitPayload)
        .eq('id', paperTradeId)
        .eq('user_id', userId);

      if (error) {
        logger.logError(`[LIFECYCLE] Failed to update paper_trade ${paperTradeId}`, error);
      } else {
        logger.info(`[LIFECYCLE] paper_trade exited: ${paperTradeId}`);
      }
    } catch (err) {
      logger.logError(`[LIFECYCLE] Exception updating paper_trade ${paperTradeId}`, err);
    }
  }

  _getAssetClass() {
    const map = {
      'aster': 'crypto',
      'apex': 'crypto',
      'oanda': 'forex',
      'tradier': 'stocks',
      'tradier_options': 'options',
      'alpaca': 'stocks',
    };
    return map[this.exchangeName] || 'crypto';
  }
}

module.exports = TradeLifecycleManager;
