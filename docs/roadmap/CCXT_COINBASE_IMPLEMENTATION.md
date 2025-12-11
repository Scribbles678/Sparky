# CCXT Coinbase Integration - Focused Implementation Plan

**Target:** Coinbase (futures focus)  
**Approach:** Minimal, testable implementation  
**Based on:** [CCXT Documentation](https://docs.ccxt.com/)

---

## ⚠️ Important: Coinbase Futures Support

**Note:** Coinbase primarily offers **spot trading**. For futures/perpetuals, you may need:
- **Coinbase Advanced Trade** (newer API)
- Or consider alternatives: **Bybit**, **Binance**, **OKX** (all have strong futures support)

**Let's verify:** Do you have a Coinbase Advanced Trade account with futures enabled? Or should we test with Coinbase spot first, then add a futures exchange?

---

## Phase 1: Coinbase Setup (Spot or Futures)

### Step 1: Install CCXT

```bash
npm install ccxt
```

### Step 2: Determine Coinbase Exchange ID

CCXT supports multiple Coinbase variants:
- `coinbase` - Basic Coinbase (spot)
- `coinbasepro` - Coinbase Pro (deprecated, being phased out)
- `coinbaseadvancedtrade` - Coinbase Advanced Trade (newer API)

**For futures, we need to verify which one supports it.**

### Step 3: Create CCXT Wrapper (Coinbase-Specific)

```javascript
// src/exchanges/ccxtCoinbaseApi.js
const ccxt = require('ccxt');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class CCXTCoinbaseAPI extends BaseExchangeAPI {
  constructor(config) {
    super(config);
    
    // Determine which Coinbase exchange to use
    // Try coinbaseadvancedtrade first (newer), fallback to coinbasepro
    const exchangeId = config.exchangeId || 'coinbaseadvancedtrade';
    
    // Get CCXT exchange class
    const ExchangeClass = ccxt[exchangeId];
    if (!ExchangeClass) {
      throw new Error(`CCXT exchange '${exchangeId}' not found`);
    }
    
    // Coinbase-specific config
    this.exchange = new ExchangeClass({
      apiKey: config.apiKey || config.api_key,
      secret: config.apiSecret || config.secret || config.api_secret,
      password: config.passphrase || config.password, // Coinbase requires passphrase
      sandbox: config.environment === 'sandbox' || config.sandbox === true,
      enableRateLimit: true,
      options: {
        // Coinbase-specific options
        ...config.options,
      },
    });
    
    this.exchangeName = exchangeId;
    this.marketsLoaded = false;
  }
  
  /**
   * Load markets (required before trading)
   */
  async loadMarkets(reload = false) {
    if (!this.marketsLoaded || reload) {
      try {
        await this.exchange.loadMarkets();
        this.marketsLoaded = true;
        logger.info(`✅ Markets loaded for ${this.exchangeName}`);
        
        // Log available markets for debugging
        const marketCount = Object.keys(this.exchange.markets).length;
        logger.info(`   Found ${marketCount} markets`);
        
        // Check if futures are supported
        const hasFutures = Object.values(this.exchange.markets).some(
          m => m.future === true || m.type === 'future'
        );
        logger.info(`   Futures support: ${hasFutures ? 'YES' : 'NO'}`);
        
      } catch (error) {
        logger.logError(`Failed to load markets for ${this.exchangeName}`, error);
        throw error;
      }
    }
  }
  
  /**
   * Normalize symbol to CCXT format
   * Coinbase uses BASE-USD format (e.g., BTC-USD)
   */
  normalizeSymbol(symbol) {
    if (symbol.includes('/')) {
      return symbol; // Already in CCXT format
    }
    
    // Coinbase format: BTCUSD → BTC/USD
    // Or BTC-USD → BTC/USD
    if (symbol.includes('-')) {
      return symbol.replace('-', '/');
    }
    
    // Try to find market
    if (this.marketsLoaded) {
      try {
        const market = this.exchange.market(symbol);
        if (market) {
          return market.id;
        }
      } catch (e) {
        // Market not found, try conversion
      }
    }
    
    // Fallback: assume USD quote
    if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3);
      return `${base}/USD`;
    }
    
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
        if (currency === 'info' || currency === 'free' || currency === 'used' || currency === 'total') {
          continue; // Skip metadata
        }
        
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
      logger.logError(`Failed to fetch balance for ${this.exchangeName}`, error);
      throw error;
    }
  }
  
  async getAvailableMargin() {
    await this.loadMarkets();
    
    try {
      const balance = await this.exchange.fetchBalance();
      
      // For futures, check if there's margin info
      if (this.exchange.has['fetchPositions']) {
        // Try to get margin from balance info
        const margin = balance.info?.availableMargin || 
                      balance.info?.availableBalance ||
                      balance.USD?.free || 
                      balance.USDT?.free || 
                      0;
        return parseFloat(margin);
      }
      
      // For spot, use free balance
      return parseFloat(balance.USD?.free || balance.USDT?.free || 0);
    } catch (error) {
      logger.logError(`Failed to fetch available margin for ${this.exchangeName}`, error);
      throw error;
    }
  }
  
  // ==================== Position Methods (Futures) ====================
  
  async getPositions() {
    await this.loadMarkets();
    
    try {
      // Check if exchange supports positions (futures)
      if (!this.exchange.has['fetchPositions']) {
        logger.debug(`${this.exchangeName} does not support futures positions`);
        return [];
      }
      
      const positions = await this.exchange.fetchPositions();
      
      // Map CCXT positions to your format
      return positions
        .filter(p => {
          const contracts = parseFloat(p.contracts || 0);
          return contracts !== 0;
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
        }));
    } catch (error) {
      logger.logError(`Failed to fetch positions for ${this.exchangeName}`, error);
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
      
      return {
        symbol: normalizedSymbol,
        lastPrice: parseFloat(ticker.last || 0),
        bid: parseFloat(ticker.bid || 0),
        ask: parseFloat(ticker.ask || 0),
        volume: parseFloat(ticker.quoteVolume || ticker.baseVolume || 0),
        price: parseFloat(ticker.last || ticker.close || 0),
      };
    } catch (error) {
      logger.logError(`Failed to fetch ticker for ${symbol}`, error);
      throw error;
    }
  }
  
  // ==================== Order Methods ====================
  
  async placeMarketOrder(symbol, side, quantity) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase(); // 'buy' or 'sell'
      
      // For futures, may need to specify market type
      const params = {};
      if (this.exchange.has['fetchPositions']) {
        // Futures order - may need additional params
        params.type = 'market';
      }
      
      const order = await this.exchange.createMarketOrder(
        normalizedSymbol,
        normalizedSide,
        quantity,
        undefined, // price (not needed for market)
        params
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
      logger.logError(`Failed to place market order for ${symbol}`, error);
      throw error;
    }
  }
  
  async placeLimitOrder(symbol, side, quantity, price) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      
      const params = {};
      if (this.exchange.has['fetchPositions']) {
        params.type = 'limit';
      }
      
      const order = await this.exchange.createLimitOrder(
        normalizedSymbol,
        normalizedSide,
        quantity,
        price,
        params
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
      logger.logError(`Failed to place limit order for ${symbol}`, error);
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
        logger.warn(`${this.exchangeName} does not support stop orders`);
        throw new Error(`${this.exchangeName} does not support stop orders`);
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
          stopPrice // Use stopPrice as limit price
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

module.exports = CCXTCoinbaseAPI;
```

---

## Integration with ExchangeFactory

```javascript
// In src/exchanges/ExchangeFactory.js

const CCXTCoinbaseAPI = require('./ccxtCoinbaseApi');

static createExchange(exchangeName, config) {
  const name = exchangeName.toLowerCase();
  
  // Coinbase via CCXT
  if (name === 'coinbase' || name === 'coinbaseadvancedtrade' || name === 'coinbasepro') {
    return new CCXTCoinbaseAPI({
      ...config,
      exchangeId: name === 'coinbaseadvancedtrade' ? 'coinbaseadvancedtrade' : 
                  name === 'coinbasepro' ? 'coinbasepro' : 'coinbase',
    });
  }
  
  // Existing custom exchanges (unchanged)
  // ...
}

// Update mapCredentialsToConfig
static mapCredentialsToConfig(exchangeName, credentials) {
  const name = exchangeName.toLowerCase();
  
  if (name === 'coinbase' || name === 'coinbaseadvancedtrade' || name === 'coinbasepro') {
    return {
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      passphrase: credentials.passphrase || credentials.extra?.passphrase, // Coinbase requires passphrase
      environment: credentials.environment || 'production',
      sandbox: credentials.environment === 'sandbox',
      options: credentials.extra?.options || {},
      exchangeId: name,
    };
  }
  
  // Existing mappings...
}
```

---

## Testing Plan

### Step 1: Basic Connection
```javascript
// Test script: test-coinbase.js
const CCXTCoinbaseAPI = require('./src/exchanges/ccxtCoinbaseApi');

async function test() {
  const api = new CCXTCoinbaseAPI({
    apiKey: process.env.COINBASE_API_KEY,
    apiSecret: process.env.COINBASE_API_SECRET,
    passphrase: process.env.COINBASE_PASSPHRASE,
    sandbox: true, // Start with sandbox
    exchangeId: 'coinbaseadvancedtrade',
  });
  
  // Test 1: Load markets
  await api.loadMarkets();
  console.log('✅ Markets loaded');
  
  // Test 2: Get balance
  const balance = await api.getBalance();
  console.log('✅ Balance:', balance);
  
  // Test 3: Get ticker
  const ticker = await api.getTicker('BTC/USD');
  console.log('✅ Ticker:', ticker);
  
  // Test 4: Check futures support
  const positions = await api.getPositions();
  console.log('✅ Positions:', positions);
  console.log('   Futures supported:', positions.length > 0 || api.exchange.has['fetchPositions']);
}

test().catch(console.error);
```

---

## Questions for You

1. **Do you have Coinbase Advanced Trade account?** (required for newer API)
2. **Do you have futures enabled?** (Coinbase may not support futures)
3. **Do you have API keys with these permissions?**
   - View
   - Trade
   - (Futures if available)
4. **Should we test with spot first?** (safer, then add futures exchange later)

---

## Alternative: If Coinbase Doesn't Support Futures

If Coinbase doesn't have futures, we can:
1. **Test with Coinbase spot first** (prove the integration works)
2. **Add Bybit or Binance for futures** (both have excellent futures support via CCXT)

**Which do you prefer?** Let me know and I'll adjust the implementation!

