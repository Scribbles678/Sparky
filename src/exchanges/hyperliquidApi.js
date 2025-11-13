const axios = require('axios');
const crypto = require('crypto');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class HyperliquidAPI extends BaseExchangeAPI {
  constructor(apiKey, privateKey, baseUrl = 'https://api.hyperliquid.xyz', isTestnet = false) {
    super();
    this.apiKey = apiKey;
    this.privateKey = privateKey;
    this.baseUrl = baseUrl;
    this.isTestnet = isTestnet;
    this.nonce = Date.now();
    this.assetMeta = null;
    this.spotMeta = null;
    
    // Initialize asset metadata
    this.initializeAssetMeta();
    
    logger.info(`HyperliquidAPI initialized for ${isTestnet ? 'testnet' : 'mainnet'}`);
  }

  /**
   * Initialize asset metadata from info endpoint
   */
  async initializeAssetMeta() {
    try {
      const response = await this.makeRequest('POST', '/info', {
        type: 'meta'
      });
      
      this.assetMeta = response.meta;
      this.spotMeta = response.spotMeta;
      
      logger.info(`Loaded ${this.assetMeta?.length || 0} perpetual assets and ${this.spotMeta?.length || 0} spot assets`);
    } catch (error) {
      logger.error('Failed to initialize asset metadata:', error);
    }
  }

  /**
   * Get asset ID for a symbol
   */
  getAssetId(symbol) {
    if (!this.assetMeta || !this.spotMeta) {
      throw new Error('Asset metadata not initialized');
    }

    // Check if it's a spot symbol (contains /)
    if (symbol.includes('/')) {
      const [base, quote] = symbol.split('/');
      const spotInfo = this.spotMeta.find(spot => 
        spot.name === base && spot.quoteToken === quote
      );
      if (spotInfo) {
        return 10000 + spotInfo.index;
      }
    } else {
      // Perpetual symbol
      const assetInfo = this.assetMeta.find(asset => asset.name === symbol);
      if (assetInfo) {
        return this.assetMeta.indexOf(assetInfo);
      }
    }
    
    throw new Error(`Asset not found: ${symbol}`);
  }

  /**
   * Get asset info by ID
   */
  getAssetInfo(assetId) {
    if (assetId >= 10000) {
      // Spot asset
      const spotIndex = assetId - 10000;
      return this.spotMeta?.[spotIndex];
    } else {
      // Perpetual asset
      return this.assetMeta?.[assetId];
    }
  }

  /**
   * Round price according to Hyperliquid rules
   */
  roundPrice(price, assetId) {
    const assetInfo = this.getAssetInfo(assetId);
    if (!assetInfo) return price;

    const szDecimals = assetInfo.szDecimals || 0;
    const maxDecimals = assetId >= 10000 ? 8 : 6; // Spot vs Perp
    const maxPriceDecimals = maxDecimals - szDecimals;
    
    // Round to max price decimals
    const rounded = parseFloat(price.toFixed(maxPriceDecimals));
    
    // Remove trailing zeros
    return parseFloat(rounded.toString());
  }

  /**
   * Round size according to Hyperliquid rules
   */
  roundSize(size, assetId) {
    const assetInfo = this.getAssetInfo(assetId);
    if (!assetInfo) return size;

    const szDecimals = assetInfo.szDecimals || 0;
    return parseFloat(size.toFixed(szDecimals));
  }

  /**
   * Generate signature for authenticated requests
   */
  generateSignature(action, timestamp, nonce) {
    const message = JSON.stringify({
      action,
      timestamp,
      nonce
    });

    const signature = crypto
      .createHmac('sha256', this.privateKey)
      .update(message)
      .digest('hex');

    return signature;
  }

  /**
   * Make authenticated request to exchange endpoint
   */
  async makeExchangeRequest(action, data = {}) {
    const timestamp = Date.now();
    const nonce = ++this.nonce;
    
    const payload = {
      action,
      timestamp,
      nonce,
      ...data
    };

    const signature = this.generateSignature(action, timestamp, nonce);

    return this.makeRequest('POST', '/exchange', payload, {
      'Hyperliquid-Agent-Address': this.apiKey,
      'Hyperliquid-Signature': signature
    });
  }

  /**
   * Make request to info endpoint
   */
  async makeInfoRequest(type, data = {}) {
    return this.makeRequest('POST', '/info', {
      type,
      ...data
    });
  }

  /**
   * Generic request method
   */
  async makeRequest(method, endpoint, data = null, headers = {}) {
    try {
      const config = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 10000
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(`Hyperliquid API request failed:`, {
        method,
        endpoint,
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  // ===== BaseExchangeAPI Implementation =====

  async getBalance() {
    try {
      const response = await this.makeInfoRequest('clearinghouseState', {
        user: this.apiKey
      });

      if (response.assetPositions) {
        const usdcPosition = response.assetPositions.find(pos => pos.position.coin === 'USDC');
        return usdcPosition ? parseFloat(usdcPosition.position.szi) : 0;
      }

      return 0;
    } catch (error) {
      logger.error('Failed to get balance:', error);
      return 0;
    }
  }

  async getAvailableMargin() {
    try {
      const response = await this.makeInfoRequest('clearinghouseState', {
        user: this.apiKey
      });

      return response.marginSummary?.accountValue || 0;
    } catch (error) {
      logger.error('Failed to get available margin:', error);
      return 0;
    }
  }

  async getPositions() {
    try {
      const response = await this.makeInfoRequest('clearinghouseState', {
        user: this.apiKey
      });

      if (!response.assetPositions) return [];

      return response.assetPositions
        .filter(pos => pos.position.szi !== '0')
        .map(pos => ({
          symbol: pos.position.coin,
          side: parseFloat(pos.position.szi) > 0 ? 'long' : 'short',
          size: Math.abs(parseFloat(pos.position.szi)),
          entryPrice: parseFloat(pos.position.entryPx),
          unrealizedPnl: parseFloat(pos.position.unrealizedPnl || 0),
          assetId: this.getAssetId(pos.position.coin)
        }));
    } catch (error) {
      logger.error('Failed to get positions:', error);
      return [];
    }
  }

  async getPosition(symbol) {
    try {
      const positions = await this.getPositions();
      return positions.find(pos => pos.symbol === symbol) || null;
    } catch (error) {
      logger.error(`Failed to get position for ${symbol}:`, error);
      return null;
    }
  }

  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null;
  }

  async getTicker(symbol) {
    try {
      const assetId = this.getAssetId(symbol);
      const response = await this.makeInfoRequest('allMids');

      if (response && response[assetId]) {
        return {
          symbol,
          price: parseFloat(response[assetId]),
          timestamp: Date.now()
        };
      }

      throw new Error(`Price not found for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to get ticker for ${symbol}:`, error);
      throw error;
    }
  }

  async placeMarketOrder(symbol, side, size, params = {}) {
    try {
      const assetId = this.getAssetId(symbol);
      const roundedSize = this.roundSize(size, assetId);
      
      const order = {
        a: assetId,
        b: side === 'buy',
        p: 0, // Market order price
        s: roundedSize,
        r: false, // Reduce only
        t: 'Ioc' // Time in force
      };

      const response = await this.makeExchangeRequest('order', {
        orders: [order]
      });

      logger.info(`Market order placed for ${symbol}:`, {
        side,
        size: roundedSize,
        response
      });

      return {
        orderId: response.statuses?.[0]?.resting?.oid || Date.now().toString(),
        symbol,
        side,
        size: roundedSize,
        type: 'market',
        status: 'filled'
      };
    } catch (error) {
      logger.error(`Failed to place market order for ${symbol}:`, error);
      throw error;
    }
  }

  async placeLimitOrder(symbol, side, size, price, params = {}) {
    try {
      const assetId = this.getAssetId(symbol);
      const roundedSize = this.roundSize(size, assetId);
      const roundedPrice = this.roundPrice(price, assetId);
      
      const order = {
        a: assetId,
        b: side === 'buy',
        p: roundedPrice,
        s: roundedSize,
        r: false, // Reduce only
        t: 'Gtc' // Time in force
      };

      const response = await this.makeExchangeRequest('order', {
        orders: [order]
      });

      logger.info(`Limit order placed for ${symbol}:`, {
        side,
        size: roundedSize,
        price: roundedPrice,
        response
      });

      return {
        orderId: response.statuses?.[0]?.resting?.oid || Date.now().toString(),
        symbol,
        side,
        size: roundedSize,
        price: roundedPrice,
        type: 'limit',
        status: 'open'
      };
    } catch (error) {
      logger.error(`Failed to place limit order for ${symbol}:`, error);
      throw error;
    }
  }

  async placeStopLoss(symbol, side, size, stopPrice, params = {}) {
    try {
      const assetId = this.getAssetId(symbol);
      const roundedSize = this.roundSize(size, assetId);
      const roundedStopPrice = this.roundPrice(stopPrice, assetId);
      
      const order = {
        a: assetId,
        b: side === 'buy',
        p: roundedStopPrice,
        s: roundedSize,
        r: true, // Reduce only for stop loss
        t: 'Gtc' // Time in force
      };

      const response = await this.makeExchangeRequest('order', {
        orders: [order]
      });

      logger.info(`Stop loss order placed for ${symbol}:`, {
        side,
        size: roundedSize,
        stopPrice: roundedStopPrice,
        response
      });

      return {
        orderId: response.statuses?.[0]?.resting?.oid || Date.now().toString(),
        symbol,
        side,
        size: roundedSize,
        stopPrice: roundedStopPrice,
        type: 'stop',
        status: 'open'
      };
    } catch (error) {
      logger.error(`Failed to place stop loss for ${symbol}:`, error);
      throw error;
    }
  }

  async placeTakeProfit(symbol, side, size, price, params = {}) {
    // Take profit is implemented as a limit order
    return this.placeLimitOrder(symbol, side, size, price, params);
  }

  async closePosition(symbol) {
    try {
      const position = await this.getPosition(symbol);
      if (!position) {
        throw new Error(`No open position found for ${symbol}`);
      }

      const oppositeSide = position.side === 'long' ? 'sell' : 'buy';
      return this.placeMarketOrder(symbol, oppositeSide, position.size);
    } catch (error) {
      logger.error(`Failed to close position for ${symbol}:`, error);
      throw error;
    }
  }

  async cancelOrder(orderId) {
    try {
      const response = await this.makeExchangeRequest('cancel', {
        oids: [parseInt(orderId)]
      });

      logger.info(`Order cancelled:`, { orderId, response });
      return { success: true, orderId };
    } catch (error) {
      logger.error(`Failed to cancel order ${orderId}:`, error);
      throw error;
    }
  }

  async getOrder(orderId) {
    try {
      const response = await this.makeInfoRequest('openOrders', {
        user: this.apiKey
      });

      const order = response.find(o => o.oid === parseInt(orderId));
      if (!order) {
        return null;
      }

      return {
        orderId: order.oid.toString(),
        symbol: order.coin,
        side: order.side === 'B' ? 'buy' : 'sell',
        size: parseFloat(order.sz),
        price: parseFloat(order.limitPx),
        status: order.status,
        type: order.orderType
      };
    } catch (error) {
      logger.error(`Failed to get order ${orderId}:`, error);
      return null;
    }
  }

  // ===== Hyperliquid-specific methods =====

  /**
   * Get all supported symbols
   */
  async getSupportedSymbols() {
    if (!this.assetMeta || !this.spotMeta) {
      await this.initializeAssetMeta();
    }

    const perpetuals = this.assetMeta?.map(asset => asset.name) || [];
    const spots = this.spotMeta?.map(spot => `${spot.name}/${spot.quoteToken}`) || [];
    
    return [...perpetuals, ...spots];
  }

  /**
   * Get asset metadata
   */
  async getAssetMetadata() {
    if (!this.assetMeta || !this.spotMeta) {
      await this.initializeAssetMeta();
    }

    return {
      perpetuals: this.assetMeta || [],
      spots: this.spotMeta || []
    };
  }
}

module.exports = { HyperliquidAPI };
