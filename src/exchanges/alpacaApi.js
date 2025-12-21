const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class AlpacaAPI extends BaseExchangeAPI {
  constructor(apiKey, apiSecret, environment = 'production') {
    super({ apiKey, apiSecret, environment });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.environment = environment;
    this.exchangeName = 'alpaca';
    
    // Set API URL based on environment
    // Alpaca uses 'paper' for paper trading, 'production' or 'live' for live
    // Also accept 'sandbox' as alias for 'paper'
    const isPaper = environment === 'paper' || environment === 'sandbox' || environment === 'practice';
    this.apiUrl = isPaper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
    
    // Market Data API URL (separate from Trading API)
    this.marketDataUrl = 'https://data.alpaca.markets';
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Make authenticated API request with retry logic
   * Alpaca uses API Key + Secret in headers (Legacy Authentication)
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.apiSecret,
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
        logger.logError('Alpaca API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Alpaca request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Alpaca network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Alpaca request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  /**
   * Make Market Data API request (separate from Trading API)
   * Market Data API uses same authentication headers
   */
  async makeMarketDataRequest(method, endpoint, params = null, retryCount = 0) {
    const startTime = Date.now();
    
    const headers = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.apiSecret,
      'Content-Type': 'application/json',
    };

    const config = {
      method,
      url: `${this.marketDataUrl}${endpoint}`,
      headers,
    };

    if (params && method === 'GET') {
      config.params = params;
    } else if (params) {
      config.data = params;
    }

    try {
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      logger.logApiCall(method, endpoint, response.status, duration);
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response) {
        logger.logError('Alpaca Market Data API request failed', error, {
          method,
          endpoint,
          status: error.response.status,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((error.response.status >= 500 || error.response.status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Alpaca Market Data request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeMarketDataRequest(method, endpoint, params, retryCount + 1);
        }
      } else {
        logger.logError('Alpaca Market Data network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Alpaca Market Data request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeMarketDataRequest(method, endpoint, params, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  // ==================== Account Methods ====================

  /**
   * Get account information
   */
  async getAccount() {
    return this.makeRequest('GET', '/v2/account');
  }

  /**
   * Get account balance
   * Returns array of balance objects (common format)
   */
  async getBalance() {
    const account = await this.getAccount();
    
    return [{
      asset: 'USD',
      availableBalance: parseFloat(account.cash || 0),
      balance: parseFloat(account.portfolio_value || account.equity || 0),
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const account = await this.getAccount();
    return parseFloat(account.buying_power || 0);
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions
   */
  async getPositions() {
    const response = await this.makeRequest('GET', '/v2/positions');
    
    // Convert Alpaca positions to common format
    return response.map(pos => ({
      symbol: pos.symbol,
      positionAmt: pos.qty.toString(),
      entryPrice: parseFloat(pos.avg_entry_price || 0),
      markPrice: parseFloat(pos.market_value / parseFloat(pos.qty) || 0), // Approximate from market value
      unRealizedProfit: parseFloat(pos.unrealized_pl || 0),
    }));
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    try {
      const position = await this.makeRequest('GET', `/v2/positions/${symbol}`);
      
      return {
        symbol: position.symbol,
        positionAmt: position.qty.toString(),
        entryPrice: parseFloat(position.avg_entry_price || 0),
        markPrice: parseFloat(position.market_value / parseFloat(position.qty) || 0),
        unRealizedProfit: parseFloat(position.unrealized_pl || 0),
      };
    } catch (error) {
      // 404 means no position exists
      if (error.response && error.response.status === 404) {
        return null;
      }
      throw error;
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
   * Uses Market Data API latest trade endpoint
   */
  async getTicker(symbol) {
    try {
      // Try to get latest trade first (most accurate)
      const trade = await this.makeMarketDataRequest('GET', `/v2/stocks/${symbol}/trades/latest`);
      
      if (trade && trade.trade) {
        return {
          symbol: trade.trade.S || symbol,
          price: trade.trade.p?.toString() || '0',
          lastPrice: trade.trade.p?.toString() || '0',
        };
      }
    } catch (error) {
      // If trade fails, try quote
      logger.info(`Latest trade not available for ${symbol}, trying quote...`);
    }
    
    // Fallback to latest quote
    try {
      const quote = await this.makeMarketDataRequest('GET', `/v2/stocks/${symbol}/quotes/latest`);
      
      if (quote && quote.quote) {
        const midPrice = ((parseFloat(quote.quote.bp || 0) + parseFloat(quote.quote.ap || 0)) / 2).toString();
        return {
          symbol: quote.quote.S || symbol,
          price: midPrice,
          lastPrice: midPrice,
          bid: quote.quote.bp?.toString(),
          ask: quote.quote.ap?.toString(),
        };
      }
    } catch (error) {
      logger.logError(`Failed to get ticker for ${symbol}`, error);
      throw new Error(`No price data available for ${symbol}`);
    }
    
    throw new Error(`No price data available for ${symbol}`);
  }

  // ==================== Order Methods ====================

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(), // 'buy' or 'sell'
      type: 'market',
      qty: Math.abs(quantity).toString(),
      time_in_force: 'day',
    };
    
    logger.info('Placing Alpaca market order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: 'limit',
      qty: Math.abs(quantity).toString(),
      limit_price: price.toString(),
      time_in_force: 'gtc', // Good til cancelled
    };
    
    logger.info('Placing Alpaca limit order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place stop loss order
   * Alpaca converts buy stop orders to stop-limit orders automatically
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Position size
   * @param {number} stopPrice - Stop price
   * @param {number} [limitPrice] - Optional limit price (creates stop-limit instead of stop)
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: limitPrice ? 'stop_limit' : 'stop', // Stop-limit if limit price provided
      qty: Math.abs(quantity).toString(),
      stop_price: stopPrice.toString(),
      time_in_force: 'gtc',
    };
    
    // Add limit price if provided (makes it stop-limit)
    if (limitPrice) {
      orderData.limit_price = limitPrice.toString();
    }
    
    logger.info('Placing Alpaca stop loss', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place trailing stop order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Position size
   * @param {number} trailPrice - Dollar offset from high water mark (optional)
   * @param {number} trailPercent - Percentage offset from high water mark (optional)
   * @param {string} timeInForce - 'day' or 'gtc' (default: 'day')
   */
  async placeTrailingStopLoss(symbol, side, quantity, trailPrice = null, trailPercent = null, timeInForce = 'day') {
    if (!trailPrice && !trailPercent) {
      throw new Error('Either trailPrice or trailPercent must be provided for trailing stop');
    }
    
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: 'trailing_stop',
      qty: Math.abs(quantity).toString(),
      time_in_force: timeInForce,
    };
    
    if (trailPrice) {
      orderData.trail_price = trailPrice.toString();
    }
    if (trailPercent) {
      orderData.trail_percent = trailPercent.toString();
    }
    
    logger.info('Placing Alpaca trailing stop', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place take profit order (limit order to close position)
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // Take profit is a limit order with opposite side
    const oppositeSide = side.toLowerCase() === 'buy' ? 'sell' : 'buy';
    
    const orderData = {
      symbol: symbol,
      side: oppositeSide,
      type: 'limit',
      qty: Math.abs(quantity).toString(),
      limit_price: takeProfitPrice.toString(),
      time_in_force: 'gtc',
    };
    
    logger.info('Placing Alpaca take profit', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
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
    
    const orderData = {
      symbol: symbol,
      side: closeSide,
      type: 'market',
      qty: closeQty.toString(),
      time_in_force: 'day',
    };
    
    logger.info('Closing Alpaca position', { symbol, side, quantity, orderData });
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Cancel order
   */
  async cancelOrder(symbol, orderId) {
    logger.info('Canceling Alpaca order', { symbol, orderId });
    await this.makeRequest('DELETE', `/v2/orders/${orderId}`);
    
    return {
      orderId: orderId,
      status: 'canceled',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/v2/orders/${orderId}`);
  }

  /**
   * Place bracket order (entry + stop loss + take profit in one order)
   * This is an Alpaca-specific feature that can be useful
   */
  async placeBracketOrder(symbol, side, quantity, takeProfitPrice, stopLossPrice, stopLossLimitPrice = null) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: 'market', // Entry order type
      qty: Math.abs(quantity).toString(),
      time_in_force: 'gtc',
      order_class: 'bracket',
      take_profit: {
        limit_price: takeProfitPrice.toString(),
      },
      stop_loss: {
        stop_price: stopLossPrice.toString(),
      },
    };
    
    // Add limit price for stop loss if provided (makes it stop-limit instead of stop)
    if (stopLossLimitPrice) {
      orderData.stop_loss.limit_price = stopLossLimitPrice.toString();
    }
    
    logger.info('Placing Alpaca bracket order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place fractional order using notional (USD amount)
   * Alpaca supports fractional shares - can buy as little as $1 worth
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} notional - USD amount (e.g., 100.50 for $100.50)
   * @param {string} orderType - 'market' or 'limit' (default: 'market')
   * @param {number} limitPrice - Limit price (required if orderType is 'limit')
   * @param {boolean} extendedHours - Enable extended hours trading (default: false)
   */
  async placeFractionalOrder(symbol, side, notional, orderType = 'market', limitPrice = null, extendedHours = false) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: orderType,
      notional: notional.toString(), // USD amount instead of qty
      time_in_force: 'day',
      extended_hours: extendedHours,
    };
    
    if (orderType === 'limit' && limitPrice) {
      orderData.limit_price = limitPrice.toString();
    }
    
    logger.info('Placing Alpaca fractional order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place OCO order (One-Cancels-Other)
   * Used for exit orders only (take profit OR stop loss, not both)
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell' (exit side)
   * @param {number} quantity - Position size
   * @param {number} takeProfitPrice - Take profit limit price
   * @param {number} stopLossPrice - Stop loss stop price
   * @param {number} [stopLossLimitPrice] - Optional stop loss limit price (creates stop-limit)
   */
  async placeOCOOrder(symbol, side, quantity, takeProfitPrice, stopLossPrice, stopLossLimitPrice = null) {
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: 'limit', // OCO requires limit type
      qty: Math.abs(quantity).toString(),
      time_in_force: 'gtc',
      order_class: 'oco',
      take_profit: {
        limit_price: takeProfitPrice.toString(),
      },
      stop_loss: {
        stop_price: stopLossPrice.toString(),
      },
    };
    
    // Add limit price for stop loss if provided (makes it stop-limit instead of stop)
    if (stopLossLimitPrice) {
      orderData.stop_loss.limit_price = stopLossLimitPrice.toString();
    }
    
    logger.info('Placing Alpaca OCO order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place OTO order (One-Triggers-Other)
   * Entry order that triggers either TP or SL (not both)
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Position size
   * @param {string} entryType - 'market' or 'limit'
   * @param {number} [entryLimitPrice] - Limit price (required if entryType is 'limit')
   * @param {number} [takeProfitPrice] - Take profit limit price (optional)
   * @param {number} [stopLossPrice] - Stop loss stop price (optional)
   * @param {number} [stopLossLimitPrice] - Optional stop loss limit price
   */
  async placeOTOOrder(symbol, side, quantity, entryType = 'market', entryLimitPrice = null, takeProfitPrice = null, stopLossPrice = null, stopLossLimitPrice = null) {
    if (!takeProfitPrice && !stopLossPrice) {
      throw new Error('Either takeProfitPrice or stopLossPrice must be provided for OTO order');
    }
    
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: entryType,
      qty: Math.abs(quantity).toString(),
      time_in_force: 'gtc',
      order_class: 'oto',
    };
    
    if (entryType === 'limit' && entryLimitPrice) {
      orderData.limit_price = entryLimitPrice.toString();
    }
    
    if (takeProfitPrice) {
      orderData.take_profit = {
        limit_price: takeProfitPrice.toString(),
      };
    }
    
    if (stopLossPrice) {
      orderData.stop_loss = {
        stop_price: stopLossPrice.toString(),
      };
      
      if (stopLossLimitPrice) {
        orderData.stop_loss.limit_price = stopLossLimitPrice.toString();
      }
    }
    
    logger.info('Placing Alpaca OTO order', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }

  /**
   * Place order with extended hours support
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {string} orderType - 'market' or 'limit'
   * @param {number} quantity - Position size (or use notional for fractional)
   * @param {number} [notional] - USD amount for fractional orders
   * @param {number} [limitPrice] - Limit price (required for limit orders)
   * @param {boolean} extendedHours - Enable extended hours trading
   */
  async placeOrderWithExtendedHours(symbol, side, orderType, quantity = null, notional = null, limitPrice = null, extendedHours = false) {
    if (!quantity && !notional) {
      throw new Error('Either quantity or notional must be provided');
    }
    
    const orderData = {
      symbol: symbol,
      side: side.toLowerCase(),
      type: orderType,
      time_in_force: 'day', // Extended hours requires day TIF
      extended_hours: extendedHours,
    };
    
    if (notional) {
      orderData.notional = notional.toString();
    } else {
      orderData.qty = Math.abs(quantity).toString();
    }
    
    if (orderType === 'limit' && limitPrice) {
      orderData.limit_price = limitPrice.toString();
    }
    
    logger.info('Placing Alpaca order with extended hours', orderData);
    const response = await this.makeRequest('POST', '/v2/orders', orderData);
    
    return {
      orderId: response.id || response.client_order_id,
      status: response.status || 'new',
    };
  }
}

module.exports = AlpacaAPI;
