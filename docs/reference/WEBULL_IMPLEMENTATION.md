# Webull API Implementation Guide

## Overview

Webull is a commission-free stock and ETF trading platform. This document details the integration of Webull's OpenAPI into Sparky Bot, SignalStudio, and marketing materials.

**API Type:** REST API + gRPC + MQTT (for streaming)  
**Authentication:** HMAC-SHA1 signature with App Key and App Secret  
**Base URL:** `https://api.webull.com`  
**Complexity:** Medium

---

## Authentication

### App Key and App Secret

Webull uses HMAC-SHA1 signature-based authentication:

1. **Generate Credentials:**
   - User generates App Key and App Secret on Webull official website
   - These are used for all API requests

2. **Signature Generation:**
   - Each request requires a signature calculated using HMAC-SHA1
   - Signature includes: URI, query params, body, and specific headers
   - Signature is Base64 encoded

### Signature Headers

All requests require the following headers:

- `x-app-key` - Access secret ID (App Key)
- `x-signature` - Signature value (HMAC-SHA1, Base64 encoded)
- `x-signature-algorithm` - Signature algorithm (default: `HMAC-SHA1`)
- `x-signature-version` - Signature version (default: `1.0`)
- `x-signature-nonce` - Unique random number (UUID)
- `x-timestamp` - Request timestamp (ISO8601 format, UTC timezone)
- `host` - HTTP request host (e.g., `api.webull.com`)

### Signature Generation Process

**Step 1: Construct Source Param**

1. Sort query params and headers by key (alphabetically)
2. Concatenate as: `k1=v1&k2=v2&...`
3. Calculate MD5 of request body (uppercase): `ToUpper(MD5(body))`
4. Concatenate: `uri + "&" + sorted_params_headers + "&" + body_md5`
   - If body is empty: `uri + "&" + sorted_params_headers`

**Step 2: URL Encode**

- Encode the source param using `encodeURIComponent`
- All non-alphanumeric characters (except `-`, `_`, `.`) must be percent-encoded
- Hexadecimal letters must be uppercase

**Step 3: Generate Signature**

```
signature = base64(HMAC-SHA1(app_secret + "&", encoded_sign_string))
```

**Note:** App secret must have `&` appended before HMAC-SHA1

### Implementation Example

```javascript
const crypto = require('crypto');

function generateSignature(uri, queryParams, headers, body, appSecret) {
  // Step 1: Sort all params and headers by key
  const allParams = { ...queryParams, ...headers };
  const sortedKeys = Object.keys(allParams).sort();
  const sortedString = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&');
  
  // Step 2: Calculate body MD5 (if body exists)
  let bodyMD5 = '';
  if (body) {
    bodyMD5 = crypto.createHash('md5').update(body).digest('hex').toUpperCase();
  }
  
  // Step 3: Construct source param
  const sourceParam = bodyMD5 
    ? `${uri}&${sortedString}&${bodyMD5}`
    : `${uri}&${sortedString}`;
  
  // Step 4: URL encode
  const encoded = encodeURIComponent(sourceParam);
  
  // Step 5: Generate signature
  const key = appSecret + '&';
  const signature = crypto
    .createHmac('sha1', key)
    .update(encoded)
    .digest('base64');
  
  return signature;
}
```

### Clock Skew Protection

- Timestamp must be within acceptable range (typically ±5 minutes)
- Error: `CLOCK_SKEW_EXCEEDED` if timestamp offset exceeds limit

### Duplicate Request Protection

- Nonce must be unique per request
- Error: `DUPPLICATED_REQUEST` if same nonce is reused

---

## API Base URLs

- **HTTP API:** `https://api.webull.com`
- **Trading Events Push:** `events-api.webull.com` (gRPC)
- **Market Data Push:** `usquotes-api.webullfintech.com` (MQTT)
- **Region:** US (default), can be configured for other regions

---

## Instrument Discovery

### Instrument ID (instrument_id)

**Critical:** Webull uses `instrument_id` instead of symbols for trading operations.

