# CCXT Apex Integration - Focused Implementation Plan

**Target:** Apex DEX (futures/perpetuals focus)  
**Type:** DEX (Decentralized Exchange)  
**Approach:** Minimal, testable implementation  
**Based on:** [CCXT Documentation](https://docs.ccxt.com/)

---

## ✅ Apex DEX Overview

**Apex** is a decentralized exchange (DEX) that specializes in **perpetual futures trading**. Perfect for your futures focus!

**CCXT ID:** `apex`  
**Type:** DEX  
**Version:** 3 (latest)  
**CCXT Pro:** Supported

---

## Phase 1: Apex Setup & Implementation

### Step 1: Install CCXT

```bash
npm install ccxt
```

### Step 2: Create Apex CCXT Wrapper

```javascript
// src/exchanges/ccxtApexApi.js
const ccxt = require('ccxt');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class CCXTApexAPI extends BaseExchangeAPI {
  constructor(config) {
    super(config);
    this.exchangeName = 'apex';
    
    // Get CCXT Apex exchange class
    const ExchangeClass = ccxt.apex;
    if (!ExchangeClass) {
      throw new Error('CCXT exchange "apex" not found. Make sure CCXT is installed.');
    }
    
    // Apex DEX configuration
    // Apex typically requires: apiKey, secret, and may need network/chain info
    this.exchange = new ExchangeClass({
      apiKey: config.apiKey || config.api_key,
      secret: config.apiSecret || config.secret || config.api_secret,
      sandbox: config.environment === 'sandbox' || config.sandbox === true,
      enableRateLimit: true,
      options: {
        // Apex-specific options
        // May need: network, chainId, etc.
        ...config.options,
      },
    });
    
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
        logger.info(`✅ Markets loaded for Apex DEX`);
        
        // Log available markets for debugging
        const marketCount = Object.keys(this.exchange.markets).length;
        logger.info(`   Found ${marketCount} markets`);
        
        // Check futures/perpetuals support
        const futuresMarkets = Object.values(this.exchange.markets).filter(
          m => m.future === true || m.type === 'future' || m.type === 'swap'
        );
        logger.info(`   Futures/Perpetuals: ${futuresMarkets.length} markets`);
        
        // Log some example markets
        if (futuresMarkets.length > 0) {
          const examples = futuresMarkets.slice(0, 3).map(m => m.symbol);
          logger.info(`   Examples: ${examples.join(', ')}`);
        }
        
      } catch (error) {
        logger.logError('Failed to load Apex markets', error);
        throw error;
      }
    }
  }
  
  /**
   * Normalize symbol to CCXT format
   * Apex uses BASE/QUOTE format for perpetuals (e.g., BTC/USD:USD)
   */
  normalizeSymbol(symbol) {
    if (symbol.includes('/')) {
      return symbol; // Already in CCXT format
    }
    
    // Try to find market by symbol
    if (this.marketsLoaded) {
      try {
        const market = this.exchange.market(symbol);
        if (market) {
          return market.id; // CCXT standardized symbol
        }
      } catch (e) {
        // Market not found, try conversion
      }
    }
    
    // Apex perpetuals format: BTC/USD:USD or BTC-PERP
    // If symbol is BTCUSDT, try BTC/USDT:USDT
    if (symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4);
      return `${base}/USDT:USDT`; // Perpetual format
    }
    
    if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3);
      return `${base}/USD:USD`; // Perpetual format
    }
    
    // If it ends with -PERP, convert to /USD:USD
    if (symbol.endsWith('-PERP')) {
      const base = symbol.slice(0, -5);
      return `${base}/USD:USD`;
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
      logger.logError('Failed to fetch Apex balance', error);
      throw error;
    }
  }
  
  async getAvailableMargin() {
    await this.loadMarkets();
    
    try {
      const balance = await this.exchange.fetchBalance();
      
      // For DEX futures, check margin info
      // Apex should have margin/available balance
      const margin = balance.info?.availableMargin || 
                    balance.info?.availableBalance ||
                    balance.info?.marginAvailable ||
                    balance.USDC?.free || // Apex often uses USDC
                    balance.USDT?.free || 
                    balance.USD?.free || 
                    0;
      
      return parseFloat(margin);
    } catch (error) {
      logger.logError('Failed to fetch available margin from Apex', error);
      throw error;
    }
  }
  
  // ==================== Position Methods (Futures/Perpetuals) ====================
  
  async getPositions() {
    await this.loadMarkets();
    
    try {
      // Apex is a DEX for futures, so it should support positions
      if (!this.exchange.has['fetchPositions']) {
        logger.warn('Apex DEX may not support fetchPositions - trying anyway');
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
          liquidationPrice: parseFloat(p.liquidationPrice || 0),
        }));
    } catch (error) {
      logger.logError('Failed to fetch Apex positions', error);
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
      logger.logError(`Failed to fetch Apex ticker for ${symbol}`, error);
      throw error;
    }
  }
  
  /**
   * Fetch OHLCV data (for AI worker)
   */
  async fetchOHLCV(symbol, timeframe = '1m', since = null, limit = 100) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const ohlcv = await this.exchange.fetchOHLCV(normalizedSymbol, timeframe, since, limit);
      
      return ohlcv.map(candle => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      logger.logError(`Failed to fetch Apex OHLCV for ${symbol}`, error);
      throw error;
    }
  }
  
  // ==================== Order Methods ====================
  
  async placeMarketOrder(symbol, side, quantity) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase(); // 'buy' or 'sell'
      
      // For DEX futures, may need additional params
      const params = {
        type: 'market',
        // Apex-specific params if needed
      };
      
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
      logger.logError(`Failed to place Apex market order for ${symbol}`, error);
      throw error;
    }
  }
  
  async placeLimitOrder(symbol, side, quantity, price) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      
      const params = {
        type: 'limit',
      };
      
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
      logger.logError(`Failed to place Apex limit order for ${symbol}`, error);
      throw error;
    }
  }
  
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    await this.loadMarkets();
    
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      
      // Check if Apex supports stop orders
      if (!this.exchange.has['createStopOrder'] && !this.exchange.has['createStopLimitOrder']) {
        logger.warn('Apex may not support stop orders directly');
        // Fallback: Could use exchange-specific stop loss mechanism
        throw new Error('Apex stop orders may require exchange-specific implementation');
      }
      
      // Try stop order
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
      logger.logError(`Failed to place Apex stop loss for ${symbol}`, error);
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
      logger.logError(`Failed to cancel Apex order ${orderId}`, error);
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
      logger.logError(`Failed to fetch Apex order ${orderId}`, error);
      throw error;
    }
  }
}

module.exports = CCXTApexAPI;
```

---

## Integration with ExchangeFactory

```javascript
// In src/exchanges/ExchangeFactory.js

const CCXTApexAPI = require('./ccxtApexApi');

static createExchange(exchangeName, config) {
  const name = exchangeName.toLowerCase();
  
  // Apex DEX via CCXT
  if (name === 'apex') {
    return new CCXTApexAPI(config);
  }
  
  // Existing custom exchanges (unchanged)
  // ...
}

// Update getSupportedExchanges
static getSupportedExchanges() {
  return [
    'aster', 'oanda', 'tradier', 'tradier_options', 'lighter', 'hyperliquid',
    'apex', // Apex DEX via CCXT
  ];
}

// Update mapCredentialsToConfig
static mapCredentialsToConfig(exchangeName, credentials) {
  const name = exchangeName.toLowerCase();
  
  if (name === 'apex') {
    return {
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      environment: credentials.environment || 'production',
      sandbox: credentials.environment === 'sandbox',
      options: credentials.extra?.options || {},
      // Apex may need additional config like network, chainId, etc.
      // Add to extra.options if needed
    };
  }
  
  // Existing mappings...
}
```

---

## Testing Plan

### Step 1: Basic Connection Test

Create `test-apex.js`:

```javascript
// test-apex.js
require('dotenv').config();
const CCXTApexAPI = require('./src/exchanges/ccxtApexApi');

async function test() {
  console.log('🚀 Testing Apex DEX Integration...\n');
  
  try {
    // Initialize Apex API
    const api = new CCXTApexAPI({
      apiKey: process.env.APEX_API_KEY,
      apiSecret: process.env.APEX_API_SECRET,
      sandbox: true, // Start with sandbox/testnet
      options: {
        // Apex-specific options if needed
        // network: 'mainnet',
        // chainId: 1,
      },
    });
    
    console.log('✅ Apex API initialized\n');
    
    // Test 1: Load markets
    console.log('📊 Loading markets...');
    await api.loadMarkets();
    console.log('✅ Markets loaded\n');
    
    // Test 2: Get balance
    console.log('💰 Fetching balance...');
    const balance = await api.getBalance();
    console.log('✅ Balance:', balance);
    console.log('   Available margin:', await api.getAvailableMargin(), '\n');
    
    // Test 3: Get ticker (try a common perpetual)
    console.log('📈 Fetching ticker...');
    try {
      const ticker = await api.getTicker('BTC/USD:USD'); // Apex perpetual format
      console.log('✅ Ticker:', ticker);
    } catch (e) {
      console.log('⚠️  Ticker test failed (may need different symbol format):', e.message);
    }
    console.log();
    
    // Test 4: Get positions (futures)
    console.log('📊 Fetching positions...');
    const positions = await api.getPositions();
    console.log('✅ Positions:', positions.length > 0 ? positions : 'No open positions');
    console.log('   Futures supported:', positions.length > 0 || api.exchange.has['fetchPositions'], '\n');
    
    // Test 5: List available markets
    console.log('📋 Available perpetual markets:');
    const markets = Object.values(api.exchange.markets)
      .filter(m => m.future || m.type === 'future' || m.type === 'swap')
      .slice(0, 10)
      .map(m => m.symbol);
    console.log('   ', markets.join(', '), '\n');
    
    console.log('✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();
```

### Step 2: Run Test

```bash
# Set environment variables
export APEX_API_KEY=your_api_key
export APEX_API_SECRET=your_api_secret

# Run test
node test-apex.js
```

---

## Environment Variables

Add to your `.env`:

```bash
# Apex DEX
APEX_API_KEY=your_apex_api_key
APEX_API_SECRET=your_apex_api_secret
```

---

## What I Need From You

1. **Apex API Credentials:**
   - API Key
   - API Secret
   - Any additional config needed? (network, chainId, etc.)

2. **Test Environment:**
   - Do you have Apex testnet/sandbox access?
   - Or should we start with mainnet (small test trades)?

3. **Symbol Format:**
   - What symbols do you want to trade? (e.g., BTC-PERP, BTC/USD:USD)
   - I can help identify the correct format

---

## Next Steps

1. **Install CCXT:** `npm install ccxt`
2. **Create the wrapper:** I'll create `src/exchanges/ccxtApexApi.js`
3. **Update ExchangeFactory:** Add Apex support
4. **Test:** Run the test script with your API keys

**Ready to start?** Share your Apex API setup details and I'll begin implementation! 🚀

