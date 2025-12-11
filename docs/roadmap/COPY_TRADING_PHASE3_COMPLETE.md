# Copy Trading Phase 3 - Monetization ✅

**Date:** December 2025  
**Status:** Complete - Performance Fee Billing System

---

## What Was Built

### ✅ 1. Performance Fee Calculation

**Location:** `server/api/copy-trading/billing/calculate-fees.ts`

**What it does:**
- Calculates all unpaid performance fees from profitable copied trades
- Groups fees by relationship and leader
- Supports filtering by month or specific relationship
- Returns detailed summary ready for billing

**Features:**
- Only counts profitable trades (`pnl_usd > 0`)
- Only counts unpaid fees (`fee_paid_at IS NULL`)
- Groups by relationship for accurate billing
- Calculates platform cut (40%) and leader cut (60%)

---

### ✅ 2. Monthly Billing Processor

**Location:** `server/api/copy-trading/billing/process-billing.ts`

**What it does:**
- Processes all unpaid fees
- Creates Stripe invoices for followers
- Credits leaders (stored for payout)
- Marks fees as paid

**Flow:**
1. Calculate all unpaid fees
2. Group by follower (for billing)
3. Group by leader (for crediting)
4. Create Stripe invoice items
5. Create and finalize Stripe invoices
6. Mark trades as paid (`fee_paid_at` timestamp)
7. Store leader credits (for future payout)

**Features:**
- Dry run mode for testing
- Error handling per follower
- Detailed results reporting
- Stripe invoice metadata for tracking

---

### ✅ 3. Leader Earnings Dashboard

**Location:** 
- `server/api/copy-trading/leader/earnings.ts` (API)
- `app/pages/copy-trading/leader/earnings.vue` (UI)

**What it shows:**
- Total earnings (all time or by month)
- Paid vs pending earnings
- Earnings by strategy
- Total copiers count
- Profitable trades count

**Features:**
- Filter by month or all-time
- Breakdown by strategy
- Real-time data from database
- Clean, professional UI

---

## How It Works

### Fee Calculation Flow

```
Monthly Billing Cron Job (1st of each month)
    ↓
POST /api/copy-trading/billing/process-billing
    ↓
1. Query copied_trades:
   - pnl_usd > 0 (profitable)
   - fee_paid_at IS NULL (unpaid)
   - exit_time in last month
    ↓
2. Group by follower:
   - Sum all fees per follower
   - Create Stripe invoice
   - Charge follower
    ↓
3. Group by leader:
   - Sum leader fees (60% of total)
   - Store for payout
    ↓
4. Mark as paid:
   - Update fee_paid_at timestamp
   - All trades now marked as paid
```

### Fee Structure

**Example:**
- Follower makes $100 profit
- Leader override fee: 15%
- Total fee: $100 × 15% = $15
- Platform gets: $15 × 40% = $6
- Leader gets: $15 × 60% = $9

**Stored in `copied_trades`:**
- `override_fee_charged`: $15
- `platform_fee_usd`: $6
- `leader_fee_usd`: $9
- `fee_paid_at`: timestamp when billed

---

## API Endpoints

### 1. Calculate Fees
```
POST /api/copy-trading/billing/calculate-fees
Body: { month?: 'YYYY-MM', relationship_id?: string }

Returns: Summary of unpaid fees ready for billing
```

### 2. Process Billing
```
POST /api/copy-trading/billing/process-billing
Body: { month?: 'YYYY-MM', dry_run?: boolean }

Returns: Billing results (processed, failed, totals)
```

### 3. Leader Earnings
```
GET /api/copy-trading/leader/earnings
Query: { month?: 'YYYY-MM', all_time?: boolean }

Returns: Earnings summary for authenticated leader
```

---

## Stripe Integration

### Invoice Creation

```typescript
// Create invoice item
const invoiceItem = await stripe.invoiceItems.create({
  customer: followerStripeCustomerId,
  amount: Math.round(totalFee * 100), // Convert to cents
  currency: 'usd',
  description: 'Copy Trading Performance Fee',
  metadata: {
    type: 'copy_trading_fee',
    relationship_ids: '...',
    trade_count: '...'
  }
})

// Create and finalize invoice
const invoice = await stripe.invoices.create({
  customer: followerStripeCustomerId,
  auto_advance: true,
  collection_method: 'charge_automatically'
})

await stripe.invoices.finalizeInvoice(invoice.id)
```

### Requirements

