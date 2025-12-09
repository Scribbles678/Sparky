# Sparky Bot - Order Builder Integration Changes

## Summary

Sparky bot now receives **pre-built orders** from SignalStudio instead of building them itself. SignalStudio handles strategy configuration lookup and order building, then forwards complete orders to Sparky for execution.

**Webhook Flow:**
- TradingView → SignalStudio (`https://app.signal-studio.co/api/webhook`)
- SignalStudio validates secret, builds order, forwards to Sparky Bot **asynchronously**
- Sparky Bot receives pre-built order and executes trade

## Changes Made

### 1. Webhook Handler Updates ✅
**File:** `src/index.js`

- Added comment noting that webhook now receives pre-built orders from SignalStudio
- Added logging to identify source (SignalStudio vs Direct webhook)
- **Per-user secret validation**: Validates webhook secrets from Supabase `bot_credentials` table
- **In-memory cache**: Caches webhook secrets for 30 seconds (refreshes automatically)
- **Fallback**: Falls back to legacy `WEBHOOK_SECRET` if Supabase validation fails
- No logic changes to order processing - webhook handler already worked correctly

### 2. Position Sizing Update ✅
**File:** `src/tradeExecutor.js`

**Before:**
```javascript
// Always used config.json
const exchangeTradeAmount = exchangeConfig.tradeAmount || 600;
const finalTradeAmount = exchangeTradeAmount * positionMultiplier;
```

**After:**
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

**Why:** SignalStudio's OrderBuilder sends `position_size_usd` in the order. Sparky needs to use this value instead of ignoring it and using config.json.

### 3. Alert Data Extraction ✅
**File:** `src/tradeExecutor.js`

- Added `position_size_usd` and `positionSizeUsd` to destructured alertData
- Supports both snake_case and camelCase (for flexibility)

## What Still Works

### Strategy Validation (Optional)
Sparky still validates strategies if provided in the alert:
- Checks if strategy exists
- Checks if strategy is active
- Gets strategy_id for database tracking

**Note:** This is optional - if strategy is not provided, trade still executes (for backward compatibility).

### Direct Webhooks (Backward Compatibility)
Sparky still supports direct webhooks that don't go through SignalStudio:
- Uses config.json for position sizing (fallback)
- Uses alert data for TP/SL if provided
- Works exactly as before

## Order Flow

### New Flow (SignalStudio → Sparky)
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
Forwards to Sparky Bot
  {
    exchange: "aster",
    action: "BUY",
    symbol: "BTCUSDT",
    order_type: "market",
    position_size_usd: 100,  ← Sparky uses this
    stop_loss_percent: 2.0,
    take_profit_percent: 4.0,
    strategy_id: "uuid"
  }
    ↓
Sparky tradeExecutor
  - Uses position_size_usd from order
  - Executes trade
  - Tracks strategy_id
```

### Legacy Flow (Direct Webhook)
```
TradingView Alert (Full)
    ↓
Sparky Bot (Direct)
  {
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

## Testing

### Test Pre-Built Orders
1. Send simple alert from TradingView:
   ```json
   {
     "secret": "...",
     "strategy": "my_strategy",
     "action": "BUY",
     "symbol": "BTCUSDT"
   }
   ```
2. SignalStudio builds order with `position_size_usd: 100`
3. Sparky receives order and uses `position_size_usd: 100`
4. Trade executes with correct position size

### Test Backward Compatibility
1. Send direct webhook to Sparky:
   ```json
   {
     "secret": "...",
     "exchange": "aster",
     "action": "BUY",
     "symbol": "BTCUSDT"
   }
   ```
2. Sparky uses config.json for position size (fallback)
3. Trade executes as before

## Status: ✅ Complete

All changes are minimal and maintain backward compatibility. Sparky now:
- ✅ Uses position_size_usd from SignalStudio orders
- ✅ Falls back to config.json for direct webhooks
- ✅ Still validates strategies (optional)
- ✅ Still tracks strategy_id for analytics
- ✅ Works with both new and legacy webhook formats