- Must lookup `instrument_id` before placing orders
- `instrument_id` is persistent for the life of the instrument
- Different instruments may have same symbol (different exchanges)

### Get Instruments

**Endpoint:** `GET /instrument/list`

**Request Parameters:**
- `symbols` (required) - Comma-separated list (e.g., `AAPL,GOOG`), up to 100 symbols
- `category` (required) - Security type: `US_STOCK` or `US_ETF`

**Response:**
```json
[
  {
    "name": "APPLE INC",
    "symbol": "AAPL",
    "instrument_id": "913256135",
    "exchange_code": "NSQ",
    "currency": "USD"
  }
]
```

**Frequency Limit:** 60 requests per minute

**Implementation Strategy:**
- Cache `instrument_id` → `symbol` mapping
- Re-query only if instrument not found
- Handle multiple results for same symbol (filter by exchange)

---

## Account Management

### List Accounts

**Endpoint:** `GET /app/subscriptions/list`

**Query Parameters:**
- `subscription_id` (optional) - Pagination token

**Response:**
```json
[
  {
    "subscription_id": "1646884438608",
    "user_id": "1940003393",
    "account_id": "7THGGKDQ5SRN2SFORREFD54DO9",
    "account_number": "5MV06064"
  }
]
```

**Frequency Limit:** 20 requests per 30 seconds

**Note:** `account_id` is required for all trading operations.

### Account Detail

**Endpoint:** `GET /account/profile`

**Query Parameters:**
- `account_id` (required)

**Response:**
```json
{
  "account_number": "5MV06064",
  "account_type": "MARGIN",
  "account_status": "NORMAL"
}
```

**Account Types:**
- `CASH` - Cash account
- `MARGIN` - Margin account

**Account Status:**
- `NORMAL` - Normal
- `CANCELING` - Account closing
- `CONVERTING` - Account type changing
- `CANCELED` - Account closed

**Frequency Limit:** 10 requests per 30 seconds

### Account Balance

**Endpoint:** `GET /account/balance`

**Query Parameters:**
- `account_id` (required)
- `total_asset_currency` (optional) - Currency, default: `USD`

**Response:**
```json
{
  "account_id": "6TGIBSMG28Q35OVA465T99VHPB",
  "total_asset_currency": "USD",
  "total_asset": "1247724759.52",
  "total_market_value": "89038914.52",
  "total_cash_balance": "1158685845.00",
  "margin_utilization_rate": "1.00",
  "account_currency_assets": [
    {
      "currency": "USD",
      "net_liquidation_value": "458809435.44",
      "positions_market_value": "153208546.14",
      "cash_balance": "305600889.30",
      "margin_power": "305587431.94",
      "cash_power": "305587431.94",
      "pending_incoming": "0.00",
      "cash_frozen": "13457.36",
      "available_withdrawal": "305587431.94",
      "interests_unpaid": "0.00"
    }
  ]
}
```

**Frequency Limit:** 10 requests per 30 seconds

### Account Positions

**Endpoint:** `GET /account/positions`

**Query Parameters:**
- `account_id` (required)
- `page_size` (optional) - Default: 10, Max: 100
- `last_instrument_id` (optional) - Pagination token

**Response:**
```json
{
  "has_next": false,
  "holdings": [
    {
      "instrument_id": "913256135",
      "symbol": "AAPL",
      "instrument_type": "STOCK",
      "currency": "USD",
      "unit_cost": "9.54",
      "qty": 11000.0,
      "total_cost": "105006.00",
      "last_price": "52.250",
      "market_value": "574750.00",
      "unrealized_profit_loss": "469744.00",
      "unrealized_profit_loss_rate": "4.4700",
      "holding_proportion": "0.9800"
    }
  ]
}
```

**Frequency Limit:** 10 requests per 30 seconds

---

## Order Placement

### Order Types

- `MARKET` - Market order
- `LIMIT` - Limit order
- `STOP_LOSS` - Stop order
- `STOP_LOSS_LIMIT` - Stop-limit order
- `TRAILING_STOP_LOSS` - Trailing stop order

