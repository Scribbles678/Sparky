# Fyers API Implementation Guide

## Overview

Fyers is an Indian broker offering stocks, options, futures, and commodities trading on NSE, BSE, and MCX exchanges. The API is REST-based with OAuth 2.0 Authorization Code Flow authentication, WebSocket streaming for real-time data, and comprehensive order management.

**Complexity Assessment:** 🟡 **MEDIUM**

**Why Medium:**
- ✅ REST API (standard HTTP/JSON)
- ✅ OAuth 2.0 Authorization Code Flow (standard protocol)
- ✅ No proprietary protocols
- ✅ No external software required
- ⚠️ OAuth 2.0 redirect-based flow (requires browser interaction)
- ⚠️ Refresh token requires PIN (unusual requirement)
- ⚠️ Symbol format: `NSE:SBIN-EQ` (Exchange:Symbol-Series)
- ⚠️ FyToken lookup may be needed for some operations
- ⚠️ Indian market focus (NSE, BSE, MCX)

**Why Not Easy:**
- OAuth 2.0 Authorization Code Flow requires browser redirect
- Refresh token requires user PIN (adds complexity)
- Symbol format is exchange-specific
- FyToken may need to be looked up from symbol master

## Authentication

Fyers uses **OAuth 2.0 Authorization Code Flow** (standard OAuth 2.0).

**Base URLs:**
- **Trading API:** `https://api-t1.fyers.in/api/v3`
- **WebSocket (Trading):** `wss://socket.fyers.in/trade/v3`
- **WebSocket (Market Data):** `wss://rtsocket-api.fyers.in/versova`
- **Auth Server:** `https://api-t1.fyers.in/api/v3`

**Credential Storage in SignalStudio:**
- `api_key` → App ID (from Fyers API Dashboard)
- `api_secret` → App Secret (from Fyers API Dashboard)
- `extra_metadata.refreshToken` → Refresh Token (stored after initial authorization)
- `extra_metadata.pin` → User PIN (required for refresh token)
- `extra_metadata.accessToken` → Access Token (optional, cached)
- `extra_metadata.environment` → `production` (default)

### OAuth 2.0 Authorization Code Flow

**User Experience:** ⚠️ **Moderate** - Requires browser redirect for initial authorization, plus PIN for refresh

#### Initial Setup (One-Time Per User)

**Step 1: Application Registration (One-Time, Admin)**
- Register SignalStudio as an OAuth application in Fyers API Dashboard
- Receive `app_id` (API Key) and `app_secret`
- Configure redirect URLs: `https://yourdomain.com/api/auth/fyers/callback`
- Configure permissions: Basic, Transactions Info, Order Placement, Market Data
- **Note:** Individual apps are for personal use only. Third-party apps require contacting Fyers support.

**Step 2: User Authorization (Per User)**
- User navigates to Account → Exchanges in SignalStudio
- Selects "Fyers"
- Clicks "Connect Fyers Account" button
- **User is redirected to Fyers login page:**
  ```
  https://api-t1.fyers.in/api/v3/generate-authcode?
    client_id={app_id}&
    redirect_uri={callback_url}&
    response_type=code&
    state={random_state}
  ```
- User logs in with Fyers credentials
- User sees authorization consent dialog
- User clicks "Authorize"
- **User is redirected back to SignalStudio:**
  ```
  https://yourdomain.com/api/auth/fyers/callback?auth_code={auth_code}&state={state}
  ```
- SignalStudio exchanges authorization code for access token and refresh token (behind the scenes)
- **User must provide PIN** (required for future token refreshes)
- Tokens stored securely (encrypted in database)
- **User Experience:** ⚠️ **2-3 clicks, browser redirect, plus PIN entry** - More steps than API key entry

#### Daily Usage Experience

