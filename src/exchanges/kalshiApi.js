/**
 * Kalshi Exchange API
 * 
 * Kalshi is a prediction market exchange where users trade on binary outcomes (YES/NO).
 * Unlike traditional exchanges, Kalshi uses:
 * - Binary markets (YES/NO positions that sum to 100¢)
 * - Contract quantities (not USD amounts)
 * - RSA-PSS signature authentication
 * 
 * Documentation: docs/reference/KALSHI_IMPLEMENTATION.md
 */

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class KalshiAPI extends BaseExchangeAPI {
  /**
   * @param {string} apiKeyId - Kalshi API Key ID (KALSHI-ACCESS-KEY)
   * @param {string} privateKey - RSA private key in PEM format
   * @param {string} [environment] - 'production' or 'demo' (default: 'production')
   */
  constructor(apiKeyId, privateKey, environment = 'production') {
    super({ apiKeyId, privateKey, environment });
    this.apiKeyId = apiKeyId;
    this.privateKey = privateKey;
    this.environment = environment;
    this.exchangeName = 'kalshi';
    
    // Set API URL based on environment
    this.apiUrl = environment === 'demo'
      ? 'https://demo-api.kalshi.com/trade-api/v2'
      : 'https://api.kalshi.com/trade-api/v2';
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
    
    // Validate private key format
    try {
      crypto.createPrivateKey(privateKey);
    } catch (error) {
      throw new Error(`Invalid RSA private key format: ${error.message}`);
    }
  }

  /**
   * Sign request with RSA-PSS
   * @param {string} text - Text to sign (timestamp + method + path)
   * @returns {string} Base64-encoded signature
   */
  signRequest(text) {
    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(text);
      sign.end();

      const signature = sign.sign({
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      });

      return signature.toString('base64');
    } catch (error) {
      throw new Error(`RSA-PSS signing failed: ${error.message}`);
    }
  }

  /**
   * Make authenticated API request with retry logic
   * @param {string} method - HTTP method (GET, POST, DELETE, etc.)
   * @param {string} endpoint - API endpoint (e.g., '/portfolio/balance')
   * @param {object} [data] - Request body data (for POST/PUT)
   * @param {object} [queryParams] - Query parameters
   * @param {number} [retryCount] - Current retry attempt
   * @returns {Promise<object>} Response data
   */
  async makeRequest(method, endpoint, data = null, queryParams = null, retryCount = 0) {
    const startTime = Date.now();
    
    // Generate timestamp
    const timestamp = Date.now().toString();
    
    // Build path (strip query parameters for signing)
    let path = endpoint;
    let fullUrl = `${this.apiUrl}${endpoint}`;
    
    // Add query parameters to URL if provided
    if (queryParams) {
      const queryString = new URLSearchParams(queryParams).toString();
      fullUrl += `?${queryString}`;
    }
    
    // Strip query parameters from path before signing
    const pathWithoutQuery = path.split('?')[0];
    
    // Create message to sign: timestamp + method + path_without_query
    const msgString = timestamp + method.toUpperCase() + pathWithoutQuery;
    const signature = this.signRequest(msgString);
    
    // Build headers
    const headers = {
      'KALSHI-ACCESS-KEY': this.apiKeyId,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };
    
    const config = {
      method,
      url: fullUrl,
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
        logger.logError('Kalshi API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Kalshi request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      } else {
        logger.logError('Kalshi network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Kalshi request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  // ==================== Account Methods ====================

  /**
   * Get account balance
   * @returns {Promise<Array>} Array of balance objects
   */
  async getBalance() {
    const response = await this.makeRequest('GET', '/portfolio/balance');
    
    // Convert Kalshi balance (cents) to Sparky format
    // Kalshi returns balance in cents, portfolio_value in cents
    return [{
      asset: 'USD',
      availableBalance: (response.balance / 100).toFixed(2), // Convert cents to dollars
      balance: (response.balance / 100).toFixed(2),
      portfolioValue: (response.portfolio_value / 100).toFixed(2), // Total portfolio value
    }];
  }

  /**
   * Get available margin (for Kalshi, this is the available balance)
   * @returns {Promise<number>} Available balance in USD
   */
  async getAvailableMargin() {
    const response = await this.makeRequest('GET', '/portfolio/balance');
    return response.balance / 100; // Convert cents to dollars
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   * @returns {Promise<Array>} Array of position objects
   */
  async getPositions() {
    const allPositions = [];
    let cursor = null;
    
    do {
      const queryParams = cursor ? { cursor, limit: 1000 } : { limit: 1000 };
      const response = await this.makeRequest('GET', '/portfolio/positions', null, queryParams);
      
      // Process market positions
      if (response.market_positions) {
        for (const pos of response.market_positions) {
          // Position is positive for YES, negative for NO
          if (pos.position !== 0) {
            allPositions.push({
              symbol: pos.ticker,
              positionAmt: pos.position.toString(), // Positive = YES, Negative = NO
              entryPrice: null, // Kalshi doesn't provide entry price directly
              markPrice: null, // Will be fetched from market data
              unRealizedProfit: (pos.realized_pnl / 100).toFixed(2), // Convert cents to dollars
              marketExposure: (pos.market_exposure / 100).toFixed(2),
              side: pos.position > 0 ? 'YES' : 'NO',
            });
          }
        }
      }
      
      cursor = response.cursor;
    } while (cursor);
    
    return allPositions;
  }

  /**
   * Get position for specific symbol (ticker)
   * @param {string} symbol - Market ticker
   * @returns {Promise<object|null>} Position object or null
   */
  async getPosition(symbol) {
    const response = await this.makeRequest('GET', '/portfolio/positions', null, { ticker: symbol });
    
    if (response.market_positions && response.market_positions.length > 0) {
      const pos = response.market_positions[0];
      if (pos.position !== 0) {
        return {
          symbol: pos.ticker,
          positionAmt: pos.position.toString(),
          entryPrice: null,
          markPrice: null,
          unRealizedProfit: (pos.realized_pnl / 100).toFixed(2),
          marketExposure: (pos.market_exposure / 100).toFixed(2),
          side: pos.position > 0 ? 'YES' : 'NO',
        };
      }
    }
    
    return null;
  }

  /**
   * Check if position exists for symbol
   * @param {string} symbol - Market ticker
   * @returns {Promise<boolean>} True if position exists
   */
  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null && parseFloat(position.positionAmt) !== 0;
  }

  // ==================== Market Data Methods ====================

  /**
   * Get market ticker/price data
   * @param {string} symbol - Market ticker
   * @returns {Promise<object>} Ticker data
   */
  async getTicker(symbol) {
    const response = await this.makeRequest('GET', `/markets/${symbol}`);
    const market = response.market;
    
    // Convert Kalshi market data to Sparky ticker format
    return {
      symbol: market.ticker,
      lastPrice: market.last_price ? (market.last_price / 100).toFixed(4) : null, // Convert cents to dollars
      bidPrice: market.yes_bid ? (market.yes_bid / 100).toFixed(4) : null,
      askPrice: market.yes_ask ? (market.yes_ask / 100).toFixed(4) : null,
      volume: market.volume || 0,
      status: market.status,
      yesBid: market.yes_bid,
      yesAsk: market.yes_ask,
      noBid: market.no_bid,
      noAsk: market.no_ask,
    };
  }

  /**
   * Get market orderbook
   * @param {string} symbol - Market ticker
   * @param {object} [options] - Options (depth, etc.)
   * @returns {Promise<object>} Orderbook data
   */
  async fetchOrderBook(symbol, options = {}) {
    const queryParams = options.depth ? { depth: options.depth } : {};
    const response = await this.makeRequest('GET', `/markets/${symbol}/orderbook`, null, queryParams);
    
    // Convert Kalshi orderbook to Sparky format
    const orderbook = response.orderbook;
    
    // Kalshi only returns bids, but we can infer asks from reciprocal relationship
    const yesBids = orderbook.yes || [];
    const noBids = orderbook.no || [];
    
    // Best YES bid/ask
    const bestYesBid = yesBids.length > 0 ? yesBids[yesBids.length - 1] : null;
    const bestNoBid = noBids.length > 0 ? noBids[noBids.length - 1] : null;
    const bestYesAsk = bestNoBid ? [100 - bestNoBid[0], bestNoBid[1]] : null;
    
    // Best NO bid/ask
    const bestNoAsk = bestYesBid ? [100 - bestYesBid[0], bestYesBid[1]] : null;
    
    return {
      symbol,
      bids: yesBids.map(bid => [bid[0] / 100, bid[1]]), // Convert cents to dollars
      asks: bestYesAsk ? [[bestYesAsk[0] / 100, bestYesAsk[1]]] : [],
      yesBids: yesBids,
      noBids: noBids,
      bestYesBid: bestYesBid ? bestYesBid[0] : null,
      bestYesAsk: bestYesAsk ? bestYesAsk[0] : null,
      bestNoBid: bestNoBid ? bestNoBid[0] : null,
      bestNoAsk: bestNoAsk ? bestNoAsk[0] : null,
    };
  }

  // ==================== Order Methods ====================

  /**
   * Place market order
   * @param {string} symbol - Market ticker
   * @param {string} side - 'YES' or 'NO' (for Kalshi binary markets)
   * @param {number} quantity - Number of contracts
   * @returns {Promise<object>} Order response
   */
  async placeMarketOrder(symbol, side, quantity) {
    // Convert Sparky side to Kalshi format
    const kalshiSide = side.toUpperCase() === 'YES' ? 'yes' : 'no';
    const action = 'buy'; // Market order is always buy for opening position
    
    const orderData = {
      ticker: symbol,
      side: kalshiSide,
      action: action,
      count: Math.floor(quantity), // Kalshi uses integer contract counts
      type: 'market',
    };
    
    const response = await this.makeRequest('POST', '/portfolio/orders', orderData);
    
    return {
      orderId: response.order.order_id,
      symbol: response.order.ticker,
      side: response.order.side,
      quantity: response.order.initial_count,
      status: response.order.status,
      fillCount: response.order.fill_count,
      remainingCount: response.order.remaining_count,
    };
  }

  /**
   * Place limit order
   * @param {string} symbol - Market ticker
   * @param {string} side - 'YES' or 'NO'
   * @param {number} quantity - Number of contracts
   * @param {number} price - Price in dollars (0.01 to 0.99) or cents (1 to 99)
   * @returns {Promise<object>} Order response
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    // Convert Sparky side to Kalshi format
    const kalshiSide = side.toUpperCase() === 'YES' ? 'yes' : 'no';
    const action = 'buy';
    
    // Convert price to cents if needed (if price > 1, assume it's already in cents)
    const priceInCents = price > 1 ? Math.floor(price) : Math.floor(price * 100);
    
    // Validate price range (1-99 cents)
    if (priceInCents < 1 || priceInCents > 99) {
      throw new Error(`Kalshi price must be between 1¢ and 99¢ (got ${priceInCents}¢)`);
    }
    
    const orderData = {
      ticker: symbol,
      side: kalshiSide,
      action: action,
      count: Math.floor(quantity),
      type: 'limit',
    };
    
    // Set price based on side
    if (kalshiSide === 'yes') {
      orderData.yes_price = priceInCents;
    } else {
      orderData.no_price = priceInCents;
    }
    
    const response = await this.makeRequest('POST', '/portfolio/orders', orderData);
    
    return {
      orderId: response.order.order_id,
      symbol: response.order.ticker,
      side: response.order.side,
      quantity: response.order.initial_count,
      price: response.order.yes_price || response.order.no_price,
      status: response.order.status,
      fillCount: response.order.fill_count,
      remainingCount: response.order.remaining_count,
    };
  }

  /**
   * Cancel order
   * @param {string} symbol - Market ticker (not used by Kalshi, but required by interface)
   * @param {string} orderId - Order ID
   * @returns {Promise<object>} Cancel response
   */
  async cancelOrder(symbol, orderId) {
    const response = await this.makeRequest('DELETE', `/portfolio/orders/${orderId}`);
    
    return {
      orderId: response.order.order_id,
      status: response.order.status,
      reducedBy: response.reduced_by,
    };
  }

  /**
   * Get order status
   * @param {string} symbol - Market ticker (not used by Kalshi, but required by interface)
   * @param {string} orderId - Order ID
   * @returns {Promise<object>} Order data
   */
  async getOrder(symbol, orderId) {
    const response = await this.makeRequest('GET', `/portfolio/orders/${orderId}`);
    
    return {
      orderId: response.order.order_id,
      symbol: response.order.ticker,
      side: response.order.side,
      action: response.order.action,
      type: response.order.type,
      status: response.order.status,
      quantity: response.order.initial_count,
      fillCount: response.order.fill_count,
      remainingCount: response.order.remaining_count,
      price: response.order.yes_price || response.order.no_price,
    };
  }

  /**
   * Close position (sell contracts to close)
   * @param {string} symbol - Market ticker
   * @param {string} side - 'YES' or 'NO' (the side of the position to close)
   * @param {number} quantity - Number of contracts to close
   * @returns {Promise<object>} Order response
   */
  async closePosition(symbol, side, quantity) {
    // To close a position, we sell the contracts
    const kalshiSide = side.toUpperCase() === 'YES' ? 'yes' : 'no';
    
    const orderData = {
      ticker: symbol,
      side: kalshiSide,
      action: 'sell', // Sell to close
      count: Math.floor(quantity),
      type: 'market', // Market order to close quickly
      reduce_only: true, // Only reduce position, don't open opposite
    };
    
    const response = await this.makeRequest('POST', '/portfolio/orders', orderData);
    
    return {
      orderId: response.order.order_id,
      symbol: response.order.ticker,
      side: response.order.side,
      quantity: response.order.initial_count,
      status: response.order.status,
      fillCount: response.order.fill_count,
      remainingCount: response.order.remaining_count,
    };
  }

  // ==================== Kalshi-Specific Methods ====================

  /**
   * Place stop loss (not supported by Kalshi - use conditional logic)
   * @throws {Error} Not supported
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    throw new Error('Stop loss orders are not supported by Kalshi. Use conditional logic in your application.');
  }

  /**
   * Place take profit (not supported by Kalshi - use conditional logic)
   * @throws {Error} Not supported
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    throw new Error('Take profit orders are not supported by Kalshi. Use conditional logic in your application.');
  }

  /**
   * Get exchange status
   * @returns {Promise<object>} Exchange status
   */
  async getExchangeStatus() {
    return this.makeRequest('GET', '/exchange/status');
  }

  /**
   * Get markets list
   * @param {object} [filters] - Filter options (status, series_ticker, etc.)
   * @returns {Promise<Array>} Array of markets
   */
  async getMarkets(filters = {}) {
    const allMarkets = [];
    let cursor = null;
    
    do {
      const queryParams = { ...filters, limit: 1000 };
      if (cursor) {
        queryParams.cursor = cursor;
      }
      
      const response = await this.makeRequest('GET', '/markets', null, queryParams);
      allMarkets.push(...response.markets);
      cursor = response.cursor;
    } while (cursor);
    
    return allMarkets;
  }
}

module.exports = KalshiAPI;

