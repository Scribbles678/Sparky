# Alpaca Exchange Integration

**Status:** 🚧 In Progress  
**Date:** December 2024  
**Exchange:** Alpaca Markets  
**Asset Classes:** Stocks, Options, Crypto (US)

---

## Overview

Alpaca is a commission-free API-first broker that provides access to US stocks, options, and crypto trading. This document covers the complete integration of Alpaca into the SignalStudio ecosystem.

**Integration Components:**
- ✅ Sparky Bot: Exchange adapter implementation
- ✅ SignalStudio Dashboard: Exchange metadata and balance endpoint
- ✅ Marketing: Feature documentation

---

## API Documentation Reference

### Authentication
- **Method:** API Key + Secret (HTTP Headers) - Legacy Authentication
- **Headers:** 
  - `APCA-API-KEY-ID`: Your API Key ID
  - `APCA-API-SECRET-KEY`: Your API Secret Key
- **Alternative:** HTTP Basic Authentication (username = API Key ID, password = Secret Key)
- **Base URLs:**
  - **Paper Trading:** `https://paper-api.alpaca.markets`
  - **Live Trading:** `https://api.alpaca.markets`

### Endpoints

#### Account Endpoints
- `GET /v2/account` - Get account information
  - Returns account object with balance, buying power, equity, etc.
  - Key fields: `cash`, `buying_power`, `equity`, `portfolio_value`

#### Position Endpoints
- `GET /v2/positions` - Get all open positions
- `GET /v2/positions/{symbol}` - Get specific position by symbol

#### Order Endpoints
- `POST /v2/orders` - Place new order
- `GET /v2/orders` - List orders (with filters: status, limit, nested)
- `GET /v2/orders/{order_id}` - Get specific order
- `GET /v2/orders:by_client_order_id` - Get order by client_order_id
- `DELETE /v2/orders/{order_id}` - Cancel order

#### Asset Endpoints
- `GET /v2/assets` - Get list of all assets
- `GET /v2/assets/{symbol}` - Get specific asset information

---

## Sparky Bot Implementation

### File Structure
```
Sparky/src/exchanges/
├── alpacaApi.js          # Main exchange adapter
└── ExchangeFactory.js    # Factory integration
```

### Implementation Details

#### 1. Exchange Adapter (`alpacaApi.js`)

**Class:** `AlpacaAPI extends BaseExchangeAPI`

**Constructor:**
```javascript
constructor(apiKey, apiSecret, environment = 'production')
```

**Required Methods:**
- [ ] `getBalance()` - Get account balance (use `/v2/account`, return `cash` and `buying_power`)
- [ ] `getAvailableMargin()` - Get buying power (use `/v2/account`, return `buying_power`)
- [ ] `getPositions()` - Get all open positions (use `/v2/positions`)
- [ ] `getPosition(symbol)` - Get specific position (use `/v2/positions/{symbol}`)
- [ ] `hasOpenPosition(symbol)` - Check if position exists (use `getPosition()` and check if not null)
- [ ] `getTicker(symbol)` - Get current market price
  - **Stocks:** Use `GET /v2/stocks/{symbol}/trades/latest` or `/quotes/latest`
  - **Crypto:** Use `GET /v1beta3/crypto/us/latest/trades` or `/latest/quotes`
  - **Options:** Use `GET /v1beta1/options/{symbol}/snapshot`
  - **Alternative:** Use WebSocket stream for real-time updates
- [ ] `placeMarketOrder(symbol, side, quantity)` - Place market order (use `/v2/orders` with `type: "market"`)
- [ ] `placeLimitOrder(symbol, side, quantity, price)` - Place limit order (use `/v2/orders` with `type: "limit"`)
- [ ] `placeStopLoss(symbol, side, quantity, stopPrice)` - Place stop loss (use `/v2/orders` with `type: "stop"` or `type: "stop_limit"`)
- [ ] `placeTakeProfit(symbol, side, quantity, takeProfitPrice)` - Place take profit (use `/v2/orders` with `type: "limit"` and opposite side)
- [ ] `closePosition(symbol, side, quantity)` - Close position (use `/v2/orders` with opposite side and `qty`)
- [ ] `cancelOrder(symbol, orderId)` - Cancel order (use `DELETE /v2/orders/{order_id}`)
- [ ] `getOrder(symbol, orderId)` - Get order status (use `GET /v2/orders/{order_id}`)

**Implementation Notes:**
- For fractional orders, can use `notional` (USD amount) instead of `qty`
- For stop loss, use `type: "stop"` (becomes stop-limit for buy stops)
- For take profit, use `type: "limit"` with opposite side
- Consider using bracket orders for entry + TP + SL in one request

**Authentication:**
```javascript
// Headers for all requests (Legacy Authentication)
const headers = {
  'APCA-API-KEY-ID': this.apiKey,
  'APCA-API-SECRET-KEY': this.apiSecret,
  'Content-Type': 'application/json'
};
```

**Note:** Alpaca uses Legacy authentication (API Key + Secret in headers). Client Credentials OAuth2 flow is not yet available for Trading API.

**Base URL Selection:**
```javascript
this.baseUrl = environment === 'paper'
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';
```

#### 2. ExchangeFactory Integration

**File:** `src/exchanges/ExchangeFactory.js`

**Add to `createExchange()` method:**
```javascript
case 'alpaca':
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Alpaca requires apiKey and apiSecret');
  }
  return new AlpacaAPI(
    config.apiKey,
    config.apiSecret,
    config.environment || 'production'
  );
```

**Add to `mapCredentialsToConfig()` method:**
```javascript
case 'alpaca':
  return {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    environment: credentials.environment || 'production',
  };
```

**Add to `getSupportedExchanges()` method:**
```javascript
const customExchanges = [
  'aster', 
  'oanda', 
  'tradier', 
  'tradier_options', 
  'kalshi',
  'alpaca'  // Add Alpaca
];
```

#### 3. TradeExecutor Integration

**File:** `src/tradeExecutor.js`

**Add to `getAssetClass()` method:**
```javascript
const exchangeAssetMap = {
  'aster': 'crypto',
  'oanda': 'forex',
  'tradier': 'stocks',
  'alpaca': 'stocks',  // Add Alpaca
  'tastytrade': 'futures',
  'kalshi': 'prediction',
};
```

---

## SignalStudio Dashboard Integration

### 1. Exchange Metadata

**File:** `signal/server/utils/exchangeMetadata.ts`