### Time in Force

- `DAY` - Day order (default)

### Extended Hours Trading

- `extended_hours_trading` (boolean)
- `true` - Allow extended hours trading (only for LIMIT orders)
- `false` - Regular market hours only

### Place Order

**Endpoint:** `POST /trade/order/place`

**Request Body:**
```json
{
  "account_id": "7THGGKDQ5SRN2SFORREFD54DO9",
  "stock_order": {
    "client_order_id": "27290e2404e84572b2ffa0f89906525d",
    "side": "BUY",
    "tif": "DAY",
    "extended_hours_trading": false,
    "instrument_id": "913256135",
    "order_type": "MARKET",
    "qty": "100"
  }
}
```

**Required Fields:**
- `client_order_id` - User-defined order ID (max 40 chars, must be unique)
- `side` - `BUY` or `SELL`
- `tif` - Time in force (`DAY`)
- `extended_hours_trading` - Boolean
- `instrument_id` - Instrument ID (from lookup)
- `order_type` - Order type
- `qty` - Order quantity (positive integer, max 200,000)

**Optional Fields (by order type):**
- `limit_price` - Required for `LIMIT` and `STOP_LOSS_LIMIT`
- `stop_price` - Required for `STOP_LOSS`, `STOP_LOSS_LIMIT`, `TRAILING_STOP_LOSS`
- `trailing_type` - Required for `TRAILING_STOP_LOSS` (`PERCENTAGE` or `AMOUNT`)
- `trailing_stop_step` - Required for `TRAILING_STOP_LOSS`

**Response:**
```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "client_order_id": "01916462123512190"
  }
}
```

**Frequency Limit:** 1 request per second

**Quantity Rules:**
- Price < $0.01: Only liquidation supported, cannot place orders
- Price $0.01 - $0.099: Minimum 1000 shares
- Price $0.1 - $0.999: Minimum 100 shares
- Price >= $1.00: Minimum 1 share

**Price Rules:**
- Price >= $1.00: Minimum step size 0.01
- Price < $1.00: Minimum step size 0.0001

**Stop Price Rules:**
- Buy orders: Stop price must be greater than current market price
- Sell orders: Stop price must be less than current market price

**Trailing Stop Rules:**
- `PERCENTAGE`: Value >= 1%, integer (e.g., 20 = 20%)
- `AMOUNT`: 
  - Trailing spread >= $1: Minimum step 0.01
  - Trailing spread < $1: Minimum step 0.0001

### Replace Order

**Endpoint:** `POST /trade/order/replace`

**Important:**
- Only `qty` and `limit_price`/`stop_price` can be modified
- All other parameters must match original order exactly
- Must pass all original parameters (unchanged)

**Frequency Limit:** 1 request per second

### Cancel Order

**Endpoint:** `POST /trade/order/cancel`

**Request Body:**
```json
{
  "account_id": "7THGGKDQ5SRN2SFORREFD54DO9",
  "client_order_id": "01916462123512190"
}
```

**Response:**
```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "client_order_id": "01916462123512190"
  }
}
```

**Frequency Limit:** 1 request per second

### Query Orders

**Day Orders:** `GET /trade/orders/list-today`
**Open Orders:** `GET /trade/orders/list-open`
**Order Detail:** `GET /trade/order/detail`

**Query Parameters:**
- `account_id` (required)
- `page_size` (required) - Default: 10, Max: 100
- `last_client_order_id` (optional) - Pagination token

**Response:**
```json
{
  "hasNext": false,
  "orders": [
    {
      "account_id": "6TGIBSMG28Q35OVA465T99VHPB",
      "client_order_id": "APG63S4F36TM94T4SRQ3K7IE7B",
      "order_id": "658520233254322176",
      "extended_hours_trading": false,
      "tif": "DAY",
      "items": [
        {
          "symbol": "AAPL",
          "category": "US_STOCK",
          "filled_price": "10.00",
          "filled_qty": "100",
          "last_filled_time": "2022-12-19T11:29:49.057Z",
          "order_status": "FILLED",
          "order_type": "MARKET",
          "place_time": "2022-12-19T11:29:48.672Z",
          "qty": "100",
          "side": "BUY",
          "instrument_id": "913256135",
          "currency": "USD"
        }
      ]
    }
  ]
}
```

