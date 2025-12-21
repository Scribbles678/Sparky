# TradeStation API Implementation Guide

## Overview

TradeStation is a professional trading platform offering stocks, options, and futures trading. The API is REST-based with OAuth 2.0 Authorization Code Flow authentication, HTTP streaming for real-time data, and comprehensive order management.

**Complexity Assessment:** 🟡 **MEDIUM**

**Why Medium:**
- ✅ REST API (standard HTTP/JSON)
- ✅ OAuth 2.0 Authorization Code Flow (standard protocol)
- ✅ No proprietary protocols
- ✅ No external software required
- ⚠️ OAuth 2.0 redirect-based flow (requires browser interaction)
- ⚠️ Access tokens expire in 20 minutes (requires refresh token logic)
- ⚠️ Two-step order process (Confirm → Place, optional but recommended)
- ⚠️ Account ID required for all operations
- ⚠️ HTTP Streaming for real-time data (optional, can use REST polling)

**Why Not Easy:**
- OAuth 2.0 Authorization Code Flow requires browser redirect (more complex than API key)
- Token management (20-minute expiration, refresh token handling)
- Order confirmation step adds complexity
- Account ID must be fetched first

## Authentication

TradeStation uses **OAuth 2.0 Authorization Code Flow** (standard OAuth 2.0 with optional PKCE for public clients).

**Base URLs:**
- **Live:** `https://api.tradestation.com/v3`
- **SIM (Paper Trading):** `https://sim-api.tradestation.com/v3`
- **Auth Server:** `https://signin.tradestation.com`

**SignalStudio OAuth Configuration:**

**Step 1: Register Application with TradeStation (One-Time, Admin)**
1. Contact TradeStation Client Experience to register SignalStudio as an OAuth application
2. Receive `client_id` (API Key) and `client_secret`
3. Configure callback URLs: `https://yourdomain.com/api/auth/tradestation/callback`
4. Configure scopes: `openid profile offline_access MarketData ReadAccount Trade OptionSpreads Matrix`
5. Add OAuth credentials to SignalStudio runtime config (see below)

**Step 2: Configure SignalStudio Runtime Config**

Add to `nuxt.config.ts` or `.env`:
```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    // Private (server-side only)
    tradestationClientSecret: process.env.TRADESTATION_CLIENT_SECRET,
    
    // Public (can be exposed to client)
    public: {
      tradestationClientId: process.env.TRADESTATION_CLIENT_ID,
    }
  }
})
```

Or in `.env`:
```
TRADESTATION_CLIENT_ID=your_client_id
TRADESTATION_CLIENT_SECRET=your_client_secret
```

**Step 3: User Authorization Flow**

1. User clicks "Connect TradeStation Account" in SignalStudio
2. User redirected to `/api/auth/tradestation/authorize`
3. System redirects to TradeStation authorization page
4. User logs in and authorizes
5. TradeStation redirects to `/api/auth/tradestation/callback`
6. System exchanges code for tokens and stores in database

**Credential Storage in SignalStudio:**
- `api_key` → Client ID (from TradeStation API Key)
- `api_secret` → Client Secret (from TradeStation API Key)
- `extra_metadata.refreshToken` → Refresh Token (stored after initial authorization)
- `extra_metadata.accessToken` → Access Token (optional, cached)
- `extra_metadata.accountId` → Account ID (optional, auto-detected)
- `extra_metadata.environment` → `production` or `sim` (default: `production`)

### OAuth 2.0 Authorization Code Flow

**User Experience:** ⚠️ **Moderate** - Requires browser redirect for initial authorization

#### Initial Setup (One-Time Per User)