**Add to `HARDCODED_EXCHANGES` array:**
```typescript
{
  id: 'alpaca',
  name: 'Alpaca',
  icon: 'i-heroicons-chart-bar',
  logo: '/alpaca_logo.png',
  assetClass: 'Stocks' as const,
  assetTypes: 'Stocks • Options • Crypto',
  marketHours: 'Extended Hours',
  colorClass: 'bg-cyan-500/20 text-cyan-500',
  instructions: 'To obtain API keys, login to your Alpaca account and navigate to API Management. You can use paper trading for testing.',
  requiresPassphrase: false,
  requiresAccountId: false,
  showApiSecret: true,
  isCCXT: false,
  isCustom: true
}
```

### 2. Balance Endpoint

**File:** `signal/server/api/balance/alpaca.ts`

```typescript
import { defineEventHandler, createError } from '#imports'
import { serverSupabaseClient } from '#supabase/server'

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
      .eq('exchange', 'alpaca')
      .eq('environment', 'production')
      .eq('user_id', user.id)
      .single()

    if (credError || !credentials) {
      return {
        success: false,
        exchange: 'Alpaca',
        error: 'Alpaca credentials not configured'
      }
    }

    // Call Alpaca API to get balance
    const baseUrl = credentials.environment === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'

    const response = await $fetch(`${baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': credentials.api_key,
        'APCA-API-SECRET-KEY': credentials.api_secret,
      }
    })

    return {
      success: true,
      exchange: 'Alpaca',
      balance: parseFloat(response.cash),
      availableBalance: parseFloat(response.buying_power),
      equity: parseFloat(response.equity),
      currency: 'USD'
    }
  } catch (error: any) {
    console.error('Alpaca balance error:', error)
    return {
      success: false,
      exchange: 'Alpaca',
      error: error?.message || 'Unknown error occurred'
    }
  }
})
```

---

## Configuration

### Credentials Storage

**Database Table:** `bot_credentials`

**Required Fields:**
- `exchange`: `'alpaca'`
- `api_key`: Alpaca API Key ID
- `api_secret`: Alpaca API Secret Key
- `environment`: `'paper'` or `'production'`
- `user_id`: User UUID

**Example:**
```sql
INSERT INTO bot_credentials (
  user_id,
  exchange,
  api_key,
  api_secret,
  environment,
  label
) VALUES (
  'user-uuid',
  'alpaca',
  'PK...',
  '...',
  'paper',
  'Alpaca Paper Account'
);
```

### Webhook Payload

**Example TradingView Alert:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "alpaca",
  "action": "BUY",
  "symbol": "AAPL",
  "order_type": "market",
  "position_size_usd": 1000,
  "stop_loss_percent": 2.0,
  "take_profit_percent": 5.0
}
```

---

## API Endpoints Reference

### Account Endpoints

#### GET /v2/account
Get account information including balance, buying power, equity, and account status.

**Response Fields:**
- `cash` - Cash balance
- `buying_power` - Available buying power
- `equity` - Total equity (cash + long_market_value + short_market_value)
- `portfolio_value` - Total portfolio value (equivalent to equity)
- `trading_blocked` - If true, account cannot place orders
- `pattern_day_trader` - Pattern day trader flag
- `multiplier` - Buying power multiplier (1, 2, or 4)
- `status` - Account status (ACTIVE, ONBOARDING, SUBMITTED, etc.)

#### GET /v2/account/activities
Get account activities (trade activities and non-trade activities).

**Query Parameters:**
- `activity_types` - Filter by activity type (FILL, DIV, INT, etc.)
- `date` - Filter by date
- `page_token` - Pagination token
- `page_size` - Number of results (default: 100, max: 100 if date not specified)

**Activity Types:**
- `FILL` - Order fills (both partial and full fills)
- `DIV` - Dividends
- `INT` - Interest (credit/margin)
- `CFEE` - Crypto fee
- `FEE` - Fee denominated in USD
- `CSD` - Cash deposit (+)
- `CSW` - Cash withdrawal (-)
- `OPEXC` - Option exercise
- `OPASN` - Option assignment
- `OPEXP` - Option expiration
- And many more...

**Response Example (Trade Activity):**
```json
{
  "activity_type": "FILL",
  "cum_qty": "1",
  "id": "20190524113406977::8efc7b9a-8b2b-4000-9955-d36e7db0df74",
  "leaves_qty": "0",
  "price": "1.63",
  "qty": "1",
  "side": "buy",
  "symbol": "LPCN",
  "transaction_time": "2019-05-24T15:34:06.977Z",
  "order_id": "904837e3-3b76-47ec-b432-046db621571b",
  "type": "fill"
}
```

**Response Example:**
```json
{
  "account_blocked": false,
  "account_number": "010203ABCD",
  "buying_power": "262113.632",
  "cash": "-23140.2",
  "created_at": "2019-06-12T22:47:07.99658Z",
  "currency": "USD",
  "crypto_status": "ACTIVE",
  "equity": "103820.56",
  "id": "e6fe16f3-64a4-4921-8928-cadf02f92f98",
  "multiplier": "4",
  "pattern_day_trader": false,
  "portfolio_value": "103820.56",
  "status": "ACTIVE",
  "trading_blocked": false
}
```

**Key Fields:**
- `cash` - Cash balance
- `buying_power` - Available buying power
- `equity` - Total equity (cash + long_market_value + short_market_value)
- `portfolio_value` - Total portfolio value (equivalent to equity)
- `trading_blocked` - If true, account cannot place orders
- `pattern_day_trader` - Pattern day trader flag

### Position Endpoints

#### GET /v2/positions
Get all open positions.

**Response:** Array of position objects

#### GET /v2/positions/{symbol}
Get specific position by symbol.

**Position Object:**
```json
{
  "symbol": "AAPL",
  "qty": "10",
  "side": "long",
  "market_value": "1500.00",
  "avg_entry_price": "150.00",
  "current_price": "150.50",
  "unrealized_pl": "5.00",
  "unrealized_plpc": "0.33"
}
```

**Price Updates:**
- 4:00 AM - 9:30 AM ET: Last trade from premarket
- 9:30 AM - 4:00 PM ET: Last trade
- 4:00 PM - 10:00 PM ET: Last trade from after-hours
- 10:00 PM - 4:00 AM ET: Official closing price from 4 PM ET

### Order Endpoints

#### POST /v2/orders
Place a new order.

