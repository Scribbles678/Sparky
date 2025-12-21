# Lime Trading API Implementation Guide

## Overview

Lime Trading is a low-latency DMA (Direct Market Access) broker focused on US equities and options. The API is REST-based with OAuth 2.0 authentication and optional WebSocket streaming for real-time data.

**Complexity Assessment:** 🟡 **MEDIUM** (Not Complex)

**Why Medium, Not Complex:**
- ✅ REST API (standard HTTP/JSON)
- ✅ OAuth 2.0 (standard protocol)
- ✅ No proprietary protocols (no FIX required)
- ✅ No external software required
- ⚠️ OAuth 2.0 token management (more complex than API key)
- ⚠️ Account number format requirements
- ⚠️ Multi-leg order support (options strategies)

**Why Not Easy:**
- OAuth 2.0 flow requires token management
- Token expiration handling (3 AM ET for password flow, 24 hours for code flow)
- Account number format: `{number}@vision` (specific format)
- WebSocket streaming (optional but adds complexity)

## Authentication

Lime uses **OAuth 2.0** with two authorization flows. **We recommend Password Flow** for SignalStudio (see UX analysis below).

**Credential Storage in SignalStudio:**
- `api_key` → Client ID (from Lime portal)
- `api_secret` → Client Secret (from Lime portal)
- `extra_metadata.username` → Lime account username
- `extra_metadata.password` → Lime account password (encrypted)
- `extra_metadata.accountNumber` → Account number (optional, auto-detected)

### Password Flow (Recommended for SignalStudio) ⭐

**Best for:** Users trading directly on their own account

**User Experience:** ⭐⭐⭐⭐ (4/5) - Simple setup, automatic token refresh

**Flow:**
1. User registers application at https://myaccount.lime.co to get `client_id` and `client_secret` (one-time)
2. User enters credentials in SignalStudio (client_id, client_secret, username, password)
3. System exchanges username/password for access token (automatic)
4. Token expires at **3:00 AM ET** daily (not prolonged with usage)
5. System automatically refreshes token before expiration (user never sees this)
6. Use token in `Authorization: Bearer {token}` header

**UX Benefits:**
- ✅ Simple credential entry (similar to Capital.com)
- ✅ Automatic token refresh (user never sees it)
- ✅ Predictable expiration (3 AM ET)
- ✅ No browser redirects needed
- ⚠️ Password stored (encrypted) - standard practice for automated trading

**See:** [`LIME_OAUTH_UX_ANALYSIS.md`](LIME_OAUTH_UX_ANALYSIS.md) for detailed UX comparison

**Request:**
```http
POST https://auth.lime.co/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id={client_id}&client_secret={client_secret}&username={username}&password={password}
```

**Response:**
```json
{
  "scope": "email profile",
  "token_type": "Bearer",
  "access_token": "MjAwOTg1OWUtZTUwMy00YzY4LWEyZWQtODU0N2NkZTJiNDdlfDIwMTcxMDA3MTkyNDQzfHRlc3R8U2VyZ2V5fE1pbmtvdg==",
  "expires_in": 28800
}
```

**Token Expiration:**
- Expires at **3:00 AM ET** daily
- Not prolonged with usage
- Must refresh token before 3 AM ET

### Authorization Code Flow (Alternative - Not Recommended for SignalStudio)

**Best for:** Third-party applications where password should never be stored

**User Experience:** ⭐⭐⭐ (3/5) - More complex setup, but better security

**Flow:**
1. We register SignalStudio as OAuth app with Lime (one-time, admin)
2. User clicks "Connect Lime Account" in SignalStudio
3. User redirected to Lime authorization page (browser)
4. User logs in and authorizes on Lime site
5. User redirected back to SignalStudio with authorization code
6. System exchanges code for access token (automatic)
7. Token valid for **24 hours** and auto-extended with each API call

**UX Trade-offs:**
- ⚠️ More complex initial setup (browser redirect)
- ✅ Better security (password never stored)
- ✅ Token auto-extends with usage (better ongoing experience)
- ✅ User can revoke access in Lime portal

**Use if:** Lime requires it for third-party apps, or security policy requires password never be stored.

