const nacl = require('tweetnacl');
const base64 = require('base64-js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const BaseExchangeAPI = require('./BaseExchangeAPI');

class RobinhoodAPI extends BaseExchangeAPI {
  constructor(apiKey, privateKey, environment = 'production') {
    super({ apiKey, privateKey, environment });
    this.apiKey = apiKey;
    this.privateKey = privateKey; // Base64-encoded Ed25519 private key
    this.environment = environment;
    this.exchangeName = 'robinhood';
    
    // Base URL (Robinhood Crypto API only has production)
    this.baseUrl = 'https://trading.robinhood.com';
    
    // Validate private key format (should be 32-byte seed in Base64)
    try {
      const privateKeyBytes = base64.toByteArray(privateKey);
      if (privateKeyBytes.length !== 32) {
        throw new Error(`Invalid Ed25519 private key length: expected 32 bytes, got ${privateKeyBytes.length}`);
      }
      // Test that we can create a keypair from it
      // Note: fromSeed might not exist in all tweetnacl versions, will handle in generateSignature
      if (typeof nacl.sign.keyPair.fromSeed === 'function') {
        nacl.sign.keyPair.fromSeed(privateKeyBytes);
      }
    } catch (error) {
      throw new Error(`Invalid Ed25519 private key format: ${error.message}`);
    }
    
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * Generate Ed25519 signature for request
   */
  generateSignature(method, path, body = '', timestamp = null) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    
    // Message format: {apiKey}{timestamp}{path}{method}{body}
    const message = `${this.apiKey}${ts}${path}${method}${body}`;
    const messageBytes = Buffer.from(message, 'utf-8');
    
    // Decode private key from Base64 (32-byte seed)
    const privateKeySeed = base64.toByteArray(this.privateKey);
    const privateKeyBuffer = Buffer.from(privateKeySeed);
    
    // Use Node.js crypto module for Ed25519 signing (Node 12+)
    // This properly handles 32-byte seed and derives the keypair correctly
    try {
      // Create Ed25519 private key from raw seed (32 bytes)
      // Node.js crypto expects the seed in a specific format
      const privateKey = crypto.createPrivateKey({
        key: privateKeyBuffer,
        format: 'raw',
        type: 'ed25519',
      });
      
      // Sign message
      const signature = crypto.sign(null, messageBytes, privateKey);
      
      // Encode signature to Base64
      const base64Signature = signature.toString('base64');
      
      return {
        signature: base64Signature,
        timestamp: ts,
      };
    } catch (error) {
      // Fallback to tweetnacl if Node.js crypto fails or fromSeed is available
      logger.info('Using tweetnacl for Ed25519 signing', { error: error.message });
      
      // Try tweetnacl's fromSeed if available
      let keyPair;
      if (typeof nacl.sign.keyPair.fromSeed === 'function') {
        keyPair = nacl.sign.keyPair.fromSeed(privateKeySeed);
      } else {
        // Last resort: try to use tweetnacl with manual keypair construction
        // Note: This requires deriving the public key from the seed properly
        // For now, throw an error to ensure proper setup
        throw new Error(
          'Ed25519 key derivation failed. ' +
          'Please ensure Node.js version 12+ is used, or install tweetnacl with fromSeed support. ' +
          `Error: ${error.message}`
        );
      }
      
      // Sign with tweetnacl
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);
      const base64Signature = base64.fromByteArray(signature);
      
      return {
        signature: base64Signature,
        timestamp: ts,
      };
    }
  }

  /**
   * Convert symbol to trading pair format (e.g., BTC -> BTC-USD)
   */
  toTradingPair(symbol) {
    // If already in trading pair format, return uppercase
    if (symbol.includes('-')) {
      return symbol.toUpperCase();
    }
    // Otherwise, assume USD quote
    return `${symbol.toUpperCase()}-USD`;
  }

  /**
   * Make authenticated API request with retry logic and Ed25519 signing
   */
  async makeRequest(method, endpoint, data = null, retryCount = 0) {
    const startTime = Date.now();
    
    // Generate signature
    const body = data ? JSON.stringify(data) : '';
    const { signature, timestamp } = this.generateSignature(method, endpoint, body);
    
    const headers = {
      'x-api-key': this.apiKey,
      'x-signature': signature,
      'x-timestamp': timestamp.toString(),
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
        logger.logError('Robinhood API request failed', error, {
          method,
          endpoint,
          status: statusCode,
          data: error.response.data,
          duration,
        });
        
        // Retry on 5xx errors or rate limits
        if ((statusCode >= 500 || statusCode === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Robinhood request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
        
        // If 401, might be timestamp expired - retry once with new timestamp
        if (statusCode === 401 && retryCount === 0) {
          logger.info('Robinhood request failed with 401, retrying with new timestamp');
          await this.sleep(100);
          return this.makeRequest(method, endpoint, data, retryCount + 1);
        }
      } else {
        logger.logError('Robinhood network error', error, { method, endpoint, duration });
        
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`Retrying Robinhood request in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          
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
    const response = await this.makeRequest('GET', '/api/v1/crypto/trading/accounts/');
    
    const buyingPower = parseFloat(response.buying_power || 0);
    const currency = response.buying_power_currency || 'USD';
    
    return [{
      asset: currency,
      availableBalance: buyingPower,
      balance: buyingPower,
    }];
  }

  /**
   * Get available margin (buying power)
   */
  async getAvailableMargin() {
    const balance = await this.getBalance();
    return balance[0]?.availableBalance || 0;
  }

  // ==================== Position Methods ====================

  /**
   * Get all open positions (holdings)
   */
  async getPositions() {
    const response = await this.makeRequest('GET', '/api/v1/crypto/trading/holdings/');
    
    const holdings = response.results || [];
    
    // Convert Robinhood holdings to common format
    return holdings.map(holding => {
      const quantity = parseFloat(holding.quantity || 0);
      const avgPrice = parseFloat(holding.average_buy_price || 0);
      
      // Get current price for mark price
      // Note: We'll need to fetch current price separately or use average_buy_price as fallback
      const markPrice = avgPrice; // Will be updated when we fetch current price
      
      return {
        symbol: holding.asset_code || 'UNKNOWN',
        positionAmt: quantity.toString(),
        entryPrice: avgPrice,
        markPrice: markPrice,
        unRealizedProfit: 0, // Will calculate if we have current price
      };
    });
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    // Convert symbol to asset code (remove -USD if present)
    const assetCode = symbol.toUpperCase().replace('-USD', '');
    
    const response = await this.makeRequest('GET', `/api/v1/crypto/trading/holdings/?asset_code=${assetCode}`);
    
    const holdings = response.results || [];
    const holding = holdings.find(h => h.asset_code.toUpperCase() === assetCode);
    
    if (!holding || parseFloat(holding.quantity || 0) === 0) {
      return null;
    }
    
    const quantity = parseFloat(holding.quantity || 0);
    const avgPrice = parseFloat(holding.average_buy_price || 0);
    
    // Get current price for mark price
    try {
      const ticker = await this.getTicker(symbol);
      const currentPrice = parseFloat(ticker.price || 0);
      const unRealizedProfit = (currentPrice - avgPrice) * quantity;
      
      return {
        symbol: holding.asset_code,
        positionAmt: quantity.toString(),
        entryPrice: avgPrice,
        markPrice: currentPrice,
        unRealizedProfit: unRealizedProfit,
      };
    } catch (error) {
      // If price fetch fails, return position without mark price
      return {
        symbol: holding.asset_code,
        positionAmt: quantity.toString(),
        entryPrice: avgPrice,
        markPrice: avgPrice,
        unRealizedProfit: 0,
      };
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
    const tradingPair = this.toTradingPair(symbol);
    
    const response = await this.makeRequest('GET', `/api/v1/crypto/marketdata/best_bid_ask/?symbol=${tradingPair}`);
    
    const results = response.results || [];
    const quote = results.find(r => r.symbol === tradingPair);
    
    if (!quote) {
      throw new Error(`No price data available for ${symbol}`);
    }
    
    const bid = parseFloat(quote.bid || 0);
    const ask = parseFloat(quote.ask || 0);
    const midPrice = bid && ask ? ((bid + ask) / 2) : (bid || ask || 0);
    
    if (!midPrice || midPrice === 0) {
      throw new Error(`No price data available for ${symbol}`);
    }
    
    return {
      symbol: tradingPair,
      price: midPrice.toString(),
      lastPrice: midPrice.toString(),
      bid: bid.toString(),
      ask: ask.toString(),
    };
  }

  // ==================== Order Methods ====================

  /**
   * Generate client order ID (UUID v4)
   */
  generateClientOrderId() {
    return uuidv4();
  }

  /**
   * Place market order
   */
  async placeMarketOrder(symbol, side, quantity) {
    const tradingPair = this.toTradingPair(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    const orderData = {
      client_order_id: clientOrderId,
      side: side.toLowerCase(),
      type: 'market',
      symbol: tradingPair,
      market_order_config: {
        asset_quantity: Math.abs(quantity).toString(),
      },
    };
    
    logger.info('Placing Robinhood market order', { symbol, tradingPair, side, quantity, clientOrderId });
    const response = await this.makeRequest('POST', '/api/v1/crypto/trading/orders/', orderData);
    
    return {
      orderId: response.id || clientOrderId,
      clientOrderId: clientOrderId,
      status: response.state || 'open',
    };
  }

  /**
   * Place limit order
   */
  async placeLimitOrder(symbol, side, quantity, price) {
    const tradingPair = this.toTradingPair(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    const orderData = {
      client_order_id: clientOrderId,
      side: side.toLowerCase(),
      type: 'limit',
      symbol: tradingPair,
      limit_order_config: {
        asset_quantity: Math.abs(quantity).toString(),
        limit_price: parseFloat(price).toString(),
        time_in_force: 'gtc',
      },
    };
    
    logger.info('Placing Robinhood limit order', { symbol, tradingPair, side, quantity, price, clientOrderId });
    const response = await this.makeRequest('POST', '/api/v1/crypto/trading/orders/', orderData);
    
    return {
      orderId: response.id || clientOrderId,
      clientOrderId: clientOrderId,
      status: response.state || 'open',
    };
  }

  /**
   * Place stop loss order
   */
  async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null) {
    const tradingPair = this.toTradingPair(symbol);
    const clientOrderId = this.generateClientOrderId();
    
    // Determine order type based on whether limit price is provided
    const orderType = limitPrice ? 'stop_limit' : 'stop_loss';
    
    const orderData = {
      client_order_id: clientOrderId,
      side: side.toLowerCase(),
      type: orderType,
      symbol: tradingPair,
    };
    
    if (orderType === 'stop_limit') {
      orderData.stop_limit_order_config = {
        asset_quantity: Math.abs(quantity).toString(),
        stop_price: parseFloat(stopPrice).toString(),
        limit_price: parseFloat(limitPrice).toString(),
        time_in_force: 'gtc',
      };
    } else {
      orderData.stop_loss_order_config = {
        asset_quantity: Math.abs(quantity).toString(),
        stop_price: parseFloat(stopPrice).toString(),
        time_in_force: 'gtc',
      };
    }
    
    logger.info('Placing Robinhood stop loss', { symbol, tradingPair, side, quantity, stopPrice, limitPrice, clientOrderId });
    const response = await this.makeRequest('POST', '/api/v1/crypto/trading/orders/', orderData);
    
    return {
      orderId: response.id || clientOrderId,
      clientOrderId: clientOrderId,
      status: response.state || 'open',
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
    logger.info('Canceling Robinhood order', { symbol, orderId });
    const response = await this.makeRequest('POST', `/api/v1/crypto/trading/orders/${orderId}/cancel/`);
    
    return {
      orderId: orderId,
      status: response.state || 'canceled',
    };
  }

  /**
   * Get order status
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', `/api/v1/crypto/trading/orders/${orderId}/`);
  }
}

module.exports = RobinhoodAPI;