**Token Refresh (Automatic - User Doesn't See This)**
- Access tokens expire (exact expiration time not specified in docs, but refresh tokens valid for 15 days)
- System checks token expiration before each API call
- If token expires, system automatically refreshes using refresh token + PIN
- Refresh happens in background (user doesn't notice)
- **User Experience:** Seamless - no interruption (if PIN is stored)

**Refresh Token Behavior:**
- Refresh tokens valid for **15 days**
- Requires user PIN for refresh (unusual requirement)
- PIN must be stored securely (encrypted)

**If Token Expires (Edge Case)**
- If system tries to use expired token:
  - API returns 401 Unauthorized
  - System automatically refreshes token using refresh token + PIN
  - Retries request
  - **User Experience:** Slight delay (1-2 seconds), but automatic recovery

**Token Refresh Process:**
```
1. System detects token expires soon
2. System calls: POST /api/v3/validate-refresh-token with refresh_token + PIN
3. New access token received
4. Tokens stored securely
5. API calls continue normally
```

**User Experience:** ✅ **Good** - Fully automatic after initial setup (if PIN stored)

#### Ongoing Maintenance

**PIN Changes:**
- If user changes Fyers PIN:
  - Next token refresh will fail (401 error)
  - System detects failure
  - User must update PIN in SignalStudio
  - **User Experience:** ⚠️ One-time update needed

**Re-authorization:**
- If refresh token expires (after 15 days):
  - System gets 401 error on refresh
  - User must re-authorize via browser redirect
  - **User Experience:** ⚠️ Occasional re-auth needed (every 15 days)

### Authorization Headers

All authenticated requests use:
```
Authorization: app_id:access_token
```

Example:
```
Authorization: QCxxxx57-1xx:eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

### Token Endpoints

**Authorization Endpoint:**
```
GET https://api-t1.fyers.in/api/v3/generate-authcode
```

**Token Exchange Endpoint:**
```
POST https://api-t1.fyers.in/api/v3/validate-authcode
Content-Type: application/json
```

**Token Exchange Request:**
```json
{
  "grant_type": "authorization_code",
  "appIdHash": "SHA-256(app_id:app_secret)",
  "code": "{auth_code}"
}
```

**Token Exchange Response:**
```json
{
  "s": "ok",
  "code": 200,
  "message": "",
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Refresh Token Endpoint:**
```
POST https://api-t1.fyers.in/api/v3/validate-refresh-token
Content-Type: application/json
```

**Refresh Token Request:**
```json
{
  "grant_type": "refresh_token",
  "appIdHash": "SHA-256(app_id:app_secret)",
  "refresh_token": "{refresh_token}",
  "pin": "{user_pin}"
}
```

**Refresh Token Response:**
```json
{
  "s": "ok",
  "code": 200,
  "message": "",
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Note:** Refresh token requires user PIN, which is unusual and adds complexity.

## API Base URLs

**Trading API:**
- Base URL: `https://api-t1.fyers.in/api/v3`
- Use for all trading operations

**WebSocket Endpoints:**
- Trading: `wss://socket.fyers.in/trade/v3`
- Market Data: `wss://rtsocket-api.fyers.in/versova`

**Symbol Master Files:**
- Public URLs for symbol lookup
- CSV and JSON formats available
- Updated regularly

## Symbol Format

Fyers uses a specific symbol format:
```
{EXCHANGE}:{SYMBOL}-{SERIES}
```

**Examples:**
- `NSE:SBIN-EQ` - NSE, State Bank of India, Equity
- `NSE:IDEA-EQ` - NSE, Idea, Equity
- `NSE:BANKNIFTY23NOVFUT` - NSE, Bank Nifty Future
- `MCX:SILVERMIC20NOVFUT` - MCX, Silver Mini Future

**Series Codes:**
- `EQ` - Equity
- `FUT` - Futures
- `CE` - Call Option
- `PE` - Put Option

**FyToken:**
- Unique identifier for each symbol
- Can be looked up from symbol master files
- May be required for some operations
- Can be cached for performance

## Account Management

### Get Profile

**Endpoint:** `GET /profile`

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "data": {
    "name": "XASHXX G H",
    "fy_id": "FX0011",
    "email_id": "txxxxxxxxxxx2@gmail.com",
    "PAN": "FYxxxxxx0S",
    "mobile_number": "63xxxxxx08"
  }
}
```

### Get Funds

**Endpoint:** `GET /funds`

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "fund_limit": [
    {
      "id": 1,
      "title": "Total Balance",
      "equityAmount": 58.15,
      "commodityAmount": 0
    },
    {
      "id": 10,
      "title": "Available Balance",
      "equityAmount": 58.15,
      "commodityAmount": 0
    }
  ]
}
```

## Market Data

### Get Quotes

**Endpoint:** `GET /quotes`

**Parameters:**
- `symbols`: Comma-separated list (max 50 symbols)

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "d": [
    {
      "n": "NSE:ONGC-EQ",
      "s": "ok",
      "v": {
        "lp": 123.6,
        "ask": 123.65,
        "bid": 123.6,
        "open_price": 123.95,
        "high_price": 126.6,
        "low_price": 122.5,
        "prev_close_price": 122.2,
        "volume": 14942959,
        "fyToken": "10100000003045"
      }
    }
  ]
}
```

### Get Market Depth

**Endpoint:** `GET /market-depth`

**Parameters:**
- `symbol`: Single symbol
- `ohlcv_flag`: 1 to get OHLCV data

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "ltp": 123.6,
  "bids": [...],
  "asks": [...],
  "o": 123.95,
  "h": 126.6,
  "l": 122.5,
  "c": 123.6,
  "v": 14942959,
  "oi": 0
}
```

### Get Historical Data

**Endpoint:** `GET /history`

**Parameters:**
- `symbol`: Symbol in Fyers format
- `resolution`: `1`, `5`, `15`, `30`, `60`, `240`, `D`, `W`, `M`
- `date_format`: `0` (timestamp) or `1` (date string)
- `range_from`: Start date (YYYY-MM-DD or timestamp)
- `range_to`: End date (YYYY-MM-DD or timestamp)
- `cont_flag`: Continuation flag (for pagination)

**Response:**
```json
{
  "s": "ok",
  "candles": [
    [1622073600, 413.7, 429.1, 412.0, 425.2, 73392997]
  ]
}
```

## Order Execution

### Place Order

**Endpoint:** `POST /orders`

**Request:**
```json
{
  "symbol": "NSE:SBIN-EQ",
  "qty": 1,
  "type": 1,
  "side": 1,
  "productType": "INTRADAY",
  "limitPrice": 355,
  "stopPrice": 0,
  "disclosedQty": 0,
  "validity": "DAY",
  "offlineOrder": false,
  "stopLoss": 0,
  "takeProfit": 0,
  "orderTag": "tag1",
  "isSliceOrder": false
}
```

**Order Types:**
- `1`: Limit Order
- `2`: Market Order
- `3`: Stop Order (SL-M)
- `4`: Stop Limit Order (SL-L)

**Sides:**
- `1`: Buy
- `-1`: Sell

**Product Types:**
- `INTRADAY`: Intraday (all segments)
- `CNC`: Cash and Carry (equity only)
- `MARGIN`: Margin (derivatives only)
- `CO`: Cover Order (stopLoss mandatory)
- `BO`: Bracket Order (stopLoss and takeProfit mandatory)
- `MTF`: Margin Trading Facility (approved symbols only)

**Validity:**
- `DAY`: Valid till end of day
- `IOC`: Immediate or Cancel

**Response:**
```json
{
  "s": "ok",
  "code": 1101,
  "message": "Order submitted successfully. Your Order Ref. No.52104097616",
  "id": "52104097616"
}
```

### Modify Order

**Endpoint:** `PUT /orders`

**Request:**
```json
{
  "id": "52104087951",
  "qty": 1,
  "type": 4,
  "limitPrice": 355,
  "stopPrice": 366
}
```

### Cancel Order

**Endpoint:** `DELETE /orders`

**Request:**
```json
{
  "id": "52104087951"
}
```

### Get Orders

**Endpoint:** `GET /orders`

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "orderBook": [
    {
      "id": "23030900015105",
      "symbol": "NSE:IDEA-EQ",
      "qty": 1,
      "remainingQuantity": 0,
      "filledQty": 1,
      "type": 1,
      "side": -1,
      "status": 2,
      "limitPrice": 6.95,
      "tradedPrice": 6.95,
      "productType": "CNC",
      "orderValidity": "DAY"
    }
  ]
}
```

**Order Status:**
- `1`: Canceled
- `2`: Traded / Filled
- `4`: Transit
- `5`: Rejected
- `6`: Pending
- `7`: Expired

## Positions

### Get Positions

**Endpoint:** `GET /positions`

**Response:**
```json
{
  "s": "ok",
  "code": 200,
  "netPositions": [
    {
      "symbol": "MCX:SILVERMIC20AUGFUT",
      "id": "MCX:SILVERMIC20AUGFUT-MARGIN",
      "netQty": 1,
      "qty": 1,
      "avgPrice": 72256.0,
      "netAvg": 71856.0,
      "side": 1,
      "productType": "MARGIN",
      "realized_profit": 400.0,
      "unrealized_profit": 461.0,
      "pl": 861.0,
      "ltp": 72717.0
    }
  ],
  "overall": {
    "count_total": 1,
    "count_open": 1,
    "pl_total": 861.0,
    "pl_realized": 400.0,
    "pl_unrealized": 461.0
  }
}
```

### Exit Position

**Endpoint:** `DELETE /positions`

**Request:**
```json
{
  "exit_all": 1
}
```

Or by position ID:
```json
{
  "id": "NSE:SBIN-EQ-INTRADAY"
}
```

## Rate Limiting

**Rate Limits:**
- Per Second: 10 requests
- Per Minute: 200 requests
- Per Day: 100,000 requests

**User Blocking:**
- User blocked for rest of day if per-minute rate limit exceeded more than 3 times

## Error Handling

**Common Error Codes:**
- `-8`: Token expired
- `-15`: Invalid token
- `-16`: Unable to authenticate user token
- `-17`: Token invalid or expired
- `-50`: Invalid parameters
- `-51`: Invalid Order ID
- `-53`: Invalid position ID
- `-99`: Order placement rejected
- `-300`: Invalid symbol
- `-352`: Invalid App ID
- `-429`: Rate limit exceeded

## Implementation Notes

### Token Management

1. **Store refresh token securely** (encrypted in database)
2. **Store user PIN securely** (encrypted, required for refresh)
3. **Cache access token** (with expiration time)
4. **Refresh proactively** (before expiration)
5. **Handle 401 errors** (auto-refresh and retry)

### Symbol Format

1. **Format:** `{EXCHANGE}:{SYMBOL}-{SERIES}`
2. **Examples:** `NSE:SBIN-EQ`, `NSE:BANKNIFTY23NOVFUT`
3. **FyToken:** May need to be looked up from symbol master (can be cached)

### AppIdHash Generation

1. **Concatenate:** `app_id:app_secret`
2. **Hash:** SHA-256 of the concatenated string
3. **Use:** In token exchange and refresh requests

### Authorization Header

1. **Format:** `Authorization: app_id:access_token`
2. **Example:** `Authorization: QCxxxx57-1xx:eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...`

### Product Types

1. **INTRADAY:** For same-day trading (all segments)
2. **CNC:** For equity carry-forward
3. **MARGIN:** For derivatives carry-forward
4. **CO:** Cover Order (stopLoss mandatory)
5. **BO:** Bracket Order (stopLoss and takeProfit mandatory)

### Order Tagging

1. **Alphanumeric only** (no spaces or special characters)
2. **1-30 characters** (min 1, max 30)
3. **Cannot be clientID or "Untagged"**
4. **Not supported for BO/CO** product types

## User Experience Analysis

### Initial Setup

**Steps:**
1. Admin registers SignalStudio with Fyers (one-time)
2. User clicks "Connect Fyers Account" in SignalStudio
3. User redirected to Fyers login (browser)
4. User authorizes application
5. System exchanges code for tokens (automatic)
6. **User must provide PIN** (required for refresh token)
7. System stores tokens and PIN securely

**User Experience:** ⚠️ **Moderate** - Requires browser redirect + PIN entry (more complex than API key)

### Daily Usage

**Token Refresh:**
- Automatic (user never sees it)
- Happens before expiration
- Requires PIN (stored securely)
- No user interaction required

**Trading:**
- Standard webhook-based trading
- No additional complexity for users

**User Experience:** ✅ **Good** - Fully automatic after initial setup

### Comparison to Other Exchanges

**vs. Alpaca (API Key):**
- ⚠️ More complex initial setup (OAuth redirect + PIN vs. API key entry)
- ✅ Better security (password never stored)
- ⚠️ PIN required for refresh (adds complexity)

**vs. TradeStation (OAuth 2.0):**
- ⚠️ More complex (PIN required for refresh vs. no PIN)
- ✅ Similar OAuth flow
- ⚠️ Refresh token expires in 15 days (vs. non-expiring default)

**Overall Rating:** ⭐⭐⭐ (3/5) - Moderate complexity, PIN requirement adds friction

## Recommendations

1. **Implement OAuth 2.0 Authorization Code Flow** (standard flow)
2. **Store refresh token and PIN securely** (both encrypted)
3. **Implement proactive token refresh** (before expiration)
4. **Handle PIN changes gracefully** (prompt user to update)
5. **Cache FyToken lookups** (for performance)
6. **Support symbol format conversion** (if needed)
7. **Handle rate limiting** (with exponential backoff)
8. **Support Indian market symbols** (NSE, BSE, MCX)

## Documentation References

- Fyers API Documentation: https://myapi.fyers.in/docsv3/
- Fyers Community: https://community.fyers.in/
- Symbol Master Files: https://public.fyers.in/sym_details/
