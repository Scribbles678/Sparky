# Interactive Brokers (IBKR) API Implementation Guide

## Overview

Interactive Brokers (IBKR) is a major global broker offering stocks, options, futures, forex, and more. This document details the integration of IBKR's Web API into Sparky Bot, SignalStudio, and marketing materials.

**API Type:** REST API + WebSocket (for streaming market data)  
**Authentication:** OAuth 2.0 (private_key_jwt) for institutional, Client Portal Gateway for retail  
**Base URL:** `https://api.ibkr.com/v1/api`  
**Complexity:** ⚠️ **Complex** - Requires JWT signing, instrument discovery (conid), two-tier sessions

---

## Authentication

### Authentication Methods

IBKR offers different authentication methods depending on client type:

#### 1. Retail/Individual Clients

**Method:** Client Portal Gateway (Java Program)

- Requires a small Java program running locally
- Routes local web requests with appropriate authentication
- Uses IBKR username and password
- **Limitation:** Requires Java runtime and local gateway process
- **Rate Limit:** 10 requests per second (vs 50 for direct API)

**User Experience:** ⚠️ **Complex** - Requires:
1. Install Java runtime
2. Download and run Client Portal Gateway
3. Gateway must be running when making API calls
4. Username/password authentication through gateway

#### 2. Institutional/Enterprise Clients

**Method:** OAuth 2.0 with private_key_jwt (RFC 7521, RFC 7523)

- Client authenticates with signed JWT token (client_assertion)
- Authorization server validates against public key(s) provided during registration
- Safer than client_id/client_secret (no secret in requests)
- Requires public/private key pair generation
- **Rate Limit:** 50 requests per second

**User Experience:** ⚠️ **Very Complex** - Requires:
1. Contact IBKR API Solutions team (api-solutions@interactivebrokers.com)
2. Provide firm information and use case
3. Register application and provide public keys
4. Implement JWT signing for client_assertion
5. Handle OAuth 2.0 flow

#### 3. Third-Party Vendors

**Method:** OAuth 1.0a (after Compliance approval)

- Must receive Compliance approval before integration
- Enhanced due diligence review (3-6 weeks)
- Three-tier approval process
- Legal agreement required
- **Limitation:** Trading features only (no account management)

**User Experience:** ⚠️ **Very Complex** - Requires:
1. Submit third-party onboarding questionnaire
2. Onboarding team screening (2-3 weeks)
3. Compliance review (3-6 weeks)
4. Legal agreement (3-5 weeks)
5. Provide public keys and callback URL
6. Total timeline: 8-14 weeks minimum

### Recommended Approach for SignalStudio

**For Retail Users:** Client Portal Gateway
- Simpler than OAuth for end users
- But requires Java runtime and gateway process
- **User Experience Rating:** ⭐⭐ (2/5) - Complex setup

**For Enterprise:** OAuth 2.0 private_key_jwt
- Better for automated trading
- No local gateway required
- **User Experience Rating:** ⭐⭐⭐ (3/5) - Complex but manageable

---

## API Base URLs

- **Base URL:** `https://api.ibkr.com/v1/api`
- **Trading Endpoints:** `/iserver/*`
- **Portfolio Endpoints:** `/portfolio/*`
- **Market Data Endpoints:** `/iserver/marketdata/*`
- **Instrument Discovery:** `/trsrv/*`, `/iserver/secdef/*`

---

## Trading Sessions

### Two-Tier Session System

IBKR uses a two-tier session system:

1. **Read-Only Session (Outer)**
   - Required for all API requests
   - Permits access to non-/iserver endpoints
   - Examples: Portfolio data, instrument search

2. **Brokerage Session (Inner)**
   - Required for trading and /iserver endpoints
   - Permits access to trading, market data consumption
   - Only one brokerage session per username at a time
   - Session can be active in other IB platforms (TWS, etc.)

### Session Management

- A single username can only have one brokerage session active at a time
- Some features are accessible without brokerage session (read-only)
- Brokerage session required for:
  - Order placement
  - Market data streaming
  - Real-time portfolio updates

---

## Instrument Discovery

### Contract ID (conid)

