## TradingView Alerts & Webhooks

Use this doc instead of `TRADINGVIEW_SETUP.md` + `WEBHOOK_TROUBLESHOOTING.md`.

### Endpoint
- All alerts post to `POST /webhook` with `Content-Type: application/json`.
- Required fields:
  - `secret`: must match `WEBHOOK_SECRET`.
  - `exchange`: must match one of the configured exchanges (`aster`, `oanda`, `tradier`, `tradier_options`, etc.).
  - `action`: `buy`, `sell`, `close`, `long`, `short`.
  - `symbol`: underlying (e.g., `BTCUSDT`, `EUR_USD`, `AAPL`).

### Optional Fields
- `strategy`: matches Supabase strategy id/name (required if Strategy Manager is enforcing allowlists).
- `orderType` / `order_type`: `market` by default.
- `stop_loss_percent`, `take_profit_percent`.
- `useTrailingStop`, `trailing_stop_pips` (OANDA only).
- Tradier options:
  - `right`: `call` or `put`.
  - `strike`: target strike.
  - `size` or `sizePercent`: percent of buying power to allocate (only used by the Tradier options executor; other exchanges ignore these fields and rely on `config.json` sizing).

### Example Payload
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "tradier_options",
  "action": "buy",
  "symbol": "AAPL",
  "right": "call",
  "sizePercent": 15,
  "strategy": "supply_demand_ma_crossover"
}
```

### Troubleshooting
- `401 Unauthorized`: secret mismatch.
- `400 Missing exchange`: every alert must provide `exchange`; we no longer fall back to Aster.
- `400 Invalid symbol`: ensure `symbol` matches exchange syntax (`EUR_USD`, `BTCUSDT`, etc.).
- Options failing to place: verify strike tolerance, expiration, and trading window in Supabase settings.
- Use `node test/testWebhook.js` for local smoke tests (set `WEBHOOK_SECRET` + base URL in the script).

### Best Practices
- Always sanitize secrets before sharing payloads.
- Document new alert fields here whenever executors/monitors start consuming them.

