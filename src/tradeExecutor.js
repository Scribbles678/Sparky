const logger = require('./utils/logger');
const {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  getOppositeSide,
  roundPrice,
  roundQuantity,
} = require('./utils/calculations');
const {
  logTrade,
  savePosition,
  removePosition,
} = require('./supabaseClient');
const StrategyManager = require('./strategyManager');
const {
  notifyTradeSuccess,
  notifyTradeFailed,
  notifyPositionClosedProfit,
  notifyPositionClosedLoss,
} = require('./utils/notifications');

class TradeExecutor {
  /**
   * @param {Object} exchangeApi - Exchange API instance (AsterAPI, OandaAPI, etc.)
   * @param {Object} positionTracker - Position tracker instance
   * @param {Object} config - Bot configuration
   * @param {string} [exchangeName] - Optional exchange name override (for multi-tenant dynamic instances)
   */
  constructor(exchangeApi, positionTracker, config, exchangeName = null) {
    this.api = exchangeApi;
    this.tracker = positionTracker;
    this.config = config;
    this.strategyManager = new StrategyManager();
    // Determine exchange name: explicit > from API instance > default
    this.exchange = exchangeName || exchangeApi.exchangeName || exchangeApi.getExchangeName?.() || 'aster';
  }

  /**
   * Get asset class based on exchange
   * Used for proper dashboard categorization
   */
  getAssetClass() {
    const exchangeAssetMap = {
      'aster': 'crypto',
      'oanda': 'forex',
      'tradier': 'stocks',
      'tradier_options': 'options',
      'lighter': 'crypto',
      'hyperliquid': 'crypto',
      'tastytrade': 'futures',
    };
    return exchangeAssetMap[this.exchange] || 'crypto';
  }

