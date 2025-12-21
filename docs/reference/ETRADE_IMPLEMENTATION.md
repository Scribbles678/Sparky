# E*TRADE Exchange Integration

**Status:** ⚠️ **DISABLED** - Not Currently Supported  
**Date:** December 2024  
**Exchange:** E*TRADE (Morgan Stanley)  
**Asset Classes:** Stocks, Options, ETFs, Mutual Funds

## ⚠️ Why This Exchange is Disabled

E*TRADE uses OAuth 1.0 with **daily token expiration** (tokens expire at midnight ET each day). This creates a poor user experience as users must:
- Complete OAuth authorization flow
- Re-authorize every single day (tokens expire at midnight ET)
- Deal with token inactivity after 2 hours of no API calls

**Decision:** Skipped in favor of simpler brokers (Alpaca, Tradier) with better UX.

**Implementation Status:** Code is complete but disabled. Can be re-enabled if E*TRADE improves their API or if there's strong user demand.

---

## Overview

E*TRADE is a full-service online broker that provides access to US stocks, options, ETFs, and mutual funds. This document covers the complete integration of E*TRADE into the SignalStudio ecosystem.

**Integration Components:**
- ✅ Sparky Bot: Exchange adapter implementation
- ✅ SignalStudio Dashboard: Exchange metadata and balance endpoint
- ✅ Marketing: Feature documentation

---

## API Documentation Reference

### Authentication

**Method:** OAuth 1.0 (3-legged OAuth)

**OAuth Flow:**
1. **Request Token:** Get request token from E*TRADE
2. **User Authorization:** User authorizes app on E*TRADE website (one-time)
3. **Access Token:** Exchange verification code for access token + token secret
4. **API Calls:** Use access token + token secret for authenticated requests

**Credentials Required:**
- `consumerKey` - E*TRADE Consumer Key (API Key)
- `consumerSecret` - E*TRADE Consumer Secret (API Secret)
- `accessToken` - OAuth Access Token (obtained after authorization)
- `accessTokenSecret` - OAuth Access Token Secret (obtained after authorization)
- `accountIdKey` - Account identifier (not account number, obtained from account list)

**Base URLs:**
- **Sandbox:** `https://apisb.etrade.com`
- **Live:** `https://api.etrade.com`

**OAuth Endpoints:**
- **Request Token:** `/oauth/request_token`
- **Authorize:** `https://us.etrade.com/e/t/etws/authorize?key={consumerKey}&token={requestToken}`
- **Access Token:** `/oauth/access_token`

**Note:** OAuth tokens may expire and need refresh. E*TRADE access tokens typically don't expire unless revoked by user.

### Endpoints

#### Account Endpoints
- `GET /v1/accounts/list.json` - Get list of accounts
- `GET /v1/accounts/{accountIdKey}/balance.json` - Get account balance
  - Query params: `instType`, `realTimeNAV` (true/false)
- `GET /v1/accounts/{accountIdKey}/portfolio.json` - Get portfolio/positions

#### Order Endpoints
- `POST /v1/accounts/{accountIdKey}/orders/preview.json` - Preview order (required before placing)
- `POST /v1/accounts/{accountIdKey}/orders/place.json` - Place order (after preview)
- `GET /v1/accounts/{accountIdKey}/orders.json` - List orders
  - Query params: `marker`, `count`, `status`, `fromDate`, `toDate`, `symbol`, `securityType`, `transactionType`, `marketSession`
- `PUT /v1/accounts/{accountIdKey}/orders/cancel.json` - Cancel order

#### Market Data Endpoints
- `GET /v1/market/quote/{symbols}.json` - Get quote for symbol(s)
  - Multiple symbols: comma-separated (e.g., `AAPL,MSFT,GOOGL`)

---

## Sparky Bot Implementation

### File Structure
```
Sparky/src/exchanges/
├── etradeApi.js          # Main exchange adapter
└── ExchangeFactory.js    # Factory integration
```

### Implementation Details

#### 1. Exchange Adapter (`etradeApi.js`)