**See:** [`LIME_OAUTH_UX_ANALYSIS.md`](LIME_OAUTH_UX_ANALYSIS.md) for detailed UX comparison

**Step 1: Authorize**
```http
GET https://auth.lime.co/connect/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}
```

**Step 2: Exchange Code for Token**
```http
POST https://auth.lime.co/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={code}&client_id={client_id}&client_secret={client_secret}&redirect_uri={redirect_uri}
```

**Token Expiration:**
- Valid for 24 hours
- Auto-extended with each API call
- Authorization code expires in 5 minutes (must exchange immediately)

## API Base URLs

- **API Base:** `https://api.lime.co`
- **Auth Base:** `https://auth.lime.co`
- **WebSocket:** `wss://api.lime.co/accounts`

## Account Number Format

Lime uses a specific account number format: `{number}@vision`

**Example:** `12345678@vision`

**Important:** Account numbers must include the `@vision` suffix in all API calls.

## Account Endpoints

### Get Account Balances

**Endpoint:** `GET /accounts`

**Rate Limit:** Not specified (use reasonable limits)

**Response:**
```json
[
  {
    "account_number": "12345678@vision",
    "trade_platform": "ETNA",
    "margin_type": "marginx2",
    "restriction": "none",
    "daytrades_count": 0,
    "account_value_total": 9880.6806,
    "cash": 5283.44,
    "day_trading_buying_power": 0,
    "margin_buying_power": 15243,
    "non_margin_buying_power": 7621.5,
    "position_market_value": 4597.2406,
    "unsettled_cash": 0,
    "cash_to_withdraw": 7621.5
  }
]
```

**Implementation:**
```javascript
async getBalance() {
  const accounts = await this.makeRequest('GET', '/accounts');
  
  // Return first account or allow account selection
  const account = accounts[0];
  
  return [{
    asset: 'USD',
    availableBalance: parseFloat(account.cash || 0),
    balance: parseFloat(account.account_value_total || 0),
  }];
}
```

**Account Fields:**
- `account_number`: Account identifier (format: `{number}@vision`)
- `margin_type`: `cash`, `marginx1`, `marginx2`, `daytrader`
- `restriction`: `none`, `restricted`, `disabled`, `closed`
- `cash`: Account balance (negative = debit, positive = credit)
- `margin_buying_power`: Buying power for marginable securities
- `non_margin_buying_power`: Buying power for non-marginable securities

## Position Endpoints

### Get Account Positions

**Endpoint:** `GET /accounts/{account_number}/positions`

**Query Parameters:**
- `date` (optional): Date in `yyyy-MM-dd` format. If set, returns positions for that date. If not, returns current intraday positions.
- `strategy` (optional): If `true`, returns positions grouped by multi-leg strategies. Doesn't work with `date` parameter.

**Response:**
```json
[
  {
    "symbol": "AAPL",
    "average_open_price": 176.8450,
    "current_price": 187.0050,
    "quantity": 2,
    "security_type": "common_stock"
  },
  {
    "symbol": "NLY Credit Put Spread 1",
    "average_open_price": 0,
    "current_price": -0.1136,
    "quantity": -2,
    "security_type": "strategy",
    "legs": [
      {
        "symbol": "NLY   231215P00016000",
        "average_open_price": 0.2450,
        "current_price": 0.1856,
        "quantity": -2,
        "security_type": "option"
      }
    ]
  }
]
```

**Implementation:**
```javascript
async getPositions() {
  const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
  const positions = await this.makeRequest('GET', `/accounts/${accountNumber}/positions`);
  
  return positions.map(pos => ({
    symbol: pos.symbol,
    positionAmt: pos.quantity.toString(),
    entryPrice: parseFloat(pos.average_open_price || 0),
    markPrice: parseFloat(pos.current_price || 0),
    unRealizedProfit: (parseFloat(pos.current_price || 0) - parseFloat(pos.average_open_price || 0)) * parseFloat(pos.quantity || 0),
  }));
}
```

**Security Types:**
- `common_stock`: Regular stocks
- `preferred_stock`: Preferred shares
- `option`: Options contracts
- `strategy`: Multi-leg options strategies