**Request Body (Market Order):**
```json
{
  "symbol": "AAPL",
  "qty": 1,
  "side": "buy",
  "type": "market",
  "time_in_force": "day"
}
```

**Request Body (Limit Order):**
```json
{
  "symbol": "AMD",
  "qty": 1,
  "side": "sell",
  "type": "limit",
  "time_in_force": "opg",
  "limit_price": 20.5
}
```

**Request Body (Bracket Order):**
```json
{
  "symbol": "AAPL",
  "qty": 1,
  "side": "buy",
  "type": "limit",
  "time_in_force": "gtc",
  "limit_price": 150.00,
  "order_class": "bracket",
  "stop_loss": {
    "stop_price": 142.50,
    "limit_price": 141.00
  },
  "take_profit": {
    "limit_price": 157.50
  }
}
```

**Request Body (Trailing Stop):**
```json
{
  "symbol": "AAPL",
  "qty": 1,
  "side": "sell",
  "type": "trailing_stop",
  "trail_price": 1.0,
  "time_in_force": "day"
}
```

**Request Body (Crypto Order):**
```json
{
  "symbol": "BTC/USD",
  "qty": "0.0001",
  "side": "buy",
  "type": "market",
  "time_in_force": "gtc"
}
```

**Request Body (Options Order - Buy Call):**
```json
{
  "symbol": "AAPL240119C00190000",
  "qty": "1",
  "side": "buy",
  "type": "market",
  "time_in_force": "day"
}
```

**Request Body (Multi-leg Order - Call Spread):**
```json
{
  "order_class": "mleg",
  "qty": "1",
  "type": "limit",
  "limit_price": "1.00",
  "time_in_force": "day",
  "legs": [
    {
      "symbol": "AAPL250117C00190000",
      "ratio_qty": "1",
      "side": "buy",
      "position_intent": "buy_to_open"
    },
    {
      "symbol": "AAPL250117C00210000",
      "ratio_qty": "1",
      "side": "sell",
      "position_intent": "sell_to_open"
    }
  ]
}
```

**Order Types:**
- `market` - Market order (stocks, crypto, options)
- `limit` - Limit order (stocks, crypto, options)
- `stop` - Stop order (stocks only)
- `stop_limit` - Stop limit order (stocks, crypto)
- `trailing_stop` - Trailing stop order (stocks only)

**Order Types by Asset Class:**
- **Stocks:** market, limit, stop, stop_limit, trailing_stop
- **Crypto:** market, limit, stop_limit
- **Options:** market, limit (only)

**Order Type Details:**

**Market Orders:**
- Execute immediately at current market price
- Fastest execution, but price may slip
- Risk of unexpected fills during price spikes

**Limit Orders:**
- Execute at specified price or better
- Buy limit: executes at limit price or lower
- Sell limit: executes at limit price or higher
- May not fill if price moves away
- **Sub-penny restrictions:**
  - Limit price >= $1.00: Max 2 decimals
  - Limit price < $1.00: Max 4 decimals

**Stop Orders:**
- Trigger when price reaches stop price
- Buy stop: Converted to stop-limit (4% above stop if < $50, 2.5% if >= $50)
- Sell stop: Remains as stop order (not converted)
- **Sub-penny restrictions:**
  - Stop price >= $1.00: Max 2 decimals
  - Stop price < $1.00: Max 4 decimals

**Stop Limit Orders:**
- Conditional trade combining stop + limit
- Triggers at stop price, executes at limit price or better
- May remain active as limit order if gap occurs

**Trailing Stop Orders:**
- Automatically updates stop price based on price movement
- Tracks high water mark (HWM)
- Use `trail_price` (dollar offset) or `trail_percent` (percentage offset)
- Only valid during regular market hours
- Time in force: `day` or `gtc` only
- Can update trail parameter via PATCH while pending

**Time in Force:**
- `day` - Day order (expires at end of trading day) - **Required for options**
- `gtc` - Good till canceled (stocks, crypto)
- `opg` - Market on open (stocks)
- `cls` - Market on close (stocks)
- `ioc` - Immediate or cancel (stocks, crypto)
- `fok` - Fill or kill (stocks)

**Time in Force by Asset Class:**
- **Stocks (Whole qty):** day, gtc, opg, cls, ioc, fok
- **Stocks (Fractional):** day (only)
- **Stocks (Extended Hours):** day (only, limit orders only)
- **Crypto:** gtc, ioc
- **Options:** day (only)
- **OTC Assets:** day, gtc

**Time in Force Details:**

**day:**
- Valid only on the day it's live
- Default: Regular Trading Hours (9:30am - 4:00pm ET)
- If `extended_hours: true`, can execute during extended hours
- Auto-cancelled after closing auction if unfilled
- If submitted after close, queued for next trading day

**gtc (Good Till Canceled):**
- Order remains active until filled or canceled
- Non-marketable GTC limit orders subject to price adjustments for corporate actions
- **Aged Order Policy:** Auto-cancelled 90 days after creation (at 4:15pm ET on `expires_at` date)

**opg (Market on Open / Limit on Open):**
- Executes only in opening auction
- Rejected if submitted after 9:28am but before 7:00pm ET
- Queued if submitted after 7:00pm for next day's opening auction
- Does not execute exactly at 9:30am (follows exchange auction rules)

**cls (Market on Close / Limit on Close):**
- Executes only in closing auction
- Rejected if submitted after 3:50pm but before 7:00pm ET
- Queued if submitted after 7:00pm for next day's closing auction
- Only available with API v2

**ioc (Immediate Or Cancel):**
- Requires immediate execution
- Unfilled portion canceled
- Market makers may fill on principal basis only
- Can result in entire order being cancelled if no inventory

**fok (Fill or Kill):**
- Entire order must fill immediately
- Otherwise, order is canceled
- Only available with API v2

**Order Classes:**
- `simple` - Simple order (default)
- `bracket` - Bracket order (entry + stop loss + take profit) - Stocks only
- `oco` - One-cancels-other (stop loss OR take profit) - Stocks only
- `oto` - One-triggers-other (entry triggers stop loss) - Stocks only
- `mleg` - Multi-leg order (options spreads, iron condor, etc.) - Options only

#### GET /v2/orders
List orders with optional filters.

**Query Parameters:**
- `status` - Filter by status (open, closed, all)
- `limit` - Limit number of results
- `nested` - Show nested multi-leg orders

#### GET /v2/orders/{order_id}
Get specific order by ID.

#### GET /v2/orders:by_client_order_id
Get order by client_order_id.

