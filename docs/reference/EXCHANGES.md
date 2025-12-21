# Exchange Integration Reference

This document covers all supported exchanges, their authentication requirements, configuration, and trade sizing logic. Update this file whenever you add an exchange or change integration details.

---

## Supported Exchanges

| Exchange | Asset Class | Config Key | Status |
|----------|-------------|------------|--------|
| Aster DEX | Crypto Futures | `aster` | ✅ Production |
| OANDA | Forex | `oanda` | ✅ Production |
| Tradier | Stocks/ETFs | `tradier` | ✅ Production |
| Tradier Options | Options | `tradier_options` | ✅ Production |
| Kalshi | Prediction Markets | `kalshi` | ✅ Production |
| Alpaca | Stocks/Options/Crypto | `alpaca` | ✅ Production |
| Capital.com | CFDs/Stocks/Forex/Crypto | `capital` | ✅ Production |
| Robinhood Crypto | Crypto | `robinhood` | ✅ Production |
| Trading212 | Stocks/ETFs | `trading212` | ✅ Production (Beta) |
| Lime Trading | Stocks/Options | `lime` | ✅ Production |
| Public.com | Stocks/Options | `public` | ✅ Production |
| Webull | Stocks/ETFs | `webull` | ✅ Production |
| TradeStation | Stocks/Options/Futures | `tradestation` | ✅ Production |
| CCXT Exchanges | Crypto/Stocks/Futures | `binance`, `coinbase`, `apex`, etc. | ✅ Production |

---

## Aster DEX (Crypto Futures)

### Configuration
```json
{
  "aster": {
    "apiUrl": "https://fapi.asterdex.com",
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET",
    "tradeAmount": 600
  }
}
```

### Details
- **REST Base URL:** `https://fapi.asterdex.com`
- **Authentication:** HMAC-SHA256 signatures
- **Required Config:** `apiKey`, `apiSecret`
- **Optional Config:** `apiUrl`, `tradeAmount`

### Notes
- Supports USDT-margined perpetuals
- Leverage is set directly on the exchange (not in config)
- Position size defaults to `tradeAmount` unless overridden by SignalStudio order
- Uses position tracker + Supabase logging for SignalStudio dashboard

### Webhook Example
```json
{
  "secret": "your-secret",
  "exchange": "aster",
  "action": "BUY",
  "symbol": "BTCUSDT",
  "stop_loss_percent": 2,
  "take_profit_percent": 4
}
```

---

## OANDA (Forex)

### Configuration
```json
{
  "oanda": {
    "accountId": "101-001-12345678-001",
    "accessToken": "YOUR_OANDA_TOKEN",
    "environment": "practice",
    "tradeAmount": 10000
  }
}
```

### Details
- **Environment:** `practice` (demo) or `live` (production)
- **Authentication:** Bearer token
- **Required Config:** `accountId`, `accessToken`
- **Optional Config:** `environment`, `tradeAmount`

### Notes
- Supports trailing stops via webhook fields: `useTrailingStop: true`, `trailing_stop_pips: 25`
- Trade size is in USD notional
- Requires Node.js 18+ (OANDA recommends v20 for TLS updates)
- Symbol format uses underscore: `EUR_USD`, `GBP_USD`
- Trading hours: 24/5 (weekdays only)

### Webhook Example
```json
{
  "secret": "your-secret",
  "exchange": "oanda",
  "action": "BUY",
  "symbol": "EUR_USD",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 3,
  "useTrailingStop": true,
  "trailing_stop_pips": 25
}
```

---

## Tradier (Stocks/ETFs)

### Configuration
```json
{
  "tradier": {
    "accountId": "VA12345678",
    "accessToken": "YOUR_TRADIER_TOKEN",
    "environment": "sandbox",
    "tradeAmount": 2000
  }
}
```

### Details
- **Environment:** `sandbox` (paper trading) or `production`
- **Authentication:** Bearer token
- **Required Config:** `accountId`, `accessToken`
- **Optional Config:** `environment`, `tradeAmount`

### Notes
- Used for stock/ETF orders via `TradeExecutor`
- Symbol format: `AAPL`, `TSLA`, `SPY`
- Trading hours: 9:30 AM - 4:00 PM ET
- Configure per-exchange settings (max trades, TP/SL defaults) in SignalStudio Trade Settings

### Webhook Example
```json
{
  "secret": "your-secret",
  "exchange": "tradier",
  "action": "BUY",
  "symbol": "AAPL",
  "stop_loss_percent": 3,
  "take_profit_percent": 6
}
```

---

## Tradier Options

### Configuration
```json
{
  "tradierOptions": {
    "accountId": "VA12345678",
    "accessToken": "YOUR_TRADIER_TOKEN",
    "environment": "sandbox"
  }
}
```

### Details
- Shares credentials with Tradier stocks
- Uses specialized `TradierOptionsExecutor` for OTCO orders
- Uses `TradierOptionsMonitor` to poll for fills and log P&L