**Critical:** IBKR uses "conid" (contract ID) instead of symbols for all operations.

- Conids are persistent for the life of an instrument
- Must search for instruments to get conid before trading
- Different conids for same symbol in different markets/currencies
- Example: AAPL in USD (US) has different conid than AAPL in MXN (Mexico)

### Finding Equities

**Endpoint:** `GET /trsrv/stocks?symbols=AAPL`

**Response:**
```json
{
  "AAPL": [
    {
      "name": "APPLE INC",
      "assetClass": "STK",
      "contracts": [
        {
          "conid": 265598,
          "exchange": "NASDAQ",
          "isUS": true
        },
        {
          "conid": 38708077,
          "exchange": "MEXI",
          "isUS": false
        }
      ]
    }
  ]
}
```

**Note:** For a single product trading in multiple markets, IB assigns distinct conids for each combination of product and currency.

### Finding Options

**Multi-Step Process:**

1. **Get Underlier Conid:**
   ```
   GET /iserver/secdef/search?symbol=AAPL&secType=STK
   ```
   - Returns conid and contract months

2. **Get Valid Strikes:**
   ```
   GET /iserver/secdef/strikes?conid=265598&exchange=SMART&sectype=OPT&month=OCT24
   ```
   - Returns separate lists for calls and puts

3. **Get Option Contract Conids:**
   ```
   GET /iserver/secdef/info?conid=265598&exchange=SMART&sectype=OPT&month=OCT24&strike=217.5
   ```
   - Returns option contract records with conids

### Finding Futures

**Endpoint:** `GET /trsrv/futures?symbols=ES`

**Response:**
```json
{
  "ES": [
    {
      "symbol": "ES",
      "conid": 495512557,
      "underlyingConid": 11004968,
      "expirationDate": 20241220,
      "ltd": 20241219
    }
  ]
}
```

### Instrument Discovery Strategy

**Recommendation:**
- Cache conids locally after first lookup
- Store conid → symbol mapping
- Re-query only if instrument not found in cache
- Handle multiple conids for same symbol (filter by exchange/currency)

---

## Market Data

### Top-of-Book Snapshots

**Endpoint:** `GET /iserver/marketdata/snapshot?conids=265598&fields=31,84,85,86,88`

**Requirements:**
- Username with market data subscriptions
- Authorized Web API session
- Brokerage session (for /iserver endpoints)

**Pre-Flight Request:**
- First request for a conid opens the data stream
- Response contains only conid (no data)
- Subsequent requests return actual market data

**Field Tags:**
- `31` - Last price
- `84` - Bid price
- `85` - Bid size
- `86` - Ask price
- `88` - Ask size
- `7059` - Volume

**Example Response:**
```json
[
  {
    "31": "168.42",
    "84": "168.41",
    "85": "600",
    "86": "168.42",
    "88": "1,300",
    "_updated": 1712596911593,
    "conid": 265598
  }
]
```

### Streaming Market Data

**WebSocket Connection:**
- Connect to WebSocket endpoint
- Subscribe: `smd+CONID+{"fields":["31","84","85","86","88"]}`
- Unsubscribe: `umd+CONID+{}`

**Note:** WebSocket streaming requires brokerage session.

---

## Order Placement

### Order Types

- `MKT` - Market order
- `LMT` - Limit order
- `STP` - Stop order
- `STP LMT` - Stop-limit order
- `TRAIL` - Trailing stop
- `TRAIL LIMIT` - Trailing stop limit

### Time in Force

- `DAY` - Good for day
- `GTC` - Good till canceled
- `IOC` - Immediate or cancel
- `FOK` - Fill or kill
- `GTD` - Good till date

### Basic Order Submission

**Endpoint:** `POST /iserver/account/{accountId}/orders`

**Request Body (Array):**
```json
[
  {
    "conid": 265598,
    "side": "BUY",
    "orderType": "LMT",
    "price": 165,
    "quantity": 100,
    "tif": "DAY"
  }
]
```

**Response:**
```json
{
  "order_id": "987654",
  "order_status": "Submitted",
  "encrypt_message": "1"
}
```

