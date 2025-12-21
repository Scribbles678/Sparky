# Kalshi Exchange Integration

**Status:** 🚧 Implemented  
**Last Updated:** December 2025  
**Exchange Type:** Prediction Markets (Binary Markets)

---

## Overview

Kalshi is a regulated prediction market exchange where users trade on the outcome of future events. Unlike traditional exchanges, Kalshi uses binary markets (YES/NO positions) with prices ranging from 1¢ to 99¢.

### Key Characteristics

- **Binary Markets:** Each market has YES and NO positions that must sum to 100¢
- **Price Range:** 1¢ to 99¢ (subpenny pricing coming soon)
- **Reciprocal Orderbook:** YES bids imply NO asks and vice versa
- **RSA-PSS Authentication:** More complex than standard API key authentication
- **Rate Limits:** Tier-based (Basic: 20 read/10 write per second)

---

## Authentication

### API Key Generation

1. Log in to Kalshi account
2. Navigate to **Account Settings** → **API Keys**
3. Click **"Create New API Key"**
4. **IMPORTANT:** Save the private key immediately - it cannot be retrieved later
5. Store both:
   - **Key ID** (KALSHI-ACCESS-KEY)
   - **Private Key** (RSA_PRIVATE_KEY format)

### Request Signing

Each API request requires three headers:

```
KALSHI-ACCESS-KEY: <your-key-id>
KALSHI-ACCESS-TIMESTAMP: <timestamp-in-ms>
KALSHI-ACCESS-SIGNATURE: <base64-encoded-signature>
```

**Signature Generation:**
1. Strip query parameters from path (e.g., `/trade-api/v2/portfolio/orders?limit=5` → `/trade-api/v2/portfolio/orders`)
2. Concatenate: `timestamp + method + path_without_query`
3. Sign with RSA-PSS using SHA-256
4. Base64 encode the signature

**Example (Node.js):**
```javascript
const crypto = require('crypto');

function signPssText(privateKeyPem, text) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(text);
  sign.end();

  const signature = sign.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return signature.toString('base64');
}

// Usage
const timestamp = Date.now().toString();
const method = 'GET';
const path = '/trade-api/v2/portfolio/balance';
const pathWithoutQuery = path.split('?')[0];
const msgString = timestamp + method + pathWithoutQuery;
const signature = signPssText(privateKeyPem, msgString);
```

---

## API Endpoints

### Base URLs

- **Production:** `https://api.kalshi.com/trade-api/v2`
- **Demo:** `https://demo-api.kalshi.com/trade-api/v2`

### Key Endpoints

> **Note:** Full endpoint documentation will be added as implementation progresses.

#### Account/Portfolio (✅ Documented)
- `GET /portfolio/balance` - Get account balance
- `GET /portfolio/positions` - Get open positions (market & event positions)
- `GET /portfolio/fills` - Get trade history (fills)
- `GET /portfolio/settlements` - Get settlement history
- `GET /portfolio/summary/total_resting_order_value` - Get total resting order value (FCM only)

#### Market Data (✅ Documented)
- `GET /markets` - List markets (supports pagination, filtering)
- `GET /markets/{ticker}` - Get market details
- `GET /markets/{ticker}/orderbook` - Get market orderbook
- `GET /markets/trades` - Get all trades (paginated)
- `GET /series/{series_ticker}` - Get series details
- `GET /series/{series_ticker}/markets/{ticker}/candlesticks` - Get market candlesticks

#### Events (✅ Documented)
- `GET /events` - List events (excludes multivariate events)
- `GET /events/{event_ticker}` - Get event details
- `GET /events/{event_ticker}/metadata` - Get event metadata
- `GET /series/{series_ticker}/events/{ticker}/candlesticks` - Get event candlesticks (aggregated)
- `GET /series/{series_ticker}/events/{ticker}/forecast_percentile_history` - Get forecast percentile history

#### Exchange Status (✅ Documented)
- `GET /exchange/status` - Get exchange status (trading active, exchange active)
- `GET /exchange/schedule` - Get exchange trading schedule

#### Search (✅ Documented)
- `GET /search/tags_by_categories` - Get tags organized by series categories
- `GET /search/filters_by_sport` - Get filters organized by sport

#### Live Data (✅ Documented)
- `GET /live_data/{type}/milestone/{milestone_id}` - Get live data for a specific milestone
- `GET /live_data/batch` - Get live data for multiple milestones

#### Order Management (✅ Documented)
- `POST /portfolio/orders` - Create order
- `GET /portfolio/orders` - List orders (with filtering)
- `GET /portfolio/orders/{order_id}` - Get single order
- `DELETE /portfolio/orders/{order_id}` - Cancel order
- `POST /portfolio/orders/batched` - Batch create orders (max 20)
- `DELETE /portfolio/orders/batched` - Batch cancel orders (max 20)
- `POST /portfolio/orders/{order_id}/amend` - Amend order (price/quantity)
- `POST /portfolio/orders/{order_id}/decrease` - Decrease order quantity

---

## Market Structure

### Terminology

- **Market:** A single binary market (YES/NO positions)
- **Event:** A collection of markets (the basic unit members interact with)
- **Series:** A collection of related events with the same ticker prefix
- **Ticker:** Market identifier (e.g., `KXHIGHNY-24JAN01-T60`)

### Orderbook Structure

Kalshi orderbooks only show **bids** (not asks) due to the reciprocal nature of binary markets:

```json
{
  "orderbook": {
    "yes": [
      [1, 200],    // 200 contracts bid at 1¢
      [15, 100],   // 100 contracts bid at 15¢
      [42, 13]     // 13 contracts bid at 42¢ (best bid)
    ],
    "no": [
      [1, 100],    // 100 contracts bid at 1¢
      [38, 300],   // 300 contracts bid at 38¢
      [56, 17]     // 17 contracts bid at 56¢ (best bid)
    ]
  }
}
```

