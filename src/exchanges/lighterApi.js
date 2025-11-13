const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class LighterAPI extends BaseExchangeAPI {
  constructor(apiKey, privateKey, accountIndex, apiKeyIndex = 2, baseUrl = 'https://mainnet.zklighter.elliot.ai') {
    super({ apiKey, privateKey, accountIndex, apiKeyIndex, baseUrl });
    this.apiKey = apiKey;
    this.privateKey = privateKey;
    this.accountIndex = accountIndex;
    this.apiKeyIndex = apiKeyIndex;
    this.baseUrl = baseUrl;
    this.exchangeName = 'lighter';
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.nonce = 0; // Will be fetched from API
  }

  /**
   * Generate signature for Lighter API authentication
   * Based on Lighter's signing mechanism
   */
  generateSignature(data, nonce) {
    // Lighter uses a specific signing mechanism
    // This is a simplified version - actual implementation would need the full signing logic
    const message = JSON.stringify(data) + nonce.toString();
    const signature = crypto
      .createHmac('sha256', this.privateKey)
      .update(message)
      .digest('hex');
    
    return signature;
  }

  /**
   * Get next nonce for transaction signing
   */
  async getNextNonce() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/transaction/next_nonce`, {
        params: { api_key_index: this.apiKeyIndex }
      });
      return response.data.nonce;
    } catch (error) {
      logger.logError('Failed to get next nonce', error);
      throw error;
    }
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
    };

    // Add authentication for transaction endpoints
    if (endpoint.includes('/transaction/') || endpoint.includes('/order/')) {
      const nonce = await this.getNextNonce();
      const signature = this.generateSignature(data || {}, nonce);
      
      headers['X-Signature'] = signature;
      headers['X-Nonce'] = nonce.toString();
      headers['X-Account-Index'] = this.accountIndex.toString();
      headers['X-API-Key-Index'] = this.apiKeyIndex.toString();
    }

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
        logger.logError('Lighter API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Lighter request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Lighter network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Lighter request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
    const response = await this.makeRequest('GET', `/api/v1/account/${this.accountIndex}`);
    
    // Convert Lighter balance format to common format
    return [{
      asset: 'USDC', // Lighter uses USDC as base currency
      availableBalance: parseFloat(response.available_balance || 0),
      balance: parseFloat(response.total_balance || 0),
    }];
  }

  /**
   * Get available margin
   */
  async getAvailableMargin() {
    const response = await this.makeRequest('GET', `/api/v1/account/${this.accountIndex}`);
    return parseFloat(response.available_balance || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const response = await this.makeRequest('GET', `/api/v1/account/${this.accountIndex}/positions`);
    
    // Convert Lighter positions to common format
    return response.positions.map(pos => ({
      symbol: pos.symbol,
      positionAmt: pos.size.toString(),
      entryPrice: parseFloat(pos.entry_price),
      markPrice: parseFloat(pos.mark_price),
      unRealizedProfit: parseFloat(pos.unrealized_pnl),
    }));
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
    const response = await this.makeRequest('GET', `/api/v1/market/${symbol}/ticker`);
    
    return {
      symbol: response.symbol,
      price: response.last_price.toString(),
      lastPrice: response.last_price.toString(),
      bid: response.bid_price,
      ask: response.ask_price,
    };
  }

  // ==================== Order Methods ====================

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      order_type: 'ORDER_TYPE_MARKET',
      base_amount: Math.floor(quantity * 1e18), // Convert to wei-like format
      client_order_index: Date.now(), // Unique identifier
    };
    
    logger.info('Placing Lighter market order', orderData);
    const response = await this.makeRequest('POST', '/api/v1/order/create', orderData);
    
    return {
      orderId: response.order_id || response.client_order_index,
      status: 'FILLED',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      order_type: 'ORDER_TYPE_LIMIT',
      base_amount: Math.floor(quantity * 1e18),
      price: Math.floor(price * 1e18),
      time_in_force: 'ORDER_TIME_IN_FORCE_GOOD_TILL_TIME',
      client_order_index: Date.now(),
    };
    
    logger.info('Placing Lighter limit order', orderData);
    const response = await this.makeRequest('POST', '/api/v1/order/create', orderData);
    
    return {
      orderId: response.order_id || response.client_order_index,
      status: 'NEW',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      order_type: 'ORDER_TYPE_STOP_LOSS',
      base_amount: Math.floor(quantity * 1e18),
      stop_price: Math.floor(stopPrice * 1e18),
      time_in_force: 'ORDER_TIME_IN_FORCE_GOOD_TILL_TIME',
      client_order_index: Date.now(),
    };
    
    logger.info('Placing Lighter stop loss', orderData);
    const response = await this.makeRequest('POST', '/api/v1/order/create', orderData);
    
    return {
      orderId: response.order_id || response.client_order_index,
      status: 'NEW',
    };
  }

  /**
   * Place take profit order
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      order_type: 'ORDER_TYPE_TAKE_PROFIT',
      base_amount: Math.floor(quantity * 1e18),
      price: Math.floor(takeProfitPrice * 1e18),
      time_in_force: 'ORDER_TIME_IN_FORCE_GOOD_TILL_TIME',
      client_order_index: Date.now(),
    };
    
    logger.info('Placing Lighter take profit', orderData);
    const response = await this.makeRequest('POST', '/api/v1/order/create', orderData);
    
    return {
      orderId: response.order_id || response.client_order_index,
      status: 'NEW',
    };
  }

  /**
   * Close position (market order with opposite side)
   */
  async closePosition(symbol, side, quantity) {
    // Close position by placing opposite market order
    const oppositeSide = side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY';
    
    const orderData = {
      symbol,
      side: oppositeSide,
      order_type: 'ORDER_TYPE_MARKET',
      base_amount: Math.floor(quantity * 1e18),
      client_order_index: Date.now(),
    };
    
    logger.info('Closing Lighter position', orderData);
    const response = await this.makeRequest('POST', '/api/v1/order/create', orderData);
    
    return {
      orderId: response.order_id || response.client_order_index,
      status: 'FILLED',
    };
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Lighter order', { symbol, orderId });
    const response = await this.makeRequest('POST', '/api/v1/order/cancel', {
      symbol,
      client_order_index: orderId,
    });
    
    return {
      orderId: orderId,
      status: 'CANCELED',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/api/v1/order/${symbol}/${orderId}`);
  }

  /**
   * Get account data
   */
  async getAccountData() {
    return this.makeRequest('GET', `/api/v1/account/${this.accountIndex}`);
  }

  /**
   * Get order book for a symbol
   */
  async getOrderBook(symbol) {
    return this.makeRequest('GET', `/api/v1/market/${symbol}/orderbook`);
  }

  /**
   * Get all markets
   */
  async getMarkets() {
    return this.makeRequest('GET', '/api/v1/markets');
  }
}

module.exports = LighterAPI;
