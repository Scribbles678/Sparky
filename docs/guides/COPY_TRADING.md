# Copy Trading Guide

Copy Trading allows followers to automatically replicate trades from leader strategies. When a leader executes a trade, all active followers receive a scaled version of that trade based on their allocation percentage.

## Overview

```
Leader Trade Executes
    ↓
Sparky detects source='ai_engine_v1'
    ↓
Fan-out engine finds active followers
    ↓
For each follower:
  - Scale position size by allocation %
  - Execute trade with follower's credentials
  - Log to copied_trades table
    ↓
Follower's trade executes (same pipeline)
```

## How It Works

### 1. Leader Trade Execution

When a leader's AI strategy generates a signal:
- Trade executes normally through Sparky's webhook handler
- Trade is tagged with `source: 'ai_engine_v1'` and `strategy_id`
- After successful execution, copy trading fan-out is triggered

### 2. Fan-Out Process

**File:** `src/utils/copyTrading.js`

The fan-out engine:
1. Finds all active `copy_relationships` for the leader's strategy
2. Validates each follower (status, allocation, max drawdown)
3. Scales position size: `followerSize = leaderSize × (allocationPercent / 100)`
4. Executes trade for each follower using their credentials
5. Logs to `copied_trades` table for billing and tracking

### 3. Position Scaling

Position sizes are automatically scaled based on follower's allocation:

```javascript
// Leader trades $1000 position
// Follower has 50% allocation
// Follower receives $500 position
const scaledSize = 1000 * (50 / 100) = 500
```

### 4. Trade Execution

Follower trades execute through the same webhook pipeline:
- Uses follower's exchange credentials
- Respects follower's risk limits
- Subject to follower's webhook limits
- Logs to follower's positions/trades tables

## Database Schema

### copy_relationships

Stores follower-leader relationships:

```sql
CREATE TABLE copy_relationships (
  id UUID PRIMARY KEY,
  follower_user_id UUID REFERENCES auth.users,
  leader_strategy_id UUID REFERENCES ai_strategies,
  allocation_percent NUMERIC(6,2) DEFAULT 100.00,  -- % of leader's size
  max_drawdown_stop NUMERIC(5,2) DEFAULT 30.00,      -- Pause if leader down >30%
  status TEXT DEFAULT 'active',                     -- active, paused, stopped
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
```

### copied_trades

Tracks all copied trades for billing:

