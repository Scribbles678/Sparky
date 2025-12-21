const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class LimeAPI extends BaseExchangeAPI {
  constructor(clientId, clientSecret, username, password, accountNumber = null, environment = 'production') {
    super({ clientId, clientSecret, username, password, accountNumber, environment });
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.accountNumber = accountNumber;
    this.environment = environment;
    this.exchangeName = 'lime';
    
    // Base URLs
    this.apiUrl = 'https://api.lime.co';
    this.authUrl = 'https://auth.lime.co';
    
    // Token management
    this.accessToken = null;
    this.tokenExpiresAt = null; // Timestamp for next 3 AM ET expiration
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Calculate next 3:00 AM ET expiration time
   * Tokens expire at 3:00 AM ET daily (not prolonged with usage)
   * 
   * Note: ET is UTC-5 (EST) or UTC-4 (EDT) depending on DST
   * For simplicity, using UTC-5 (EST). Can be enhanced to handle DST.
   */
  getNext3AMET() {
    const now = new Date();
    
    // ET is UTC-5 (EST) or UTC-4 (EDT)
    // Using UTC-5 for simplicity (EST)
    // 3:00 AM ET = 8:00 AM UTC (during EST)
    const threeAMUTC = 8; // 3 AM ET = 8 AM UTC (EST)
    
    // Create date for 3 AM ET today (8 AM UTC)
    const threeAMToday = new Date(now);
    threeAMToday.setUTCHours(threeAMUTC, 0, 0, 0);
    threeAMToday.setUTCMinutes(0);
    threeAMToday.setUTCSeconds(0);
    threeAMToday.setUTCMilliseconds(0);
    
    // If 3 AM ET has already passed today, set to tomorrow
    if (threeAMToday.getTime() <= now.getTime()) {
      threeAMToday.setUTCDate(threeAMToday.getUTCDate() + 1);
    }
    
    return threeAMToday.getTime();
  }

  /**
   * Get or refresh OAuth 2.0 access token
   * Token expires at 3:00 AM ET daily
   */
  async ensureValidToken() {
    const now = Date.now();
    const nextExpiration = this.getNext3AMET();
    
    // Refresh if no token or expires within 1 hour
    if (!this.accessToken || now >= (nextExpiration - 3600000)) {
      await this.refreshToken();
    }
  }

  /**
   * Refresh OAuth 2.0 access token using password flow
   */
  async refreshToken() {
    try {
      const response = await axios.post(
        `${this.authUrl}/connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          username: this.username,
          password: this.password,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = this.getNext3AMET();
      
      logger.info('Lime OAuth token refreshed', {
        expiresAt: new Date(this.tokenExpiresAt).toISOString(),
      });
      
      return this.accessToken;
    } catch (error) {
      logger.logError('Lime token refresh failed', error);
      
      if (error.response && error.response.status === 401) {
        throw new Error('Invalid Lime credentials. Please check your username and password.');
      }
      
      throw error;
    }
  }

  /**
   * Get default account number if not provided
   */
  async getDefaultAccountNumber() {
    if (this.accountNumber) {
      return this.accountNumber;
    }
    
    const accounts = await this.makeRequest('GET', '/accounts');
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No Lime accounts found');
    }
    
    // Use first account as default
    this.accountNumber = accounts[0].account_number;
    logger.info('Auto-detected Lime account number', { accountNumber: this.accountNumber });
    
    return this.accountNumber;
  }

  /**
   * Make authenticated API request with retry logic and token management
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    // Ensure valid token before request
    await this.ensureValidToken();
    
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
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
        const statusCode = error.response.status;
        logger.logError('Lime API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response.data,
          duration,
        });
        
        // If 401, token might be expired - refresh and retry once
        if (statusCode === 401 && retryCount === 0) {
          logger.info('Lime request failed with 401, refreshing token and retrying');
          await this.refreshToken();
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Lime request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Lime network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Lime request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
   */
  async getBalance() {
    const accounts = await this.makeRequest('GET', '/accounts');
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No Lime accounts found');
    }
    
    // Use specified account or first account
    const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
    const account = accounts.find(acc => acc.account_number === accountNumber) || accounts[0];
    
    const cash = parseFloat(account.cash || 0);
    const total = parseFloat(account.account_value_total || 0);
    
    return [{
      asset: 'USD',
      availableBalance: cash,
      balance: total,
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const accounts = await this.makeRequest('GET', '/accounts');
    
    const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
    const account = accounts.find(acc => acc.account_number === accountNumber) || accounts[0];
    
    // Use margin buying power if available, otherwise non-margin
    return parseFloat(account.margin_buying_power || account.non_margin_buying_power || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
    const positions = await this.makeRequest('GET', `/accounts/${accountNumber}/positions`);
    
    if (!Array.isArray(positions)) {
      return [];
    }
    
    return positions.map(pos => ({
      symbol: pos.symbol,
      positionAmt: pos.quantity?.toString() || '0',
      entryPrice: parseFloat(pos.average_open_price || 0),
      markPrice: parseFloat(pos.current_price || 0),
      unRealizedProfit: (parseFloat(pos.current_price || 0) - parseFloat(pos.average_open_price || 0)) * parseFloat(pos.quantity || 0),
    }));
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);
    
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
   */
  async getTicker(symbol) {
    const quote = await this.makeRequest('GET', `/marketdata/quote?symbol=${symbol}`);
    
    const lastPrice = parseFloat(quote.last || 0);
    const bid = parseFloat(quote.bid || 0);
    const ask = parseFloat(quote.ask || 0);
    
    // Use last price, or mid price if last not available
    const price = lastPrice || (bid && ask ? ((bid + ask) / 2) : bid || ask || 0);
    
    if (!price || price === 0) {
      throw new Error(`No price data available for ${symbol}`);
    }
    
    return {
      symbol: symbol,
      price: price.toString(),
      lastPrice: price.toString(),
      bid: bid.toString(),
      ask: ask.toString(),
    };
  }

  // ==================== Order Methods ====================

  /**
   * Generate client order ID (UUID-like, max 32 chars)
   */
  generateClientOrderId() {
    // Lime accepts alphanumeric, max 32 chars
    // Use timestamp + random string
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}${random}`.substring(0, 32);
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
    const clientOrderId = this.generateClientOrderId();
    
    const orderData = {
      account_number: accountNumber,
      symbol: symbol,
      quantity: Math.abs(quantity),
      order_type: 'market',
      side: side.toLowerCase(),
      exchange: 'auto',
      client_order_id: clientOrderId,
    };
    
    logger.info('Placing Lime market order', { symbol, side, quantity, accountNumber, clientOrderId });
    const response = await this.makeRequest('POST', '/orders/place', orderData);
    
    return {
      orderId: response.data,
      clientOrderId: clientOrderId,
      status: 'pending',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
    const clientOrderId = this.generateClientOrderId();
    
    const orderData = {
      account_number: accountNumber,
      symbol: symbol,
      quantity: Math.abs(quantity),
      price: parseFloat(price),
      order_type: 'limit',
      side: side.toLowerCase(),
      time_in_force: 'day',
      exchange: 'auto',
      client_order_id: clientOrderId,
    };
    
    logger.info('Placing Lime limit order', { symbol, side, quantity, price, accountNumber, clientOrderId });
    const response = await this.makeRequest('POST', '/orders/place', orderData);
    
    return {
      orderId: response.data,
      clientOrderId: clientOrderId,
      status: 'pending',
    };
  }

  /**
   * Place stop loss order
   * Note: Lime doesn't have native stop orders, but we can use stop-limit
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    // Lime doesn't have native stop orders in the API
    // We'll need to implement using stop-limit or monitor price and place market order
    // For now, throw error indicating stop orders not directly supported
    throw new Error(
      'Lime API does not support stop loss orders directly. ' +
      'Consider using limit orders with price monitoring, or implement stop-limit orders if supported.'
    );
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
    // If position is long (positive qty), we need to sell
    // If position is short (negative qty), we need to buy
    const positionQty = parseFloat(position.positionAmt);
    const closeSide = positionQty > 0 ? 'sell' : 'buy';
    const closeQty = Math.min(Math.abs(quantity), Math.abs(positionQty));
    
    return this.placeMarketOrder(symbol, closeSide, closeQty);
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Lime order', { symbol, orderId });
    const response = await this.makeRequest('POST', `/orders/${orderId}/cancel`, {});
    
    return {
      orderId: orderId.toString(),
      status: 'canceled',
    };
  }

  /**
   * Get order status by client order ID
   */
  async getOrder(symbol, orderId) {
    // Lime uses client_order_id query parameter
    // orderId can be either client_order_id or system order ID
    // Try client_order_id first (most common)
    try {
      return await this.makeRequest('GET', `/orders?client_order_id=${orderId}`);
    } catch (error) {
      // If not found, try getting from active orders
      const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
      const activeOrders = await this.makeRequest('GET', `/accounts/${accountNumber}/activeorders`);
      const order = activeOrders.find(o => o.client_id === orderId || o.client_order_id === orderId);
      if (order) {
        return order;
      }
      throw new Error(`Order ${orderId} not found`);
    }
  }
}

module.exports = LimeAPI;
