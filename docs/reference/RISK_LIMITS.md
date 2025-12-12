# Risk Limits Reference

Risk limits prevent over-trading and excessive losses by enforcing weekly trade counts and loss thresholds per exchange.

## Overview

Risk limits are configured per-exchange in SignalStudio's Trade Settings and enforced by Sparky before executing trades.

```
Webhook Received
    ↓
Load Exchange Trade Settings (from Supabase)
    ↓
Check Weekly Trade Count
    ├─→ Over limit? → Reject trade (429)
    └─→ Under limit? → Continue
    ↓
Check Weekly Loss Total
    ├─→ Over limit? → Reject trade (429)
    └─→ Under limit? → Continue
    ↓
Execute Trade
```

## Configuration

### Trade Settings Table

Risk limits are stored in `trade_settings_exchange`:

```sql
CREATE TABLE trade_settings_exchange (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  exchange TEXT NOT NULL,  -- 'aster', 'oanda', 'tradier', etc.
  max_trades_per_week INTEGER DEFAULT 0,  -- 0 = unlimited
  max_loss_per_week_usd NUMERIC(14,2) DEFAULT 0,  -- 0 = unlimited
  -- ... other settings
);
```

### Setting Limits

**Via SignalStudio UI:**
1. Go to Account → Trade Settings
2. Select exchange
3. Set "Max Trades Per Week" (0 = unlimited)
4. Set "Max Loss Per Week (USD)" (0 = unlimited)
5. Save settings

**Via SQL:**
```sql
INSERT INTO trade_settings_exchange (user_id, exchange, max_trades_per_week, max_loss_per_week_usd)
VALUES (
  'user-uuid',
  'aster',
  50,      -- Max 50 trades per week
  1000.00  -- Max $1000 loss per week
)
ON CONFLICT (user_id, exchange) 
DO UPDATE SET 
  max_trades_per_week = EXCLUDED.max_trades_per_week,
  max_loss_per_week_usd = EXCLUDED.max_loss_per_week_usd;
```

## How It Works

### Weekly Trade Count

**Calculation:**
- Counts all **closed trades** (from `trades` table) for the current week
- Week starts Monday 00:00:00 UTC
- Only counts trades for the specific exchange
- Resets every Monday

**Caching:**
- Redis cache: 5 minute TTL
- In-memory cache: 5 minute TTL (fallback)
- Cache invalidated after trade closes

**Example:**
```javascript
// User has executed 48 trades this week
// Limit: 50 trades per week
// Status: ✅ Under limit (2 remaining)
```

### Weekly Loss Total

**Calculation:**
- Sums all **realized losses** (negative P&L) from closed trades
- Only counts losses (positive P&L ignored)
- Week starts Monday 00:00:00 UTC
- Only counts trades for the specific exchange
- Resets every Monday

**Caching:**
- Redis cache: 5 minute TTL
- In-memory cache: 5 minute TTL (fallback)
- Cache invalidated after trade closes

**Example:**
```javascript
// User has lost $950 this week
// Limit: $1000 loss per week
// Status: ✅ Under limit ($50 remaining)
```

## Enforcement

### Check Flow

**File:** `src/utils/riskLimits.js`

```javascript
const { checkRiskLimits } = require('./utils/riskLimits');

// Before executing trade
const riskCheck = await checkRiskLimits(userId, exchange, settings);

if (!riskCheck.allowed) {
  return res.status(429).json({
    success: false,
    error: 'Risk limit exceeded',
    message: riskCheck.reason,
    data: {
      limitType: riskCheck.limitType,  // 'max_trades_per_week' or 'max_loss_per_week'
      current: riskCheck.current,
      limit: riskCheck.limit
    }
  });
}
```

### Response Format

**When Limit Exceeded:**
```json
{
  "success": false,
  "error": "Risk limit exceeded",
  "message": "Maximum trades per week limit exceeded. You have executed 50 trades this week (limit: 50). Limit resets on 1/8/2025.",
  "data": {
    "limitType": "max_trades_per_week",
    "current": 50,
    "limit": 50
  }
}
```

