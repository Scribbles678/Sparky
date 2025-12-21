# Capital.com Exchange Integration

**Status:** 🚧 In Progress  
**Date:** December 2024  
**Exchange:** Capital.com  
**Asset Classes:** CFDs, Stocks, Forex, Crypto, Commodities, Indices

---

## Overview

Capital.com is a CFD and spread betting broker that provides access to a wide range of financial instruments including stocks, forex, crypto, commodities, and indices. This document covers the complete integration of Capital.com into the SignalStudio ecosystem.

**Integration Components:**
- ✅ Sparky Bot: Exchange adapter implementation
- ✅ SignalStudio Dashboard: Exchange metadata and balance endpoint
- ✅ Marketing: Feature documentation

---

## API Documentation Reference

### Authentication

**Method:** Session-based authentication with API Key

**Authentication Flow:**
1. **Generate API Key:** User generates API key in Capital.com platform (Settings > API integrations)
2. **Start Session:** Use API key + login + password to start session via `POST /session`
3. **Get Tokens:** Receive `CST` (authorization token) and `X-SECURITY-TOKEN` (account token) in response headers
4. **Use Tokens:** Pass both tokens in headers for all subsequent API requests
5. **Session Expiry:** Session expires after 10 minutes of inactivity

**Credentials Required:**
- `apiKey` - Capital.com API Key (from Settings > API integrations)
- `login` - Capital.com account login/username
- `password` - API key password (custom password set during API key generation)
- `accountId` - Financial account ID (optional, can be fetched from accounts endpoint)

**Base URLs:**
- **Production:** `https://api-capital.backend-capital.com`
- **Demo:** `https://demo-api-capital.backend-capital.com`

**API Version:** All endpoints use `/api/v1/` prefix

**Session Endpoint:**
- `POST /api/v1/session` - Start new session
  - Headers: `X-CAP-API-KEY: {apiKey}`
  - Body: `{ "identifier": "{login}", "password": "{password}", "encryptedPassword": false }`
  - Response Headers: `CST` (authorization token), `X-SECURITY-TOKEN` (account token)
  - Response Body: Contains account info, accountId, balance, etc.

**Session Management:**
- Session active for 10 minutes
- Tokens expire after 10 minutes of inactivity
- Must refresh session before expiry or on 401 errors

### Endpoints

#### Session Endpoints
- `POST /api/v1/session` - Start new session
- `GET /api/v1/session` - Get current session info
- `PUT /api/v1/session` - Change financial account
- `DELETE /api/v1/session` - Log out of current session
- `GET /api/v1/ping` - Ping service to keep session alive
- `GET /api/v1/time` - Get server time (no auth required)

#### Account Endpoints
- `GET /api/v1/accounts` - Get list of financial accounts
- `GET /api/v1/accounts/preferences` - Get account preferences (trading mode, leverage)
- `PUT /api/v1/accounts/preferences` - Update account preferences
- `POST /api/v1/accounts/topUp` - Top up demo account (demo only, max 100k balance)

#### Market Data Endpoints
- `GET /api/v1/markets` - Get list of available markets
  - Query params: `searchTerm` (search by name), `epics` (comma-separated, max 50)
- `GET /api/v1/markets/{epic}` - Get market details for specific epic
- `GET /api/v1/marketnavigation` - Get asset group names (top-level categories)
- `GET /api/v1/marketnavigation/{nodeId}` - Get assets under group
- `GET /api/v1/prices/{epic}` - Get historical prices
  - Query params: `resolution` (MINUTE, MINUTE_5, etc.), `max` (max 1000), `from`, `to`
- `GET /api/v1/clientsentiment` - Get client sentiment for markets
- `GET /api/v1/clientsentiment/{marketId}` - Get client sentiment for specific market
- `GET /api/v1/watchlists` - Get watchlists
- `GET /api/v1/watchlists/{watchlistId}` - Get watchlist assets

