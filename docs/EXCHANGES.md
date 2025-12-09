## Exchange Integration Reference

This doc replaces the old per-exchange markdown files. Update this file whenever you add an exchange, change authentication requirements, or tweak trade sizing logic.

### Aster DEX (Crypto Futures)
- REST base URL: `https://fapi.asterdex.com`
- Required config: `apiKey`, `apiSecret`, optional `tradeAmount`
- Notes:
  - Supports USDT-margined perpetuals.
  - Position size defaults to `tradeAmount` in `config.json` unless overridden in Supabase trade settings.
  - Uses position tracker + Supabase logging for SignalStudio dashboard.

### OANDA (Forex)
- Config: `accountId`, `accessToken`, `environment` (`practice` or `live`)
- Supports trailing stops via webhook fields `useTrailingStop` + `trailing_stop_pips`.
- Trades sized via `tradeAmount` (USD notional); Supabase global/exchange settings can override.
- Requires Node.js 18+ (OANDA recommends v20 for TLS updates).

### Tradier (Equities)
- Config: `accountId`, `accessToken`, `environment`
- Used for stock/ETF orders via `TradeExecutor`.
- Add per-exchange caps (max trades/day, TP/SL defaults) with Supabase Trade Settings page.

### Tradier Options
- Config block `tradierOptions` shares the same account credentials.
- `TradierOptionsExecutor` builds OTCO orders (entry + TP + SL).
- The `TradierOptionsMonitor` polls `tradier_option_trades` to detect fills and log P&L.
- Respect trading windows defined in Supabase (`auto_close_outside_window` will flatten positions after hours).

### Hyperliquid (Crypto Perps)
- Config: `apiKey` (wallet address), `privateKey`, optional `baseUrl`, `isTestnet`.
- Uses `HyperliquidAPI` (extending `BaseExchangeAPI`) with reduce-only closes.
- Document any new order types or rate-limit constraints here.

### Lighter DEX (zk rollup)
- Config: `apiKey`, `privateKey`, `accountIndex`, `apiKeyIndex`, `baseUrl`.
- Supports reduce-only market closes; ensure gas/nonce requirements are covered before deploying.

### Position Sizing / Risk
- Default per-exchange sizing comes from the corresponding block in `config.json`.
- Supabase trade settings are currently consumed by the Tradier options executor (trading window, TP/SL %, strike tolerance, etc.). Crypto/forex exchanges still rely entirely on local config values.
- Update this doc whenever you add new knobs so everyone knows where to configure them and which executors consume them.

