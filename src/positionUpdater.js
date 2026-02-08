/**
 * Position Price Updater Service
 * 
 * Supports two modes:
 * 1. WebSocket-first (V3): Real-time price updates via Aster WebSocket streams
 *    - Subscribes to miniTicker for instant price changes
 *    - Subscribes to ACCOUNT_UPDATE for instant position/balance changes
 *    - REST reconciliation every 5 minutes as safety net
 * 
 * 2. REST polling (V1/V2 legacy): Polls REST API every 30 seconds
 *    - Original behavior, backward compatible
 * 
 * The mode is automatically detected based on whether an AsterWebSocket
 * instance is provided.
 */

const logger = require('./utils/logger');
const { updatePositionPnL, logTrade, removePosition, savePosition } = require('./supabaseClient');
const { calculatePositionSize } = require('./utils/calculations');

class PositionUpdater {
  constructor(asterApi, positionTracker, config) {
    this.api = asterApi;
    this.tracker = positionTracker;
    this.config = config;
    this.updateInterval = null;
    this.intervalMs = 30000; // REST polling: Update every 30 seconds
    this.syncIntervalCount = 10; // Sync with exchange every 10 intervals (5 minutes)
    this.currentIntervalCount = 0;

    // WebSocket mode
    this.wsClient = null;           // AsterWebSocket instance (if V3)
    this.wsMode = false;            // true = WebSocket-first, false = REST polling
    this.latestPrices = new Map();  // symbol → { price, timestamp } from WebSocket
    this.wsReconcileMs = 300000;    // REST reconciliation interval in WS mode (5 min)
    this.wsReconcileTimer = null;
  }

  /**
   * Attach an AsterWebSocket instance for real-time updates
   * Call this BEFORE start() to enable WebSocket mode
   * @param {object} wsClient - AsterWebSocket instance
   */
  setWebSocket(wsClient) {
    this.wsClient = wsClient;
    this.wsMode = true;
    logger.info('📡 Position updater: WebSocket mode enabled');
  }

  /**
   * Start the position updater service
   */
  start() {
    if (this.updateInterval || this.wsReconcileTimer) {
      logger.warn('Position updater already running');
      return;
    }

    if (this.wsMode && this.wsClient) {
      this._startWebSocketMode();
    } else {
      this._startRestMode();
    }
  }

  /**
   * Start in WebSocket mode — subscribe to streams, REST reconcile periodically
   * @private
   */
  _startWebSocketMode() {
    logger.info('🚀 Starting position updater in WebSocket mode (real-time)');

    // Subscribe to ticker events for price updates
    this.wsClient.on('ticker', (data) => {
      this._handleWsTicker(data);
    });

    // Subscribe to user account updates for instant position changes
    this.wsClient.on('accountUpdate', (data) => {
      this._handleWsAccountUpdate(data);
    });

    // Subscribe to order fills for immediate trade detection
    this.wsClient.on('orderFilled', (data) => {
      this._handleWsOrderFilled(data);
    });

    // Subscribe to margin calls
    this.wsClient.on('marginCall', (data) => {
      logger.warn(`⚠️ MARGIN CALL: ${data.positions?.length || 0} position(s) at risk`);
      for (const pos of data.positions || []) {
        logger.warn(`   ${pos.symbol}: unrealized PnL $${pos.unrealizedPnl}, maintenance margin $${pos.maintenanceMarginRequired}`);
      }
    });

    // Subscribe currently tracked symbols to ticker stream
    this._subscribeTrackedSymbols();

    // Start REST reconciliation timer (safety net every 5 minutes)
    this.wsReconcileTimer = setInterval(async () => {
      logger.debug('🔄 WebSocket mode: REST reconciliation check');
      await this.syncWithExchange();
      await this._reconcilePrices();
    }, this.wsReconcileMs);

    // Do an initial sync
    this.updateAllPositions();
  }

  /**
   * Start in REST polling mode (legacy behavior)
   * @private
   */
  _startRestMode() {
    logger.info('Starting position price updater service (REST polling mode, 30s interval)');
    
    // Run immediately
    this.updateAllPositions();
    
    // Then run every intervalMs
    this.updateInterval = setInterval(() => {
      this.updateAllPositions();
    }, this.intervalMs);
  }