#### Trading Endpoints
- `POST /api/v1/positions` - Open position
- `GET /api/v1/positions` - Get open positions
- `GET /api/v1/positions/{dealId}` - Get position details
- `PUT /api/v1/positions/{dealId}` - Update position (stop loss, take profit)
- `DELETE /api/v1/positions/{dealId}` - Close position
- `POST /api/v1/workingorders` - Create working order (limit/stop)
- `GET /api/v1/workingorders` - Get working orders
- `PUT /api/v1/workingorders/{dealId}` - Update working order
- `DELETE /api/v1/workingorders/{dealId}` - Cancel working order
- `GET /api/v1/confirms/{dealReference}` - Get deal confirmation status

#### History Endpoints
- `GET /api/v1/history/activity` - Get activity history
  - Query params: `from`, `to`, `lastPeriod`, `detailed`, `dealId`, `filter` (FIQL)
  - Max date range: 1 day
- `GET /api/v1/history/transactions` - Get transaction history
  - Query params: `from`, `to`, `lastPeriod`, `type`

---

## Sparky Bot Implementation

### File Structure
```
Sparky/src/exchanges/
├── capitalApi.js          # Main exchange adapter
└── ExchangeFactory.js    # Factory integration
```

### Implementation Details

#### 1. Exchange Adapter (`capitalApi.js`)

**Class:** `CapitalAPI extends BaseExchangeAPI`

**Constructor:**
```javascript
constructor(apiKey, login, password, accountId = null, environment = 'production')
```

**Session Management:**
- Stores API key, login, password
- Manages session tokens (CST, X-SECURITY-TOKEN)
- Auto-refreshes session before expiry
- Handles session expiration gracefully

**Required Methods:**
- [ ] `startSession()` - Start new session and get tokens
- [ ] `refreshSession()` - Refresh session if expired
- [ ] `ensureSession()` - Ensure valid session (auto-refresh if needed)
- [ ] `getBalance()` - Get account balance
- [ ] `getAvailableMargin()` - Get available margin
- [ ] `getPositions()` - Get all open positions
- [ ] `getPosition(symbol)` - Get specific position
- [ ] `hasOpenPosition(symbol)` - Check if position exists
- [ ] `getTicker(symbol)` - Get current market price
- [ ] `placeMarketOrder(symbol, side, quantity)` - Open position (market)
- [ ] `placeLimitOrder(symbol, side, quantity, price)` - Create working order (limit)
- [ ] `placeStopLoss(symbol, side, quantity, stopPrice)` - Update position with stop loss
- [ ] `placeTakeProfit(symbol, side, quantity, takeProfitPrice)` - Update position with take profit
- [ ] `closePosition(symbol, side, quantity)` - Close position
- [ ] `cancelOrder(symbol, orderId)` - Cancel working order
- [ ] `getOrder(symbol, orderId)` - Get order status

**Implementation Notes:**
- **Session Tokens:** Must be included in all authenticated requests
  - Header: `CST: {cstToken}`
  - Header: `X-SECURITY-TOKEN: {securityToken}`
- **Epic Format:** Capital.com uses "epic" instead of symbol (e.g., "OIL_CRUDE", "AAPL")
- **Position Confirmation:** Use `GET /confirms/{dealReference}` to confirm position status
- **Trading Modes:** Check hedging mode via `GET /accounts/preferences`
- **Stop Loss/Take Profit:** Cannot be set for real stocks (CFDs only)

**Authentication:**
```javascript
// Start session
const response = await axios.post(`${baseUrl}/api/v1/session`, {
  identifier: this.login,
  password: this.password,
  encryptedPassword: false
}, {
  headers: {
    'X-CAP-API-KEY': this.apiKey,
    'Content-Type': 'application/json'
  }
});

// Extract tokens from response headers
this.cstToken = response.headers['cst'];
this.securityToken = response.headers['x-security-token'];

// Extract account info from response body
const sessionData = response.data;
this.accountId = sessionData.currentAccountId;
this.balance = sessionData.accountInfo?.balance || 0;
```

**Making Authenticated Requests:**
```javascript
// All authenticated requests require both headers
const response = await axios.get(`${baseUrl}/api/v1/positions`, {
  headers: {
    'CST': this.cstToken,
    'X-SECURITY-TOKEN': this.securityToken,
    'Content-Type': 'application/json'
  }
});
```

