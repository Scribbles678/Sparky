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
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const units = side.toUpperCase() === 'BUY' ? quantity : -quantity;
    
    const orderData = {
      order: {
        type: 'MARKET',
        instrument: symbol,
        units: units.toString(),
        timeInForce: 'FOK', // Fill or Kill
        positionFill: 'DEFAULT',
      }
    };
    
    logger.info('Placing OANDA market order', orderData);
    const response = await this.makeRequest('POST', `/v3/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.orderFillTransaction?.id || response.orderCreateTransaction?.id,
      status: 'FILLED',
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
   * Place stop loss order
   * In OANDA, this is done by modifying the trade with stopLossOnFill
   * For now, we'll create a STOP order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    // Get the trade ID for this instrument
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);
    
    if (!position) {
      throw new Error(`No position found for ${symbol} to attach stop loss`);
    }
    
    // OANDA uses negative units for short positions
    const units = side.toUpperCase() === 'BUY' ? -quantity : quantity;
    
    const orderData = {
      order: {
        type: 'STOP',
        instrument: symbol,
        units: units.toString(),
        price: stopPrice.toString(),
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
   * Place trailing stop loss order (OANDA native)
   * @param {string} symbol - Trading symbol
   * @param {string} side - BUY or SELL
   * @param {number} quantity - Position size
   * @param {number} distance - Trailing distance in pips
   * @param {string} timeInForce - GTC, GTD, or FOK
   */
  async placeTrailingStopLoss(symbol, side, quantity, distance, timeInForce = 'GTC') {
    // OANDA uses negative units for short positions
    const units = side.toUpperCase() === 'BUY' ? -quantity : quantity;
    
    const orderData = {
      order: {
        type: 'TRAILING_STOP_IF_DONE',
        instrument: symbol,
        units: units.toString(),
        distance: distance.toString(),
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
   * Place take profit order
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);
    
    if (!position) {
      throw new Error(`No position found for ${symbol} to attach take profit`);
    }
    
    const units = side.toUpperCase() === 'BUY' ? -quantity : quantity;
    
    const orderData = {
      order: {
        type: 'LIMIT',
        instrument: symbol,
        units: units.toString(),
        price: takeProfitPrice.toString(),
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
    // In OANDA, we close by placing an opposite market order
    const units = side.toUpperCase() === 'BUY' ? -quantity : quantity;
    
    const orderData = {
      order: {
        type: 'MARKET',
        instrument: symbol,
        units: units.toString(),
        timeInForce: 'FOK',
        positionFill: 'REDUCE_ONLY',
      }
    };
    
    logger.info('Closing OANDA position', orderData);
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

