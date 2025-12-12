## Strategy & Automation Notes

Keep this file updated whenever you add new automation logic (dynamic trailing stops, auto-closes, etc.).

### Strategy Manager
- Strategies live in Supabase (`strategies` table) and can be toggled active/inactive.
- `strategyId` on a webhook will be validated by `StrategyManager`.
- When trades close, P&L stats are pushed back to Supabase for dashboard metrics.

### Dynamic Trailing Stops
- Legacy dynamic trailing-stop plan has been merged here.
- Webhook fields:
  - `useTrailingStop`: `true` to enable.
  - `trailing_stop_pips`: distance for OANDA trailing stops.
- For exchanges without native trailing stops, fall back to regular SL logic (see executors).

### Option Strategies
- Tradier options OTCO orders include:
  - Entry limit (buy_to_open)
  - Take-profit limit (sell_to_close)
  - Stop (sell_to_close, `stop` or `stop_limit`)
- Monitor promotes statuses: `pending_entry` → `open` → `closed_tp/sl/auto`.
- All open legs are stored in the `tradier_option_trades` table; completed trades are logged to the main `trades` table for dashboard stats.
- Customize per-symbol behavior via Supabase trade settings (e.g., `position_size_percent`, `strike_tolerance_percent`).

### Alerts / Webhooks
- Each strategy should define the required alert payload fields.
- Keep `docs/guides/TRADINGVIEW.md` updated with any new JSON keys so traders know what to send.

### Adding New Strategies
1. Add DB row (via Supabase UI or API).
2. Document webhook payload in this file or the trading view doc.
3. If the strategy needs custom execution logic, add a dedicated executor or path in `TradeExecutor`.
4. Update dashboards as needed (charts/tables).