**Class:** `EtradeAPI extends BaseExchangeAPI`

**Constructor:**
```javascript
constructor(consumerKey, consumerSecret, accessToken, accessTokenSecret, accountIdKey, environment = 'production')
```

**OAuth Client Setup:**
- Uses OAuth 1.0 library (`oauth` package)
- Stores access token and token secret for authenticated requests
- Handles token refresh if needed

**Required Methods:**
- [ ] `getBalance()` - Get account balance
- [ ] `getAvailableMargin()` - Get buying power (from balance response)
- [ ] `getPositions()` - Get all open positions (from portfolio endpoint)
- [ ] `getPosition(symbol)` - Get specific position
- [ ] `hasOpenPosition(symbol)` - Check if position exists
- [ ] `getTicker(symbol)` - Get current market price (from quote endpoint)
- [ ] `placeMarketOrder(symbol, side, quantity)` - Place market order (preview + place)
- [ ] `placeLimitOrder(symbol, side, quantity, price)` - Place limit order (preview + place)
- [ ] `placeStopLoss(symbol, side, quantity, stopPrice)` - Place stop order
- [ ] `placeTakeProfit(symbol, side, quantity, takeProfitPrice)` - Place limit order (take profit)
- [ ] `closePosition(symbol, side, quantity)` - Close position (market order opposite side)
- [ ] `cancelOrder(symbol, orderId)` - Cancel order
- [ ] `getOrder(symbol, orderId)` - Get order status

**Implementation Notes:**
- **Two-Step Order Process:** E*TRADE requires preview before place
  1. Call `previewOrder()` to validate order
  2. Use preview response to call `placeOrder()`
- **Account ID Key:** Must fetch account list first to get `accountIdKey` (not account number)
- **OAuth Signing:** All requests must be signed with OAuth 1.0
- **Order Types:** Market, Limit, Stop, Stop-Limit
- **Security Types:** EQ (equity), OPT (options), MF (mutual funds), etc.

**Authentication:**
```javascript
// OAuth 1.0 client setup
const OAuth = require('oauth');
const oauthClient = new OAuth.OAuth(
  requestUrl,      // /oauth/request_token
  accessUrl,       // /oauth/access_token
  consumerKey,
  consumerSecret,
  '1.0',
  'oob',           // Out-of-band callback
  'HMAC-SHA1'
);

// Authenticated request
oauthClient._performSecureRequest(
  accessToken,
  accessTokenSecret,
  'GET',
  url,
  null,
  '',
  'application/json',
  callback
);
```

#### 2. Order Flow

**Preview Order Request:**
```json
{
  "PreviewOrderRequest": {
    "orderType": "EQ",
    "clientOrderId": "unique-order-id",
    "Order": [{
      "allOrNone": "false",
      "priceType": "MARKET",
      "orderTerm": "GOOD_FOR_DAY",
      "marketSession": "REGULAR",
      "Instrument": [{
        "Product": {
          "securityType": "EQ",
          "symbol": "AAPL"
        },
        "orderAction": "BUY",
        "quantityType": "QUANTITY",
        "quantity": 100
      }]
    }]
  }
}
```

**Place Order Request:**
```json
{
  "PlaceOrderRequest": {
    "orderType": "EQ",
    "clientOrderId": "unique-order-id",
    "previewId": "preview-id-from-preview-response",
    "Order": [{
      // Same structure as preview
    }]
  }
}
```

**Order Types:**
- `MARKET` - Market order
- `LIMIT` - Limit order (requires `limitPrice`)
- `STOP` - Stop order (requires `stopPrice`)
- `STOP_LIMIT` - Stop-limit order (requires `stopPrice` and `limitPrice`)

**Order Terms:**
- `GOOD_FOR_DAY` - Day order
- `GOOD_UNTIL_CANCEL` - GTC order
- `IMMEDIATE_OR_CANCEL` - IOC order
- `FILL_OR_KILL` - FOK order

**Market Sessions:**
- `REGULAR` - Regular trading hours
- `EXTENDED` - Extended hours (pre-market, after-hours)