#### DELETE /v2/orders/{order_id}
Cancel an order.

### Asset Endpoints

#### GET /v2/assets
Get list of all assets (US equities).

**Query Parameters:**
- `status` - Filter by status (active, inactive)

#### GET /v2/assets/{symbol}
Get specific asset information.

**Response (Stock):**
```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "exchange": "NASDAQ",
  "tradable": true,
  "status": "active"
}
```

**Response (Crypto):**
```json
{
  "id": "276e2673-764b-4ab6-a611-caf665ca6340",
  "class": "crypto",
  "exchange": "ALPACA",
  "symbol": "BTC/USD",
  "name": "BTC/USD pair",
  "status": "active",
  "tradable": true,
  "marginable": false,
  "shortable": false,
  "fractionable": true,
  "min_order_size": "0.0001",
  "min_trade_increment": "0.0001",
  "price_increment": "1"
}
```

**Query Crypto Assets:**
- `GET /v2/assets?asset_class=crypto` - Get all crypto assets

#### GET /v2/options/contracts
Get option contracts.

**Query Parameters:**
- `underlying_symbols` - Filter by underlying symbol (e.g., `AAPL`)
- `expiration_date_lte` - Default: Next weekend
- `limit` - Default: 100

**Response:**
```json
{
  "option_contracts": [
    {
      "id": "6e58f870-fe73-4583-81e4-b9a37892c36f",
      "symbol": "AAPL240119C00100000",
      "name": "AAPL Jan 19 2024 100 Call",
      "status": "active",
      "tradable": true,
      "expiration_date": "2024-01-19",
      "root_symbol": "AAPL",
      "underlying_symbol": "AAPL",
      "type": "call",
      "style": "american",
      "strike_price": "100",
      "size": "100"
    }
  ],
  "page_token": "MTAw",
  "limit": 100
}
```

#### POST /v2/positions/{symbol_or_contract_id}/exercise
Exercise an option contract.

**Note:** 
- All available held shares will be exercised
- ITM contracts auto-exercise at expiry (unless DNE)
- Exercise requests processed immediately
- Requests between market close and midnight will be rejected

### Account Activities Endpoints

#### GET /v2/account/activities
Get account activities (trade activities and non-trade activities).

**Query Parameters:**
- `activity_types` - Filter by activity type (FILL, DIV, INT, CFEE, etc.)
- `date` - Filter by date
- `page_token` - Pagination token (use activity ID)
- `page_size` - Number of results (default: 100 if date not specified, no max if date specified)

**Activity Types:**
- `FILL` - Order fills (both partial and full fills)
- `DIV` - Dividends
- `INT` - Interest (credit/margin)
- `CFEE` - Crypto fee
- `FEE` - Fee denominated in USD
- `CSD` - Cash deposit (+)
- `CSW` - Cash withdrawal (-)
- `OPEXC` - Option exercise
- `OPASN` - Option assignment
- `OPEXP` - Option expiration
- `TRANS` - Cash transactions
- `MISC` - Miscellaneous activities
- And many more...

**Pagination:**
- Use `page_token` (activity ID) for pagination
- With `direction: desc`, results end before the specified ID
- With `direction: asc`, results begin after the specified ID

### Market Data API

**Important:** Market Data API endpoints are on `data.alpaca.markets` (separate from Trading API)

**Base URL:** `https://data.alpaca.markets/{version}`  
**Sandbox URL:** `https://data.sandbox.alpaca.markets/{version}` (for broker partners)

#### Authentication

**Trading API Keys:**
- Use same API keys as Trading API
- Headers: `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`

**Broker API Keys:**
- HTTP Basic Authentication
- Username: API Key ID
- Password: API Secret Key
- Encode as base64: `Authorization: Basic {base64(key:secret)}`

**Note:** Historical crypto data does NOT require authentication.

#### Request ID

All Market Data API endpoints provide a unique `X-Request-ID` in the response header. This Request ID helps Alpaca identify the call chain in their system for support requests.

**Best Practice:** Persist recent Request IDs and include them in all support requests for faster issue resolution.

#### Subscription Plans

**Basic Plan (Free - Default):**
- **Equities:** IEX exchange only (~2.5% market volume)
- **Options:** Indicative feed only (delayed 15 minutes)
- **WebSocket:** 30 symbols (stocks), 200 quotes (options)
- **Historical:** Latest 15 minutes only
- **API Calls:** 200/minute

**Algo Trader Plus ($99/month):**
- **Equities:** All US Stock Exchanges (100% market volume via SIP)
- **Options:** OPRA feed (real-time)
- **WebSocket:** Unlimited symbols (stocks), 1000 quotes (options)
- **Historical:** Since 2016 (no restriction)
- **API Calls:** 10,000/minute

**Data Sources:**
- **IEX:** Single exchange, ~2.5% volume (free)
- **SIP:** All US exchanges, 100% volume (CTA + UTP)
- **BOATS:** Blue Ocean ATS (overnight trading)
- **Overnight:** Alpaca's derived feed from BOATS (cheaper alternative)

#### Historical API Endpoints

**Base URL:** `https://data.alpaca.markets/v2` (or `/v1beta3` for crypto)

**Stock Historical Data:**
- `GET /v2/stocks/bars` - Historical bars (OHLCV)
- `GET /v2/stocks/trades` - Historical trades
- `GET /v2/stocks/quotes` - Historical quotes
- `GET /v2/stocks/{symbol}/bars/latest` - Latest bar
- `GET /v2/stocks/{symbol}/trades/latest` - Latest trade
- `GET /v2/stocks/{symbol}/quotes/latest` - Latest quote
- `GET /v2/stocks/{symbol}/snapshot` - Comprehensive snapshot

**Query Parameters:**
- `symbols` - Comma-separated list of symbols
- `start` - Start date (ISO 8601)
- `end` - End date (ISO 8601)
- `timeframe` - Bar timeframe (1Min, 5Min, 15Min, 1Hour, 1Day, etc.)
- `feed` - Data source (`iex`, `sip`, `boats`, `overnight`)
- `limit` - Number of results (default: 1000, max: 10000)

**Crypto Historical Data:**
- `GET /v1beta3/crypto/us/bars` - Historical bars
- `GET /v1beta3/crypto/us/trades` - Historical trades
- `GET /v1beta3/crypto/us/quotes` - Historical quotes
- `GET /v1beta3/crypto/us/latest/orderbooks` - Latest orderbook
- `GET /v1beta3/crypto/us/latest/bars` - Latest bar
- `GET /v1beta3/crypto/us/latest/trades` - Latest trade
- `GET /v1beta3/crypto/us/latest/quotes` - Latest quote
- `GET /v1beta3/crypto/us/snapshot` - Comprehensive snapshot