  /**
   * Subscribe tracked position symbols to WebSocket ticker stream
   * @private
   */
  _subscribeTrackedSymbols() {
    if (!this.wsClient) return;

    const positions = this.tracker.getAllPositions();
    if (positions.length > 0) {
      const symbols = [...new Set(positions.map(p => p.symbol))];
      this.wsClient.subscribeTickers(symbols).catch(err => {
        logger.logError('Failed to subscribe tracked symbols to ticker', err);
      });
      logger.info(`📡 Subscribed ${symbols.length} tracked symbol(s) to WebSocket ticker`);
    }
  }

  /**
   * Handle WebSocket ticker update — instant price update
   * @private
   */
  _handleWsTicker(data) {
    const { symbol, close: currentPrice } = data;
    if (!symbol || !currentPrice) return;

    // Update in-memory price cache
    this.latestPrices.set(symbol, { price: currentPrice, timestamp: Date.now() });

    // Find matching tracked position
    const positions = this.tracker.getAllPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (position) {
      // Calculate and update P&L with live price
      const { unrealizedPnlUsd, unrealizedPnlPercent } = this.calculateUnrealizedPnL(
        position,
        currentPrice
      );

      // Update Supabase (debounced — only update if meaningful change)
      const lastUpdate = this._lastPnlUpdate?.get(symbol);
      const now = Date.now();
      if (!lastUpdate || (now - lastUpdate) > 5000) { // Max 1 update per 5 seconds per symbol
        if (!this._lastPnlUpdate) this._lastPnlUpdate = new Map();
        this._lastPnlUpdate.set(symbol, now);

        updatePositionPnL(symbol, currentPrice, unrealizedPnlUsd, unrealizedPnlPercent)
          .catch(err => logger.logError(`WS price update failed for ${symbol}`, err));
      }
    }
  }

  /**
   * Handle WebSocket account update — instant balance/position changes
   * @private
   */
  _handleWsAccountUpdate(data) {
    const { reason, positions, balances } = data;
    logger.info(`📋 Account update (reason: ${reason}): ${positions?.length || 0} position(s), ${balances?.length || 0} balance(s)`);

    // Process position updates
    for (const pos of positions || []) {
      const positionAmt = pos.positionAmount;

      if (positionAmt === 0) {
        // Position closed — handle it
        const trackedPos = this.tracker.getAllPositions().find(p => p.symbol === pos.symbol);
        if (trackedPos) {
          logger.info(`📡 WS detected position closed: ${pos.symbol} (reason: ${reason})`);
          this.handleClosedPosition(trackedPos).catch(err => {
            logger.logError(`Error handling WS-detected closure for ${pos.symbol}`, err);
          });
        }
      } else {
        // Position opened/modified — check if we're already tracking it
        const trackedPos = this.tracker.getAllPositions().find(p => p.symbol === pos.symbol);
        if (!trackedPos) {
          // New position detected via WS
          logger.info(`📡 WS detected new position: ${pos.symbol} (${positionAmt > 0 ? 'LONG' : 'SHORT'} ${Math.abs(positionAmt)} @ $${pos.entryPrice})`);
          // Subscribe to its ticker
          if (this.wsClient) {
            this.wsClient.subscribeTickers([pos.symbol]).catch(() => {});
          }
        }
      }
    }

    // Log balance changes
    for (const bal of balances || []) {
      if (parseFloat(bal.balanceChange) !== 0) {
        logger.info(`💰 Balance change: ${bal.asset} ${bal.balanceChange > 0 ? '+' : ''}${bal.balanceChange} (wallet: ${bal.walletBalance})`);
      }
    }
  }

  /**
   * Handle WebSocket order filled event
   * @private
   */
  _handleWsOrderFilled(data) {
    logger.info(`✅ Order filled via WS: ${data.symbol} ${data.side} ${data.cumulativeFilledQty} @ $${data.averagePrice} (realized PnL: $${data.realizedProfit})`);
    
    // Subscribe to the symbol's ticker if not already
    if (this.wsClient && !this.latestPrices.has(data.symbol)) {
      this.wsClient.subscribeTickers([data.symbol]).catch(() => {});
    }
  }

  /**
   * REST reconciliation for WebSocket mode — sync prices from REST as safety net
   * @private
   */
  async _reconcilePrices() {
    const positions = this.tracker.getAllPositions();
    if (positions.length === 0) return;

    let reconciled = 0;
    for (const position of positions) {
      try {
        const wsCached = this.latestPrices.get(position.symbol);
        // If WS price is stale (>60s), fall back to REST
        if (!wsCached || (Date.now() - wsCached.timestamp) > 60000) {
          await this.updatePosition(position);
          reconciled++;
        }
      } catch (error) {
        logger.logError(`REST reconcile failed for ${position.symbol}`, error);
      }
    }
    if (reconciled > 0) {
      logger.info(`🔄 REST reconciled ${reconciled}/${positions.length} position(s) with stale WS data`);
    }
  }

