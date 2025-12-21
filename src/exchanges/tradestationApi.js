const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class TradeStationAPI extends BaseExchangeAPI {
  constructor(clientId, clientSecret, refreshToken, accountId = null, environment = 'production') {
    super({ clientId, clientSecret, refreshToken, accountId, environment });
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accountId = accountId;
    this.environment = environment;
    this.exchangeName = 'tradestation';
    
    // Set API URL based on environment
    const isSim = environment === 'sim' || environment === 'paper' || environment === 'sandbox' || environment === 'test';
    this.baseUrl = isSim
      ? 'https://sim-api.tradestation.com/v3'
      : 'https://api.tradestation.com/v3';
    
    // Token management
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.tokenRefreshThreshold = 5 * 60 * 1000; // Refresh if expires within 5 minutes
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      const response = await axios.post(
        'https://signin.tradestation.com/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
        }
      );
      
      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 1200; // Default 20 minutes
      this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
      
      // Update refresh token if provided (for rotating refresh tokens)
      if (response.data.refresh_token) {
        this.refreshToken = response.data.refresh_token;
        // Note: Should persist this to database
        logger.info('TradeStation refresh token updated (rotating tokens enabled)');
      }
      
      logger.info('TradeStation access token refreshed', { 
        expiresAt: new Date(this.tokenExpiresAt).toISOString() 
      });
      
      return this.accessToken;
    } catch (error) {
      logger.logError('TradeStation token refresh failed', error);
      if (error.response && error.response.status === 401) {
        throw new Error('TradeStation refresh token expired or invalid. Please re-authorize your account.');
      }
      throw error;
    }
  }

  /**
   * Ensure access token is valid, refresh if needed
   */
  async ensureValidToken() {
    const now = Date.now();
    
    // Refresh if no token or expires within threshold
    if (!this.accessToken || !this.tokenExpiresAt || now >= (this.tokenExpiresAt - this.tokenRefreshThreshold)) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Get default account ID if not provided
   */
  async getDefaultAccountId() {
    if (this.accountId) {
      return this.accountId;
    }
    
    const accounts = await this.makeRequest('GET', '/brokerage/accounts');
    
    if (!accounts.Accounts || accounts.Accounts.length === 0) {
      throw new Error('No TradeStation accounts found');
    }
    
    // Use first account
    this.accountId = accounts.Accounts[0].AccountID;
    logger.info('Auto-detected TradeStation account ID', { accountId: this.accountId });
    
    return this.accountId;
  }

  /**
   * Make authenticated API request with token management
   */
  async makeRequest(method, endpoint, data = null, queryParams = {}, retryCount = 0) {
    await this.ensureValidToken();
    
    const startTime = Date.now();
    
    let url = `${this.baseUrl}${endpoint}`;
    const queryString = Object.keys(queryParams)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');
    if (queryString) {
      url += `?${queryString}`;
    }
    
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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
        const errorData = error.response.data || {};
        const errorMessage = errorData.Message || errorData.Error || error.message;
        
        logger.logError('TradeStation API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          message: errorMessage,
          duration,
        });
        
        // Handle token expiration
        if (statusCode === 401 && retryCount === 0) {
          // Force token refresh and retry once
          this.accessToken = null;
          this.tokenExpiresAt = null;
          logger.info('TradeStation token expired, refreshing and retrying');
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
        
        // Handle rate limiting
        if (statusCode === 429 || errorMessage === 'TooManyRequests') {
          if (retryCount < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, retryCount);
            logger.info(`TradeStation rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
            
            await this.sleep(delay);
            return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
          }
        }
        
        // Retry on 5xx errors
        if (statusCode >= 500 && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying TradeStation request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, queryParams, retryCount + 1);
        }
      } else {
        logger.logError('TradeStation network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying TradeStation request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
    const balances = await this.makeRequest('GET', `/brokerage/accounts/${accountId}/balances`);
    
    if (!balances.Balances || balances.Balances.length === 0) {
      return [{
        asset: 'USD',
        availableBalance: 0,
        balance: 0,
      }];
    }
    
    const balance = balances.Balances[0];
    const equity = parseFloat(balance.Equity || 0);
    const cashBalance = parseFloat(balance.CashBalance || 0);
    
    return [{
      asset: 'USD',
      availableBalance: cashBalance,
      balance: equity,
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const accountId = await this.getDefaultAccountId();
    const balances = await this.makeRequest('GET', `/brokerage/accounts/${accountId}/balances`);
    
    if (!balances.Balances || balances.Balances.length === 0) {
      return 0;
    }
    
    const balance = balances.Balances[0];
    // Use DayTradingBuyingPower for margin accounts, CashBalance for cash accounts
    return parseFloat(balance.DayTradingBuyingPower || balance.MarginBuyingPower || balance.CashBalance || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const accountId = await this.getDefaultAccountId();
    const positions = await this.makeRequest('GET', `/brokerage/accounts/${accountId}/positions`);
    
    if (!positions.Positions || !Array.isArray(positions.Positions)) {
      return [];
    }
    
    return positions.Positions.map(position => {
      const qty = parseFloat(position.Quantity || 0);
      const avgPrice = parseFloat(position.AveragePrice || 0);
      const lastPrice = parseFloat(position.Last || 0);
      
      return {
        symbol: position.Symbol,
        positionAmt: qty.toString(),
        entryPrice: avgPrice,
        markPrice: lastPrice,
        unRealizedProfit: parseFloat(position.UnrealizedProfitLoss || 0),
      };
    });
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const accountId = await this.getDefaultAccountId();
    const positions = await this.makeRequest('GET', `/brokerage/accounts/${accountId}/positions`, null, {
      symbol: symbol,
    });
    
    if (!positions.Positions || positions.Positions.length === 0) {
      return null;
    }
    
    const position = positions.Positions[0];
    const qty = parseFloat(position.Quantity || 0);
    
    if (qty === 0) {
      return null;
    }
    
    return {
      symbol: position.Symbol,
      positionAmt: qty.toString(),
      entryPrice: parseFloat(position.AveragePrice || 0),
      markPrice: parseFloat(position.Last || 0),
      unRealizedProfit: parseFloat(position.UnrealizedProfitLoss || 0),
    };
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
    const quotes = await this.makeRequest('GET', `/marketdata/quotes/${symbol}`);
    
    if (!quotes.Quotes || quotes.Quotes.length === 0) {
      throw new Error(`Symbol ${symbol} not found on TradeStation`);
    }
    
    const quote = quotes.Quotes[0];
    
    return {
      symbol: quote.Symbol,
      price: quote.Last || quote.Close || '0',
      lastPrice: quote.Last || quote.Close || '0',
      bid: quote.Bid || '0',
      ask: quote.Ask || '0',
    };
  }

  // ==================== Order Methods ====================

  /**
   * Generate order confirm ID (1-22 characters, unique per API key, per order, per user)
   */
  generateOrderConfirmId() {
    // Use UUID, truncate to 22 chars max
    return uuidv4().replace(/-/g, '').substring(0, 22);
  }

  /**
   * Map side to TradeAction
   */
  getTradeAction(side, assetType = 'stock') {
    const sideLower = side.toLowerCase();
    
    if (assetType === 'options') {
      // For options, we need to determine if opening or closing
      // Default to opening for simplicity (can be enhanced)
      return sideLower === 'buy' ? 'BUYTOOPEN' : 'SELLTOOPEN';
    }
    
    // For stocks/futures
    return sideLower === 'buy' ? 'BUY' : 'SELL';
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const accountId = await this.getDefaultAccountId();
    const orderConfirmId = this.generateOrderConfirmId();
    
    const orderRequest = {
      AccountID: accountId,
      Symbol: symbol,
      Quantity: Math.abs(quantity).toString(),
      OrderType: 'Market',
      TradeAction: this.getTradeAction(side),
      TimeInForce: {
        Duration: 'DAY',
      },
      Route: 'Intelligent',
      OrderConfirmID: orderConfirmId,
    };
    
    logger.info('Placing TradeStation market order', { symbol, side, quantity, accountId, orderConfirmId });
    
    const response = await this.makeRequest('POST', '/orderexecution/orders', orderRequest);
    
    if (!response.Orders || response.Orders.length === 0) {
      throw new Error('TradeStation order placement failed: No order returned');
    }
    
    const order = response.Orders[0];
    
    return {
      orderId: order.OrderID,
      clientOrderId: orderConfirmId,
      status: order.Status || 'pending',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const accountId = await this.getDefaultAccountId();
    const orderConfirmId = this.generateOrderConfirmId();
    
    const orderRequest = {
      AccountID: accountId,
      Symbol: symbol,
      Quantity: Math.abs(quantity).toString(),
      OrderType: 'Limit',
      LimitPrice: parseFloat(price).toFixed(2),
      TradeAction: this.getTradeAction(side),
      TimeInForce: {
        Duration: 'DAY',
      },
      Route: 'Intelligent',
      OrderConfirmID: orderConfirmId,
    };
    
    logger.info('Placing TradeStation limit order', { symbol, side, quantity, price, accountId, orderConfirmId });
    
    const response = await this.makeRequest('POST', '/orderexecution/orders', orderRequest);
    
    if (!response.Orders || response.Orders.length === 0) {
      throw new Error('TradeStation order placement failed: No order returned');
    }
    
    const order = response.Orders[0];
    
    return {
      orderId: order.OrderID,
      clientOrderId: orderConfirmId,
      status: order.Status || 'pending',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const accountId = await this.getDefaultAccountId();
    const orderConfirmId = this.generateOrderConfirmId();
    
    const orderRequest = {
      AccountID: accountId,
      Symbol: symbol,
      Quantity: Math.abs(quantity).toString(),
      OrderType: limitPrice ? 'StopLimit' : 'StopMarket',
      StopPrice: parseFloat(stopPrice).toFixed(2),
      TradeAction: this.getTradeAction(side),
      TimeInForce: {
        Duration: 'DAY',
      },
      Route: 'Intelligent',
      OrderConfirmID: orderConfirmId,
    };
    
    if (limitPrice) {
      orderRequest.LimitPrice = parseFloat(limitPrice).toFixed(2);
    }
    
    logger.info('Placing TradeStation stop loss order', { symbol, side, quantity, stopPrice, limitPrice, accountId, orderConfirmId });
    
    const response = await this.makeRequest('POST', '/orderexecution/orders', orderRequest);
    
    if (!response.Orders || response.Orders.length === 0) {
      throw new Error('TradeStation order placement failed: No order returned');
    }
    
    const order = response.Orders[0];
    
    return {
      orderId: order.OrderID,
      clientOrderId: orderConfirmId,
      status: order.Status || 'pending',
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
    // Remove dashes from order ID if present
    const cleanOrderId = orderId.toString().replace(/-/g, '');
    
    logger.info('Canceling TradeStation order', { symbol, orderId: cleanOrderId });
    
    const response = await this.makeRequest('DELETE', `/orderexecution/orders/${cleanOrderId}`);
    
    return {
      orderId: cleanOrderId,
      status: 'canceled',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    const accountId = await this.getDefaultAccountId();
    
    // Remove dashes from order ID if present
    const cleanOrderId = orderId.toString().replace(/-/g, '');
    
    try {
      const orders = await this.makeRequest('GET', `/brokerage/accounts/${accountId}/orders/${cleanOrderId}`);
      
      if (!orders.Orders || orders.Orders.length === 0) {
        // Order not found, return pending status
        return {
          OrderID: cleanOrderId,
          Status: 'OPN',
          StatusDescription: 'Order not found',
        };
      }
      
      return orders.Orders[0];
    } catch (error) {
      // If order not found, return pending status
      if (error.response && error.response.status === 404) {
        logger.warn('TradeStation order not found', { orderId: cleanOrderId });
        return {
          OrderID: cleanOrderId,
          Status: 'OPN',
          StatusDescription: 'Order not found',
        };
      }
      throw error;
    }
  }
}

module.exports = TradeStationAPI;
