/**
 * Position Price Updater Service
 * Periodically fetches current prices and updates Supabase positions
 * Also syncs with exchange to detect closed positions
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
    this.intervalMs = 30000; // Update every 30 seconds
    this.syncIntervalCount = 10; // Sync with exchange every 10 intervals (5 minutes)
    this.currentIntervalCount = 0;
  }

  /**
   * Start the position updater service
   */
  start() {
    if (this.updateInterval) {
      logger.warn('Position updater already running');
      return;
    }

    logger.info('Starting position price updater service');
    
    // Run immediately
    this.updateAllPositions();
    
    // Then run every intervalMs
    this.updateInterval = setInterval(() => {
      this.updateAllPositions();
    }, this.intervalMs);
  }

  /**
   * Stop the position updater service
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.info('Position price updater stopped');
    }
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

