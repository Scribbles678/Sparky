const logger = require('./utils/logger');
const {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  getOppositeSide,
  roundPrice,
  roundQuantity,
  hassufficientMargin,
} = require('./utils/calculations');

class TradeExecutor {
  constructor(asterApi, positionTracker, config) {
    this.api = asterApi;
    this.tracker = positionTracker;
    this.config = config;
  }

  /**
   * Main execution handler for webhook alerts
   */
  async executeWebhook(alertData) {
    try {
      const { action, symbol } = alertData;

      logger.logWebhook(alertData);

      // Route to appropriate handler
      if (action.toLowerCase() === 'close') {
        return await this.closePosition(symbol);
      } else if (['buy', 'sell'].includes(action.toLowerCase())) {
        return await this.openPosition(alertData);
      } else {
        throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logger.logError('Webhook execution failed', error, { alertData });
      throw error;
    }
  }

  /**
   * Open a new position
   */
  async openPosition(alertData) {
    const {
      action,
      symbol,
      order_type = 'market',
      price,
      stop_loss_percent,
      take_profit_percent,
    } = alertData;

    const side = action.toUpperCase();

    logger.info(`Opening ${side} position for ${symbol}`);

    try {
      // Step 1: Check and close existing position if exists
      if (this.tracker.hasPosition(symbol)) {
        logger.info(`Existing position found for ${symbol}, closing first`);
        await this.closePosition(symbol);
        
        // Wait a moment for the close to propagate
        await this.sleep(1000);
      }

      // Step 2: Get leverage for symbol
      const leverage = this.config.leverage[symbol] || this.config.leverage.default;

      // Step 3: Check available margin
      const availableMargin = await this.api.getAvailableMargin();
      const requiredMargin = this.config.tradeAmount;

      if (!hassufficientMargin(availableMargin, requiredMargin, this.config.riskManagement?.minMarginPercent || 20)) {
        throw new Error(`Insufficient margin. Available: ${availableMargin}, Required: ${requiredMargin}`);
      }

      logger.info(`Margin check passed. Available: ${availableMargin}, Required: ${requiredMargin}`);

      // Step 4: Calculate position size
      const entryPrice = price;
      const quantity = calculatePositionSize(this.config.tradeAmount, leverage, entryPrice);
      const roundedQuantity = roundQuantity(quantity);

      logger.info(`Position size calculated: ${roundedQuantity} at ${entryPrice} (${leverage}x)`);

      // Step 5: Place entry order
      let orderResult;
      
      if (order_type.toLowerCase() === 'market') {
        orderResult = await this.api.placeMarketOrder(symbol, side, roundedQuantity, leverage);
      } else {
        orderResult = await this.api.placeLimitOrder(symbol, side, roundedQuantity, entryPrice, leverage);
      }

      logger.logTrade('opened', symbol, {
        orderId: orderResult.orderId,
        side,
        quantity: roundedQuantity,
        price: entryPrice,
        leverage,
      });

      // Step 6: Place stop loss
      let stopLossOrderId = null;
      
      if (stop_loss_percent) {
        try {
          const stopPrice = calculateStopLoss(side, entryPrice, stop_loss_percent);
          const roundedStopPrice = roundPrice(stopPrice);
          const stopSide = getOppositeSide(side);

          const stopLossResult = await this.api.placeStopLoss(
            symbol,
            stopSide,
            roundedQuantity,
            roundedStopPrice
          );

          stopLossOrderId = stopLossResult.orderId;
          
          logger.info(`Stop loss placed at ${roundedStopPrice}`, {
            orderId: stopLossOrderId,
            percent: stop_loss_percent,
          });
        } catch (error) {
          logger.logError('Failed to place stop loss', error, { symbol });
          // Don't fail the entire trade if stop loss fails, but log it prominently
        }
      }

      // Step 7: Place take profit (optional)
      let takeProfitOrderId = null;
      
      if (take_profit_percent) {
        try {
          const tpPrice = calculateTakeProfit(side, entryPrice, take_profit_percent);
          const roundedTpPrice = roundPrice(tpPrice);
          const tpSide = getOppositeSide(side);

          const takeProfitResult = await this.api.placeTakeProfit(
            symbol,
            tpSide,
            roundedQuantity,
            roundedTpPrice
          );

          takeProfitOrderId = takeProfitResult.orderId;
          
          logger.info(`Take profit placed at ${roundedTpPrice}`, {
            orderId: takeProfitOrderId,
            percent: take_profit_percent,
          });
        } catch (error) {
          logger.logError('Failed to place take profit', error, { symbol });
          // Don't fail the entire trade if TP fails
        }
      }

      // Step 8: Track the position
      const position = this.tracker.addPosition(symbol, {
        side,
        quantity: roundedQuantity,
        entryPrice,
        leverage,
        orderId: orderResult.orderId,
        stopLossOrderId,
        takeProfitOrderId,
        stopLossPercent: stop_loss_percent,
        takeProfitPercent: take_profit_percent,
      });

      logger.info(`Position opened successfully for ${symbol}`);

      return {
        success: true,
        action: 'opened',
        position,
      };
    } catch (error) {
      logger.logError('Failed to open position', error, { symbol, action });
      throw error;
    }
  }

  /**
   * Close an existing position
   */
  async closePosition(symbol) {
    logger.info(`Closing position for ${symbol}`);

    try {
      // Check if we're tracking this position
      const trackedPosition = this.tracker.getPosition(symbol);
      
      // Get actual position from exchange
      const exchangePosition = await this.api.getPosition(symbol);

      if (!exchangePosition) {
        logger.info(`No open position found on exchange for ${symbol}`);
        
        // Remove from tracker if it was there
        if (trackedPosition) {
          this.tracker.removePosition(symbol);
        }
        
        return {
          success: true,
          action: 'closed',
          message: 'No position to close',
        };
      }

      // Get position details
      const positionAmt = parseFloat(exchangePosition.positionAmt);
      const quantity = Math.abs(positionAmt);
      const side = positionAmt > 0 ? 'SELL' : 'BUY'; // Opposite side to close

      // Close the position
      const closeResult = await this.api.closePosition(symbol, side, quantity);

      logger.logTrade('closed', symbol, {
        orderId: closeResult.orderId,
        quantity,
        side,
      });

      // Cancel stop loss and take profit orders if they exist
      if (trackedPosition) {
        if (trackedPosition.stopLossOrderId) {
          try {
            await this.api.cancelOrder(symbol, trackedPosition.stopLossOrderId);
            logger.info(`Cancelled stop loss order ${trackedPosition.stopLossOrderId}`);
          } catch (error) {
            logger.logError('Failed to cancel stop loss', error, { symbol });
          }
        }

        if (trackedPosition.takeProfitOrderId) {
          try {
            await this.api.cancelOrder(symbol, trackedPosition.takeProfitOrderId);
            logger.info(`Cancelled take profit order ${trackedPosition.takeProfitOrderId}`);
          } catch (error) {
            logger.logError('Failed to cancel take profit', error, { symbol });
          }
        }
      }

      // Remove from tracker
      this.tracker.removePosition(symbol);

      logger.info(`Position closed successfully for ${symbol}`);

      return {
        success: true,
        action: 'closed',
        closeOrder: closeResult,
      };
    } catch (error) {
      logger.logError('Failed to close position', error, { symbol });
      throw error;
    }
  }

  /**
   * Get current positions summary
   */
  getPositionsSummary() {
    return this.tracker.getSummary();
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TradeExecutor;

