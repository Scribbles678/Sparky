/**
 * E*TRADE Exchange API
 * 
 * DISABLED: This exchange is currently disabled due to OAuth 1.0 requirements
 * with daily token expiration (midnight ET). This creates a poor user experience
 * as users must re-authorize every day. 
 * 
 * Implementation is kept for future reference if E*TRADE improves their API
 * or if there's strong user demand despite the limitations.
 * 
 * To enable:
 * 1. Uncomment E*TRADE case in ExchangeFactory.js
 * 2. Add to exchangeMetadata.ts in SignalStudio
 * 3. Implement OAuth flow UI in SignalStudio
 * 4. Add to EXCHANGES.md documentation
 */

const OAuth = require('oauth');
const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const url = require('url');

class EtradeAPI extends BaseExchangeAPI {
  constructor(consumerKey, consumerSecret, accessToken, accessTokenSecret, accountIdKey, environment = 'production') {
    super({ consumerKey, consumerSecret, accessToken, accessTokenSecret, accountIdKey, environment });
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.accessToken = accessToken;
    this.accessTokenSecret = accessTokenSecret;
    this.accountIdKey = accountIdKey;
    this.environment = environment;
    this.exchangeName = 'etrade';
    
    // Set API URL based on environment
    const isSandbox = environment === 'sandbox' || environment === 'test';
    this.baseUrl = isSandbox
      ? 'https://apisb.etrade.com'
      : 'https://api.etrade.com';
    
    // OAuth endpoints
    this.requestTokenUrl = `${this.baseUrl}/oauth/request_token`;
    this.accessTokenUrl = `${this.baseUrl}/oauth/access_token`;
    this.authorizeUrl = isSandbox
      ? 'https://us.etrade.com/e/t/etws/authorize'
      : 'https://us.etrade.com/e/t/etws/authorize';
    
    // Initialize OAuth client
    this.oauthClient = new OAuth.OAuth(
      this.requestTokenUrl,
      this.accessTokenUrl,
      this.consumerKey,
      this.consumerSecret,
      '1.0',
      'oob', // Out-of-band callback
      'HMAC-SHA1'
    );
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Make authenticated OAuth 1.0 API request with retry logic
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} endpoint - API endpoint (e.g., '/v1/accounts/list.json')
   * @param {object} data - Request body data (for POST/PUT)
   * @param {object} queryParams - Query parameters (for GET)
   * @param {number} retryCount - Current retry attempt
   */
  async makeRequest(method, endpoint, data = null, queryParams = null, retryCount = 0) {
    const startTime = Date.now();
    
    // Build full URL with query parameters
    let fullUrl = `${this.baseUrl}${endpoint}`;
    if (queryParams && method === 'GET') {
      const queryString = new URLSearchParams(queryParams).toString();
      fullUrl += `?${queryString}`;
    }

    try {
      // OAuth 1.0 signing
      const response = await new Promise((resolve, reject) => {
        const contentType = 'application/json';
        const body = data ? JSON.stringify(data) : '';
        
        this.oauthClient._performSecureRequest(
          this.accessToken,
          this.accessTokenSecret,
          method,
          fullUrl,
          null,
          body,
          contentType,
          (err, responseBody, res) => {
            if (err) {
              return reject(err);
            }
            
            // Check status code
            if (res && res.statusCode && res.statusCode.toString()[0] !== '2') {
              const error = new Error(`HTTP ${res.statusCode}: ${responseBody}`);
              error.statusCode = res.statusCode;
              error.response = { status: res.statusCode, data: responseBody };
              return reject(error);
            }
            
            // Parse JSON response
            try {
              const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
              resolve({
                statusCode: res?.statusCode || 200,
                data: parsed,
                headers: res?.headers || {},
              });
            } catch (parseError) {
              reject(new Error(`Failed to parse response: ${parseError.message}`));
            }
          }
        );
      });
      
      const duration = Date.now() - startTime;
      logger.logApiCall(method, endpoint, response.statusCode, duration);
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response || error.statusCode) {
        const statusCode = error.statusCode || error.response?.status || 500;
        logger.logError('E*TRADE API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response?.data || error.message,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying E*TRADE request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      } else {
        logger.logError('E*TRADE network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying E*TRADE request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get account list (required to get accountIdKey if not provided)
   */
  async getAccountList() {
    return this.makeRequest('GET', '/v1/accounts/list.json');
  }

  /**
   * Ensure accountIdKey is set (fetch if needed)
   */
  async ensureAccountIdKey() {
    if (this.accountIdKey) {
      return this.accountIdKey;
    }
    
    // Fetch account list to get accountIdKey
    const response = await this.getAccountList();
    const accounts = response.AccountsResponse?.Account || [];
    
    if (accounts.length === 0) {
      throw new Error('No E*TRADE accounts found');
    }
    
    // Use first account by default
    this.accountIdKey = accounts[0].accountIdKey;
    logger.info(`Using E*TRADE account: ${accounts[0].accountId} (${this.accountIdKey})`);
    
    return this.accountIdKey;
  }

  // ==================== Account Methods ====================

  /**
   * Get account balance
   */
  async getBalance() {
    const accountIdKey = await this.ensureAccountIdKey();
    
    const response = await this.makeRequest('GET', `/v1/accounts/${accountIdKey}/balance.json`, null, {
      instType: 'BROKERAGE',
      realTimeNAV: 'true',
    });
    
    const balance = response.BalanceResponse;
    const totalAccountValue = balance.Computed?.RealTimeValues?.totalAccountValue || 0;
    
    return [{
      asset: 'USD',
      availableBalance: parseFloat(balance.Computed?.cashBuyingPower || 0),
      balance: parseFloat(totalAccountValue),
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const accountIdKey = await this.ensureAccountIdKey();
    
    const response = await this.makeRequest('GET', `/v1/accounts/${accountIdKey}/balance.json`, null, {
      instType: 'BROKERAGE',
      realTimeNAV: 'true',
    });
    
    const balance = response.BalanceResponse;
    return parseFloat(balance.Computed?.marginBuyingPower || balance.Computed?.cashBuyingPower || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const accountIdKey = await this.ensureAccountIdKey();
    
    const response = await this.makeRequest('GET', `/v1/accounts/${accountIdKey}/portfolio.json`);
    
    const portfolios = response.PortfolioResponse?.AccountPortfolio || [];
    const positions = [];
    
    for (const portfolio of portfolios) {
      if (portfolio.Position && Array.isArray(portfolio.Position)) {
        for (const pos of portfolio.Position) {
          const quantity = parseFloat(pos.quantity || 0);
          if (quantity !== 0) {
            positions.push({
              symbol: pos.Product?.symbol || pos.symbolDescription?.split(' ')[0] || 'UNKNOWN',
              positionAmt: quantity.toString(),
              entryPrice: parseFloat(pos.pricePaid || pos.averagePrice || 0),
              markPrice: parseFloat(pos.Quick?.lastTrade || 0),
              unRealizedProfit: parseFloat(pos.totalGain || 0),
            });
          }
        }
      }
    }
    
    return positions;
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase() && parseFloat(p.positionAmt) !== 0);
    
    return position || null;
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
    const response = await this.makeRequest('GET', `/v1/market/quote/${symbol}.json`);
    
    const quoteData = response.QuoteResponse?.QuoteData?.[0];
    if (!quoteData) {
      throw new Error(`No quote data available for ${symbol}`);
    }
    
    const all = quoteData.All || quoteData.Quick || {};
    const lastTrade = parseFloat(all.lastTrade || all.LastTrade || 0);
    
    if (!lastTrade || lastTrade === 0) {
      throw new Error(`No price data available for ${symbol}`);
    }
    
    return {
      symbol: quoteData.Product?.symbol || symbol,
      price: lastTrade.toString(),
      lastPrice: lastTrade.toString(),
      bid: all.bid?.toString(),
      ask: all.ask?.toString(),
    };
  }

  // ==================== Order Methods ====================

  /**
   * Preview order (required before placing)
   */
  async previewOrder(orderRequest) {
    const accountIdKey = await this.ensureAccountIdKey();
    
    const previewRequest = {
      PreviewOrderRequest: orderRequest,
    };
    
    return this.makeRequest('POST', `/v1/accounts/${accountIdKey}/orders/preview.json`, previewRequest);
  }

  /**
   * Place order (after preview)
   */
  async placeOrder(orderRequest, previewId) {
    const accountIdKey = await this.ensureAccountIdKey();
    
    const placeRequest = {
      PlaceOrderRequest: {
        ...orderRequest,
        previewId: previewId,
      },
    };
    
    return this.makeRequest('POST', `/v1/accounts/${accountIdKey}/orders/place.json`, placeRequest);
  }

  /**
   * Build order request object
   */
  buildOrderRequest(symbol, side, quantity, orderType, options = {}) {
    const {
      limitPrice = null,
      stopPrice = null,
      orderTerm = 'GOOD_FOR_DAY',
      marketSession = 'REGULAR',
      clientOrderId = null,
    } = options;
    
    // Map order type
    let priceType = 'MARKET';
    if (orderType === 'limit' || orderType === 'LIMIT') {
      priceType = 'LIMIT';
    } else if (orderType === 'stop' || orderType === 'STOP') {
      priceType = 'STOP';
    } else if (orderType === 'stop_limit' || orderType === 'STOP_LIMIT') {
      priceType = 'STOP_LIMIT';
    }
    
    // Map side
    const orderAction = side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
    
    // Generate client order ID if not provided
    const finalClientOrderId = clientOrderId || `sparky-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const orderRequest = {
      orderType: 'EQ', // Equity
      clientOrderId: finalClientOrderId,
      Order: [{
        allOrNone: 'false',
        priceType: priceType,
        orderTerm: orderTerm,
        marketSession: marketSession,
        Instrument: [{
          Product: {
            securityType: 'EQ',
            symbol: symbol.toUpperCase(),
          },
          orderAction: orderAction,
          quantityType: 'QUANTITY',
          quantity: Math.abs(quantity),
        }],
      }],
    };
    
    // Add limit price if provided
    if (limitPrice) {
      orderRequest.Order[0].limitPrice = parseFloat(limitPrice);
    }
    
    // Add stop price if provided
    if (stopPrice) {
      orderRequest.Order[0].stopPrice = parseFloat(stopPrice);
    }
    
    return orderRequest;
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const orderRequest = this.buildOrderRequest(symbol, side, quantity, 'market');
    
    // Step 1: Preview
    logger.info('Previewing E*TRADE market order', { symbol, side, quantity });
    const previewResponse = await this.previewOrder(orderRequest);
    const previewId = previewResponse.PreviewOrderResponse?.previewId;
    
    if (!previewId) {
      throw new Error('Failed to preview order - no preview ID returned');
    }
    
    // Step 2: Place
    logger.info('Placing E*TRADE market order', { symbol, side, quantity, previewId });
    const placeResponse = await this.placeOrder(orderRequest, previewId);
    const orderId = placeResponse.PlaceOrderResponse?.orderId;
    
    return {
      orderId: orderId || previewId,
      status: placeResponse.PlaceOrderResponse?.Order?.[0]?.OrderDetail?.[0]?.status || 'OPEN',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const orderRequest = this.buildOrderRequest(symbol, side, quantity, 'limit', {
      limitPrice: price,
    });
    
    // Step 1: Preview
    logger.info('Previewing E*TRADE limit order', { symbol, side, quantity, price });
    const previewResponse = await this.previewOrder(orderRequest);
    const previewId = previewResponse.PreviewOrderResponse?.previewId;
    
    if (!previewId) {
      throw new Error('Failed to preview order - no preview ID returned');
    }
    
    // Step 2: Place
    logger.info('Placing E*TRADE limit order', { symbol, side, quantity, price, previewId });
    const placeResponse = await this.placeOrder(orderRequest, previewId);
    const orderId = placeResponse.PlaceOrderResponse?.orderId;
    
    return {
      orderId: orderId || previewId,
      status: placeResponse.PlaceOrderResponse?.Order?.[0]?.OrderDetail?.[0]?.status || 'OPEN',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const orderType = limitPrice ? 'stop_limit' : 'stop';
    const orderRequest = this.buildOrderRequest(symbol, side, quantity, orderType, {
      stopPrice: stopPrice,
      limitPrice: limitPrice,
    });
    
    // Step 1: Preview
    logger.info('Previewing E*TRADE stop loss', { symbol, side, quantity, stopPrice, limitPrice });
    const previewResponse = await this.previewOrder(orderRequest);
    const previewId = previewResponse.PreviewOrderResponse?.previewId;
    
    if (!previewId) {
      throw new Error('Failed to preview order - no preview ID returned');
    }
    
    // Step 2: Place
    logger.info('Placing E*TRADE stop loss', { symbol, side, quantity, stopPrice, previewId });
    const placeResponse = await this.placeOrder(orderRequest, previewId);
    const orderId = placeResponse.PlaceOrderResponse?.orderId;
    
    return {
      orderId: orderId || previewId,
      status: placeResponse.PlaceOrderResponse?.Order?.[0]?.OrderDetail?.[0]?.status || 'OPEN',
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
   * Close position (market order with opposite side)
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
    const accountIdKey = await this.ensureAccountIdKey();
    
    const cancelRequest = {
      CancelOrderRequest: {
        orderId: parseInt(orderId),
      },
    };
    
    logger.info('Canceling E*TRADE order', { symbol, orderId });
    await this.makeRequest('PUT', `/v1/accounts/${accountIdKey}/orders/cancel.json`, cancelRequest);
    
    return {
      orderId: orderId,
      status: 'CANCELLED',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    const accountIdKey = await this.ensureAccountIdKey();
    
    // Get all orders and find the one we want
    const response = await this.makeRequest('GET', `/v1/accounts/${accountIdKey}/orders.json`, null, {
      count: 100, // Get recent orders
    });
    
    const orders = response.OrdersResponse?.Order || [];
    const order = orders.find(o => o.orderId === parseInt(orderId));
    
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    return order;
  }
}

module.exports = EtradeAPI;