#### 2. Order Flow

**Open Position Request:**
```json
{
  "epic": "AAPL",
  "direction": "BUY",
  "size": 1.0,
  "guaranteedStop": false,
  "trailingStop": false,
  "stopLevel": null,
  "stopDistance": null,
  "stopAmount": null,
  "profitLevel": null,
  "profitDistance": null,
  "profitAmount": null
}
```

**Response:**
```json
{
  "dealReference": "o_98c0de50-9cd5-4481-8d81-890c525eeb49"
}
```

**Note:** Use `GET /api/v1/confirms/{dealReference}` to confirm position status and get actual `dealId`.

**Create Working Order (Limit/Stop):**
```json
{
  "epic": "AAPL",
  "direction": "BUY",
  "size": 1.0,
  "level": 150.00,
  "type": "LIMIT",
  "goodTillDate": null,
  "guaranteedStop": false,
  "trailingStop": false,
  "stopLevel": null,
  "stopDistance": null,
  "stopAmount": null,
  "profitLevel": null,
  "profitDistance": null,
  "profitAmount": null
}
```

**Response:**
```json
{
  "dealReference": "o_307bb379-6dd8-4ea7-8935-faf725f0e0a3"
}
```

**Order Types (Working Orders):**
- `LIMIT` - Limit order
- `STOP` - Stop order

**Direction:**
- `BUY` - Buy/Long
- `SELL` - Sell/Short

**Stop Loss/Take Profit Options:**
- `stopLevel` - Price level for stop loss
- `stopDistance` - Distance from current price (required for trailing stop)
- `stopAmount` - Loss amount for stop loss
- `profitLevel` - Price level for take profit
- `profitDistance` - Distance from current price
- `profitAmount` - Profit amount for take profit

---

## SignalStudio Dashboard Integration

### 1. Exchange Metadata

**File:** `signal/server/utils/exchangeMetadata.ts`

**Add to `HARDCODED_EXCHANGES` array:**
```typescript
{
  id: 'capital',
  name: 'Capital.com',
  icon: 'i-heroicons-chart-bar',
  logo: '/capital_logo.png',
  assetClass: 'Multi-Asset' as const,
  assetTypes: 'CFDs • Stocks • Forex • Crypto • Commodities • Indices',
  marketHours: '24/5 Trading',
  colorClass: 'bg-blue-500/20 text-blue-500',
  instructions: 'To obtain API keys, login to your Capital.com account and navigate to Settings > API integrations. Generate a new API key and set a custom password. Note: 2FA must be enabled before generating API keys.',
  requiresPassphrase: false,
  requiresAccountId: false, // Optional, can be fetched automatically
  showApiSecret: true,
  isCCXT: false,
  isCustom: true
}
```

### 2. Balance Endpoint

**File:** `signal/server/api/balance/capital.ts`

