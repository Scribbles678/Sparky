# Public.com API Implementation Guide

## Overview

Public.com is a commission-free stock and options trading platform. This document details the integration of Public.com's API into Sparky Bot, SignalStudio, and marketing materials.

**API Type:** REST API  
**Authentication:** Secret Key → Access Token (Bearer)  
**Base URL:** `https://api.public.com`  
**Complexity:** Medium

---

## Authentication

### Secret Key to Access Token Flow

Public.com uses a two-step authentication process:

1. **Generate Secret Key** (One-time, user action)
   - User goes to Public.com settings page
   - Generates a secret key
   - **Important:** Secret keys must be kept secure and never exposed in client-side code

2. **Exchange Secret for Access Token** (System action)
   - POST to `/userapiauthservice/personal/access-tokens`
   - Returns access token with configurable validity period
   - Access token used as Bearer token for all subsequent requests

### Token Management

**Token Exchange:**
```javascript
POST https://api.public.com/userapiauthservice/personal/access-tokens
Content-Type: application/json

{
  "validityInMinutes": 1440,  // 24 hours (configurable)
  "secret": "YOUR_SECRET_KEY"
}

Response:
{
  "accessToken": "YOUR_ACCESS_TOKEN"
}
```

**Token Usage:**
```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Token Expiration:**
- Tokens have configurable validity (in minutes)
- Recommended: 1440 minutes (24 hours) for production
- System should refresh token proactively before expiration
- Store token expiration time and refresh when < 1 hour remaining

**Implementation Strategy:**
```javascript
class PublicAPI {
  constructor(secretKey, accountId = null) {
    this.secretKey = secretKey;
    this.accountId = accountId;
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.tokenValidityMinutes = 1440; // 24 hours
  }

  async ensureValidToken() {
    const now = Date.now();
    
    // Refresh if no token or expires within 1 hour
    if (!this.accessToken || now >= (this.tokenExpiresAt - 3600000)) {
      await this.refreshToken();
    }
  }