**Note:** Crypto bars contain quote mid-prices if no trades occur in a bar (volume = 0, but prices from quotes).

**Options Historical Data:**
- `GET /v1beta1/options/bars` - Historical bars
- `GET /v1beta1/options/trades` - Historical trades
- `GET /v1beta1/options/quotes` - Historical quotes
- `GET /v1beta1/options/{symbol}/snapshot` - Comprehensive snapshot

**Note:** Options historical data available since February 2024 only.

**News Historical Data:**
- `GET /v1beta1/news` - Historical news (since 2015)
- Query parameters: `symbols`, `start`, `end`, `sort`, `include_content`, `exclude_contentless`
- Average 130+ articles per day
- Source: Benzinga

**For `getTicker()` Implementation:**
- Use `GET /v2/stocks/{symbol}/trades/latest` or `GET /v2/stocks/{symbol}/quotes/latest`
- For crypto: `GET /v1beta3/crypto/us/latest/trades` or `/latest/quotes`
- For options: `GET /v1beta1/options/{symbol}/snapshot`

### WebSocket Streaming

#### Trading API WebSocket (Order Updates)

**Endpoint:** `wss://paper-api.alpaca.markets/stream` (paper) or `wss://api.alpaca.markets/stream` (live)

**Protocol:** RFC6455 WebSocket protocol

**Codecs:** JSON (default) or MessagePack (add `Content-Type: application/msgpack` header)

**Authentication:**
```json
{
  "action": "auth",
  "key": "{YOUR_API_KEY_ID}",
  "secret": "{YOUR_API_SECRET_KEY}"
}
```

**Subscribe to Trade Updates:**
```json
{
  "action": "listen",
  "data": {
    "streams": ["trade_updates"]
  }
}
```

**Trade Update Events:**
- `new` - Order routed to exchanges
- `fill` - Order completely filled
- `partial_fill` - Order partially filled
- `canceled` - Order canceled
- `expired` - Order expired
- `done_for_day` - Order done for the day
- `replaced` - Order replaced
- `rejected` - Order rejected
- And more...

**Note:** WebSocket streaming is recommended for real-time order updates instead of polling REST API.

#### Market Data WebSocket (Real-time Market Data)

**Stock Stream URL:** `wss://stream.data.alpaca.markets/{version}/{feed}`

**Available Feeds:**
- `v2/sip` - SIP feed (all US exchanges, 100% volume)
- `v2/iex` - IEX feed (single exchange, ~2.5% volume)
- `v2/delayed_sip` - 15-minute delayed SIP feed
- `v1beta1/boats` - BOATS feed (overnight trading)
- `v1beta1/overnight` - Alpaca's derived overnight feed

**Sandbox URL:** `wss://stream.data.sandbox.alpaca.markets/{version}/{feed}`

**Authentication:**
```json
{
  "action": "auth",
  "key": "{YOUR_API_KEY_ID}",
  "secret": "{YOUR_API_SECRET_KEY}"
}
```

**Subscribe to Channels:**
```json
{
  "action": "subscribe",
  "trades": ["AAPL"],
  "quotes": ["AMD", "CLDR"],
  "bars": ["*"],
  "dailyBars": ["VOO"],
  "updatedBars": ["SPY"],
  "statuses": ["*"],
  "lulds": ["*"],
  "imbalances": ["INAQU"]
}
```

**Stock Stream Channels:**

**Trades (Type: "t"):**
- `T` - Message type ("t")
- `S` - Symbol
- `i` - Trade ID
- `x` - Exchange code
- `p` - Trade price
- `s` - Trade size
- `c` - Trade conditions (array)
- `t` - Timestamp (RFC-3339)
- `z` - Tape

**Quotes (Type: "q"):**
- `T` - Message type ("q")
- `S` - Symbol
- `ax` - Ask exchange code
- `ap` - Ask price
- `as` - Ask size (round lots)
- `bx` - Bid exchange code
- `bp` - Bid price
- `bs` - Bid size (round lots)
- `c` - Quote conditions (array)
- `t` - Timestamp (RFC-3339)
- `z` - Tape

**Bars (Type: "b", "d", or "u"):**
- `T` - Message type ("b" = minute, "d" = daily, "u" = updated)
- `S` - Symbol
- `o` - Open price
- `h` - High price
- `l` - Low price
- `c` - Close price
- `v` - Volume
- `vw` - Volume-weighted average price
- `n` - Number of trades
- `t` - Timestamp (RFC-3339)

**Trade Corrections (Type: "c"):**
- Auto-subscribed when subscribing to trades
- Contains original and corrected trade information

**Trade Cancels/Errors (Type: "x"):**
- Auto-subscribed when subscribing to trades
- `a` - Action ("C" for cancel, "E" for error)

**LULDs (Type: "l"):**
- Limit Up - Limit Down price bands
- `u` - Limit up price
- `d` - Limit down price
- `i` - Indicator

**Trading Status (Type: "s"):**
- Trading halt/resume information
- `sc` - Status code
- `sm` - Status message
- `rc` - Reason code
- `rm` - Reason message

**Order Imbalances (Type: "i"):**
- Order imbalance during LULD halts
- `p` - Price

**Options Stream URL:** `wss://stream.data.alpaca.markets/v1beta1/{feed}`

**Available Feeds:**
- `indicative` - Indicative pricing feed (free, delayed 15 minutes)
- `opra` - OPRA feed (real-time, requires subscription)

**Note:** Options stream is **only available in MessagePack format** (not JSON).

**Options Stream Channels:**

**Trades (Type: "t"):**
- `S` - Symbol
- `t` - Timestamp
- `p` - Trade price
- `s` - Trade size
- `x` - Exchange code
- `c` - Trade condition

**Quotes (Type: "q"):**
- `S` - Symbol
- `t` - Timestamp
- `bx` - Bid exchange code
- `bp` - Bid price
- `bs` - Bid size
- `ax` - Ask exchange code
- `ap` - Ask price
- `as` - Ask size
- `c` - Quote condition

**Note:** Star subscription (`*`) is NOT allowed for option quotes (too many contracts).

### Advanced Order Types (Elite Only)

