# Trading212 API Implementation Guide

## Overview

Trading212 is a UK-based broker offering stocks, ETFs, and other equity instruments. The Public API is currently in **beta** and supports programmatic trading for **Invest and Stocks ISA** account types only.

**Important Limitations:**
- **Live Trading**: Only Market Orders are supported
- **Demo Trading**: All order types (Market, Limit, Stop, Stop-Limit)
- **Account Types**: Invest and Stocks ISA only (CFD accounts not supported)
- **Currency**: Orders execute only in primary account currency
- **Multi-Currency**: Multi-currency accounts not supported via API

## Authentication

Trading212 uses **HTTP Basic Authentication** with API Key and API Secret.

### Credential Format

- **API Key**: Username in Basic Auth
- **API Secret**: Password in Basic Auth
- **Authorization Header**: `Basic {base64(apiKey:apiSecret)}`

### Example (Node.js)

```javascript
const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
const headers = {
  'Authorization': `Basic ${credentials}`,
  'Content-Type': 'application/json'
};
```

## API Environments

- **Demo (Paper Trading)**: `https://demo.trading212.com/api/v0`
- **Live (Real Money)**: `https://live.trading212.com/api/v0`

## Base URLs

- **Demo**: `https://demo.trading212.com/api/v0`
- **Live**: `https://live.trading212.com/api/v0`

## Symbol Format

Trading212 uses a specific ticker format: `{SYMBOL}_{COUNTRY}_{TYPE}`

**Examples:**
- `AAPL_US_EQ` (Apple stock, US, Equity)
- `MSFT_US_EQ` (Microsoft stock, US, Equity)
- `AMZN_US_EQ` (Amazon stock, US, Equity)

**Symbol Mapping:**
- Standard symbols (e.g., `AAPL`) need to be converted to Trading212 format
- Use `/api/v0/equity/metadata/instruments` to search for correct ticker
- Or construct format: `{SYMBOL}_US_EQ` for US stocks (may need adjustment for other markets)

## Account Endpoints

### Get Account Cash Balance

**Endpoint:** `GET /api/v0/equity/account/cash`

**Rate Limit:** 1 request per 2 seconds

**Response:**
```json
{
  "blocked": 0,
  "free": 1000.00,
  "invested": 5000.00,
  "pieCash": 0,
  "ppl": 0,
  "result": 6000.00,
  "total": 6000.00
}
```

### Get Account Information

**Endpoint:** `GET /api/v0/equity/account/info`

**Rate Limit:** 1 request per 30 seconds

**Response:**
```json
{
  "currencyCode": "USD",
  "id": 12345678
}
```

**Implementation:**
```javascript
async getBalance() {
  const cashResponse = await this.makeRequest('GET', '/equity/account/cash');
  const infoResponse = await this.makeRequest('GET', '/equity/account/info');
  
  const currency = infoResponse.currencyCode || 'USD';
  const free = parseFloat(cashResponse.free || 0);
  const total = parseFloat(cashResponse.total || 0);
  
  return [{
    asset: currency,
    availableBalance: free,
    balance: total,
  }];
}
```

## Position Endpoints

### Get All Open Positions

**Endpoint:** `GET /api/v0/equity/portfolio`

**Rate Limit:** 1 request per 5 seconds

**Note:** Endpoint is `/equity/portfolio`, not `/equity/positions`

**Response:**
```json
[
  {
    "averagePrice": 150.00,
    "currentPrice": 155.00,
    "frontend": "API",
    "fxPpl": 0,
    "initialFillDate": "2019-08-24T14:15:22Z",
    "maxBuy": 0,
    "maxSell": 0,
    "pieQuantity": 0,
    "ppl": 52.50,
    "quantity": 10.5,
    "ticker": "AAPL_US_EQ"
  }
]
```

**Implementation:**
```javascript
async getPositions() {
  const positions = await this.makeRequest('GET', '/equity/portfolio');
  return positions.map(pos => ({
    symbol: pos.ticker,
    positionAmt: pos.quantity.toString(),
    entryPrice: parseFloat(pos.averagePrice || 0),
    markPrice: parseFloat(pos.currentPrice || 0),
    unRealizedProfit: parseFloat(pos.ppl || 0),
  }));
}
```

### Get Position by Symbol

**Implementation:**
```javascript
async getPosition(symbol) {
  const ticker = this.toTrading212Ticker(symbol);
  const positions = await this.getPositions();
  return positions.find(p => p.symbol === ticker) || null;
}
```

## Order Endpoints

### Place Market Order

