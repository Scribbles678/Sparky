# Robinhood Crypto Exchange Integration

**Status:** 🚧 In Progress  
**Date:** December 2024  
**Exchange:** Robinhood Crypto  
**Asset Classes:** Crypto (Cryptocurrency only)

---

## Overview

Robinhood Crypto API provides programmatic access to cryptocurrency trading on the Robinhood platform. **Note: This API is crypto-only** - it does not support stocks, options, or other asset classes. This document covers the complete integration of Robinhood Crypto into the SignalStudio ecosystem.

**Integration Components:**
- ✅ Sparky Bot: Exchange adapter implementation
- ✅ SignalStudio Dashboard: Exchange metadata and balance endpoint
- ✅ Marketing: Feature documentation

---

## API Documentation Reference

### Authentication

**Method:** Ed25519 Signature-based Authentication

**Authentication Flow:**
1. **Generate Key Pair:** User generates Ed25519 public/private key pair
2. **Create API Credentials:** User registers public key in Robinhood API Credentials Portal
3. **Get API Key:** Receive API key from credentials portal
4. **Sign Requests:** Sign each request using private key, API key, timestamp, path, method, and body

**Credentials Required:**
- `apiKey` - Robinhood API Key (from API Credentials Portal, format: `rh-api-[uuid]` or legacy format)
- `privateKey` - Ed25519 private key in Base64 format (used for signing requests)

**Base URL:**
- **Production:** `https://trading.robinhood.com`

**Signature Generation:**
```javascript
// Message format: {api_key}{timestamp}{path}{method}{body}
const message = `${apiKey}${timestamp}${path}${method}${body}`;
const signature = ed25519.sign(message, privateKey);
const base64Signature = base64.encode(signature);
```

**Request Headers:**
- `x-api-key: {apiKey}` - API key from credentials portal
- `x-signature: {base64Signature}` - Base64-encoded Ed25519 signature
- `x-timestamp: {timestamp}` - Unix timestamp in seconds (valid for 30 seconds)

**Important:**
- Timestamps expire after 30 seconds
- Private key must be kept secure (never share)
- Public key is registered with Robinhood during credential creation

### Endpoints

#### Account Endpoints
- `GET /api/v1/crypto/trading/accounts/` - Get crypto trading account details

#### Market Data Endpoints
- `GET /api/v1/crypto/marketdata/best_bid_ask/` - Get best bid/ask prices
  - Query params: `symbol` (e.g., `BTC-USD`, `ETH-USD`) - multiple symbols supported
- `GET /api/v1/crypto/marketdata/estimated_price/` - Get estimated price for quantity
  - Query params: `symbol` (required), `side` (bid/ask/both), `quantity` (comma-separated, max 10)

#### Trading Endpoints
- `GET /api/v1/crypto/trading/trading_pairs/` - Get trading pairs
  - Query params: `symbol` (optional, multiple supported), `limit`, `cursor`
- `GET /api/v1/crypto/trading/holdings/` - Get crypto holdings (positions)
  - Query params: `asset_code` (optional, e.g., `BTC`, `ETH`), `limit`, `cursor`
- `POST /api/v1/crypto/trading/orders/` - Place new order
- `GET /api/v1/crypto/trading/orders/` - Get orders
  - Query params: `symbol`, `side`, `state`, `type`, `id`, `created_at_start`, `created_at_end`, `updated_at_start`, `updated_at_end`, `cursor`, `limit`
- `GET /api/v1/crypto/trading/orders/{id}/` - Get specific order
- `POST /api/v1/crypto/trading/orders/{id}/cancel/` - Cancel order

---

## Sparky Bot Implementation

### File Structure
```
Sparky/src/exchanges/
├── robinhoodApi.js          # Main exchange adapter
└── ExchangeFactory.js    # Factory integration
```

### Implementation Details

#### 1. Exchange Adapter (`robinhoodApi.js`)

**Class:** `RobinhoodAPI extends BaseExchangeAPI`