## Order Endpoints

### Place Order

**Endpoint:** `POST /orders/place`

**Request Body (Single Order):**
```json
{
  "account_number": "12345678@vision",
  "symbol": "BAC",
  "quantity": 1,
  "price": 20.0,
  "time_in_force": "day",
  "order_type": "limit",
  "side": "buy",
  "exchange": "auto",
  "client_order_id": "01HWYX297HG2J9V607VSY4GQ3S",
  "tag": "order #12"
}
```

**Request Body (Multi-Leg Order):**
```json
{
  "account_number": "12345678@vision",
  "symbol": "BAC",
  "quantity": 2,
  "price": 20,
  "time_in_force": "day",
  "order_type": "limit",
  "side": "buy",
  "exchange": "auto",
  "client_order_id": "01JA8H7SQ6HYCPYQPNSGWB8NWH",
  "tag": "BAC debit call spread #1",
  "legs": [
    {
      "symbol": "BAC   250117C00032000",
      "quantity": 1,
      "side": "buy"
    },
    {
      "symbol": "BAC   250117C00035000",
      "quantity": 1,
      "side": "sell"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": "201710041710516537"
}
```

**Order Parameters:**
- `account_number`: Required. Format: `{number}@vision`
- `symbol`: Required. Stock symbol (CQS convention) or option symbol (OCC convention)
- `quantity`: Required. Positive integer
- `price`: Required for limit orders. Positive decimal
- `time_in_force`: Optional, default `day`. Values: `day`, `ext`, `on-open`, `on-close`, `ioc`, `fok`
- `order_type`: Optional, default `market`. Values: `market`, `limit`
- `side`: Optional, default `buy`. Values: `buy`, `sell`
- `exchange`: Optional, default `auto`. Use `/accounts/{account}/routes` to get available routes
- `client_order_id`: Optional. Unique identifier (max 32 chars) for idempotency
- `tag`: Optional. Order comment (max 32 chars)
- `legs`: Required for multi-leg orders. Array of leg objects

**Implementation:**
```javascript
async placeMarketOrder(symbol, side, quantity) {
  const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
  const clientOrderId = this.generateClientOrderId();
  
  const orderData = {
    account_number: accountNumber,
    symbol: symbol,
    quantity: Math.abs(quantity),
    order_type: 'market',
    side: side.toLowerCase(),
    exchange: 'auto',
    client_order_id: clientOrderId,
  };
  
  const response = await this.makeRequest('POST', '/orders/place', orderData);
  
  return {
    orderId: response.data,
    clientOrderId: clientOrderId,
    status: 'pending',
  };
}

async placeLimitOrder(symbol, side, quantity, price) {
  const accountNumber = this.accountNumber || await this.getDefaultAccountNumber();
  const clientOrderId = this.generateClientOrderId();
  
  const orderData = {
    account_number: accountNumber,
    symbol: symbol,
    quantity: Math.abs(quantity),
    price: parseFloat(price),
    order_type: 'limit',
    side: side.toLowerCase(),
    exchange: 'auto',
    client_order_id: clientOrderId,
  };
  
  const response = await this.makeRequest('POST', '/orders/place', orderData);
  
  return {
    orderId: response.data,
    clientOrderId: clientOrderId,
    status: 'pending',
  };
}
```

### Validate Order

**Endpoint:** `POST /orders/validate`

**Request:** Same as Place Order

**Response:**
```json
{
  "is_valid": false,
  "validation_message": "You cannot sell more shares than your effective long position..."
}
```

**Use Case:** Validate order before placing to check for errors without submitting to market.

### Get Order Details

**Endpoint:** `GET /orders?client_order_id={client_order_id}`

**Response:**
```json
{
  "account_number": "12345678@vision",
  "client_id": "20171003209384646",
  "client_order_id": "01HWYX297HG2J9V607VSY4GQ3S",
  "exchange": "Zero Commission",
  "quantity": 1,
  "executed_quantity": 0,
  "order_status": "new",
  "price": 20,
  "stop_price": 0,
  "time_in_force": "day",
  "order_type": "limit",
  "order_side": "buy",
  "symbol": "BAC",
  "tag": "order #12"
}
```