```typescript
import { defineEventHandler, createError } from '#imports'
import { serverSupabaseClient } from '#supabase/server'

interface CapitalAccount {
  accountId: string
  accountName: string
  accountType: string
  balance: number
  available: number
  deposit: number
  profitLoss: number
  currency: string
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
      .select('api_key, api_secret, extra_metadata, environment')
      .eq('exchange', 'capital')
      .eq('environment', 'production')
      .eq('user_id', user.id)
      .single()

    if (credError || !credentials) {
      return {
        success: false,
        exchange: 'Capital.com',
        error: 'Capital.com credentials not configured'
      }
    }

    const apiKey = credentials.api_key
    const login = credentials.extra_metadata?.login || credentials.extra_metadata?.username
    const password = credentials.api_secret // API key password
    const environment = credentials.environment || 'production'

    if (!login) {
      return {
        success: false,
        exchange: 'Capital.com',
        error: 'Capital.com login/username not configured'
      }
    }

    const baseUrl = environment === 'demo' || environment === 'sandbox'
      ? 'https://demo-api-capital.backend-capital.com'
      : 'https://api-capital.backend-capital.com'

    // Start session
    const sessionResponse = await $fetch<{ 
      currentAccountId: string
      accountInfo: {
        balance: number
        available: number
        deposit: number
        profitLoss: number
      }
      currencyIsoCode: string
    }>(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: {
        identifier: login,
        password: password,
        encryptedPassword: false
      }
    })

    // Note: $fetch doesn't expose response headers directly
    // Need to use $fetch.raw() or axios to get headers
    const sessionResponseRaw = await $fetch.raw(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: {
        identifier: login,
        password: password,
        encryptedPassword: false
      }
    })

    const cstToken = sessionResponseRaw.headers.get('cst') || sessionResponseRaw.headers.get('CST')
    const securityToken = sessionResponseRaw.headers.get('x-security-token') || sessionResponseRaw.headers.get('X-SECURITY-TOKEN')

    if (!cstToken || !securityToken) {
      return {
        success: false,
        exchange: 'Capital.com',
        error: 'Failed to start Capital.com session - tokens not received'
      }
    }

    const sessionData = await sessionResponseRaw.json()
    const accountId = sessionData.currentAccountId || credentials.extra_metadata?.accountId

    // Use session data directly (already contains balance info)
    const accountInfo = sessionData.accountInfo || {}
    return {
      success: true,
      exchange: 'Capital.com',
      balance: accountInfo.balance || 0,
      available: accountInfo.available || 0,
      deposit: accountInfo.deposit || 0,
      profitLoss: accountInfo.profitLoss || 0,
      currency: sessionData.currencyIsoCode || 'USD',
      accountId: accountId,
      accountName: sessionData.accounts?.[0]?.accountName || 'Capital.com Account'
    }
  } catch (error: unknown) {
    console.error('Capital.com balance error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return {
      success: false,
      exchange: 'Capital.com',
      error: errorMessage
    }
  }
})
```

**Note:** Capital.com requires session management. The balance endpoint will need to start a session first, then use the tokens for authenticated requests.

---

## Configuration

### Credential Storage

**Database Schema:** `bot_credentials` table

**Fields:**
- `api_key` → Capital.com API Key
- `api_secret` → API Key Password (custom password)
- `extra_metadata` → JSON object containing:
  - `login` - Capital.com account login/username
  - `accountId` - Financial account ID (optional, auto-fetched)

**Session Management:**
- Session tokens (CST, X-SECURITY-TOKEN) are NOT stored
- Tokens are fetched fresh for each request or cached temporarily
- Session expires after 10 minutes of inactivity

### Webhook Payload Format

**Standard Format:**
```json
{
  "secret": "your-secret",
  "exchange": "capital",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Capital.com-Specific Fields:**
- `epic` - Optional, uses symbol if not provided (will need to map symbol to epic)
- `accountId` - Optional, uses default account if not provided
- `guaranteedStop` - Optional, boolean for guaranteed stop loss
- `timeInForce` - Optional, `FILL_OR_KILL` (default) or `GOOD_TILL_CANCELLED`

---

## API Endpoints Reference

### Session Endpoints

#### POST /api/v1/session
Start new session.

**Request Headers:**
- `X-CAP-API-KEY: {apiKey}`

**Request Body:**
```json
{
  "identifier": "your_login",
  "password": "api_key_password",
  "encryptedPassword": false
}
```

**Response Headers:**
- `CST: {authorization_token}`
- `X-SECURITY-TOKEN: {account_token}`

**Response Body:**
```json
{
  "accountType": "CFD",
  "accountInfo": {
    "balance": 92.89,
    "deposit": 90.38,
    "profitLoss": 2.51,
    "available": 64.66
  },
  "currencyIsoCode": "USD",
  "currencySymbol": "$",
  "currentAccountId": "12345678901234567",
  "streamingHost": "wss://api-streaming-capital.backend-capital.com/",
  "accounts": [
    {
      "accountId": "12345678901234567",
      "accountName": "USD",
      "preferred": true,
      "accountType": "CFD",
      "currency": "USD",
      "symbol": "$",
      "balance": {
        "balance": 92.89,
        "deposit": 90.38,
        "profitLoss": 2.51,
        "available": 64.66
      }
    }
  ],
  "clientId": "12345678",
  "timezoneOffset": 3,
  "hasActiveDemoAccounts": true,
  "hasActiveLiveAccounts": true,
  "trailingStopsEnabled": false
}
```

#### GET /api/v1/session
Get current session info.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "clientId": "12345678",
  "accountId": "12345678901234567",
  "timezoneOffset": 3,
  "locale": "en",
  "currency": "USD",
  "streamEndpoint": "wss://api-streaming-capital.backend-capital.com/"
}
```