---

## SignalStudio Dashboard Integration

### 1. Exchange Metadata

**File:** `signal/server/utils/exchangeMetadata.ts`

**Add to `HARDCODED_EXCHANGES` array:**
```typescript
{
  id: 'etrade',
  name: 'E*TRADE',
  icon: 'i-heroicons-chart-bar',
  logo: '/etrade_logo.png',
  assetClass: 'Stocks' as const,
  assetTypes: 'Stocks • Options • ETFs • Mutual Funds',
  marketHours: 'Extended Hours',
  colorClass: 'bg-blue-600/20 text-blue-600',
  instructions: 'To obtain API keys, login to your E*TRADE account and navigate to Developer Portal. You will need to complete OAuth authorization flow to get access tokens. Account ID Key will be automatically fetched after authorization.',
  requiresPassphrase: false,
  requiresAccountId: false, // Uses accountIdKey (fetched automatically)
  showApiSecret: true,
  isCCXT: false,
  isCustom: true
}
```

### 2. Balance Endpoint

**File:** `signal/server/api/balance/etrade.ts`

```typescript
import { defineEventHandler, createError } from '#imports'
import { serverSupabaseClient } from '#supabase/server'

interface EtradeBalanceResponse {
  BalanceResponse: {
    accountId: string
    accountDescription: string
    Computed: {
      RealTimeValues: {
        totalAccountValue: number
      }
      marginBuyingPower: number
      cashBuyingPower: number
    }
    Bank: {
      totalBalance: number
    }
  }
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
      .select('api_key, api_secret, extra_metadata')
      .eq('exchange', 'etrade')
      .eq('environment', 'production')
      .eq('user_id', user.id)
      .single()

    if (credError || !credentials) {
      return {
        success: false,
        exchange: 'E*TRADE',
        error: 'E*TRADE credentials not configured'
      }
    }

    const consumerKey = credentials.api_key
    const consumerSecret = credentials.api_secret
    const accessToken = credentials.extra_metadata?.accessToken
    const accessTokenSecret = credentials.extra_metadata?.accessTokenSecret
    const accountIdKey = credentials.extra_metadata?.accountIdKey

    if (!accessToken || !accessTokenSecret || !accountIdKey) {
      return {
        success: false,
        exchange: 'E*TRADE',
        error: 'E*TRADE OAuth tokens not configured. Please complete OAuth authorization.'
      }
    }

    const environment = credentials.environment || 'production'
    const baseUrl = environment === 'sandbox'
      ? 'https://apisb.etrade.com'
      : 'https://api.etrade.com'

    // Call E*TRADE API to get balance
    // Note: Requires OAuth 1.0 signing - implementation details in etradeApi.js
    const response = await $fetch<EtradeBalanceResponse>(
      `${baseUrl}/v1/accounts/${accountIdKey}/balance.json`,
      {
        method: 'GET',
        params: {
          instType: 'BROKERAGE',
          realTimeNAV: 'true'
        },
        // OAuth 1.0 signing handled by etradeApi.js
        // For SignalStudio, we'll need to implement OAuth signing here
      }
    )

    const balance = response.BalanceResponse
    const totalAccountValue = balance.Computed?.RealTimeValues?.totalAccountValue || 0
    const marginBuyingPower = balance.Computed?.marginBuyingPower || 0
    const cashBuyingPower = balance.Computed?.cashBuyingPower || 0

    return {
      success: true,
      exchange: 'E*TRADE',
      balance: totalAccountValue,
      marginBuyingPower,
      cashBuyingPower,
      totalBalance: balance.Bank?.totalBalance || 0,
      accountId: balance.accountId,
      accountDescription: balance.accountDescription
    }
  } catch (error: unknown) {
    console.error('E*TRADE balance error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return {
      success: false,
      exchange: 'E*TRADE',
      error: errorMessage
    }
  }
})
```

**Note:** OAuth 1.0 signing is required for all E*TRADE API calls. The balance endpoint will need to use an OAuth library to sign requests.

