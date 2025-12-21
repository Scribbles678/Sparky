# FX Open (TickTrader) API Implementation Guide

## Overview

FX Open uses the TickTrader platform, offering both REST API and WebSocket APIs for trading. The platform supports forex, stocks, commodities, and other instruments. The API provides comprehensive trading capabilities including market, limit, stop, and stop-limit orders, OCO orders, and real-time market data.

**Complexity Assessment:** 🟡 **MEDIUM**

**Why Medium:**
- ✅ REST API (standard HTTP/JSON)
- ✅ WebSocket API available (optional, for real-time data)
- ✅ Standard order types (Market, Limit, Stop, StopLimit)
- ✅ OCO (One-Cancels-Other) order support
- ⚠️ HMAC-SHA256 signature-based authentication (requires signature generation)
- ⚠️ Two-factor authentication (2FA) may be required
- ⚠️ Account types: Net vs. Cash (different endpoints)
- ⚠️ WebSocket connection management required for real-time features

**Why Not Easy:**
- HMAC signature authentication adds complexity
- Two-factor authentication may be required
- Account type differences (Net vs. Cash accounts)
- WebSocket connection management for real-time data

## Authentication

FX Open uses **HMAC-SHA256 signature-based authentication** for both REST and WebSocket APIs.

**Base URLs:**
- **REST API:** `https://api.fxopen.com/api/v2` (example - actual URL may vary by broker)
- **WebSocket (Trading):** `wss://api.fxopen.com/ws` (example - actual URL may vary)
- **WebSocket (Feed):** `wss://api.fxopen.com/feed` (example - actual URL may vary)

**Credential Storage in SignalStudio:**
- `api_key` → Web API Key (from FX Open dashboard)
- `api_secret` → Web API Secret (from FX Open dashboard)
- `extra_metadata.webApiId` → Web API ID (if different from key)
- `extra_metadata.twoFactorEnabled` → Boolean flag for 2FA requirement
- `extra_metadata.accountId` → Account ID (optional, auto-detected)
- `extra_metadata.accountType` → `Net` or `Cash` (auto-detected)
- `extra_metadata.environment` → `production` or `demo` (default: `production`)

### HMAC Signature Authentication

**Signature Generation:**
```
Signature = BASE64(HMAC-SHA256(timestamp + id + key, secret))
```

**Where:**
- `timestamp`: Current timestamp in milliseconds (e.g., `Date.now()`)
- `id`: Unique request ID (UUID or random string)
- `key`: Web API Key
- `secret`: Web API Secret

**Example (JavaScript):**
```javascript
const crypto = require('crypto');

function createSignature(timestamp, id, key, secret) {
  const message = timestamp + id + key;
  const hash = crypto.createHmac('sha256', secret)
    .update(message)
    .digest('base64');
  return hash;
}
```

### REST API Authentication

**Authorization Header:**
```
Authorization: Bearer {access_token}
```

**Note:** The REST API documentation doesn't explicitly show the authentication method. Based on common patterns and the WebSocket HMAC authentication, the REST API likely uses:
1. **Option 1:** Bearer token (obtained via initial HMAC authentication)
2. **Option 2:** HMAC signature in headers (similar to WebSocket)

**Recommended Approach:**
- Use WebSocket for initial authentication to obtain session token
- Use Bearer token for REST API calls
- Or implement HMAC signature in REST API headers if required

### WebSocket Authentication

**Login Request:**
```json
{
  "Id": "unique-request-id",
  "Request": "Login",
  "Params": {
    "AuthType": "HMAC",
    "WebApiId": "your-web-api-id",
    "WebApiKey": "your-web-api-key",
    "Timestamp": 1234567890123,
    "Signature": "base64-encoded-hmac-signature",
    "DeviceId": "SignalStudio",
    "AppSessionId": "session-id"
  }
}
```

**Login Response (Success):**
```json
{
  "Id": "unique-request-id",
  "Response": "Login",
  "Result": {
    "Info": "ok",
    "TwoFactorFlag": false
  }
}
```

**Login Response (2FA Required):**
```json
{
  "Id": "unique-request-id",
  "Response": "TwoFactor",
  "Result": {
    "Info": "Two-factor authentication is required."
  }
}
```