#### PUT /api/v1/session
Change financial account.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Request Body:**
```json
{
  "accountId": "new_account_id"
}
```

**Response:**
```json
{
  "trailingStopsEnabled": false,
  "dealingEnabled": true,
  "hasActiveDemoAccounts": false,
  "hasActiveLiveAccounts": true
}
```

#### DELETE /api/v1/session
Log out of current session.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "status": "SUCCESS"
}
```

#### GET /api/v1/ping
Ping service to keep session alive.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "status": "OK"
}
```

### Account Endpoints

#### GET /api/v1/accounts
Get list of financial accounts.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "accounts": [
    {
      "accountId": "account_id",
      "accountName": "Account Name",
      "accountType": "CFD",
      "balance": {
        "balance": 10000.00,
        "available": 9500.00,
        "deposit": 10000.00,
        "profitLoss": 0.00
      },
      "currency": "USD"
    }
  ]
}
```

#### GET /api/v1/accounts/preferences
Get account preferences (trading mode, leverage).

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "hedgingMode": false,
  "leverages": {
    "SHARES": 5,
    "CURRENCIES": 10,
    "INDICES": 20,
    "CRYPTOCURRENCIES": 2,
    "COMMODITIES": 5
  }
}
```

#### PUT /api/v1/accounts/preferences
Update account preferences.

**Request Body:**
```json
{
  "leverages": {
    "SHARES": 5,
    "CURRENCIES": 10,
    "INDICES": 20,
    "CRYPTOCURRENCIES": 2,
    "COMMODITIES": 5
  },
  "hedgingMode": false
}
```

**Response:**
```json
{
  "status": "SUCCESS"
}
```

### Trading Endpoints

#### POST /api/v1/positions
Open position.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Request Body:**
```json
{
  "epic": "AAPL",
  "direction": "BUY",
  "size": 1.0,
  "guaranteedStop": false,
  "trailingStop": false,
  "stopLevel": 145.00,
  "stopDistance": null,
  "stopAmount": null,
  "profitLevel": 160.00,
  "profitDistance": null,
  "profitAmount": null
}
```

**Response:**
```json
{
  "dealReference": "o_98c0de50-9cd5-4481-8d81-890c525eeb49"
}
```

**Note:** 
- Deal reference starts with `o_` prefix
- Use `GET /api/v1/confirms/{dealReference}` to confirm position status
- Response contains `dealId` (permanent reference) for subsequent operations