**Constructor:**
```javascript
constructor(apiKey, privateKey, environment = 'production')
```

**Ed25519 Signature Setup:**
- Uses `tweetnacl` library for Ed25519 signing (Node.js compatible)
- Private key stored in Base64 format
- Generates signature for each request

**Required Methods:**
- [ ] `getBalance()` - Get account balance
- [ ] `getAvailableMargin()` - Get buying power
- [ ] `getPositions()` - Get all crypto holdings
- [ ] `getPosition(symbol)` - Get specific holding
- [ ] `hasOpenPosition(symbol)` - Check if holding exists
- [ ] `getTicker(symbol)` - Get current market price
- [ ] `placeMarketOrder(symbol, side, quantity)` - Place market order
- [ ] `placeLimitOrder(symbol, side, quantity, price)` - Place limit order
- [ ] `placeStopLoss(symbol, side, quantity, stopPrice)` - Place stop loss order
- [ ] `placeTakeProfit(symbol, side, quantity, takeProfitPrice)` - Place limit order (take profit)
- [ ] `closePosition(symbol, side, quantity)` - Close position (sell/buy opposite)
- [ ] `cancelOrder(symbol, orderId)` - Cancel order
- [ ] `getOrder(symbol, orderId)` - Get order status

**Implementation Notes:**
- **Symbol Format:** Robinhood uses trading pairs (e.g., `BTC-USD`, `ETH-USD`)
  - Must convert standard symbols to trading pair format
  - Symbols must be uppercase
- **Ed25519 Signing:** Each request must be signed
  - Message: `{apiKey}{timestamp}{path}{method}{body}`
  - Use `tweetnacl` library for signing
- **Timestamp:** Must be current Unix timestamp (expires after 30 seconds)
- **Order Types:** Market, Limit, Stop Limit, Stop Loss
- **Quantity Types:** Can use `asset_quantity` (crypto amount) or `quote_amount` (USD amount)

**Authentication:**
```javascript
const nacl = require('tweetnacl');
const base64 = require('base64-js');

// Generate signature
const timestamp = Math.floor(Date.now() / 1000);
const message = `${apiKey}${timestamp}${path}${method}${body || ''}`;
const messageBytes = Buffer.from(message, 'utf-8');
const privateKeyBytes = base64.toByteArray(privateKeyBase64);
const signature = nacl.sign.detached(messageBytes, privateKeyBytes);
const base64Signature = base64.fromByteArray(signature);

// Headers
const headers = {
  'x-api-key': apiKey,
  'x-signature': base64Signature,
  'x-timestamp': timestamp.toString(),
  'Content-Type': 'application/json',
};
```

#### 2. Order Flow

**Place Market Order Request:**
```json
{
  "client_order_id": "uuid-v4",
  "side": "buy",
  "type": "market",
  "symbol": "BTC-USD",
  "market_order_config": {
    "asset_quantity": "0.1"
  }
}
```

**Place Limit Order Request:**
```json
{
  "client_order_id": "uuid-v4",
  "side": "buy",
  "type": "limit",
  "symbol": "BTC-USD",
  "limit_order_config": {
    "asset_quantity": "0.1",
    "limit_price": "50000.00",
    "time_in_force": "gtc"
  }
}
```

**Place Stop Loss Order Request:**
```json
{
  "client_order_id": "uuid-v4",
  "side": "sell",
  "type": "stop_loss",
  "symbol": "BTC-USD",
  "stop_loss_order_config": {
    "asset_quantity": "0.1",
    "stop_price": "48000.00",
    "time_in_force": "gtc"
  }
}
```

**Order Types:**
- `market` - Market order
- `limit` - Limit order
- `stop_limit` - Stop-limit order
- `stop_loss` - Stop loss order

**Time in Force:**
- `gtc` - Good till cancelled
- `ioc` - Immediate or cancel (if supported)
- `fok` - Fill or kill (if supported)

**Order States:**
- `open` - Order is open
- `partially_filled` - Partially filled
- `filled` - Fully filled
- `canceled` - Cancelled
- `failed` - Failed

