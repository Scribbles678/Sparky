/**
 * Position Price Updater Service
 * Periodically fetches current prices and updates Supabase positions
 */

const logger = require('./utils/logger');
const { updatePositionPnL } = require('./supabaseClient');
const { calculatePositionSize } = require('./utils/calculations');

class PositionUpdater {
  constructor(asterApi, positionTracker, config) {
    this.api = asterApi;
    this.tracker = positionTracker;
    this.config = config;
    this.updateInterval = null;
    this.intervalMs = 30000; // Update every 30 seconds
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
   * Force update all positions immediately
   */
  async forceUpdate() {
    logger.info('Force updating all positions');
    await this.updateAllPositions();
  }
}

module.exports = PositionUpdater;