**Order Status:**
- `SUBMITTED` - Submitted
- `CANCELLED` - Canceled
- `FAILED` - Failed
- `FILLED` - Filled
- `PARTIAL_FILLED` - Partially filled

**Frequency Limit:** 10 requests per 30 seconds

---

## Market Data

### Get Instruments

**Endpoint:** `GET /instrument/list` (HTTP or gRPC)

**Frequency Limit:** 60 requests per minute

### Market Snapshot

**Endpoint:** `/market-data/snapshot` (gRPC only)

**Request Parameters:**
- `symbols` (required) - Comma-separated list, up to 100 symbols
- `category` (required) - `US_STOCK` or `US_ETF`

**Response:**
```json
[
  {
    "symbol": "AAPL",
    "price": "100",
    "open": "100",
    "high": "105",
    "low": "99",
    "pre_close": "101",
    "volume": "1000",
    "change": "1.0",
    "change_ratio": "0.05"
  }
]
```

**Frequency Limit:** 1 request per second

### Order Book (Depth)

**Endpoint:** `/market-data/quotes` (gRPC only)

**Request Parameters:**
- `symbol` (required) - Single symbol
- `category` (required) - `US_STOCK` or `US_ETF`

**Response:**
```json
{
  "symbol": "F",
  "instrumentId": "913255275",
  "asks": [
    {
      "price": "13.900000",
      "size": "5",
      "order": [
        {
          "mpid": "NSDQ",
          "size": "5"
        }
      ]
    }
  ],
  "bids": [
    {
      "price": "13.890000",
      "size": "10"
    }
  ]
}
```

**Frequency Limit:** 1 request per second

### Candlesticks

**Endpoint:** `/market-data/bars` (gRPC only)

**Request Parameters:**
- `symbol` (required)
- `category` (required)
- `timespan` (required) - `M1`, `M5`, `M15`, `M30`, `M60`, `M120`, `M240`, `D`, `W`, `M`, `Y`
- `count` (optional) - Default: 200, Max: 1200

**Frequency Limit:** 60 requests per minute

### Tick-by-Tick

**Endpoint:** `/market-data/tick` (gRPC only)

**Request Parameters:**
- `symbol` (required)
- `category` (required)
- `count` (required) - Default: 30, Max: 1000

**Frequency Limit:** 1 request per second

### Streaming Market Data (MQTT)

**Protocol:** MQTT v3.1.1

**Steps:**
1. Get token via gRPC: `/market-data/streaming/token`
2. Establish MQTT connection
3. Subscribe: `/market-data/streaming/subscribe`
4. Unsubscribe: `/market-data/streaming/unsubscribe`

**Limits:**
- Max 1 push connection per App ID
- Max 100 subscription topics
- Each `sub_type` per symbol = 1 topic

**Subscription Types:**
- `QUOTE` - Order Book
- `SNAPSHOT` - Market Snapshot
- `TICK` - Tick-by-Tick

---

## Trade Events Subscription (gRPC)

**Protocol:** gRPC Server Streaming

**Purpose:** Real-time order status change notifications

**Supported Events:**
- `PLACE_FAILED` - Order failed
- `MODIFY_SUCCESS` - Order modified successfully
- `MODIFY_FAILED` - Order modification failed
- `CANCEL_SUCCESS` - Order canceled successfully
- `CANCEL_FAILED` - Order cancellation failed
- `FILLED` - Partially filled
- `FINAL_FILLED` - Fully filled

**Usage:**
1. Establish gRPC connection
2. Subscribe with account ID
3. Receive event messages via callback

---

## Rate Limiting

### Global Limits