**Reciprocal Relationships:**
- YES BID at 60¢ = NO ASK at 40¢
- NO BID at 30¢ = YES ASK at 70¢
- Best YES ask = 100 - (Best NO bid)
- Best NO ask = 100 - (Best YES bid)

### Price Format

Currently prices are in **integer cents** (1-99), but subpenny pricing is coming:

```json
{
  "price": 12,              // legacy: cents
  "price_dollars": "0.1200" // new: fixed-point dollars (4 decimals)
}
```

**Important:** Systems should parse both formats and prepare for subpenny precision.

---

## Rate Limits

Kalshi uses tier-based rate limits:

| Tier | Read (per second) | Write (per second) | Qualification |
|------|-------------------|---------------------|---------------|
| Basic | 20 | 10 | Completing signup |
| Advanced | 30 | 30 | Complete [Advanced API form](https://kalshi.typeform.com/advanced-api) |
| Premier | 100 | 100 | 3.75% of exchange traded volume + technical competency |
| Prime | 400 | 400 | 7.5% of exchange traded volume + technical competency |

**Write Operations** (count toward write limit):
- `BatchCreateOrders` (each item = 1 transaction)
- `BatchCancelOrders` (each cancel = 0.2 transactions)
- `CreateOrder`
- `CancelOrder`
- `AmendOrder`
- `DecreaseOrder`

---

## Pagination

Kalshi uses **cursor-based pagination**:

```javascript
async function getAllMarkets(seriesTicker) {
  const allMarkets = [];
  let cursor = null;
  const baseUrl = 'https://api.kalshi.com/trade-api/v2/markets';

  while (true) {
    let url = `${baseUrl}?series_ticker=${seriesTicker}&limit=100`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    allMarkets.push(...data.markets);

    cursor = data.cursor;
    if (!cursor) break;
  }

  return allMarkets;
}
```

**Pagination Parameters:**
- `cursor`: Token from previous response
- `limit`: Items per page (1-100, default: 100)

---

## Implementation Decision: REST API (Custom Implementation)

**Decision:** Use REST API with custom Node.js implementation (not SDK, not WebSockets)

**Rationale:**
- ✅ **Consistency:** Sparky uses REST for all exchanges (Aster, OANDA, Tradier)
- ✅ **Compatibility:** Kalshi SDKs are Python/TypeScript; Sparky is Node.js
- ✅ **Control:** Custom implementation matches existing codebase patterns
- ✅ **Sufficient:** REST polling (30s intervals) works for Sparky's use case
- ⏭️ **WebSockets:** Can add later if real-time updates become critical

**Note:** WebSockets would be useful for real-time order fills and especially for the AI Signal Engine (see "Future Enhancement: WebSocket Support" section below), but REST polling is sufficient for initial implementation.

---

## Implementation Plan

### Phase 1: Core Infrastructure ✅

- [x] Review Kalshi API documentation
- [x] Understand authentication mechanism (RSA-PSS)
- [x] Document market structure and orderbook format
- [x] **Decision:** Use REST API (custom implementation)
- [ ] Create `KalshiAPI` class extending `BaseExchangeAPI`
- [ ] Implement RSA-PSS signature authentication
- [ ] Add request signing helper methods

### Phase 2: Account & Market Data ✅

- [x] **Documented:** Portfolio endpoints (balance, positions, fills, settlements)
- [x] **Documented:** Market data endpoints (markets, orderbook, trades, candlesticks)
- [ ] Implement `getBalance()` - Get account balance
- [ ] Implement `getPositions()` - Get open positions (market & event positions)
- [ ] Implement `getTicker()` - Get market price/orderbook
- [ ] Implement `getMarkets()` - List/search markets
- [ ] Implement `getMarket()` - Get market details
- [ ] Implement `getOrderbook()` - Get market orderbook
- [ ] Implement `getFills()` - Get trade history
- [ ] Add market search/filtering methods
- [ ] Handle pagination for list endpoints

### Phase 3: Order Management ✅

- [x] **Documented:** Order endpoints and structure
- [ ] Implement `placeMarketOrder()` - Place market order
- [ ] Implement `placeLimitOrder()` - Place limit order
- [ ] Implement `cancelOrder()` - Cancel order
- [ ] Implement `getOrder()` - Get order status
- [ ] Implement `getOrders()` - List orders with filtering
- [ ] Handle order types (YES/NO positions, buy/sell actions)
- [ ] Support batch operations (optional)
- [ ] Support order amendment and decrease (optional)

### Phase 4: Integration

- [ ] Add Kalshi to `ExchangeFactory`
- [ ] Map credentials in `mapCredentialsToConfig()`
- [ ] Update `getAssetClass()` in `TradeExecutor` (new asset class: `prediction`)
- [ ] Add Kalshi to `exchangeAssetMap`
- [ ] Update `EXCHANGES.md` reference documentation
- [ ] Test with demo environment

### Phase 5: Database Schema

- [ ] Update `bot_credentials` table to support RSA private keys
- [ ] Add Kalshi-specific credential fields
- [ ] Document credential storage format

### Phase 6: Testing & Documentation

- [ ] Test all endpoints in demo environment
- [ ] Test multi-tenant credential loading
- [ ] Test order placement and cancellation
- [ ] Test position tracking
- [ ] Update this document with final implementation details
- [ ] Add examples to `EXCHANGES.md`

### Phase 7: WebSocket Support (Future Enhancement)

- [ ] Research Kalshi WebSocket API documentation
- [ ] Create WebSocket client module with connection management
- [ ] Implement WebSocket authentication
- [ ] Integrate with AI Worker for event-driven decisions
- [ ] Add real-time orderbook streaming
- [ ] Add trade flow data streaming
- [ ] Optional: Real-time position tracking via WebSocket

---

## Credential Storage

### Supabase Schema

Kalshi requires:
- **Key ID** (`api_key` field)
- **Private Key** (`api_secret` field - RSA_PRIVATE_KEY format)
- **Environment** (`environment` field: `production` or `demo`)

**Example `bot_credentials` record:**
```json
{
  "user_id": "uuid",
  "exchange": "kalshi",
  "api_key": "a952bcbe-ec3b-4b5b-b8f9-11dae589608c",
  "api_secret": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
  "environment": "production",
  "label": "Kalshi Production"
}
```

**Security Considerations:**
- Private keys should be encrypted at rest
- Never log private keys
- Use environment-specific keys (demo vs production)

---

## Order Management Details

### Order Structure

Kalshi orders have a specific structure for binary prediction markets:

```json
{
  "order_id": "string",
  "user_id": "string",
  "client_order_id": "string",
  "ticker": "string",
  "side": "yes" | "no",
  "action": "buy" | "sell",
  "type": "limit" | "market",
  "status": "resting" | "canceled" | "executed",
  "yes_price": 123,              // Legacy: cents (1-99)
  "no_price": 123,                // Legacy: cents (1-99)
  "yes_price_dollars": "0.5600",  // New: fixed-point dollars
  "no_price_dollars": "0.5600",  // New: fixed-point dollars
  "fill_count": 123,
  "remaining_count": 123,
  "initial_count": 123,
  "taker_fees": 123,
  "maker_fees": 123,
  "taker_fill_cost": 123,
  "maker_fill_cost": 123,
  "queue_position": 123,
  "expiration_time": "2023-11-07T05:31:56Z",
  "created_time": "2023-11-07T05:31:56Z",
  "last_update_time": "2023-11-07T05:31:56Z"
}
```

### Creating Orders

**Endpoint:** `POST /portfolio/orders`

**Required Parameters:**
- `ticker` (string) - Market ticker
- `side` (`"yes"` | `"no"`) - Which side of the binary market
- `action` (`"buy"` | `"sell"`) - Buy or sell contracts
- `count` (integer, >= 1) - Number of contracts

**Price Specification (for limit orders):**
- Use **either** legacy cents format **or** fixed-point dollars format:
  - Legacy: `yes_price` (1-99) or `no_price` (1-99)
  - New: `yes_price_dollars` (e.g., "0.5600") or `no_price_dollars` (e.g., "0.5600")
- **Important:** For binary markets, YES price + NO price = 100¢
- If you specify `yes_price`, the `no_price` is implied (100 - yes_price)
- If you specify `no_price`, the `yes_price` is implied (100 - no_price)

**Optional Parameters:**
- `type` (`"limit"` | `"market"`) - Default: `"limit"`
- `client_order_id` (string) - Custom order ID for tracking
- `expiration_ts` (integer) - Unix timestamp for order expiration
- `time_in_force` (`"fill_or_kill"` | `"good_till_canceled"` | `"immediate_or_cancel"`)
- `buy_max_cost` (integer) - Maximum cost in cents (auto FoK behavior)
- `post_only` (boolean) - Only place as maker
- `reduce_only` (boolean) - Only reduce position size
- `self_trade_prevention_type` (`"taker_at_cross"` | `"maker"`)
- `cancel_order_on_pause` (boolean) - Cancel if exchange pauses

**Example: Buy 10 YES contracts at 60¢**
```json
{
  "ticker": "KXHIGHNY-24JAN01-T60",
  "side": "yes",
  "action": "buy",
  "count": 10,
  "type": "limit",
  "yes_price": 60
}
```

**Example: Market order (no price needed)**
```json
{
  "ticker": "KXHIGHNY-24JAN01-T60",
  "side": "yes",
  "action": "buy",
  "count": 10,
  "type": "market"
}
```

### Getting Orders

**Endpoint:** `GET /portfolio/orders`

**Query Parameters:**
- `ticker` (string) - Filter by market ticker
- `event_ticker` (string) - Filter by event ticker (comma-separated, max 10)
- `status` (string) - Filter by status: `resting`, `canceled`, `executed`
- `min_ts` (integer) - Filter items after this Unix timestamp
- `max_ts` (integer) - Filter items before this Unix timestamp
- `limit` (integer, 1-200) - Results per page (default: 100)
- `cursor` (string) - Pagination cursor

**Response:**
```json
{
  "orders": [...],
  "cursor": "string"
}
```

### Getting Single Order

**Endpoint:** `GET /portfolio/orders/{order_id}`

Returns a single order object.

### Canceling Orders

**Endpoint:** `DELETE /portfolio/orders/{order_id}`

**Note:** This doesn't actually delete the order (it may be partially filled). Instead, it reduces the remaining contracts to zero.

**Response:**
```json
{
  "order": {...},
  "reduced_by": 123
}
```

### Batch Operations

**Batch Create Orders:** `POST /portfolio/orders/batched`
- Max 20 orders per batch
- Each order counts toward rate limit
- Response includes success/error for each order

**Batch Cancel Orders:** `DELETE /portfolio/orders/batched`
- Max 20 order IDs per batch
- Each cancel counts as 0.2 transactions toward rate limit
- Request body: `{ "ids": ["order_id1", "order_id2", ...] }`

### Order Amendment

**Endpoint:** `POST /portfolio/orders/{order_id}/amend`

Allows updating price and/or quantity of an existing order.

**Required Parameters:**
- `ticker` (string)
- `side` (`"yes"` | `"no"`)
- `action` (`"buy"` | `"sell"`)
- `client_order_id` (string) - Original client order ID
- `updated_client_order_id` (string) - New client order ID

**Optional Parameters:**
- `yes_price` or `no_price` or `yes_price_dollars` or `no_price_dollars` (exactly one)
- `count` (integer, >= 1) - Updated quantity

### Order Decrease

**Endpoint:** `POST /portfolio/orders/{order_id}/decrease`

Decreases the number of contracts in an existing order.

**Body Parameters:**
- `reduce_by` (integer, >= 1) - Reduce by this amount
- `reduce_to` (integer, >= 0) - Reduce to this amount

**Note:** Canceling an order is equivalent to decreasing to zero.

---

## Portfolio Endpoints Details

### Get Balance

**Endpoint:** `GET /portfolio/balance`

**Response:**
```json
{
  "balance": 123,              // Available balance in cents
  "portfolio_value": 123,      // Total portfolio value in cents
  "updated_ts": 123            // Unix timestamp of last update
}
```

**Key Fields:**
- `balance`: Available balance for trading (in cents)
- `portfolio_value`: Current value of all positions (in cents)
- `updated_ts`: Last update timestamp

### Get Positions

**Endpoint:** `GET /portfolio/positions`

**Query Parameters:**
- `cursor` (string) - Pagination cursor
- `limit` (integer, 1-1000) - Results per page (default: 100)
- `count_filter` (string) - Filter by non-zero fields: `position`, `total_traded` (comma-separated)
- `ticker` (string) - Filter by market ticker
- `event_ticker` (string) - Filter by event ticker (comma-separated, max 10)

**Response:**
```json
{
  "market_positions": [
    {
      "ticker": "string",
      "total_traded": 123,                    // Total contracts traded
      "total_traded_dollars": "0.5600",
      "position": 123,                        // Current position (positive = YES, negative = NO)
      "market_exposure": 123,                 // Market exposure in cents
      "market_exposure_dollars": "0.5600",
      "realized_pnl": 123,                    // Realized P&L in cents
      "realized_pnl_dollars": "0.5600",
      "resting_orders_count": 123,           // Number of resting orders
      "fees_paid": 123,                       // Fees paid in cents
      "fees_paid_dollars": "0.5600",
      "last_updated_ts": "2023-11-07T05:31:56Z"
    }
  ],
  "event_positions": [
    {
      "event_ticker": "string",
      "total_cost": 123,                      // Total cost in cents
      "total_cost_dollars": "0.5600",
      "total_cost_shares": 123,               // Total cost in shares
      "event_exposure": 123,                  // Event exposure in cents
      "event_exposure_dollars": "0.5600",
      "realized_pnl": 123,
      "realized_pnl_dollars": "0.5600",
      "fees_paid": 123,
      "fees_paid_dollars": "0.5600"
    }
  ],
  "cursor": "string"
}
```

**Key Concepts:**
- **Market Positions:** Individual market positions (YES/NO contracts)
- **Event Positions:** Aggregated positions across all markets in an event
- **Position Value:** Positive = YES position, Negative = NO position
- **Market Exposure:** Current value of position at market prices

### Get Fills

**Endpoint:** `GET /portfolio/fills`

A fill represents when a trade is matched/executed.

**Query Parameters:**
- `ticker` (string) - Filter by market ticker
- `order_id` (string) - Filter by order ID
- `min_ts` (integer) - Filter after this Unix timestamp
- `max_ts` (integer) - Filter before this Unix timestamp
- `limit` (integer, 1-200) - Results per page (default: 100)
- `cursor` (string) - Pagination cursor

**Response:**
```json
{
  "fills": [
    {
      "fill_id": "string",
      "trade_id": "string",
      "order_id": "string",
      "ticker": "string",
      "market_ticker": "string",
      "side": "yes" | "no",
      "action": "buy" | "sell",
      "count": 123,                           // Number of contracts filled
      "price": 123,                           // Fill price in cents
      "yes_price": 123,
      "no_price": 123,
      "yes_price_fixed": "0.5600",
      "no_price_fixed": "0.5600",
      "is_taker": true,                       // true = taker, false = maker
      "client_order_id": "string",
      "created_time": "2023-11-07T05:31:56Z",
      "ts": 123                               // Unix timestamp
    }
  ],
  "cursor": "string"
}
```

### Get Settlements

**Endpoint:** `GET /portfolio/settlements`

Get historical settlement data (when markets resolve).

**Query Parameters:**
- `limit` (integer, 1-200) - Results per page (default: 100)
- `cursor` (string) - Pagination cursor
- `ticker` (string) - Filter by market ticker
- `event_ticker` (string) - Filter by event ticker (comma-separated, max 10)
- `min_ts` (integer) - Filter after this Unix timestamp
- `max_ts` (integer) - Filter before this Unix timestamp

**Response:**
```json
{
  "settlements": [
    {
      "ticker": "string",
      "market_result": "yes" | "no",          // Market outcome
      "yes_count": 123,                       // YES contracts held
      "yes_total_cost": 123,                  // Total cost of YES contracts
      "no_count": 123,                        // NO contracts held
      "no_total_cost": 123,                   // Total cost of NO contracts
      "revenue": 123,                         // Revenue from settlement
      "settled_time": "2023-11-07T05:31:56Z",
      "fee_cost": "0.3400",
      "value": 123                            // Settlement value
    }
  ],
  "cursor": "string"
}
```

---

## Market Data Endpoints Details

### Get Markets

**Endpoint:** `GET /markets`

List/search markets with extensive filtering options.

**Query Parameters:**
- `limit` (integer, 1-1000) - Results per page (default: 100)
- `cursor` (string) - Pagination cursor
- `event_ticker` (string) - Filter by event ticker (comma-separated, max 10)
- `series_ticker` (string) - Filter by series ticker
- `status` (string) - Filter by status: `unopened`, `open`, `closed`, `settled`
- `tickers` (string) - Filter by specific market tickers (comma-separated)
- `min_created_ts`, `max_created_ts` (integer) - Filter by creation time
- `min_close_ts`, `max_close_ts` (integer) - Filter by close time
- `min_settled_ts`, `max_settled_ts` (integer) - Filter by settlement time
- `mve_filter` (string) - Filter multivariate events: `only`, `exclude`

**Response:**
```json
{
  "markets": [
    {
      "ticker": "string",
      "event_ticker": "string",
      "market_type": "binary",
      "title": "string",
      "subtitle": "string",
      "yes_sub_title": "string",
      "no_sub_title": "string",
      "status": "initialized" | "unopened" | "open" | "closed" | "settled",
      "yes_bid": 123,                         // Best YES bid in cents
      "yes_bid_dollars": "0.5600",
      "yes_ask": 123,                         // Best YES ask in cents
      "yes_ask_dollars": "0.5600",
      "no_bid": 123,                          // Best NO bid in cents
      "no_bid_dollars": "0.5600",
      "no_ask": 123,                          // Best NO ask in cents
      "no_ask_dollars": "0.5600",
      "last_price": 123,                      // Last trade price
      "last_price_dollars": "0.5600",
      "volume": 123,                          // Total volume
      "volume_24h": 123,                     // 24-hour volume
      "result": "yes" | "no" | null,          // Market result (if settled)
      "open_interest": 123,                   // Open interest
      "liquidity": 123,                       // Market liquidity
      "liquidity_dollars": "0.5600",
      "created_time": "2023-11-07T05:31:56Z",
      "open_time": "2023-11-07T05:31:56Z",
      "close_time": "2023-11-07T05:31:56Z",
      "expiration_time": "2023-11-07T05:31:56Z",
      "settlement_value": 123,                // Settlement value (if settled)
      "settlement_value_dollars": "0.5600"
    }
  ],
  "cursor": "string"
}
```

**Key Fields:**
- `status`: Market lifecycle status
- `yes_bid`/`yes_ask`: Best bid/ask for YES side
- `no_bid`/`no_ask`: Best bid/ask for NO side
- `last_price`: Last executed trade price
- `volume`: Total trading volume
- `open_interest`: Total open positions

### Get Market

**Endpoint:** `GET /markets/{ticker}`

Get detailed information about a specific market. Returns same structure as Get Markets but for a single market.

### Get Market Orderbook

**Endpoint:** `GET /markets/{ticker}/orderbook`

**Query Parameters:**
- `depth` (integer, 0-100) - Orderbook depth (0 or negative = all levels, default: 0)

**Response:**
```json
{
  "orderbook": {
    "yes": [
      [123, 200]  // [price in cents, contract count]
    ],
    "no": [
      [123, 100]  // [price in cents, contract count]
    ],
    "yes_dollars": [
      ["0.1500", 100]  // [price in dollars, contract count]
    ],
    "no_dollars": [
      ["0.1500", 100]  // [price in dollars, contract count]
    ]
  }
}
```

**Note:** Orderbook only shows bids (not asks) due to reciprocal nature of binary markets. See "Orderbook Structure" section above for details.

### Get Trades

**Endpoint:** `GET /markets/trades`

Get all trades across all markets (or filtered by ticker).

**Query Parameters:**
- `limit` (integer, 1-1000) - Results per page (default: 100)
- `cursor` (string) - Pagination cursor
- `ticker` (string) - Filter by market ticker
- `min_ts` (integer) - Filter after this Unix timestamp
- `max_ts` (integer) - Filter before this Unix timestamp

**Response:**
```json
{
  "trades": [
    {
      "trade_id": "string",
      "ticker": "string",
      "price": 123,                           // Trade price in cents
      "count": 123,                           // Number of contracts
      "yes_price": 123,
      "no_price": 123,
      "yes_price_dollars": "0.5600",
      "no_price_dollars": "0.5600",
      "taker_side": "yes" | "no",             // Which side was the taker
      "created_time": "2023-11-07T05:31:56Z"
    }
  ],
  "cursor": "string"
}
```

### Get Market Candlesticks

**Endpoint:** `GET /series/{series_ticker}/markets/{ticker}/candlesticks`

**Path Parameters:**
- `series_ticker` (string) - Series ticker containing the market
- `ticker` (string) - Market ticker

**Query Parameters:**
- `start_ts` (integer, required) - Start timestamp (Unix)
- `end_ts` (integer, required) - End timestamp (Unix)
- `period_interval` (integer, required) - Candlestick period: `1` (1 min), `60` (1 hour), `1440` (1 day)

**Response:**
```json
{
  "ticker": "string",
  "candlesticks": [
    {
      "end_period_ts": 123,
      "yes_bid": {
        "open": 123,
        "open_dollars": "0.5600",
        "low": 123,
        "low_dollars": "0.5600",
        "high": 123,
        "high_dollars": "0.5600",
        "close": 123,
        "close_dollars": "0.5600"
      },
      "yes_ask": {
        "open": 123,
        "open_dollars": "0.5600",
        "low": 123,
        "low_dollars": "0.5600",
        "high": 123,
        "high_dollars": "0.5600",
        "close": 123,
        "close_dollars": "0.5600"
      },
      "price": {
        "open": 123,
        "open_dollars": "0.5600",
        "low": 123,
        "low_dollars": "0.5600",
        "high": 123,
        "high_dollars": "0.5600",
        "close": 123,
        "close_dollars": "0.5600",
        "mean": 123,
        "mean_dollars": "0.5600",
        "previous": 123,
        "previous_dollars": "0.5600",
        "min": 123,
        "min_dollars": "0.5600",
        "max": 123,
        "max_dollars": "0.5600"
      },
      "volume": 123,
      "open_interest": 123
    }
  ]
}
```

**Key Features:**
- Separate OHLC data for YES bid, YES ask, and price
- Supports 1-minute, 1-hour, and 1-day intervals
- Includes volume and open interest

### Get Series

**Endpoint:** `GET /series/{series_ticker}`

Get information about a series (template for recurring events).

**Response:**
```json
{
  "series": {
    "ticker": "string",
    "frequency": "string",
    "title": "string",
    "category": "string",
    "tags": ["string"],
    "settlement_sources": [
      {
        "name": "string",
        "url": "string"
      }
    ],
    "contract_url": "string",
    "contract_terms_url": "string",
    "fee_type": "quadratic",
    "fee_multiplier": 123,
    "additional_prohibitions": ["string"],
    "product_metadata": {}
  }
}
```

---

## Events Endpoints Details

### Get Events

**Endpoint:** `GET /events`

Get all events (excludes multivariate events - use separate endpoint for those).

**Query Parameters:**
- `limit` (integer, 1-200) - Results per page (default: 200)
- `cursor` (string) - Pagination cursor
- `with_nested_markets` (boolean, default: false) - Include nested markets in response
- `with_milestones` (boolean, default: false) - Include related milestones
- `status` (string) - Filter by status: `open`, `closed`, `settled`
- `series_ticker` (string) - Filter by series ticker
- `min_close_ts` (integer) - Filter events with at least one market closing after this timestamp

**Response:**
```json
{
  "events": [
    {
      "event_ticker": "string",
      "series_ticker": "string",
      "title": "string",
      "sub_title": "string",
      "category": "string",
      "strike_date": "2023-11-07T05:31:56Z",
      "strike_period": "string",
      "mutually_exclusive": true,
      "collateral_return_type": "string",
      "available_on_brokers": true,
      "product_metadata": {},
      "markets": [  // Only if with_nested_markets=true
        {
          "ticker": "string",
          "event_ticker": "string",
          "title": "string",
          "status": "open",
          "yes_bid": 123,
          "yes_ask": 123,
          "no_bid": 123,
          "no_ask": 123,
          "last_price": 123,
          "volume": 123,
          // ... full market structure
        }
      ]
    }
  ],
  "cursor": "string",
  "milestones": [  // Only if with_milestones=true
    {
      "id": "string",
      "category": "string",
      "type": "string",
      "title": "string",
      "start_date": "2023-11-07T05:31:56Z",
      "end_date": "2023-11-07T05:31:56Z",
      "related_event_tickers": ["string"],
      "primary_event_tickers": ["string"]
    }
  ]
}
```

**Key Concepts:**
- **Events** are the basic unit that members interact with
- Events contain one or more **markets**
- Events can have **milestones** (important dates/deadlines)
- Use `with_nested_markets=true` to get markets within each event

### Get Event

**Endpoint:** `GET /events/{event_ticker}`

Get detailed information about a specific event.

**Query Parameters:**
- `with_nested_markets` (boolean, default: false) - Include markets within event object (vs separate field)

**Response:**
```json
{
  "event": {
    "event_ticker": "string",
    "series_ticker": "string",
    "title": "string",
    "sub_title": "string",
    "category": "string",
    "strike_date": "2023-11-07T05:31:56Z",
    "markets": [  // Full market objects
      // ... market structure
    ]
  },
  "markets": [  // Deprecated - use markets inside event if with_nested_markets=true
    // ... market structure
  ]
}
```

### Get Event Metadata

**Endpoint:** `GET /events/{event_ticker}/metadata`

Get metadata about an event (images, settlement sources, etc.).

**Response:**
```json
{
  "image_url": "string",
  "featured_image_url": "string",
  "market_details": [
    {
      "market_ticker": "string",
      "image_url": "string",
      "color_code": "string"
    }
  ],
  "settlement_sources": [
    {
      "name": "string",
      "url": "string"
    }
  ],
  "competition": "string",
  "competition_scope": "string"
}
```

### Get Event Candlesticks

**Endpoint:** `GET /series/{series_ticker}/events/{ticker}/candlesticks`

Get aggregated candlestick data across all markets in an event.

**Query Parameters:**
- `start_ts` (integer, required) - Start timestamp
- `end_ts` (integer, required) - End timestamp
- `period_interval` (integer, required) - Period: `1` (1 min), `60` (1 hour), `1440` (1 day)

**Response:**
```json
{
  "market_tickers": ["string"],
  "market_candlesticks": [
    [
      {
        "end_period_ts": 123,
        "yes_bid": { "open": 123, "low": 123, "high": 123, "close": 123 },
        "yes_ask": { "open": 123, "low": 123, "high": 123, "close": 123 },
        "price": { "open": 123, "low": 123, "high": 123, "close": 123, "mean": 123 },
        "volume": 123,
        "open_interest": 123
      }
    ]
  ],
  "adjusted_end_ts": 123
}
```

**Note:** Returns candlestick arrays for each market in the event.

### Get Event Forecast Percentile History

**Endpoint:** `GET /series/{series_ticker}/events/{ticker}/forecast_percentile_history`

Get historical forecast percentile data for an event.

**Query Parameters:**
- `start_ts` (integer, required) - Start timestamp
- `end_ts` (integer, required) - End timestamp
- `period_interval` (integer, required) - Period: `0` (5-second), `1` (1 min), `60` (1 hour), `1440` (1 day)
- `percentiles` (integer[], required) - Array of percentile values (0-10000, max 10 values)

**Response:**
```json
{
  "forecast_history": [
    {
      "event_ticker": "string",
      "end_period_ts": 123,
      "period_interval": 123,
      "percentile_points": [
        {
          "percentile": 123,
          "raw_numerical_forecast": 123,
          "numerical_forecast": 123,
          "formatted_forecast": "string"
        }
      ]
    }
  ]
}
```

---

## Exchange Status Endpoints Details

### Get Exchange Status

**Endpoint:** `GET /exchange/status`

Get current exchange status (useful for health checks).

**Response:**
```json
{
  "exchange_active": true,              // Core exchange is operational
  "trading_active": true,                // Trading is currently permitted
  "exchange_estimated_resume_time": "2023-11-07T05:31:56Z" | null
}
```

**Key Fields:**
- `exchange_active`: False if exchange is under maintenance (no state changes at all)
- `trading_active`: True during trading hours, false outside trading hours or if paused
- `exchange_estimated_resume_time`: Estimated downtime (not guaranteed)

**Use Cases:**
- Health check endpoint for monitoring
- Check if trading is available before placing orders
- Detect maintenance windows

### Get Exchange Schedule

**Endpoint:** `GET /exchange/schedule`

Get exchange trading schedule (standard hours and maintenance windows).

**Response:**
```json
{
  "schedule": {
    "standard_hours": [
      {
        "start_time": "2023-11-07T05:31:56Z",
        "end_time": "2023-11-07T05:31:56Z",
        "monday": [{"open_time": "string", "close_time": "string"}],
        "tuesday": [{"open_time": "string", "close_time": "string"}],
        // ... other days
      }
    ],
    "maintenance_windows": [
      {
        "start_datetime": "2023-11-07T05:31:56Z",
        "end_datetime": "2023-11-07T05:31:56Z"
      }
    ]
  }
}
```

**Use Cases:**
- Know when exchange is open/closed
- Plan around maintenance windows
- Display trading hours to users

---

## Search Endpoints Details

### Get Tags for Series Categories

**Endpoint:** `GET /search/tags_by_categories`

Retrieve tags organized by series categories (useful for filtering and search).

**Response:**
```json
{
  "tags_by_categories": {
    "category1": ["tag1", "tag2"],
    "category2": ["tag3", "tag4"]
  }
}
```

**Use Cases:**
- Market discovery by category/tag
- Filtering markets in UI
- Search functionality

### Get Filters for Sports

**Endpoint:** `GET /search/filters_by_sport`

Retrieve available filters organized by sport (scopes, competitions).

**Response:**
```json
{
  "filters_by_sports": {
    "sport1": {
      "scopes": ["scope1", "scope2"],
      "competitions": ["comp1", "comp2"]
    }
  },
  "sport_ordering": ["sport1", "sport2"]
}
```

**Use Cases:**
- Sports market discovery
- Filtering by sport/competition
- Displaying available sports markets

---

## Live Data Endpoints Details

### Get Live Data

**Endpoint:** `GET /live_data/{type}/milestone/{milestone_id}`

Get live data for a specific milestone. Milestones are important dates/deadlines related to events.

**Path Parameters:**
- `type` (string, required) - Type of live data
- `milestone_id` (string, required) - Milestone ID

**Response:**
```json
{
  "live_data": {
    "type": "string",
    "details": {},
    "milestone_id": "string"
  }
}
```

**Use Cases:**
- Get real-time data for event milestones
- Track important deadlines/dates
- Monitor event progress

### Get Multiple Live Data

**Endpoint:** `GET /live_data/batch`

Get live data for multiple milestones at once.

**Query Parameters:**
- `milestone_ids` (string[], required) - Array of milestone IDs (max 100)

**Response:**
```json
{
  "live_datas": [
    {
      "type": "string",
      "details": {},
      "milestone_id": "string"
    }
  ]
}
```

**Use Cases:**
- Batch fetch live data for multiple milestones
- Efficiently track multiple events
- Real-time monitoring of event progress

**Note:** The `details` field structure depends on the `type` of live data. This endpoint is useful for getting real-time updates on milestones without polling individual endpoints.

---

## Implementation Notes

### Binary Market Handling

Kalshi's binary markets require special handling:

1. **Position Sides:** Instead of traditional `BUY`/`SELL`, use `YES`/`NO` sides
2. **Actions:** `buy` or `sell` contracts (buy YES = take YES position, sell YES = close YES position)
3. **Price Validation:** Prices must be between 1¢ and 99¢
4. **Reciprocal Pricing:** YES price + NO price = 100¢ (always)
   - If placing YES order at 60¢, NO price is implied at 40¢
   - If placing NO order at 30¢, YES price is implied at 70¢
5. **Position Tracking:** Track both YES and NO positions separately

### Order Types

- **Market Orders:** Execute at best available price (no price parameter needed)
- **Limit Orders:** Execute at specified price or better (requires price)
- **Stop Orders:** Not supported (use conditional logic in application)

### Position Sizing

- Kalshi uses **contract quantities** (not USD amounts)
- Need to convert USD position size to contract count
- Each contract pays out $1 if correct (or $0 if wrong)
- **Example:** If you want to risk $100 on a YES position at 60¢:
  - Cost per contract = $0.60
  - Contracts = $100 / $0.60 = 166.67 → 166 contracts
  - Total cost = 166 × $0.60 = $99.60

### Order Limits

- Maximum 200,000 open orders per user
- Batch operations limited to 20 orders per request

---

## Testing

### Demo Environment

1. Create demo account at https://demo.kalshi.co/
2. Generate API keys in demo environment
3. Use demo API base URL: `https://demo-api.kalshi.co/trade-api/v2`
4. Test all endpoints before production deployment

### Test Checklist

- [ ] Authentication and request signing
- [ ] Get account balance
- [ ] Fetch markets and orderbooks
- [ ] Place market order (YES)
- [ ] Place market order (NO)
- [ ] Place limit order
- [ ] Cancel order
- [ ] Get positions
- [ ] Handle errors and rate limits

---

## Resources

- **API Documentation:** https://docs.kalshi.com/
- **Demo Environment:** https://demo.kalshi.co/
- **API Keys:** https://kalshi.com/account/profile
- **Advanced API Form:** https://kalshi.typeform.com/advanced-api

---

## Future Enhancement: WebSocket Support

### Overview

While REST API is sufficient for initial implementation, Kalshi's WebSocket API can provide significant advantages for advanced use cases, particularly for the AI Signal Engine.

### Benefits of WebSocket Integration

#### 1. Real-Time Market Data
- **Current (REST):** AI worker polls every 45 seconds for new data
- **With WebSockets:** Instant price updates as they happen
- **Benefit:** Faster reaction to market movements, reduced latency

#### 2. Live Orderbook Streaming
- **Current (REST):** Static orderbook snapshot every 45 seconds
- **With WebSockets:** Continuous orderbook updates in real-time
- **Benefit:** Better market microstructure awareness (order flow, bid/ask changes, imbalances)

#### 3. Trade Flow Data
- **Current (REST):** Only sees OHLCV candles (aggregated data)
- **With WebSockets:** See individual trades as they execute
- **Benefit:** Detect momentum, large orders, market impact in real-time

#### 4. Event-Driven AI Decisions
- **Current (REST):** Polling-based (45-second intervals)
- **With WebSockets:** Event-driven decisions triggered by market events
- **Benefit:** Capture opportunities faster, more efficient resource usage

### Use Cases for WebSocket Integration

#### High-Priority: AI Signal Engine
The AI worker would benefit significantly from WebSocket data:
- **Faster Reaction Time:** See price changes immediately instead of waiting up to 45 seconds
- **Better Orderbook Data:** Live orderbook updates provide more accurate market microstructure
- **Trade Flow Analysis:** Individual trade data helps detect momentum and large orders
- **Event-Driven Decisions:** Trigger AI analysis on significant market events instead of fixed intervals

#### Medium-Priority: Position Tracking
- Real-time position updates (though REST polling every 30s is sufficient for most cases)
- Instant order fill notifications
- Live P&L updates

#### Low-Priority: Basic Trading
- REST API is sufficient for most trading operations
- WebSockets only needed for high-frequency trading or advanced strategies

### Implementation Considerations

**When to Consider WebSockets:**
- ✅ You need faster reaction times (< 45 seconds)
- ✅ You're implementing high-frequency strategies
- ✅ Market microstructure matters (order flow, imbalances)
- ✅ AI worker needs event-driven decisions
- ✅ You want to reduce API polling overhead

**Trade-offs:**
- ⚠️ **Complexity:** Connection management, reconnection logic, error handling
- ⚠️ **Data Volume:** More data to process and store
- ⚠️ **Infrastructure:** Need to handle WebSocket connections, message queuing
- ⚠️ **Rate Limits:** Still subject to Kalshi's rate limits

### Future Implementation Plan

If WebSocket support is needed:

1. **Phase 1:** Research Kalshi WebSocket API documentation
   - Connection authentication
   - Available channels (market data, orderbook, trades, positions)
   - Message formats and protocols

2. **Phase 2:** Create WebSocket client module
   - Connection management with auto-reconnect
   - Channel subscription management
   - Message parsing and routing

3. **Phase 3:** Integrate with AI Worker
   - Replace polling with event-driven updates
   - Stream orderbook data to AI decision engine
   - Trigger AI analysis on significant market events

4. **Phase 4:** Optional position tracking enhancement
   - Real-time position updates via WebSocket
   - Instant order fill notifications

### Resources

- Kalshi WebSocket documentation: https://docs.kalshi.com/websockets/ (to be reviewed)
- WebSocket libraries for Node.js: `ws`, `socket.io-client`

---

## Open Questions

> **This section will be updated as implementation progresses**

1. How are markets identified in webhook payloads? (ticker format?)
2. What is the minimum order size?
3. How are positions closed? (opposite order or close endpoint?)
4. Are there any special order types for prediction markets?
5. How should we handle subpenny pricing when it's released?
6. What is the contract multiplier? (1 contract = $1 payout?)
7. What WebSocket channels does Kalshi provide? (market data, orderbook, trades, positions?)
8. How does WebSocket authentication work? (same RSA-PSS or different?)

---

## Changelog

### 2025-12-XX - Events, Exchange Status, Search & Live Data Documentation
- ✅ **Added events endpoints documentation**
- Documented Get Events, Get Event, Get Event Metadata, Get Event Candlesticks, Get Event Forecast Percentile History
- Documented event structure and relationship to markets
- ✅ **Added exchange status endpoints documentation**
- Documented Get Exchange Status (health checks) and Get Exchange Schedule
- ✅ **Added search endpoints documentation**
- Documented Get Tags for Series Categories and Get Filters for Sports
- ✅ **Added live data endpoints documentation**
- Documented Get Live Data (single milestone) and Get Multiple Live Data (batch)

### 2025-12-XX - Portfolio & Market Data Documentation
- ✅ **Added comprehensive portfolio endpoints documentation**
- Documented balance, positions (market & event), fills, and settlements
- ✅ **Added comprehensive market data endpoints documentation**
- Documented markets listing, market details, orderbook, trades, candlesticks, and series
- Documented extensive filtering options for markets endpoint
- Documented position structure (positive = YES, negative = NO)
- Documented fill structure and trade history
- Documented candlestick data structure (1min, 1hour, 1day intervals)

### 2025-12-XX - Order Management Documentation
- ✅ **Added comprehensive order management documentation**
- Documented all order endpoints (create, get, cancel, batch, amend, decrease)
- Documented order structure and binary market specifics
- Added examples for YES/NO side orders
- Documented price specification (legacy cents vs fixed-point dollars)
- Added position sizing calculations for prediction markets
- Documented order limits (200,000 max open orders)

### 2025-12-XX - Initial Documentation
- Created implementation document
- Documented authentication mechanism
- Documented market structure and orderbook format
- Added rate limits and pagination information
- Created implementation plan

---

**Next Steps:** 
- ✅ Order management endpoints documented
- ✅ Portfolio endpoints documented (balance, positions, fills, settlements)
- ✅ Market data endpoints documented (markets, orderbook, trades, candlesticks)
- ✅ Events endpoints documented (events are the basic unit, markets belong to events)
- ✅ Exchange status endpoints documented (health checks and trading schedule)
- ✅ Search endpoints documented (market discovery/filtering)
- ✅ Live data endpoints documented (real-time milestone data)
- ✅ **Documentation Complete** - Ready to begin implementation of KalshiAPI class