**Important:** Request body must be a JSON array (even for single orders), as it's used for bracket orders.

### Order Reply Messages

**Issue:** Some orders require confirmation before execution.

**Response Format:**
```json
[
  {
    "id": "07a13a5a-4a48-44a5-bb25-5ab37b79186c",
    "message": [
      "The following order \"BUY 100 AAPL NASDAQ.NMS @ 165.0\" price exceeds \nthe Percentage constraint of 3%.\nAre you sure you want to submit this order?"
    ],
    "isSuppressed": false,
    "messageIds": ["o163"]
  }
]
```

**Confirmation Required:**
```
POST /iserver/reply/{messageId}
{
  "confirmed": true
}
```

**Suppressing Messages:**
```
POST /iserver/questions/suppress
{
  "messageIds": ["o163"]
}
```

**Recommendation:** Suppress common message types at session start to avoid confirmation delays.

### Bracket Orders

**Parent-Child Relationship:**
- Parent order uses `cOID` (client order ID)
- Child orders use `parentId` to link to parent
- All orders submitted in single array

**Example:**
```json
{
  "orders": [
    {
      "conid": 265598,
      "cOID": "Parent",
      "orderType": "MKT",
      "side": "Buy",
      "quantity": 50,
      "tif": "GTC"
    },
    {
      "conid": 265598,
      "orderType": "STP",
      "side": "Sell",
      "price": 157.30,
      "quantity": 50,
      "tif": "GTC",
      "parentId": "Parent"
    },
    {
      "conid": 265598,
      "orderType": "LMT",
      "side": "Sell",
      "price": 157.00,
      "quantity": 50,
      "tif": "GTC",
      "parentId": "Parent"
    }
  ]
}
```

### Combo/Spread Orders

**Uses `conidex` instead of `conid`:**

**Format:** `{spread_conid};;;{leg_conid1}/{ratio},{leg_conid2}/{ratio}`

**Spread Conids by Currency:**
- USD: `28812380`
- EUR: `61227077`
- GBP: `58666491`
- JPY: `61227069`
- (See full list in documentation)

**Ratio:**
- Positive = Buy
- Negative = Sell
- Magnitude = relative size

**Example:**
```
28812380;;;265598/1,8314/-1
```
- USD spread
- Buy 1 AAPL (conid 265598)
- Sell 1 IBM (conid 8314)

### Order Modification

**Endpoint:** `POST /iserver/account/{accountId}/order/{orderId}`

**Important:**
- Request body is a single JSON object (not array)
- Must include ALL original order attributes
- Only modify the value(s) you want to change

### Order Cancellation

**Endpoint:** `DELETE /iserver/account/{accountId}/order/{orderId}`

**Response:**
```json
{
  "msg": "Request was submitted",
  "order_id": 987654,
  "conid": 265598,
  "account": "DU123456"
}
```

**Note:** Response indicates request received, not that order is canceled. Order may already be filled or at exchange.

### Order Status

**Endpoint:** `GET /iserver/account/orders?filters=filled&force=true&accountId=U1234567`

**Response:**
```json
{
  "orders": [
    {
      "orderId": 1234568790,
      "conid": 265598,
      "status": "Filled",
      "filledQuantity": 5.0,
      "remainingQuantity": 0.0,
      "avgPrice": "192.26",
      "orderType": "Market",
      "side": "SELL"
    }
  ]
}
```

---

## Portfolio and Positions

### List Accounts

**Endpoint:** `GET /portfolio/accounts`

**Response:**
```json
[
  {
    "id": "U1234567",
    "accountId": "U1234567",
    "displayName": "U1234567",
    "currency": "USD",
    "type": "DEMO",
    "tradingType": "PMRGN"
  }
]
```

**Note:** Must be called before other /portfolio endpoints.

### Currency Balances

**Endpoint:** `GET /portfolio/{accountId}/ledger`

**Response:**
```json
{
  "USD": {
    "settledcash": 214716688.0,
    "cashbalance": 214716688.0,
    "netliquidationvalue": 215335840.0,
    "stockmarketvalue": 314123.88,
    "unrealizedpnl": 39695.82
  }
}
```

### Account Summary