### Notes
- Builds OTCO (One-Triggers-Cancel-Other) orders: entry + TP + SL
- Option symbol format: `AAPL240119C00150000` (complex OCC format)
- Respects trading windows from SignalStudio (`auto_close_outside_window` flattens positions after hours)
- Logs to `tradier_option_trades` table in Supabase

### Trade Settings Integration
- Strike tolerance percent
- Entry limit offset percent
- TP/SL percentages
- Max signal age (seconds)
- Auto-close outside trading window

---

## Kalshi (Prediction Markets)

### Configuration

```json
{
  "kalshi": {
    "apiKeyId": "your-api-key-id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** 
  - Production: `https://api.kalshi.com/trade-api/v2`
  - Demo: `https://demo-api.kalshi.com/trade-api/v2`
- **Authentication:** RSA-PSS signature authentication
- **Required Config:** `apiKeyId` (Key ID), `privateKey` (RSA private key in PEM format)
- **Optional Config:** `environment` (`production` or `demo`)

### Notes
- Binary prediction markets (YES/NO positions)
- Prices range from 1¢ to 99¢ (YES + NO = 100¢)
- Uses contract quantities (not USD amounts)
- Each contract pays $1 if correct, $0 if wrong
- Maximum 200,000 open orders per user
- Stop loss/take profit orders not supported (use conditional logic)

### Webhook Example
```json
{
  "secret": "your-secret",
  "exchange": "kalshi",
  "action": "BUY",
  "symbol": "KXHIGHNY-24JAN01-T60",
  "side": "YES",
  "position_size_usd": 100,
  "stop_loss_percent": 2,
  "take_profit_percent": 4
}
```

### Position Sizing
- Kalshi uses **contract quantities**, not USD amounts
- To convert USD to contracts: `contracts = USD_amount / price_per_contract`
- Example: $100 at 60¢ per contract = 166 contracts (costs $99.60)

### Special Considerations
- **Sides:** Use `YES` or `NO` instead of `BUY`/`SELL`
- **Price Format:** Can use cents (1-99) or dollars (0.01-0.99)
- **Reciprocal Pricing:** YES bid at 60¢ = NO ask at 40¢
- **Position Tracking:** Positive = YES position, Negative = NO position

For detailed documentation, see [`docs/reference/KALSHI_IMPLEMENTATION.md`](KALSHI_IMPLEMENTATION.md).

---

## Alpaca (Stocks/Options/Crypto)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Enter API Key ID and API Secret Key
- Set environment to `paper` for paper trading or `production` for live

**Via config.json (Legacy):**
```json
{
  "alpaca": {
    "apiKey": "YOUR_API_KEY_ID",
    "apiSecret": "YOUR_API_SECRET_KEY",
    "environment": "paper"
  }
}
```

### Details
- **REST Base URL:** 
  - Paper: `https://paper-api.alpaca.markets`
  - Live: `https://api.alpaca.markets`
- **Authentication:** API Key + Secret (HTTP Headers: `APCA-API-KEY-ID`, `APCA-API-SECRET-KEY`)
- **Required Config:** `apiKey`, `apiSecret`
- **Optional Config:** `environment` (`paper` or `production`)

### Notes
- **Asset Classes:** US Stocks, Options, Crypto
- **Fractional Trading:** Supported (minimum $1, automatic for positions < $100)
- **Extended Hours:** Pre-market, after-hours, overnight trading supported
- **Order Types:** Market, Limit, Stop, Stop-Limit, Trailing Stop, Bracket, OCO, OTO
- **Margin Trading:** Up to 4x intraday (PDT), 2x overnight
- **Short Selling:** Supported for ETB securities ($0 borrow fees)
- **Paper Trading:** Free with $100k default balance

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Bracket Order (Entry + TP + SL in one):**
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

**Trailing Stop:**
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

**Fractional Order:**
```json
{
  "secret": "your-secret",
  "exchange": "alpaca",
  "action": "buy",
  "symbol": "AAPL",
  "position_size_usd": 50.00,
  "useFractional": true
}
```

**Extended Hours:**
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

### Advanced Features

**Bracket Orders:**
- Entry + Take Profit + Stop Loss in one order
- Set `useBracketOrder: true` in webhook
- Requires both `stop_loss_percent` and `take_profit_percent`

**OCO Orders:**
- One-Cancels-Other (TP or SL, not both)
- Set `useOCOOrder: true` in webhook
- For exit orders when position already exists

**OTO Orders:**
- One-Triggers-Other (Entry + either TP or SL)
- Set `useOTOOrder: true` in webhook
- Entry order triggers conditional exit

**Trailing Stops:**
- Dollar amount: `trailing_stop_pips: 5.00`
- Percentage: `trailing_stop_percent: 1.5`
- Set `useTrailingStop: true`

**Fractional Shares:**
- Automatic for positions < $100
- Explicit: `useFractional: true`
- Minimum: $1 worth of stock

**Extended Hours:**
- Pre-market: 4:00 AM - 9:30 AM ET
- After-hours: 4:00 PM - 8:00 PM ET
- Overnight: 8:00 PM - 4:00 AM ET
- Requires `orderType: "limit"` and `extended_hours: true`

