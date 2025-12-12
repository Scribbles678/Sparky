# Webhook Limits Reference

Webhook limits enforce monthly subscription-based quotas to prevent abuse and manage platform resources.

## Overview

Webhook limits are based on user subscription plans and reset monthly. Limits are checked before processing each webhook.

```
Webhook Received
    ↓
Get User Subscription Plan (cached)
    ↓
Get Monthly Webhook Count
    ↓
Check Limit
    ├─→ Over limit? → Reject webhook (429)
    └─→ Under limit? → Continue
    ↓
Process Webhook
    ↓
Log to webhook_requests (increments count)
```

## Subscription Plans

### Plan Limits

| Plan | Monthly Limit | Warning Threshold |
|------|---------------|-------------------|
| Free | 5 webhooks | 4 (80%) |
| Pro | Unlimited | N/A |

### Plan Detection

Plans are determined from `subscriptions` table:

```sql
SELECT plan FROM subscriptions 
WHERE user_id = 'user-uuid' 
AND status = 'active'
ORDER BY created_at DESC 
LIMIT 1;
```

**Fallback:** If no subscription found, defaults to "Free" plan.

## Configuration

### Subscription Table

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  plan TEXT NOT NULL,  -- 'Free', 'Pro'
  status TEXT DEFAULT 'active',  -- 'active', 'cancelled', 'expired'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
```

### Setting Subscription

**Via SignalStudio UI:**
1. Go to Account → Subscription
2. Select plan (Free or Pro)
3. Subscribe/upgrade

**Via SQL:**
```sql
INSERT INTO subscriptions (user_id, plan, status)
VALUES ('user-uuid', 'Pro', 'active')
ON CONFLICT (user_id) 
DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status;
```

## How It Works

### Monthly Count

**Calculation:**
- Counts all webhooks in `webhook_requests` table for current month
- Month starts 1st day 00:00:00 UTC
- Only counts webhooks for the specific user
- Resets on 1st of each month

**Caching:**
- Redis cache: 5 minute TTL
- In-memory cache: 5 minute TTL (fallback)
- Cache key includes month ID (handles month transitions)

**Example:**
```javascript
// User has sent 4 webhooks this month
// Limit: 5 webhooks (Free plan)
// Status: ✅ Under limit (1 remaining)
```

### Limit Check

**File:** `src/utils/webhookLimits.js`

```javascript
const { checkWebhookLimit } = require('./utils/webhookLimits');

// Before processing webhook
const limitCheck = await checkWebhookLimit(userId);