**Endpoint:** `POST /api/v0/equity/orders/market`

**Rate Limit:** 50 requests per 1 minute

**Request Body:**
```json
{
  "ticker": "AAPL_US_EQ",
  "quantity": 10.5,
  "extendedHours": false
}
```

**Important:**
- **Buy Order**: Use positive quantity (e.g., `10.5`)
- **Sell Order**: Use negative quantity (e.g., `-10.5`)
- **Extended Hours**: Set to `true` to allow execution outside standard trading hours

**Response:**
```json
{
  "id": 123456789,
  "ticker": "AAPL_US_EQ",
  "quantity": 10.5,
  "status": "pending"
}
```

**Implementation:**
```javascript
async placeMarketOrder(symbol, side, quantity) {
  const ticker = this.toTrading212Ticker(symbol);
  const orderQuantity = side.toLowerCase() === 'sell' ? -Math.abs(quantity) : Math.abs(quantity);
  
  const orderData = {
    ticker: ticker,
    quantity: orderQuantity,
    extendedHours: false
  };
  
  const response = await this.makeRequest('POST', '/equity/orders/market', orderData);
  
  return {
    orderId: response.id.toString(),
    status: response.status || 'pending',
  };
}
```

### Place Limit Order

**Endpoint:** `POST /api/v0/equity/orders/limit`

**Rate Limit:** 1 request per 2 seconds

**Note:** Only available in **Demo** environment. Live trading does not support limit orders.

**Request Body:**
```json
{
  "ticker": "AAPL_US_EQ",
  "quantity": 10.5,
  "limitPrice": 150.00,
  "timeValidity": "DAY"
}
```

**Parameters:**
- `timeValidity`: `"DAY"` (expires at midnight) or `"GOOD_TILL_CANCEL"` (remains active until filled or cancelled)

**Implementation:**
```javascript
async placeLimitOrder(symbol, side, quantity, price, timeValidity = 'DAY') {
  if (this.environment === 'production' || this.environment === 'live') {
    throw new Error('Limit orders are not supported in live trading. Only market orders are allowed.');
  }
  
  const ticker = this.toTrading212Ticker(symbol);
  const orderQuantity = side.toLowerCase() === 'sell' ? -Math.abs(quantity) : Math.abs(quantity);
  
  // Validate timeValidity
  if (timeValidity !== 'DAY' && timeValidity !== 'GOOD_TILL_CANCEL') {
    timeValidity = 'DAY';
  }
  
  const orderData = {
    ticker: ticker,
    quantity: orderQuantity,
    limitPrice: parseFloat(price),
    timeValidity: timeValidity,
  };
  
  const response = await this.makeRequest('POST', '/equity/orders/limit', orderData);
  
  return {
    orderId: response.id.toString(),
    status: response.status || 'pending',
  };
}
```

### Place Stop Order

**Endpoint:** `POST /api/v0/equity/orders/stop`

**Rate Limit:** 1 request per 2 seconds

**Note:** Only available in **Demo** environment. Live trading does not support stop orders.

**Request Body:**
```json
{
  "ticker": "AAPL_US_EQ",
  "quantity": -10.5,
  "stopPrice": 145.00,
  "timeValidity": "DAY"
}
```

**Parameters:**
- `timeValidity`: `"DAY"` (expires at midnight) or `"GOOD_TILL_CANCEL"` (remains active until filled or cancelled)

**Implementation:**
```javascript
async placeStopLoss(symbol, side, quantity, stopPrice, limitPrice = null, timeValidity = 'DAY') {
  if (this.environment === 'production' || this.environment === 'live') {
    throw new Error('Stop orders are not supported in live trading. Only market orders are allowed.');
  }
  
  const ticker = this.toTrading212Ticker(symbol);
  const orderQuantity = side.toLowerCase() === 'sell' ? -Math.abs(quantity) : Math.abs(quantity);
  
  // Validate timeValidity
  if (timeValidity !== 'DAY' && timeValidity !== 'GOOD_TILL_CANCEL') {
    timeValidity = 'DAY';
  }
  
  // If limitPrice provided, use stop-limit order
  if (limitPrice) {
    const orderData = {
      ticker: ticker,
      quantity: orderQuantity,
      stopPrice: parseFloat(stopPrice),
      limitPrice: parseFloat(limitPrice),
      timeValidity: timeValidity,
    };
    const response = await this.makeRequest('POST', '/equity/orders/stop_limit', orderData);
    return {
      orderId: response.id.toString(),
      status: response.status || 'pending',
    };
  }
  
  // Otherwise, use stop order
  const orderData = {
    ticker: ticker,
    quantity: orderQuantity,
    stopPrice: parseFloat(stopPrice),
    timeValidity: timeValidity,
  };
  
  const response = await this.makeRequest('POST', '/equity/orders/stop', orderData);
  
  return {
    orderId: response.id.toString(),
    status: response.status || 'pending',
  };
}
```