  /**
   * Stop the position updater service
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.wsReconcileTimer) {
      clearInterval(this.wsReconcileTimer);
      this.wsReconcileTimer = null;
    }
    // Remove WebSocket listeners
    if (this.wsClient) {
      this.wsClient.removeAllListeners('ticker');
      this.wsClient.removeAllListeners('accountUpdate');
      this.wsClient.removeAllListeners('orderFilled');
      this.wsClient.removeAllListeners('marginCall');
    }
    logger.info(`Position price updater stopped (mode: ${this.wsMode ? 'WebSocket' : 'REST'})`);
  }

  /**
   * Update all open positions with current prices
   */
  async updateAllPositions() {
    try {
      // Increment interval counter
      this.currentIntervalCount++;
      
      // Sync with exchange every N intervals (5 minutes)
      if (this.currentIntervalCount >= this.syncIntervalCount) {
        this.currentIntervalCount = 0;
        await this.syncWithExchange();
      }
      
      const positions = this.tracker.getAllPositions();
      
      if (positions.length === 0) {
        return;
      }

      logger.info(`Updating prices for ${positions.length} position(s)`);

      // Update each position
      for (const position of positions) {
        try {
          await this.updatePosition(position);
        } catch (error) {
          logger.logError(`Failed to update position ${position.symbol}`, error);
        }
      }
    } catch (error) {
      logger.logError('Error in updateAllPositions', error);
    }
  }

  /**
   * Update a single position's price and P&L
   */
  async updatePosition(position) {
    try {
      // Fetch current price
      const ticker = await this.api.getTicker(position.symbol);
      const currentPrice = parseFloat(ticker.lastPrice || ticker.price);

      // Calculate unrealized P&L
      const { unrealizedPnlUsd, unrealizedPnlPercent } = this.calculateUnrealizedPnL(
        position,
        currentPrice
      );

      // Update in Supabase
      await updatePositionPnL(
        position.symbol,
        currentPrice,
        unrealizedPnlUsd,
        unrealizedPnlPercent
      );

      logger.debug(`Updated ${position.symbol}: $${currentPrice}, P&L: $${unrealizedPnlUsd.toFixed(2)}`);
    } catch (error) {
      // Don't throw - just log and continue with other positions
      logger.logError(`Error updating position ${position.symbol}`, error);
    }
  }

  /**
   * Calculate unrealized P&L for a position
   */
  calculateUnrealizedPnL(position, currentPrice) {
    const entryPrice = position.entryPrice;
    const quantity = position.quantity;
    const positionSizeUsd = this.getExchangeTradeAmount();

    let unrealizedPnlUsd = 0;

    if (position.side === 'BUY') {
      // Long position: profit if price went up
      unrealizedPnlUsd = (currentPrice - entryPrice) * quantity;
    } else if (position.side === 'SELL') {
      // Short position: profit if price went down
      unrealizedPnlUsd = (entryPrice - currentPrice) * quantity;
    }

    // Calculate percentage based on position size
    const unrealizedPnlPercent = (unrealizedPnlUsd / positionSizeUsd) * 100;

    return {
      unrealizedPnlUsd: parseFloat(unrealizedPnlUsd.toFixed(4)),
      unrealizedPnlPercent: parseFloat(unrealizedPnlPercent.toFixed(4)),
    };
  }