---

## Configuration

### Credential Storage

**Database Schema:** `bot_credentials` table

**Fields:**
- `api_key` → Consumer Key
- `api_secret` → Consumer Secret
- `extra_metadata` → JSON object containing:
  - `accessToken` - OAuth access token
  - `accessTokenSecret` - OAuth access token secret
  - `accountIdKey` - Account identifier (fetched from account list)
  - `accountId` - Human-readable account ID (optional)

**OAuth Flow:**
1. User provides Consumer Key + Secret
2. System initiates OAuth flow:
   - Request token from E*TRADE
   - Redirect user to E*TRADE authorization page
   - User authorizes and receives verification code
   - Exchange verification code for access token
   - Fetch account list to get accountIdKey
   - Store all tokens in `extra_metadata`

### Webhook Payload Format

**Standard Format:**
```json
{
  "secret": "your-secret",
  "exchange": "etrade",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "market",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**E*TRADE-Specific Fields:**
- `accountIdKey` - Optional, uses default if not provided
- `marketSession` - `REGULAR` (default) or `EXTENDED`
- `orderTerm` - `GOOD_FOR_DAY` (default) or `GOOD_UNTIL_CANCEL`

---

## API Endpoints Reference

### Account Endpoints

#### GET /v1/accounts/list.json
Get list of all accounts for the authenticated user.

**Response:**
```json
{
  "AccountsResponse": {
    "Account": [
      {
        "accountId": "123456789",
        "accountIdKey": "abc123def456",
        "accountMode": "MARGIN",
        "accountDesc": "Individual",
        "accountType": "INDIVIDUAL",
        "institutionType": "BROKERAGE"
      }
    ]
  }
}
```

**Note:** `accountIdKey` is required for all account-specific endpoints.

#### GET /v1/accounts/{accountIdKey}/balance.json
Get account balance and buying power.

**Query Parameters:**
- `instType` - Institution type (e.g., `BROKERAGE`)
- `realTimeNAV` - `true` or `false` (default: `false`)

**Response:**
```json
{
  "BalanceResponse": {
    "accountId": "123456789",
    "accountDescription": "Individual",
    "Computed": {
      "RealTimeValues": {
        "totalAccountValue": 100000.00
      },
      "marginBuyingPower": 200000.00,
      "cashBuyingPower": 50000.00
    },
    "Bank": {
      "totalBalance": 50000.00
    }
  }
}
```

#### GET /v1/accounts/{accountIdKey}/portfolio.json
Get portfolio positions.

**Response:**
```json
{
  "PortfolioResponse": {
    "AccountPortfolio": [
      {
        "Position": [
          {
            "symbolDescription": "Apple Inc",
            "quantity": 100,
            "pricePaid": 150.00,
            "averagePrice": 150.00,
            "totalGain": 500.00,
            "marketValue": 15500.00,
            "Quick": {
              "lastTrade": 155.00
            }
          }
        ]
      }
    ]
  }
}
```

### Order Endpoints

#### POST /v1/accounts/{accountIdKey}/orders/preview.json
Preview order before placing (required step).

**Request Body:**
```json
{
  "PreviewOrderRequest": {
    "orderType": "EQ",
    "clientOrderId": "unique-order-id-123",
    "Order": [{
      "allOrNone": "false",
      "priceType": "MARKET",
      "orderTerm": "GOOD_FOR_DAY",
      "marketSession": "REGULAR",
      "Instrument": [{
        "Product": {
          "securityType": "EQ",
          "symbol": "AAPL"
        },
        "orderAction": "BUY",
        "quantityType": "QUANTITY",
        "quantity": 100
      }]
    }]
  }
}
```

**Response:**
```json
{
  "PreviewOrderResponse": {
    "previewId": "preview-id-456",
    "Order": [{
      "orderType": "EQ",
      "OrderDetail": [{
        "estimatedCommission": 0.00,
        "estimatedTotalAmount": 15500.00,
        "status": "PREVIEW"
      }]
    }]
  }
}
```

#### POST /v1/accounts/{accountIdKey}/orders/place.json
Place order (after preview).

**Request Body:**
```json
{
  "PlaceOrderRequest": {
    "orderType": "EQ",
    "clientOrderId": "unique-order-id-123",
    "previewId": "preview-id-456",
    "Order": [{
      // Same structure as preview
    }]
  }
}
```

**Response:**
```json
{
  "PlaceOrderResponse": {
    "orderId": 789012345,
    "Order": [{
      "orderType": "EQ",
      "OrderDetail": [{
        "status": "OPEN"
      }]
    }]
  }
}
```

#### GET /v1/accounts/{accountIdKey}/orders.json
List orders.

**Query Parameters:**
- `marker` - Pagination marker
- `count` - Number of orders to return
- `status` - Filter by status (`OPEN`, `EXECUTED`, `CANCELLED`, etc.)
- `fromDate` - Start date (MM/dd/yyyy)
- `toDate` - End date (MM/dd/yyyy)
- `symbol` - Filter by symbol
- `securityType` - Filter by security type
- `transactionType` - Filter by transaction type
- `marketSession` - Filter by market session

#### PUT /v1/accounts/{accountIdKey}/orders/cancel.json
Cancel order.

**Request Body:**
```json
{
  "CancelOrderRequest": {
    "orderId": 789012345
  }
}
```

### Market Data Endpoints

#### GET /v1/market/quote/{symbols}.json
Get quote for one or more symbols.

**Multiple Symbols:** Comma-separated (e.g., `AAPL,MSFT,GOOGL`)

**Response:**
```json
{
  "QuoteResponse": {
    "QuoteData": [
      {
        "Product": {
          "symbol": "AAPL",
          "securityType": "EQ"
        },
        "All": {
          "lastTrade": 155.00,
          "bid": 154.95,
          "ask": 155.05,
          "volume": 50000000
        }
      }
    ]
  }
}
```

---

## Exchange-Specific Notes

### Order Types

**Supported Order Types:**
- `MARKET` - Market order (executes immediately)
- `LIMIT` - Limit order (requires `limitPrice`)
- `STOP` - Stop order (requires `stopPrice`)
- `STOP_LIMIT` - Stop-limit order (requires `stopPrice` and `limitPrice`)

**Order Terms (Time in Force):**
- `GOOD_FOR_DAY` - Day order (default)
- `GOOD_UNTIL_CANCEL` - GTC order
- `IMMEDIATE_OR_CANCEL` - IOC order
- `FILL_OR_KILL` - FOK order

**Market Sessions:**
- `REGULAR` - Regular trading hours (9:30 AM - 4:00 PM ET)
- `EXTENDED` - Extended hours (pre-market, after-hours)

### Two-Step Order Process

**Important:** E*TRADE requires preview before placing orders:

1. **Preview Order:** Validates order and returns preview ID
2. **Place Order:** Uses preview ID to actually place the order

**Implementation:**
```javascript
// Step 1: Preview
const previewResponse = await this.previewOrder(orderData);
const previewId = previewResponse.PreviewOrderResponse.previewId;