---

## SignalStudio Dashboard Integration

### 1. Exchange Metadata

**File:** `signal/server/utils/exchangeMetadata.ts`

**Add to `HARDCODED_EXCHANGES` array:**
```typescript
{
  id: 'robinhood',
  name: 'Robinhood Crypto',
  icon: 'i-heroicons-chart-bar',
  logo: '/robinhood_logo.png',
  assetClass: 'Crypto' as const,
  assetTypes: 'Cryptocurrency',
  marketHours: '24/7 Trading',
  colorClass: 'bg-green-600/20 text-green-600',
  instructions: 'To obtain API keys, login to your Robinhood account and navigate to Crypto Account Settings > API Credentials Portal (desktop only). Generate an Ed25519 key pair, register the public key, and save both the API key and private key securely. Note: This API is crypto-only and does not support stocks or options.',
  requiresPassphrase: false,
  requiresAccountId: false,
  showApiSecret: true,
  isCCXT: false,
  isCustom: true
}
```

### 2. Balance Endpoint

**File:** `signal/server/api/balance/robinhood.ts`

```typescript
import { defineEventHandler, createError } from '#imports'
import { serverSupabaseClient } from '#supabase/server'
import nacl from 'tweetnacl'
import base64 from 'base64-js'

interface RobinhoodAccount {
  account_number: string
  status: string
  buying_power: string
  buying_power_currency: string
}

export default defineEventHandler(async (event) => {
  try {
    // Get authenticated user
    const user = event.context.user
    if (!user) {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized - Please log in'
      })
    }

    // Get user's API credentials from database
    const supabase = await serverSupabaseClient(event)
    const { data: credentials, error: credError } = await supabase
      .from('bot_credentials')
      .select('api_key, api_secret, environment')
      .eq('exchange', 'robinhood')
      .eq('environment', 'production')
      .eq('user_id', user.id)
      .single()

    if (credError || !credentials) {
      return {
        success: false,
        exchange: 'Robinhood Crypto',
        error: 'Robinhood credentials not configured'
      }
    }

    const apiKey = credentials.api_key
    const privateKeyBase64 = credentials.api_secret
    const baseUrl = 'https://trading.robinhood.com'

    // Generate signature for request
    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/api/v1/crypto/trading/accounts/'
    const method = 'GET'
    const body = ''
    
    const message = `${apiKey}${timestamp}${path}${method}${body}`
    const messageBytes = Buffer.from(message, 'utf-8')
    const privateKeyBytes = base64.toByteArray(privateKeyBase64)
    const signature = nacl.sign.detached(messageBytes, privateKeyBytes)
    const base64Signature = base64.fromByteArray(signature)

    // Call Robinhood API
    const response = await $fetch<RobinhoodAccount>(`${baseUrl}${path}`, {
      headers: {
        'x-api-key': apiKey,
        'x-signature': base64Signature,
        'x-timestamp': timestamp.toString(),
        'Content-Type': 'application/json'
      }
    })

    const buyingPower = parseFloat(response.buying_power || '0')

    return {
      success: true,
      exchange: 'Robinhood Crypto',
      balance: buyingPower,
      available: buyingPower,
      buyingPower: buyingPower,
      currency: response.buying_power_currency || 'USD',
      accountNumber: response.account_number,
      status: response.status
    }
  } catch (error: unknown) {
    console.error('Robinhood balance error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return {
      success: false,
      exchange: 'Robinhood Crypto',
      error: errorMessage
    }
  }
})
```

**Note:** Requires `tweetnacl` and `base64-js` packages for Ed25519 signing in SignalStudio.

---

## Configuration

### Credential Storage

**Database Schema:** `bot_credentials` table

**Fields:**
- `api_key` → Robinhood API Key
- `api_secret` → Ed25519 Private Key (Base64 format)
- `extra_metadata` → JSON object (optional, for future use)