  /**
   * Main execution handler for webhook alerts
   * @param {Object} alertData - Alert/order data from webhook
   * @param {String} userId - User ID from SignalStudio (for multi-tenant support)
   */
  async executeWebhook(alertData, userId = null) {
    try {
      const { action, symbol, strategy } = alertData;

      // Store userId in alertData for downstream use
      alertData.userId = userId || alertData.userId || alertData.user_id;

      logger.logWebhook(alertData);

      if (alertData.userId) {
        logger.info(`🔐 Processing trade for user: ${alertData.userId}`);
      } else {
        logger.warn('⚠️ No userId provided - trade may not be visible in dashboard!');
      }

      // Check if this is a pre-built order from SignalStudio
      // SignalStudio orders have user_id AND position_size_usd (already validated)
      const isSignalStudioOrder = alertData.userId && (alertData.position_size_usd || alertData.positionSizeUsd);
      
      // Validate strategy if provided (skip for SignalStudio pre-built orders - already validated)
      if (strategy && !isSignalStudioOrder) {
        const strategyInfo = this.strategyManager.validateStrategy(strategy);
        if (!strategyInfo) {
          return {
            success: false,
            action: 'rejected',
            message: `Strategy '${strategy}' not found or inactive`,
          };
        }
        logger.info(`📊 Executing trade with strategy: ${strategy}`);
      } else if (strategy && isSignalStudioOrder) {
        logger.info(`📊 Executing SignalStudio pre-built order for strategy: ${strategy} (validation skipped - trusted source)`);
      }

      // Route to appropriate handler
      if (action.toLowerCase() === 'close') {
        return await this.closePosition(symbol, strategy, alertData.userId);
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
      orderType,
      order_type,
      price,
      stopLoss,
      stop_loss_percent,
      takeProfit,
      take_profit_percent,
      trailingStop,
      trailing_stop_pips,
      useTrailingStop,
      position_size_usd,
      positionSizeUsd,
    } = alertData;

    const side = action.toUpperCase();
    
    // Support both camelCase and snake_case
    const finalOrderType = (orderType || order_type || 'market').toLowerCase();
    const finalStopLoss = stopLoss || stop_loss_percent;
    const finalTakeProfit = takeProfit || take_profit_percent;
    const finalTrailingStop = trailingStop || trailing_stop_pips;
    const finalUseTrailingStop = useTrailingStop || false;

    logger.info(`Opening ${side} position for ${symbol}`);

    try {
      // Step 1: Check if position already exists (verify with exchange to handle manual closes)
      if (this.tracker.hasPosition(symbol, this.exchange)) {
        // Verify position actually exists on exchange (handles case where position was manually closed)
        const positionExistsOnExchange = await this.api.hasOpenPosition(symbol);
        
        if (!positionExistsOnExchange) {
          // Position is tracked but doesn't exist on exchange - clean it up
          logger.info(`Position ${symbol} is tracked but not found on exchange. Cleaning up tracker...`);
          this.tracker.removePosition(symbol, this.exchange);
          // Continue to open new position
        } else {
          // Position exists on exchange - check side
          const existingPosition = this.tracker.getPosition(symbol, this.exchange);
          
          // If same side, ignore the alert
          if (existingPosition.side === side) {
            logger.info(`Already have ${side} position for ${symbol}, ignoring duplicate signal`);
            return {
              success: false,
              action: 'skipped',
              message: `Already have ${side} position for ${symbol}. Waiting for TP/SL or opposite signal.`,
            };
          }
          
          // If opposite side, close existing position first (reversal)
          logger.info(`Reversal signal detected: Closing ${existingPosition.side} position before opening ${side} position for ${symbol}`);
          try {
            await this.closePosition(symbol);
            logger.info(`Previous position closed successfully. Opening new ${side} position...`);
            // Wait 1 second for exchange to process
            await this.sleep(1000);
          } catch (error) {
            logger.logError(`Failed to close existing position for reversal`, error, { symbol });
            return {
              success: false,
              action: 'reversal_failed',
              message: `Failed to close existing position for reversal: ${error.message}`,
            };
          }
        }
      }

      // Step 2: Check available margin (optional, for safety)
      const availableMargin = await this.api.getAvailableMargin();
      
      // Step 3: Get position size (priority: alertData.position_size_usd > config.json)
      // SignalStudio now sends pre-built orders with position_size_usd
      const exchangeConfig = this.config[this.exchange] || {};
      let finalTradeAmount;
      
      if (alertData.position_size_usd || alertData.positionSizeUsd) {
        // Use position size from SignalStudio (pre-built order)
        finalTradeAmount = parseFloat(alertData.position_size_usd || alertData.positionSizeUsd);
        logger.info(`Using position size from SignalStudio: $${finalTradeAmount}`);
      } else {
        // Fallback to config.json (backward compatibility for direct webhooks)
        const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
        const positionMultiplier = exchangeConfig.positionMultiplier || 1.0;
        finalTradeAmount = exchangeTradeAmount * positionMultiplier;
        logger.info(`Using position size from config: $${finalTradeAmount}`);
      }
      
      logger.info(`Available margin: ${availableMargin}, Position size: $${finalTradeAmount} (${this.exchange} exchange)`);

      // Step 4: Get current market price if not provided (for MARKET orders)
      let entryPrice = price;
      if (!entryPrice || finalOrderType === 'market') {
        const ticker = await this.api.getTicker(symbol);
        entryPrice = parseFloat(ticker.lastPrice || ticker.price);
        logger.info(`Fetched current market price for ${symbol}: ${entryPrice}`);
      }
      
      // Step 5: Calculate position size (simple: position value / price)
      const quantity = calculatePositionSize(finalTradeAmount, entryPrice);
      const roundedQuantity = roundQuantity(quantity, symbol, this.exchange);

      logger.info(`Position size calculated: ${roundedQuantity} at ${entryPrice} ($${finalTradeAmount} position)`);

      // Step 5: Place entry order (exchange will use its max leverage setting)
      let orderResult;
      
      if (finalOrderType === 'market') {
        orderResult = await this.api.placeMarketOrder(symbol, side, roundedQuantity);
      } else {
        orderResult = await this.api.placeLimitOrder(symbol, side, roundedQuantity, entryPrice);
      }

      logger.logTrade('opened', symbol, {
        orderId: orderResult.orderId,
        side,
        quantity: roundedQuantity,
        price: entryPrice,
      });

      // Step 6: Place stop loss (regular or trailing)
      let stopLossOrderId = null;
      let stopLossType = 'REGULAR';
      
      if (finalStopLoss || finalTrailingStop) {
        try {
          // Check if this is Oanda and we want trailing stop
          const isOanda = this.api.exchangeName === 'oanda';
          const useTrailing = isOanda && (finalUseTrailingStop || finalTrailingStop);
          
          if (useTrailing && finalTrailingStop) {
            // Place trailing stop for Oanda
            const trailingDistance = parseFloat(finalTrailingStop);
            
            const stopLossResult = await this.api.placeTrailingStopLoss(
              symbol,
              side,
              roundedQuantity,
              trailingDistance
            );

            stopLossOrderId = stopLossResult.orderId;
            stopLossType = 'TRAILING';
            
            logger.info(`Trailing stop loss placed with ${trailingDistance} pips distance`, {
              orderId: stopLossOrderId,
              distance: trailingDistance,
              type: 'TRAILING',
            });
          } else {
            // Place regular stop loss
            const stopPrice = calculateStopLoss(side, entryPrice, finalStopLoss);
            const roundedStopPrice = roundPrice(stopPrice);
            const stopSide = getOppositeSide(side);

            const stopLossResult = await this.api.placeStopLoss(
              symbol,
              stopSide,
              roundedQuantity,
              roundedStopPrice
            );

            stopLossOrderId = stopLossResult.orderId;
            
            const dollarLoss = (finalTradeAmount * finalStopLoss / 100).toFixed(2);
            
            logger.info(`Stop loss placed at ${roundedStopPrice}`, {
              orderId: stopLossOrderId,
              percent: finalStopLoss,
              dollarAmount: `$${dollarLoss}`,
              type: 'REGULAR',
            });
          }
        } catch (error) {
          logger.logError('Failed to place stop loss', error, { symbol });
          // Don't fail the entire trade if stop loss fails, but log it prominently
        }
      }

      // Step 7: Place take profit (optional)
      let takeProfitOrderId = null;
      
      if (finalTakeProfit) {
        try {
          const tpPrice = calculateTakeProfit(side, entryPrice, finalTakeProfit);
          const roundedTpPrice = roundPrice(tpPrice);
          const tpSide = getOppositeSide(side);

          const takeProfitResult = await this.api.placeTakeProfit(
            symbol,
            tpSide,
            roundedQuantity,
            roundedTpPrice
          );

          takeProfitOrderId = takeProfitResult.orderId;
          
          const dollarProfit = (finalTradeAmount * finalTakeProfit / 100).toFixed(2);
          
          logger.info(`Take profit placed at ${roundedTpPrice}`, {
            orderId: takeProfitOrderId,
            percent: finalTakeProfit,
            dollarAmount: `$${dollarProfit}`,
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
        orderId: orderResult.orderId,
        stopLossOrderId,
        takeProfitOrderId,
        stopLossPercent: finalStopLoss,
        takeProfitPercent: finalTakeProfit,
        stopLossType: stopLossType,
        trailingStopDistance: finalTrailingStop,
        exchange: this.api.exchangeName,
      }, this.exchange);

      // Step 9: Log position to database
      const stopPrice = finalStopLoss ? calculateStopLoss(side, entryPrice, finalStopLoss) : null;
      const tpPrice = finalTakeProfit ? calculateTakeProfit(side, entryPrice, finalTakeProfit) : null;
      
      // Get strategy ID if strategy is provided (from alertData or lookup)
      let strategyId = alertData.strategy_id || null;
      if (!strategyId && alertData.strategy) {
        const strategyInfo = this.strategyManager.getStrategy(alertData.strategy);
        strategyId = strategyInfo?.id || null;
      }

      await savePosition({
        // MULTI-TENANT: user_id is REQUIRED for dashboard visibility
        userId: alertData.userId,
        symbol,
        side,
        entryPrice,
        entryTime: new Date().toISOString(),
        quantity: roundedQuantity,
        positionSizeUsd: finalTradeAmount,
        stopLossPrice: stopPrice,
        takeProfitPrice: tpPrice,
        stopLossPercent: finalStopLoss,
        takeProfitPercent: finalTakeProfit,
        entryOrderId: orderResult.orderId,
        stopLossOrderId,
        takeProfitOrderId,
        currentPrice: entryPrice,
        unrealizedPnlUsd: 0,
        unrealizedPnlPercent: 0,
        // REQUIRED for SignalStudio dashboard integration
        assetClass: this.getAssetClass(), // Dynamic based on exchange
        exchange: this.exchange,
        strategyId: strategyId,
      });

      logger.info(`Position opened successfully for ${symbol}`);

      // Send notification (async, fire-and-forget)
      if (alertData.userId) {
        notifyTradeSuccess(
          alertData.userId,
          symbol,
          side,
          this.exchange,
          roundedQuantity,
          entryPrice
        );
      }

      return {
        success: true,
        action: 'opened',
        position,
      };
    } catch (error) {
      logger.logError('Failed to open position', error, { symbol, action });
      
      // Send failure notification (async, fire-and-forget)
      if (alertData.userId) {
        notifyTradeFailed(
          alertData.userId,
          symbol,
          action,
          this.exchange,
          error.message
        );
      }
      
      throw error;
    }
  }

  /**
   * Close an existing position
   * @param {String} symbol - Trading symbol
   * @param {String} strategy - Strategy name (optional)
   * @param {String} userId - User ID for multi-tenant support
   */
  async closePosition(symbol, strategy = null, userId = null) {
    logger.info(`Closing position for ${symbol}${userId ? ` (user: ${userId})` : ''}`);

    try {
      // Check if we're tracking this position
      const trackedPosition = this.tracker.getPosition(symbol, this.exchange);
      
      // Get actual position from exchange
      const exchangePosition = await this.api.getPosition(symbol);

      if (!exchangePosition) {
        logger.info(`No open position found on exchange for ${symbol}`);
        
        // Remove from tracker if it was there
        if (trackedPosition) {
          this.tracker.removePosition(symbol, this.exchange);
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
      
      // Get entry price and calculate exit price
      const entryPrice = parseFloat(exchangePosition.entryPrice);
      const exitPrice = parseFloat(exchangePosition.markPrice || exchangePosition.lastPrice || 0);
      
      // Calculate trade amount for this exchange
      const exchangeConfig = this.config[this.exchange] || {};
      const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
      const positionMultiplier = exchangeConfig.positionMultiplier || 1.0;
      const finalTradeAmount = exchangeTradeAmount * positionMultiplier;
      
      // Calculate P&L
      const positionSide = positionAmt > 0 ? 'BUY' : 'SELL';
      let pnlUsd = 0;
      
      if (positionSide === 'BUY') {
        // Long position: profit if price went up
        pnlUsd = (exitPrice - entryPrice) * quantity;
      } else {
        // Short position: profit if price went down
        pnlUsd = (entryPrice - exitPrice) * quantity;
      }
      
      const pnlPercent = (pnlUsd / finalTradeAmount) * 100;

      // Close the position
      const closeResult = await this.api.closePosition(symbol, side, quantity);

      logger.logTrade('closed', symbol, {
        orderId: closeResult.orderId,
        quantity,
        side,
        pnl: `$${pnlUsd.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
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

      // Log completed trade to database
      if (trackedPosition) {
        // Calculate trade amount for this exchange
        const exchangeConfig = this.config[this.exchange] || {};
        const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
        const positionMultiplier = exchangeConfig.positionMultiplier || 1.0;
        const finalTradeAmount = exchangeTradeAmount * positionMultiplier;
        
        // Get strategy ID if strategy is provided
        let strategyId = null;
        if (strategy) {
          const strategyInfo = this.strategyManager.getStrategy(strategy);
          strategyId = strategyInfo?.id || null;
        }

        const tradeResult = await logTrade({
          // MULTI-TENANT: user_id is REQUIRED for dashboard visibility
          userId: userId,
          symbol,
          side: positionSide,
          entryPrice: trackedPosition.entryPrice || entryPrice,
          entryTime: trackedPosition.timestamp ? new Date(trackedPosition.timestamp).toISOString() : new Date().toISOString(),
          exitPrice,
          exitTime: new Date().toISOString(),
          quantity,
          positionSizeUsd: finalTradeAmount,
          stopLossPrice: trackedPosition.stopLossPercent ? calculateStopLoss(positionSide, entryPrice, trackedPosition.stopLossPercent) : null,
          takeProfitPrice: trackedPosition.takeProfitPercent ? calculateTakeProfit(positionSide, entryPrice, trackedPosition.takeProfitPercent) : null,
          stopLossPercent: trackedPosition.stopLossPercent,
          takeProfitPercent: trackedPosition.takeProfitPercent,
          pnlUsd,
          pnlPercent,
          orderId: closeResult.orderId,
          exitReason: 'MANUAL', // You can enhance this later to detect SL/TP hits
          // REQUIRED for SignalStudio dashboard integration
          assetClass: this.getAssetClass(), // Dynamic based on exchange
          exchange: this.exchange,
          strategyId: strategyId,
        });

        // =====================================================================
        // COPY TRADING: Update copied trade P&L if this was a copied trade
        // =====================================================================
        // If this trade was executed as part of copy trading, update the
        // copied_trades table with P&L for billing purposes.
        // =====================================================================
        if (alertData && alertData.source === 'copy_trading' && tradeResult && tradeResult.data) {
          const { updateCopiedTradePnl, updateCopiedTradeFollowerId } = require('./utils/copyTrading');
          const tradeId = tradeResult.data[0]?.id || null;
          if (tradeId) {
            // Update follower_trade_id in copied_trades
            if (alertData.copy_relationship_id) {
              updateCopiedTradeFollowerId(alertData.copy_relationship_id, tradeId).catch(err => {
                logger.debug('Failed to update copied trade follower_trade_id', err);
              });
            }
            
            // Update P&L
            updateCopiedTradePnl(tradeId, {
              pnl_usd: pnlUsd,
              pnl_percent: pnlPercent,
              is_winner: pnlUsd > 0,
              exit_time: new Date().toISOString(),
              strategyId: strategyId
            }).catch(err => {
              logger.debug('Failed to update copied trade P&L', err);
            });
          }
        }

        // Update strategy performance metrics
        if (strategy) {
          await this.strategyManager.updateStrategyMetrics(strategy, {
            pnlUsd,
            pnlPercent,
            symbol,
            side: positionSide
          });
        }
      }

      // Remove position from database (with userId for multi-tenant safety)
      await removePosition(symbol, userId);
      
      // Remove from tracker
      this.tracker.removePosition(symbol, this.exchange);

      logger.info(`Position closed successfully for ${symbol} with P&L: $${pnlUsd.toFixed(2)}`);

      // Send notification based on P&L (async, fire-and-forget)
      if (userId) {
        if (pnlUsd >= 0) {
          notifyPositionClosedProfit(userId, symbol, this.exchange, pnlUsd, pnlPercent);
        } else {
          notifyPositionClosedLoss(userId, symbol, this.exchange, pnlUsd, pnlPercent);
        }
      }

      return {
        success: true,
        action: 'closed',
        closeOrder: closeResult,
        pnl: {
          usd: pnlUsd,
          percent: pnlPercent,
        },
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