  async refreshToken() {
    const response = await axios.post(
      'https://api.public.com/userapiauthservice/personal/access-tokens',
      {
        validityInMinutes: this.tokenValidityMinutes,
        secret: this.secretKey,
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    this.accessToken = response.data.accessToken;
    this.tokenExpiresAt = Date.now() + (this.tokenValidityMinutes * 60 * 1000);
    
    return this.accessToken;
  }
}
```

---

## API Base URLs

- **Auth Service:** `https://api.public.com/userapiauthservice/personal/access-tokens`
- **Trading Gateway:** `https://api.public.com/userapigateway/trading/`
- **Market Data Gateway:** `https://api.public.com/userapigateway/marketdata/`
- **Option Details Gateway:** `https://api.public.com/userapigateway/option-details/`

---

## Account Management

### List Accounts

**Endpoint:** `GET /userapigateway/trading/account`

**Response:**
```json
{
  "accounts": [
    {
      "accountId": "string",
      "accountType": "BROKERAGE",
      "optionsLevel": "NONE",
      "brokerageAccountType": "CASH",
      "tradePermissions": "BUY_AND_SELL"
    }
  ]
}
```

**Account Types:**
- `BROKERAGE` - Standard brokerage account
- `HIGH_YIELD` - High-yield cash account
- `BOND_ACCOUNT` - Bond account
- `RIA_ASSET` - RIA asset account
- `TREASURY` - Treasury account
- `TRADITIONAL_IRA` - Traditional IRA
- `ROTH_IRA` - Roth IRA

**Note:** The `accountId` returned is required for most subsequent API operations. It serves as a stable, persistent identifier for the lifetime of the account.

### Get Portfolio

**Endpoint:** `GET /userapigateway/trading/{accountId}/portfolio/v2`

**Response:**
```json
{
  "accountId": "string",
  "accountType": "BROKERAGE",
  "buyingPower": {
    "cashOnlyBuyingPower": "string",
    "buyingPower": "string",
    "optionsBuyingPower": "string"
  },
  "equity": [
    {
      "type": "CASH",
      "value": "string"
    }
  ],
  "positions": [
    {
      "instrument": {
        "symbol": "string",
        "type": "EQUITY"
      },
      "quantity": "string",
      "averagePrice": "string",
      "currentPrice": "string"
    }
  ],
  "orders": [
    {
      "orderId": "string",
      "status": "NEW",
      "type": "MARKET",
      "side": "BUY"
    }
  ]
}
```

### Get Account History

**Endpoint:** `GET /userapigateway/trading/{accountId}/history`

**Query Parameters:**
- `start` (optional) - Start timestamp in ISO 8601 format with timezone
- `end` (optional) - End timestamp in ISO 8601 format with timezone
- `pageSize` (optional) - Maximum number of records to return
- `nextToken` (optional) - Pagination token for fetching next result set

**Response:**
```json
{
  "transactions": [
    {
      "timestamp": "2023-11-07T05:31:56Z",
      "id": "string",
      "type": "TRADE",
      "subType": "DEPOSIT",
      "accountNumber": "string",
      "symbol": "string",
      "securityType": "EQUITY",
      "side": "BUY",
      "description": "string",
      "netAmount": "string",
      "principalAmount": "string",
      "quantity": "string",
      "direction": "INCOMING",
      "fees": "string"
    }
  ],
  "nextToken": "string",
  "start": "2023-11-07T05:31:56Z",
  "end": "2023-11-07T05:31:56Z",
  "pageSize": 123
}
```

---

## Market Data

### Get Quotes

**Endpoint:** `POST /userapigateway/marketdata/{accountId}/quotes`

**Requires:** `marketdata` scope

**Request:**
```json
{
  "instruments": [
    {
      "symbol": "AAPL",
      "type": "EQUITY"
    }
  ]
}
```

**Response:**
```json
{
  "quotes": [
    {
      "instrument": {
        "symbol": "AAPL",
        "type": "EQUITY"
      },
      "outcome": "SUCCESS",
      "last": "150.25",
      "lastTimestamp": "2023-11-07T05:31:56Z",
      "bid": "150.24",
      "ask": "150.26",
      "volume": "1234567"
    }
  ]
}
```

**Supported Instrument Types:**
- `EQUITY` - Stocks
- `OPTION` - Options
- `INDEX` - Indices

### Get Instruments

**Endpoint:** `GET /userapigateway/trading/instruments`

**Query Parameters:**
- `typeFilter` (optional) - Array of security types to filter by
- `tradingFilter` (optional) - Array of trading statuses to filter by
- `fractionalTradingFilter` (optional) - Array of fractional trading statuses
- `optionTradingFilter` (optional) - Array of option trading statuses
- `optionSpreadTradingFilter` (optional) - Array of option spread trading statuses

**Response:**
```json
{
  "instruments": [
    {
      "instrument": {
        "symbol": "AAPL",
        "type": "EQUITY"
      },
      "trading": "BUY_AND_SELL",
      "fractionalTrading": "BUY_AND_SELL",
      "optionTrading": "BUY_AND_SELL",
      "optionSpreadTrading": "BUY_AND_SELL"
    }
  ]
}
```

### Get Option Expirations

**Endpoint:** `POST /userapigateway/marketdata/{accountId}/option-expirations`

**Requires:** `marketdata` scope

**Request:**
```json
{
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  }
}
```

**Response:**
```json
{
  "baseSymbol": "AAPL",
  "expirations": [
    "2023-11-07",
    "2023-11-14",
    "2023-11-21"
  ]
}
```

### Get Option Chain

**Endpoint:** `POST /userapigateway/marketdata/{accountId}/option-chain`

**Requires:** `marketdata` scope

**Request:**
```json
{
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  },
  "expirationDate": "2023-11-07"
}
```

**Response:**
```json
{
  "baseSymbol": "AAPL",
  "calls": [
    {
      "instrument": {
        "symbol": "AAPL231107C00150000",
        "type": "OPTION"
      },
      "outcome": "SUCCESS",
      "last": "5.25",
      "bid": "5.20",
      "ask": "5.30"
    }
  ],
  "puts": [
    {
      "instrument": {
        "symbol": "AAPL231107P00150000",
        "type": "OPTION"
      },
      "outcome": "SUCCESS",
      "last": "2.15",
      "bid": "2.10",
      "ask": "2.20"
    }
  ]
}
```

### Get Option Greeks

**Endpoint:** `GET /userapigateway/option-details/{accountId}/greeks`

**Query Parameters:**
- `osiSymbols` (required) - Array of OSI-normalized option symbols (max 250 per request)

**Response:**
```json
{
  "greeks": [
    {
      "symbol": "AAPL231107C00150000",
      "greeks": {
        "delta": "0.65",
        "gamma": "0.02",
        "theta": "-0.05",
        "vega": "0.15",
        "rho": "0.01"
      }
    }
  ]
}
```

---

## Order Placement

### Order Types

- `MARKET` - Market order
- `LIMIT` - Limit order
- `STOP` - Stop order
- `STOP_LIMIT` - Stop-limit order

### Time in Force

- `DAY` - Good for day
- `GTD` - Good till date (requires `expirationTime`)

### Market Sessions

- `CORE` - Regular market hours (default)
- `EXTENDED` - Extended hours (4:00 AM - 8:00 PM ET)
  - Available only for DAY time-in-force equity orders

### Preflight (Single Leg)

**Endpoint:** `POST /userapigateway/trading/{accountId}/preflight/single-leg`

Calculates estimated financial impact before execution.

**Request:**
```json
{
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  },
  "orderSide": "BUY",
  "orderType": "LIMIT",
  "expiration": {
    "timeInForce": "DAY"
  },
  "quantity": "10",
  "limitPrice": "150.00",
  "equityMarketSession": "CORE"
}
```

**Response:**
```json
{
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  },
  "estimatedCommission": "0.00",
  "regulatoryFees": {
    "secFee": "0.00",
    "tafFee": "0.00"
  },
  "orderValue": "1500.00",
  "estimatedQuantity": "10",
  "estimatedCost": "1500.00",
  "buyingPowerRequirement": "1500.00",
  "estimatedProceeds": "0.00"
}
```

### Place Order (Single Leg)

**Endpoint:** `POST /userapigateway/trading/{accountId}/order`

**Important:** Order placement is asynchronous. The response confirms submission, not execution.

**Order ID Requirements:**
- Must be a UUID conforming to RFC 4122 (8-4-4-4-12 format)
- Example: `0d2abd8d-3625-4c83-a806-98abf35567cc`
- Must be globally unique over time
- Serves as deduplication key (idempotent if reused on same account)
- If order is re-submitted due to timeout, do NOT modify any properties

**Request:**
```json
{
  "orderId": "3a224535-7974-4eb1-93f0-6818ea967b95",
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  },
  "orderSide": "BUY",
  "orderType": "LIMIT",
  "expiration": {
    "timeInForce": "DAY"
  },
  "quantity": "10",
  "limitPrice": "150.00",
  "equityMarketSession": "CORE"
}
```

**Response:**
```json
{
  "orderId": "da5af5c8-800c-4e01-8e2a-9afd3e784ce1"
}
```

**Fractional Trading:**
- Use `amount` instead of `quantity` for fractional shares
- `quantity` and `amount` are mutually exclusive
- Example: `"amount": "100.00"` buys $100 worth of shares

**Options Orders:**
- Include `openCloseIndicator`: `OPEN` or `CLOSE`
- Example:
```json
{
  "orderId": "uuid",
  "instrument": {
    "symbol": "AAPL231107C00150000",
    "type": "OPTION"
  },
  "orderSide": "BUY",
  "orderType": "LIMIT",
  "expiration": {
    "timeInForce": "DAY"
  },
  "quantity": "1",
  "limitPrice": "5.00",
  "openCloseIndicator": "OPEN"
}
```

### Preflight (Multi-Leg)

**Endpoint:** `POST /userapigateway/trading/{accountId}/preflight/multi-leg`

Calculates estimated financial impact for multi-leg options strategies.

**Request:**
```json
{
  "orderType": "LIMIT",
  "expiration": {
    "timeInForce": "DAY"
  },
  "quantity": 1,
  "limitPrice": "2.50",
  "legs": [
    {
      "instrument": {
        "symbol": "AAPL231107C00150000",
        "type": "OPTION"
      },
      "side": "BUY",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    },
    {
      "instrument": {
        "symbol": "AAPL231107C00160000",
        "type": "OPTION"
      },
      "side": "SELL",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    }
  ]
}
```

### Place Multi-Leg Order

**Endpoint:** `POST /userapigateway/trading/{accountId}/order/multileg`

**Important:** Only LIMIT orders are allowed for multi-leg orders.

**Request:**
```json
{
  "orderId": "7239f747-8152-4ae9-a005-96f56079fcd7",
  "quantity": 1,
  "type": "LIMIT",
  "limitPrice": "2.50",
  "expiration": {
    "timeInForce": "DAY"
  },
  "legs": [
    {
      "instrument": {
        "symbol": "AAPL231107C00150000",
        "type": "OPTION"
      },
      "side": "BUY",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    },
    {
      "instrument": {
        "symbol": "AAPL231107C00160000",
        "type": "OPTION"
      },
      "side": "SELL",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    }
  ]
}
```

**Multi-Leg Constraints:**
- 2-6 legs allowed
- At most 1 equity leg
- For debit spreads: limit price must be positive
- For credit spreads: limit price is negative

### Get Order Status

**Endpoint:** `GET /userapigateway/trading/{accountId}/order/{orderId}`

**Note:** Order placement is asynchronous. This endpoint may return HTTP 404 if the order has not yet been indexed. In some cases, the order may already be active but momentarily not visible due to eventual consistency.

**Response:**
```json
{
  "orderId": "67fafd19-ac8c-4716-93e2-b1cdb2d0a69d",
  "instrument": {
    "symbol": "AAPL",
    "type": "EQUITY"
  },
  "createdAt": "2023-11-07T05:31:56Z",
  "type": "MARKET",
  "side": "BUY",
  "status": "NEW",
  "quantity": "10",
  "expiration": {
    "timeInForce": "DAY"
  },
  "limitPrice": "150.00",
  "filledQuantity": "10",
  "averagePrice": "150.25"
}
```

**Order Statuses:**
- `NEW` - Order submitted
- `PARTIALLY_FILLED` - Partially executed
- `CANCELLED` - Cancelled
- `QUEUED_CANCELLED` - Cancellation queued
- `FILLED` - Fully executed
- `REJECTED` - Rejected
- `PENDING_REPLACE` - Replacement pending
- `PENDING_CANCEL` - Cancellation pending
- `EXPIRED` - Expired
- `REPLACED` - Replaced

### Cancel Order

**Endpoint:** `DELETE /userapigateway/trading/{accountId}/order/{orderId}`

**Note:** Cancellation is asynchronous. Most cancellations are processed immediately during market hours, but this is not guaranteed. Always use GET /{orderId} to confirm cancellation.

**Response:**
```
200 OK (no body)
```

---

## Error Handling

### Standard HTTP Status Codes

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid access token"
}
```

**400 Bad Request:**
```json
{
  "error": "Bad Request",
  "message": "Error message"
}
```

**404 Not Found:**
- Account not found
- Order not found (may not be processed yet)

### Retry Logic

- Retry on 5xx errors (up to 3 times with exponential backoff)
- Retry on 429 rate limit errors
- On 401, refresh access token and retry once
- On 404 for orders, wait briefly and retry (eventual consistency)

---

## Rate Limiting

- Rate limits not explicitly documented
- Implement exponential backoff for 429 responses
- Cache access tokens to minimize auth requests

---

## Webhook Integration Examples

### Basic Market Order

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Limit Order

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Fractional Order (Dollar Amount)

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "amount": 100.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Extended Hours Order

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "extendedHours": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Options Order

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL231107C00150000",
  "orderType": "limit",
  "price": 5.00,
  "quantity": 1,
  "openCloseIndicator": "OPEN"
}
```

### Multi-Leg Options Order

```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "orderType": "limit",
  "limitPrice": 2.50,
  "quantity": 1,
  "legs": [
    {
      "symbol": "AAPL231107C00150000",
      "side": "BUY",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    },
    {
      "symbol": "AAPL231107C00160000",
      "side": "SELL",
      "openCloseIndicator": "OPEN",
      "ratioQuantity": 1
    }
  ]
}
```

---

## Special Considerations

### Account ID Requirement

- Most endpoints require `accountId`
- Get account ID from `/userapigateway/trading/account` endpoint
- Account ID is stable and persistent for lifetime of account
- Auto-detect default account if user has multiple accounts

### Order ID Generation

- Must be RFC 4122 compliant UUID (8-4-4-4-12 format)
- Must be globally unique over time
- Serves as deduplication key (idempotent)
- Generate using `uuid` library: `uuid.v4()`

### Fractional Trading

- Use `amount` field for dollar-based orders
- Use `quantity` field for whole shares
- `amount` and `quantity` are mutually exclusive
- Fractional trading available for many stocks

### Extended Hours

- Available only for DAY time-in-force equity orders
- Extended hours: 4:00 AM - 8:00 PM ET
- Set `equityMarketSession: "EXTENDED"` in order request

### Options Trading

- Requires `optionsLevel` on account (not `NONE`)
- Include `openCloseIndicator` for options orders
- Options use OSI-normalized symbol format
- Multi-leg orders support 2-6 legs (max 1 equity leg)

### Preflight Calculations

- Use preflight endpoints to estimate costs before placing orders
- Returns estimated commission, fees, buying power requirements
- Helps users make informed decisions
- Actual execution values may vary

### Asynchronous Order Processing

- Order placement is asynchronous
- Response confirms submission, not execution
- Use GET /{orderId} to check status
- May return 404 if order not yet indexed (eventual consistency)
- Wait briefly and retry if 404

---

## Testing

### Test Credentials

- Use Public.com's production API (no separate sandbox mentioned)
- Test with small amounts first
- Verify order status after placement
- Test token refresh mechanism

### Test Scenarios

1. **Authentication:**
   - Exchange secret for access token
   - Token refresh before expiration
   - Handle expired token (401)

2. **Account Management:**
   - List accounts
   - Get portfolio
   - Get account history

3. **Market Data:**
   - Get quotes for equities
   - Get option expirations
   - Get option chain
   - Get option Greeks

4. **Order Placement:**
   - Market order (whole shares)
   - Limit order (whole shares)
   - Fractional order (dollar amount)
   - Extended hours order
   - Options order
   - Multi-leg options order
   - Stop loss order
   - Take profit order

5. **Order Management:**
   - Get order status
   - Cancel order
   - Handle eventual consistency (404 retry)

---

## Configuration

### Credential Storage

**Database Schema:** `bot_credentials` table

**Fields:**
- `api_key` → Secret Key (from Public.com settings)
- `api_secret` → (not used, but can store token validity minutes)
- `extra_metadata` → JSON object containing:
  - `accountId` - Default account ID (optional, auto-detected)
  - `tokenValidityMinutes` - Token validity period (default: 1440)

**Credential Flow:**
1. User generates secret key in Public.com settings
2. User enters secret key in SignalStudio
3. System exchanges secret for access token
4. System stores token (encrypted) with expiration time
5. System refreshes token proactively before expiration

### Webhook Payload Format

**Standard Format:**
```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Public-Specific Fields:**
- `accountId` - Optional, uses default if not provided
- `amount` - Dollar amount for fractional orders (mutually exclusive with quantity)
- `extendedHours` - Boolean, enables extended hours trading
- `openCloseIndicator` - For options: "OPEN" or "CLOSE"
- `legs` - Array for multi-leg orders

---

## References

- Public.com API Documentation (provided)
- RFC 4122 UUID Specification: https://tools.ietf.org/html/rfc4122

---

## Implementation Checklist

- [ ] Implement `publicApi.js` with BaseExchangeAPI
- [ ] Implement secret key → access token exchange
- [ ] Implement token refresh mechanism
- [ ] Implement account listing and selection
- [ ] Implement portfolio retrieval
- [ ] Implement market data endpoints (quotes, options)
- [ ] Implement order placement (single leg)
- [ ] Implement order placement (multi-leg)
- [ ] Implement order status retrieval
- [ ] Implement order cancellation
- [ ] Implement fractional trading support
- [ ] Implement extended hours support
- [ ] Add to ExchangeFactory.js
- [ ] Add to TradeExecutor.js asset class mapping
- [ ] Create SignalStudio balance endpoint
- [ ] Add to exchangeMetadata.ts
- [ ] Update EXCHANGES.md
- [ ] Test authentication flow
- [ ] Test order placement
- [ ] Test token refresh
- [ ] Test error handling