**Two-Factor Authentication Request:**
```json
{
  "Id": "unique-request-id",
  "Request": "TwoFactor",
  "Params": {
    "OneTimePassword": "123456"
  }
}
```

**Two-Factor Authentication Response:**
```json
{
  "Id": "unique-request-id",
  "Response": "TwoFactor",
  "Result": {
    "Info": "Success",
    "ExpireTime": 1475157761354
  }
}
```

### Account Types

FX Open supports two account types:

1. **Net Accounts:**
   - Positions are netted (long and short positions offset)
   - Use `/api/v2/position` endpoints
   - Single position per symbol

2. **Cash Accounts:**
   - Multiple positions per symbol
   - Use `/api/v2/asset` endpoints
   - Asset-based (currency with amount)

**Auto-Detection:**
- Query account information to determine account type
- Use appropriate endpoints based on account type

## API Endpoints

### Account Management

#### Get Account Information

**Endpoint:** `GET /api/v2/account`

**Response:**
```json
{
  "Id": 5,
  "AccountingType": "Gross",
  "Name": "DemoForexGross",
  "Balance": 999999.19,
  "BalanceCurrency": "USD",
  "Profit": 0.0,
  "Equity": 999999.19,
  "Margin": 0,
  "MarginLevel": 0,
  "Leverage": 100,
  "IsWebApiEnabled": true
}
```

#### Get Assets (Cash Accounts Only)

**Endpoint:** `GET /api/v2/asset`

**Response:**
```json
[
  {
    "Currency": "USD",
    "Amount": 873244.4,
    "FreeAmount": 873244.4,
    "LockedAmount": 0.0
  }
]
```

#### Get Positions (Net Accounts Only)

**Endpoint:** `GET /api/v2/position`

**Response:**
```json
[
  {
    "Id": 123,
    "Symbol": "EURUSD",
    "LongAmount": 10000,
    "LongPrice": 1.0850,
    "ShortAmount": 0,
    "ShortPrice": 0,
    "Profit": 50.0,
    "Margin": 100.0
  }
]
```

### Market Data

#### Get Symbols

**Endpoint:** `GET /api/v2/symbol`

**Response:**
```json
[
  {
    "Symbol": "EURUSD",
    "Precision": 5,
    "MarginMode": "Forex",
    "ProfitMode": "Forex",
    "ContractSize": 100000,
    "MinTradeAmount": 0.01,
    "MaxTradeAmount": 100,
    "TradeAmountStep": 0.01
  }
]
```

#### Get Ticks (Real-Time Quotes)

**Endpoint:** `GET /api/v2/tick`

**Response:**
```json
[
  {
    "Symbol": "EURUSD",
    "Timestamp": 1234567890123,
    "BestBid": {
      "Type": "Bid",
      "Price": 1.0850,
      "Volume": 1000000
    },
    "BestAsk": {
      "Type": "Ask",
      "Price": 1.0851,
      "Volume": 1000000
    }
  }
]
```

#### Get Level 2 (Market Depth)

**Endpoint:** `GET /api/v2/level2?depth=1`

**Response:**
```json
[
  {
    "Symbol": "EURUSD",
    "Timestamp": 1234567890123,
    "Bids": [
      { "Type": "Bid", "Price": 1.0850, "Volume": 1000000 }
    ],
    "Asks": [
      { "Type": "Ask", "Price": 1.0851, "Volume": 1000000 }
    ]
  }
]
```

### Order Execution

#### Create Trade (Place Order)

**Endpoint:** `POST /api/v2/trade`

**Request:**
```json
{
  "Type": "Market",
  "Side": "Buy",
  "Symbol": "EURUSD",
  "Amount": 0.1,
  "StopLoss": 1.0800,
  "TakeProfit": 1.0900,
  "Comment": "SignalStudio order"
}
```

**Order Types:**
- `Market`: Market order
- `Limit`: Limit order (requires `Price`)
- `Stop`: Stop order (requires `StopPrice`)
- `StopLimit`: Stop-limit order (requires `Price` and `StopPrice`)

**Sides:**
- `Buy`: Buy order
- `Sell`: Sell order

**Response:**
```json
{
  "Id": 12345,
  "Type": "Market",
  "Side": "Buy",
  "Symbol": "EURUSD",
  "Status": "Filled",
  "Amount": 0.1,
  "FilledAmount": 0.1,
  "Price": 1.0850,
  "Created": 1234567890123
}
```