**Endpoint:** `GET /portfolio/{accountId}/summary`

Returns comprehensive account information including equity, margin, buying power, etc.

---

## Rate Limiting

### Global Limits

- **Direct API:** 50 requests per second per username
- **Client Portal Gateway:** 10 requests per second

### Per-Endpoint Limits

| Endpoint | Method | Limit |
|----------|--------|-------|
| `/iserver/marketdata/snapshot` | GET | 10 req/s |
| `/iserver/scanner/params` | GET | 1 req/15 mins |
| `/iserver/scanner/run` | POST | 1 req/sec |
| `/iserver/trades` | GET | 1 req/5 secs |
| `/iserver/orders` | GET | 1 req/5 secs |
| `/portfolio/accounts` | GET | 1 req/5 secs |

### Penalty Box

- Violator IP addresses may be put in penalty box for 10 minutes
- Repeat violators may be permanently blocked

---

## Maintenance Windows

### Scheduled Maintenance

- **Web API:** Accessible 24/7 during weekdays
- **Maintenance:** Saturday evenings only
- **IServer Reset:** Daily at ~01:00 local time by region:
  - North America: 01:00 US/Eastern
  - Europe: 01:00 CEST
  - Asia: 01:00 HKT

---

## Webhook Integration Examples

### Basic Market Order

