# Notifications System

Sparky creates notifications in Supabase to keep users informed about trade events.

## Overview

The notification system is **enterprise-grade**:

- **Async/fire-and-forget** - Never blocks trade execution
- **Redis-cached preferences** - Fast preference lookups (1-5ms)
- **Fail-silent** - Notification errors don't affect trading
- **User preferences** - Respects user's notification settings

---

## Architecture

```
Trade Completes
      ↓
Check user preferences (Redis cache)
      ↓
[Preference ON] → Insert notification (async)
[Preference OFF] → Skip
      ↓
Trade response returns immediately
      ↓
User sees notification in SignalStudio
```

---

## Notification Types

### Trade Execution

| Function | Trigger | Preference Key |
|----------|---------|----------------|
| `notifyTradeSuccess()` | Position opened | `notify_trade_success` |
| `notifyTradeFailed()` | Trade error | `notify_trade_failed` |
| `notifyPositionClosedProfit()` | Closed with profit | `notify_position_closed_profit` |
| `notifyPositionClosedLoss()` | Closed with loss | `notify_position_closed_loss` |
| `notifyTakeProfitTriggered()` | TP hit | `notify_take_profit_triggered` |
| `notifyStopLossTriggered()` | SL hit | `notify_stop_loss_triggered` |

### Risk Management

| Function | Trigger | Preference Key |
|----------|---------|----------------|
| `notifyWeeklyTradeLimitReached()` | Max trades/week | `notify_weekly_trade_limit` |
| `notifyWeeklyLossLimitReached()` | Max loss/week | `notify_weekly_loss_limit` |

### Connection/System

| Function | Trigger | Preference Key |
|----------|---------|----------------|
| `notifyExchangeApiError()` | API connection failed | `notify_exchange_api_error` |
| `notifyInvalidCredentials()` | 401/auth error | `notify_invalid_credentials` |
| `notifyBotDisconnected()` | Connection lost | `notify_bot_disconnected` |
| `notifyBotReconnected()` | Connection restored | `notify_bot_reconnected` |

---

## Usage

### Basic Usage

```javascript
const { 
  notifyTradeSuccess, 
  notifyTradeFailed,
  notifyPositionClosedProfit,
  notifyPositionClosedLoss
} = require('./utils/notifications');

// After successful trade (fire-and-forget, don't await)
notifyTradeSuccess(userId, symbol, action, exchange, quantity, price);

// After trade error
notifyTradeFailed(userId, symbol, action, exchange, error.message);

// After position close
if (pnl >= 0) {
  notifyPositionClosedProfit(userId, symbol, exchange, pnl, pnlPercent);
} else {
  notifyPositionClosedLoss(userId, symbol, exchange, pnl, pnlPercent);
}
```

### Generic Notification

```javascript
const { createNotification } = require('./utils/notifications');

createNotification({
  userId: 'user-uuid',
  type: 'info',  // info, success, warning, error, trade, position, limit, system
  title: 'Custom Notification',
  message: 'This is a custom notification message.',
  metadata: { custom: 'data' },
  preferenceKey: 'notify_trade_success'  // Optional: check user preference
});
```

---

## Integration Points

### Trade Executor (`tradeExecutor.js`)

```javascript
// After position opens
if (alertData.userId) {
  notifyTradeSuccess(userId, symbol, side, exchange, quantity, price);
}

// On error
if (alertData.userId) {
  notifyTradeFailed(userId, symbol, action, exchange, error.message);
}

// After position closes
if (userId) {
  if (pnlUsd >= 0) {
    notifyPositionClosedProfit(userId, symbol, exchange, pnlUsd, pnlPercent);
  } else {
    notifyPositionClosedLoss(userId, symbol, exchange, pnlUsd, pnlPercent);
  }
}
```

### Webhook Handler (`index.js`)

```javascript
// On credential error
if (!exchangeApi) {
  notifyInvalidCredentials(userId, exchange);
}

// On webhook processing error
if (userId && alertData?.symbol) {
  notifyTradeFailed(userId, symbol, action, exchange, error.message);
}
```

---

## Performance

| Operation | Time | Impact on Trade |
|-----------|------|-----------------|
| Preference check (Redis) | 1-5ms | Minimal |
| Preference check (DB fallback) | 20-50ms | Minimal |
| Notification insert | Async | **Zero** |

The notification insert is completely async (fire-and-forget), so it has **zero impact** on trade execution speed.

---

## Configuration

### Environment Variables

```bash
# Required for notifications
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key

# Recommended for preference caching
REDIS_URL=redis://...
```

### Redis Caching

Preferences are cached in Redis:

```javascript
// Cache key
`notif_prefs:${userId}`

// TTL: 5 minutes
```

If Redis unavailable, falls back to in-memory cache.

---

## Database

### notifications table

Created by SignalStudio migration. Sparky inserts notifications here.

```sql
INSERT INTO notifications (user_id, type, title, message, metadata)
VALUES ($1, $2, $3, $4, $5);
```

### notification_preferences table

Stores user preferences. Sparky reads (never writes) this table.

```sql
SELECT * FROM notification_preferences WHERE user_id = $1;
```

---

## Troubleshooting

### Notifications not appearing

1. Check `userId` is passed through webhook → executor
2. Verify Supabase connection (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
3. Check logs for `[Notifications]` messages
4. Verify user hasn't disabled the notification type

### Performance issues

1. Enable Redis for preference caching
2. Check Redis connection in logs
3. Notifications are async - should never slow trades

### Preference not respected

1. Check `notification_preferences` table has user's row
2. Preference cache TTL is 5 min - may need to wait
3. Check Redis is returning cached preferences

---

**Version:** 1.1  
**Last Updated:** December 2025