- **Order Placement:** 1 request per second
- **Account Queries:** 10 requests per 30 seconds
- **Account List:** 20 requests per 30 seconds
- **Market Data Snapshot:** 1 request per second
- **Market Data Quotes:** 1 request per second
- **Market Data Bars:** 60 requests per minute
- **Get Instruments:** 60 requests per minute
- **Trading Calendar:** 30 requests per 30 seconds

### Error Handling

**429 Too Many Requests:**
- Rate limit exceeded
- Implement exponential backoff
- Retry after delay

**Common Errors:**
- `TOO_MANY_REQUESTS` - Rate limit exceeded
- `CLOCK_SKEW_EXCEEDED` - Timestamp offset too large
- `DUPPLICATED_REQUEST` - Nonce reused
- `INVALID_TOKEN` - Invalid signature
- `INCORRECT_SIGN` - Signature verification failed

---

## Webhook Integration Examples

### Basic Market Order

```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**System Flow:**
1. Lookup `instrument_id` for AAPL
2. Get `account_id` from account list
3. Generate `client_order_id` (UUID)
4. Calculate HMAC-SHA1 signature
5. Submit order

### Limit Order

```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Extended Hours Order

```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "extendedHours": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Note:** Extended hours only supported for LIMIT orders.

### Stop Loss Order

```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "stop",
  "stopPrice": 145.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Trailing Stop Order