**Order Status Values:**
- `pending_new`: Order being processed
- `new`: Order accepted, not yet filled
- `partially_filled`: Partially executed
- `filled`: Fully executed
- `replaced`: Order was replaced
- `done_for_day`: Order expired for the day
- `pending_cancel`: Cancellation in progress
- `canceled`: Order canceled
- `rejected`: Order rejected
- `suspended`: Order suspended

### Get Active Orders

**Endpoint:** `GET /accounts/{account_number}/activeorders`

**Response:** Array of order objects (same structure as Get Order Details)

### Cancel Order

**Endpoint:** `POST /orders/{order_id}/cancel`

**Request Body:**
```json
{
  "message": "User requested cancellation"
}
```

**Response:**
```json
{
  "success": true,
  "data": "201710041710516537"
}
```

## Market Data Endpoints

### Get Current Quote

**Endpoint:** `GET /marketdata/quote?symbol={symbol}`

**Response:**
```json
{
  "symbol": "AAPL",
  "ask": 187.01,
  "ask_size": 38,
  "bid": 186.99,
  "bid_size": 1710,
  "last": 187.00,
  "last_size": 30,
  "volume": 1250000,
  "date": 1682524358,
  "high": 187.50,
  "low": 186.20,
  "open": 186.80,
  "close": 186.50,
  "week52_high": 198.00,
  "week52_low": 124.00,
  "change": 0.50,
  "change_pc": 0.27,
  "open_interest": 0,
  "implied_volatility": 0,
  "theoretical_price": 0,
  "delta": 0,
  "gamma": 0,
  "theta": 0,
  "vega": 0,
  "rho": 0
}
```

**Note:** For options, additional fields are populated (open_interest, implied_volatility, greeks).

**OPRA Data Subscription:**
- If you have OPRA data subscription, must activate API token daily in Cabinet
- OPRA data available for one trading session
- Must reactivate token each day

### Get Multiple Quotes

**Endpoint:** `POST /marketdata/quotes`

**Request Body:** `["GOOG", "AAPL", "MSFT"]`

**Response:** Array of quote objects

### Get Historical Quotes

**Endpoint:** `GET /marketdata/history?symbol={symbol}&period={period}&from={from}&to={to}`

**Parameters:**
- `symbol`: Required. Stock (CMS convention) or option (OCC convention)
- `period`: Required. Values: `minute`, `minute_5`, `minute_15`, `minute_30`, `hour`, `day`, `week`, `month`, `quarter`, `year`
- `from`: Required. Unix timestamp (start)
- `to`: Required. Unix timestamp (end)

**Valid Time Ranges:**
- `minute`: 1 week
- `minute_5`, `minute_15`, `minute_30`, `hour`: 1 month
- `day`: 1 year
- `week`, `month`, `quarter`, `year`: 5 years

**Response:**
```json
[
  {
    "timestamp": 1483074000,
    "period": "day",
    "open": 116.65,
    "high": 117.2,
    "low": 115.43,
    "close": 115.82,
    "volume": 24541183
  }
]
```

### Get Trading Schedule

**Endpoint:** `GET /marketdata/schedule`

**Response:**
```json
{
  "session": "regular_market"
}
```

**Session Values:**
- `pre_market`: Pre-market hours
- `regular_market`: Regular trading hours
- `after_market`: After-hours
- `closed`: Market closed

## WebSocket Streaming (Optional)

**WebSocket URL:** `wss://api.lime.co/accounts`

**Authentication:** Include `Authorization: Bearer {token}` in connection headers

**Commands:**
```json
{ "action": "subscribeBalance", "account": "12345678@vision" }
{ "action": "subscribePositions", "account": "12345678@vision" }
{ "action": "subscribeOrders", "account": "12345678@vision" }
{ "action": "subscribeTrades", "account": "12345678@vision" }
```

**Unsubscribe:**
```json
{ "action": "unsubscribeBalance", "account": "12345678@vision" }
```

**Message Types:**
- `t: "p"`: Position updates
- `t: "b"`: Balance updates
- `t: "o"`: Order updates
- `t: "t"`: Trade updates
- `t: "e"`: Error messages