#### Modify Trade

**Endpoint:** `PUT /api/v2/trade`

**Request:**
```json
{
  "Id": 12345,
  "Price": 1.0855,
  "StopLoss": 1.0805,
  "TakeProfit": 1.0905
}
```

#### Cancel/Close Trade

**Endpoint:** `DELETE /api/v2/trade?Type=Cancel&Id=12345`

**Types:**
- `Cancel`: Cancel pending order
- `Close`: Close market order (full or partial)
- `CloseBy`: Close by another trade

**Request Parameters:**
- `Type`: `Cancel`, `Close`, or `CloseBy` (required)
- `Id`: Trade ID (required)
- `Amount`: Close amount (optional, for partial close)
- `ById`: Close by trade ID (optional, for CloseBy)

#### Get Trades

**Endpoint:** `GET /api/v2/trade`

**Response:**
```json
[
  {
    "Id": 12345,
    "Type": "Market",
    "Side": "Buy",
    "Symbol": "EURUSD",
    "Status": "Filled",
    "Amount": 0.1,
    "Price": 1.0850
  }
]
```

#### Get Trade by ID

**Endpoint:** `GET /api/v2/trade/{id}`

#### Create OCO Trade

**Endpoint:** `POST /api/v2/trade/oco`

**Request:**
```json
{
  "FirstRequest": {
    "Type": "Limit",
    "Side": "Buy",
    "Symbol": "EURUSD",
    "Price": 1.0850,
    "Amount": 0.1
  },
  "SecondRequest": {
    "Type": "Stop",
    "Side": "Buy",
    "Symbol": "EURUSD",
    "StopPrice": 1.0800,
    "Amount": 0.1
  }
}
```

**Response:**
```json
{
  "FirstTrade": {
    "Id": 12345,
    "Type": "Limit",
    "Status": "New"
  },
  "SecondTrade": {
    "Id": 12346,
    "Type": "Stop",
    "Status": "New"
  }
}
```

### Trade History

**Endpoint:** `POST /api/v2/tradehistory`

**Request:**
```json
{
  "TimestampFrom": 1234567890000,
  "TimestampTo": 1234567890123,
  "RequestDirection": "Forward",
  "RequestPageSize": 1000
}
```

**Response:**
```json
{
  "IsLastReport": false,
  "TotalReports": 100,
  "Records": [
    {
      "Id": "record-id",
      "TransactionType": "OrderOpened",
      "Symbol": "EURUSD",
      "TradeAmount": 0.1,
      "TradePrice": 1.0850,
      "Balance": 999999.19
    }
  ],
  "LastId": "last-record-id"
}
```

## WebSocket API

### Connection

**Trading WebSocket:**
```
wss://api.fxopen.com/ws
```

**Feed WebSocket:**
```
wss://api.fxopen.com/feed
```

### WebSocket Requests

All WebSocket requests follow this format:
```json
{
  "Id": "unique-request-id",
  "Request": "RequestName",
  "Params": { /* request parameters */ }
}
```

### WebSocket Responses

**Success Response:**
```json
{
  "Id": "unique-request-id",
  "Response": "RequestName",
  "Result": { /* response data */ }
}
```

**Error Response:**
```json
{
  "Id": "unique-request-id",
  "Response": "Error",
  "Error": "Error description"
}
```

### WebSocket Notifications

**Account Update:**
```json
{
  "Notification": "Account",
  "Result": {
    "Balance": 999999.19,
    "Equity": 999999.19,
    "Margin": 0
  }
}
```

**Trade Update:**
```json
{
  "Notification": "ExecutionReport",
  "Result": {
    "TradeId": 12345,
    "Status": "Filled",
    "FilledAmount": 0.1
  }
}
```

## Rate Limiting

**Throttling:**
- Per-account rate limits (configurable by broker)
- Per-second request limits
- Concurrent request limits
- Session limits

**Error Response (429):**
```json
{
  "s": "error",
  "code": 429,
  "message": "Too Many Requests"
}
```

## Error Handling

**Common HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (malformed syntax)
- `401`: Unauthorized (authentication required)
- `402`: Payment Required (insufficient funds)
- `403`: Forbidden (limited access rights)
- `404`: Not Found
- `410`: Gone (off quotes or dealer reject)
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

