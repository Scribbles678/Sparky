const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class OandaAPI extends BaseExchangeAPI {
  constructor(accountId, accessToken, environment = 'practice') {
    super({ accountId, accessToken, environment });
    this.accountId = accountId;
    this.accessToken = accessToken;
    this.environment = environment;
    this.exchangeName = 'oanda';
    
    // Set API URL based on environment
    this.apiUrl = environment === 'live' 
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

    const config = {
      method,
      url: `${this.apiUrl}${endpoint}`,
      headers,
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      logger.logApiCall(method, endpoint, response.status, duration);
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response) {
        logger.logError('OANDA API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying OANDA request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('OANDA network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying OANDA request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  // ==================== Account Methods ====================

  /**
   * Get account summary
   */
  async getAccountSummary() {
    return this.makeRequest('GET', `/v3/accounts/${this.accountId}/summary`);
  }

  /**
   * Get account balance
   */
  async getBalance() {
    const summary = await this.getAccountSummary();
    return [{
      asset: summary.account.currency,
      availableBalance: parseFloat(summary.account.balance),
      balance: parseFloat(summary.account.balance),
    }];
  }

  /**
   * Get available margin
   */
  async getAvailableMargin() {
    const summary = await this.getAccountSummary();
    return parseFloat(summary.account.marginAvailable);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const response = await this.makeRequest('GET', `/v3/accounts/${this.accountId}/openPositions`);
    
    // Convert OANDA positions to common format
    return response.positions.map(pos => {
      const long = pos.long;
      const short = pos.short;
      const units = parseFloat(long.units) + parseFloat(short.units);
      
      return {
        symbol: pos.instrument,
        positionAmt: units.toString(),
        entryPrice: units > 0 ? long.averagePrice : short.averagePrice,
        markPrice: null, // Will be fetched separately if needed
        unRealizedProfit: parseFloat(pos.unrealizedPL),
      };
    });
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
    
    return position || null;
  }

  /**
   * Check if position exists for symbol
   */
  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null;
  }

  // ==================== Market Data Methods ====================

  /**
   * Get current ticker price for a symbol
   */
  async getTicker(symbol) {
    const response = await this.makeRequest('GET', `/v3/accounts/${this.accountId}/pricing?instruments=${symbol}`);
    
    if (!response.prices || response.prices.length === 0) {
      throw new Error(`No price data for ${symbol}`);
    }
    
    const price = response.prices[0];
    const midPrice = (parseFloat(price.bids[0].price) + parseFloat(price.asks[0].price)) / 2;
    
    return {
      symbol: price.instrument,
      price: midPrice.toString(),
      lastPrice: midPrice.toString(),
    };
  }

  // ==================== Order Methods ====================

  /**
   * Place market order with optional native TP/SL brackets
   * @param {string} symbol - Instrument name (e.g., EUR_USD)
   * @param {string} side - BUY or SELL
   * @param {number} quantity - Position size in units
   * @param {Object} [options] - Optional bracket order parameters
   * @param {number} [options.stopLossPrice] - Stop loss price (5 decimal places)
   * @param {number} [options.takeProfitPrice] - Take profit price (5 decimal places)
   * @param {number} [options.trailingStopDistance] - Trailing stop distance in price units (e.g., 0.0030 for 30 pips)
   */
  async placeMarketOrder(symbol, side, quantity, options = {}) {
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const order = {
      type: 'MARKET',
      instrument: symbol,
      units: units.toString(),
      timeInForce: 'FOK', // Fill or Kill
      positionFill: 'DEFAULT',
    };
    
    // Attach native TP/SL/trailing brackets to the order (OANDA best practice)
    // Note: OANDA allows either stopLossOnFill OR trailingStopLossOnFill, not both
    if (options.trailingStopDistance) {
      // Trailing stop takes priority over fixed stop loss
      order.trailingStopLossOnFill = {
        distance: options.trailingStopDistance.toFixed(5),
        timeInForce: 'GTC',
      };
    } else if (options.stopLossPrice) {
      order.stopLossOnFill = {
        price: options.stopLossPrice.toFixed(5),
        timeInForce: 'GTC',
      };
    }
    if (options.takeProfitPrice) {
      order.takeProfitOnFill = {
        price: options.takeProfitPrice.toFixed(5),
        timeInForce: 'GTC',
      };
    }
    
    const orderData = { order };
    
    logger.info('Placing OANDA market order', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderFillTransaction?.id || response.orderCreateTransaction?.id,
      status: 'FILLED',
      stopLossOrderId: response.orderFillTransaction?.tradeOpened?.stopLossOrderID || null,
      takeProfitOrderId: response.orderFillTransaction?.tradeOpened?.takeProfitOrderID || null,
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const orderData = {
      order: {
        type: 'LIMIT',
        instrument: symbol,
        units: units.toString(),
        price: price.toString(),
        timeInForce: 'GTC',
        positionFill: 'DEFAULT',
      }
    };
    
    logger.info('Placing OANDA limit order', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderCreateTransaction?.id,
      status: 'NEW',
    };
  }

  /**
   * Place stop loss order as a separate STOP order.
   * Note: Prefer using placeMarketOrder with options.stopLossPrice for native brackets.
   * @param {string} side - The exit side (SELL to close a long, BUY to close a short)
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    // side is the EXIT side: SELL to close a long, BUY to close a short
    // OANDA: positive units = BUY, negative units = SELL
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const orderData = {
      order: {
        type: 'STOP',
        instrument: symbol,
        units: units.toString(),
        price: stopPrice.toFixed(5),
        timeInForce: 'GTC',
        positionFill: 'REDUCE_ONLY',
      }
    };
    
    logger.info('Placing OANDA stop loss', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderCreateTransaction?.id,
      status: 'NEW',
    };
  }

  /**
   * Place trailing stop loss order (OANDA native).
   * Prefer using placeMarketOrder with options.trailingStopDistance for native brackets.
   * @param {string} symbol - Trading symbol
   * @param {string} side - The exit side (SELL to close a long, BUY to close a short)
   * @param {number} quantity - Position size
   * @param {number} distance - Trailing distance in price units (e.g., 0.0030 for 30 pips on EUR/USD)
   * @param {string} timeInForce - GTC, GTD, or FOK
   */
  async placeTrailingStopLoss(symbol, side, quantity, distance, timeInForce = 'GTC') {
    // side is the EXIT side: SELL to close a long, BUY to close a short
    // OANDA: positive units = BUY, negative units = SELL
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const orderData = {
      order: {
        type: 'TRAILING_STOP_LOSS',
        instrument: symbol,
        units: units.toString(),
        distance: distance.toFixed(5),
        timeInForce: timeInForce,
        positionFill: 'REDUCE_ONLY',
        triggerCondition: 'DEFAULT',
      }
    };
    
    logger.info('Placing OANDA trailing stop loss', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderCreateTransaction?.id,
      status: 'NEW',
      type: 'TRAILING_STOP',
    };
  }

  /**
   * Place take profit order as a separate LIMIT order.
   * Note: Prefer using placeMarketOrder with options.takeProfitPrice for native brackets.
   * @param {string} side - The exit side (SELL to close a long, BUY to close a short)
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // side is the EXIT side: SELL to close a long, BUY to close a short
    // OANDA: positive units = BUY, negative units = SELL
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const orderData = {
      order: {
        type: 'LIMIT',
        instrument: symbol,
        units: units.toString(),
        price: takeProfitPrice.toFixed(5),
        timeInForce: 'GTC',
        positionFill: 'REDUCE_ONLY',
      }
    };
    
    logger.info('Placing OANDA take profit', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderCreateTransaction?.id,
      status: 'NEW',
    };
  }

  /**
   * Close position (market order with opposite side)
   */
  async closePosition(symbol, side, quantity) {
    // In OANDA, to close a position:
    // - Long position (positive units): place SELL order with NEGATIVE units
    // - Short position (negative units): place BUY order with POSITIVE units
    // The 'side' parameter is the opposite side needed to close
    // If side is 'SELL' (closing a long), we need negative units
    // If side is 'BUY' (closing a short), we need positive units
    const units = side.toUpperCase() === 'SELL' ? -quantity : quantity;
    
    const orderData = {
      order: {
        type: 'MARKET',
        instrument: symbol,
        units: units.toString(),
        timeInForce: 'FOK',
        positionFill: 'REDUCE_ONLY',
      }
    };
    
    logger.info('Closing OANDA position', { symbol, side, quantity, units, orderData });
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderFillTransaction?.id || response.orderCreateTransaction?.id,
      status: 'FILLED',
    };
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling OANDA order', { symbol, orderId });
    const response = await this.makeRequest('PUT', `/v3/accounts/${this.accountId}/orders/${orderId}/cancel`);
    
    return {
      orderId: response.orderCancelTransaction?.orderID,
      status: 'CANCELED',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/v3/accounts/${this.accountId}/orders/${orderId}`);
  }
}

module.exports = OandaAPI;

