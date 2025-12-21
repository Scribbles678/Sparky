const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class WebullAPI extends BaseExchangeAPI {
  constructor(appKey, appSecret, accountId = null, regionId = 'us', environment = 'production') {
    super({ appKey, appSecret, accountId, regionId, environment });
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.accountId = accountId;
    this.regionId = regionId || 'us';
    this.environment = environment;
    this.exchangeName = 'webull';
    
    // Base URLs
    this.apiUrl = 'https://api.webull.com';
    this.eventsUrl = 'https://events-api.webull.com';
    this.quotesUrl = 'https://usquotes-api.webullfintech.com';
    
    // Instrument ID cache (symbol -> instrument_id)
    this.instrumentCache = new Map();
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Generate HMAC-SHA1 signature for request
   */
  generateSignature(uri, queryParams, headers, body, appSecret) {
    // Step 1: Combine query params and headers, sort by key
    const allParams = { ...queryParams, ...headers };
    const sortedKeys = Object.keys(allParams).sort();
    const sortedString = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&');
    
    // Step 2: Calculate body MD5 (if body exists)
    let bodyMD5 = '';
    if (body && body.length > 0) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      bodyMD5 = crypto.createHash('md5').update(bodyStr).digest('hex').toUpperCase();
    }
    
    // Step 3: Construct source param
    const sourceParam = bodyMD5 
      ? `${uri}&${sortedString}&${bodyMD5}`
      : `${uri}&${sortedString}`;
    
    // Step 4: URL encode (encodeURIComponent)
    const encoded = encodeURIComponent(sourceParam);
    
    // Step 5: Generate signature (HMAC-SHA1 with app_secret + "&")
    const key = appSecret + '&';
    const signature = crypto
      .createHmac('sha1', key)
      .update(encoded)
      .digest('base64');
    
    return signature;
  }

  /**
   * Get instrument_id for symbol (with caching)
   */
  async getInstrumentId(symbol) {
    // Check cache first
    if (this.instrumentCache.has(symbol)) {
      return this.instrumentCache.get(symbol);
    }
    
    // Lookup from API
    try {
      const instruments = await this.makeRequest('GET', '/instrument/list', null, {
        symbols: symbol,
        category: 'US_STOCK', // Default to US_STOCK, can be enhanced
      });
      
      if (!instruments || instruments.length === 0) {
        throw new Error(`Instrument not found for symbol: ${symbol}`);
      }
      
      // Use first result (can be enhanced to filter by exchange)
      const instrumentId = instruments[0].instrument_id;
      
      // Cache result
      this.instrumentCache.set(symbol, instrumentId);
      
      logger.info('Webull instrument_id cached', { symbol, instrumentId });
      
      return instrumentId;
    } catch (error) {
      logger.logError('Webull instrument lookup failed', error, { symbol });
      throw error;
    }
  }

  /**
   * Get default account ID if not provided
   */
  async getDefaultAccountId() {
    if (this.accountId) {
      return this.accountId;
    }
    
    const accounts = await this.makeRequest('GET', '/app/subscriptions/list');
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No Webull accounts found');
    }
    
    // Use first account
    this.accountId = accounts[0].account_id;
    logger.info('Auto-detected Webull account ID', { accountId: this.accountId });
    
    return this.accountId;
  }

  /**
   * Make authenticated API request with HMAC-SHA1 signature
   */
  async makeRequest(method, endpoint, data = null, queryParams = {}, retryCount = 0) {
    const startTime = Date.now();
    
    // Generate nonce and timestamp
    const nonce = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Prepare headers
    const headers = {
      'x-app-key': this.appKey,
      'x-signature-algorithm': 'HMAC-SHA1',
      'x-signature-version': '1.0',
      'x-signature-nonce': nonce,
      'x-timestamp': timestamp,
      'host': 'api.webull.com',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    // Prepare body
    const body = data ? JSON.stringify(data) : null;
    
    // Generate signature
    const signature = this.generateSignature(
      endpoint,
      queryParams,
      headers,
      body,
      this.appSecret
    );
    
    // Add signature to headers
    headers['x-signature'] = signature;
    
    // Build URL with query params
    let url = `${this.apiUrl}${endpoint}`;
    const queryString = Object.keys(queryParams)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');
    if (queryString) {
      url += `?${queryString}`;
    }
    
    const config = {
      method,
      url,
      headers,
    };
    
    if (body) {
      config.data = body;
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
        const errorData = error.response.data || {};
        const errorCode = errorData.error_code || errorData.code;
        const errorMessage = errorData.message || error.message;
        
        logger.logError('Webull API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          error_code: errorCode,
          message: errorMessage,
          duration,
        });
        
        // Handle specific errors
        if (errorCode === 'CLOCK_SKEW_EXCEEDED') {
          throw new Error('System clock is out of sync. Please check your system time.');
        }
        
        if (errorCode === 'DUPPLICATED_REQUEST') {
          // Retry with new nonce
          if (retryCount < this.maxRetries) {
            logger.info('Webull duplicate request, retrying with new nonce');
            return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
          }
        }
        
        if (errorCode === 'INSTRUMENT_NOT_FOUND') {
          // Clear cache for this symbol
          const symbol = queryParams.symbols || data?.stock_order?.instrument_id;
          if (symbol) {
            this.instrumentCache.delete(symbol);
          }
          throw new Error(`Symbol ${symbol || 'unknown'} not found on Webull. Please check the symbol.`);
        }
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429 || errorCode === 'TOO_MANY_REQUESTS') && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Webull request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      } else {
        logger.logError('Webull network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Webull request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
   */
  async getBalance() {
    const accountId = await this.getDefaultAccountId();
    const balance = await this.makeRequest('GET', '/account/balance', null, {
      account_id: accountId,
      total_asset_currency: 'USD',
    });
    
    const totalAsset = parseFloat(balance.total_asset || 0);
    const cashBalance = balance.account_currency_assets && balance.account_currency_assets.length > 0
      ? parseFloat(balance.account_currency_assets[0].cash_balance || 0)
      : 0;
    
    return [{
      asset: 'USD',
      availableBalance: cashBalance,
      balance: totalAsset,
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const accountId = await this.getDefaultAccountId();
    const balance = await this.makeRequest('GET', '/account/balance', null, {
      account_id: accountId,
      total_asset_currency: 'USD',
    });
    
    if (balance.account_currency_assets && balance.account_currency_assets.length > 0) {
      const accountAsset = balance.account_currency_assets[0];
      // Use margin_power for margin accounts, cash_power for cash accounts
      return parseFloat(accountAsset.margin_power || accountAsset.cash_power || 0);
    }
    
    return 0;
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const accountId = await this.getDefaultAccountId();
    const positions = await this.makeRequest('GET', '/account/positions', null, {
      account_id: accountId,
      page_size: 100,
    });
    
    if (!positions.holdings || !Array.isArray(positions.holdings)) {
      return [];
    }
    
    return positions.holdings.map(holding => {
      const qty = parseFloat(holding.qty || 0);
      const unitCost = parseFloat(holding.unit_cost || 0);
      const lastPrice = parseFloat(holding.last_price || 0);
      
      return {
        symbol: holding.symbol,
        positionAmt: qty.toString(),
        entryPrice: unitCost,
        markPrice: lastPrice,
        unRealizedProfit: parseFloat(holding.unrealized_profit_loss || 0),
      };
    });
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
   * Note: Webull market data requires gRPC for real-time prices
   * This method attempts to get price from positions as fallback
   */
  async getTicker(symbol) {
    try {
      // Try to get price from position first (if user has position)
      const position = await this.getPosition(symbol);
      if (position && position.markPrice) {
        return {
          symbol: symbol,
          price: position.markPrice.toString(),
          lastPrice: position.markPrice.toString(),
          bid: position.markPrice.toString(),
          ask: position.markPrice.toString(),
        };
      }
      
      // Webull market data requires gRPC client for real-time prices
      // REST API does not provide direct price lookup
      // For now, throw helpful error - can be enhanced with gRPC client
      throw new Error(
        `Webull real-time market data requires gRPC client implementation. ` +
        `Price lookup for ${symbol} is not available via REST API. ` +
        `Consider implementing gRPC client or using price from positions/orders.`
      );
    } catch (error) {
      // If position lookup fails with different error, re-throw original
      if (!error.message.includes('gRPC')) {
        throw error;
      }
      throw error;
    }
  }

  // ==================== Order Methods ====================

  /**
   * Generate client order ID (UUID, max 40 chars)
   */
  generateClientOrderId() {
    // Webull requires max 40 chars
    return uuidv4().replace(/-/g, '').substring(0, 40);
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const accountId = await this.getDefaultAccountId();
    const instrumentId = await this.getInstrumentId(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    const stockOrder = {
      client_order_id: clientOrderId,
      side: side.toUpperCase(),
      tif: 'DAY',
      extended_hours_trading: false,
      instrument_id: instrumentId,
      order_type: 'MARKET',
      qty: Math.abs(quantity).toString(),
    };
    
    logger.info('Placing Webull market order', { symbol, side, quantity, accountId, clientOrderId, instrumentId });
    
    const response = await this.makeRequest('POST', '/trade/order/place', {
      account_id: accountId,
      stock_order: stockOrder,
    });
    
    return {
      orderId: response.data?.client_order_id || clientOrderId,
      clientOrderId: clientOrderId,
      status: 'pending',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price, extendedHours = false) {
    const accountId = await this.getDefaultAccountId();
    const instrumentId = await this.getInstrumentId(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    const stockOrder = {
      client_order_id: clientOrderId,
      side: side.toUpperCase(),
      tif: 'DAY',
      extended_hours_trading: extendedHours,
      instrument_id: instrumentId,
      order_type: 'LIMIT',
      limit_price: parseFloat(price).toFixed(price >= 1.0 ? 2 : 4),
      qty: Math.abs(quantity).toString(),
    };
    
    logger.info('Placing Webull limit order', { symbol, side, quantity, price, extendedHours, accountId, clientOrderId, instrumentId });
    
    const response = await this.makeRequest('POST', '/trade/order/place', {
      account_id: accountId,
      stock_order: stockOrder,
    });
    
    return {
      orderId: response.data?.client_order_id || clientOrderId,
      clientOrderId: clientOrderId,
      status: 'pending',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const accountId = await this.getDefaultAccountId();
    const instrumentId = await this.getInstrumentId(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    const stockOrder = {
      client_order_id: clientOrderId,
      side: side.toUpperCase(),
      tif: 'DAY',
      extended_hours_trading: false, // Stop orders don't support extended hours
      instrument_id: instrumentId,
      order_type: limitPrice ? 'STOP_LOSS_LIMIT' : 'STOP_LOSS',
      stop_price: parseFloat(stopPrice).toFixed(stopPrice >= 1.0 ? 2 : 4),
      qty: Math.abs(quantity).toString(),
    };
    
    if (limitPrice) {
      stockOrder.limit_price = parseFloat(limitPrice).toFixed(limitPrice >= 1.0 ? 2 : 4);
    }
    
    logger.info('Placing Webull stop loss order', { symbol, side, quantity, stopPrice, limitPrice, accountId, clientOrderId, instrumentId });
    
    const response = await this.makeRequest('POST', '/trade/order/place', {
      account_id: accountId,
      stock_order: stockOrder,
    });
    
    return {
      orderId: response.data?.client_order_id || clientOrderId,
      clientOrderId: clientOrderId,
      status: 'pending',
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
    const accountId = await this.getDefaultAccountId();
    logger.info('Canceling Webull order', { symbol, orderId, accountId });
    
    const response = await this.makeRequest('POST', '/trade/order/cancel', {
      account_id: accountId,
      client_order_id: orderId,
    });
    
    return {
      orderId: orderId.toString(),
      status: 'canceled',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    const accountId = await this.getDefaultAccountId();
    
    try {
      const order = await this.makeRequest('GET', '/trade/order/detail', null, {
        account_id: accountId,
        client_order_id: orderId,
      });
      
      return order;
    } catch (error) {
      // If order not found, return pending status
      if (error.response && error.response.data && 
          (error.response.data.error_code === 'ORDER_NOT_FOUND' || 
           error.response.data.error_code === 'NO_SUCH_ORDER')) {
        logger.warn('Webull order not found', { orderId });
        return {
          client_order_id: orderId.toString(),
          order_status: 'SUBMITTED',
          items: [{
            symbol: symbol,
            order_status: 'SUBMITTED',
          }],
        };
      }
      throw error;
    }
  }
}

module.exports = WebullAPI;
