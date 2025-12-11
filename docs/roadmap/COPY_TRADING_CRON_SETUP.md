# Copy Trading Monthly Billing - Cron Job Setup

## Overview

The copy trading billing system processes performance fees monthly. This document explains how to set up the automated cron job.

## Endpoint

**URL:** `POST /api/copy-trading/billing/scheduled-monthly`

**Security:** Optional `X-Cron-Secret` header (set `CRON_SECRET` env var)

**What it does:**
- Calculates previous month's date automatically
- Calls the billing processor
- Logs results
- Returns summary

## Setup Options

### Option 1: cron-job.org (Recommended for Production)

1. **Sign up:** https://cron-job.org
2. **Create new cron job:**
   - **URL:** `https://app.signal-studio.co/api/copy-trading/billing/scheduled-monthly`
   - **Schedule:** `0 2 1 * *` (1st of each month at 2 AM UTC)
   - **Method:** POST
   - **Headers:**
     ```
     X-Cron-Secret: YOUR_CRON_SECRET
     Content-Type: application/json
     ```
   - **Body:** (empty - month is calculated automatically)

3. **Set environment variable:**
   ```bash
   CRON_SECRET=your-secure-random-string-here
   ```

### Option 2: GitHub Actions

Create `.github/workflows/monthly-billing.yml`:

```yaml
name: Monthly Copy Trading Billing

on:
  schedule:
    # Run on 1st of each month at 2 AM UTC
    - cron: '0 2 1 * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  billing:
    runs-on: ubuntu-latest
    steps:
      - name: Process Monthly Billing
        run: |
          curl -X POST https://app.signal-studio.co/api/copy-trading/billing/scheduled-monthly \
            -H "X-Cron-Secret: ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

### Option 3: Vercel Cron (If using Vercel)

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/copy-trading/billing/scheduled-monthly",
      "schedule": "0 2 1 * *"
    }
  ]
}
```

### Option 4: Netlify Scheduled Functions

Create `netlify/functions/scheduled-monthly-billing.ts`:

```typescript
import { Handler } from '@netlify/functions'

export const handler: Handler = async (event, context) => {
  // Call your billing endpoint
  const response = await fetch(`${process.env.URL}/api/copy-trading/billing/scheduled-monthly`, {
    method: 'POST',
    headers: {
      'X-Cron-Secret': process.env.CRON_SECRET || ''
    }
  })
  
  return {
    statusCode: 200,
    body: JSON.stringify(await response.json())
  }
}
```

Then configure in `netlify.toml`:

```toml
[functions]
  directory = "netlify/functions"

[[plugins]]
  package = "@netlify/plugin-scheduled-functions"
```

## Testing

### Test Manually

```bash
curl -X POST https://app.signal-studio.co/api/copy-trading/billing/scheduled-monthly \
  -H "X-Cron-Secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Test with Specific Month

```bash
curl -X POST https://app.signal-studio.co/api/copy-trading/billing/process-billing \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-12", "dry_run": true}'
```

## Monitoring

### Check Billing Status

The endpoint returns:
```json
{
  "success": true,
  "month": "2025-12",
  "processed": 10,
  "failed": 0,
  "totalBilled": 150.00,
  "totalCredited": 90.00
}
```

### Set Up Alerts

Add email/Slack notifications in the error handler:

```typescript
// In scheduled-monthly.ts error handler
if (error) {
  // Send alert to admin
  await sendAlert({
    type: 'billing_failed',
    month,
    error: error.message
  })
}
```

## Security

1. **Use CRON_SECRET:** Prevents unauthorized access
2. **Rate Limiting:** Add rate limiting to the endpoint
3. **Logging:** All billing runs are logged
4. **Audit Trail:** All fees marked with `fee_paid_at` timestamp

## Troubleshooting

### Billing Not Running

1. Check cron job is active
2. Verify `CRON_SECRET` matches
3. Check server logs for errors
4. Test endpoint manually

### Fees Not Calculating

1. Verify trades have `pnl_usd > 0`
2. Check `fee_paid_at IS NULL`
3. Verify relationships are `status = 'active'`
4. Check `exit_time` is in correct month

### Stripe Errors

1. Verify Stripe secret key is set
2. Check followers have `stripe_customer_id`
3. Verify Stripe account is active
4. Check Stripe logs for details

## Best Practices

1. **Run on 1st of month:** Gives time for previous month's trades to settle
2. **Run at off-peak hours:** 2 AM UTC avoids user traffic
3. **Monitor first few runs:** Watch for errors
4. **Keep audit logs:** All billing actions are logged
5. **Test in staging first:** Always test before production

---

**Ready to set up? Choose your preferred option above and configure it!**