For detailed documentation, see [`docs/reference/ALPACA_IMPLEMENTATION.md`](ALPACA_IMPLEMENTATION.md).

---

## Capital.com (CFDs/Stocks/Forex/Crypto/Commodities/Indices)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Enter API Key (from Settings > API integrations)
- Enter API Key Password (custom password set during key generation)
- Add login/username in extra_metadata field
- Set environment to `demo` for demo account or `production` for live

**Via config.json (Legacy):**
```json
{
  "capital": {
    "apiKey": "YOUR_API_KEY",
    "login": "YOUR_LOGIN",
    "password": "YOUR_API_KEY_PASSWORD",
    "accountId": "OPTIONAL_ACCOUNT_ID",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** 
  - Demo: `https://demo-api-capital.backend-capital.com`
  - Live: `https://api-capital.backend-capital.com`
- **Authentication:** Session-based (API Key + Login + Password)
  - Start session via `POST /api/v1/session`
  - Receive `CST` and `X-SECURITY-TOKEN` tokens in response headers
  - Session expires after 10 minutes of inactivity
- **Required Config:** `apiKey`, `login`, `password`
- **Optional Config:** `accountId` (auto-fetched from session), `environment` (`demo` or `production`)

### Notes
- **Asset Classes:** CFDs, Stocks, Forex, Crypto, Commodities, Indices
- **Epic Format:** Capital.com uses "epic" instead of standard symbols (e.g., "AAPL", "OIL_CRUDE")
- **Symbol Mapping:** System automatically maps symbols to epics using market search
- **Session Management:** Auto-refreshes session before expiry (10 minutes)
- **Position Confirmation:** Use `GET /api/v1/confirms/{dealReference}` after opening position
- **Stop Loss/Take Profit:** Can be set when opening position or updated later (CFDs only, not real stocks)
- **Working Orders:** Limit and stop orders supported
- **2FA Required:** Must enable 2FA before generating API keys

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "capital",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "capital",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Position with Stop Loss and Take Profit:**
```json
{
  "secret": "your-secret",
  "exchange": "capital",
  "action": "buy",
  "symbol": "OIL_CRUDE",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Special Considerations

**Session Management:**
- Session tokens expire after 10 minutes of inactivity
- System automatically refreshes session before expiry
- Tokens are not stored, fetched fresh for each request

**Epic vs Symbol:**
- Capital.com uses "epic" format (e.g., "AAPL", "OIL_CRUDE", "BTCUSD")
- System automatically maps standard symbols to epics
- Use `GET /api/v1/markets?searchTerm={symbol}` for mapping

**Position Confirmation:**
- After opening position, deal reference is returned (starts with `o_` prefix)
- Use `GET /api/v1/confirms/{dealReference}` to confirm status
- Response contains `dealId` (permanent reference) for subsequent operations

**Stop Loss/Take Profit:**
- Can be set using price levels (`stopLevel`, `profitLevel`)
- Or using distances (`stopDistance`, `profitDistance`)
- Or using amounts (`stopAmount`, `profitAmount`)
- Cannot be set for real stocks (CFDs only)

**Rate Limits:**
- Max 10 requests per second per user
- Max 1 request per 0.1 seconds for positions/orders
- Session endpoint: 1 request per second per API key
- Demo trading: 1000 requests per hour for positions/orders

For detailed documentation, see [`docs/reference/CAPITAL_IMPLEMENTATION.md`](CAPITAL_IMPLEMENTATION.md).

---

## Robinhood Crypto (Cryptocurrency Only)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Generate Ed25519 key pair using provided tool
- Register public key in Robinhood API Credentials Portal (desktop only)
- Enter API Key and Private Key (Base64)
- Note: This API is crypto-only (no stocks, options, etc.)

**Via config.json (Legacy):**
```json
{
  "robinhood": {
    "apiKey": "YOUR_API_KEY",
    "privateKey": "YOUR_ED25519_PRIVATE_KEY_BASE64",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** `https://trading.robinhood.com`
- **Authentication:** Ed25519 Signature-based
  - API Key (from API Credentials Portal)
  - Ed25519 Private Key (Base64 format, 32-byte seed)
  - Each request must be signed with timestamp
- **Required Config:** `apiKey`, `privateKey`
- **Optional Config:** `environment` (always `production` for crypto API)

### Notes
- **Asset Classes:** Cryptocurrency only (no stocks, options, or other assets)
- **Symbol Format:** Trading pairs (e.g., `BTC-USD`, `ETH-USD`) - must be uppercase
- **Symbol Conversion:** System automatically converts symbols to trading pair format
- **Order Types:** Market, Limit, Stop Limit, Stop Loss
- **Quantity Types:** Can use `asset_quantity` (crypto amount) or `quote_amount` (USD amount)
- **Client Order ID:** Must be UUID v4 for idempotency
- **Timestamp:** Expires after 30 seconds (must be current)

### Key Pair Generation

Users must generate Ed25519 key pair before using API:

**Node.js:**
```javascript
const nacl = require('tweetnacl');
const base64 = require('base64-js');

const keyPair = nacl.sign.keyPair();
const privateKeyBase64 = base64.fromByteArray(keyPair.secretKey.slice(0, 32));
const publicKeyBase64 = base64.fromByteArray(keyPair.publicKey);

console.log('Private Key (Base64):', privateKeyBase64);
console.log('Public Key (Base64):', publicKeyBase64);
```

**Steps:**
1. Generate key pair (using tool or script)
2. Register public key in Robinhood API Credentials Portal
3. Receive API key
4. Store private key securely (cannot be recovered if lost)

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "robinhood",
  "action": "buy",
  "symbol": "BTC",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "robinhood",
  "action": "buy",
  "symbol": "ETH",
  "orderType": "limit",
  "price": 3000.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Stop Loss Order:**
```json
{
  "secret": "your-secret",
  "exchange": "robinhood",
  "action": "buy",
  "symbol": "BTC",
  "stop_loss_percent": 2
}
```

### Special Considerations

**Ed25519 Signature Authentication:**
- Each request must be signed with private key
- Message format: `{apiKey}{timestamp}{path}{method}{body}`
- Timestamp must be current (expires after 30 seconds)
- Signature is Base64-encoded Ed25519 signature

**Symbol to Trading Pair:**
- Standard symbols (e.g., `BTC`, `ETH`) are converted to trading pairs (`BTC-USD`, `ETH-USD`)
- Symbols must be uppercase in API requests
- Only USD pairs are supported

**Client Order ID:**
- Must be valid UUID v4
- Used for idempotency (prevents duplicate orders)
- System automatically generates UUIDs

**Rate Limits:**
- 100 requests per minute per user account
- 300 requests per minute in bursts
- Token bucket implementation

**Crypto-Only Limitation:**
- This API only supports cryptocurrency trading
- Does not support stocks, options, ETFs, or other assets
- Use other exchanges for non-crypto assets

For detailed documentation, see [`docs/reference/ROBINHOOD_IMPLEMENTATION.md`](ROBINHOOD_IMPLEMENTATION.md).

---

## Trading212 (Stocks & ETFs)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Enter API Key and API Secret
- Select environment (Demo or Live)
- Note: Only Invest and Stocks ISA accounts supported (CFD accounts not supported)

**Via config.json (Legacy):**
```json
{
  "trading212": {
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL (Demo):** `https://demo.trading212.com/api/v0`
- **REST Base URL (Live):** `https://live.trading212.com/api/v0`
- **Authentication:** HTTP Basic Auth (API Key:API Secret, Base64 encoded)
- **Required Config:** `apiKey`, `apiSecret`
- **Optional Config:** `environment` (`demo` or `production`/`live`)

### Notes
- **Asset Classes:** Stocks and ETFs only
- **Account Types:** Invest and Stocks ISA only (CFD accounts not supported)
- **Symbol Format:** Trading212 ticker format (e.g., `AAPL_US_EQ`)
- **Symbol Conversion:** System automatically converts symbols to Trading212 format
- **Order Types (Live):** Market Orders only
- **Order Types (Demo):** Market, Limit, Stop, Stop-Limit
- **Sell Orders:** Use negative quantity (e.g., `-10.5` for sell, `10.5` for buy)
- **Extended Hours:** Market orders support `extendedHours` parameter
- **Currency:** Orders execute only in primary account currency
- **Multi-Currency:** Not supported via API

### Webhook Examples

**Basic Market Order (Live Trading):**
```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order (Demo Only):**
```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Stop Loss Order (Demo Only):**
```json
{
  "secret": "your-secret",
  "exchange": "trading212",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2
}
```

### Special Considerations

**Live Trading Limitations:**
- Only Market Orders are supported in live (real money) environment
- Limit, Stop, and Stop-Limit orders will fail in live environment
- System throws clear error if attempting unsupported order types

**Negative Quantity for Sell Orders:**
- Trading212 uses negative quantities to indicate sell orders
- Buy: `quantity: 10.5`
- Sell: `quantity: -10.5`
- This is different from most other exchanges

**Symbol Format:**
- Trading212 uses specific ticker format: `{SYMBOL}_{COUNTRY}_{TYPE}`
- Examples: `AAPL_US_EQ`, `MSFT_US_EQ`, `AMZN_US_EQ`
- System automatically converts standard symbols (e.g., `AAPL`) to Trading212 format
- Default assumption: `{SYMBOL}_US_EQ` for US stocks
- For accurate mapping, use `/api/v0/equity/metadata/instruments` endpoint

**Market Data Limitation:**
- Trading212 API does not provide a direct market data/ticker endpoint in beta version
- System attempts to get price from position data if available
- For real-time prices, use external market data sources

**Extended Hours Trading:**
- Market orders support `extendedHours` parameter
- Set to `true` to allow execution outside standard trading hours
- If placed when market is closed, order queues until market opens

**Order Idempotency:**
- ⚠️ Beta Limitation: API is not idempotent
- Sending the same request multiple times may result in duplicate orders
- Implement client-side idempotency checks if needed

**Rate Limits:**
- Account Summary: 1 req / 5s
- Market Orders: 50 req / 1m
- Limit Orders: 1 req / 2s (Demo only)
- Stop Orders: 1 req / 2s (Demo only)
- Cancel Orders: 50 req / 1m
- Get Orders: 1 req / 5s
- Get Positions: 1 req / 1s

For detailed documentation, see [`docs/reference/TRADING212_IMPLEMENTATION.md`](TRADING212_IMPLEMENTATION.md).

---

## Lime Trading (Stocks & Options)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Register application at https://myaccount.lime.co to get Client ID and Client Secret
- Enter Client ID, Client Secret, Username, and Password
- Account number auto-detected (optional to specify)
- Note: OAuth tokens expire daily at 3 AM ET (automatically refreshed)

**Via config.json (Legacy):**
```json
{
  "lime": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD",
    "accountNumber": "12345678@vision",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** `https://api.lime.co`
- **Auth Base URL:** `https://auth.lime.co`
- **Authentication:** OAuth 2.0 Password Flow
  - Client ID + Client Secret (from application registration)
  - Username + Password (Lime account credentials)
  - Access token expires at 3:00 AM ET daily
  - System automatically refreshes token before expiration
- **Required Config:** `clientId`, `clientSecret`, `username`, `password`
- **Optional Config:** `accountNumber` (auto-detected if not provided), `environment`

### Notes
- **Asset Classes:** Stocks and Options (US equities)
- **Account Format:** Account numbers in format `{number}@vision` (e.g., `12345678@vision`)
- **Order Types:** Market, Limit
- **Multi-Leg Orders:** Supported for options strategies
- **Symbol Formats:** CQS convention for stocks, OCC convention for options
- **Token Management:** Automatic refresh before 3 AM ET expiration
- **Low-Latency DMA:** Institutional-grade execution

### Webhook Examples

**Basic Market Order:**
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

**Limit Order:**
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

**Multi-Leg Options Order:**
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

### Special Considerations

**OAuth 2.0 Token Management:**
- Tokens expire at 3:00 AM ET daily (not prolonged with usage)
- System automatically refreshes token before expiration
- Token refresh happens in background (user never sees it)
- If password changes, user must update in SignalStudio

**Account Number Format:**
- Must include `@vision` suffix (e.g., `12345678@vision`)
- Auto-detected from `/accounts` endpoint if not provided
- Users can have multiple accounts (select default)

**Order Validation:**
- Use `/orders/validate` endpoint before placing orders
- Helps catch errors without submitting to market
- Returns validation message if order cannot be placed

**Exchange Routing:**
- Use `/accounts/{account}/routes` to get available exchanges
- `exchange: "auto"` lets Lime choose best route
- Can specify specific exchange (e.g., `"XNAS - Nasdaq"`)

**Multi-Leg Orders:**
- Support for options strategies (spreads, straddles, etc.)
- Use `legs` array in order request
- Each leg has `symbol`, `quantity`, and `side`

**Symbol Conventions:**
- **Stocks:** CQS convention (e.g., `AAPL`, `BRK.B`)
- **Options:** OCC convention (e.g., `AAPL 171103C00155000`)
- Use `/securities` endpoint to search/lookup symbols
- Use `/securities/{symbol}/options/series` for option series
- Use `/securities/{symbol}/options?expiration={date}` for option chains

**Stop Orders:**
- ⚠️ Lime API does not support native stop loss orders
- Consider using limit orders with price monitoring
- Or implement stop-limit orders if supported

**Market Data:**
- Real-time quotes via `/marketdata/quote`
- Historical data via `/marketdata/history`
- OPRA subscription requires daily token activation (if applicable)

For detailed documentation, see [`docs/reference/LIME_IMPLEMENTATION.md`](LIME_IMPLEMENTATION.md).

---

## Public.com (Stocks & Options)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Generate Secret Key in Public.com Settings
- Enter Secret Key in API Key field
- Account ID auto-detected (optional to specify)
- Note: Access tokens expire after 24 hours (automatically refreshed)

**Via config.json (Legacy):**
```json
{
  "public": {
    "secretKey": "YOUR_SECRET_KEY",
    "accountId": "optional-account-id",
    "tokenValidityMinutes": 1440,
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** `https://api.public.com`
- **Auth Endpoint:** `/userapiauthservice/personal/access-tokens`
- **Trading Gateway:** `/userapigateway/trading/`
- **Market Data Gateway:** `/userapigateway/marketdata/`
- **Authentication:** Secret Key → Access Token (Bearer)
  - Exchange secret key for access token
  - Token validity configurable (default: 1440 minutes / 24 hours)
  - System automatically refreshes token before expiration
- **Required Config:** `secretKey`
- **Optional Config:** `accountId` (auto-detected), `tokenValidityMinutes` (default: 1440)

### Notes
- **Asset Classes:** Stocks and Options (US equities)
- **Order Types:** Market, Limit, Stop, Stop-Limit
- **Fractional Trading:** Supported (use `amount` field for dollar-based orders)
- **Extended Hours:** 4:00 AM - 8:00 PM ET (for DAY time-in-force equity orders)
- **Multi-Leg Options:** Supported (2-6 legs, max 1 equity leg)
- **Preflight Calculations:** Available for cost estimation before execution
- **Options Greeks:** Delta, gamma, theta, vega, rho available
- **Order ID:** Must be RFC 4122 UUID (auto-generated)
- **Asynchronous Orders:** Order placement is asynchronous, use GET /{orderId} to check status

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "public",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order:**
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

**Fractional Order (Dollar Amount):**
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

**Extended Hours Order:**
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

**Options Order:**
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

**Multi-Leg Options Order:**
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

### Special Considerations

**Token Management:**
- Secret key exchanged for access token
- Token validity configurable (default: 24 hours)
- System automatically refreshes token before expiration
- Token refresh happens in background (user never sees it)

**Account ID:**
- Required for most endpoints
- Auto-detected from `/account` endpoint if not provided
- Stable identifier (persists for account lifetime)
- Use first BROKERAGE account, or first account if no brokerage

**Order ID Generation:**
- Must be RFC 4122 UUID (8-4-4-4-12 format)
- Auto-generated using `uuid` library
- Globally unique over time
- Serves as deduplication key (idempotent)

**Asynchronous Order Processing:**
- Order placement is asynchronous
- Response confirms submission, not execution
- Use GET /{orderId} to check status
- May return 404 if order not yet indexed (eventual consistency)
- Wait briefly and retry if 404

**Fractional Trading:**
- Use `amount` field for dollar-based orders
- Use `quantity` field for whole shares
- `amount` and `quantity` are mutually exclusive
- Fractional trading available for many stocks

**Extended Hours:**
- Available only for DAY time-in-force equity orders
- Extended hours: 4:00 AM - 8:00 PM ET
- Set `equityMarketSession: "EXTENDED"` in order request

**Options Trading:**
- Requires `optionsLevel` on account (not `NONE`)
- Include `openCloseIndicator` for options orders
- Options use OSI-normalized symbol format
- Multi-leg orders support 2-6 legs (max 1 equity leg)
- For debit spreads: limit price must be positive
- For credit spreads: limit price is negative

**Preflight Calculations:**
- Use preflight endpoints to estimate costs before placing orders
- Returns estimated commission, fees, buying power requirements
- Helps users make informed decisions
- Actual execution values may vary

For detailed documentation, see [`docs/reference/PUBLIC_IMPLEMENTATION.md`](PUBLIC_IMPLEMENTATION.md).

---

## Webull (Stocks & ETFs)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Generate App Key and App Secret on Webull website
- Enter App Key and App Secret
- Account ID auto-detected (optional to specify)
- Note: System automatically generates HMAC-SHA1 signatures (user never sees this)

**Via config.json (Legacy):**
```json
{
  "webull": {
    "appKey": "YOUR_APP_KEY",
    "appSecret": "YOUR_APP_SECRET",
    "accountId": "optional-account-id",
    "regionId": "us",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL:** `https://api.webull.com`
- **Events API:** `https://events-api.webull.com` (gRPC)
- **Market Data API:** `https://usquotes-api.webullfintech.com` (MQTT)
- **Authentication:** HMAC-SHA1 signature with App Key and App Secret
  - Each request requires calculated signature
  - Signature includes: URI, query params, body MD5, headers
  - System automatically generates signatures (user never sees this)
- **Required Config:** `appKey`, `appSecret`
- **Optional Config:** `accountId` (auto-detected), `regionId` (default: `us`)

### Notes
- **Asset Classes:** Stocks and ETFs (US market)
- **Order Types:** Market, Limit, Stop, Stop-Limit, Trailing Stop
- **Extended Hours:** Supported for LIMIT orders only
- **Instrument ID:** Must lookup `instrument_id` before trading (cached automatically)
- **Client Order ID:** User-defined, max 40 chars (auto-generated UUID)
- **Rate Limits:** Order placement: 1 req/sec, Account queries: 10 req/30 secs
- **Market Data:** Requires gRPC client for real-time prices (REST API limited)

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Extended Hours Order:**
```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "limit",
  "price": 150.00,
  "extendedHours": true,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Stop Loss Order:**
```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "stop",
  "stopPrice": 145.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Trailing Stop Order:**
```json
{
  "secret": "your-secret",
  "exchange": "webull",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "trailing_stop",
  "stopPrice": 145.00,
  "trailingType": "PERCENTAGE",
  "trailingStopStep": "5",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Special Considerations

**HMAC-SHA1 Signature Generation:**
- System automatically generates signatures for all requests
- Signature includes: URI, query params, body MD5, headers
- Clock skew protection (timestamp validation)
- Duplicate request protection (nonce uniqueness)
- User never sees signature generation

**Instrument ID Lookup:**
- Must lookup `instrument_id` before every trade
- System caches `instrument_id` → `symbol` mapping
- First trade per symbol: ~50-100ms delay (API lookup)
- Subsequent trades: ~0.1ms (cached)
- Cache persists across sessions

**Account ID Management:**
- Get `account_id` from `/app/subscriptions/list`
- Auto-detected if not provided
- Required for all trading operations
- Stored in credentials (optional)

**Client Order ID:**
- User-defined order ID (max 40 characters)
- Auto-generated using UUID (truncated to 40 chars)
- Must be globally unique
- Used for order tracking and idempotency

**Order Quantity Rules:**
- Price < $0.01: Only liquidation supported
- Price $0.01-$0.099: Minimum 1000 shares
- Price $0.1-$0.999: Minimum 100 shares
- Price >= $1.00: Minimum 1 share
- Maximum: 200,000 shares

**Price Precision:**
- Price >= $1.00: 0.01 increments
- Price < $1.00: 0.0001 increments

**Extended Hours Trading:**
- Only supported for LIMIT orders
- Set `extended_hours_trading: true`
- Not available for MARKET, STOP, or TRAILING_STOP orders

**Day Order Restrictions:**
- Day orders not allowed after 4 PM
- Error: `DAY_ORDER_NOT_ALLOWED_AFT_CORE_TIME`
- Must use GTC orders for after-hours (if supported)

**Rate Limiting:**
- Order placement: 1 request per second
- Account queries: 10 requests per 30 seconds
- Market data: 1 request per second
- System implements automatic retry with exponential backoff

**Market Data Limitation:**
- Real-time market data requires gRPC client
- REST API does not provide direct price lookup
- Consider implementing gRPC client for real-time prices
- Or use cached prices from positions/orders

For detailed documentation, see [`docs/reference/WEBULL_IMPLEMENTATION.md`](WEBULL_IMPLEMENTATION.md).

---

## TradeStation (Stocks, Options & Futures)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Click "Connect TradeStation Account" to authorize via OAuth 2.0
- User redirected to TradeStation login page
- User authorizes application
- System automatically manages tokens and detects account
- Account ID auto-detected (optional to specify)
- Note: OAuth 2.0 redirect flow (one-time setup)

**Via config.json (Legacy):**
```json
{
  "tradestation": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "refreshToken": "YOUR_REFRESH_TOKEN",
    "accountId": "optional-account-id",
    "environment": "production"
  }
}
```

### Details
- **REST Base URL (Live):** `https://api.tradestation.com/v3`
- **REST Base URL (SIM):** `https://sim-api.tradestation.com/v3`
- **Auth Server:** `https://signin.tradestation.com`
- **Authentication:** OAuth 2.0 Authorization Code Flow
  - Initial authorization via browser redirect (one-time)
  - Access tokens expire after 20 minutes (auto-refreshed)
  - Refresh tokens: Default non-expiring (can be configured to rotate)
- **Required Config:** `clientId`, `clientSecret`, `refreshToken`
- **Optional Config:** `accountId` (auto-detected), `environment` (default: `production`)

### Notes
- **Asset Classes:** Stocks, Options, and Futures
- **Order Types:** Market, Limit, Stop Market, Stop Limit
- **Advanced Orders:** OCO (Order Cancels Order), Bracket orders
- **Order ConfirmID:** Unique identifier for idempotency (1-22 characters, auto-generated)
- **SIM Environment:** Paper trading available (`environment: 'sim'`)
- **Rate Limits:** Various quotas per resource (250-500 requests per 5 minutes)
- **HTTP Streaming:** Available for real-time data (optional, REST polling sufficient)

### Webhook Examples

**Basic Market Order:**
```json
{
  "secret": "your-secret",
  "exchange": "tradestation",
  "action": "buy",
  "symbol": "AAPL",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Limit Order:**
```json
{
  "secret": "your-secret",
  "exchange": "tradestation",
  "action": "buy",
  "symbol": "MSFT",
  "orderType": "limit",
  "price": 300.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**Stop Loss Order:**
```json
{
  "secret": "your-secret",
  "exchange": "tradestation",
  "action": "buy",
  "symbol": "AAPL",
  "orderType": "stop",
  "stopPrice": 145.00,
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

**SIM (Paper Trading) Environment:**
```json
{
  "secret": "your-secret",
  "exchange": "tradestation",
  "action": "buy",
  "symbol": "AAPL",
  "environment": "sim",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Special Considerations

**OAuth 2.0 Authorization Code Flow:**
- Initial setup requires browser redirect (one-time per user)
- User must authorize SignalStudio application on TradeStation
- After authorization, tokens are managed automatically
- Refresh tokens stored securely (encrypted in database)

**Token Management:**
- Access tokens expire after 20 minutes
- System automatically refreshes tokens (within 5 minutes of expiration)
- Refresh tokens: Default non-expiring (can be configured to rotate every 30 minutes)
- If rotating refresh tokens enabled: 24-hour absolute lifetime (requires re-auth every 24 hours)

**Account ID Management:**
- Get `AccountID` from `/v3/brokerage/accounts`
- Auto-detected if not provided
- Required for all trading operations
- Stored in credentials (optional)

**Order ConfirmID:**
- User-defined order ID (1-22 characters)
- Auto-generated using UUID (truncated to 22 chars)
- Must be unique per API key, per order, per user
- Used for order tracking and idempotency

**Order ID Format:**
- Order IDs should not include dashes
- Format: `123456789` (not `1-2345-6789`)
- System automatically removes dashes when needed

**SIM vs LIVE:**
- SIM environment: Paper trading with fake money
- Same credentials work for both (user must have access)
- Change base URL based on `environment` config
- Identical API structure

**Rate Limiting:**
- Fixed 5-minute intervals (not sliding)
- Various quotas per resource category
- Returns `429 Too Many Requests` if exceeded
- System implements automatic retry with exponential backoff

**HTTP Streaming (Optional):**
- Available for real-time data (quotes, bars, orders, positions)
- REST polling is sufficient for Sparky Bot
- Streaming can be added later for real-time updates

For detailed documentation, see [`docs/reference/TRADESTATION_IMPLEMENTATION.md`](TRADESTATION_IMPLEMENTATION.md).

---

## CCXT Exchanges (100+ Exchanges)

### Overview

CCXT (CryptoCurrency eXchange Trading Library) provides unified access to 100+ cryptocurrency exchanges. Sparky uses CCXT for any exchange not covered by custom implementations.

### Supported Exchanges

Popular exchanges include:
- **Binance** (`binance`)
- **Coinbase** (`coinbase`)
- **Apex** (`apex`)
- **Bybit** (`bybit`)
- **Kraken** (`kraken`)
- **OKX** (`okx`)
- And 100+ more...

**Full list:** See [CCXT documentation](https://docs.ccxt.com/#/README?id=exchanges)

### Configuration

**Via SignalStudio (Multi-tenant):**
- Add exchange credentials in Account → Exchanges
- Select exchange from dropdown
- Enter API key and secret

**Via config.json (Legacy):**
```json
{
  "binance": {
    "apiKey": "YOUR_API_KEY",
    "apiSecret": "YOUR_API_SECRET",
    "sandboxMode": false
  }
}
```

### Details
- **Authentication:** Varies by exchange (API key/secret, OAuth, etc.)
- **Required Config:** Exchange-specific (usually `apiKey`, `apiSecret`)
- **Optional Config:** `sandboxMode`, `enableRateLimit`, etc.

### Notes
- Symbol format varies by exchange (check CCXT docs)
- Some exchanges require additional setup (IP whitelist, permissions)
- Rate limiting handled automatically by CCXT
- Test with small amounts first

### Webhook Example
```json
{
  "secret": "your-secret",
  "exchange": "binance",
  "action": "BUY",
  "symbol": "BTCUSDT",
  "stop_loss_percent": 2,
  "take_profit_percent": 5
}
```

### Getting Started
1. Check [CCXT Exchange List](https://docs.ccxt.com/#/README?id=exchanges)
2. Find your exchange name (e.g., `binance`, `coinbase`)
3. Check [Exchange-Specific Docs](https://docs.ccxt.com/#/README?id=exchanges-by-country) for:
   - API key setup
   - Symbol format
   - Rate limits
   - Special requirements
4. Add credentials in SignalStudio
5. Test with small position size

---

## Position Sizing / Risk

### Priority Order for Position Size

1. **SignalStudio Order** - `position_size_usd` from pre-built order (highest priority)
2. **Strategy Config** - From SignalStudio strategy's `order_config`
3. **Exchange Trade Settings** - From SignalStudio `trade_settings_exchange`
4. **config.json** - Fallback `tradeAmount` per exchange

### Example Flow
```javascript
// In tradeExecutor.js
let finalTradeAmount;

if (alertData.position_size_usd) {
  // Use position size from SignalStudio (pre-built order)
  finalTradeAmount = parseFloat(alertData.position_size_usd);
} else {
  // Fallback to config.json
  const exchangeConfig = this.config[this.exchange] || {};
  finalTradeAmount = exchangeConfig.tradeAmount || 600;
}
```

### Risk Controls

Risk controls (max trades per week, max loss per week) are enforced by **Sparky** before executing trades. Limits are configured per-exchange in SignalStudio Trade Settings and checked using cached counts from the `trades` table.

See [RISK_LIMITS.md](RISK_LIMITS.md) for full details.

---

## Multi-Tenant Credential Loading

In multi-tenant mode, exchange credentials are loaded from Supabase `bot_credentials` table per-user:

```javascript
// ExchangeFactory.js
const api = await ExchangeFactory.createExchangeForUser(userId, 'aster');
```

See [MULTI_TENANT.md](../guides/MULTI_TENANT.md) for full details.

---

## Adding a New Exchange

1. Create API client in `src/exchanges/newExchangeApi.js` extending `BaseExchangeAPI`
2. Add to `ExchangeFactory.createExchange()` switch statement
3. Add to `ExchangeFactory.getSupportedExchanges()` array
4. Add credential mapping in `ExchangeFactory.mapCredentialsToConfig()`
5. Update this documentation
6. Add test file in `test/testNewExchangeIntegration.js`

---

**Version:** 1.1  
**Last Updated:** December 2025