```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "trailing_stop",
  "stopPrice": 145.00,
  "trailingType": "PERCENTAGE",
  "trailingStopStep": "5",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

---

## Special Considerations

### Instrument ID Lookup

- Must lookup `instrument_id` before every trade
- Cache `instrument_id` → `symbol` mapping
- Handle multiple results for same symbol
- Re-query if instrument not found in cache

### Account ID Management

- Get `account_id` from `/app/subscriptions/list`
- `account_id` required for all trading operations
- Auto-detect default account if user has multiple
- Store `account_id` in credentials (optional)

### Client Order ID

- User-defined order ID (max 40 characters)
- Must be globally unique
- Used for order tracking and idempotency
- Generate using UUID (truncated to 40 chars)

### Signature Generation

- Complex HMAC-SHA1 signature required
- Must handle URL encoding correctly
- Clock skew protection (timestamp validation)
- Duplicate request protection (nonce uniqueness)
- Body MD5 calculation (if body exists)

### Order Quantity Rules

- Price-dependent minimum quantities
- Maximum: 200,000 shares
- Must validate quantity before submission

### Price Precision

- Price >= $1.00: 0.01 increments
- Price < $1.00: 0.0001 increments
- Must validate price precision

### Extended Hours Trading

- Only supported for LIMIT orders
- Set `extended_hours_trading: true`
- Not available for MARKET, STOP, or TRAILING_STOP orders

### Day Order Restrictions

- Day orders not allowed after 4 PM
- Error: `DAY_ORDER_NOT_ALLOWED_AFT_CORE_TIME`
- Must use GTC orders for after-hours (if supported)

### Cash Account Restrictions

- Cash accounts cannot sell short
- Must have settled funds for orders
- Error: `CASH_ACCOUNT_CAN_NOT_SELL_SHORT`

### Margin Account Requirements

- Short selling requires minimum $2,000 net account value
- Error: `MARGIN_ACCOUNT_CAN_NOT_SELL_SHORT_FOR_LT_2K`

---

## Error Handling

### Common Errors

**Authentication:**
- `INVALID_TOKEN` - Invalid signature or expired
- `INCORRECT_SIGN` - Signature verification failed
- `CLOCK_SKEW_EXCEEDED` - Timestamp offset too large
- `DUPPLICATED_REQUEST` - Nonce reused

**Orders:**
- `ORDER_NOT_FOUND` - Order does not exist
- `DAY_ORDER_NOT_ALLOWED_AFT_CORE_TIME` - Day order after 4 PM
- `DAY_BUYING_POWER_INSUFFICIENT` - Insufficient buying power
- `CAN_NOT_TRADING_FOR_NON_TRADING_HOURS` - Extended hours not supported
- `STOP_PRICE_MUST_BE_LESS_THAN_MARKET_PRICE` - Invalid stop price
- `ORDER_QUANTITY_EXCEED_LIMIT` - Quantity > 200,000

**Instruments:**
- `INSTRUMENT_NOT_FOUND` - Instrument not found
- `INVALID_SYMBOL` - Invalid symbol
- `TOO_MANY_SYMBOLS` - Too many symbols in request

**Rate Limiting:**
- `TOO_MANY_REQUESTS` - Rate limit exceeded
- `REQUEST_TOTAL_COUNT_EXCEEDED` - API quota exceeded

### Retry Logic

- Retry on 5xx errors (up to 3 times with exponential backoff)
- Retry on 429 rate limit errors
- Do not retry on 4xx client errors (except 429)
- Handle `TRADE_WEBULL_REQUEST_PROCESSING` (order being processed)

---

## Configuration

### Credential Storage

**Database Schema:** `bot_credentials` table

**Fields:**
- `api_key` → App Key (from Webull website)
- `api_secret` → App Secret (from Webull website)
- `extra_metadata` → JSON object containing:
  - `account_id` - Default account ID (optional, auto-detected)
  - `region_id` - Region (default: `us`)

**Credential Flow:**
1. User generates App Key and App Secret on Webull website
2. User enters App Key and App Secret in SignalStudio
3. System automatically looks up account_id (if not provided)
4. System generates signatures for all API requests

---

## Testing

### Test Scenarios

1. **Authentication:**
   - Generate HMAC-SHA1 signature
   - Handle clock skew
   - Handle duplicate nonce
   - Verify signature validation

2. **Instrument Discovery:**
   - Lookup instrument_id for symbols
   - Cache instrument_id
   - Handle multiple results

3. **Account Management:**
   - List accounts
   - Get account balance
   - Get account positions
   - Handle multiple accounts

4. **Order Placement:**
   - Market orders
   - Limit orders
   - Stop orders
   - Stop-limit orders
   - Trailing stop orders
   - Extended hours orders
   - Order modification
   - Order cancellation

5. **Market Data:**
   - Get instruments
   - Market snapshot
   - Order book
   - Candlesticks
   - Tick-by-tick

6. **Error Handling:**
   - Rate limiting
   - Invalid signatures
   - Order validation errors
   - Account restrictions

---

## Implementation Checklist

- [ ] Implement HMAC-SHA1 signature generation
- [ ] Implement instrument_id lookup and caching
- [ ] Implement account_id auto-detection
- [ ] Implement all BaseExchangeAPI methods
- [ ] Implement order placement (all types)
- [ ] Implement order modification
- [ ] Implement order cancellation
- [ ] Implement order status queries
- [ ] Implement market data endpoints
- [ ] Add to ExchangeFactory.js
- [ ] Add to TradeExecutor.js asset class mapping
- [ ] Create SignalStudio balance endpoint
- [ ] Add to exchangeMetadata.ts
- [ ] Update EXCHANGES.md
- [ ] Test signature generation
- [ ] Test instrument lookup
- [ ] Test order placement
- [ ] Test rate limiting
- [ ] Test error handling

---

## References

- Webull OpenAPI Documentation
- HMAC-SHA1 Specification: RFC 2104
- ISO 8601 Date/Time Format

---

## Conclusion

Webull is a **Medium complexity** integration due to:

1. **HMAC-SHA1 Signature:** Complex signature generation required
2. **Instrument ID Lookup:** Must lookup instrument_id before trading
3. **Account ID Management:** Account ID required for all operations
4. **Rate Limiting:** Strict per-endpoint limits
5. **Order Rules:** Complex quantity and price rules

**User Experience Rating:** ⭐⭐⭐ (3/5)
- Moderate complexity (signature generation)
- Instrument ID lookup adds latency
- Good feature set (extended hours, trailing stops)
- Commission-free trading

**Recommendation:** Proceed with implementation - manageable complexity with good feature set.

For detailed user experience analysis, see [`docs/reference/WEBULL_UX_ANALYSIS.md`](WEBULL_UX_ANALYSIS.md).