## Notifications

When a limit is reached, a notification is created:

### Trade Limit Reached

**Function:** `notifyWeeklyTradeLimitReached()`

**Notification:**
- Type: `limit`
- Title: "Weekly Trade Limit Reached"
- Message: "You've reached your weekly trade limit (50/50). Limit resets on Monday."

### Loss Limit Reached

**Function:** `notifyWeeklyLossLimitReached()`

**Notification:**
- Type: `limit`
- Title: "Weekly Loss Limit Reached"
- Message: "You've reached your weekly loss limit ($1,000/$1,000). Limit resets on Monday."

## Performance

### Caching Strategy

1. **Redis Cache** (if available)
   - Key: `risk:{userId}:{exchange}:weekly_trades:{weekStart}`
   - TTL: 5 minutes
   - Fast: 1-5ms lookup

2. **In-Memory Cache** (fallback)
   - Map keyed by cache key
   - TTL: 5 minutes
   - Fast: <1ms lookup

3. **Database Query** (if cache miss)
   - Counts from `trades` table
   - Slower: 20-50ms
   - Results cached for next request

### Cache Invalidation

Cache is invalidated when:
- Trade closes (via `invalidateRiskLimitCache()`)
- Week resets (automatic on Monday)
- Manual invalidation (for testing)

## Graceful Degradation

If risk limit check fails (database error, etc.):
- **Logs warning** but **allows trade** (graceful degradation)
- Prevents risk limits from blocking trades due to system issues
- Ensures trading continues even if limit checking is unavailable

## Best Practices

### For Users

1. **Set Realistic Limits**
   - Start conservative, adjust based on performance
   - Consider your trading style and risk tolerance

2. **Monitor Weekly Progress**
   - Check trade count mid-week
   - Monitor loss accumulation
   - Adjust limits if needed

3. **Plan for Week Reset**
   - Limits reset Monday 00:00 UTC
   - Plan trading activity accordingly

### For Administrators

1. **Default Limits**
   - Set sensible defaults for new users
   - Consider subscription tier differences

2. **Monitoring**
   - Track limit hit rates
   - Identify users hitting limits frequently
   - Adjust defaults if needed

3. **Documentation**
   - Clearly explain limit behavior
   - Show reset schedule
   - Provide examples

## Troubleshooting

### "Limit check failed, allowing webhook"

- **Cause:** Database error or cache failure
- **Action:** Check logs for specific error
- **Impact:** Trade allowed (graceful degradation)
- **Fix:** Verify Supabase connection, Redis connection

### "Limit exceeded but trade executed"

- **Cause:** Cache not invalidated after previous trade
- **Action:** Wait 5 minutes for cache to refresh
- **Fix:** Manual cache invalidation or wait for TTL

### "Limit not resetting on Monday"

- **Cause:** Week calculation issue
- **Action:** Verify `getWeekStart()` function
- **Fix:** Week starts Monday 00:00 UTC, not local time

## API Reference

### Check Risk Limits

```javascript
const { checkRiskLimits } = require('./utils/riskLimits');

const result = await checkRiskLimits(userId, exchange, settings);

// Result:
{
  allowed: true,  // or false
  reason: "...",  // if not allowed
  limitType: "max_trades_per_week",  // or "max_loss_per_week"
  current: 48,
  limit: 50
}
```

### Get Weekly Trade Count

```javascript
const { getWeeklyTradeCount } = require('./utils/riskLimits');

const count = await getWeeklyTradeCount(userId, exchange);
// Returns: 48
```

### Get Weekly Loss Total

```javascript
const { getWeeklyLossTotal } = require('./utils/riskLimits');

const loss = await getWeeklyLossTotal(userId, exchange);
// Returns: 950.00
```

### Invalidate Cache

```javascript
const { invalidateRiskLimitCache } = require('./utils/riskLimits');

await invalidateRiskLimitCache(userId, exchange);
```

---

**Version:** 1.0  
**Last Updated:** December 2025

