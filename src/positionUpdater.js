/**
 * Position Price Updater Service
 * Periodically fetches current prices and updates Supabase positions
 * Also syncs with exchange to detect closed positions
 */

const logger = require('./utils/logger');
const { updatePositionPnL, logTrade, removePosition } = require('./supabaseClient');
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
    const positionSizeUsd = this.config.tradeAmount;

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
   * Sync tracked positions with exchange to detect closed positions
   */
  async syncWithExchange() {
    try {
      logger.info('Auto-syncing positions with exchange...');
      
      // Get all tracked positions
      const trackedPositions = this.tracker.getAllPositions();
      
      if (trackedPositions.length === 0) {
        return; // Nothing to sync
      }
      
      // Get actual positions from exchange
      const exchangePositions = await this.api.getPositions();
      const openSymbols = exchangePositions
        .filter(p => parseFloat(p.positionAmt) !== 0)
        .map(p => p.symbol);
      
      // Find positions that are tracked but no longer open on exchange
      const closedPositions = trackedPositions.filter(
        tracked => !openSymbols.includes(tracked.symbol)
      );
      
      if (closedPositions.length === 0) {
        logger.info('All tracked positions still open on exchange');
        return;
      }
      
      logger.info(`Detected ${closedPositions.length} position(s) closed on exchange`);
      
      // Process each closed position
      for (const position of closedPositions) {
        await this.handleClosedPosition(position);
      }
    } catch (error) {
      logger.logError('Error in syncWithExchange', error);
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
      
      // Determine exit reason (check if close to TP or SL)
      let exitReason = 'AUTO_CLOSED';
      
      if (position.stopLossPercent) {
        const slPrice = position.side === 'BUY' 
          ? position.entryPrice * (1 - position.stopLossPercent / 100)
          : position.entryPrice * (1 + position.stopLossPercent / 100);
        
        const slDiff = Math.abs(exitPrice - slPrice) / slPrice;
        if (slDiff < 0.01) { // Within 1% of SL price
          exitReason = 'STOP_LOSS';
        }
      }
      
      if (position.takeProfitPercent && exitReason === 'AUTO_CLOSED') {
        const tpPrice = position.side === 'BUY'
          ? position.entryPrice * (1 + position.takeProfitPercent / 100)
          : position.entryPrice * (1 - position.takeProfitPercent / 100);
        
        const tpDiff = Math.abs(exitPrice - tpPrice) / tpPrice;
        if (tpDiff < 0.01) { // Within 1% of TP price
          exitReason = 'TAKE_PROFIT';
        }
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
        positionSizeUsd: this.config.tradeAmount,
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
      });
      
      // Remove from database positions table
      await removePosition(position.symbol);
      
      // Remove from tracker
      this.tracker.removePosition(position.symbol);
      
      logger.info(`✅ ${position.symbol} closed: ${exitReason}, P&L: $${unrealizedPnlUsd.toFixed(2)} (${unrealizedPnlPercent.toFixed(2)}%)`);
    } catch (error) {
      logger.logError(`Error handling closed position ${position.symbol}`, error);
    }
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

