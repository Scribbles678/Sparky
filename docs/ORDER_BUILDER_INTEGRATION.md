# Sparky Bot - Order Builder Integration

## Summary

Sparky bot receives **pre-built orders** from SignalStudio instead of building them itself. SignalStudio handles strategy configuration lookup and order building, then forwards complete orders to Sparky for execution.

**Webhook Flow:**
- TradingView → SignalStudio (`https://app.signal-studio.co/api/webhook`)
- SignalStudio validates secret, builds order, forwards to Sparky Bot **asynchronously**
- Sparky Bot receives pre-built order and executes trade

## How It Works

### 1. Webhook Handler
**File:** `src/index.js`

- Receives pre-built orders from SignalStudio
- Logs source (SignalStudio vs Direct webhook) via `user_id` presence
- **Per-user secret validation**: Validates webhook secrets from Supabase `bot_credentials` table
- **In-memory cache**: Caches webhook secrets for 30 seconds (refreshes automatically)
- **Fallback**: Falls back to legacy `WEBHOOK_SECRET` if Supabase validation fails

### 2. Position Sizing
**File:** `src/tradeExecutor.js`

Position size is determined by priority:

1. **`position_size_usd` from alert** (highest priority) - SignalStudio pre-built orders
2. **`config.json` fallback** - For direct webhooks or backward compatibility

```javascript
// Priority: alertData.position_size_usd > config.json
if (alertData.position_size_usd || alertData.positionSizeUsd) {
  // Use position size from SignalStudio (pre-built order)
  finalTradeAmount = parseFloat(alertData.position_size_usd || alertData.positionSizeUsd);
} else {
  // Fallback to config.json (backward compatibility)
  const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
  const positionMultiplier = exchangeConfig.positionMultiplier || 1.0;
  finalTradeAmount = exchangeTradeAmount * positionMultiplier;
}
```

### 3. Strategy Validation (Optional)

Sparky validates strategies if provided in the alert:
- Checks if strategy exists
- Checks if strategy is active
- Gets `strategy_id` for database tracking

**Note:** This is optional - if strategy is not provided, trade still executes.

---

## Order Flow

### Recommended Flow (SignalStudio → Sparky)

```
TradingView Alert (Simple)
    ↓
SignalStudio Webhook
    ↓
OrderBuilder.buildOrder()
  - Loads strategy config
  - Loads trade settings
  - Merges configuration
  - Builds complete order
    ↓
Forwards to Sparky Bot (async)
  {
    exchange: "aster",
    action: "BUY",
    symbol: "BTCUSDT",
    order_type: "market",
    position_size_usd: 100,  ← Sparky uses this
    stop_loss_percent: 2.0,
    take_profit_percent: 4.0,
    strategy_id: "uuid",
    user_id: "user-uuid"
  }
    ↓
Sparky tradeExecutor
  - Uses position_size_usd from order
  - Executes trade
  - Tracks strategy_id
  - Logs to user's trades
```

### Legacy Flow (Direct Webhook)

```
TradingView Alert (Full)
    ↓
Sparky Bot (Direct)
  {
    secret: "webhook_secret",
    exchange: "aster",
    action: "BUY",
    symbol: "BTCUSDT",
    position_size_usd: 100  ← Optional, falls back to config.json
  }
    ↓
Sparky tradeExecutor
  - Uses position_size_usd if provided
  - Falls back to config.json if not
  - Executes trade
```

---

## Pre-Built Order Fields

SignalStudio sends these fields in pre-built orders:

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | User identifier (for multi-tenant) |
| `exchange` | string | Exchange name (aster, oanda, tradier) |
| `action` | string | BUY, SELL, or CLOSE |
| `symbol` | string | Trading symbol |
| `order_type` | string | market or limit |
| `position_size_usd` | number | Position size in USD |
| `stop_loss_percent` | number | Stop loss percentage |
| `take_profit_percent` | number | Take profit percentage |
| `strategy_id` | UUID | Strategy reference |
| `strategy` | string | Strategy name (for logging) |
| `is_simple_alert` | boolean | Whether built from simple alert |

---

## Testing

### Test Pre-Built Orders

1. Send simple alert from TradingView to SignalStudio:
   ```json
   {
     "secret": "your-webhook-secret",
     "strategy": "my_strategy",
     "action": "BUY",
     "symbol": "BTCUSDT"
   }
   ```
2. SignalStudio builds order with `position_size_usd: 100`
3. Sparky receives order and uses `position_size_usd: 100`
4. Trade executes with correct position size

### Test Direct Webhook (Backward Compatibility)

1. Send direct webhook to Sparky:
   ```json
   {
     "secret": "your-webhook-secret",
     "exchange": "aster",
     "action": "BUY",
     "symbol": "BTCUSDT"
   }
   ```
2. Sparky uses config.json for position size (fallback)
3. Trade executes as before

---

## Features

Sparky's Order Builder integration:

- ✅ Uses `position_size_usd` from SignalStudio orders
- ✅ Falls back to `config.json` for direct webhooks
- ✅ Validates strategies (optional)
- ✅ Tracks `strategy_id` for analytics
- ✅ Works with both new and legacy webhook formats
- ✅ Multi-tenant support via `user_id`

---

**Version:** 1.1  
**Last Updated:** December 2025