### Place Stop-Limit Order

**Endpoint:** `POST /api/v0/equity/orders/stop_limit`

**Rate Limit:** 1 request per 2 seconds

**Note:** Only available in **Demo** environment. Live trading does not support stop-limit orders.

**Request Body:**
```json
{
  "ticker": "AAPL_US_EQ",
  "quantity": -10.5,
  "stopPrice": 145.00,
  "limitPrice": 144.50,
  "timeValidity": "DAY"
}
```

**Parameters:**
- `timeValidity`: `"DAY"` (expires at midnight) or `"GOOD_TILL_CANCEL"` (remains active until filled or cancelled)

**Implementation:**
```javascript
async placeStopLimit(symbol, side, quantity, stopPrice, limitPrice, timeValidity = 'DAY') {
  if (this.environment === 'production' || this.environment === 'live') {
    throw new Error('Stop-limit orders are not supported in live trading. Only market orders are allowed.');
  }
  
  const ticker = this.toTrading212Ticker(symbol);
  const orderQuantity = side.toLowerCase() === 'sell' ? -Math.abs(quantity) : Math.abs(quantity);
  
  // Validate timeValidity
  if (timeValidity !== 'DAY' && timeValidity !== 'GOOD_TILL_CANCEL') {
    timeValidity = 'DAY';
  }
  
  const orderData = {
    ticker: ticker,
    quantity: orderQuantity,
    stopPrice: parseFloat(stopPrice),
    limitPrice: parseFloat(limitPrice),
    timeValidity: timeValidity,
  };
  
  const response = await this.makeRequest('POST', '/equity/orders/stop_limit', orderData);
  
  return {
    orderId: response.id.toString(),
    status: response.status || 'pending',
  };
}
```

### Cancel Order

**Endpoint:** `DELETE /api/v0/equity/orders/{id}`

**Rate Limit:** 50 requests per 1 minute

**⚠️ LIMITATION:** Cancel orders may not be available for real money accounts. Returns 400 error if not available for live accounts.

**Implementation:**
```javascript
async cancelOrder(symbol, orderId) {
  try {
    await this.makeRequest('DELETE', `/equity/orders/${orderId}`);
    return {
      orderId: orderId.toString(),
      status: 'canceled',
    };
  } catch (error) {
    if (error.response && error.response.status === 400) {
      throw new Error('Cancel orders are not available for real money accounts');
    }
    throw error;
  }
}
```

### Get Order by ID

**Endpoint:** `GET /api/v0/equity/orders/{id}`

**Rate Limit:** 1 request per 1 second

**Implementation:**
```javascript
async getOrder(symbol, orderId) {
  return this.makeRequest('GET', `/equity/orders/${orderId}`);
}
```

### Get All Pending Orders

**Endpoint:** `GET /api/v0/equity/orders`

**Rate Limit:** 1 request per 5 seconds

**Implementation:**
```javascript
async getPendingOrders() {
  return this.makeRequest('GET', '/equity/orders');
}
```

## Market Data

**⚠️ Limitation:** Trading212 API does not provide a direct market data/ticker endpoint in the current beta version.

**Workarounds:**
1. Use positions endpoint to get current prices for held positions
2. Use external market data sources (e.g., Alpha Vantage, Yahoo Finance)
3. Use instrument metadata endpoint to get basic instrument information

**Instrument Metadata:**
- **Endpoint:** `GET /api/v0/equity/metadata/instruments`
- **Rate Limit:** 1 request per 50 seconds
- Returns all available instruments (refreshed every 10 minutes)

**Implementation (Fallback):**
```javascript
async getTicker(symbol) {
  // Trading212 doesn't provide real-time price endpoint
  // Try to get price from position if we have one
  const position = await this.getPosition(symbol);
  if (position && position.markPrice) {
    return {
      symbol: symbol,
      price: position.markPrice.toString(),
      lastPrice: position.markPrice.toString(),
    };
  }
  
  // Otherwise, throw error indicating market data not available
  throw new Error(`Market data not available for ${symbol}. Trading212 API does not provide ticker endpoint. Use external data source or check position data.`);
}
```

## Symbol Conversion