**Note:** WebSocket is optional. REST API is sufficient for most use cases.

## Symbol Formats

### CQS Convention (Stocks/ETFs)

Lime uses CQS (Consolidated Quote System) convention for stocks and ETFs.

**Examples:**
- `AAPL`: Apple Inc.
- `BRK.B`: Berkshire Hathaway Class B
- `BAC.WS.A`: Bank of America Warrant Class A

**Common Suffixes:**
- `.A`, `.B`, etc.: Class designations
- `.WS`: Warrants
- `.p`: Preferred stock
- `.r`: Rights
- `.U`: Units

### OCC Convention (Options)

Lime uses OCC (Options Clearing Corporation) convention for options.

**Format:** `{ROOT} {EXPIRATION}{TYPE}{STRIKE}`

**Example:** `AAPL 171103C00155000`
- Root: `AAPL` (padded to 6 chars)
- Expiration: `171103` (Nov 3, 2017)
- Type: `C` (Call) or `P` (Put)
- Strike: `00155000` ($155.00 × 1000, padded to 8 digits)

## Account Routes

### Get Available Routes

**Endpoint:** `GET /accounts/{account_number}/routes`

**Response:**
```json
[
  {
    "exchange": "Zero Commission",
    "time_in_force": ["day"],
    "order_type": ["market", "limit"]
  },
  {
    "exchange": "Extended hours",
    "time_in_force": ["ext"],
    "order_type": ["limit"]
  },
  {
    "exchange": "XNAS - Nasdaq",
    "time_in_force": ["day", "ext"],
    "order_type": ["market", "limit"]
  }
]
```

**Use Case:** Determine which exchanges/routes are available for an account and which order types/time_in_force values are supported.

## Fee Estimation

### Estimate Fees

**Endpoint:** `POST /pricing/fees`

**Request:**
```json
{
  "account_number": "12345678@vision",
  "symbol": "TSLA",
  "quantity": 50,
  "side": "sell",
  "price": 230
}
```

**Response:**
```json
[
  {
    "amount": 0.03,
    "type": "ORF"
  },
  {
    "amount": 0.06,
    "type": "OCC"
  },
  {
    "amount": 0.45,
    "type": "PerShare"
  },
  {
    "amount": 0.03,
    "type": "SEC"
  }
]
```

## Error Handling

### HTTP Status Codes

- `200 OK`: Request successful
- `400 BAD REQUEST`: Request formatting issues or validation errors
- `401 UNAUTHORIZED`: Invalid or expired access token
- `404 NOT FOUND`: Resource not found
- `500 SERVER ERROR`: Internal server error

### Error Response Format

```json
{
  "code": "validation_error",
  "message": "Order validation failed: insufficient buying power"
}
```

**Error Codes:**
- `not_found`: Resource not found
- `validation_error`: Request validation failed
- `api_error`: API-level error

### Token Expiration Handling

**Password Flow:**
- Token expires at 3:00 AM ET daily
- Must refresh token before expiration
- Implement token refresh logic that checks time and refreshes proactively

**Authorization Code Flow:**
- Token valid for 24 hours
- Auto-extended with each API call
- Still need to handle expiration gracefully

**Implementation:**
```javascript
async ensureValidToken() {
  // For password flow: Check if token expires soon (before 3 AM ET)
  // For code flow: Token auto-extends, but handle 401 errors
  
  if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt - 60000) {
    await this.refreshToken();
  }
}

async makeRequest(method, endpoint, data = null, retryCount = 0) {
  await this.ensureValidToken();
  
  // ... make request
  
  // If 401, refresh token and retry once
  if (error.response?.status === 401 && retryCount === 0) {
    await this.refreshToken();
    return this.makeRequest(method, endpoint, data, retryCount + 1);
  }
}
```

## Rate Limiting

**Note:** Lime API rate limits are not explicitly documented. Best practices:

- Implement reasonable rate limiting (e.g., 200 requests/minute)
- Respect 429 (Too Many Requests) responses with exponential backoff
- Use connection pooling for better performance
- Cache account routes and other static data

