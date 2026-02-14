const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class TradierAPI extends BaseExchangeAPI {
  constructor(accountId, accessToken, environment = 'sandbox') {
    super({ accountId, accessToken, environment });
    this.accountId = accountId;
    this.accessToken = accessToken;
    this.environment = environment;
    this.exchangeName = 'tradier';
    
    // Set API URL based on environment
    this.apiUrl = environment === 'live' 
      ? 'https://api.tradier.com/v1'
      : 'https://sandbox.tradier.com/v1';
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
    };

    const config = {
      method,
      url: `${this.apiUrl}${endpoint}`,
      headers,
    };

    // For POST requests, send as form data
    if (data && method === 'POST') {
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      config.data = new URLSearchParams(data).toString();
    } else if (data && method === 'GET') {
      config.params = data;
    }

    try {
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      logger.logApiCall(method, endpoint, response.status, duration);
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response) {
        logger.logError('Tradier API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Tradier request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Tradier network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Tradier request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  // ==================== Account Methods ====================

  /**
   * Get account balances
   */
  async getAccountBalances() {
    return this.makeRequest('GET', `/accounts/${this.accountId}/balances`);
  }

  /**
   * Get account balance
   */
  async getBalance() {
    const response = await this.getAccountBalances();
    const balances = response.balances;
    
    return [{
      asset: 'USD',
      availableBalance: parseFloat(balances.cash_available || balances.total_cash || 0),
      balance: parseFloat(balances.total_equity || 0),
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const response = await this.getAccountBalances();
    const balances = response.balances;
    return parseFloat(balances.option_buying_power || balances.stock_buying_power || balances.cash_available || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const response = await this.makeRequest('GET', `/accounts/${this.accountId}/positions`);
    
    if (!response.positions || !response.positions.position) {
      return [];
    }
    
    // Tradier returns single position as object, multiple as array
    const positions = Array.isArray(response.positions.position) 
      ? response.positions.position 
      : [response.positions.position];
    
    // Convert to common format
    return positions.map(pos => ({
      symbol: pos.symbol,
      positionAmt: pos.quantity.toString(),
      entryPrice: parseFloat(pos.cost_basis) / parseFloat(pos.quantity),
      markPrice: null, // Will be fetched separately if needed
      unRealizedProfit: parseFloat((pos.quantity * (pos.last - (pos.cost_basis / pos.quantity))).toFixed(2)),
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
    const response = await this.makeRequest('GET', '/markets/quotes', { 
      symbols: symbol,
      greeks: false 
    });
    
    if (!response.quotes || !response.quotes.quote) {
      throw new Error(`No price data for ${symbol}`);
    }
    
    const quote = response.quotes.quote;
    
    return {
      symbol: quote.symbol,
      price: quote.last.toString(),
      lastPrice: quote.last.toString(),
      bid: quote.bid,
      ask: quote.ask,
    };
  }

  // ==================== Order Methods ====================

  /**
   * Place market order for stocks/ETFs
   */
  async placeMarketOrder(symbol, side, quantity) {
    const orderData = {
      account_id: this.accountId,
      class: 'equity',
      symbol: symbol,
      side: side.toLowerCase(), // 'buy' or 'sell'
      quantity: Math.abs(quantity).toString(),
      type: 'market',
      duration: 'day',
    };
    
    logger.info('Placing Tradier market order', orderData);
    const response = await this.makeRequest('POST', `/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.order?.id || response.order?.order_id,
      status: response.order?.status || 'pending',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const orderData = {
      account_id: this.accountId,
      class: 'equity',
      symbol: symbol,
      side: side.toLowerCase(),
      quantity: Math.abs(quantity).toString(),
      type: 'limit',
      price: price.toString(),
      duration: 'gtc', // Good til cancelled
    };
    
    logger.info('Placing Tradier limit order', orderData);
    const response = await this.makeRequest('POST', `/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.order?.id || response.order?.order_id,
      status: response.order?.status || 'pending',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    const orderData = {
      account_id: this.accountId,
      class: 'equity',
      symbol: symbol,
      side: side.toLowerCase(),
      quantity: Math.abs(quantity).toString(),
      type: 'stop',
      stop: stopPrice.toString(),
      duration: 'gtc',
    };
    
    logger.info('Placing Tradier stop loss', orderData);
    const response = await this.makeRequest('POST', `/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.order?.id || response.order?.order_id,
      status: response.order?.status || 'pending',
    };
  }

  /**
   * Place take profit order (limit order)
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // Take profit is a limit order to close position
    const orderData = {
      account_id: this.accountId,
      class: 'equity',
      symbol: symbol,
      side: side.toLowerCase(),
      quantity: Math.abs(quantity).toString(),
      type: 'limit',
      price: takeProfitPrice.toString(),
      duration: 'gtc',
    };
    
    logger.info('Placing Tradier take profit', orderData);
    const response = await this.makeRequest('POST', `/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.order?.id || response.order?.order_id,
      status: response.order?.status || 'pending',
    };
  }

  /**
   * Close position (market order to close)
   */
  async closePosition(symbol, side, quantity) {
    // Close is just a market order in opposite direction
    const orderData = {
      account_id: this.accountId,
      class: 'equity',
      symbol: symbol,
      side: side.toLowerCase(), // Already opposite side from caller
      quantity: Math.abs(quantity).toString(),
      type: 'market',
      duration: 'day',
    };
    
    logger.info('Closing Tradier position', orderData);
    const response = await this.makeRequest('POST', `/accounts/${this.accountId}/orders`, orderData);
    
    return {
      orderId: response.order?.id || response.order?.order_id,
      status: response.order?.status || 'pending',
    };
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Tradier order', { symbol, orderId });
    const response = await this.makeRequest('DELETE', `/accounts/${this.accountId}/orders/${orderId}`);
    
    return {
      orderId: orderId,
      status: 'canceled',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/accounts/${this.accountId}/orders/${orderId}`);
  }

  /**
   * Get account profile
   */
  async getProfile() {
    return this.makeRequest('GET', '/user/profile');
  }

  /**
   * Check if market is open (for stocks)
   */
  async isMarketOpen() {
    const response = await this.makeRequest('GET', '/markets/clock');
    return response.clock?.state === 'open';
  }

  /**
   * Get market calendar
   */
  async getMarketCalendar() {
    return this.makeRequest('GET', '/markets/calendar');
  }

  // ==================== Trade History Methods ====================

  /**
   * Get recent trade history (fills) from Tradier.
   * Uses the account history endpoint filtered to trade events.
   * Returns normalized format matching the common fills interface.
   * 
   * @param {string} [symbol] - Optional symbol to filter by (e.g., "AAPL")
   * @param {number} [limit=50] - Maximum number of fills to return
   * @returns {Promise<Array>} Normalized trade history
   */
  async getTradeHistory(symbol, limit = 50) {
    try {
      // Fetch account history (includes trades, adjustments, etc.)
      const response = await this.makeRequest('GET', `/accounts/${this.accountId}/history`);
      
      if (!response.history || !response.history.event) {
        return [];
      }
      
      // Tradier returns single event as object, multiple as array
      let events = Array.isArray(response.history.event) 
        ? response.history.event 
        : [response.history.event];
      
      // Filter to trade events only
      events = events.filter(e => e.type === 'trade');
      
      // Filter by symbol if specified
      if (symbol) {
        events = events.filter(e => {
          const trade = e.trade || {};
          return trade.symbol === symbol;
        });
      }
      
      // Take the most recent N fills
      events = events.slice(-limit).reverse();
      
      // Normalize to common format
      return events.map(e => {
        const trade = e.trade || {};
        const qty = parseFloat(trade.quantity || 0);
        const price = parseFloat(trade.price || 0);
        const commission = parseFloat(trade.commission || 0);
        
        return {
          orderId: trade.order_id || e.id,
          id: e.id,
          symbol: trade.symbol,
          side: (trade.trade_type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL',
          qty: qty.toString(),
          quantity: qty,
          price: price,
          commission: Math.abs(commission),
          fee: Math.abs(commission),
          time: e.date || trade.date,
          timestamp: e.date || trade.date,
          // Tradier doesn't include realized P&L per trade in history
          // We calculate it from the cost basis if available
          realizedPnl: parseFloat(trade.gainloss || 0),
          realizedProfit: parseFloat(trade.gainloss || 0),
          description: trade.description || '',
        };
      });
    } catch (error) {
      logger.logError('Tradier getTradeHistory failed', error);
      return [];
    }
  }
}

module.exports = TradierAPI;