**Standard Symbol → Trading212 Ticker**

```javascript
toTrading212Ticker(symbol) {
  // If already in Trading212 format, return as-is
  if (symbol.includes('_') && symbol.includes('_EQ')) {
    return symbol.toUpperCase();
  }
  
  // Default: Assume US equity
  // Format: {SYMBOL}_US_EQ
  // Note: This may need adjustment for other markets (UK, EU, etc.)
  return `${symbol.toUpperCase()}_US_EQ`;
}
```

**Note:** For accurate ticker mapping, use the instruments metadata endpoint to search for the correct ticker format.

## Rate Limiting

Trading212 implements rate limiting with the following headers in responses:

- `x-ratelimit-limit`: Total requests allowed in current period
- `x-ratelimit-period`: Duration of time period in seconds
- `x-ratelimit-remaining`: Requests remaining in current period
- `x-ratelimit-reset`: Unix timestamp when limit resets
- `x-ratelimit-used`: Requests already made in current period

**Key Rate Limits:**
- Account Summary: 1 req / 5s
- Market Orders: 50 req / 1m
- Limit Orders: 1 req / 2s
- Stop Orders: 1 req / 2s
- Cancel Orders: 50 req / 1m
- Get Orders: 1 req / 5s
- Get Positions: 1 req / 1s
- Historical Orders: 6 req / 1m

## Error Handling

**Common Error Responses:**

```json
{
  "error": "Invalid ticker format",
  "message": "Ticker must be in format {SYMBOL}_{COUNTRY}_{TYPE}"
}
```

```json
{
  "error": "Insufficient funds",
  "message": "Not enough cash available for this order"
}
```

**Rate Limit Error:**
- HTTP 429 Too Many Requests
- Retry after time indicated in `x-ratelimit-reset` header

## Pagination

List endpoints use **cursor-based pagination**:

**Parameters:**
- `limit`: Max items per page (default: 20, max: 50)
- `cursor`: Pointer to specific item in dataset

**Response:**
```json
{
  "items": [...],
  "nextPagePath": "/api/v0/equity/history/orders?limit=20&cursor=1760346100000"
}
```

**Usage:**
- Use `nextPagePath` value as the full path for next request
- When `nextPagePath` is `null`, no more pages available

## Webhook Integration Examples

### Basic Market Order (Live Trading)

```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Limit Order (Demo Only)

```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Stop Loss Order (Demo Only)

```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2
}
```

## Special Considerations

### Negative Quantity for Sell Orders

**Critical:** Trading212 uses negative quantities to indicate sell orders:
- Buy: `quantity: 10.5`
- Sell: `quantity: -10.5`

This is different from most other exchanges that use a `side` parameter.

### Live Trading Limitations

**Important:** In live (real money) environment:
- **Only Market Orders** are supported
- Limit, Stop, and Stop-Limit orders will fail
- System should throw clear error if attempting unsupported order types

### Extended Hours Trading

Market orders support `extendedHours` parameter:
- `extendedHours: true` - Allow execution outside standard trading hours
- `extendedHours: false` - Only execute during standard market hours
- If placed when market is closed, order queues until market opens

### Account Currency

- Orders execute only in **primary account currency**
- Multi-currency accounts not supported via API
- All values in responses are in primary account currency

### Order Idempotency

**⚠️ Beta Limitation:** The API is **not idempotent** in the current beta version. Sending the same request multiple times may result in duplicate orders. Implement client-side idempotency checks if needed.

### Symbol Format

- Trading212 uses specific ticker format: `{SYMBOL}_{COUNTRY}_{TYPE}`
- Default assumption: `{SYMBOL}_US_EQ` for US stocks
- For accurate mapping, use `/api/v0/equity/metadata/instruments` endpoint
- May need adjustment for UK (`_GB_EQ`), EU (`_DE_EQ`, `_FR_EQ`), etc.

## Testing

### Demo Environment

1. Create demo account on Trading212
2. Generate API keys from account settings
3. Test all order types (Market, Limit, Stop, Stop-Limit)
4. Verify negative quantity for sell orders

### Live Environment

1. Ensure account is Invest or Stocks ISA type
2. Generate API keys
3. Test only Market Orders
4. Verify extended hours behavior
5. Test with small amounts first

## References

- [Trading212 API Documentation](https://docs.trading212.com/)
- [Trading212 API Terms](https://www.trading212.com/legal-documentation/API-Terms_EN.pdf)
- [Trading212 Community Forum](https://community.trading212.com/)
- [How to get Trading212 API key](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key)