```json
{
  "secret": "your-secret",
  "exchange": "ibkr",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Note:** System must:
1. Lookup conid for AAPL
2. Establish brokerage session
3. Submit order
4. Handle order reply messages if needed

### Limit Order

```json
{
  "secret": "your-secret",
  "exchange": "ibkr",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Bracket Order

```json
{
  "secret": "your-secret",
  "exchange": "ibkr",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "quantity": 100,
  "stop_loss_price": 160.00,
  "take_profit_price": 170.00
}
```

---

## Special Considerations

### Account Requirements

**For Retail/Individual:**
- Account must be fully open and funded
- Account must be "IBKR Pro" type
- Live account required (even for paper trading)

**For Institutional:**
- Contact API Solutions team
- OAuth 2.0 registration required
- Public key registration required

### Instrument Discovery Complexity

- Must lookup conid before every trade
- Multiple conids possible for same symbol
- Options require multi-step discovery
- Futures require expiration date matching
- **Recommendation:** Cache conids aggressively

### Session Management

- Two-tier session system (read-only + brokerage)
- Only one brokerage session per username
- Brokerage session can conflict with TWS/other platforms
- Must handle session expiration

### Order Reply Messages

- Some orders require confirmation
- Messages can be suppressed by type
- Suppression recommended at session start
- Confirmation adds latency to order placement

### Combo Order Format

- Complex `conidex` string format
- Requires spread_conid lookup by currency
- Ratio encoding (positive/negative for side)
- Multiple legs separated by commas

### Rate Limiting

- Strict per-endpoint limits
- Penalty box for violations
- Must implement request queuing/throttling
- Different limits for CP Gateway vs direct API

---

## Implementation Challenges

### 1. Authentication Complexity

**Retail (Client Portal Gateway):**
- Requires Java runtime
- Local gateway process must run
- Gateway must be accessible
- **User Experience:** Poor for automated trading

**Institutional (OAuth 2.0):**
- JWT signing required
- Public/private key management
- OAuth flow implementation
- **User Experience:** Complex but manageable

### 2. Instrument Discovery

- Must lookup conid for every symbol
- Multi-step process for options
- Cache management required
- Handle multiple conids per symbol

### 3. Session Management

- Two-tier session system
- Session conflicts with other platforms
- Session expiration handling
- Brokerage session required for trading

### 4. Order Reply Messages

- Some orders require confirmation
- Adds latency
- Must implement suppression
- Handle various message types

### 5. Rate Limiting

- Strict per-endpoint limits
- Penalty box risk
- Request queuing required
- Different limits for different access methods

---

## User Experience Assessment

### Retail Users (Client Portal Gateway)

**Initial Setup:**
1. Install Java runtime
2. Download Client Portal Gateway
3. Run gateway process
4. Configure gateway settings
5. Enter IBKR username/password

**Daily Usage:**
- Gateway must be running
- Gateway must be accessible
- Limited to 10 req/s

**Rating:** ⭐⭐ (2/5) - **Poor**
- Complex setup
- Requires local process
- Not suitable for automated trading
- Better for manual/occasional use

### Institutional Users (OAuth 2.0)

**Initial Setup:**
1. Contact IBKR API Solutions
2. Register application (weeks)
3. Provide public keys
4. Implement JWT signing
5. Configure OAuth flow

**Daily Usage:**
- Automatic token management
- 50 req/s limit
- No local process required

**Rating:** ⭐⭐⭐ (3/5) - **Moderate**
- Complex initial setup
- Better for automated trading
- No local dependencies
- Suitable for enterprise

---

## Recommendation

### For SignalStudio Integration

**Option 1: Support Retail (Client Portal Gateway)**
- ⚠️ **Not Recommended** - Too complex for end users
- Requires Java runtime
- Requires local gateway process
- Poor user experience
- Limited rate limits

**Option 2: Support Institutional Only (OAuth 2.0)**
- ✅ **Recommended** - Better for automated trading
- No local dependencies
- Higher rate limits
- Better user experience
- Requires OAuth implementation

**Option 3: Skip IBKR for Now**
- ⚠️ **Consider** - Very complex integration
- High implementation cost
- Complex user experience
- Many edge cases
- Better to focus on simpler exchanges first

---

## Testing

### Test Scenarios

1. **Authentication:**
   - OAuth 2.0 flow (institutional)
   - Client Portal Gateway (retail)
   - Session establishment
   - Session expiration handling

2. **Instrument Discovery:**
   - Equity conid lookup
   - Options conid lookup
   - Futures conid lookup
   - Conid caching

3. **Order Placement:**
   - Market orders
   - Limit orders
   - Stop orders
   - Bracket orders
   - Combo orders
   - Order reply message handling

4. **Portfolio:**
   - Account listing
   - Balance retrieval
   - Position retrieval
   - Account summary

5. **Market Data:**
   - Snapshot requests
   - Pre-flight requests
   - WebSocket streaming

---

## References

- IBKR Web API Documentation
- RFC 7521: Assertion Framework for OAuth 2.0
- RFC 7523: JSON Web Token (JWT) Profile for OAuth 2.0
- Client Portal Gateway Documentation

---

## Implementation Checklist

- [ ] Decide on authentication method (retail vs institutional)
- [ ] Implement OAuth 2.0 private_key_jwt (if institutional)
- [ ] Implement Client Portal Gateway integration (if retail)
- [ ] Implement instrument discovery (conid lookup)
- [ ] Implement conid caching
- [ ] Implement two-tier session management
- [ ] Implement order placement
- [ ] Implement order reply message handling
- [ ] Implement order suppression
- [ ] Implement bracket orders
- [ ] Implement combo orders
- [ ] Implement portfolio endpoints
- [ ] Implement market data endpoints
- [ ] Implement rate limiting/throttling
- [ ] Add to ExchangeFactory.js
- [ ] Add to TradeExecutor.js
- [ ] Create SignalStudio balance endpoint
- [ ] Add to exchangeMetadata.ts
- [ ] Update EXCHANGES.md
- [ ] Test authentication flow
- [ ] Test instrument discovery
- [ ] Test order placement
- [ ] Test session management
- [ ] Test rate limiting

---

## Conclusion

Interactive Brokers is a **very complex** integration due to:

1. **Authentication Complexity:** OAuth 2.0 with JWT signing or Client Portal Gateway
2. **Instrument Discovery:** Must lookup conid for every symbol
3. **Session Management:** Two-tier session system
4. **Order Reply Messages:** Some orders require confirmation
5. **Rate Limiting:** Strict per-endpoint limits

**Recommendation:** 
- **For Retail:** Not recommended - Client Portal Gateway is too complex
- **For Institutional:** Moderate complexity - OAuth 2.0 is manageable
- **Overall:** Consider skipping or deferring until simpler exchanges are complete

**User Experience Rating:** ⭐⭐ (2/5) for retail, ⭐⭐⭐ (3/5) for institutional
