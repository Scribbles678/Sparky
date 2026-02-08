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
  notifyTradeBlocked,
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
      'tastytrade': 'futures',
      'kalshi': 'prediction',
      'alpaca': 'stocks',
      'capital': 'crypto', // Capital.com supports CFDs, stocks, forex, crypto, commodities
      'robinhood': 'crypto', // Robinhood Crypto is crypto-only
      'trading212': 'stocks', // Trading212 supports stocks and ETFs (Invest and Stocks ISA accounts)
      'lime': 'stocks', // Lime supports stocks and options (US equities)
      'public': 'stocks', // Public.com supports stocks and options
      'webull': 'stocks', // Webull supports stocks and ETFs (US market)
      'tradestation': 'stocks', // TradeStation supports stocks, options, and futures
      // 'etrade': 'stocks', // Disabled - OAuth 1.0 with daily expiration is too burdensome
    };
    return exchangeAssetMap[this.exchange] || 'crypto';
  }

  /**
   * Get current market context for ML validation
   * @param {string} symbol - Trading symbol
   * @param {string} exchange - Exchange name
   * @returns {Promise<Object>} Market context data
   */
  async getMarketContext(symbol, exchange) {
    try {
      const ticker = await this.api.fetchTicker(symbol);
      
      return {
        current_price: ticker.last || ticker.close,
        volume: ticker.quoteVolume || ticker.baseVolume,
        timestamp: new Date().toISOString(),
        exchange,
        symbol
      };
    } catch (error) {
      logger.warn(`[ML VALIDATION] Could not fetch market context: ${error.message}`);
      return {
        current_price: null,
        volume: null,
        timestamp: new Date().toISOString(),
        exchange,
        symbol
      };
    }
  }

  /**
   * Validate trade signal using ML Pre-Trade Validation
   * @param {Object} strategy - Strategy object from Supabase
   * @param {Object} alertData - Webhook alert data
   * @param {Object} marketContext - Current market conditions
   * @returns {Promise<Object>} { allowed: boolean, confidence: number, reasons: string[] }
   */
  async validateWithML(strategy, alertData, marketContext) {
    const ARTHUR_ML_URL = process.env.ARTHUR_ML_URL || 'http://localhost:8001';
    
    try {
      logger.info(`[ML VALIDATION] Checking signal for strategy "${strategy.name}"...`);
      
      const response = await fetch(`${ARTHUR_ML_URL}/validate-strategy-signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          strategy_id: strategy.id,
          user_id: strategy.user_id,
          symbol: alertData.symbol,
          action: alertData.action,
          price: marketContext.current_price,
          timestamp: new Date().toISOString(),
        }),
        timeout: 5000, // 5 second timeout
      });

      if (!response.ok) {
        logger.error(`[ML VALIDATION] Arthur ML service error: ${response.status}`);
        // Fail open: allow trade if ML service is down
        return {
          allowed: true,
          confidence: null,
          reasons: ['ML service unavailable - trade allowed by default'],
          error: true
        };
      }

      const result = await response.json();
      
      const threshold = strategy.ml_config?.confidence_threshold || 70;
      const allowed = result.confidence >= threshold;
      
      logger.info(`[ML VALIDATION] Strategy: ${strategy.name}`);
      logger.info(`[ML VALIDATION] Confidence: ${result.confidence}%`);
      logger.info(`[ML VALIDATION] Threshold: ${threshold}%`);
      logger.info(`[ML VALIDATION] Decision: ${allowed ? 'ALLOW ✅' : 'BLOCK ❌'}`);
      
      return {
        allowed,
        confidence: result.confidence,
        threshold,
        reasons: result.reasons || [],
        market_context: result.market_context || {},
        feature_scores: result.feature_scores || {},
        error: false
      };
      
    } catch (error) {
      logger.error(`[ML VALIDATION] Error calling Arthur ML service: ${error.message}`);
      
      // Fail open: allow trade if ML validation fails
      return {
        allowed: true,
        confidence: null,
        reasons: ['ML validation error - trade allowed by default'],
        error: true
      };
    }
  }

  /**
   * Log ML validation attempt to Supabase
   * @param {string} strategyId - Strategy ID
   * @param {string} userId - User ID
   * @param {Object} alertData - Webhook alert data
   * @param {Object} validationResult - ML validation result
   */
  async logValidationAttempt(strategyId, userId, alertData, validationResult) {
    const { supabase } = require('./supabaseClient');
    
    if (!supabase) {
      logger.warn('[ML VALIDATION] Supabase client not available, skipping log');
      return;
    }
    
    try {
      const { error } = await supabase
        .from('strategy_validation_log')
        .insert({
          strategy_id: strategyId,
          user_id: userId,
          signal_timestamp: new Date().toISOString(),
          symbol: alertData.symbol,
          action: alertData.action,
          price_at_signal: validationResult.market_context?.current_price,
          ml_confidence: validationResult.confidence,
          confidence_threshold: validationResult.threshold,
          validation_result: validationResult.allowed ? 'allowed' : 'blocked',
          market_context: validationResult.market_context,
          feature_scores: validationResult.feature_scores,
          decision_reasons: validationResult.reasons,
          trade_executed: validationResult.allowed,
        });
      
      if (error) {
        logger.error(`[ML VALIDATION] Log error: ${error.message}`);
      }
    } catch (error) {
      logger.error(`[ML VALIDATION] Exception logging validation: ${error.message}`);
      // Don't fail the trade if logging fails
    }
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

      // ML Pre-Trade Validation (for manual strategies with ML enabled)
      if (alertData.strategy_id && alertData.userId && isSignalStudioOrder) {
        const { supabase } = require('./supabaseClient');
        
        // Load strategy details to check if ML validation is enabled
        if (supabase) {
          try {
            const { data: strategyData, error: strategyError } = await supabase
              .from('strategies')
              .select('*')
              .eq('id', alertData.strategy_id)
              .eq('user_id', alertData.userId)
              .maybeSingle();
            
            if (!strategyError && strategyData && strategyData.ml_assistance_enabled) {
              logger.info(`[ML VALIDATION] Strategy "${strategyData.name}" has ML validation enabled`);
              
              // Get current market context
              const marketContext = await this.getMarketContext(alertData.symbol, this.exchange);
              
              // Validate with ML
              const validationResult = await this.validateWithML(strategyData, alertData, marketContext);
              
              // Log validation attempt
              await this.logValidationAttempt(strategyData.id, alertData.userId, alertData, validationResult);
              
              // Check if trade should be blocked
              if (!validationResult.allowed && !validationResult.error) {
                logger.warn(`[ML BLOCK] Trade blocked by ML validation`);
                logger.warn(`[ML BLOCK] Confidence: ${validationResult.confidence}% < ${validationResult.threshold}%`);
                logger.warn(`[ML BLOCK] Reasons: ${validationResult.reasons.join(', ')}`);
                
                // Send notification to user
                await notifyTradeBlocked(alertData.userId, {
                  strategy_name: strategyData.name,
                  symbol: alertData.symbol,
                  action: alertData.action,
                  confidence: validationResult.confidence,
                  threshold: validationResult.threshold,
                  reasons: validationResult.reasons
                });
                
                return {
                  success: false,
                  blocked_by_ml: true,
                  confidence: validationResult.confidence,
                  threshold: validationResult.threshold,
                  reasons: validationResult.reasons,
                  message: `Trade blocked by ML validation (confidence ${validationResult.confidence}% < ${validationResult.threshold}%)`
                };
              }
              
              // Trade allowed (or ML error - fail open)
              if (validationResult.error) {
                logger.warn(`[ML VALIDATION] ML service error, allowing trade by default (fail-open)`);
              } else {
                logger.info(`[ML ALLOW] Trade allowed by ML validation (confidence ${validationResult.confidence}% >= ${validationResult.threshold}%) ✅`);
              }
            }
          } catch (mlError) {
            logger.error(`[ML VALIDATION] Exception during validation: ${mlError.message}`);
            logger.warn(`[ML VALIDATION] Allowing trade by default (fail-open)`);
            // Continue with trade execution
          }
        }
      }

      // Route to appropriate handler
      if (action.toLowerCase() === 'close') {
        // PHASE 2: Pass sell_percentage for partial closes
        return await this.closePosition(symbol, strategy, alertData.userId, alertData.sell_percentage);
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
      stop_loss_limit_price,
      takeProfit,
      take_profit_percent,
      trailingStop,
      trailing_stop_pips,
      trailing_stop_percent,
      useTrailingStop,
      position_size_usd,
      positionSizeUsd,
      useBracketOrder,
      useOCOOrder,
      useOTOOrder,
      extended_hours,
      extendedHours,
      useFractional,
    } = alertData;

    const side = action.toUpperCase();
    
    // Support both camelCase and snake_case
    const finalOrderType = (orderType || order_type || 'market').toLowerCase();
    const finalStopLoss = stopLoss || stop_loss_percent;
    const finalStopLossLimitPrice = stop_loss_limit_price || null;
    const finalTakeProfit = takeProfit || take_profit_percent;
    const finalTrailingStop = trailingStop || trailing_stop_pips;
    const finalTrailingStopPercent = trailing_stop_percent || null;
    const finalUseTrailingStop = useTrailingStop || false;
    const finalUseBracketOrder = useBracketOrder || false;
    const finalUseOCOOrder = useOCOOrder || false;
    const finalUseOTOOrder = useOTOOrder || false;
    const finalExtendedHours = extended_hours || extendedHours || false;
    const finalUseFractional = useFractional !== undefined ? useFractional : false;

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

      // Check if we should use fractional orders (Alpaca only, for small positions or when explicitly requested)
      const isAlpaca = this.api.exchangeName === 'alpaca';
      const shouldUseFractional = isAlpaca && (finalUseFractional || finalTradeAmount < 100); // Use fractional for < $100 or if explicitly requested

      // Step 5: Place entry order (exchange will use its max leverage setting)
      let orderResult;
      let stopLossOrderId = null;
      let takeProfitOrderId = null;
      let stopLossType = 'REGULAR';
      
      // Check if we should use bracket order (Alpaca only, when both TP and SL are provided)
      if (isAlpaca && finalUseBracketOrder && finalStopLoss && finalTakeProfit) {
        const stopPrice = calculateStopLoss(side, entryPrice, finalStopLoss);
        const tpPrice = calculateTakeProfit(side, entryPrice, finalTakeProfit);
        const roundedStopPrice = roundPrice(stopPrice);
        const roundedTpPrice = roundPrice(tpPrice);
        
        logger.info('Using Alpaca bracket order (entry + TP + SL in one order)');
        
        // Bracket orders can use either qty or notional
        // Note: Bracket orders don't support notional directly, so we calculate qty from notional if needed
        const bracketQty = shouldUseFractional ? (finalTradeAmount / entryPrice).toFixed(9) : roundedQuantity;
        const bracketResult = await this.api.placeBracketOrder(
          symbol,
          side,
          bracketQty,
          roundedTpPrice,
          roundedStopPrice,
          finalStopLossLimitPrice ? roundPrice(calculateStopLoss(side, entryPrice, finalStopLoss) - (finalStopLossLimitPrice || 0)) : null
        );
        orderResult = bracketResult;
        
        orderResult = bracketResult;
        // Bracket orders handle TP/SL internally, so we mark them as placed
        stopLossOrderId = 'bracket_sl';
        takeProfitOrderId = 'bracket_tp';
        
        logger.info('Bracket order placed successfully', {
          orderId: orderResult.orderId,
          takeProfit: roundedTpPrice,
          stopLoss: roundedStopPrice,
        });
      } else if (isAlpaca && finalUseOTOOrder && (finalStopLoss || finalTakeProfit)) {
        // Use OTO order (entry + either TP or SL)
        const entryLimitPrice = finalOrderType === 'limit' ? entryPrice : null;
        const tpPrice = finalTakeProfit ? calculateTakeProfit(side, entryPrice, finalTakeProfit) : null;
        const stopPrice = finalStopLoss ? calculateStopLoss(side, entryPrice, finalStopLoss) : null;
        
        logger.info('Using Alpaca OTO order (entry + conditional exit)');
        
        // OTO orders require quantity, not notional
        const otoQty = shouldUseFractional ? (finalTradeAmount / entryPrice).toFixed(9) : roundedQuantity;
        const otoResult = await this.api.placeOTOOrder(
          symbol,
          side,
          otoQty,
          finalOrderType,
          entryLimitPrice ? roundPrice(entryLimitPrice) : null,
          tpPrice ? roundPrice(tpPrice) : null,
          stopPrice ? roundPrice(stopPrice) : null,
          finalStopLossLimitPrice ? roundPrice(calculateStopLoss(side, entryPrice, finalStopLoss) - (finalStopLossLimitPrice || 0)) : null
        );
        
        orderResult = otoResult;
        if (finalTakeProfit) takeProfitOrderId = 'oto_tp';
        if (finalStopLoss) stopLossOrderId = 'oto_sl';
        
        logger.info('OTO order placed successfully', { orderId: orderResult.orderId });
      } else if (this.api.exchangeName === 'aster' && this.api.placeBracketOrderBatch && finalStopLoss && finalTakeProfit) {
        // Aster V3 batch bracket order: entry + TP + SL in one API call
        const stopPrice = calculateStopLoss(side, entryPrice, finalStopLoss);
        const tpPrice = calculateTakeProfit(side, entryPrice, finalTakeProfit);
        const roundedStopPrice = roundPrice(stopPrice);
        const roundedTpPrice = roundPrice(tpPrice);
        
        // Check if trailing stop is requested
        const batchOptions = {};
        if (finalUseTrailingStop && (finalTrailingStop || finalTrailingStopPercent)) {
          batchOptions.trailingCallbackRate = finalTrailingStopPercent || finalTrailingStop;
        }
        
        logger.info('Using Aster V3 batch bracket order (entry + TP + SL in one call)', {
          takeProfit: roundedTpPrice,
          stopLoss: roundedStopPrice,
          trailing: !!batchOptions.trailingCallbackRate,
        });
        
        const bracketResult = await this.api.placeBracketOrderBatch(
          symbol,
          side,
          roundedQuantity,
          roundedTpPrice,
          roundedStopPrice,
          batchOptions
        );
        
        // Extract entry order result
        orderResult = bracketResult.entryOrder || bracketResult;
        
        // Mark TP/SL as placed so we don't place them again in Step 6
        if (bracketResult.takeProfitOrder && !bracketResult.takeProfitOrder.code) {
          takeProfitOrderId = bracketResult.takeProfitOrder.orderId || 'batch_tp';
        }
        if (bracketResult.stopLossOrder && !bracketResult.stopLossOrder.code) {
          stopLossOrderId = bracketResult.stopLossOrder.orderId || 'batch_sl';
          stopLossType = batchOptions.trailingCallbackRate ? 'TRAILING' : 'REGULAR';
        }
        
        logger.info('Aster batch bracket order placed', {
          entryOrderId: orderResult?.orderId,
          takeProfitOrderId,
          stopLossOrderId,
          stopLossType,
        });
        
        // If any bracket leg failed, log warning but don't fail the trade
        // Step 6 will attempt to place missing TP/SL individually
        if (bracketResult.takeProfitOrder?.code && bracketResult.takeProfitOrder.code < 0) {
          takeProfitOrderId = null; // Will be retried in Step 6
          logger.warn(`Batch TP order failed: ${bracketResult.takeProfitOrder.msg}, will retry individually`);
        }
        if (bracketResult.stopLossOrder?.code && bracketResult.stopLossOrder.code < 0) {
          stopLossOrderId = null; // Will be retried in Step 6
          logger.warn(`Batch SL order failed: ${bracketResult.stopLossOrder.msg}, will retry individually`);
        }
      } else {
        // Standard order placement (market or limit)
        if (shouldUseFractional && isAlpaca) {
          // Use fractional order for Alpaca
          logger.info(`Using fractional order for $${finalTradeAmount}`);
          const entryLimitPrice = finalOrderType === 'limit' ? entryPrice : null;
          orderResult = await this.api.placeFractionalOrder(
            symbol,
            side,
            finalTradeAmount,
            finalOrderType,
            entryLimitPrice ? roundPrice(entryLimitPrice) : null,
            finalExtendedHours
          );
        } else if (isAlpaca && finalExtendedHours) {
          // Use extended hours order
          logger.info('Using extended hours order');
          orderResult = await this.api.placeOrderWithExtendedHours(
            symbol,
            side,
            finalOrderType,
            roundedQuantity,
            null,
            finalOrderType === 'limit' ? roundPrice(entryPrice) : null,
            true
          );
        } else {
          // Standard order
          if (finalOrderType === 'market') {
            orderResult = await this.api.placeMarketOrder(symbol, side, roundedQuantity);
          } else {
            orderResult = await this.api.placeLimitOrder(symbol, side, roundedQuantity, entryPrice);
          }
        }
      }

      logger.logTrade('opened', symbol, {
        orderId: orderResult.orderId,
        side,
        quantity: roundedQuantity,
        price: entryPrice,
      });

      // Step 6: Place stop loss and take profit (skip if already handled by bracket/OTO order)
      if (!stopLossOrderId && !takeProfitOrderId) {
        // Check if we should use OCO order (Alpaca only, for exit orders when position already exists)
        if (isAlpaca && finalUseOCOOrder && finalStopLoss && finalTakeProfit) {
          const stopPrice = calculateStopLoss(side, entryPrice, finalStopLoss);
          const tpPrice = calculateTakeProfit(side, entryPrice, finalTakeProfit);
          const roundedStopPrice = roundPrice(stopPrice);
          const roundedTpPrice = roundPrice(tpPrice);
          const exitSide = getOppositeSide(side);
          
          logger.info('Using Alpaca OCO order (TP or SL, not both)');
          
          const ocoResult = await this.api.placeOCOOrder(
            symbol,
            exitSide,
            roundedQuantity,
            roundedTpPrice,
            roundedStopPrice,
            finalStopLossLimitPrice ? roundPrice(calculateStopLoss(side, entryPrice, finalStopLoss) - (finalStopLossLimitPrice || 0)) : null
          );
          
          stopLossOrderId = 'oco_sl';
          takeProfitOrderId = 'oco_tp';
          
          logger.info('OCO order placed successfully', { orderId: ocoResult.orderId });
        } else {
          // Standard TP/SL placement
          
          // Step 6a: Place stop loss (regular, trailing, or stop-limit)
          if (finalStopLoss || finalTrailingStop) {
            try {
              // Check if we want trailing stop (OANDA, Alpaca, or Aster)
              const isOanda = this.api.exchangeName === 'oanda';
              const isAster = this.api.exchangeName === 'aster';
              const useTrailing = (isOanda || isAlpaca || isAster) && (finalUseTrailingStop || finalTrailingStop || finalTrailingStopPercent);
              
              if (useTrailing && (finalTrailingStop || finalTrailingStopPercent)) {
                // Place trailing stop (OANDA uses pips, Alpaca uses $ or %)
                if (isOanda && finalTrailingStop) {
                  // OANDA trailing stop (pips)
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
                } else if (isAlpaca && (finalTrailingStop || finalTrailingStopPercent)) {
                  // Alpaca trailing stop ($ or %)
                  const trailPrice = finalTrailingStop ? parseFloat(finalTrailingStop) : null;
                  const trailPercent = finalTrailingStopPercent ? parseFloat(finalTrailingStopPercent) : null;
                  
                  const stopLossResult = await this.api.placeTrailingStopLoss(
                    symbol,
                    getOppositeSide(side),
                    roundedQuantity,
                    trailPrice,
                    trailPercent,
                    'day' // Alpaca trailing stops use 'day' or 'gtc'
                  );

                  stopLossOrderId = stopLossResult.orderId;
                  stopLossType = 'TRAILING';
                  
                  logger.info(`Alpaca trailing stop placed`, {
                    orderId: stopLossOrderId,
                    trailPrice,
                    trailPercent,
                    type: 'TRAILING',
                  });
                } else if (isAster && (finalTrailingStop || finalTrailingStopPercent)) {
                  // Aster trailing stop (callback rate in percent, e.g., 1 = 1%)
                  const callbackRate = finalTrailingStopPercent || finalTrailingStop;
                  
                  const stopLossResult = await this.api.placeTrailingStop(
                    symbol,
                    getOppositeSide(side),
                    roundedQuantity,
                    callbackRate
                  );

                  stopLossOrderId = stopLossResult.orderId;
                  stopLossType = 'TRAILING';
                  
                  logger.info(`Aster trailing stop placed`, {
                    orderId: stopLossOrderId,
                    callbackRate,
                    type: 'TRAILING',
                  });
                }
              } else if (finalStopLoss) {
                // Place regular stop loss or stop-limit
                const stopPrice = calculateStopLoss(side, entryPrice, finalStopLoss);
                const roundedStopPrice = roundPrice(stopPrice);
                const stopSide = getOppositeSide(side);
                
                // Calculate stop-limit price if provided (Alpaca only)
                let stopLimitPrice = null;
                if (isAlpaca && finalStopLossLimitPrice) {
                  // stop_loss_limit_price is the offset from stop price
                  stopLimitPrice = roundPrice(stopPrice - (finalStopLossLimitPrice || 0));
                }

                // Call placeStopLoss - only pass limitPrice for Alpaca (5th parameter)
                let stopLossResult;
                if (isAlpaca && stopLimitPrice) {
                  // Alpaca supports stop-limit orders (5th parameter)
                  stopLossResult = await this.api.placeStopLoss(
                    symbol,
                    stopSide,
                    roundedQuantity,
                    roundedStopPrice,
                    stopLimitPrice
                  );
                } else {
                  // Standard stop loss for all other exchanges (4 parameters)
                  stopLossResult = await this.api.placeStopLoss(
                    symbol,
                    stopSide,
                    roundedQuantity,
                    roundedStopPrice
                  );
                }

                stopLossOrderId = stopLossResult.orderId;
                stopLossType = stopLimitPrice ? 'STOP_LIMIT' : 'REGULAR';
                
                const dollarLoss = (finalTradeAmount * finalStopLoss / 100).toFixed(2);
                
                logger.info(`Stop loss placed at ${roundedStopPrice}`, {
                  orderId: stopLossOrderId,
                  percent: finalStopLoss,
                  dollarAmount: `$${dollarLoss}`,
                  type: stopLossType,
                  limitPrice: stopLimitPrice,
                });
              }
            } catch (error) {
              logger.logError('Failed to place stop loss', error, { symbol });
              // Don't fail the entire trade if stop loss fails, but log it prominently
            }
          }

          // Step 6b: Place take profit (optional)
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
        trailingStopDistance: finalTrailingStop || finalTrailingStopPercent,
        trailingStopPercent: finalTrailingStopPercent,
        stopLossLimitPrice: finalStopLossLimitPrice,
        extendedHours: finalExtendedHours,
        useFractional: shouldUseFractional,
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
   * @param {Number} sellPercentage - Percentage to close (1-100, default 100 for full close)
   */
  async closePosition(symbol, strategy = null, userId = null, sellPercentage = 100) {
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
      const fullQuantity = Math.abs(positionAmt);
      
      // PHASE 2: Calculate quantity based on sell percentage
      let sellPct = parseFloat(sellPercentage) || 100;
      
      // Validate sell percentage (must be between 0.1 and 100)
      if (sellPct < 0.1 || sellPct > 100) {
        logger.warn(`Invalid sell_percentage: ${sellPct}%. Using 100% (full close).`);
        sellPct = 100;
      }
      
      let quantity = fullQuantity;
      let isPartialClose = false;
      
      if (sellPct < 100 && sellPct > 0) {
        // Partial close: calculate quantity to close
        quantity = Math.floor((fullQuantity * sellPct) / 100);
        
        // Ensure at least 1 unit is closed
        if (quantity === 0) {
          quantity = 1;
          logger.warn(`Calculated 0 quantity for ${sellPct}% of ${fullQuantity}. Using minimum of 1 unit.`);
        }
        
        isPartialClose = true;
        logger.info(`📉 Partial close: Closing ${quantity} of ${fullQuantity} units (${sellPct}%) for ${symbol}`, {
          fullQuantity,
          closeQuantity: quantity,
          percentage: sellPct,
          remainingQuantity: fullQuantity - quantity
        });
      } else {
        // Full close (default behavior)
        quantity = fullQuantity;
        logger.info(`Closing full position: ${quantity} units for ${symbol}`);
      }
      
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
        const isAsterExchange = this.api.exchangeName === 'aster';
        
        if (isAsterExchange && this.api.cancelAllOrders) {
          // For Aster: cancel ALL open orders for this symbol at once.
          // This is more robust than individual cancels because:
          // 1. One side (TP or SL) may have already filled, causing individual cancel to fail
          // 2. Batch-placed orders may use different IDs than tracked
          // 3. Catches any orphaned orders from previous trades
          try {
            await this.api.cancelAllOrders(symbol);
            logger.info(`Cancelled all open orders for ${symbol} (Aster cleanup)`);
          } catch (error) {
            logger.logError('Failed to cancel all orders', error, { symbol });
          }
        } else {
          // For other exchanges: cancel individual TP/SL orders
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

      // PHASE 2: Only remove position if fully closed
      if (quantity >= fullQuantity || sellPct >= 100) {
        // Full close: remove position from database and tracker
        await removePosition(symbol, userId);
        this.tracker.removePosition(symbol, this.exchange);
        logger.info(`✅ Position fully closed and removed for ${symbol}`, {
          quantity,
          pnl: `$${pnlUsd.toFixed(2)}`
        });
      } else {
        // Partial close: update position quantity in tracker (don't remove)
        // The position tracker and database will be updated with remaining quantity
        // Note: This assumes the exchange API properly handles partial closes
        // If your exchange updates position automatically, this may not be needed
        const remainingQty = fullQuantity - quantity;
        logger.info(`✅ Partial close completed for ${symbol}`, {
          closedQuantity: quantity,
          remainingQuantity: remainingQty,
          percentage: `${sellPct}%`,
          pnl: `$${pnlUsd.toFixed(2)}`
        });
        // Position will still be tracked with reduced quantity after exchange processes the close
      }

      logger.info(`Position close successful for ${symbol}: ${isPartialClose ? 'Partial' : 'Full'} close with P&L: $${pnlUsd.toFixed(2)}`);

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

