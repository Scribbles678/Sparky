/**
 * Aster DEX V3 API Client
 * 
 * Uses EIP-712 typed data signing (Web3 wallet-based authentication)
 * instead of the legacy HMAC-SHA256 approach used in V1/V2.
 * 
 * Key differences from V1/V2:
 * - Authentication: EIP-712 signature via API wallet (signer) address
 * - Nonce: Microsecond timestamp (not millisecond)
 * - Parameters: user (main wallet), signer (API wallet), nonce, signature
 * - Endpoints: /fapi/v3/* instead of /fapi/v1/* or /fapi/v2/*
 * - New features: batch orders, funding info, futures-spot transfer
 * 
 * Setup:
 *   1. Create API wallet at https://www.asterdex.com/en/api-wallet (switch to "Pro API")
 *   2. Store credentials in Supabase bot_credentials with:
 *      - extra_metadata.user_address = main login wallet address
 *      - extra_metadata.signer_address = API wallet address
 *      - extra_metadata.private_key = API wallet private key
 *      - extra_metadata.api_version = 'v3'
 * 
 * @see https://github.com/asterdex/api-docs/blob/master/aster-finance-futures-api-v3.md
 */

const axios = require('axios');
const { ethers } = require('ethers');
const logger = require('../utils/logger');

// EIP-712 typed data structure for Aster V3 signing
const EIP712_DOMAIN = {
  name: 'AsterSignTransaction',
  version: '1',
  chainId: 714,
  verifyingContract: '0x0000000000000000000000000000000000000000'
};

const EIP712_TYPES = {
  Message: [
    { name: 'msg', type: 'string' }
  ]
};

class AsterAPIV3 {
  /**
   * @param {object} config
   * @param {string} config.userAddress - Main login wallet address
   * @param {string} config.signerAddress - API wallet address
   * @param {string} config.privateKey - API wallet private key (hex string, with or without 0x prefix)
   * @param {string} [config.apiUrl] - REST API base URL
   * @param {string} [config.wsUrl] - WebSocket base URL
   * @param {string} [config.environment] - 'production' or 'testnet'
   */
  constructor(config) {
    this.userAddress = config.userAddress;
    this.signerAddress = config.signerAddress;
    this.apiUrl = config.apiUrl || 'https://fapi.asterdex.com';
    this.wsUrl = config.wsUrl || 'wss://fstream.asterdex.com';
    this.environment = config.environment || 'production';
    this.exchangeName = 'aster';
    this.apiVersion = 'v3';
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // Create ethers wallet for EIP-712 signing
    const privateKey = config.privateKey.startsWith('0x') 
      ? config.privateKey 
      : `0x${config.privateKey}`;
    this.wallet = new ethers.Wallet(privateKey);

    // Validate signer address matches private key
    if (this.wallet.address.toLowerCase() !== this.signerAddress.toLowerCase()) {
      logger.warn(`⚠️ Signer address mismatch! Wallet: ${this.wallet.address}, Config: ${this.signerAddress}`);
      logger.warn(`   Using wallet-derived address: ${this.wallet.address}`);
      this.signerAddress = this.wallet.address;
    }

    logger.info(`🔐 Aster V3 API initialized (${this.environment})`);
    logger.info(`   User: ${this.userAddress}`);
    logger.info(`   Signer: ${this.signerAddress}`);
    logger.info(`   API URL: ${this.apiUrl}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EIP-712 SIGNING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Generate a nonce (microsecond timestamp) for request signing
   * @returns {string} Nonce as string
   */
  generateNonce() {
    // Aster V3 requires microsecond precision
    // Date.now() gives milliseconds, multiply by 1000 and add random microseconds
    const ms = Date.now();
    const micro = Math.floor(Math.random() * 1000);
    return String(ms * 1000 + micro);
  }

  /**
   * Sign parameters using EIP-712 typed data
   * @param {string} paramString - URL-encoded parameter string to sign
   * @returns {Promise<string>} Hex signature
   */
  async signParams(paramString) {
    try {
      const signature = await this.wallet.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        { msg: paramString }
      );
      return signature;
    } catch (error) {
      logger.logError('EIP-712 signing failed', error);
      throw new Error(`EIP-712 signing failed: ${error.message}`);
    }
  }

  /**
   * Build and sign the full parameter string for an authenticated request
   * @param {object} params - Request parameters (key-value pairs)
   * @returns {Promise<{paramString: string, signature: string}>}
   */
  async buildSignedParams(params = {}) {
    // Convert all values to strings (Aster V3 requirement)
    const stringParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        stringParams[key] = String(value);
      }
    }

    // Add auth parameters
    const nonce = this.generateNonce();
    stringParams.nonce = nonce;
    stringParams.user = this.userAddress;
    stringParams.signer = this.signerAddress;

    // Sort parameters by key (ASCII order) as per Aster V3 spec
    const sortedKeys = Object.keys(stringParams).sort();
    const paramString = sortedKeys
      .map(key => `${key}=${stringParams[key]}`)
      .join('&');

    // Sign the parameter string
    const signature = await this.signParams(paramString);

    return { paramString, signature };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HTTP REQUEST LAYER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Make an authenticated V3 API request with retry logic
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} endpoint - API endpoint path (e.g., '/fapi/v3/order')
   * @param {object} [params] - Request parameters
   * @param {boolean} [signed=true] - Whether request requires authentication
   * @param {number} [retryCount=0] - Current retry attempt
   * @returns {Promise<any>} API response data
   */
  async makeRequest(method, endpoint, params = {}, signed = true, retryCount = 0) {
    const startTime = Date.now();

    try {
      let url = `${this.apiUrl}${endpoint}`;
      let queryString = '';
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SparkyBot/2.0'
      };

      if (signed) {
        const { paramString, signature } = await this.buildSignedParams(params);
        queryString = `${paramString}&signature=${signature}`;
      } else {
        // Public endpoint — just build query string
        const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
        queryString = entries.map(([k, v]) => `${k}=${v}`).join('&');
      }

      const config = {
        method,
        url: queryString ? `${url}?${queryString}` : url,
        headers,
        timeout: 15000,
      };

      const response = await axios(config);
      const duration = Date.now() - startTime;

      logger.logApiCall(method, endpoint, response.status, duration);
      return response.data;

    } catch (error) {
      const duration = Date.now() - startTime;

      if (error.response) {
        const status = error.response.status;
        const errData = error.response.data;

        logger.logError(`Aster V3 API error [${status}]`, error, {
          method,
          endpoint,
          status,
          code: errData?.code,
          msg: errData?.msg,
          duration,
        });

        // Retry on 5xx or rate limit (429)
        if ((status >= 500 || status === 429) && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`⏳ Retrying ${endpoint} in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, params, signed, retryCount + 1);
        }