- Follower must have Stripe customer ID in `subscriptions` table
- Stripe secret key configured in environment
- Webhook endpoint for invoice events (optional)

---

## Setting Up Monthly Billing

### Option 1: Cron Job (Recommended)

**Using a cron service (e.g., cron-job.org, GitHub Actions):**

```bash
# Run on 1st of each month at 2 AM UTC
0 2 1 * * curl -X POST https://app.signal-studio.co/api/copy-trading/billing/process-billing \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-12"}'
```

### Option 2: Manual Trigger

**Via API call or admin dashboard:**

```typescript
// Calculate fees first (dry run)
const calc = await $fetch('/api/copy-trading/billing/calculate-fees', {
  method: 'POST',
  body: { month: '2025-12' }
})

// Process billing
const result = await $fetch('/api/copy-trading/billing/process-billing', {
  method: 'POST',
  body: { month: '2025-12', dry_run: false }
})
```

### Option 3: Scheduled Function

**If using serverless (Vercel, Netlify Functions):**

Create a scheduled function that runs monthly:

```typescript
// server/api/copy-trading/billing/scheduled-monthly.ts
export default defineEventHandler(async (event) => {
  // Auto-run billing for previous month
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const month = lastMonth.toISOString().slice(0, 7) // YYYY-MM
  
  // Process billing
  // ... (same as process-billing.ts)
})
```

---

## Leader Payouts

### Current Implementation

Leaders' earnings are calculated and stored, but not automatically paid out. Options:

1. **Manual Payout** (Current)
   - View earnings in dashboard
   - Manual transfer via Stripe or bank transfer

2. **Stripe Connect** (Future)
   - Leaders connect Stripe account
   - Automatic payouts to leader's account
   - Platform takes cut automatically

3. **Internal Wallet** (Future)
   - Store earnings in internal wallet
   - Leaders can withdraw on demand
   - Platform handles payouts

---

## Testing

### Test Fee Calculation

```bash
# Calculate fees for current month
curl -X POST http://localhost:3000/api/copy-trading/billing/calculate-fees \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-12"}'
```

### Test Billing (Dry Run)

```bash
# Dry run - won't charge anyone
curl -X POST http://localhost:3000/api/copy-trading/billing/process-billing \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-12", "dry_run": true}'
```

### Test Leader Earnings

```bash
# Get earnings (requires auth)
curl http://localhost:3000/api/copy-trading/leader/earnings?all_time=true
```

---

## Files Created

### SignalStudio (Backend)
- ✅ `server/api/copy-trading/billing/calculate-fees.ts` - Fee calculation
- ✅ `server/api/copy-trading/billing/process-billing.ts` - Billing processor
- ✅ `server/api/copy-trading/leader/earnings.ts` - Earnings API

### SignalStudio (Frontend)
- ✅ `app/pages/copy-trading/leader/earnings.vue` - Earnings dashboard

---

## Revenue Model

### Fee Structure

- **Leader Override Fee:** 0-30% (leader sets)
- **Platform Cut:** 40% of override fee
- **Leader Gets:** 60% of override fee

### Example Calculation

**Scenario:**
- 10 followers copying a leader
- Each follower makes $100 profit this month
- Leader override: 15%

**Calculation:**
- Total follower profit: $1,000
- Total fees: $1,000 × 15% = $150
- Platform gets: $150 × 40% = $60
- Leader gets: $150 × 60% = $90

**Per Follower:**
- Follower pays: $15
- Platform gets: $6
- Leader gets: $9

---

## Next Steps (Optional Enhancements)

### 1. Stripe Connect for Leader Payouts
- Leaders connect Stripe account
- Automatic payouts
- Platform fee deducted automatically

### 2. Billing Dashboard
- Admin view of all billing
- Manual retry for failed charges
- Billing history

### 3. Email Notifications
- Notify followers when billed
- Notify leaders when credited
- Monthly earnings reports

### 4. Leader Payout Requests
- Leaders request payout
- Admin approval workflow
- Automatic transfers

---

## Summary

Phase 3 adds complete monetization:

1. **Fee Calculation** - Accurate, grouped by relationship
2. **Stripe Billing** - Automated invoice creation
3. **Leader Earnings** - Dashboard for tracking earnings
4. **Payment Tracking** - All fees marked as paid

**All Phase 3 features are production-ready!** 🚀

---

**Phase 3 Complete! Copy trading is now fully monetized and ready for revenue generation.**

