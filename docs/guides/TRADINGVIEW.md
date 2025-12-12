## TradingView Alerts & Webhooks

Use this doc instead of `TRADINGVIEW_SETUP.md` + `WEBHOOK_TROUBLESHOOTING.md`.

### ⚠️ Important: Webhook Flow Change

**TradingView alerts now go to SignalStudio first, then Sparky Bot.**

**Webhook URL:** `https://app.signal-studio.co/api/webhook`

**Flow:**
1. TradingView → SignalStudio (`/api/webhook`)
2. SignalStudio validates secret, builds order from strategy config
3. SignalStudio → Sparky Bot (async forwarding)
4. Sparky Bot executes trade

### Endpoint

**SignalStudio Endpoint:**
- `POST https://app.signal-studio.co/api/webhook` with `Content-Type: application/json`.

**Sparky Bot Endpoint (for direct webhooks - backward compatibility):**
- `POST /webhook` with `Content-Type: application/json`.

### Required Fields

**Simple Alert (Recommended - if using SignalStudio strategies):**
- `secret`: Your webhook secret from SignalStudio
- `strategy`: Strategy name or ID configured in SignalStudio
- `action`: `buy`, `sell`, `close`, `long`, `short`
- `symbol`: Underlying (e.g., `BTCUSDT`, `EUR_USD`, `AAPL`)

**Full Alert (For direct webhooks or overrides):**
- `secret`: Must match per-user secret from Supabase (or legacy `WEBHOOK_SECRET`)
- `exchange`: Must match one of the configured exchanges (`aster`, `oanda`, `tradier`, `tradier_options`, etc.)
- `action`: `buy`, `sell`, `close`, `long`, `short`
- `symbol`: Underlying (e.g., `BTCUSDT`, `EUR_USD`, `AAPL`)

### Optional Fields
- `strategy`: matches Supabase strategy id/name (required if Strategy Manager is enforcing allowlists).
- `orderType` / `order_type`: `market` by default.
- `stop_loss_percent`, `take_profit_percent`.
- `useTrailingStop`, `trailing_stop_pips` (OANDA only).
- Tradier options:
  - `right`: `call` or `put`.
  - `strike`: target strike.
  - `size` or `sizePercent`: percent of buying power to allocate (only used by the Tradier options executor; other exchanges ignore these fields and rely on `config.json` sizing).

### Example Payloads

**Simple Alert (SignalStudio - Recommended):**
```json
{
  "secret": "your-webhook-secret-from-signalstudio",
  "strategy": "supply_demand_ma_crossover",
  "action": "buy",
  "symbol": "AAPL"
}
```

**Full Alert (Direct to Sparky Bot or Override):**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "tradier_options",
  "action": "buy",
  "symbol": "AAPL",
  "right": "call",
  "sizePercent": 15,
  "strategy": "supply_demand_ma_crossover"
}
```

### Troubleshooting
- `401 Unauthorized`: Secret mismatch. Check your webhook secret in SignalStudio matches exactly.
- `400 Missing exchange`: For direct webhooks, every alert must provide `exchange`; we no longer fall back to Aster.
- `400 Invalid symbol`: Ensure `symbol` matches exchange syntax (`EUR_USD`, `BTCUSDT`, etc.).
- Options failing to place: Verify strike tolerance, expiration, and trading window in Supabase settings.
- **Webhook not received by Sparky Bot**: Check SignalStudio logs to see if forwarding succeeded. Sparky Bot processes orders asynchronously.
- **Per-user secret validation**: Sparky Bot validates secrets from Supabase `bot_credentials` table (with in-memory cache). If validation fails, it falls back to legacy `WEBHOOK_SECRET`.
- Use `node test/testWebhook.js` for local smoke tests (set `WEBHOOK_SECRET` + base URL in the script).

### Best Practices
- Always sanitize secrets before sharing payloads.
- Document new alert fields here whenever executors/monitors start consuming them.