        // Throw with Aster error details
        const apiError = new Error(`Aster V3 API error: ${errData?.msg || error.message} (code: ${errData?.code})`);
        apiError.status = status;
        apiError.code = errData?.code;
        throw apiError;

      } else {
        logger.logError('Aster V3 network error', error, { method, endpoint, duration });

        // Retry on network errors
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          logger.info(`⏳ Retrying ${endpoint} in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          await this.sleep(delay);
          return this.makeRequest(method, endpoint, params, signed, retryCount + 1);
        }

        throw error;
      }
    }
  }

  /**
   * Make a public (unsigned) API request
   */
  async makePublicRequest(method, endpoint, params = {}) {
    return this.makeRequest(method, endpoint, params, false);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACCOUNT METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get account balance (V3)
   * @returns {Promise<Array>} Array of balance objects
   */
  async getBalance() {
    return this.makeRequest('GET', '/fapi/v3/balance');
  }

  /**
   * Get available USDT margin
   * @returns {Promise<number>} Available balance in USDT
   */
  async getAvailableMargin() {
    const balances = await this.getBalance();
    const usdtBalance = balances.find(b => b.asset === 'USDT');

    if (!usdtBalance) {
      throw new Error('USDT balance not found');
    }

    return parseFloat(usdtBalance.availableBalance);
  }

  /**
   * Get full account information (V3)
   * Includes positions, balances, and account config
   * @returns {Promise<object>} Account info
   */
  async getAccountInfo() {
    return this.makeRequest('GET', '/fapi/v3/account');
  }

  /**
   * Get user commission rate
   * @param {string} symbol - Trading symbol
   * @returns {Promise<object>} Commission rate info
   */
  async getCommissionRate(symbol) {
    return this.makeRequest('GET', '/fapi/v3/commissionRate', { symbol });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POSITION METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get all position information (V3)
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<Array>} Array of position objects
   */
  async getPositions(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makeRequest('GET', '/fapi/v3/positionRisk', params);
  }

  /**
   * Get position for a specific symbol
   * @param {string} symbol - Trading symbol
   * @returns {Promise<object|null>} Position object or null
   */
  async getPosition(symbol) {
    const positions = await this.getPositions(symbol);
    const position = positions.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
    return position || null;
  }

  /**
   * Check if a position exists for symbol
   * @param {string} symbol - Trading symbol
   * @returns {Promise<boolean>}
   */
  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null;
  }

  /**
   * Change position mode (Hedge Mode vs One-way)
   * @param {boolean} dualSidePosition - true = Hedge Mode, false = One-way
   */
  async changePositionMode(dualSidePosition) {
    return this.makeRequest('POST', '/fapi/v3/positionSide/dual', {
      dualSidePosition: String(dualSidePosition)
    });
  }

  /**
   * Get current position mode
   * @returns {Promise<object>} { dualSidePosition: boolean }
   */
  async getPositionMode() {
    return this.makeRequest('GET', '/fapi/v3/positionSide/dual');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MARKET DATA METHODS (Public — no signature required)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get current ticker price for a symbol
   * @param {string} symbol - Trading symbol (e.g., 'BTCUSDT')
   * @returns {Promise<object>} { symbol, price, time }
   */
  async getTicker(symbol) {
    return this.makePublicRequest('GET', '/fapi/v3/ticker/price', { symbol });
  }

  /**
   * Get 24hr ticker price change statistics
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<object|Array>}
   */
  async get24hrTicker(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makePublicRequest('GET', '/fapi/v3/ticker/24hr', params);
  }

  /**
   * Get order book depth
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=100] - Depth levels: 5, 10, 20, 50, 100, 500, 1000
   * @returns {Promise<object>} { lastUpdateId, bids, asks }
   */
  async getOrderBook(symbol, limit = 100) {
    return this.makePublicRequest('GET', '/fapi/v3/depth', { symbol, limit });
  }

  /**
   * Get kline/candlestick data
   * @param {string} symbol - Trading symbol
   * @param {string} [interval='1m'] - Kline interval (1m, 5m, 15m, 1h, 4h, 1d, etc.)
   * @param {number} [limit=100] - Max 1500
   * @returns {Promise<Array>} Array of kline arrays
   */
  async getKlines(symbol, interval = '1m', limit = 100) {
    const params = {
      symbol,
      interval,
      limit: Math.min(limit, 1500),
    };
    const response = await this.makePublicRequest('GET', '/fapi/v3/klines', params);
    return response || [];
  }

  /**
   * Get mark price and funding rate
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<object|Array>} Mark price info with funding rate
   */
  async getMarkPrice(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makePublicRequest('GET', '/fapi/v3/premiumIndex', params);
  }

  /**
   * Get funding rate history
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=100] - Max 1000
   * @returns {Promise<Array>} Funding rate history
   */
  async getFundingRateHistory(symbol, limit = 100) {
    return this.makePublicRequest('GET', '/fapi/v3/fundingRate', {
      symbol,
      limit: Math.min(limit, 1000),
    });
  }

  /**
   * Get funding rate configuration info (V3 exclusive)
   * Shows funding interval hours, fee caps/floors per symbol
   * @returns {Promise<Array>} Funding info per symbol
   */
  async getFundingInfo() {
    return this.makePublicRequest('GET', '/fapi/v3/fundingInfo');
  }

  /**
   * Get recent trades
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=500] - Max 1000
   * @returns {Promise<Array>} Recent trades
   */
  async getRecentTrades(symbol, limit = 500) {
    return this.makePublicRequest('GET', '/fapi/v3/trades', { symbol, limit });
  }

  /**
   * Get exchange information (symbols, filters, rate limits)
   * @returns {Promise<object>} Exchange info
   */
  async getExchangeInfo() {
    return this.makePublicRequest('GET', '/fapi/v3/exchangeInfo');
  }

  /**
   * Get best bid/ask price (book ticker)
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<object|Array>}
   */
  async getBookTicker(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makePublicRequest('GET', '/fapi/v3/ticker/bookTicker', params);
  }

  /**
   * Test connectivity
   * @returns {Promise<object>} {}
   */
  async ping() {
    return this.makePublicRequest('GET', '/fapi/v3/ping');
  }

  /**
   * Get server time
   * @returns {Promise<object>} { serverTime: number }
   */
  async getServerTime() {
    return this.makePublicRequest('GET', '/fapi/v3/time');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ORDER METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Set leverage for a symbol
   * @param {string} symbol - Trading symbol
   * @param {number} leverage - Leverage value (1-125)
   * @returns {Promise<object>} { leverage, maxNotionalValue, symbol }
   */
  async setLeverage(symbol, leverage) {
    logger.info(`Setting leverage for ${symbol} to ${leverage}x`);
    return this.makeRequest('POST', '/fapi/v3/leverage', { symbol, leverage });
  }

  /**
   * Change margin type (ISOLATED vs CROSSED)
   * @param {string} symbol - Trading symbol
   * @param {string} marginType - 'ISOLATED' or 'CROSSED'
   */
  async changeMarginType(symbol, marginType) {
    logger.info(`Setting margin type for ${symbol} to ${marginType}`);
    return this.makeRequest('POST', '/fapi/v3/marginType', { symbol, marginType });
  }

  /**
   * Place an order (V3)
   * @param {object} orderData - Order parameters
   * @returns {Promise<object>} Order response
   */
  async placeOrder(orderData) {
    logger.info(`📤 Placing V3 order:`, {
      symbol: orderData.symbol,
      side: orderData.side,
      type: orderData.type,
      quantity: orderData.quantity,
      price: orderData.price,
    });
    return this.makeRequest('POST', '/fapi/v3/order', orderData);
  }

  /**
   * Place market order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number|string} quantity - Order quantity
   * @returns {Promise<object>} Order response
   */
  async placeMarketOrder(symbol, side, quantity) {
    return this.placeOrder({
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: String(quantity),
    });
  }

  /**
   * Place limit order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number|string} quantity - Order quantity
   * @param {number|string} price - Limit price
   * @param {string} [timeInForce='GTC'] - Time in force (GTC, IOC, FOK, GTX)
   * @returns {Promise<object>} Order response
   */
  async placeLimitOrder(symbol, side, quantity, price, timeInForce = 'GTC') {
    return this.placeOrder({
      symbol,
      side: side.toUpperCase(),
      type: 'LIMIT',
      quantity: String(quantity),
      price: String(price),
      timeInForce,
    });
  }

  /**
   * Place stop loss order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number|string} quantity - Order quantity
   * @param {number|string} stopPrice - Stop trigger price
   * @returns {Promise<object>} Order response
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'STOP_MARKET',
      stopPrice: String(stopPrice),
      quantity: String(quantity),
      reduceOnly: 'true',
    };
    logger.info('📤 Placing V3 stop loss', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Place take profit order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number|string} quantity - Order quantity
   * @param {number|string} takeProfitPrice - Take profit trigger price
   * @returns {Promise<object>} Order response
   */
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: String(takeProfitPrice),
      quantity: String(quantity),
      reduceOnly: 'true',
    };
    logger.info('📤 Placing V3 take profit', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Place trailing stop order
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number|string} quantity - Order quantity
   * @param {number|string} callbackRate - Callback rate in percent (e.g., 1 = 1%)
   * @returns {Promise<object>} Order response
   */
  async placeTrailingStop(symbol, side, quantity, callbackRate) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'TRAILING_STOP_MARKET',
      quantity: String(quantity),
      callbackRate: String(callbackRate),
      reduceOnly: 'true',
    };
    logger.info('📤 Placing V3 trailing stop', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Place multiple orders in batch (V3 exclusive — up to 5 orders)
   * @param {Array<object>} orders - Array of order parameter objects
   * @returns {Promise<Array>} Array of order responses
   */
  async placeBatchOrders(orders) {
    if (orders.length > 5) {
      throw new Error('Aster V3 batch orders limited to 5 per request');
    }
    logger.info(`📤 Placing batch of ${orders.length} V3 orders`);
    return this.makeRequest('POST', '/fapi/v3/batchOrders', {
      batchOrders: JSON.stringify(orders),
    });
  }

  /**
   * Close position (market order with reduceOnly)
   * @param {string} symbol - Trading symbol
   * @param {string} side - Close side ('BUY' to close short, 'SELL' to close long)
   * @param {number|string} quantity - Position quantity to close
   * @returns {Promise<object>} Order response
   */
  async closePosition(symbol, side, quantity) {
    const orderData = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: String(quantity),
      reduceOnly: 'true',
    };
    logger.info('📤 Closing V3 position', orderData);
    return this.placeOrder(orderData);
  }

  /**
   * Cancel an order
   * @param {string} symbol - Trading symbol
   * @param {number|string} orderId - Order ID to cancel
   * @returns {Promise<object>} Cancel response
   */
  async cancelOrder(symbol, orderId) {
    logger.info(`❌ Canceling V3 order: ${symbol} #${orderId}`);
    return this.makeRequest('DELETE', '/fapi/v3/order', { symbol, orderId });
  }

  /**
   * Cancel all open orders for a symbol
   * @param {string} symbol - Trading symbol
   * @returns {Promise<object>} Cancel response
   */
  async cancelAllOrders(symbol) {
    logger.info(`❌ Canceling all V3 orders for ${symbol}`);
    return this.makeRequest('DELETE', '/fapi/v3/allOpenOrders', { symbol });
  }

  /**
   * Cancel multiple orders
   * @param {string} symbol - Trading symbol
   * @param {Array<number>} orderIdList - Array of order IDs to cancel
   * @returns {Promise<Array>} Cancel responses
   */
  async cancelBatchOrders(symbol, orderIdList) {
    logger.info(`❌ Canceling ${orderIdList.length} V3 orders for ${symbol}`);
    return this.makeRequest('DELETE', '/fapi/v3/batchOrders', {
      symbol,
      orderIdList: JSON.stringify(orderIdList),
    });
  }

  /**
   * Query an order's status
   * @param {string} symbol - Trading symbol
   * @param {number|string} orderId - Order ID
   * @returns {Promise<object>} Order info
   */
  async getOrder(symbol, orderId) {
    return this.makeRequest('GET', '/fapi/v3/order', { symbol, orderId });
  }

  /**
   * Get all open orders
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<Array>} Open orders
   */
  async getOpenOrders(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makeRequest('GET', '/fapi/v3/openOrders', params);
  }

  /**
   * Get all orders (including filled/canceled)
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=500] - Max 1000
   * @returns {Promise<Array>} All orders
   */
  async getAllOrders(symbol, limit = 500) {
    return this.makeRequest('GET', '/fapi/v3/allOrders', {
      symbol,
      limit: Math.min(limit, 1000),
    });
  }

  /**
   * Get account trade history
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=500] - Max 1000
   * @returns {Promise<Array>} Trade history
   */
  async getTradeHistory(symbol, limit = 500) {
    return this.makeRequest('GET', '/fapi/v3/userTrades', {
      symbol,
      limit: Math.min(limit, 1000),
    });
  }

  /**
   * Get income history (funding fees, commissions, realized PnL, etc.)
   * @param {string} [symbol] - Optional symbol filter
   * @param {string} [incomeType] - Filter: REALIZED_PNL, FUNDING_FEE, COMMISSION, etc.
   * @param {number} [limit=100] - Max 1000
   * @returns {Promise<Array>} Income history
   */
  async getIncomeHistory(symbol, incomeType, limit = 100) {
    const params = { limit: Math.min(limit, 1000) };
    if (symbol) params.symbol = symbol;
    if (incomeType) params.incomeType = incomeType;
    return this.makeRequest('GET', '/fapi/v3/income', params);
  }

  /**
   * Get leverage brackets (notional limits per leverage tier)
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<Array>} Leverage bracket info
   */
  async getLeverageBrackets(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makeRequest('GET', '/fapi/v3/leverageBracket', params);
  }

  /**
   * Get ADL quantile estimation
   * @param {string} [symbol] - Optional symbol filter
   * @returns {Promise<Array>}
   */
  async getAdlQuantile(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.makeRequest('GET', '/fapi/v3/adlQuantile', params);
  }

  /**
   * Get user's force (liquidation) orders
   * @param {string} [symbol] - Optional symbol filter
   * @param {number} [limit=50] - Max 100
   * @returns {Promise<Array>}
   */
  async getForceOrders(symbol, limit = 50) {
    const params = { limit: Math.min(limit, 100) };
    if (symbol) params.symbol = symbol;
    return this.makeRequest('GET', '/fapi/v3/forceOrders', params);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MARGIN METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Modify isolated position margin
   * @param {string} symbol - Trading symbol
   * @param {number|string} amount - Margin amount
   * @param {number} type - 1 = add margin, 2 = reduce margin
   * @returns {Promise<object>}
   */
  async modifyPositionMargin(symbol, amount, type) {
    return this.makeRequest('POST', '/fapi/v3/positionMargin', {
      symbol,
      amount: String(amount),
      type,
    });
  }

  /**
   * Get position margin change history
   * @param {string} symbol - Trading symbol
   * @param {number} [limit=50]
   * @returns {Promise<Array>}
   */
  async getPositionMarginHistory(symbol, limit = 50) {
    return this.makeRequest('GET', '/fapi/v3/positionMargin/history', {
      symbol,
      limit,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ASSET TRANSFER (V3 exclusive)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Transfer between futures and spot wallet
   * @param {string} asset - Asset to transfer (e.g., 'USDT')
   * @param {number|string} amount - Transfer amount
   * @param {number} type - 1 = spot→futures, 2 = futures→spot
   * @returns {Promise<object>} { tranId }
   */
  async walletTransfer(asset, amount, type) {
    logger.info(`💰 V3 wallet transfer: ${amount} ${asset} (type: ${type === 1 ? 'spot→futures' : 'futures→spot'})`);
    return this.makeRequest('POST', '/fapi/v3/asset/wallet/transfer', {
      asset,
      amount: String(amount),
      type,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // USER DATA STREAM (for WebSocket)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Start a user data stream (creates a listenKey for WebSocket)
   * @returns {Promise<object>} { listenKey: string }
   */
  async startUserDataStream() {
    const result = await this.makeRequest('POST', '/fapi/v3/listenKey');
    logger.info(`🔑 User data stream started (listenKey: ${result.listenKey?.substring(0, 8)}...)`);
    return result;
  }

  /**
   * Keepalive a user data stream (must be called every 30 min, expires at 60 min)
   * @returns {Promise<object>} {}
   */
  async keepaliveUserDataStream() {
    return this.makeRequest('PUT', '/fapi/v3/listenKey');
  }

  /**
   * Close a user data stream
   * @returns {Promise<object>} {}
   */
  async closeUserDataStream() {
    logger.info('🔒 Closing user data stream');
    return this.makeRequest('DELETE', '/fapi/v3/listenKey');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NOOP (Cancel pending on-chain transactions)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Cancel pending on-chain transactions that haven't completed
   * Uses the same nonce as the transaction to cancel
   * @returns {Promise<object>}
   */
  async noop() {
    return this.makeRequest('POST', '/fapi/v3/noop');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MULTI-ASSETS MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Change multi-assets mode
   * @param {boolean} multiAssetsMargin - true = enable, false = disable
   */
  async changeMultiAssetsMode(multiAssetsMargin) {
    return this.makeRequest('POST', '/fapi/v3/multiAssetsMargin', {
      multiAssetsMargin: String(multiAssetsMargin),
    });
  }

  /**
   * Get current multi-assets mode
   * @returns {Promise<object>} { multiAssetsMargin: boolean }
   */
  async getMultiAssetsMode() {
    return this.makeRequest('GET', '/fapi/v3/multiAssetsMargin');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTO-CANCEL (Countdown timer to cancel all orders)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Set auto-cancel countdown (dead man's switch)
   * All open orders will be canceled after countdown expires unless reset
   * @param {string} symbol - Trading symbol
   * @param {number} countdownTime - Countdown in milliseconds (0 to cancel timer)
   * @returns {Promise<object>}
   */
  async setAutoCancelOrders(symbol, countdownTime) {
    return this.makeRequest('POST', '/fapi/v3/countdownCancelAll', {
      symbol,
      countdownTime,
    });
  }
}

module.exports = AsterAPIV3;