#### GET /api/v1/positions
Get open positions.

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "positions": [
    {
      "contractSize": 1,
      "createdDate": "2022-04-06T10:49:52.056",
      "createdDateUTC": "2022-04-06T07:49:52.056",
      "dealId": "006011e7-0001-54c4-0000-00008056005e",
      "dealReference": "p_006011e7-0001-54c4-0000-00008056005e",
      "size": 1,
      "leverage": 20,
      "upl": -0.022,
      "direction": "BUY",
      "level": 21.059,
      "currency": "USD",
      "guaranteedStop": false
    }
  ]
}
```

#### GET /api/v1/positions/{dealId}
Get position details.

**Response:**
```json
{
  "position": {
    "dealId": "006011e7-0001-54c4-0000-00008056005e",
    "epic": "SILVER",
    "direction": "BUY",
    "size": 1,
    "level": 21.059,
    "upl": -0.022
  },
  "market": {
    "epic": "SILVER",
    "instrumentName": "Silver",
    "bid": 21.037,
    "offer": 21.057,
    "marketStatus": "TRADEABLE"
  }
}
```

#### PUT /api/v1/positions/{dealId}
Update position (stop loss, take profit).

**Request Body:**
```json
{
  "guaranteedStop": true,
  "stopDistance": 3,
  "profitAmount": 2
}
```

**Response:**
```json
{
  "dealReference": "p_006011e7-0001-54c4-0000-000080560068"
}
```

#### DELETE /api/v1/positions/{dealId}
Close position.

**Response:**
```json
{
  "dealReference": "p_006011e7-0001-54c4-0000-000080560068"
}
```

#### POST /api/v1/workingorders
Create working order (limit/stop).

**Request Body:**
```json
{
  "epic": "AAPL",
  "direction": "BUY",
  "size": 1.0,
  "level": 150.00,
  "type": "LIMIT",
  "goodTillDate": null
}
```

**Response:**
```json
{
  "dealReference": "o_307bb379-6dd8-4ea7-8935-faf725f0e0a3"
}
```

#### GET /api/v1/workingorders
Get working orders.

**Response:**
```json
{
  "workingOrders": [
    {
      "dealId": "deal_id",
      "epic": "AAPL",
      "direction": "BUY",
      "size": 1.0,
      "level": 150.00,
      "type": "LIMIT"
    }
  ]
}
```

#### DELETE /api/v1/workingorders/{dealId}
Cancel working order.

**Response:**
```json
{
  "dealReference": "o_38323f0c-241a-43b3-8edf-a75d2ae989a5"
}
```

#### GET /api/v1/confirms/{dealReference}
Get deal confirmation status.

**Response:**
```json
{
  "date": "2022-04-06T07:32:19.193",
  "status": "OPEN",
  "dealStatus": "ACCEPTED",
  "epic": "SILVER",
  "dealReference": "o_fcc7e6c0-c150-48aa-bf66-d6c6da071f1a",
  "dealId": "006011e7-0001-54c4-0000-000080560043",
  "affectedDeals": [
    {
      "dealId": "006011e7-0001-54c4-0000-000080560043",
      "status": "ACCEPTED"
    }
  ],
  "level": 24.285,
  "size": 1,
  "direction": "BUY",
  "guaranteedStop": false,
  "trailingStop": false
}
```

### Market Data Endpoints

#### GET /api/v1/markets
Get list of available markets.

**Query Parameters:**
- `searchTerm` - Search for markets (e.g., "Bitcoin", "BTC", "AAPL") - Higher priority
- `epics` - Comma-separated list of epics (max 50) - Lower priority if searchTerm is also specified

**Request Headers:**
- `CST: {cstToken}`
- `X-SECURITY-TOKEN: {securityToken}`

**Response:**
```json
{
  "markets": [
    {
      "epic": "AAPL",
      "instrumentName": "Apple Inc",
      "instrumentType": "SHARES",
      "expiry": "-",
      "lotSize": 1.0,
      "bid": 152.00,
      "offer": 152.10,
      "marketStatus": "TRADEABLE"
    }
  ]
}
```

#### GET /api/v1/markets/{epic}
Get market details for specific epic.

**Response:**
```json
{
  "instrument": {
    "epic": "SILVER",
    "symbol": "Silver",
    "expiry": "-",
    "name": "Silver",
    "lotSize": 1,
    "type": "COMMODITIES",
    "guaranteedStopAllowed": true,
    "streamingPricesAvailable": true,
    "currency": "USD",
    "marginFactor": 10,
    "marginFactorUnit": "PERCENTAGE"
  },
  "dealingRules": {
    "minDealSize": {},
    "maxDealSize": {},
    "minStopOrProfitDistance": {},
    "maxStopOrProfitDistance": {},
    "marketOrderPreference": "AVAILABLE_DEFAULT_ON",
    "trailingStopsPreference": "NOT_AVAILABLE"
  },
  "snapshot": {
    "marketStatus": "TRADEABLE",
    "netChange": -0.627,
    "percentageChange": -0.27,
    "updateTime": "2022-04-06T11:23:00.955",
    "bid": 22.041,
    "offer": 22.061,
    "high": 22.098,
    "low": 21.926
  }
}
```

#### GET /api/v1/prices/{epic}
Get historical prices.

**Query Parameters:**
- `resolution` - MINUTE, MINUTE_5, MINUTE_15, MINUTE_30, HOUR, HOUR_4, DAY, WEEK
- `max` - Maximum number of values (default: 10, max: 1000)
- `from` - Start date (YYYY-MM-DDTHH:MM:SS)
- `to` - End date (YYYY-MM-DDTHH:MM:SS)

**Response:**
```json
{
  "prices": [
    {
      "snapshotTime": "2022-02-24T00:00:00",
      "snapshotTimeUTC": "2022-02-23T21:00:00",
      "openPrice": {"bid": 22.0, "ask": 22.1},
      "closePrice": {"bid": 22.1, "ask": 22.2},
      "highPrice": {"bid": 22.2, "ask": 22.3},
      "lowPrice": {"bid": 21.9, "ask": 22.0}
    }
  ],
  "instrumentType": "COMMODITIES"
}
```

---

## Exchange-Specific Notes

### Epic vs Symbol

**Epic Format:**
- Capital.com uses "epic" instead of standard symbols
- Examples: `AAPL`, `OIL_CRUDE`, `BTCUSD`, `EURUSD`
- Must map standard symbols to epics using `GET /markets?searchTerm={symbol}`

**Symbol Mapping:**
```javascript
// Map symbol to epic
async getEpic(symbol) {
  const response = await this.makeRequest('GET', `/api/v1/markets?searchTerm=${symbol}`);
  const markets = response.markets || [];
  if (markets.length > 0) {
    return markets[0].epic; // Use first match
  }
  throw new Error(`Epic not found for symbol: ${symbol}`);
}