  /**
   * Sync tracked positions with exchange to detect closed positions AND manually opened positions
   */
  async syncWithExchange() {
    try {
      const exchangeName = this.api.exchangeName || 'aster';
      logger.info(`Auto-syncing positions with ${exchangeName.toUpperCase()} exchange...`);
      
      // Get tracked positions for THIS exchange only
      const allTrackedPositions = this.tracker.getAllPositions();
      const trackedPositions = allTrackedPositions.filter(p => p.exchange === exchangeName);
      const trackedSymbols = trackedPositions.map(p => p.symbol);
      
      // Get actual positions from exchange
      const exchangePositions = await this.api.getPositions();
      const openPositions = exchangePositions.filter(p => parseFloat(p.positionAmt) !== 0);
      const openSymbols = openPositions.map(p => p.symbol);
      
      // 1. Find positions that are tracked but no longer open on exchange (manually closed)
      const closedPositions = trackedPositions.filter(
        tracked => !openSymbols.includes(tracked.symbol)
      );
      
      // 2. Find positions that are open on exchange but NOT tracked (manually opened)
      const manuallyOpenedPositions = openPositions.filter(
        exchangePos => !trackedSymbols.includes(exchangePos.symbol)
      );
      
      // Process manually closed positions
      if (closedPositions.length > 0) {
        logger.info(`Detected ${closedPositions.length} position(s) closed on ${exchangeName.toUpperCase()}`);
        for (const position of closedPositions) {
          await this.handleClosedPosition(position);
        }
      }
      
      // Process manually opened positions
      if (manuallyOpenedPositions.length > 0) {
        logger.info(`Detected ${manuallyOpenedPositions.length} manually opened position(s) on ${exchangeName.toUpperCase()}`);
        for (const exchangePos of manuallyOpenedPositions) {
          await this.handleManuallyOpenedPosition(exchangePos);
        }
      }
      
      if (closedPositions.length === 0 && manuallyOpenedPositions.length === 0) {
        logger.info(`All ${exchangeName.toUpperCase()} positions in sync with exchange`);
      }
    } catch (error) {
      logger.logError('Error in syncWithExchange', error);
    }
  }
  
  /**
   * Handle a position that was manually opened on the exchange
   */
  async handleManuallyOpenedPosition(exchangePosition) {
    try {
      const symbol = exchangePosition.symbol;
      const positionAmt = parseFloat(exchangePosition.positionAmt);
      const side = positionAmt > 0 ? 'BUY' : 'SELL';
      const quantity = Math.abs(positionAmt);
      const entryPrice = parseFloat(exchangePosition.entryPrice);
      const exchangeName = this.api.exchangeName || 'aster';
      
      logger.info(`Detected manually opened position: ${symbol} (${side} ${quantity} @ $${entryPrice})`);
      
      // Get current price for P&L calculation
      const ticker = await this.api.getTicker(symbol);
      const currentPrice = parseFloat(ticker.lastPrice || ticker.price);
      
      // Calculate position size (estimate based on entry price and quantity)
      const positionSizeUsd = entryPrice * quantity;
      
      // Calculate initial unrealized P&L
      let unrealizedPnlUsd = 0;
      if (side === 'BUY') {
        unrealizedPnlUsd = (currentPrice - entryPrice) * quantity;
      } else {
        unrealizedPnlUsd = (entryPrice - currentPrice) * quantity;
      }
      const unrealizedPnlPercent = (unrealizedPnlUsd / positionSizeUsd) * 100;
      
      // Determine asset class based on exchange
      let assetClass = 'crypto';
      if (exchangeName === 'oanda') {
        assetClass = 'forex';
      } else if (exchangeName === 'tradier') {
        assetClass = 'stock';
      }
      
      // Add to in-memory tracker
      const position = this.tracker.addPosition(symbol, {
        side,
        quantity,
        entryPrice,
        leverage: exchangePosition.leverage || 1,
        orderId: null, // Unknown for manual trades
        stopLossOrderId: null,
        takeProfitOrderId: null,
        manuallyOpened: true, // Flag to indicate this was manually opened
      }, exchangeName);
      
      // Save to Supabase
      await savePosition({
        symbol,
        side,
        entryPrice,
        entryTime: new Date().toISOString(), // Use current time as entry time (we don't know actual entry time)
        quantity,
        positionSizeUsd,
        stopLossPrice: null, // Unknown for manual trades
        takeProfitPrice: null, // Unknown for manual trades
        stopLossPercent: null,
        takeProfitPercent: null,
        entryOrderId: null,
        stopLossOrderId: null,
        takeProfitOrderId: null,
        currentPrice,
        unrealizedPnlUsd: parseFloat(unrealizedPnlUsd.toFixed(4)),
        unrealizedPnlPercent: parseFloat(unrealizedPnlPercent.toFixed(4)),
        assetClass,
        exchange: exchangeName,
        notes: 'Manually opened position detected by bot',
      });
      
      logger.info(`✅ Manually opened position ${symbol} registered in Supabase`);
    } catch (error) {
      logger.logError(`Error handling manually opened position ${exchangePosition.symbol}`, error);
    }
  }
  
