const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class AsterAPI {
  constructor(apiKey, apiSecret, apiUrl) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiUrl = apiUrl;
    this.exchangeName = 'aster';
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Generate HMAC signature for authentication
   * Signature is based on query string parameters as per Aster API docs
   */
  generateSignature(queryString) {
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
    
    return signature;
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    const timestamp = Date.now();
    
    // Build query parameters - ALL parameters must be in query string for signature
    let queryParams = '';
    
    // Add data parameters first (if any)
    if (data) {
      const dataParams = new URLSearchParams(data).toString();
      queryParams = dataParams;
    }
    
    // Add timestamp (always required)
    if (queryParams) {
      queryParams += `&timestamp=${timestamp}`;
    } else {
      queryParams = `timestamp=${timestamp}`;
    }
    
    // Generate signature from ALL query parameters
    const signature = this.generateSignature(queryParams);
    queryParams += `&signature=${signature}`;
    
    const headers = {
      'X-MBX-APIKEY': this.apiKey,
      'Content-Type': 'application/json',
    };

    const config = {
      method,
      url: `${this.apiUrl}${endpoint}?${queryParams}`,
      headers,
    };

    // Note: For Binance-style APIs, all params go in query string, not body
    // The body should be empty even for POST requests

    try {
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      logger.logApiCall(method, endpoint, response.status, duration);
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response) {
        logger.logError('API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
          logger.info(`Retrying request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Network error', error, { method, endpoint, duration });
        
        // Retry on network errors
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== Account Methods ====================

  /**
   * Get account balance
   */
  async getBalance() {
    return this.makeRequest('GET', '/fapi/v2/balance');
  }

  /**
   * Get available margin
   */
  async getAvailableMargin() {
    const balances = await this.getBalance();
    const usdtBalance = balances.find(b => b.asset === 'USDT');
    
    if (!usdtBalance) {
      throw new Error('USDT balance not found');
    }
    
    return parseFloat(usdtBalance.availableBalance);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    return this.makeRequest('GET', '/fapi/v2/positionRisk');
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
    return this.makeRequest('GET', '/fapi/v1/ticker/price', { symbol });
  }

  /**
   * Get klines (candles) for a symbol
   * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
   * @param {string} interval - Kline interval (1m, 5m, 15m, 1h, 4h, 1d)
   * @param {number} limit - Number of candles to return (default 100, max 1000)
   * @returns {Promise<Array>} Array of kline arrays [timestamp, open, high, low, close, volume, ...]
   */
  async getKlines(symbol, interval = '1m', limit = 100) {
    const params = {
      symbol,
      interval,
      limit: Math.min(limit, 1000) // Cap at 1000
    };
    
    const response = await this.makeRequest('GET', '/fapi/v1/klines', params);
    return response || [];
  }

  // ==================== Order Methods ====================

  /**
   * Set leverage for a symbol
   */
  async setLeverage(symbol, leverage) {
    logger.info(`Setting leverage for ${symbol} to ${leverage}x`);
    return this.makeRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
  }

  /**
   * Place an order
   */
  async placeOrder(orderData) {
    logger.info('Placing order', orderData);
    return this.makeRequest('POST', '/fapi/v1/order', orderData);
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: quantity.toString(),
    };
    
    return this.placeOrder(orderData);
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'LIMIT',
      quantity: quantity.toString(),
      price: price.toString(),
      timeInForce: 'GTC', // Good Till Cancel
    };
    
    return this.placeOrder(orderData);
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'STOP_MARKET',
      stopPrice: stopPrice.toString(),
      quantity: quantity.toString(),
      reduceOnly: true,
    };
    
    logger.info('Placing stop loss', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Place take profit order
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: takeProfitPrice.toString(),
      quantity: quantity.toString(),
      reduceOnly: true,
    };
    
    logger.info('Placing take profit', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Close position (market order with reduceOnly)
   */
  async closePosition(symbol, side, quantity) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: quantity.toString(),
      reduceOnly: true,
    };
    
    logger.info('Closing position', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling order', { symbol, orderId });
    return this.makeRequest('DELETE', '/fapi/v1/order', { symbol, orderId });
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/fapi/v1/order?symbol=${symbol}&orderId=${orderId}`);
  }
}

module.exports = AsterAPI;