**Note:** These features require Alpaca Elite subscription and are not required for initial implementation.

#### DMA Gateway (Direct Market Access)
- Route orders directly to specific exchanges (NYSE, NASDAQ, ARCA)
- Configure via `advanced_instructions` in order payload
- Only supports market and limit orders with `time_in_force: day`

#### VWAP Orders (Volume-Weighted Average Price)
- Execute at or near volume-weighted average price
- Configure via `advanced_instructions` with `algorithm: "VWAP"`
- Parameters: `start_time`, `end_time`, `max_percentage`

#### TWAP Orders (Time-Weighted Average Price)
- Execute evenly over specified time period
- Configure via `advanced_instructions` with `algorithm: "TWAP"`
- Parameters: `start_time`, `end_time`, `max_percentage`

**Note:** Advanced order types are accepted in paper trading but not simulated.

---

## Webhook Integration

### Supported Order Types via Webhooks

Alpaca supports all advanced order types through webhook parameters:

#### Basic Orders

**Market Order (Default):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL"
}
```

**Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00
}
```

#### Advanced Order Types

**Bracket Order (Entry + TP + SL in one order):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "useBracketOrder": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**OTO Order (Entry + either TP or SL):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "useOTOOrder": true,
  "stop_loss_percent": 2
}
```

**OCO Order (TP or SL, not both - for existing positions):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "useOCOOrder": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

#### Stop Loss Types

**Regular Stop Loss:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2
}
```

**Stop-Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "stop_loss_limit_price": 0.50
}
```
*Note: `stop_loss_limit_price` is the offset from stop price (e.g., 0.50 = $0.50 below stop price)*

**Trailing Stop (Dollar Amount):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "useTrailingStop": true,
  "trailing_stop_pips": 5.00
}
```
*Note: For Alpaca, `trailing_stop_pips` is actually dollars, not pips*

**Trailing Stop (Percentage):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "useTrailingStop": true,
  "trailing_stop_percent": 1.5
}
```

#### Fractional Orders

**Automatic Fractional (for positions < $100):**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "position_size_usd": 50.00
}
```
*Automatically uses fractional orders for positions < $100*

**Explicit Fractional:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "position_size_usd": 500.00,
  "useFractional": true
}
```

#### Extended Hours Trading

**Extended Hours Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "extended_hours": true
}
```
*Note: Extended hours requires `orderType: "limit"` and `time_in_force: "day"` (automatically set)*

### Webhook Parameters Reference

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `exchange` | string | Must be `"alpaca"` | `"alpaca"` |
| `action` | string | `"buy"`, `"sell"`, or `"close"` | `"buy"` |
| `symbol` | string | Stock symbol (e.g., `"AAPL"`) | `"AAPL"` |
| `orderType` | string | `"market"` (default) or `"limit"` | `"limit"` |
| `price` | number | Limit price (required for limit orders) | `150.00` |
| `position_size_usd` | number | Position size in USD | `500.00` |
| `stop_loss_percent` | number | Stop loss percentage | `2` |
| `stop_loss_limit_price` | number | Stop-limit offset from stop price | `0.50` |
| `take_profit_percent` | number | Take profit percentage | `5` |
| `useBracketOrder` | boolean | Use bracket order (entry + TP + SL) | `true` |
| `useOCOOrder` | boolean | Use OCO order (TP or SL, not both) | `true` |
| `useOTOOrder` | boolean | Use OTO order (entry + TP or SL) | `true` |
| `useTrailingStop` | boolean | Enable trailing stop | `true` |
| `trailing_stop_pips` | number | Trailing stop dollar amount | `5.00` |
| `trailing_stop_percent` | number | Trailing stop percentage | `1.5` |
| `extended_hours` | boolean | Enable extended hours trading | `true` |
| `useFractional` | boolean | Force fractional order (even for large positions) | `true` |

### Order Type Priority

When multiple order type flags are set, priority is:
1. **Bracket Order** (`useBracketOrder: true`) - If both TP and SL provided
2. **OTO Order** (`useOTOOrder: true`) - If entry + TP or SL
3. **OCO Order** (`useOCOOrder: true`) - If TP and SL (exit only)
4. **Standard Orders** - Market/Limit with separate TP/SL

### Examples

**Complete Example - Bracket Order with Extended Hours:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "position_size_usd": 1000.00,
  "useBracketOrder": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5,
  "extended_hours": true
}
```

**Example - Trailing Stop with Fractional:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "position_size_usd": 75.00,
  "useFractional": true,
  "useTrailingStop": true,
  "trailing_stop_percent": 1.5
}
```

