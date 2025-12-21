const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class Trading212API extends BaseExchangeAPI {
  constructor(apiKey, apiSecret, environment = 'production') {
    super({ apiKey, apiSecret, environment });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.environment = environment;
    this.exchangeName = 'trading212';
    
    // Base URLs
    if (environment === 'demo' || environment === 'sandbox' || environment === 'paper') {
      this.baseUrl = 'https://demo.trading212.com/api/v0';
    } else {
      this.baseUrl = 'https://live.trading212.com/api/v0';
    }
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Generate HTTP Basic Auth header
   */
  getAuthHeader() {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Convert standard symbol to Trading212 ticker format
   * Format: {SYMBOL}_{COUNTRY}_{TYPE}
   * Default: {SYMBOL}_US_EQ (US Equity)
   */
  toTrading212Ticker(symbol) {
    // If already in Trading212 format, return as-is
    if (symbol.includes('_') && symbol.includes('_EQ')) {
      return symbol.toUpperCase();
    }
    
    // Default: Assume US equity
    // Format: {SYMBOL}_US_EQ
    // Note: This may need adjustment for other markets (UK, EU, etc.)
    // For accurate mapping, use /api/v0/equity/metadata/instruments endpoint
    return `${symbol.toUpperCase()}_US_EQ`;
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const config = {
      method,
      url: `${this.baseUrl}${endpoint}`,
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
        const statusCode = error.response.status;
        logger.logError('Trading212 API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          // Check rate limit reset header if available
          let delay = this.retryDelay * Math.pow(2, retryCount);
          if (error.response.headers['x-ratelimit-reset']) {
            const resetTime = parseInt(error.response.headers['x-ratelimit-reset']);
            const now = Math.floor(Date.now() / 1000);
            delay = Math.max(delay, (resetTime - now) * 1000);
          }
          
          logger.info(`Retrying Trading212 request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Trading212 network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Trading212 request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  // ==================== Account Methods ====================

  /**
   * Get account balance
   * Uses /equity/account/cash endpoint which provides detailed cash breakdown
   */
  async getBalance() {
    const cashResponse = await this.makeRequest('GET', '/equity/account/cash');
    const infoResponse = await this.makeRequest('GET', '/equity/account/info');
    
    const currency = infoResponse.currencyCode || 'USD';
    const free = parseFloat(cashResponse.free || 0);
    const total = parseFloat(cashResponse.total || 0);
    
    return [{
      asset: currency,
      availableBalance: free,
      balance: total,
    }];
  }

  /**
   * Get available margin (free cash)
   */
  async getAvailableMargin() {
    const balance = await this.getBalance();
    return balance[0]?.availableBalance || 0;
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   * Uses /equity/portfolio endpoint (not /equity/positions)
   */
  async getPositions() {
    const positions = await this.makeRequest('GET', '/equity/portfolio');
    
    // Trading212 returns array directly
    if (!Array.isArray(positions)) {
      return [];
    }
    
    return positions.map(pos => ({
      symbol: pos.ticker || pos.symbol,
      positionAmt: pos.quantity?.toString() || '0',
      entryPrice: parseFloat(pos.averagePrice || pos.average_price || 0),
      markPrice: parseFloat(pos.currentPrice || pos.current_price || 0),
      unRealizedProfit: parseFloat(pos.ppl || pos.pnl || pos.profit || 0),
    }));
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const ticker = this.toTrading212Ticker(symbol);
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === ticker || p.symbol === symbol);
    
    if (!position || parseFloat(position.positionAmt) === 0) {
      return null;
    }
    
    return position;
  }

  /**
   * Check if position exists for symbol
   */
  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null && parseFloat(position.positionAmt) !== 0;
  }

  // ==================== Market Data Methods ====================

  /**
   * Get current ticker price for a symbol
   * 
   * ⚠️ LIMITATION: Trading212 API does not provide a direct market data/ticker endpoint.
   * This method attempts to get price from position data if available.
   */
  async getTicker(symbol) {
    // Try to get price from position if we have one
    const position = await this.getPosition(symbol);
    if (position && position.markPrice && position.markPrice > 0) {
      return {
        symbol: symbol,
        price: position.markPrice.toString(),
        lastPrice: position.markPrice.toString(),
      };
    }
    
    // Otherwise, throw error indicating market data not available
    throw new Error(
      `Market data not available for ${symbol}. ` +
      `Trading212 API does not provide ticker endpoint in beta version. ` +
      `Use external data source or check position data.`
    );
  }

  // ==================== Order Methods ====================

  /**
   * Place market order
   * 
   * Note: Trading212 uses negative quantity for sell orders
   * - Buy: positive quantity (e.g., 10.5)
   * - Sell: negative quantity (e.g., -10.5)
   */
  async placeMarketOrder(symbol, side, quantity) {
    const ticker = this.toTrading212Ticker(symbol);
    
    // Trading212 uses negative quantity for sell orders
    const orderQuantity = side.toLowerCase() === 'sell' 
      ? -Math.abs(quantity) 
      : Math.abs(quantity);
    
    const orderData = {
      ticker: ticker,
      quantity: orderQuantity,
      extendedHours: false, // Can be set to true for extended hours trading
    };
    
    logger.info('Placing Trading212 market order', { symbol, ticker, side, quantity, orderQuantity });
    const response = await this.makeRequest('POST', '/equity/orders/market', orderData);
    
    return {
      orderId: response.id?.toString() || response.orderId?.toString(),
      status: response.status || 'pending',
    };
  }

  /**
   * Place limit order
   * 
   * ⚠️ LIMITATION: Only available in Demo environment.
   * Live trading does not support limit orders (only market orders).
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Order quantity
   * @param {number} price - Limit price
   * @param {string} timeValidity - 'DAY' or 'GOOD_TILL_CANCEL' (default: 'DAY')
   */
  async placeLimitOrder(symbol, side, quantity, price, timeValidity = 'DAY') {
    // Check if live environment
    if (this.environment === 'production' || this.environment === 'live') {
      throw new Error(
        'Limit orders are not supported in live trading. ' +
        'Trading212 only supports Market Orders in live environment. ' +
        'Use demo environment for limit orders.'
      );
    }
    
    const ticker = this.toTrading212Ticker(symbol);
    
    // Trading212 uses negative quantity for sell orders
    const orderQuantity = side.toLowerCase() === 'sell' 
      ? -Math.abs(quantity) 
      : Math.abs(quantity);
    
    // Validate timeValidity
    if (timeValidity !== 'DAY' && timeValidity !== 'GOOD_TILL_CANCEL') {
      timeValidity = 'DAY';
    }
    
    const orderData = {
      ticker: ticker,
      quantity: orderQuantity,
      limitPrice: parseFloat(price),
      timeValidity: timeValidity,
    };
    
    logger.info('Placing Trading212 limit order', { symbol, ticker, side, quantity, orderQuantity, price, timeValidity });
    const response = await this.makeRequest('POST', '/equity/orders/limit', orderData);
    
    return {
      orderId: response.id?.toString() || response.orderId?.toString(),
      status: response.status || 'pending',
    };
  }

  /**
   * Place stop loss order
   * 
   * ⚠️ LIMITATION: Only available in Demo environment.
   * Live trading does not support stop orders (only market orders).
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Order quantity
   * @param {number} stopPrice - Stop price trigger
   * @param {number} limitPrice - Optional limit price (creates stop-limit order)
   * @param {string} timeValidity - 'DAY' or 'GOOD_TILL_CANCEL' (default: 'DAY')
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null, timeValidity = 'DAY') {
    // Check if live environment
    if (this.environment === 'production' || this.environment === 'live') {
      throw new Error(
        'Stop orders are not supported in live trading. ' +
        'Trading212 only supports Market Orders in live environment. ' +
        'Use demo environment for stop orders.'
      );
    }
    
    const ticker = this.toTrading212Ticker(symbol);
    
    // Trading212 uses negative quantity for sell orders
    const orderQuantity = side.toLowerCase() === 'sell' 
      ? -Math.abs(quantity) 
      : Math.abs(quantity);
    
    // Validate timeValidity
    if (timeValidity !== 'DAY' && timeValidity !== 'GOOD_TILL_CANCEL') {
      timeValidity = 'DAY';
    }
    
    // If limitPrice provided, use stop-limit order
    if (limitPrice) {
      const orderData = {
        ticker: ticker,
        quantity: orderQuantity,
        stopPrice: parseFloat(stopPrice),
        limitPrice: parseFloat(limitPrice),
        timeValidity: timeValidity,
      };
      
      logger.info('Placing Trading212 stop-limit order', { symbol, ticker, side, quantity, orderQuantity, stopPrice, limitPrice, timeValidity });
      const response = await this.makeRequest('POST', '/equity/orders/stop_limit', orderData);
      
      return {
        orderId: response.id?.toString() || response.orderId?.toString(),
        status: response.status || 'pending',
      };
    }
    
    // Otherwise, use stop order
    const orderData = {
      ticker: ticker,
      quantity: orderQuantity,
      stopPrice: parseFloat(stopPrice),
      timeValidity: timeValidity,
    };
    
    logger.info('Placing Trading212 stop order', { symbol, ticker, side, quantity, orderQuantity, stopPrice, timeValidity });
    const response = await this.makeRequest('POST', '/equity/orders/stop', orderData);
    
    return {
      orderId: response.id?.toString() || response.orderId?.toString(),
      status: response.status || 'pending',
    };
  }

  /**
   * Place take profit order (limit order to close position)
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // Take profit is a limit order with opposite side
    const oppositeSide = side.toLowerCase() === 'buy' ? 'sell' : 'buy';
    
    return this.placeLimitOrder(symbol, oppositeSide, quantity, takeProfitPrice);
  }

  /**
   * Close position (sell/buy opposite)
   */
  async closePosition(symbol, side, quantity) {
    // Get current position to determine actual side
    const position = await this.getPosition(symbol);
    
    if (!position) {
      throw new Error(`No position found for ${symbol}`);
    }
    
    // Determine close side based on position
    // If position is long (positive qty), we need to sell (negative qty)
    // If position is short (negative qty), we need to buy (positive qty)
    const positionQty = parseFloat(position.positionAmt);
    const closeSide = positionQty > 0 ? 'sell' : 'buy';
    const closeQty = Math.min(Math.abs(quantity), Math.abs(positionQty));
    
    return this.placeMarketOrder(symbol, closeSide, closeQty);
  }

  /**
   * Cancel order
   * 
   * ⚠️ LIMITATION: Cancel orders may not be available for real money accounts.
   * Returns 400 error if not available for live accounts.
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Trading212 order', { symbol, orderId });
    
    try {
      await this.makeRequest('DELETE', `/equity/orders/${orderId}`);
      return {
        orderId: orderId.toString(),
        status: 'canceled',
      };
    } catch (error) {
      if (error.response && error.response.status === 400) {
        throw new Error('Cancel orders are not available for real money accounts');
      }
      throw error;
    }
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/equity/orders/${orderId}`);
  }
}

module.exports = Trading212API;