**Key Pair Generation:**
Users must generate Ed25519 key pair and register public key with Robinhood:
1. Generate key pair (using provided scripts)
2. Register public key in Robinhood API Credentials Portal
3. Receive API key
4. Store API key and private key securely

### Webhook Payload Format

**Standard Format:**
```json
{
  "secret": "your-secret",
  "exchange": "robinhood",
  "action": "buy",
  "symbol": "BTC",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Robinhood-Specific Fields:**
- Symbol will be converted to trading pair format (e.g., `BTC` → `BTC-USD`)
- `asset_quantity` - Crypto amount (e.g., "0.1" BTC)
- `quote_amount` - USD amount (alternative to asset_quantity)
- `time_in_force` - `gtc` (default), `ioc`, `fok`

---

## API Endpoints Reference

### Account Endpoints

#### GET /api/v1/crypto/trading/accounts/
Get crypto trading account details.

**Request Headers:**
- `x-api-key: {apiKey}`
- `x-signature: {signature}`
- `x-timestamp: {timestamp}`

**Response:**
```json
{
  "account_number": "string",
  "status": "active",
  "buying_power": "1000.00",
  "buying_power_currency": "USD"
}
```

### Market Data Endpoints

#### GET /api/v1/crypto/marketdata/best_bid_ask/
Get best bid and ask prices.

**Query Parameters:**
- `symbol` - Trading pair symbol(s) (e.g., `BTC-USD`, `ETH-USD`)
  - Multiple symbols: `?symbol=BTC-USD&symbol=ETH-USD`
  - Must be uppercase

**Response:**
```json
{
  "results": [
    {
      "symbol": "BTC-USD",
      "bid": "50000.00",
      "ask": "50010.00"
    }
  ]
}
```

#### GET /api/v1/crypto/marketdata/estimated_price/
Get estimated price for quantity.

**Query Parameters:**
- `symbol` - Trading pair (required, uppercase, e.g., `BTC-USD`)
- `side` - `bid`, `ask`, or `both` (required)
- `quantity` - Comma-separated quantities (required, max 10, e.g., `0.1,1,1.999`)

**Response:**
```json
{
  "results": [
    {
      "symbol": "BTC-USD",
      "side": "ask",
      "quantity": "0.1",
      "estimated_price": "5005.00"
    }
  ]
}
```

### Trading Endpoints

#### GET /api/v1/crypto/trading/trading_pairs/
Get trading pairs.

**Query Parameters:**
- `symbol` - Trading pair(s) (optional, multiple supported)
- `limit` - Results per page
- `cursor` - Pagination cursor

**Response:**
```json
{
  "next": "https://trading.robinhood.com/api/v1/crypto/trading/trading_pairs/?cursor={CURSOR_ID}",
  "previous": null,
  "results": [
    {
      "symbol": "BTC-USD",
      "base_asset": "BTC",
      "quote_asset": "USD",
      "min_order_size": "0.0001",
      "max_order_size": "1000.0"
    }
  ]
}
```

#### GET /api/v1/crypto/trading/holdings/
Get crypto holdings (positions).

**Query Parameters:**
- `asset_code` - Asset code(s) (optional, e.g., `BTC`, `ETH`)
- `limit` - Results per page
- `cursor` - Pagination cursor

**Response:**
```json
{
  "next": null,
  "previous": null,
  "results": [
    {
      "asset_code": "BTC",
      "quantity": "0.5",
      "average_buy_price": "45000.00"
    }
  ]
}
```

#### POST /api/v1/crypto/trading/orders/
Place new order.

**Request Body:**
```json
{
  "client_order_id": "11299b2b-61e3-43e7-b9f7-dee77210bb29",
  "side": "buy",
  "type": "market",
  "symbol": "BTC-USD",
  "market_order_config": {
    "asset_quantity": "0.1"
  }
}
```

**Response:**
```json
{
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "account_number": "string",
  "symbol": "BTC-USD",
  "client_order_id": "11299b2b-61e3-43e7-b9f7-dee77210bb29",
  "side": "buy",
  "type": "market",
  "state": "open",
  "average_price": 0,
  "filled_asset_quantity": 0,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "market_order_config": {
    "asset_quantity": 0.1
  }
}
```

#### GET /api/v1/crypto/trading/orders/
Get orders.

**Query Parameters:**
- `symbol` - Trading pair (optional)
- `side` - `buy` or `sell` (optional)
- `state` - `open`, `canceled`, `partially_filled`, `filled`, `failed` (optional)
- `type` - `limit`, `market`, `stop_limit`, `stop_loss` (optional)
- `id` - Order ID (optional)
- `created_at_start` - ISO 8601 format (optional)
- `created_at_end` - ISO 8601 format (optional)
- `updated_at_start` - ISO 8601 format (optional)
- `updated_at_end` - ISO 8601 format (optional)
- `cursor` - Pagination cursor
- `limit` - Results per page

#### GET /api/v1/crypto/trading/orders/{id}/
Get specific order.

#### POST /api/v1/crypto/trading/orders/{id}/cancel/
Cancel order.

**Response:**
```json
{
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "state": "canceled"
}
```

---

## Exchange-Specific Notes

### Symbol Format

**Trading Pairs:**
- Robinhood uses trading pair format: `{BASE}-{QUOTE}` (e.g., `BTC-USD`, `ETH-USD`)
- Symbols must be uppercase
- Only USD pairs are supported

**Symbol Conversion:**
```javascript
// Convert standard symbol to trading pair
function toTradingPair(symbol) {
  // If already in trading pair format, return uppercase
  if (symbol.includes('-')) {
    return symbol.toUpperCase();
  }
  // Otherwise, assume USD quote
  return `${symbol.toUpperCase()}-USD`;
}
```

### Ed25519 Signature Authentication

**Signature Generation:**
1. Create message: `{apiKey}{timestamp}{path}{method}{body}`
2. Sign message with Ed25519 private key
3. Base64 encode signature
4. Include in `x-signature` header

**Important:**
- Timestamp must be current (expires after 30 seconds)
- Private key must be kept secure
- Each request requires fresh signature

### Order Configuration

**Market Orders:**
```json
{
  "market_order_config": {
    "asset_quantity": "0.1"  // OR "quote_amount": "100.00"
  }
}
```

**Limit Orders:**
```json
{
  "limit_order_config": {
    "asset_quantity": "0.1",  // OR "quote_amount": "100.00"
    "limit_price": "50000.00",
    "time_in_force": "gtc"
  }
}
```

**Stop Loss Orders:**
```json
{
  "stop_loss_order_config": {
    "asset_quantity": "0.1",  // OR "quote_amount": "100.00"
    "stop_price": "48000.00",
    "time_in_force": "gtc"
  }
}
```

**Stop Limit Orders:**
```json
{
  "stop_limit_order_config": {
    "asset_quantity": "0.1",  // OR "quote_amount": "100.00"
    "limit_price": "48000.00",
    "stop_price": "48500.00",
    "time_in_force": "gtc"
  }
}
```

**Note:** For order configs that support both `asset_quantity` and `quote_amount`, only one can be present.

### Client Order ID

**Important:** `client_order_id` must be a valid UUID v4 for idempotency:
- Prevents duplicate orders
- Must be unique per order
- Use UUID library to generate

### Rate Limits

**Rate Limiting:**
- **100 requests per minute** per user account
- **300 requests per minute** in bursts
- Token bucket implementation
- Rate limits may vary by endpoint

**Recommended Approach:**
- Implement request queuing if needed
- Cache market data (trading pairs, prices)
- Respect rate limits to avoid 429 errors

---

## Error Handling

### Common Errors

#### Authentication Errors
- **401 Unauthorized:** Invalid API key, signature, or expired timestamp
  - Solution: Check API key, verify signature generation, ensure timestamp is current
- **403 Forbidden:** Invalid credentials or insufficient permissions
  - Solution: Verify API key is active in credentials portal

#### Trading Errors
- **400 Bad Request:** Invalid order parameters
  - Check: Symbol format (must be uppercase trading pair), quantity, price
- **400 Bad Request:** Invalid `client_order_id` (must be UUID v4)
  - Solution: Generate valid UUID v4
- **404 Not Found:** Order or symbol not found
  - Solution: Verify order ID or symbol is correct

#### Market Data Errors
- **400 Bad Request:** Invalid symbol format
  - Solution: Use trading pair format (e.g., `BTC-USD`) in uppercase
- **400 Bad Request:** Invalid quantity format
  - Solution: Use comma-separated values, max 10 quantities

### Error Response Format

```json
{
  "type": "validation_error",
  "errors": [
    {
      "detail": "Must be a valid UUID.",
      "attr": "client_order_id"
    }
  ]
}
```

### Retry Logic
- Retry on 5xx errors (up to 3 times)
- Retry on 429 errors with exponential backoff
- **Do NOT retry** on 4xx errors (except 401 with signature refresh)
- Handle timestamp expiration by generating new timestamp and signature

---

## Rate Limits

**Rate Limiting:**
- **General:** 100 requests per minute per user account
- **Burst:** 300 requests per minute
- **Token Bucket:** Implementation with refill intervals
- **Per Endpoint:** Limits may vary by endpoint

**Recommended Approach:**
- Implement request queuing for high-frequency operations
- Cache trading pairs and market data
- Batch requests where possible
- Respect rate limits to avoid 429 errors

---

## Testing

### Test Checklist
- [ ] Ed25519 key pair generation
- [ ] API key registration
- [ ] Signature generation and validation
- [ ] Account balance fetching
- [ ] Trading pairs lookup
- [ ] Holdings fetching
- [ ] Market order execution
- [ ] Limit order execution
- [ ] Stop loss order execution
- [ ] Order cancellation
- [ ] Order status checking
- [ ] Symbol to trading pair conversion
- [ ] Error handling (invalid signature, expired timestamp)
- [ ] Webhook integration test

### Test Account Setup
- Create Robinhood account
- Enable crypto trading
- Generate Ed25519 key pair
- Register public key in API Credentials Portal
- Receive API key
- Test with small amounts first
- Verify all order types work

---

## Implementation Checklist

### Sparky Bot
- [ ] Install `tweetnacl` and `base64-js` packages
- [ ] Create `robinhoodApi.js` extending `BaseExchangeAPI`
- [ ] Implement Ed25519 signature generation
- [ ] Implement symbol to trading pair conversion
- [ ] Implement all required methods
- [ ] Add UUID generation for client_order_id
- [ ] Add to `ExchangeFactory.js`
- [ ] Update `TradeExecutor.getAssetClass()` (returns 'crypto')
- [ ] Test with small amounts
- [ ] Test all order types
- [ ] Test error handling
- [ ] Update `EXCHANGES.md` documentation

### SignalStudio Dashboard
- [ ] Install `tweetnacl` and `base64-js` packages in SignalStudio
- [ ] Add to `exchangeMetadata.ts`
- [ ] Create balance endpoint (with Ed25519 signing)
- [ ] Test balance fetching
- [ ] Verify credential form works
- [ ] Handle signature generation errors gracefully

### Documentation
- [ ] Update `EXCHANGES.md` with Robinhood Crypto section
- [ ] Add API reference details
- [ ] Document Ed25519 signature generation
- [ ] Document symbol to trading pair conversion
- [ ] Document order configuration options
- [ ] Add troubleshooting section

---

## Next Steps

1. Review Robinhood Crypto API documentation (complete endpoint reference)
2. Install Ed25519 signing libraries (`tweetnacl`, `base64-js`)
3. Implement signature generation in `robinhoodApi.js`
4. Implement symbol to trading pair conversion
5. Implement exchange adapter with all required methods
6. Integrate into ExchangeFactory
7. Create SignalStudio balance endpoint (with Ed25519 signing)
8. Test with small amounts
9. Update documentation
10. Deploy to production

---

**Last Updated:** December 2024  
**Version:** 1.0 (Draft)