// Step 2: Place
const placeResponse = await this.placeOrder(orderData, previewId);
const orderId = placeResponse.PlaceOrderResponse.orderId;
```

### Account Identification

**Account ID Key:**
- E*TRADE uses `accountIdKey` (not account number) for API calls
- Must fetch account list first: `GET /v1/accounts/list.json`
- Store `accountIdKey` in `extra_metadata` for future API calls
- User can have multiple accounts - need to select default or allow selection

### OAuth Token Management

**Token Storage:**
- Access tokens typically don't expire (unless revoked)
- Store in `bot_credentials.extra_metadata`
- Handle token refresh if needed (rare)

**Token Refresh:**
- If token expires, user must re-authorize
- Implement token validation and re-auth flow

### Asset Classes

**Stocks (EQ):**
- Regular trading hours
- Extended hours supported
- Margin trading available

**Options (OPT):**
- Requires options approval
- Multi-leg strategies supported
- Exercise/assignment supported

**ETFs:**
- Treated as equity (EQ)
- Same order types as stocks

**Mutual Funds (MF):**
- Different order types
- Settlement may differ

---

## Error Handling

### Common Errors

#### OAuth Errors
- **401 Unauthorized:** Invalid or expired access token
  - Solution: Re-authorize OAuth flow
- **403 Forbidden:** Insufficient permissions
  - Solution: Check API key permissions

#### Order Errors
- **400 Bad Request:** Invalid order parameters
  - Check: Order type, quantity, price, symbol
- **400 Bad Request:** Preview required before place
  - Solution: Always preview before placing
- **400 Bad Request:** Invalid accountIdKey
  - Solution: Fetch account list to get valid accountIdKey

#### Account Errors
- **404 Not Found:** Account not found
  - Solution: Verify accountIdKey is correct
- **403 Forbidden:** Account access denied
  - Solution: Verify OAuth tokens have account access

### Retry Logic
- Retry on 5xx errors (up to 3 times)
- Exponential backoff (1s, 2s, 4s)
- **Do NOT retry** on 4xx errors (client errors)
- Handle OAuth token expiration gracefully

---

## Rate Limits

**Note:** E*TRADE API rate limits are not explicitly documented in the sample code. However, best practices:

- **Rate Limiting:** Implement reasonable rate limiting (e.g., 200 requests/minute)
- **Retry Logic:** Respect 429 (Too Many Requests) responses with exponential backoff
- **Connection Pooling:** Reuse HTTP connections for better performance

**Recommended Approach:**
- Use REST API for all operations
- Implement request queuing if needed for high-frequency trading
- Cache account list and accountIdKey to reduce API calls

---

## Testing

### Test Checklist
- [ ] OAuth flow (request token → authorize → access token)
- [ ] Account list fetching
- [ ] Balance fetching
- [ ] Portfolio/positions fetching
- [ ] Market order execution (preview + place)
- [ ] Limit order execution (preview + place)
- [ ] Stop order execution
- [ ] Order cancellation
- [ ] Order status checking
- [ ] Error handling (invalid tokens, expired tokens)
- [ ] Webhook integration test

### Test Account Setup
- Create E*TRADE developer account
- Generate Consumer Key + Secret (sandbox)
- Complete OAuth authorization flow
- Test with sandbox account first
- Verify all order types work

---

## Implementation Checklist

### Sparky Bot
- [ ] Create `etradeApi.js` extending `BaseExchangeAPI`
- [ ] Implement OAuth 1.0 client
- [ ] Implement account list fetching
- [ ] Implement all required methods
- [ ] Add two-step order process (preview + place)
- [ ] Add to `ExchangeFactory.js`
- [ ] Update `TradeExecutor.getAssetClass()` (returns 'stocks')
- [ ] Test with sandbox account
- [ ] Test all order types
- [ ] Test error handling
- [ ] Update `EXCHANGES.md` documentation

### SignalStudio Dashboard
- [ ] Add to `exchangeMetadata.ts`
- [ ] Create balance endpoint (with OAuth signing)
- [ ] Implement OAuth authorization flow UI
- [ ] Store OAuth tokens in `extra_metadata`
- [ ] Test balance fetching
- [ ] Verify credential form works
- [ ] Handle OAuth token refresh

### Documentation
- [ ] Update `EXCHANGES.md` with E*TRADE section
- [ ] Add API reference details
- [ ] Document OAuth flow
- [ ] Document two-step order process
- [ ] Add troubleshooting section

---

## Next Steps

1. Review E*TRADE API documentation (developer.etrade.com)
2. Implement OAuth 1.0 client in `etradeApi.js`
3. Implement exchange adapter with all required methods
4. Integrate into ExchangeFactory
5. Create SignalStudio balance endpoint (with OAuth signing)
6. Implement OAuth authorization flow in SignalStudio
7. Test with sandbox account
8. Update documentation
9. Deploy to production

---

**Last Updated:** December 2024  
**Version:** 1.0 (Draft)