## Webhook Integration Examples

### Basic Market Order

```json
{
  "secret": "your-secret",
  "exchange": "lime",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Limit Order

```json
{
  "secret": "your-secret",
  "exchange": "lime",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Options Order (Multi-Leg)

```json
{
  "secret": "your-secret",
  "exchange": "lime",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 5.00,
  "legs": [
    {
      "symbol": "AAPL   250117C00150000",
      "quantity": 1,
      "side": "buy"
    },
    {
      "symbol": "AAPL   250117C00160000",
      "quantity": 1,
      "side": "sell"
    }
  ]
}
```

## Special Considerations

### Account Number Format

**Critical:** Account numbers must be in format `{number}@vision`

- Example: `12345678@vision`
- Must include `@vision` suffix
- Account number obtained from `/accounts` endpoint

### Token Management

**Password Flow:**
- Token expires at 3:00 AM ET daily
- Not prolonged with usage
- Must implement proactive refresh (refresh before 3 AM ET)
- Store token expiration time and check before each request

**Authorization Code Flow:**
- Token valid for 24 hours
- Auto-extended with each API call
- Still handle 401 errors gracefully

### Multi-Account Support

- Users can have multiple accounts
- `/accounts` endpoint returns array of all accounts
- Need to select default account or allow user selection
- Store selected account number in credentials or config

### Order Validation

- Use `/orders/validate` endpoint before placing orders
- Helps catch errors without submitting to market
- Returns validation message if order cannot be placed

### Exchange Routing

- Use `/accounts/{account}/routes` to get available exchanges
- Different accounts may have different route availability
- `exchange: "auto"` lets Lime choose best route
- Can specify specific exchange (e.g., `"XNAS - Nasdaq"`)

### Multi-Leg Orders

- Support for options strategies (spreads, straddles, etc.)
- Use `legs` array in order request
- Each leg has `symbol`, `quantity`, and `side`
- Total leg quantity = leg ratio × order quantity

### Symbol Conventions

- **Stocks:** CQS convention (e.g., `AAPL`, `BRK.B`)
- **Options:** OCC convention (e.g., `AAPL 171103C00155000`)
- Use `/securities` endpoint to search/lookup symbols
- Use `/securities/{symbol}/options/series` for option series
- Use `/securities/{symbol}/options?expiration={date}` for option chains

### OPRA Market Data

- If user has OPRA subscription, must activate API token daily
- Activation done in Cabinet under My Profile → API Keys
- OPRA data available for one trading session
- Must reactivate each day

## Testing

### Sandbox/Test Environment

**Note:** Lime documentation doesn't explicitly mention sandbox environment. Contact Lime support for test account access.

### Test Checklist

- [ ] OAuth 2.0 token generation (password flow)
- [ ] Token refresh before 3 AM ET expiration
- [ ] Account balance retrieval
- [ ] Position retrieval
- [ ] Market order placement
- [ ] Limit order placement
- [ ] Order validation
- [ ] Order cancellation
- [ ] Order status checking
- [ ] Multi-leg order placement (if needed)
- [ ] Market data retrieval
- [ ] Error handling (401, 400, 404, 500)
- [ ] Multi-account support (if user has multiple accounts)

## References

- [Lime Trading Portal](https://myaccount.lime.co)
- [Lime Trading Website](https://lime.co)

## Complexity Re-Assessment

**Original Classification:** 🟠 Complex (1-2 months)

**Revised Classification:** 🟡 Medium (2-3 weeks)

**Reasoning:**
1. ✅ REST API (standard HTTP/JSON) - Not complex
2. ✅ OAuth 2.0 (standard protocol) - Well-understood
3. ✅ No proprietary protocols - No FIX required
4. ✅ No external software - No TWS/Gateway needed
5. ⚠️ Token management adds some complexity
6. ⚠️ Account format requirements
7. ⚠️ Multi-leg order support (optional feature)

**Conclusion:** Lime API is **Medium complexity**, not Complex. The API is clean, REST-based, and follows standard patterns. The "complexity" comes from OAuth 2.0 token management and account format requirements, which are manageable with proper implementation.