```sql
CREATE TABLE copied_trades (
  id UUID PRIMARY KEY,
  copy_relationship_id UUID REFERENCES copy_relationships,
  follower_user_id UUID REFERENCES auth.users,
  leader_user_id UUID REFERENCES auth.users,
  leader_strategy_id UUID REFERENCES ai_strategies,
  symbol TEXT,
  side TEXT,
  leader_size_usd NUMERIC(14,2),
  follower_size_usd NUMERIC(14,2),
  follower_trade_id UUID,                          -- Links to trades table
  pnl_usd NUMERIC(14,2),                           -- Updated when trade closes
  override_fee_charged NUMERIC(14,2) DEFAULT 0,    -- Leader's fee
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Configuration

### Leader Settings

Leaders configure copy trading settings in their AI strategy:

```sql
-- In ai_strategies table
copy_override_percent NUMERIC(4,2) DEFAULT 15.00,  -- % fee on profits
is_public_leader BOOLEAN DEFAULT false,            -- Show on leaderboard
verified_badge BOOLEAN DEFAULT false                -- Verified status
```

### Follower Settings

Followers configure their copy relationship:

- **Allocation Percent**: % of leader's position size (1-100%)
- **Max Drawdown Stop**: Auto-pause if leader's drawdown exceeds threshold
- **Status**: active, paused, stopped

## Usage

### Starting a Copy Relationship

Via SignalStudio UI:
1. Browse leaderboard at `/copy-trading`
2. Click "Copy" on a leader
3. Set allocation percentage
4. Confirm copy relationship

Via API:
```javascript
POST /api/copy-trading/start
{
  "leader_strategy_id": "uuid",
  "allocation_percent": 50.00
}
```

### Stopping a Copy Relationship

Via SignalStudio UI:
1. Go to "My Copy Trading"
2. Click "Stop" on active relationship

Via API:
```javascript
POST /api/copy-trading/stop
{
  "copy_relationship_id": "uuid"
}
```

## Risk Controls

### Max Drawdown Protection

If leader's drawdown exceeds follower's `max_drawdown_stop` threshold:
- Copy relationship is automatically paused
- No new trades are copied until leader recovers
- Follower receives notification

### Allocation Limits

- Minimum: 1%
- Maximum: 100%
- Can be adjusted anytime (affects future trades only)

### Status Management

- **active**: Copying trades normally
- **paused**: Temporarily stopped (auto-paused on drawdown or manual)
- **stopped**: Permanently ended

## Billing & Fees

### Override Fee Structure

When a follower's copied trade closes with profit:
1. Calculate fee: `profit × (leader_override_percent / 100)`
2. Platform takes 40% of fee
3. Leader receives 60% of fee

Example:
- Follower profit: $100
- Leader override: 15%
- Fee: $15
- Platform: $6 (40%)
- Leader: $9 (60%)

### Fee Collection

Fees are calculated when trades close and logged in `copied_trades.override_fee_charged`. Monthly billing worker processes fees.

## Monitoring

### Leader Dashboard

Leaders can view:
- Total followers
- Total allocation (sum of all follower allocations)
- Monthly override revenue
- Copy trading performance metrics

### Follower Dashboard

Followers can view:
- Active copy relationships
- Copied trades history
- P&L from copied trades
- Fees paid to leaders

## Troubleshooting

### Trades Not Copying

1. **Check relationship status**: Must be `'active'`
2. **Check leader's strategy**: Must be `'running'` and generating signals
3. **Check follower's credentials**: Must have exchange API keys configured
4. **Check follower's limits**: Risk limits and webhook limits must not be exceeded
5. **Check logs**: Look for fan-out errors in Sparky logs

### Position Size Mismatch

- Verify `allocation_percent` in `copy_relationships`
- Check leader's original position size
- Formula: `followerSize = leaderSize × (allocation / 100)`

### Drawdown Protection Not Working

- Verify `max_drawdown_stop` is set correctly
- Check leader's current drawdown in dashboard
- Drawdown is calculated from strategy's peak equity

## Best Practices

### For Leaders

1. **Set realistic override fees**: 10-20% is standard
2. **Maintain consistent performance**: Followers expect reliability
3. **Communicate strategy changes**: Update followers on major changes
4. **Monitor follower feedback**: Respond to concerns promptly

### For Followers

1. **Start with small allocation**: Test with 10-25% first
2. **Diversify across leaders**: Don't put all allocation in one strategy
3. **Set drawdown protection**: Use 20-30% max drawdown stop
4. **Monitor regularly**: Check performance weekly
5. **Understand fees**: Factor override fees into expected returns

## API Reference

### Fan-Out Function

```javascript
const { fanOutToFollowers } = require('./utils/copyTrading');

await fanOutToFollowers({
  userId: leaderUserId,
  strategyId: strategyId,
  exchange: 'aster',
  symbol: 'BTCUSDT',
  action: 'BUY',
  positionSizeUsd: 1000,
  result: { success: true, ... },
  originalTradeId: tradeId
});
```

### Update P&L

```javascript
const { updateCopiedTradePnl } = require('./utils/copyTrading');

await updateCopiedTradePnl(followerTradeId, {
  pnl_usd: 50.00,
  pnl_percent: 5.0,
  is_winner: true,
  exit_time: '2025-01-01T12:00:00Z'
});
```

---

**Version:** 1.0  
**Last Updated:** December 2025

