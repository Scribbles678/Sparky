# CCXT Implementation Notes

**Based on:** Official CCXT Documentation  
**Date:** December 2025

---

## Key Learnings from CCXT Docs

### 1. Symbol Normalization ✅

**Important:** Don't parse symbol strings manually!

**Correct approach:**
```javascript
// After loadMarkets()
const market = exchange.market(symbol);
const standardizedSymbol = market.symbol || market.id;
```

**Why:** CCXT handles all symbol formats internally. Manual parsing is discouraged per docs.

**Perpetual format:**
- `ETH/USDT:USDT` - Linear perpetual (settled in USDT)
- `BTC/USD:USD` - Linear perpetual (settled in USD)
- `ETH/USDT:ETH` - Inverse perpetual (settled in ETH)

**Futures format:**
- `BTC/USDT:USDT-211225` - Futures with expiry date

### 2. Order Placement ✅

**Unified method:**
```javascript
exchange.createOrder(symbol, type, side, amount, price, params)
```

**Convenience methods (also work):**
```javascript
exchange.createMarketOrder(symbol, side, amount)
exchange.createLimitOrder(symbol, side, amount, price)
```

**Both are valid!** We're using convenience methods which is fine.

### 3. Error Handling ✅

**CCXT error hierarchy:**
```
BaseError
├── ExchangeError (non-recoverable)
│   ├── InvalidOrder
│   ├── InsufficientFunds
│   ├── BadSymbol
│   └── ...
└── OperationFailed (recoverable)
    └── NetworkError
        ├── RequestTimeout
        ├── ExchangeNotAvailable
        └── RateLimitExceeded
```

**Handling:**
```javascript
try {
  const order = await exchange.createOrder(...);
} catch (e) {
  if (e instanceof ccxt.NetworkError) {
    // Retry
  } else if (e instanceof ccxt.ExchangeError) {
    // Don't retry
  }
}
```

### 4. Positions (Futures) ✅

**Method:**
```javascript
const positions = await exchange.fetchPositions([symbols]);
```

**Position structure:**
```javascript
{
  symbol: 'BTC/USDT:USDT',
  side: 'long', // or 'short'
  contracts: 5, // number of contracts
  entryPrice: 20000,
  markPrice: 20050,
  unrealizedPnl: 250,
  leverage: 10,
  collateral: 5300,
  // ... more fields
}
```

**Filter:** Only return positions where `contracts !== 0`

### 5. Market Loading ✅

**Required before trading:**
```javascript
await exchange.loadMarkets();
```

**Auto-loading:** CCXT will auto-load on first API call, but it's better to load explicitly.

**Caching:** Markets are cached after first load.

---

## Implementation Updates Made

### ✅ Symbol Normalization
- Now uses `exchange.market(symbol)` for proper normalization
- Falls back to basic conversion if markets not loaded
- Handles perpetual format (`:USDT`, `:USD`)

### ✅ Error Handling
- Added CCXT error type detection
- Better error messages
- Proper error logging

### ✅ Order Placement
- Using unified `createOrder()` method
- Added support checks (`has['createMarketOrder']`)
- Better error handling

### ✅ Positions
- Using `fetchPositions()` correctly
- Mapping all CCXT position fields
- Filtering zero contracts

---

## Testing Checklist

### Basic Tests
- [ ] Load markets
- [ ] Get ticker (ETH/USDT)
- [ ] Get balance
- [ ] Get positions (if futures)

### Order Tests (Paper Trading)
- [ ] Place market order
- [ ] Place limit order
- [ ] Cancel order
- [ ] Get order status

### Symbol Format Tests
- [ ] ETHUSDT → ETH/USDT
- [ ] ETH/USDT → ETH/USDT (already correct)
- [ ] ETH/USDT:USDT (perpetual)

---

## Common Issues & Solutions

### Issue: "must be greater than minimum amount precision of 1"
**Solution:** For futures, amount should be in contracts, not base currency.
```javascript
// If contractSize = 0.01, and you want 0.5 BTC:
const contracts = 0.5 / market.contractSize; // = 50 contracts
await exchange.createOrder(symbol, 'market', 'buy', contracts);
```

### Issue: Symbol not found
**Solution:** Use `exchange.market(symbol)` to get standardized symbol, or check available markets:
```javascript
const markets = Object.keys(exchange.markets);
console.log(markets.filter(m => m.includes('ETH')));
```

### Issue: Market orders not supported
**Solution:** Check before placing:
```javascript
if (exchange.has['createMarketOrder']) {
  // Place market order
} else {
  // Use limit order at current price
}
```

---

## Next Steps

1. **Test with Apex + ETH/USDT**
2. **Verify symbol normalization works**
3. **Test order placement (paper trading)**
4. **Add more exchanges as needed**

**The implementation is now aligned with CCXT best practices!** ✅

