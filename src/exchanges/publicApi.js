const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class PublicAPI extends BaseExchangeAPI {
  constructor(secretKey, accountId = null, tokenValidityMinutes = 1440, environment = 'production') {
    super({ secretKey, accountId, tokenValidityMinutes, environment });
    this.secretKey = secretKey;
    this.accountId = accountId;
    this.tokenValidityMinutes = tokenValidityMinutes || 1440; // Default 24 hours
    this.environment = environment;
    this.exchangeName = 'public';
    
    // Base URLs
    this.apiUrl = 'https://api.public.com';
    this.authUrl = `${this.apiUrl}/userapiauthservice/personal/access-tokens`;
    this.tradingUrl = `${this.apiUrl}/userapigateway/trading`;
    this.marketDataUrl = `${this.apiUrl}/userapigateway/marketdata`;
    this.optionDetailsUrl = `${this.apiUrl}/userapigateway/option-details`;
    
    // Token management
    this.accessToken = null;
    this.tokenExpiresAt = null;
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Exchange secret key for access token
   */
  async refreshToken() {
    try {
      const response = await axios.post(
        this.authUrl,
        {
          validityInMinutes: this.tokenValidityMinutes,
          secret: this.secretKey,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      this.accessToken = response.data.accessToken;
      this.tokenExpiresAt = Date.now() + (this.tokenValidityMinutes * 60 * 1000);
      
      logger.info('Public.com access token refreshed', {
        expiresAt: new Date(this.tokenExpiresAt).toISOString(),
        validityMinutes: this.tokenValidityMinutes,
      });
      
      return this.accessToken;
    } catch (error) {
      logger.logError('Public.com token refresh failed', error);
      
      if (error.response && error.response.status === 401) {
        throw new Error('Invalid Public.com secret key. Please check your credentials.');
      }
      
      throw error;
    }
  }

  /**
   * Ensure valid access token (refresh if needed)
   */
  async ensureValidToken() {
    const now = Date.now();
    
    // Refresh if no token or expires within 1 hour
    if (!this.accessToken || now >= (this.tokenExpiresAt - 3600000)) {
      await this.refreshToken();
    }
  }

  /**
   * Get default account ID if not provided
   */
  async getDefaultAccountId() {
    if (this.accountId) {
      return this.accountId;
    }
    
    const accounts = await this.makeRequest('GET', '/userapigateway/trading/account');
    
    if (!accounts || !accounts.accounts || accounts.accounts.length === 0) {
      throw new Error('No Public.com accounts found');
    }
    
    // Use first BROKERAGE account, or first account if no brokerage
    const brokerageAccount = accounts.accounts.find(acc => acc.accountType === 'BROKERAGE');
    const defaultAccount = brokerageAccount || accounts.accounts[0];
    
    this.accountId = defaultAccount.accountId;
    logger.info('Auto-detected Public.com account ID', { accountId: this.accountId });
    
    return this.accountId;
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
      url: endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`,
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
        logger.logError('Public.com API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response.data,
          duration,
        });
        
        // If 401, token might be expired - refresh and retry once
        if (statusCode === 401 && retryCount === 0) {
          logger.info('Public.com request failed with 401, refreshing token and retrying');
          await this.refreshToken();
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Public.com request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Public.com network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Public.com request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
    const accountId = await this.getDefaultAccountId();
    const portfolio = await this.makeRequest('GET', `${this.tradingUrl}/${accountId}/portfolio/v2`);
    
    const buyingPower = portfolio.buyingPower || {};
    const cashOnly = parseFloat(buyingPower.cashOnlyBuyingPower || 0);
    const totalBuyingPower = parseFloat(buyingPower.buyingPower || 0);
    
    // Calculate total equity from equity array
    let totalEquity = 0;
    if (portfolio.equity && Array.isArray(portfolio.equity)) {
      portfolio.equity.forEach(eq => {
        totalEquity += parseFloat(eq.value || 0);
      });
    }
    
    return [{
      asset: 'USD',
      availableBalance: cashOnly,
      balance: totalEquity || totalBuyingPower,
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const accountId = await this.getDefaultAccountId();
    const portfolio = await this.makeRequest('GET', `${this.tradingUrl}/${accountId}/portfolio/v2`);
    
    const buyingPower = portfolio.buyingPower || {};
    return parseFloat(buyingPower.buyingPower || buyingPower.cashOnlyBuyingPower || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const accountId = await this.getDefaultAccountId();
    const portfolio = await this.makeRequest('GET', `${this.tradingUrl}/${accountId}/portfolio/v2`);
    
    if (!portfolio.positions || !Array.isArray(portfolio.positions)) {
      return [];
    }
    
    return portfolio.positions.map(pos => {
      const quantity = parseFloat(pos.quantity || 0);
      const avgPrice = parseFloat(pos.averagePrice || 0);
      const currentPrice = parseFloat(pos.currentPrice || 0);
      
      return {
        symbol: pos.instrument?.symbol || '',
        positionAmt: quantity.toString(),
        entryPrice: avgPrice,
        markPrice: currentPrice,
        unRealizedProfit: (currentPrice - avgPrice) * quantity,
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
   */
  async getTicker(symbol) {
    const accountId = await this.getDefaultAccountId();
    
    const response = await this.makeRequest('POST', `${this.marketDataUrl}/${accountId}/quotes`, {
      instruments: [
        {
          symbol: symbol,
          type: 'EQUITY', // Default to equity, can be enhanced for options
        },
      ],
    });
    
    if (!response.quotes || response.quotes.length === 0) {
      throw new Error(`No quote data available for ${symbol}`);
    }
    
    const quote = response.quotes[0];
    
    if (quote.outcome !== 'SUCCESS') {
      throw new Error(`Failed to get quote for ${symbol}: ${quote.outcome}`);
    }
    
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
   * Generate UUID v4 for order ID (RFC 4122 compliant)
   */
  generateOrderId() {
    return uuidv4();
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity, amount = null) {
    const accountId = await this.getDefaultAccountId();
    const orderId = this.generateOrderId();
    
    const orderData = {
      orderId: orderId,
      instrument: {
        symbol: symbol,
        type: 'EQUITY', // Default to equity
      },
      orderSide: side.toUpperCase(),
      orderType: 'MARKET',
      expiration: {
        timeInForce: 'DAY',
      },
    };
    
    // Use amount for fractional or quantity for whole shares
    if (amount) {
      orderData.amount = amount.toString();
    } else {
      orderData.quantity = Math.abs(quantity).toString();
    }
    
    logger.info('Placing Public.com market order', { symbol, side, quantity, amount, accountId, orderId });
    const response = await this.makeRequest('POST', `${this.tradingUrl}/${accountId}/order`, orderData);
    
    return {
      orderId: response.orderId || orderId,
      status: 'pending',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price, amount = null) {
    const accountId = await this.getDefaultAccountId();
    const orderId = this.generateOrderId();
    
    const orderData = {
      orderId: orderId,
      instrument: {
        symbol: symbol,
        type: 'EQUITY', // Default to equity
      },
      orderSide: side.toUpperCase(),
      orderType: 'LIMIT',
      expiration: {
        timeInForce: 'DAY',
      },
      limitPrice: parseFloat(price).toString(),
    };
    
    // Use amount for fractional or quantity for whole shares
    if (amount) {
      orderData.amount = amount.toString();
    } else {
      orderData.quantity = Math.abs(quantity).toString();
    }
    
    logger.info('Placing Public.com limit order', { symbol, side, quantity, price, amount, accountId, orderId });
    const response = await this.makeRequest('POST', `${this.tradingUrl}/${accountId}/order`, orderData);
    
    return {
      orderId: response.orderId || orderId,
      status: 'pending',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const accountId = await this.getDefaultAccountId();
    const orderId = this.generateOrderId();
    
    const orderData = {
      orderId: orderId,
      instrument: {
        symbol: symbol,
        type: 'EQUITY',
      },
      orderSide: side.toUpperCase(),
      orderType: limitPrice ? 'STOP_LIMIT' : 'STOP',
      expiration: {
        timeInForce: 'DAY',
      },
      stopPrice: parseFloat(stopPrice).toString(),
      quantity: Math.abs(quantity).toString(),
    };
    
    if (limitPrice) {
      orderData.limitPrice = parseFloat(limitPrice).toString();
    }
    
    logger.info('Placing Public.com stop loss order', { symbol, side, quantity, stopPrice, limitPrice, accountId, orderId });
    const response = await this.makeRequest('POST', `${this.tradingUrl}/${accountId}/order`, orderData);
    
    return {
      orderId: response.orderId || orderId,
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
    logger.info('Canceling Public.com order', { symbol, orderId, accountId });
    
    try {
      await this.makeRequest('DELETE', `${this.tradingUrl}/${accountId}/order/${orderId}`);
      
      return {
        orderId: orderId.toString(),
        status: 'canceled',
      };
    } catch (error) {
      // If 404, order might not be indexed yet (eventual consistency)
      // Return canceled status anyway as cancellation was requested
      if (error.response && error.response.status === 404) {
        logger.warn('Public.com order not found for cancellation (may not be indexed yet)', { orderId });
        return {
          orderId: orderId.toString(),
          status: 'canceled',
        };
      }
      throw error;
    }
  }

  /**
   * Get order status
   * Note: Order placement is asynchronous, may return 404 if not yet indexed
   */
  async getOrder(symbol, orderId) {
    const accountId = await this.getDefaultAccountId();
    
    try {
      return await this.makeRequest('GET', `${this.tradingUrl}/${accountId}/order/${orderId}`);
    } catch (error) {
      // If 404, order might not be indexed yet (eventual consistency)
      if (error.response && error.response.status === 404) {
        logger.warn('Public.com order not found (may not be indexed yet)', { orderId });
        // Return pending status
        return {
          orderId: orderId.toString(),
          status: 'NEW',
          instrument: { symbol: symbol },
        };
      }
      throw error;
    }
  }
}

module.exports = PublicAPI;
