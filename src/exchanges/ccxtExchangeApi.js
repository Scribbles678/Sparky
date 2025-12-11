/**
 * Generic CCXT Exchange API Wrapper
 * 
 * This wrapper provides unified access to 100+ exchanges via CCXT.
 * Works with any CCXT-supported exchange (apex, binance, coinbase, etc.)
 * 
 * Usage:
 *   const api = new CCXTExchangeAPI('apex', { apiKey, apiSecret });
 *   const api = new CCXTExchangeAPI('binance', { apiKey, apiSecret });
 */

const ccxt = require('ccxt');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class CCXTExchangeAPI extends BaseExchangeAPI {
  /**
   * @param {string} exchangeId - CCXT exchange ID (e.g., 'apex', 'binance', 'coinbase')
   * @param {object} config - Exchange configuration
   * @param {string} config.apiKey - API key
   * @param {string} config.apiSecret - API secret
   * @param {string} [config.passphrase] - Passphrase (for Coinbase, etc.)
   * @param {string} [config.environment] - 'production' or 'sandbox'
   * @param {boolean} [config.sandbox] - Use sandbox/testnet
   * @param {object} [config.options] - Exchange-specific options
   */
  constructor(exchangeId, config) {
    super(config);
    this.exchangeId = exchangeId.toLowerCase();
    this.exchangeName = this.exchangeId;
    
    // Get CCXT exchange class
    const ExchangeClass = ccxt[this.exchangeId];
    if (!ExchangeClass) {
      const availableExchanges = Object.keys(ccxt).filter(k => !k.startsWith('_') && typeof ccxt[k] === 'function');
      throw new Error(
        `CCXT exchange '${this.exchangeId}' not found. ` +
        `Available exchanges: ${availableExchanges.slice(0, 20).join(', ')}... ` +
        `(Total: ${availableExchanges.length})`
      );
    }
    
    // Build CCXT config
    const ccxtConfig = {
      apiKey: config.apiKey || config.api_key,
      secret: config.apiSecret || config.secret || config.api_secret,
      sandbox: config.environment === 'sandbox' || config.sandbox === true,
      enableRateLimit: true, // CCXT handles rate limiting automatically
      options: config.options || {},
    };
    
    // Add passphrase if provided (Coinbase, etc.)
    if (config.passphrase || config.password) {
      ccxtConfig.password = config.passphrase || config.password;
    }
    
    // Create CCXT instance
    this.exchange = new ExchangeClass(ccxtConfig);
    
    this.marketsLoaded = false;
    
    logger.info(`✅ CCXT ${this.exchangeId} exchange initialized`);
  }
  
  /**
   * Get exchange name (for compatibility)
   */
  getExchangeName() {
    return this.exchangeName;
  }
  
  /**
   * Load markets (required before trading)
   */
  async loadMarkets(reload = false) {
    if (!this.marketsLoaded || reload) {
      try {
        await this.exchange.loadMarkets();
        this.marketsLoaded = true;
        
        const marketCount = Object.keys(this.exchange.markets).length;
        logger.info(`✅ Markets loaded for ${this.exchangeId}: ${marketCount} markets`);
        
        // Log futures support if available
        if (this.exchange.has['fetchPositions']) {
          const futuresMarkets = Object.values(this.exchange.markets)
            .filter(m => m.future === true || m.type === 'future' || m.type === 'swap');
          if (futuresMarkets.length > 0) {
            logger.info(`   Futures/Perpetuals: ${futuresMarkets.length} markets`);
          }
        }
      } catch (error) {
        logger.logError(`Failed to load markets for ${this.exchangeId}`, error);
        throw error;
      }
    }
  }
  
  /**
   * Normalize symbol to CCXT format
   * 
   * CCXT uses BASE/QUOTE format:
   * - Spot: BTC/USDT, ETH/USD
   * - Perpetuals: BTC/USDT:USDT, ETH/USD:USD
   * - Futures: BTC/USDT:USDT-211225 (with expiry date)
   * 
   * Per CCXT docs: Use exchange.market(symbol) to get standardized symbol
   * Don't parse symbol strings - use market properties instead
   */
  normalizeSymbol(symbol) {
    // If already in CCXT format, try to get market to verify
    if (this.marketsLoaded) {
      try {
        // CCXT's market() method handles symbol normalization
        // It will find the market by symbol or id and return the standardized symbol
        const market = this.exchange.market(symbol);
        if (market) {
          return market.symbol || market.id; // Use CCXT's standardized symbol
        }
      } catch (e) {
        // Market not found, try common conversions
      }
    }
    
    // If markets not loaded yet, do basic conversion
    // Common formats: ETHUSDT → ETH/USDT
    if (symbol.includes('/')) {
      return symbol; // Already in CCXT format
    }
    
    // Try common conversions (fallback if markets not loaded)
    if (symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4);
      return `${base}/USDT`;
    }
    
    if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3);
      // For futures/perpetuals, try :USDT or :USD suffix
      // But we'll let CCXT handle this when markets are loaded
      return `${base}/USD`;
    }
    
    // Return as-is - CCXT will handle it or throw an error
    return symbol;
  }
  
  // ==================== Account Methods ====================
  
  async getBalance() {
    await this.loadMarkets();
    
    try {
      const balance = await this.exchange.fetchBalance();
      
      // Map CCXT balance to your format
      const balances = [];
      for (const [currency, amount] of Object.entries(balance)) {
        // Skip metadata keys
        if (currency === 'info' || currency === 'free' || currency === 'used' || currency === 'total') {
          continue;
        }
        
        // Only include currencies with balance
        if (amount && (amount.free > 0 || amount.used > 0 || amount.total > 0)) {
          balances.push({
            asset: currency,
            free: parseFloat(amount.free || 0),
            locked: parseFloat(amount.used || 0),
            total: parseFloat(amount.total || 0),
          });
        }
      }
      
      return balances;
    } catch (error) {
      logger.logError(`Failed to fetch balance for ${this.exchangeId}`, error);
      throw error;
    }
  }
  
  async getAvailableMargin() {
    await this.loadMarkets();
    
    try {
      const balance = await this.exchange.fetchBalance();
      
      // For futures, check margin info
      if (this.exchange.has['fetchPositions']) {
        const margin = balance.info?.availableMargin || 
                      balance.info?.availableBalance ||
                      balance.info?.marginAvailable ||
                      balance.USDC?.free || 
                      balance.USDT?.free || 
                      balance.USD?.free || 
                      0;
        return parseFloat(margin);
      }
      
      // For spot, use free balance
      return parseFloat(balance.USDT?.free || balance.USDC?.free || balance.USD?.free || 0);
    } catch (error) {
      logger.logError(`Failed to fetch available margin for ${this.exchangeId}`, error);
      throw error;
    }
  }
  
  // ==================== Position Methods ====================
  
  async getPositions() {
    await this.loadMarkets();
    
    try {
      // Check if exchange supports positions (futures)
      if (!this.exchange.has['fetchPositions']) {
        return []; // Spot exchange, no positions
      }
      
      // Per CCXT docs: fetchPositions(symbols, params)
      // If symbols is undefined, returns all positions
      const positions = await this.exchange.fetchPositions();
      
      // Map CCXT position structure to your format
      // Per CCXT docs, position structure includes:
      // contracts, side, entryPrice, markPrice, unrealizedPnl, leverage, etc.
      return positions
        .filter(p => {
          const contracts = parseFloat(p.contracts || 0);
          return contracts !== 0; // Only return positions with non-zero contracts
        })
        .map(p => ({
          symbol: p.symbol,
          side: p.side, // 'long' or 'short'
          size: Math.abs(parseFloat(p.contracts || 0)),
          entryPrice: parseFloat(p.entryPrice || 0),
          markPrice: parseFloat(p.markPrice || 0),
          unrealizedPnl: parseFloat(p.unrealizedPnl || 0),
          leverage: parseFloat(p.leverage || 1),
          percentage: parseFloat(p.percentage || 0),
          // Additional CCXT fields
          notional: parseFloat(p.notional || 0),
          collateral: parseFloat(p.collateral || 0),
          initialMargin: parseFloat(p.initialMargin || 0),
        }));
    } catch (error) {
      logger.logError(`Failed to fetch positions for ${this.exchangeId}`, error);
      // If positions not supported, return empty array
      if (error.message.includes('not supported') || error.message.includes('not available')) {
        return [];
      }
      throw error;
    }
  }
  
  async getPosition(symbol) {
    const positions = await this.getPositions();
    const normalizedSymbol = this.normalizeSymbol(symbol);
    return positions.find(p => p.symbol === normalizedSymbol) || null;
  }
  
  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null && parseFloat(position.size || 0) !== 0;
  }
  
  // ==================== Market Data Methods ====================
  
  async getTicker(symbol) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const ticker = await this.exchange.fetchTicker(normalizedSymbol);
      
      // Per CCXT docs, ticker structure includes: last, bid, ask, high, low, etc.
      return {
        symbol: normalizedSymbol,
        lastPrice: parseFloat(ticker.last || 0),
        bid: parseFloat(ticker.bid || 0),
        ask: parseFloat(ticker.ask || 0),
        volume: parseFloat(ticker.quoteVolume || ticker.baseVolume || 0),
        price: parseFloat(ticker.last || ticker.close || 0),
        // Additional CCXT ticker fields
        high: parseFloat(ticker.high || 0),
        low: parseFloat(ticker.low || 0),
        open: parseFloat(ticker.open || 0),
        change: parseFloat(ticker.change || 0),
        percentage: parseFloat(ticker.percentage || 0),
      };
    } catch (error) {
      // Handle CCXT-specific errors
      if (error.constructor.name === 'BadSymbol') {
        logger.logError(`Invalid symbol ${symbol} for ${this.exchangeId}`, error);
      } else {
        logger.logError(`Failed to fetch ticker for ${symbol}`, error);
      }
      throw error;
    }
  }
  
  // ==================== Order Methods ====================
  
  async placeMarketOrder(symbol, side, quantity) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase(); // 'buy' or 'sell'
      
      // Check if exchange supports market orders
      if (!this.exchange.has['createMarketOrder']) {
        throw new Error(`${this.exchangeId} does not support market orders`);
      }
      
      // Use CCXT's unified createOrder method
      // Per docs: createOrder(symbol, type, side, amount, price, params)
      const order = await this.exchange.createOrder(
        normalizedSymbol,
        'market',
        normalizedSide,
        quantity
      );
      
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || 0),
        status: order.status || 'FILLED',
        filled: parseFloat(order.filled || 0),
      };
    } catch (error) {
      // Handle CCXT-specific errors
      if (error.constructor.name === 'NetworkError' || error.constructor.name === 'ExchangeError') {
        logger.logError(`CCXT ${error.constructor.name} placing market order for ${symbol}`, error);
      } else {
        logger.logError(`Failed to place market order for ${symbol}`, error);
      }
      throw error;
    }
  }
  
  async placeLimitOrder(symbol, side, quantity, price) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      
      // Use CCXT's unified createOrder method
      // Per docs: createOrder(symbol, type, side, amount, price, params)
      const order = await this.exchange.createOrder(
        normalizedSymbol,
        'limit',
        normalizedSide,
        quantity,
        price
      );
      
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || price),
        status: order.status || 'NEW',
        filled: parseFloat(order.filled || 0),
      };
    } catch (error) {
      // Handle CCXT-specific errors
      if (error.constructor.name === 'InvalidOrder') {
        logger.logError(`Invalid order parameters for ${symbol}`, error);
      } else if (error.constructor.name === 'InsufficientFunds') {
        logger.logError(`Insufficient funds for ${symbol}`, error);
      } else {
        logger.logError(`Failed to place limit order for ${symbol}`, error);
      }
      throw error;
    }
  }
  
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      
      // Check if exchange supports stop orders
      if (!this.exchange.has['createStopOrder'] && !this.exchange.has['createStopLimitOrder']) {
        throw new Error(`${this.exchangeId} does not support stop orders`);
      }
      
      // Try stop order first, fallback to stop-limit
      let order;
      if (this.exchange.has['createStopOrder']) {
        order = await this.exchange.createStopOrder(
          normalizedSymbol,
          normalizedSide,
          quantity,
          stopPrice
        );
      } else {
        order = await this.exchange.createStopLimitOrder(
          normalizedSymbol,
          normalizedSide,
          quantity,
          stopPrice,
          stopPrice
        );
      }
      
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || stopPrice),
        status: order.status || 'NEW',
        type: 'STOP',
      };
    } catch (error) {
      logger.logError(`Failed to place stop loss for ${symbol}`, error);
      throw error;
    }
  }
  
  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    // Take profit is typically a limit order at target price
    return this.placeLimitOrder(symbol, side, quantity, takeProfitPrice);
  }
  
  async closePosition(symbol, side, quantity) {
    // Close by placing opposite market order
    const oppositeSide = side.toLowerCase() === 'buy' ? 'sell' : 'buy';
    return this.placeMarketOrder(symbol, oppositeSide, quantity);
  }
  
  async cancelOrder(symbol, orderId) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const result = await this.exchange.cancelOrder(orderId, normalizedSymbol);
      return result;
    } catch (error) {
      logger.logError(`Failed to cancel order ${orderId}`, error);
      throw error;
    }
  }
  
  async getOrder(symbol, orderId) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const order = await this.exchange.fetchOrder(orderId, normalizedSymbol);
      return order;
    } catch (error) {
      logger.logError(`Failed to fetch order ${orderId}`, error);
      throw error;
    }
  }
}

module.exports = CCXTExchangeAPI;