// Get market details for epic
async getMarketDetails(epic) {
  return this.makeRequest('GET', `/api/v1/markets/${epic}`);
}
```

### Session Management

**Session Expiry:**
- Session expires after 10 minutes of inactivity
- Tokens (CST, X-SECURITY-TOKEN) must be refreshed
- Implement auto-refresh before expiry

**Session Refresh Strategy:**
1. Track session creation time
2. Check if session is < 2 minutes from expiry (8 minutes old)
3. Refresh session proactively before expiry
4. Handle 401 errors by refreshing session and retrying
5. Use `GET /api/v1/ping` to keep session alive if needed

### Position Confirmation

**Important:** After opening position, use `GET /api/v1/confirms/{dealReference}` to confirm status:
- Deal reference starts with `o_` prefix (e.g., `o_98c0de50-9cd5-4481-8d81-890c525eeb49`)
- Response contains `dealId` (permanent deal reference) and `affectedDeals` array
- Status may be `OPEN`, `ACCEPTED`, `REJECTED`, etc.
- Check `affectedDeals` array for actual position IDs if multiple positions opened
- Use `dealId` for subsequent position operations (update, close)

### Trading Modes

**Hedging Mode:**
- Check via `GET /accounts/preferences`
- Affects how positions are managed
- Can be changed via `PUT /accounts/preferences`

### Stop Loss / Take Profit

**Options:**
- **Price Level:** `stopLevel`, `profitLevel` - Absolute price levels
- **Distance:** `stopDistance`, `profitDistance` - Distance from current price (required for trailing stop)
- **Amount:** `stopAmount`, `profitAmount` - Loss/profit amounts

**Limitations:**
- Cannot set stop loss/take profit for real stocks (CFDs only)
- Can be set when opening position or updated later via `PUT /api/v1/positions/{dealId}`
- `guaranteedStop` and `trailingStop` are mutually exclusive
- `guaranteedStop` cannot be set if `hedgingMode` is true

### Rate Limits

**Important Limits:**
- Max 10 requests per second per user
- Max 1 request per 0.1 seconds for opening positions/orders
- POST /session limit: 1 request per second per API key
- POST /positions and POST /workingorders: 1000 requests per hour (demo)
- Session duration: 10 minutes

---

## Error Handling

### Common Errors

#### Session Errors
- **401 Unauthorized:** Session expired or invalid tokens
  - Solution: Refresh session and retry
- **403 Forbidden:** Invalid API key or insufficient permissions
  - Solution: Check API key and permissions

#### Trading Errors
- **400 Bad Request:** Invalid order parameters
  - Check: Epic, size, direction, order type
- **400 Bad Request:** Position/order not found
  - Solution: Verify deal ID is correct
- **429 Too Many Requests:** Rate limit exceeded
  - Solution: Implement rate limiting and retry with backoff

#### Market Data Errors
- **404 Not Found:** Epic not found
  - Solution: Use `GET /markets?searchTerm={symbol}` to find epic
- **400 Bad Request:** Invalid epic format
  - Solution: Verify epic format matches Capital.com conventions

### Retry Logic
- Retry on 5xx errors (up to 3 times)
- Retry on 429 errors with exponential backoff
- Refresh session on 401 errors and retry
- **Do NOT retry** on 4xx errors (except 401 with session refresh)

---

## Rate Limits

**Rate Limiting:**
- **General:** 10 requests per second per user
- **Trading:** 1 request per 0.1 seconds for positions/orders (otherwise rejected)
- **Session:** 1 request per second per API key for `POST /api/v1/session`
- **Demo Trading:** 1000 requests per hour for `POST /api/v1/positions` and `POST /api/v1/workingorders`
- **Demo Top Up:** 10 requests per second, 100 requests per account per day
- **API Key Generation:** Max 100 attempts per 24 hours

**Recommended Approach:**
- Implement request queuing for trading operations
- Cache market data (epic lookups)
- Batch requests where possible
- Respect rate limits to avoid 429 errors

---

## Testing

### Test Checklist
- [ ] Session creation and token management
- [ ] Session refresh on expiry
- [ ] Account list and balance fetching
- [ ] Market/epic lookup
- [ ] Position opening (market order)
- [ ] Working order creation (limit order)
- [ ] Position update (stop loss, take profit)
- [ ] Position closing
- [ ] Order cancellation
- [ ] Position confirmation flow
- [ ] Error handling (expired session, invalid epic, rate limits)
- [ ] Webhook integration test

### Test Account Setup
- Create Capital.com account (demo or live)
- Enable 2FA
- Generate API key in Settings > API integrations
- Set custom password for API key
- Test with demo account first
- Verify all order types work

---

## Implementation Checklist

### Sparky Bot
- [ ] Create `capitalApi.js` extending `BaseExchangeAPI`
- [ ] Implement session management (start, refresh, ensure valid)
- [ ] Implement symbol to epic mapping
- [ ] Implement all required methods
- [ ] Add position confirmation flow
- [ ] Add to `ExchangeFactory.js`
- [ ] Update `TradeExecutor.getAssetClass()` (returns 'crypto' or 'forex' based on epic)
- [ ] Test with demo account
- [ ] Test all order types
- [ ] Test error handling
- [ ] Update `EXCHANGES.md` documentation

### SignalStudio Dashboard
- [ ] Add to `exchangeMetadata.ts`
- [ ] Create balance endpoint (with session management)
- [ ] Handle session token management
- [ ] Test balance fetching
- [ ] Verify credential form works
- [ ] Handle session expiration gracefully

### Documentation
- [ ] Update `EXCHANGES.md` with Capital.com section
- [ ] Add API reference details
- [ ] Document session management
- [ ] Document epic mapping
- [ ] Document position confirmation flow
- [ ] Add troubleshooting section

---

## Next Steps

1. Review Capital.com API documentation (complete endpoint reference)
2. Implement session management in `capitalApi.js`
3. Implement symbol to epic mapping
4. Implement exchange adapter with all required methods
5. Integrate into ExchangeFactory
6. Create SignalStudio balance endpoint (with session management)
7. Test with demo account
8. Update documentation
9. Deploy to production

---

**Last Updated:** December 2024  
**Version:** 1.0 (Draft)