if (!limitCheck.allowed) {
  return res.status(429).json({
    success: false,
    error: 'Webhook limit exceeded',
    message: limitCheck.reason,
    data: {
      current: limitCheck.current,
      limit: limitCheck.limit,
      plan: limitCheck.plan,
      resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
    }
  });
}
```

### Response Format

**When Limit Exceeded:**
```json
{
  "success": false,
  "error": "Webhook limit exceeded",
  "message": "Monthly webhook limit exceeded: 5/5",
  "data": {
    "current": 5,
    "limit": 5,
    "plan": "Free",
    "resetDate": "2025-02-01T00:00:00.000Z"
  }
}
```

## Notifications

### Warning Notification (80% Threshold)

When user reaches 80% of limit, a warning notification is created:

**Function:** `notifyWebhookLimitWarning()`

**Notification:**
- Type: `limit`
- Title: "Webhook Limit Warning"
- Message: "You've used 80% of your monthly webhook limit (4/5). Limit resets on Feb 1, 2025."

### Limit Reached Notification

When user exceeds limit:

**Function:** `notifyWebhookLimitReached()`

**Notification:**
- Type: `limit`
- Title: "Webhook Limit Reached"
- Message: "You've reached your monthly webhook limit (5/5). Upgrade to Pro for unlimited webhooks. Limit resets on Feb 1, 2025."

## Performance

### Caching Strategy

1. **Redis Cache** (if available)
   - Key: `webhook_count:{userId}:{monthId}`
   - TTL: 5 minutes
   - Fast: 1-5ms lookup

2. **In-Memory Cache** (fallback)
   - Map keyed by userId
   - Includes month ID for month transition handling
   - TTL: 5 minutes
   - Fast: <1ms lookup

3. **Database Function** (fastest, if available)
   - Uses Supabase function: `check_webhook_limit(user_id, plan)`
   - Returns boolean (under limit = true)
   - Fast: 5-10ms

4. **Database Query** (if function unavailable)
   - Counts from `webhook_requests` table
   - Slower: 20-50ms
   - Results cached for next request

### Cache Invalidation

Cache is invalidated when:
- Webhook is logged (via `invalidateWebhookLimitCache()`)
- Month resets (automatic on 1st)
- Manual invalidation (for testing)

## Graceful Degradation

If webhook limit check fails (database error, etc.):
- **Logs warning** but **allows webhook** (graceful degradation)
- Prevents limits from blocking webhooks due to system issues
- Ensures trading continues even if limit checking is unavailable

## Webhook Logging

Every webhook is logged to `webhook_requests` table:

```sql
CREATE TABLE webhook_requests (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  exchange TEXT,
  symbol TEXT,
  action TEXT,
  status TEXT,  -- 'success', 'error', 'rejected'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Logging happens:**
- After webhook is processed (success or error)
- Before limit check (for accurate counting)
- Async/fire-and-forget (doesn't block response)

## Best Practices

### For Users

1. **Monitor Usage**
   - Check webhook count mid-month
   - Watch for warning notifications (80% threshold)
   - Plan trading activity accordingly

2. **Upgrade When Needed**
   - Free plan: 5 webhooks/month (good for testing)
   - Pro plan: Unlimited (for active trading)

3. **Understand Reset Schedule**
   - Limits reset on 1st of each month (00:00 UTC)
   - Plan trading activity around reset

### For Administrators

1. **Default Plans**
   - New users default to "Free" plan
   - Provide clear upgrade path to Pro

2. **Monitoring**
   - Track limit hit rates
   - Identify users hitting limits frequently
   - Consider adjusting limits if needed

3. **Documentation**
   - Clearly explain limit behavior
   - Show reset schedule
   - Provide upgrade instructions

## Troubleshooting

### "Limit check failed, allowing webhook"

- **Cause:** Database error or cache failure
- **Action:** Check logs for specific error
- **Impact:** Webhook allowed (graceful degradation)
- **Fix:** Verify Supabase connection, Redis connection

### "Limit exceeded but webhook processed"

- **Cause:** Cache not invalidated after previous webhook
- **Action:** Wait 5 minutes for cache to refresh
- **Fix:** Manual cache invalidation or wait for TTL

### "Limit not resetting on 1st"

- **Cause:** Month calculation issue
- **Action:** Verify `getCurrentMonthId()` function
- **Fix:** Month resets on 1st 00:00 UTC, not local time

### "Pro plan showing limit"

- **Cause:** Subscription not found or inactive
- **Action:** Verify subscription in database
- **Fix:** Ensure subscription exists and status = 'active'

## API Reference

### Check Webhook Limit

```javascript
const { checkWebhookLimit } = require('./utils/webhookLimits');

const result = await checkWebhookLimit(userId);

// Result:
{
  allowed: true,  // or false
  current: 4,
  limit: 5,
  plan: 'Free',
  reason: "..."  // if not allowed
}
```

### Get Webhook Count

```javascript
const { getWebhookCountThisMonth } = require('./utils/webhookLimits');

const count = await getWebhookCountThisMonth(userId);
// Returns: 4
```

### Get Subscription Plan

```javascript
const { getUserSubscriptionPlan } = require('./utils/webhookLimits');

const plan = await getUserSubscriptionPlan(userId);
// Returns: 'Free' or 'Pro'
```

### Invalidate Cache

```javascript
const { invalidateWebhookLimitCache } = require('./utils/webhookLimits');

await invalidateWebhookLimitCache(userId);
```

## Integration with SignalStudio

SignalStudio also enforces webhook limits before forwarding to Sparky:

1. **SignalStudio checks limit** (first line of defense)
2. **Sparky checks limit** (second line of defense)
3. **Both must pass** for webhook to be processed

This dual-check ensures limits are enforced even if one system fails.

---

**Version:** 1.0  
**Last Updated:** December 2025

