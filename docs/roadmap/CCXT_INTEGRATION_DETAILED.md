# CCXT Integration - Detailed Technical Plan

**Based on:** [CCXT Documentation](https://github.com/ccxt/ccxt/wiki) and [CCXT Manual](https://docs.ccxt.com)

---

## CCXT API Patterns (Verified)

### 1. **Instantiation**
```javascript
const ccxt = require('ccxt');

// Create exchange instance
const exchange = new ccxt.binance({
  apiKey: 'YOUR_API_KEY',
  secret: 'YOUR_SECRET',
  sandbox: false, // or true for testnet
  enableRateLimit: true, // Built-in rate limiting
  options: {
    // Exchange-specific options
  }
});

// Load markets (required before trading)
await exchange.loadMarkets();
```

### 2. **Order Methods**
```javascript
// Unified order creation
const order = await exchange.createOrder(
  symbol,      // 'BTC/USDT'
  type,        // 'market', 'limit', 'stop', etc.
  side,        // 'buy' or 'sell'
  amount,      // quantity
  price,       // for limit orders
  params       // optional exchange-specific params
);

// Convenience methods
await exchange.createMarketOrder(symbol, side, amount);
await exchange.createLimitOrder(symbol, side, amount, price);
await exchange.createStopOrder(symbol, side, amount, price);
```

### 3. **Position Methods**
```javascript
// Fetch positions (for futures/derivatives)
const positions = await exchange.fetchPositions([symbols]);

// Fetch balance (spot accounts)
const balance = await exchange.fetchBalance();

// Check if exchange supports positions
if (exchange.has['fetchPositions']) {
  // Use fetchPositions
} else {
  // Use fetchBalance and calculate from open orders
}
```

### 4. **Market Data**
```javascript
// Ticker
const ticker = await exchange.fetchTicker(symbol);

// OHLCV (candles)
const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);

// Order book
const orderbook = await exchange.fetchOrderBook(symbol);

// Trades
const trades = await exchange.fetchTrades(symbol);
```

### 5. **Error Handling**
```javascript
try {
  const order = await exchange.createOrder(...);
} catch (e) {
  if (e instanceof ccxt.NetworkError) {
    // Network issue, retry
  } else if (e instanceof ccxt.ExchangeError) {
    // Exchange-specific error
  } else if (e instanceof ccxt.InvalidOrder) {
    // Order parameters invalid
  }
}
```

### 6. **Symbol Standardization**
```javascript
// CCXT standardizes symbols to BASE/QUOTE format
// 'BTCUSDT' → 'BTC/USDT'
// 'BTC-USD' → 'BTC/USD'

// Convert your symbol to CCXT format
const ccxtSymbol = exchange.marketId(symbol); // or exchange.market(symbol).id
```

---

## Implementation Plan

### **Step 1: Create CCXT Wrapper Class**

```javascript
// src/exchanges/ccxtExchangeApi.js
const ccxt = require('ccxt');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class CCXTExchangeAPI extends BaseExchangeAPI {
  constructor(exchangeId, config) {
    super(config);
    this.exchangeId = exchangeId; // 'binance', 'bybit', etc.
    this.exchangeName = exchangeId;
    
    // Get CCXT exchange class
    const ExchangeClass = ccxt[exchangeId];
    if (!ExchangeClass) {
      throw new Error(`CCXT exchange '${exchangeId}' not found. Available: ${Object.keys(ccxt).join(', ')}`);
    }
    
    // Create CCXT instance
    this.exchange = new ExchangeClass({
      apiKey: config.apiKey || config.api_key,
      secret: config.apiSecret || config.secret || config.api_secret,
      sandbox: config.environment === 'sandbox' || config.sandbox === true,
      enableRateLimit: true, // CCXT handles rate limiting
      options: config.options || {}, // Exchange-specific options
    });
    
    // Track if markets are loaded
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
        logger.info(`✅ Markets loaded for ${this.exchangeId}`);
      } catch (error) {
        logger.logError(`Failed to load markets for ${this.exchangeId}`, error);
        throw error;
      }
    }
  }
  
  /**
   * Convert symbol to CCXT format (BASE/QUOTE)
   */
  normalizeSymbol(symbol) {
    // CCXT uses BASE/QUOTE format
    // Handle common formats: BTCUSDT → BTC/USDT, BTC-USD → BTC/USD
    if (symbol.includes('/')) {
      return symbol; // Already in CCXT format
    }
    
    // Try to find market by symbol
    if (this.marketsLoaded) {
      const market = this.exchange.market(symbol);
      if (market) {
        return market.id; // CCXT standardized symbol
      }
    }
    
    // Fallback: try common patterns
    // BTCUSDT → BTC/USDT
    if (symbol.length > 6 && symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4);
      return `${base}/USDT`;
    }
    
    // Return as-is and let CCXT handle it
    return symbol;
  }
  
  // ==================== Account Methods ====================
  
  async getBalance() {
    await this.loadMarkets();
    
    try {
      const balance = await this.exchange.fetchBalance();
      
      // Map CCXT balance to your format
      return [{
        asset: 'USDT', // or extract from balance
        free: balance.USDT?.free || 0,
        locked: balance.USDT?.used || 0,
        total: balance.USDT?.total || 0,
      }];
    } catch (error) {
      logger.logError(`Failed to fetch balance for ${this.exchangeId}`, error);
      throw error;
    }
  }
  
  async getAvailableMargin() {
    await this.loadMarkets();
    
    try {
      if (this.exchange.has['fetchPositions']) {
        // For futures exchanges
        const balance = await this.exchange.fetchBalance();
        return balance.info?.availableMargin || balance.USDT?.free || 0;
      } else {
        // For spot exchanges, use free balance
        const balance = await this.exchange.fetchBalance();
        return balance.USDT?.free || 0;
      }
    } catch (error) {
      logger.logError(`Failed to fetch available margin for ${this.exchangeId}`, error);
      throw error;
    }
  }
  
  // ==================== Position Methods ====================
  
  async getPositions() {
    await this.loadMarkets();
    
    try {
      if (this.exchange.has['fetchPositions']) {
        const positions = await this.exchange.fetchPositions();
        
        // Map CCXT positions to your format
        return positions
          .filter(p => parseFloat(p.contracts || 0) !== 0)
          .map(p => ({
            symbol: p.symbol,
            side: p.side, // 'long' or 'short'
            size: parseFloat(p.contracts || 0),
            entryPrice: parseFloat(p.entryPrice || 0),
            markPrice: parseFloat(p.markPrice || 0),
            unrealizedPnl: parseFloat(p.unrealizedPnl || 0),
            leverage: parseFloat(p.leverage || 1),
          }));
      } else {
        // Spot exchange - no positions, return empty
        return [];
      }
    } catch (error) {
      logger.logError(`Failed to fetch positions for ${this.exchangeId}`, error);
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
      
      // Map CCXT ticker to your format
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
      
      const order = await this.exchange.createMarketOrder(
        normalizedSymbol,
        normalizedSide,
        quantity
      );
      
      // Map CCXT order to your format
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
      
      const order = await this.exchange.createLimitOrder(
        normalizedSymbol,
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
      if (!this.exchange.has['createStopOrder']) {
        throw new Error(`${this.exchangeId} does not support stop orders`);
      }
      
      const order = await this.exchange.createStopOrder(
        normalizedSymbol,
        normalizedSide,
        quantity,
        stopPrice
      );
      
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
    // Similar to placeStopLoss but with take profit logic
    // Some exchanges use limit orders with take profit price
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
```

### **Step 2: Update ExchangeFactory**

```javascript
// In src/exchanges/ExchangeFactory.js

const CCXTExchangeAPI = require('./ccxtExchangeApi');

// Add to createExchange method
static createExchange(exchangeName, config) {
  const name = exchangeName.toLowerCase();
  
  // Check if it's a CCXT exchange
  if (this.isCCXTExchange(name)) {
    return new CCXTExchangeAPI(name, config);
  }
  
  // Existing custom exchanges (unchanged)
  switch (name) {
    // ... existing code
  }
}

static isCCXTExchange(exchangeName) {
  const ccxtExchanges = [
    'binance',
    'bybit',
    'kraken',
    'coinbase',
    'okx',
    'kucoin',
    'gate',
    'bitget',
    // Add more as needed
  ];
  return ccxtExchanges.includes(exchangeName.toLowerCase());
}

// Update getSupportedExchanges
static getSupportedExchanges() {
  return [
    'aster', 'oanda', 'tradier', 'tradier_options', 'lighter', 'hyperliquid',
    'binance', 'bybit', 'kraken', 'coinbase', 'okx', // CCXT exchanges
  ];
}

// Update mapCredentialsToConfig for CCXT exchanges
static mapCredentialsToConfig(exchangeName, credentials) {
  const name = exchangeName.toLowerCase();
  
  // CCXT exchanges
  if (this.isCCXTExchange(name)) {
    return {
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      environment: credentials.environment || 'production',
      sandbox: credentials.environment === 'sandbox',
      options: credentials.extra?.options || {},
    };
  }
  
  // Existing custom exchanges
  switch (name) {
    // ... existing code
  }
}
```

---

## Testing Checklist

### Phase 1: Basic Functionality
- [ ] Install CCXT: `npm install ccxt`
- [ ] Create `CCXTExchangeAPI` class
- [ ] Test instantiation with Binance
- [ ] Test `loadMarkets()`
- [ ] Test `getTicker()`
- [ ] Test `getBalance()`

### Phase 2: Order Placement (Paper Trading)
- [ ] Test `placeMarketOrder()` (paper trading)
- [ ] Test `placeLimitOrder()` (paper trading)
- [ ] Verify order appears in exchange
- [ ] Test `getOrder()`
- [ ] Test `cancelOrder()`

### Phase 3: Positions (Futures Exchanges)
- [ ] Test `getPositions()` (if exchange supports)
- [ ] Test `hasOpenPosition()`
- [ ] Test `closePosition()`

### Phase 4: Integration
- [ ] Add to `ExchangeFactory`
- [ ] Test with `TradeExecutor`
- [ ] Test end-to-end webhook flow
- [ ] Verify logging works
- [ ] Test error handling

---

## Known CCXT Patterns

### Symbol Format
- CCXT uses `BASE/QUOTE` format: `BTC/USDT`, `ETH/USD`
- Your system may use: `BTCUSDT`, `BTC-USD`
- Solution: `normalizeSymbol()` method converts formats

### Error Types
- `NetworkError` - Network issues, retry
- `ExchangeError` - Exchange-specific error
- `InvalidOrder` - Order parameters invalid
- `InsufficientFunds` - Not enough balance

### Rate Limiting
- CCXT handles automatically with `enableRateLimit: true`
- Respects exchange rate limits
- No manual throttling needed

### Market Loading
- Must call `loadMarkets()` before trading
- Cached after first load
- Reload if markets change

---

## Next Steps

1. **Review this plan** - Does it match your needs?
2. **Choose exchanges** - Which ones first? (Binance recommended)
3. **Start Phase 1** - Install CCXT and create wrapper
4. **Test thoroughly** - Paper trading first

**Ready to proceed?** Let me know and I'll start implementing! 🚀