  /**
   * Handle a position that was closed on the exchange
   */
  async handleClosedPosition(position) {
    try {
      logger.info(`Position ${position.symbol} was closed on exchange (likely TP/SL hit)`);
      
      // Get final price from ticker
      const ticker = await this.api.getTicker(position.symbol);
      const exitPrice = parseFloat(ticker.lastPrice || ticker.price);
      
      // Calculate final P&L
      const { unrealizedPnlUsd, unrealizedPnlPercent } = this.calculateUnrealizedPnL(
        position,
        exitPrice
      );
      
      // Determine exit reason (check if close to TP or SL first)
      let exitReason = 'AUTO_CLOSED';
      
      // Check if closed near stop loss
      if (position.stopLossPercent) {
        const slPrice = position.side === 'BUY' 
          ? position.entryPrice * (1 - position.stopLossPercent / 100)
          : position.entryPrice * (1 + position.stopLossPercent / 100);
        
        const slDiff = Math.abs(exitPrice - slPrice) / slPrice;
        if (slDiff < 0.01) { // Within 1% of SL price
          exitReason = 'STOP_LOSS';
        }
      }
      
      // Check if closed near take profit (only if not already marked as SL)
      if (position.takeProfitPercent && exitReason === 'AUTO_CLOSED') {
        const tpPrice = position.side === 'BUY'
          ? position.entryPrice * (1 + position.takeProfitPercent / 100)
          : position.entryPrice * (1 - position.takeProfitPercent / 100);
        
        const tpDiff = Math.abs(exitPrice - tpPrice) / tpPrice;
        if (tpDiff < 0.01) { // Within 1% of TP price
          exitReason = 'TAKE_PROFIT';
        }
      }
      
      // If not TP/SL and was manually opened, mark as manual
      if (exitReason === 'AUTO_CLOSED' && position.manuallyOpened) {
        exitReason = 'MANUAL';
      }
      
      // Log to database
      // Ensure timestamp is valid - use current time if missing
      const entryTime = position.timestamp 
        ? new Date(position.timestamp).toISOString() 
        : new Date().toISOString();
      
      await logTrade({
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        entryTime,
        exitPrice,
        exitTime: new Date().toISOString(),
        quantity: position.quantity,
        positionSizeUsd: this.getExchangeTradeAmount(),
        stopLossPrice: position.stopLossPercent 
          ? (position.side === 'BUY' 
              ? position.entryPrice * (1 - position.stopLossPercent / 100)
              : position.entryPrice * (1 + position.stopLossPercent / 100))
          : null,
        takeProfitPrice: position.takeProfitPercent
          ? (position.side === 'BUY'
              ? position.entryPrice * (1 + position.takeProfitPercent / 100)
              : position.entryPrice * (1 - position.takeProfitPercent / 100))
          : null,
        stopLossPercent: position.stopLossPercent,
        takeProfitPercent: position.takeProfitPercent,
        pnlUsd: unrealizedPnlUsd,
        pnlPercent: unrealizedPnlPercent,
        exitReason,
        orderId: position.orderId,
        // REQUIRED for TradeFI dashboard integration
        assetClass: 'crypto', // Aster DEX trades crypto
        exchange: this.api.exchangeName || 'aster', // Use actual exchange name
      });
      
      // Cancel remaining bracket orders (TP or SL that didn't trigger)
      // When exchange TP/SL fills, the other side is still open and must be cleaned up
      if (this.api.cancelAllOrders) {
        try {
          await this.api.cancelAllOrders(position.symbol);
          logger.info(`🧹 Cancelled remaining open orders for ${position.symbol} (bracket cleanup)`);
        } catch (cancelErr) {
          // Not critical — the order may have already been cancelled or expired
          logger.debug(`Could not cancel remaining orders for ${position.symbol}: ${cancelErr.message}`);
        }
      }
      
      // Remove from database positions table
      await removePosition(position.symbol);
      
      // Remove from tracker (use exchange if available)
      const exchange = position.exchange || this.api.exchangeName || 'aster';
      this.tracker.removePosition(position.symbol, exchange);
      
      logger.info(`✅ ${position.symbol} closed: ${exitReason}, P&L: $${unrealizedPnlUsd.toFixed(2)} (${unrealizedPnlPercent.toFixed(2)}%)`);
    } catch (error) {
      logger.logError(`Error handling closed position ${position.symbol}`, error);
    }
  }

  /**
   * Get exchange-specific trade amount
   */
  getExchangeTradeAmount() {
    const exchangeConfig = this.config[this.api.exchangeName] || {};
    const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
    const positionMultiplier = exchangeConfig.positionMultiplier || 1.0;
    return exchangeTradeAmount * positionMultiplier;
  }

  /**
   * Force update all positions immediately
   */
  async forceUpdate() {
    logger.info('Force updating all positions');
    await this.updateAllPositions();
  }
}

module.exports = PositionUpdater;