**Example - Stop-Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "position_size_usd": 500.00,
  "stop_loss_percent": 2,
  "stop_loss_limit_price": 0.50
}
```

---

## Testing

### Test Checklist
- [ ] Paper trading account setup
- [ ] API key authentication
- [ ] Balance fetching
- [ ] Market order execution
- [ ] Limit order execution
- [ ] Stop loss order placement
- [ ] Take profit order placement
- [ ] Position tracking
- [ ] Position closing
- [ ] Error handling (invalid credentials, rate limits)
- [ ] Webhook integration test

### Test Account Setup
1. Create Alpaca account at https://alpaca.markets
2. Navigate to API Management
3. Generate API keys (paper trading)
4. Add credentials to SignalStudio
5. Test balance endpoint
6. Test webhook execution

---

## Error Handling

### Common Errors

#### Order Validation Errors
- **400 Bad Request:** Invalid order parameters
  - Example: `"invalid limit_price 290.123. sub-penny increment does not fulfill minimum pricing criteria"`
  - Limit price >= $1.00: Max 2 decimals
  - Limit price < $1.00: Max 4 decimals
- **400 Bad Request:** Both `qty` and `notional` provided (fractional orders)
- **400 Bad Request:** Asset not fractionable (fractional order on non-fractionable asset)
- **400 Bad Request:** Insufficient buying power
- **400 Bad Request:** Order rejected by exchange

#### Account Errors
- **403 Forbidden:** Account blocked or trading suspended
- **403 Forbidden:** Pattern day trader restriction (4th day trade with < $25k equity)

#### Order Status Errors
- **Order Rejected:** Order rejected by exchange
- **Order Expired:** Order expired (GTC orders auto-cancel after 90 days)

### Retry Logic
- Retry on 5xx errors (up to 3 times)
- Exponential backoff (1s, 2s, 4s)
- Rate limit handling (429 errors)
- **Do NOT retry** on 4xx errors (client errors, validation failures)

---

## Rate Limits

**Trading API:**
- Rate limits not explicitly documented, but best practices:
  - Implement reasonable rate limiting (e.g., 200 requests/minute)
  - Use WebSocket streaming for real-time updates instead of polling
  - Respect 429 (Too Many Requests) responses with exponential backoff
  - Reuse HTTP connections for better performance

**Market Data API:**
- **Basic Plan:** 200 requests/minute
- **Algo Trader Plus:** 10,000 requests/minute
- **Broker Partners:** Varies by subscription (1,000 - 10,000 RPM)

**Recommended Approach:**
- Use WebSocket for order updates (`trade_updates` stream)
- Use WebSocket for real-time market data (stocks, crypto, options)
- Use REST API for order placement and account queries
- Use Historical API for backtesting and analysis
- Implement request queuing if needed for high-frequency trading

---

## Exchange-Specific Notes

### Order Types

#### Basic Order Types
- **Market orders** - Execute immediately at market price
- **Limit orders** - Execute at specified price or better
- **Stop orders** - Trigger when price reaches stop price
- **Stop limit orders** - Stop order with limit price
- **Trailing stop orders** - Stop that trails price by $ or %

#### Advanced Order Types (Stocks Only)
- **Bracket orders** - Entry + stop loss + take profit in one order
  - Entry order fills → activates TP and SL orders
  - Only one exit order can execute (other is canceled)
  - `time_in_force`: day or gtc
  - Extended hours not supported
  - Order replacement (PATCH) supported
- **OCO orders** - One-cancels-other (stop loss OR take profit)
  - Exit orders only (entry already filled)
  - `type` must be `limit`
  - Order replacement (PATCH) supported
- **OTO orders** - One-triggers-other (entry triggers stop loss)
  - Entry + either TP or SL (not both)
  - Order replacement not yet supported

#### Order Lifecycle & Statuses

**Common Statuses:**
- `new` - Order received and routed to exchanges
- `partially_filled` - Order partially filled
- `filled` - Order completely filled
- `done_for_day` - Order done for the day
- `canceled` - Order canceled
- `expired` - Order expired
- `replaced` - Order replaced
- `pending_cancel` - Order waiting to be canceled
- `pending_replace` - Order waiting to be replaced

**Less Common Statuses:**
- `accepted` - Received by Alpaca, not yet routed
- `pending_new` - Routed to exchanges, not yet accepted
- `accepted_for_bidding` - Received by exchanges, evaluated for pricing
- `stopped` - Order stopped, trade guaranteed
- `rejected` - Order rejected
- `suspended` - Order suspended, not eligible for trading
- `calculated` - Completed for day, settlement calculations pending

**Order Cancellation:**
- Can cancel up until order reaches `filled`, `canceled`, or `expired` status

### Position Sizing

#### Fractional Trading
- **Fractional shares supported** - Can buy as little as $1 worth for 2,000+ US equities
- **Order Types:** Market, Limit, Stop, Stop Limit (with `time_in_force=day`)
- **Extended Hours:** Supported for fractional trading (pre-market, after-hours, overnight)
- **Notional or Quantity:** Can use either `notional` (USD amount) or `qty` (fractional shares)
  - Both fields support up to 9 decimal points
  - If both provided, request will be rejected (400 error)
- **Short Sales:** Not supported for fractional orders (all fractional sell orders are marked long)
- **Dividends:** Proportional to fractional share ownership (rounded to nearest penny)
- **Check Eligibility:** Query asset with `fractionable: true` attribute

**Example Fractional Order (Notional):**
```json
{
  "symbol": "AAPL",
  "notional": 500.75,
  "side": "buy",
  "type": "market",
  "time_in_force": "day"
}
```

**Example Fractional Order (Quantity):**
```json
{
  "symbol": "AAPL",
  "qty": 3.654,
  "side": "buy",
  "type": "market",
  "time_in_force": "day"
}
```

#### Whole Share Orders
- Standard position sizing in whole shares
- Minimum order size: 1 share (or fractional if supported)

### Market Hours

#### Regular Trading Hours
- **Core Session:** 9:30 AM - 4:00 PM ET (Monday to Friday)

#### Extended Hours Trading
- **Overnight:** 8:00 PM - 4:00 AM ET (Sunday to Friday)
- **Pre-market:** 4:00 AM - 9:30 AM ET (Monday to Friday)
- **After-hours:** 4:00 PM - 8:00 PM ET (Monday to Friday)

**Extended Hours Eligibility:**
- Set `extended_hours: true` in order request
- **Only limit orders** with `time_in_force: day` are accepted
- All other order types/TIFs will be rejected
- Fractional orders supported during extended hours
- Short selling treated the same as regular hours

**Orders Outside Trading Hours:**
- Orders not eligible for extended hours submitted after 4:00pm ET → queued for next trading day
- Orders eligible for extended hours submitted outside 4:00am - 8:00pm ET → handled per extended hours rules

### Asset Classes

#### Stocks
- **US Equities:** Listed US stocks
- **Fractional Trading:** Supported (minimum $1)
- **Market Hours:** Extended hours (pre-market, regular, after-hours)

#### Crypto
- **Supported:** 20+ unique crypto assets across 56 trading pairs
- **Trading Pairs:** Based on BTC, USD, USDT, USDC
- **Symbol Format:** `BTC/USD`, `ETH/USD`, `ETH/BTC` (legacy `BTCUSD` also supported)
- **Trading Hours:** 24/7 (all day, every day)
- **Order Types:** Market, Limit, Stop Limit
- **Time in Force:** `gtc`, `ioc`
- **Fractional Orders:** Supported (with `notional` or `qty`)
- **Margin:** **NOT supported** - Crypto cannot be bought on margin (uses `non_marginable_buying_power`)
- **Short Selling:** **NOT supported** - Cryptocurrencies cannot be sold short
- **Trading Limits:** Max $200k notional per order
- **Fees:** Volume-tiered maker/taker fees (0.15% - 0.00% maker, 0.25% - 0.10% taker)
- **Query Assets:** `GET /v2/assets?asset_class=crypto`

#### Options
- **Enablement:** Enabled by default in Paper, requires approval in Live
- **Trading Levels:**
  - **Level 0:** Options trading disabled
  - **Level 1:** Sell covered call, Sell cash-secured put
  - **Level 2:** Level 1 + Buy call, Buy put
  - **Level 3:** Level 1,2 + Multi-leg orders (spreads, iron condor, etc.)
- **Order Types:** Market, Limit (only)
- **Time in Force:** `day` (only)
- **Extended Hours:** Must be `false` or not populated
- **Quantity:** Must be whole number (no fractional)
- **Notional:** Must NOT be populated
- **Contract Format:** `AAPL240119C00150000` (OCC format)
- **Multi-leg Orders:** Supported (call spreads, put spreads, iron condor, etc.)
- **Exercise:** Automatic for ITM contracts at expiry (unless DNE)
- **Assignment:** Delivered via Activities API (not websocket)

### Account Features

#### Margin Trading
- **Requirement:** $2,000+ equity for margin trading
- **Buying Power Multipliers:**
  - **1x:** Standard limited margin account (1x BP)
  - **2x:** Reg T margin account (2x intraday and overnight BP) - Default for non-PDT accounts with $2,000+ equity
  - **4x:** PDT account (4x intraday BP, 2x overnight BP) - Requires $25,000+ equity
- **Initial Margin:** 50% for marginable securities, 100% for non-marginable
- **Maintenance Margin:** Varies by security (typically 30% for long positions >= $2.50)
- **Margin Interest Rate:** 4.75% (elite) or 6.25% (non-elite) annually
- **Interest Calculation:** Charged only on overnight debit balance
- **Margin Calls:** Contacted if margin requirements not met

#### Short Selling
- **Requirement:** $2,000+ equity
- **Easy-to-Borrow (ETB):** $0 borrow fees for ETB securities
- **Hard-to-Borrow (HTB):** Not currently supported for opening positions
- **Daily Updates:** Borrow availability updated each morning via Assets API
- **HTB Fees:** Charged if holding HTB short positions (contact support for rates)

#### Pattern Day Trader (PDT)
- **Rule:** 4th day trade within 5 business days requires $25,000+ equity
- **Restriction:** Accounts with < $25k equity limited to 3 day trades per 5 days
- **Paper Trading:** Simulates PDT checks
- **Crypto:** PDT checks do NOT count towards crypto orders

#### Paper Trading
- **Free:** Available to all Alpaca users
- **Default Balance:** $100k
- **Reset:** Can create/delete paper accounts (not just reset)
- **Real-time Data:** Free IEX real-time data
- **Simulation:** Simulates fills but doesn't account for market impact, slippage, regulatory fees
- **Limitations:** No dividends, no borrow fees (coming soon), no order fill emails

#### Account Status
- `ACTIVE` - Account is active for trading
- `ONBOARDING` - Account is onboarding
- `SUBMITTED` - Account application submitted for review
- `ACCOUNT_UPDATED` - Account information being updated
- `APPROVAL_PENDING` - Final account approval pending
- `REJECTED` - Account application rejected
- `SUBMISSION_FAILED` - Account application submission failed

### Important Notes

#### Paper Trading
- **Paper vs Live:** Paper trading simulates fills but doesn't account for market impact, slippage, or regulatory fees
- **Borrow Fees:** Not simulated in paper trading (coming soon)
- **Dividends:** Not simulated in paper trading
- **Order Fills:** Orders only fill when marketable (limit orders must be at or better than best bid/ask)
- **Partial Fills:** 10% chance of partial fills for marketable orders
- **Default Balance:** $100k in paper trading account
- **Reset:** Can create/delete paper accounts (not just reset)

#### Crypto Trading
- **Margin:** Cryptocurrencies **cannot** be bought on margin (uses `non_marginable_buying_power`)
- **Short Selling:** Cryptocurrencies **cannot** be sold short
- **Trading Hours:** 24/7 (all day, every day)
- **Trading Limits:** Max $200k notional per order
- **Fees:** Volume-tiered (0.15% - 0.00% maker, 0.25% - 0.10% taker)
- **Symbol Format:** Use `BTC/USD` format (legacy `BTCUSD` also supported)
- **Fractional Orders:** Supported with `notional` or `qty`

#### Options Trading
- **Enablement:** Enabled by default in Paper, requires approval in Live
- **Trading Levels:** 0 (disabled), 1 (covered calls/puts), 2 (+ buy calls/puts), 3 (+ multi-leg)
- **Order Restrictions:**
  - `time_in_force` must be `day` (only)
  - `extended_hours` must be `false` or not populated
  - `qty` must be whole number (no fractional)
  - `notional` must NOT be populated
  - `type` must be `market` or `limit` (only)
- **Exercise:** Automatic for ITM contracts at expiry (unless DNE)
- **Assignment:** Delivered via Activities API (not websocket)
- **Multi-leg Orders:** Supported for Level 3 (spreads, iron condor, etc.)

---

## Marketing/Feature Documentation

### Key Features
- ✅ Commission-free trading
- ✅ Paper trading for testing
- ✅ Extended hours trading
- ✅ Fractional shares
- ✅ API-first broker
- ✅ Real-time market data

### Supported Markets
- US Stocks
- US Options
- US Crypto

### Benefits for Users
- No commission fees
- Easy API integration
- Paper trading for strategy testing
- Extended hours access
- Fractional share support

---

## Implementation Checklist

### Sparky Bot
- [x] Create `alpacaApi.js` extending `BaseExchangeAPI`
- [x] Implement all required methods
- [x] Add to `ExchangeFactory.js`
- [x] Update `TradeExecutor.getAssetClass()` (returns 'stocks')
- [x] Add trailing stop support
- [x] Add bracket order support
- [x] Add stop-limit order support
- [x] Add fractional order support
- [x] Add extended hours trading support
- [x] Add OCO/OTO order support
- [x] Test with paper account (pending)
- [x] Test all order types (pending)
- [x] Test error handling (pending)
- [x] Update `EXCHANGES.md` documentation (pending)

### SignalStudio Dashboard
- [x] Add to `exchangeMetadata.ts`
- [x] Create balance endpoint
- [x] Test balance fetching (pending)
- [x] Verify credential form works (pending)

### Documentation
- [x] Update `EXCHANGES.md` with Alpaca section (pending)
- [x] Add API reference details
- [x] Document webhook parameters
- [x] Document advanced order types
- [x] Add troubleshooting section (pending)

---

## Next Steps

1. Review API documentation (4 files to be provided)
2. Implement exchange adapter
3. Integrate into ExchangeFactory
4. Create SignalStudio balance endpoint
5. Test with paper account
6. Update documentation
7. Deploy to production

---

**Last Updated:** December 2024  
**Version:** 1.0 (Draft)
