const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class CapitalAPI extends BaseExchangeAPI {
  constructor(apiKey, login, password, accountId = null, environment = 'production') {
    super({ apiKey, login, password, accountId, environment });
    this.apiKey = apiKey;
    this.login = login;
    this.password = password;
    this.accountId = accountId;
    this.environment = environment;
    this.exchangeName = 'capital';
    
    // Set API URL based on environment
    const isDemo = environment === 'demo' || environment === 'sandbox' || environment === 'test';
    this.baseUrl = isDemo
      ? 'https://demo-api-capital.backend-capital.com'
      : 'https://api-capital.backend-capital.com';
    
    // Session management
    this.cstToken = null;
    this.securityToken = null;
    this.sessionCreatedAt = null;
    this.sessionExpiryMs = 10 * 60 * 1000; // 10 minutes
    this.sessionRefreshThreshold = 8 * 60 * 1000; // Refresh if < 2 minutes remaining
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Start new session and get tokens
   */
  async startSession() {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/session`,
        {
          identifier: this.login,
          password: this.password,
          encryptedPassword: false,
        },
        {
          headers: {
            'X-CAP-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );
      
      // Extract tokens from response headers
      this.cstToken = response.headers['cst'] || response.headers['CST'];
      this.securityToken = response.headers['x-security-token'] || response.headers['X-SECURITY-TOKEN'];
      this.sessionCreatedAt = Date.now();
      
      // Extract account info from response
      if (response.data && !this.accountId) {
        this.accountId = response.data.currentAccountId;
      }
      
      if (!this.cstToken || !this.securityToken) {
        throw new Error('Failed to receive session tokens from Capital.com');
      }
      
      logger.info('Capital.com session started', {
        accountId: this.accountId,
        hasTokens: !!(this.cstToken && this.securityToken),
      });
      
      return {
        cstToken: this.cstToken,
        securityToken: this.securityToken,
        accountId: this.accountId,
        accountInfo: response.data?.accountInfo,
      };
    } catch (error) {
      logger.logError('Capital.com session start failed', error);
      throw error;
    }
  }

  /**
   * Ensure valid session (refresh if needed)
   */
  async ensureSession() {
    const now = Date.now();
    const sessionAge = this.sessionCreatedAt ? now - this.sessionCreatedAt : Infinity;
    
    // Refresh if no session or close to expiry
    if (!this.cstToken || !this.securityToken || sessionAge > this.sessionRefreshThreshold) {
      logger.info('Refreshing Capital.com session');
      await this.startSession();
    }
  }

  /**
   * Make authenticated API request with retry logic and session management
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    // Ensure valid session before request
    await this.ensureSession();
    
    const headers = {
      'CST': this.cstToken,
      'X-SECURITY-TOKEN': this.securityToken,
      'Content-Type': 'application/json',
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
        logger.logError('Capital.com API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response.data,
          duration,
        });
        
        // If 401, refresh session and retry once
        if (statusCode === 401 && retryCount === 0) {
          logger.info('Capital.com session expired, refreshing and retrying');
          this.cstToken = null;
          this.securityToken = null;
          this.sessionCreatedAt = null;
          await this.ensureSession();
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Capital.com request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Capital.com network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Capital.com request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  /**
   * Map symbol to epic (Capital.com uses epics instead of symbols)
   */
  async getEpic(symbol) {
    try {
      const response = await this.makeRequest('GET', `/api/v1/markets?searchTerm=${encodeURIComponent(symbol)}`);
      const markets = response.markets || [];
      
      if (markets.length > 0) {
        const epic = markets[0].epic;
        logger.info(`Mapped symbol ${symbol} to epic ${epic}`);
        return epic;
      }
      
      throw new Error(`Epic not found for symbol: ${symbol}`);
    } catch (error) {
      logger.logError(`Failed to map symbol to epic: ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get market details for epic
   */
  async getMarketDetails(epic) {
    return this.makeRequest('GET', `/api/v1/markets/${epic}`);
  }

  // ==================== Account Methods ====================

  /**
   * Get account balance
   */
  async getBalance() {
    // Session response already contains balance info, but we can also get from accounts
    const response = await this.makeRequest('GET', '/api/v1/accounts');
    const accounts = response.accounts || [];
    
    if (accounts.length === 0) {
      throw new Error('No Capital.com accounts found');
    }
    
    // Use current account or first account
    const account = accounts.find(acc => acc.accountId === this.accountId) || accounts[0];
    const balance = account.balance || {};
    
    return [{
      asset: account.currency || 'USD',
      availableBalance: parseFloat(balance.available || 0),
      balance: parseFloat(balance.balance || 0),
    }];
  }

  /**
   * Get available margin (available balance)
   */
  async getAvailableMargin() {
    const balance = await this.getBalance();
    return balance[0]?.availableBalance || 0;
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const response = await this.makeRequest('GET', '/api/v1/positions');
    
    const positions = response.positions || [];
    
    // Convert Capital.com positions to common format
    return positions.map(pos => {
      // Get current market price from position details if available
      const currentLevel = pos.level || 0;
      const openLevel = pos.openLevel || pos.level || 0;
      const direction = pos.direction === 'BUY' ? 1 : -1;
      const size = parseFloat(pos.size || 0);
      const upl = parseFloat(pos.upl || 0);
      
      return {
        symbol: pos.epic || 'UNKNOWN',
        positionAmt: (size * direction).toString(),
        entryPrice: parseFloat(openLevel),
        markPrice: parseFloat(currentLevel),
        unRealizedProfit: upl,
        dealId: pos.dealId, // Store dealId for position operations
      };
    });
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    try {
      // First, get epic for symbol
      const epic = await this.getEpic(symbol);
      
      // Get all positions and find matching epic
      const positions = await this.getPositions();
      const position = positions.find(p => {
        // Position epic might match directly
        if (p.symbol === epic) return true;
        // Or try to match by symbol if epic lookup was done
        return p.symbol.toUpperCase() === symbol.toUpperCase();
      });
      
      return position || null;
    } catch (error) {
      // If epic not found, try searching positions directly by symbol
      try {
        const positions = await this.getPositions();
        const position = positions.find(p => 
          p.symbol.toUpperCase() === symbol.toUpperCase()
        );
        return position || null;
      } catch (error2) {
        // If epic lookup fails, return null (no position)
        if (error.message && error.message.includes('Epic not found')) {
          return null;
        }
        throw error;
      }
    }
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
    try {
      // Get epic for symbol
      const epic = await this.getEpic(symbol);
      
      // Get market details
      const market = await this.getMarketDetails(epic);
      const snapshot = market.snapshot || {};
      
      const bid = parseFloat(snapshot.bid || 0);
      const offer = parseFloat(snapshot.offer || 0);
      const midPrice = bid && offer ? ((bid + offer) / 2) : (bid || offer || 0);
      
      if (!midPrice || midPrice === 0) {
        throw new Error(`No price data available for ${symbol}`);
      }
      
      return {
        symbol: epic,
        price: midPrice.toString(),
        lastPrice: midPrice.toString(),
        bid: bid.toString(),
        ask: offer.toString(),
      };
    } catch (error) {
      logger.logError(`Failed to get ticker for ${symbol}`, error);
      throw new Error(`No price data available for ${symbol}`);
    }
  }

  // ==================== Order Methods ====================

  /**
   * Confirm deal status (required after opening position)
   */
  async confirmDeal(dealReference) {
    return this.makeRequest('GET', `/api/v1/confirms/${dealReference}`);
  }

  /**
   * Open position (market order)
   */
  async placeMarketOrder(symbol, side, quantity) {
    // Get epic for symbol
    const epic = await this.getEpic(symbol);
    
    const orderData = {
      epic: epic,
      direction: side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      size: Math.abs(quantity),
    };
    
    logger.info('Opening Capital.com position', { symbol, epic, side, quantity });
    const response = await this.makeRequest('POST', '/api/v1/positions', orderData);
    
    const dealReference = response.dealReference;
    if (!dealReference) {
      throw new Error('No deal reference returned from Capital.com');
    }
    
    // Confirm the deal to get actual dealId
    try {
      const confirm = await this.confirmDeal(dealReference);
      const dealId = confirm.dealId || dealReference;
      
      return {
        orderId: dealId,
        dealReference: dealReference,
        status: confirm.dealStatus || 'OPEN',
      };
    } catch (error) {
      // If confirmation fails, still return deal reference
      logger.warn('Failed to confirm Capital.com deal', { dealReference, error: error.message });
      return {
        orderId: dealReference,
        dealReference: dealReference,
        status: 'PENDING',
      };
    }
  }

  /**
   * Place limit order (working order)
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    // Get epic for symbol
    const epic = await this.getEpic(symbol);
    
    const orderData = {
      epic: epic,
      direction: side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      size: Math.abs(quantity),
      level: parseFloat(price),
      type: 'LIMIT',
    };
    
    logger.info('Creating Capital.com limit order', { symbol, epic, side, quantity, price });
    const response = await this.makeRequest('POST', '/api/v1/workingorders', orderData);
    
    return {
      orderId: response.dealReference,
      dealReference: response.dealReference,
      status: 'OPEN',
    };
  }

  /**
   * Place stop loss order
   * Note: Capital.com allows setting stop loss when opening position or updating existing position
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    // For Capital.com, stop loss is set on position, not as separate order
    // We need to find existing position or open new one with stop loss
    
    // Check if position exists
    const position = await this.getPosition(symbol);
    
    if (position) {
      // Update existing position with stop loss
      const dealId = position.dealId || position.orderId;
      if (!dealId) {
        throw new Error(`Cannot update stop loss: position dealId not found for ${symbol}`);
      }
      
      const updateData = {
        stopLevel: parseFloat(stopPrice),
      };
      
      if (limitPrice) {
        // If limit price provided, we'd need to use stopDistance or stopAmount
        // For now, just use stopLevel
        logger.warn('Capital.com stop-limit not fully supported, using stop level only');
      }
      
      logger.info('Updating Capital.com position stop loss', { symbol, dealId, stopPrice });
      const response = await this.makeRequest('PUT', `/api/v1/positions/${dealId}`, updateData);
      
      return {
        orderId: dealId,
        dealReference: response.dealReference,
        status: 'OPEN',
      };
    } else {
      // No position exists, open new position with stop loss
      const epic = await this.getEpic(symbol);
      
      const orderData = {
        epic: epic,
        direction: side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
        size: Math.abs(quantity),
        stopLevel: parseFloat(stopPrice),
      };
      
      logger.info('Opening Capital.com position with stop loss', { symbol, epic, side, quantity, stopPrice });
      const response = await this.makeRequest('POST', '/api/v1/positions', orderData);
      
      const dealReference = response.dealReference;
      
      // Confirm the deal
      try {
        const confirm = await this.confirmDeal(dealReference);
        return {
          orderId: confirm.dealId || dealReference,
          dealReference: dealReference,
          status: confirm.dealStatus || 'OPEN',
        };
      } catch (error) {
        return {
          orderId: dealReference,
          dealReference: dealReference,
          status: 'PENDING',
        };
      }
    }
  }

  /**
   * Place take profit order
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // Similar to stop loss, update existing position or open new one
    const position = await this.getPosition(symbol);
    
    if (position) {
      // Update existing position with take profit
      const dealId = position.dealId || position.orderId;
      if (!dealId) {
        throw new Error(`Cannot update take profit: position dealId not found for ${symbol}`);
      }
      
      const updateData = {
        profitLevel: parseFloat(takeProfitPrice),
      };
      
      logger.info('Updating Capital.com position take profit', { symbol, dealId, takeProfitPrice });
      const response = await this.makeRequest('PUT', `/api/v1/positions/${dealId}`, updateData);
      
      return {
        orderId: dealId,
        dealReference: response.dealReference,
        status: 'OPEN',
      };
    } else {
      // No position exists, open new position with take profit
      const epic = await this.getEpic(symbol);
      
      const orderData = {
        epic: epic,
        direction: side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
        size: Math.abs(quantity),
        profitLevel: parseFloat(takeProfitPrice),
      };
      
      logger.info('Opening Capital.com position with take profit', { symbol, epic, side, quantity, takeProfitPrice });
      const response = await this.makeRequest('POST', '/api/v1/positions', orderData);
      
      const dealReference = response.dealReference;
      
      // Confirm the deal
      try {
        const confirm = await this.confirmDeal(dealReference);
        return {
          orderId: confirm.dealId || dealReference,
          dealReference: dealReference,
          status: confirm.dealStatus || 'OPEN',
        };
      } catch (error) {
        return {
          orderId: dealReference,
          dealReference: dealReference,
          status: 'PENDING',
        };
      }
    }
  }

  /**
   * Close position
   */
  async closePosition(symbol, side, quantity) {
    // Get position
    const position = await this.getPosition(symbol);
    
    if (!position) {
      throw new Error(`No position found for ${symbol}`);
    }
    
    const dealId = position.dealId || position.orderId;
    if (!dealId) {
      throw new Error(`Cannot close position: dealId not found for ${symbol}`);
    }
    
    logger.info('Closing Capital.com position', { symbol, dealId });
    const response = await this.makeRequest('DELETE', `/api/v1/positions/${dealId}`);
    
    return {
      orderId: dealId,
      dealReference: response.dealReference || dealId,
      status: 'CLOSED',
    };
  }

  /**
   * Cancel order (working order)
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Capital.com order', { symbol, orderId });
    const response = await this.makeRequest('DELETE', `/api/v1/workingorders/${orderId}`);
    
    return {
      orderId: orderId,
      dealReference: response.dealReference || orderId,
      status: 'CANCELLED',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    // Try to get as position first
    try {
      const position = await this.makeRequest('GET', `/api/v1/positions/${orderId}`);
      return position;
    } catch (error) {
      // If not found as position, try as working order
      try {
        const workingOrder = await this.makeRequest('GET', `/api/v1/workingorders/${orderId}`);
        return workingOrder;
      } catch (error2) {
        throw new Error(`Order ${orderId} not found as position or working order`);
      }
    }
  }
}

module.exports = CapitalAPI;