**Step 1: Application Registration (One-Time, Admin)**
- Register SignalStudio as an OAuth application with TradeStation Client Experience
- Receive `client_id` (API Key) and `client_secret`
- Configure callback URLs: `https://signalstudio.com/auth/tradestation/callback`
- Configure scopes: `openid profile offline_access MarketData ReadAccount Trade OptionSpreads Matrix`
- **Note:** Default API Keys are configured for localhost development (http://localhost, http://localhost:3000, etc.)

**Step 2: User Authorization (Per User)**
- User navigates to Account → Exchanges in SignalStudio
- Selects "TradeStation"
- Clicks "Connect TradeStation Account" button
- **User is redirected to TradeStation login page:**
  ```
  https://signin.tradestation.com/authorize?
    response_type=code&
    client_id={client_id}&
    redirect_uri={callback_url}&
    audience=https://api.tradestation.com&
    state={random_state}&
    scope=openid profile offline_access MarketData ReadAccount Trade OptionSpreads Matrix
  ```
- User logs in with TradeStation credentials
- User sees authorization consent dialog
- User clicks "Authorize"
- **User is redirected back to SignalStudio:**
  ```
  https://signalstudio.com/auth/tradestation/callback?code={authorization_code}&state={state}
  ```
- SignalStudio exchanges authorization code for access token and refresh token (behind the scenes)
- Tokens stored securely (encrypted in database)
- Account ID auto-detected from `/v3/brokerage/accounts` endpoint
- **User Experience:** ⚠️ **2-3 clicks, browser redirect** - More steps than API key entry

**Step 3: Account Selection (If Multiple Accounts)**
- System fetches user's accounts from `/v3/brokerage/accounts`
- If multiple accounts, user selects default account
- Account ID stored in `extra_metadata.accountId`

#### Daily Usage Experience

**Token Refresh (Automatic - User Doesn't See This)**
- Access tokens expire after **20 minutes**
- System checks token expiration before each API call
- If token expires within 5 minutes, system automatically refreshes using refresh token
- Refresh happens in background (user doesn't notice)
- **User Experience:** Seamless - no interruption

**Refresh Token Behavior:**
- **Default:** Non-expiring refresh tokens (valid indefinitely)
- **Optional:** Can be configured to expire and rotate every 30 minutes (contact Client Experience)
- If rotating refresh tokens enabled: 24-hour absolute lifetime (requires re-auth every 24 hours)

**If Token Expires (Edge Case)**
- If system tries to use expired token:
  - API returns 401 Unauthorized
  - System automatically refreshes token using refresh token
  - Retries request
  - **User Experience:** Slight delay (1-2 seconds), but automatic recovery

**Token Refresh Process:**
```
1. System detects token expires soon (within 5 minutes)
2. System calls: POST /oauth/token with refresh_token grant
3. New access token received (and new refresh token if rotating)
4. Tokens stored securely
5. API calls continue normally
```

**User Experience:** ✅ **Good** - Fully automatic after initial setup

#### Ongoing Maintenance

**Re-authorization:**
- If refresh token is revoked or expires (if rotating enabled):
  - System gets 401 error on refresh
  - User must re-authorize via browser redirect
  - **User Experience:** ⚠️ Occasional re-auth needed (only if refresh token expires/revoked)

**Account Access:**
- User can revoke access in TradeStation portal
- System will get 401 errors
- User must re-authorize
- **User Experience:** ⚠️ Occasional re-auth needed

### Authorization Code Flow with PKCE (Optional)

**For:** Public clients (SPA, Native apps)

**User Experience:** Similar to standard Authorization Code Flow, but with additional security

**Differences:**
- Requires `code_challenge` and `code_challenge_method` in authorization request
- Requires `code_verifier` in token exchange (instead of `client_secret`)
- More secure for public clients (client_secret not required)

**Implementation:**
- Generate random `code_verifier` (43-128 characters)
- Hash with SHA-256 to create `code_challenge`
- Send `code_challenge` in authorization request
- Send `code_verifier` in token exchange

**Note:** Not required for confidential clients (server-side applications like SignalStudio)

### Token Endpoints

**Authorization Endpoint:**
```
GET https://signin.tradestation.com/authorize
```

**Token Endpoint:**
```
POST https://signin.tradestation.com/oauth/token
Content-Type: application/x-www-form-urlencoded
```

**Token Exchange Request:**
```
grant_type=authorization_code
client_id={client_id}
client_secret={client_secret}
code={authorization_code}
redirect_uri={callback_url}
```

**Token Exchange Response:**
```json
{
  "access_token": "eGlhc2xv...MHJMaA",
  "refresh_token": "eGlhc2xv...wGVFPQ",
  "id_token": "vozT2Ix...wGVFPQ",
  "token_type": "Bearer",
  "scope": "openid profile MarketData ReadAccount Trade offline_access",
  "expires_in": 1200
}
```

**Refresh Token Request:**
```
grant_type=refresh_token
client_id={client_id}
client_secret={client_secret}
refresh_token={refresh_token}
```

**Refresh Token Response:**
```json
{
  "access_token": "eGlhc2xv...MHJMaA",
  "expires_in": 1200,
  "scope": "openid offline_access",
  "id_token": "vozT2Ix...wGVFPQ",
  "token_type": "Bearer"
}
```

**Note:** If rotating refresh tokens enabled, new `refresh_token` is also returned in response.

## API Base URLs

**Live Environment:**
- Base URL: `https://api.tradestation.com/v3`
- Use for production trading

**SIM (Paper Trading) Environment:**
- Base URL: `https://sim-api.tradestation.com/v3`
- Use for testing/paper trading
- Identical API structure, but uses simulated accounts with fake money

**Switching Environments:**
- Change base URL based on `environment` config
- Same credentials work for both (user must have access to both)

## Account Management

### Get Accounts

**Endpoint:** `GET /v3/brokerage/accounts`

**Response:**
```json
{
  "Accounts": [
    {
      "AccountID": "123456782",
      "AccountType": "Cash",
      "DayTradingBuyingPower": "0",
      "Equity": "10000.00",
      "LastUpdated": "2020-11-18T15:19:14Z",
      "LongOptionValue": "0",
      "LongStockValue": "0",
      "MarginBuyingPower": "0",
      "ShortOptionValue": "0",
      "ShortStockValue": "0"
    }
  ]
}
```

**Implementation:**
- Auto-detect account ID if not provided
- Use first account if multiple accounts
- Store account ID in credentials for future use

## Market Data

### Get Quote Snapshot

**Endpoint:** `GET /v3/marketdata/quotes/{symbols}`

**Parameters:**
- `symbols`: Comma-separated list (max 100 symbols)

**Response:**
```json
{
  "Quotes": [
    {
      "Symbol": "MSFT",
      "Open": "213.65",
      "PreviousClose": "214.46",
      "Last": "212.85",
      "Ask": "212.87",
      "AskSize": "300",
      "Bid": "212.85",
      "BidSize": "200",
      "NetChange": "-1.61",
      "NetChangePct": "0.035",
      "Volume": "5852511",
      "TradeTime": "2020-11-18T15:19:14Z"
    }
  ]
}
```

### Stream Quotes (HTTP Streaming)

**Endpoint:** `GET /v3/marketdata/stream/quotes/{symbols}`

**Note:** Returns HTTP chunked-encoded stream. See HTTP Streaming section below.

### Get Bars

**Endpoint:** `GET /v3/marketdata/barcharts/{symbol}`

**Parameters:**
- `interval`: Bar interval (default: 1)
- `unit`: `Minute`, `Daily`, `Weekly`, `Monthly` (default: Daily)
- `barsback`: Number of bars back (max 57,600 for intraday)
- `firstdate`: First date (ISO format)
- `lastdate`: Last date (ISO format)
- `sessiontemplate`: `USEQPre`, `USEQPost`, `USEQPreAndPost`, `USEQ24Hour`, `Default`

**Response:**
```json
{
  "Bars": [
    {
      "High": "216.38",
      "Low": "213.65",
      "Open": "214.61",
      "Close": "214.24",
      "TimeStamp": "2020-12-03T21:00:00Z",
      "TotalVolume": "25120922",
      "Epoch": 1607029200000
    }
  ]
}
```

## Order Execution

### Order Confirmation (Recommended)

**Endpoint:** `POST /v3/orderexecution/orderconfirm`

**Purpose:** Get estimated cost and commission before placing order

**Request:**
```json
{
  "AccountID": "123456782",
  "Symbol": "MSFT",
  "Quantity": "10",
  "OrderType": "Market",
  "TradeAction": "BUY",
  "TimeInForce": {
    "Duration": "DAY"
  },
  "Route": "Intelligent",
  "OrderConfirmID": "unique-id-12345"
}
```

**Response:**
```json
{
  "Confirmations": [
    {
      "Route": "Intelligent",
      "Duration": "DAY",
      "Account": "123456782",
      "EstimatedPrice": "212.85",
      "EstimatedCost": "2128.50",
      "EstimatedCommission": "0.00",
      "OrderConfirmId": "unique-id-12345"
    }
  ]
}
```

**Note:** `OrderConfirmID` is optional but recommended for idempotency (1-22 characters, unique per API key, per order, per user).

### Place Order

**Endpoint:** `POST /v3/orderexecution/orders`

**Request:**
```json
{
  "AccountID": "123456782",
  "Symbol": "MSFT",
  "Quantity": "10",
  "OrderType": "Market",
  "TradeAction": "BUY",
  "TimeInForce": {
    "Duration": "DAY"
  },
  "Route": "Intelligent",
  "OrderConfirmID": "unique-id-12345"
}
```

**Order Types:**
- `Market`: Market order
- `Limit`: Limit order (requires `LimitPrice`)
- `StopMarket`: Stop market order (requires `StopPrice`)
- `StopLimit`: Stop limit order (requires `StopPrice` and `LimitPrice`)

**Trade Actions:**
- `BUY`: Buy equities/futures
- `SELL`: Sell equities/futures
- `BUYTOCOVER`: Buy to cover (equities)
- `SELLSHORT`: Sell short (equities)
- `BUYTOOPEN`: Buy to open (options)
- `BUYTOCLOSE`: Buy to close (options)
- `SELLTOOPEN`: Sell to open (options)
- `SELLTOCLOSE`: Sell to close (options)

**Time in Force:**
- `Duration`: `DAY`, `GTC` (Good Till Cancel), `GTD` (Good Till Date)
- `GoodTillDate`: Required if `Duration` is `GTD` (ISO format)

**Response:**
```json
{
  "Orders": [
    {
      "OrderID": "286234131",
      "AccountID": "123456782",
      "Symbol": "MSFT",
      "Quantity": "10",
      "OrderType": "Market",
      "TradeAction": "BUY",
      "Status": "OPN",
      "StatusDescription": "Sent",
      "OpenedDateTime": "2021-02-24T15:47:45Z"
    }
  ],
  "Errors": []
}
```

### Replace Order

**Endpoint:** `PUT /v3/orderexecution/orders/{orderID}`

**Note:** Order ID should not include dashes (e.g., `123456789`, not `1-2345-6789`).

**Request:**
```json
{
  "Quantity": "10",
  "LimitPrice": "132.52"
}
```

**Response:**
```json
{
  "Message": "Cancel/Replace order sent.",
  "OrderID": "123456789"
}
```

### Cancel Order

**Endpoint:** `DELETE /v3/orderexecution/orders/{orderID}`

**Response:**
```json
{
  "Message": "Cancel request sent",
  "OrderID": "123456789"
}
```

### Get Orders

**Endpoint:** `GET /v3/brokerage/accounts/{accounts}/orders`

**Parameters:**
- `accounts`: Comma-separated account IDs (1-25 accounts)
- `pageSize`: Number of orders per page (1-600, default: 600)
- `nextToken`: Pagination token (from previous response)

**Response:**
```json
{
  "Orders": [
    {
      "OrderID": "286234131",
      "AccountID": "123456782",
      "Symbol": "MSFT",
      "Quantity": "10",
      "OrderType": "Market",
      "TradeAction": "BUY",
      "Status": "OPN",
      "StatusDescription": "Sent",
      "OpenedDateTime": "2021-02-24T15:47:45Z"
    }
  ],
  "Errors": [],
  "NextToken": "eyJ0aW1lc3RhbXAiOjE2NT..."
}
```

## Positions

### Get Positions

**Endpoint:** `GET /v3/brokerage/accounts/{accounts}/positions`

**Parameters:**
- `accounts`: Comma-separated account IDs (1-25 accounts)
- `symbol`: Optional filter (comma-separated, supports wildcards like `MSFT *` for all MSFT options)

**Response:**
```json
{
  "Positions": [
    {
      "AccountID": "123456782",
      "Symbol": "MSFT",
      "Quantity": "10",
      "AveragePrice": "216.68",
      "Last": "216.63",
      "MarketValue": "2166.3",
      "UnrealizedProfitLoss": "-0.5",
      "UnrealizedProfitLossPercent": "-0.023"
    }
  ],
  "Errors": []
}
```

## Balances

### Get Balances

**Endpoint:** `GET /v3/brokerage/accounts/{accounts}/balances`

**Parameters:**
- `accounts`: Comma-separated account IDs (1-25 accounts)

**Response:**
```json
{
  "Balances": [
    {
      "AccountID": "123456782",
      "AccountType": "Cash",
      "DayTradingBuyingPower": "0",
      "Equity": "10000.00",
      "CashBalance": "10000.00",
      "LongOptionValue": "0",
      "LongStockValue": "0",
      "MarginBuyingPower": "0",
      "ShortOptionValue": "0",
      "ShortStockValue": "0"
    }
  ],
  "Errors": []
}
```

## HTTP Streaming

TradeStation supports HTTP chunked-encoded streaming for real-time data.

**Content Types:**
- `application/vnd.tradestation.streams.v2+json` (for market data)
- `application/vnd.tradestation.streams.v3+json` (for orders/positions)

**Streaming Resources:**
- Quote changes: `/v3/marketdata/stream/quotes/{symbols}`
- Bars: `/v3/marketdata/stream/barcharts/{symbol}`
- Option chains: `/v3/marketdata/stream/options/chains/{underlying}`
- Orders: `/v3/brokerage/stream/accounts/{accounts}/orders`
- Positions: `/v3/brokerage/stream/accounts/{accounts}/positions`

**Stream Status:**
- `EndSnapshot`: Sent after initial snapshot
- `GoAway`: Sent before stream termination (client must restart)

**Error Handling:**
- Streams can terminate with error messages
- Client must handle `{"Symbol":"AAPL","Error":"DualLogon"}` and restart stream

**Implementation Note:**
- For Sparky Bot, REST polling is sufficient (streaming is optional)
- Streaming can be added later for real-time position/order updates

## Rate Limiting

TradeStation enforces rate limits per resource category on a per-user basis.

**Rate Limit Windows:**
- Fixed 5-minute intervals (not sliding)
- Resets at fixed point in time (from first request)
- If quota exceeded, returns `429 Too Many Requests`

**Rate Limits:**

| Resource Category | Quota | Interval |
|-------------------|-------|----------|
| Accounts | 250 | 5-minute |
| Order Details | 250 | 5-minute |
| Balances | 250 | 5-minute |
| Positions | 250 | 5-minute |
| Quote Change Stream | 500 | 5-minute |
| Barchart Stream | 500 | 5-minute |
| TickBar Stream | 500 | 5-minute |
| Each Option Endpoint | 90 | 1-minute |
| Quote Snapshot | 30 | 1-minute |
| MarketDepth Stream | 30 | 1-minute |
| MarketDepth Stream | 10 | concurrent |
| Option Quote Stream | 10 | concurrent |
| Option Chain Stream | 10 | concurrent |
| Order Stream | 40 | concurrent |
| Positions Stream | 40 | concurrent |

**Recommendation:** Use streaming services when available to reduce rate limit pressure.

## Scopes

**Required Scopes:**
- `openid`: Required (returns `sub` claim in ID token)
- `offline_access`: Required (allows refresh tokens)

**TradeStation API Scopes (Default):**
- `MarketData`: Access to market data endpoints
- `ReadAccount`: Access to account information
- `Trade`: Access to order execution
- `OptionSpreads`: Access to options-related endpoints
- `Matrix`: Access to market depth endpoints

**Optional Scopes:**
- `profile`: Returns profile information in ID token

**Note:** Additional scopes can be requested from TradeStation Client Experience.

## Error Handling

**Common Error Responses:**

**401 Unauthorized:**
- Token expired or invalid
- Refresh token and retry

**429 Too Many Requests:**
- Rate limit exceeded
- Wait for interval to reset
- Implement exponential backoff

**400 Bad Request:**
- Invalid request parameters
- Check request format

**404 Not Found:**
- Resource not found (account, order, etc.)
- Verify resource exists

## Implementation Notes

### Token Management

1. **Store refresh token securely** (encrypted in database)
2. **Cache access token** (with expiration time)
3. **Refresh proactively** (within 5 minutes of expiration)
4. **Handle 401 errors** (auto-refresh and retry)

### Account ID Management

1. **Auto-detect on first use** (fetch from `/v3/brokerage/accounts`)
2. **Store in credentials** (for future use)
3. **Support multiple accounts** (user can specify which account to use)

### Order ConfirmID

1. **Generate unique ID** (1-22 characters)
2. **Must be unique per API key, per order, per user**
3. **Use for idempotency** (prevent duplicate orders)

### Environment Switching

1. **Support SIM and LIVE** (via `environment` config)
2. **Same credentials work for both** (user must have access)
3. **Change base URL** based on environment

### HTTP Streaming (Optional)

1. **REST polling is sufficient** for Sparky Bot
2. **Streaming can be added later** for real-time updates
3. **Handle chunked encoding** properly (JSON objects may span chunks)

## User Experience Analysis

### Initial Setup

**Steps:**
1. Admin registers SignalStudio with TradeStation (one-time)
2. User clicks "Connect TradeStation Account" in SignalStudio
3. User redirected to TradeStation login (browser)
4. User logs in and authorizes
5. User redirected back to SignalStudio
6. System exchanges code for tokens (automatic)
7. System auto-detects account ID (automatic)

**User Experience:** ⚠️ **Moderate** - Requires browser redirect (2-3 clicks)

### Daily Usage

**Token Refresh:**
- Automatic (user never sees it)
- Happens within 5 minutes of expiration
- No user interaction required

**Trading:**
- Standard webhook-based trading
- No additional complexity for users

**User Experience:** ✅ **Good** - Fully automatic after initial setup

### Comparison to Other Exchanges

**vs. Alpaca (API Key):**
- ⚠️ More complex initial setup (OAuth redirect vs. API key entry)
- ✅ Better security (password never stored)
- ✅ User can revoke access independently

**vs. Lime (Password Flow):**
- ⚠️ More complex initial setup (OAuth redirect vs. credential entry)
- ✅ Better security (password never stored)
- ✅ Token auto-extends with refresh (vs. fixed 3 AM ET expiration)

**vs. E*TRADE (OAuth 1.0):**
- ✅ Better UX (standard OAuth 2.0 vs. OAuth 1.0)
- ✅ Non-expiring refresh tokens (vs. daily expiration)
- ✅ No two-step order process requirement

**Overall Rating:** ⭐⭐⭐ (3/5) - Moderate complexity, but manageable with proper implementation

## Recommendations

1. **Implement OAuth 2.0 Authorization Code Flow** (standard flow)
2. **Store refresh tokens securely** (encrypted)
3. **Implement proactive token refresh** (within 5 minutes of expiration)
4. **Auto-detect account ID** (on first use)
5. **Support SIM environment** (for testing)
6. **Use OrderConfirmID** (for idempotency)
7. **Handle rate limiting** (with exponential backoff)
8. **Start with REST polling** (streaming optional, can add later)

## Documentation References

- TradeStation API Documentation: https://api.tradestation.com/docs
- OAuth 2.0 Specification: https://oauth.net/2/
- Auth0 Quickstarts: https://auth0.com/docs/quickstarts
