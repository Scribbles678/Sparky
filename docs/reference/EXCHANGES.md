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