**Error Response Format:**
```json
{
  "Response": "Error",
  "Error": "Error description"
}
```

## Implementation Notes

### Authentication Flow

1. **Generate HMAC Signature:**
   - Create unique request ID
   - Get current timestamp (milliseconds)
   - Concatenate: `timestamp + id + key`
   - Calculate HMAC-SHA256 with secret
   - Base64 encode result

2. **WebSocket Login:**
   - Connect to WebSocket endpoint
   - Send login request with signature
   - Handle 2FA if required
   - Store session token if provided

3. **REST API Calls:**
   - Use Bearer token (if obtained from WebSocket)
   - Or include HMAC signature in headers
   - Handle token refresh if needed

### Account Type Detection

1. **Query Account Information:**
   - Call `GET /api/v2/account`
   - Check `AccountingType` field
   - Determine if Net or Cash account

2. **Use Appropriate Endpoints:**
   - Net accounts: Use `/api/v2/position`
   - Cash accounts: Use `/api/v2/asset`

### Order Management

1. **Order Types:**
   - Market: Immediate execution
   - Limit: Execute at specified price or better
   - Stop: Trigger at stop price, then market order
   - StopLimit: Trigger at stop price, then limit order

2. **Order Modifications:**
   - Only pending orders can be modified
   - Market orders cannot be modified (must close)
   - Use `PUT /api/v2/trade` for modifications

3. **Order Cancellation:**
   - Use `DELETE /api/v2/trade?Type=Cancel&Id={id}`
   - Only pending orders can be cancelled

### Two-Factor Authentication

1. **Check 2FA Requirement:**
   - Login response includes `TwoFactorFlag`
   - If `true`, 2FA is required

2. **Handle 2FA:**
   - Prompt user for TOTP code
   - Send TwoFactor request with code
   - Store expiration time if provided
   - Resume session if token available

### WebSocket Connection Management

1. **Connection Lifecycle:**
   - Connect on first API call
   - Maintain connection for real-time updates
   - Reconnect on disconnect
   - Handle connection errors gracefully

2. **Session Management:**
   - Store session ID
   - Handle session expiration
   - Re-authenticate if needed

## User Experience Analysis

### Initial Setup

**Steps:**
1. User navigates to Account → Exchanges in SignalStudio
2. Selects "FX Open"
3. Enters Web API Key and Secret
4. System validates credentials (HMAC authentication)
5. If 2FA enabled, user enters TOTP code
6. System stores credentials securely
7. System auto-detects account type (Net vs. Cash)

**User Experience:** ⚠️ **Moderate** - Requires API key/secret entry + potential 2FA

### Daily Usage

**Authentication:**
- HMAC signature generated automatically
- No user interaction required (if 2FA token cached)
- Seamless operation

**Trading:**
- Standard webhook-based trading
- No additional complexity for users

**User Experience:** ✅ **Good** - Fully automatic after initial setup

### Comparison to Other Exchanges

**vs. Alpaca (API Key):**
- ⚠️ More complex (HMAC signature vs. simple API key)
- ⚠️ 2FA may be required
- ✅ Better security (signature-based)

**vs. TradeStation (OAuth 2.0):**
- ⚠️ More complex (HMAC signature vs. OAuth redirect)
- ✅ No browser redirect required
- ⚠️ 2FA may be required

**Overall Rating:** ⭐⭐⭐ (3/5) - Moderate complexity, HMAC signature adds friction

## Recommendations

1. **Implement HMAC-SHA256 signature generation** (standard crypto library)
2. **Support two-factor authentication** (TOTP code entry)
3. **Auto-detect account type** (Net vs. Cash)
4. **Use appropriate endpoints** based on account type
5. **Implement WebSocket connection** for real-time updates (optional)
6. **Handle session management** (reconnect, re-authenticate)
7. **Support OCO orders** (One-Cancels-Other)
8. **Handle rate limiting** (with exponential backoff)

## Documentation References

- TickTrader User Web API: REST API documentation
- TickTrader Trade WebSocket API: Trading WebSocket documentation
- TickTrader Feed WebSocket API: Market data WebSocket documentation
- FX Open Website: https://www.fxopen.com/
