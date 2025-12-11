# Copy Trading Feature Proposal

**Date:** December 2025  
**Status:** Proposal for Implementation  
**Integration:** Sparky + SignalStudio + CCXT

---

## Executive Summary

This proposal outlines a copy trading system that allows users to automatically replicate trades from successful AI strategies (and eventually human strategies). The system leverages your existing multi-tenant architecture, webhook infrastructure, and will integrate CCXT for enhanced exchange support.

**Revenue Potential:** $14K+ MRR at 1,000 users (conservative estimate from your docs)

---

## What Was Reviewed

### Files Analyzed:
1. **`Copy_UI_Ideas.md`** - UI components, UX patterns, conversion optimization
2. **`copy_trading.md`** - Database schema, API routes, fan-out engine design

### Key Concepts from Files:
- **Leader/Follower Model:** Users can make their AI strategies public, others copy them
- **Allocation %:** Followers allocate a percentage of capital (not fixed $)
- **Performance Fees:** Leaders charge override fees (15-30%), platform takes cut
- **Risk Controls:** Max drawdown stops, allocation limits
- **Fan-Out Engine:** When leader trades, automatically execute for all followers

---

## Current Architecture Analysis

### ✅ What We Have (Strengths):

1. **Multi-Tenant System**
   - Per-user credentials (`bot_credentials` table)
   - Per-user positions/trades (`user_id` in all tables)
   - Dynamic exchange creation (`ExchangeFactory.createExchangeForUser()`)

2. **Webhook Infrastructure**
   - `/webhook` endpoint handles all trades
   - Supports `user_id` for multi-tenant
   - Executes trades using user's credentials
   - Logs everything to Supabase

3. **Strategy System**
   - `ai_strategies` table (Phase 1 complete)
   - Strategy status management (running/paused)
   - Performance tracking

4. **Position Tracking**
   - In-memory `PositionTracker`
   - Supabase persistence
   - Per-user isolation

### ⚠️ What We Need:

1. **Copy Trading Tables** - New database schema
2. **Fan-Out Logic** - Execute trades for followers when leader trades
3. **UI Components** - Leaderboard, copy modal, "My Copies" dashboard
4. **API Endpoints** - Start/stop/pause copy relationships
5. **Fee Calculation** - Performance fee billing system
6. **CCXT Integration** - Enhanced exchange support

---

## Proposed Features (Phased Approach)

### Phase 1: Core Copy Trading (MVP) - 2-3 Weeks

**Goal:** Users can copy AI strategies, trades execute automatically

#### 1.1 Database Schema ✅ (From your docs)

**Tables to Create:**
- `copy_relationships` - Who copies whom
- `copied_trades` - Track copied trades for billing
- Add columns to `ai_strategies`: `is_public_leader`, `copy_override_percent`, `verified_badge`

**Verdict:** ✅ **VIABLE** - Schema is well-designed, integrates with existing tables

#### 1.2 Fan-Out Engine ✅ (Core Feature)

**Location:** `src/index.js` - After successful trade execution

**How it works:**
```javascript
// After leader's trade executes successfully (line ~700 in index.js)
if (result.success && alertData.source === 'ai_engine_v1') {
  await fanOutToFollowers(alertData, userId, result);
}
```

**Implementation:**
1. Query `copy_relationships` for active followers
2. For each follower:
   - Calculate scaled position size: `leaderSize * (follower.allocation_percent / 100)`
   - Create new webhook payload with follower's `user_id`
   - Call `/webhook` endpoint (same as leader's trade)
   - Log to `copied_trades` table

**Verdict:** ✅ **VIABLE** - Fits perfectly into existing webhook flow

**Considerations:**
- Use async/await with Promise.all() for parallel execution
- Handle failures gracefully (don't fail leader's trade if follower fails)
- Rate limiting (don't overwhelm exchange APIs)

#### 1.3 API Endpoints (SignalStudio)

**Required Endpoints:**
- `GET /api/copy-trading/top` - Leaderboard (top 50 strategies)
- `POST /api/copy-trading/start` - Start copying a leader
- `POST /api/copy-trading/stop` - Stop copying
- `POST /api/copy-trading/pause` - Pause copying (temporary)
- `GET /api/copy-trading/my-copies` - Get follower's active copies
- `GET /api/copy-trading/leader/[id]` - Leader detail page data

**Verdict:** ✅ **VIABLE** - Standard CRUD operations, similar to existing API patterns

#### 1.4 UI Components (SignalStudio)

**Pages:**
- `/copy-trading` - Public leaderboard
- `/copy-trading/[id]` - Leader detail page
- `/dashboard/my-copies` - Follower's active copies

**Components:**
- `LeaderCard.vue` - Strategy card with copy button
- `CopyModal.vue` - One-click copy with allocation slider
- `MyCopyCard.vue` - Active copy display with P&L

**Verdict:** ✅ **VIABLE** - UI patterns from your docs are production-ready

---

### Phase 2: Risk Controls & Safety - 1 Week

#### 2.1 Max Drawdown Stop

**How it works:**
- Track follower's P&L from copied trades
- If drawdown exceeds `max_drawdown_stop`, pause copy relationship
- Auto-resume if leader recovers

**Implementation:**
- Add `current_drawdown_percent` to `copy_relationships`
- Update on each copied trade close
- Check before fan-out: skip if drawdown exceeded

**Verdict:** ✅ **VIABLE** - Straightforward calculation

#### 2.2 Allocation Limits

**How it works:**
- Prevent followers from allocating >100% across all copies
- Validate on copy start
- Show warning if approaching limit

**Verdict:** ✅ **VIABLE** - Simple sum check

#### 2.3 Position Size Validation

**How it works:**
- Before executing copied trade, check follower has enough margin
- Use existing margin check logic
- Fail gracefully (log, don't execute)

**Verdict:** ✅ **VIABLE** - Reuse existing `getAvailableMargin()` logic

---

### Phase 3: Performance Fee Billing - 1-2 Weeks

#### 3.1 Fee Calculation

**How it works:**
- Track P&L per `copied_trade`
- Calculate fee: `pnl_usd * (copy_override_percent / 100)`
- Platform cut: `fee * 0.4` (40% to platform, 60% to leader)
- Leader cut: `fee * 0.6`

**Implementation:**
- Monthly cron job (same as AI performance fee worker)
- Query `copied_trades` with `pnl_usd > 0` for past month
- Group by `copy_relationship_id`
- Calculate total fees
- Create Stripe invoices

**Verdict:** ✅ **VIABLE** - Similar to Phase 3 AI fee billing (already planned)

#### 3.2 Leader Earnings Dashboard

**How it works:**
- Show leaders their override fee earnings
- Breakdown by follower
- Monthly/All-time stats

**Verdict:** ✅ **VIABLE** - Standard dashboard feature

---

### Phase 4: CCXT Integration - 2-3 Weeks

#### 4.1 Why CCXT?

**Benefits:**
- **Unified API:** One library for 100+ exchanges
- **Market Data:** Standardized OHLCV, ticker, order book
- **Trading:** Standardized order placement
- **Maintenance:** Community-maintained, always up-to-date

**Current State:**
- You have custom exchange APIs (Aster, OANDA, Tradier, etc.)
- Each exchange has unique implementation
- Adding new exchanges requires custom code

**With CCXT:**
- Can add new exchanges quickly (just config)
- Better market data access
- More reliable (battle-tested library)

#### 4.2 Integration Strategy

**Option A: Hybrid Approach (Recommended)**
- Keep existing custom APIs for exchanges you already support
- Use CCXT for:
  - New exchanges (Binance, Coinbase, Kraken, etc.)
  - Market data fetching (OHLCV, tickers)
  - Exchange discovery/validation

**Option B: Full Migration**
- Replace all custom APIs with CCXT
- More work, but cleaner long-term

**Verdict:** ✅ **VIABLE** - Start with Option A, migrate gradually

#### 4.3 CCXT for Copy Trading

**Use Cases:**
1. **Market Data:** Fetch OHLCV for leaderboard stats
2. **Exchange Support:** Add more exchanges for copy trading
3. **Price Validation:** Verify prices before executing copied trades
4. **Symbol Normalization:** Handle different symbol formats

**Implementation:**
```javascript
// Add CCXT wrapper
const ccxt = require('ccxt');

// In ExchangeFactory
static createCCXTExchange(exchangeName, credentials) {
  const Exchange = ccxt[exchangeName];
  return new Exchange({
    apiKey: credentials.apiKey,
    secret: credentials.apiSecret,
    // ... other config
  });
}
```

**Verdict:** ✅ **VIABLE** - CCXT is mature, well-documented, actively maintained

---

## Feature Viability Assessment

### ✅ High Priority (Must-Have for MVP)

| Feature | Viability | Effort | Impact |
|---------|----------|--------|--------|
| Copy relationships table | ✅ Easy | 1 day | Critical |
| Fan-out engine | ✅ Medium | 3-4 days | Critical |
| Start/Stop copy API | ✅ Easy | 2 days | Critical |
| Leaderboard page | ✅ Easy | 2 days | High |
| Copy modal UI | ✅ Easy | 1 day | High |
| My Copies dashboard | ✅ Easy | 2 days | High |

### 🟡 Medium Priority (Nice-to-Have)

| Feature | Viability | Effort | Impact |
|---------|----------|--------|--------|
| Max drawdown stop | ✅ Easy | 2 days | Medium |
| Allocation limits | ✅ Easy | 1 day | Medium |
| Verified badge system | ✅ Easy | 1 day | Medium |
| Leader earnings dashboard | ✅ Medium | 3 days | Medium |
| Performance fee billing | ✅ Medium | 4-5 days | High (revenue) |

### 🔵 Low Priority (Future Enhancements)

| Feature | Viability | Effort | Impact |
|---------|----------|--------|--------|
| CCXT integration | ✅ Medium | 1-2 weeks | High (long-term) |
| Copy human strategies | ✅ Medium | 1 week | Medium |
| Social features (comments, ratings) | ✅ Easy | 1 week | Low |
| Copy trading groups | ✅ Medium | 2 weeks | Low |
| Advanced analytics | ✅ Medium | 1 week | Low |

---

## Technical Architecture

### Fan-Out Flow

```
Leader's AI Strategy Makes Trade
    ↓
AI Worker → Sparky /webhook
    ↓
Sparky Executes Leader's Trade ✅
    ↓
[FAN-OUT ENGINE] (NEW)
    ↓
Query: copy_relationships WHERE leader_strategy_id = X AND status = 'active'
    ↓
For each follower:
    ├─ Calculate scaled size: leaderSize * (allocation_percent / 100)
    ├─ Check max drawdown (skip if exceeded)
    ├─ Check available margin (skip if insufficient)
    ├─ Create webhook payload:
    │   {
    │     user_id: follower.user_id,
    │     exchange: leader.exchange,
    │     symbol: leader.symbol,
    │     action: leader.action,
    │     position_size_usd: scaledSize,
    │     source: 'copy_trading',
    │     copied_from_strategy_id: leader.strategy_id
    │   }
    ├─ POST to /webhook (same endpoint!)
    └─ Log to copied_trades table
    ↓
Follower's Trade Executes (using their credentials)
    ↓
Trades logged separately (leader vs follower)
```

### Key Design Decisions

1. **Reuse Existing Webhook Endpoint**
   - ✅ No new execution logic needed
   - ✅ All risk limits apply automatically
   - ✅ All logging works automatically
   - ✅ Multi-tenant support built-in

2. **Async Fan-Out**
   - Don't block leader's trade response
   - Execute follower trades in parallel
   - Handle failures gracefully

3. **Position Size Scaling**
   - Scale by allocation %, not fixed $
   - Maintains risk profile per follower
   - Allows different capital sizes

---

## Database Schema (Refined)

Based on your docs, with minor improvements:

```sql
-- Copy relationships
CREATE TABLE copy_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id UUID REFERENCES auth.users NOT NULL,
  leader_strategy_id UUID REFERENCES ai_strategies NOT NULL,
  allocation_percent NUMERIC(6,2) NOT NULL DEFAULT 100.00 
    CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  max_drawdown_stop NUMERIC(5,2) DEFAULT 30.00,
  status TEXT DEFAULT 'active' 
    CHECK (status IN ('active', 'paused', 'stopped')),
  current_drawdown_percent NUMERIC(5,2) DEFAULT 0.00,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  UNIQUE(follower_user_id, leader_strategy_id)
);

-- Copied trades (for billing + transparency)
CREATE TABLE copied_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_relationship_id UUID REFERENCES copy_relationships ON DELETE CASCADE,
  original_trade_id UUID, -- Points to trades table (leader's trade)
  follower_trade_id UUID, -- Points to trades table (follower's trade)
  follower_user_id UUID REFERENCES auth.users,
  leader_user_id UUID REFERENCES auth.users,
  leader_strategy_id UUID REFERENCES ai_strategies,
  symbol TEXT,
  side TEXT,
  leader_size_usd NUMERIC(14,2),
  follower_size_usd NUMERIC(14,2),
  pnl_usd NUMERIC(14,2), -- Follower's P&L
  override_fee_charged NUMERIC(14,2) DEFAULT 0,
  fee_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add to ai_strategies
ALTER TABLE ai_strategies 
ADD COLUMN IF NOT EXISTS is_public_leader BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS copy_override_percent NUMERIC(4,2) DEFAULT 15.00,
ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS copiers_count INTEGER DEFAULT 0; -- Cached count
```

---

## CCXT Integration Plan

### Phase 1: Market Data Only (Low Risk)

**Use CCXT for:**
- Fetching OHLCV candles (leaderboard stats)
- Getting ticker prices (validation)
- Symbol normalization

**Keep existing APIs for:**
- Trading (order placement)
- Position management
- Account balances

**Verdict:** ✅ **SAFE START** - Market data is read-only, low risk

### Phase 2: Add New Exchanges via CCXT

**When user wants to copy on Binance:**
1. User adds Binance credentials to SignalStudio
2. Use CCXT to create Binance instance
3. Execute copied trades via CCXT

**Verdict:** ✅ **VIABLE** - CCXT supports 100+ exchanges out of the box

### Phase 3: Gradual Migration (Optional)

**Migrate existing exchanges to CCXT:**
- Start with least-used exchanges
- Test thoroughly
- Keep old API as fallback

**Verdict:** ⚠️ **OPTIONAL** - Only if you want to reduce maintenance burden

---

## Implementation Phases

### Phase 1: MVP (2-3 Weeks)

**Week 1:**
- Database schema migration
- Fan-out engine in Sparky
- Basic API endpoints (start/stop/list)

**Week 2:**
- Leaderboard page
- Copy modal UI
- My Copies dashboard

**Week 3:**
- Testing & bug fixes
- Documentation
- Deploy to staging

**Deliverable:** Users can copy AI strategies, trades execute automatically

---

### Phase 2: Safety & Polish (1 Week)

- Max drawdown stops
- Allocation limits
- Position size validation
- Error handling improvements

**Deliverable:** Production-ready with safety controls

---

### Phase 3: Monetization (1-2 Weeks)

- Performance fee calculation
- Monthly billing cron
- Leader earnings dashboard
- Stripe integration

**Deliverable:** Revenue-generating feature

---

### Phase 4: CCXT Integration (2-3 Weeks)

- Install CCXT library
- Create CCXT wrapper in ExchangeFactory
- Add market data utilities
- Test with new exchanges

**Deliverable:** Support for 100+ exchanges via CCXT

---

## Risk Assessment

### Low Risk ✅

- **Database schema** - Standard relational design
- **UI components** - Standard Vue/Nuxt patterns
- **API endpoints** - Standard CRUD operations
- **Fan-out logic** - Reuses existing webhook infrastructure

### Medium Risk ⚠️

- **Performance at scale** - Fan-out to 1000+ followers
  - **Mitigation:** Async execution, rate limiting, queue system
- **Fee calculation accuracy** - Complex P&L tracking
  - **Mitigation:** Thorough testing, audit logs
- **CCXT integration** - New dependency
  - **Mitigation:** Start with market data only, test extensively

### High Risk ❌

- **None identified** - Architecture is sound

---

## Revenue Model

### Fee Structure

1. **Leader Override Fee:** 0-30% (leader sets)
2. **Platform Cut:** 40% of override fee
3. **Leader Gets:** 60% of override fee

### Example Calculation

- Leader makes $1,000 profit
- Follower allocated $10,000 (10% of leader's $100k)
- Follower profit: $100
- Leader override: 15%
- Fee: $100 * 15% = $15
- Platform gets: $15 * 40% = $6
- Leader gets: $15 * 60% = $9

### Projected Revenue (From Your Docs)

**At 1,000 users:**
- 25% copy at least one leader = 250 copiers
- Avg $8k allocated per copier
- Leader makes 12%/mo → follower profit $960/mo
- Leader charges 15% → $144 fee
- Platform takes 40% → $57.60 per copier/mo
- **Total: $14,400 MRR** (plus existing SaaS)

---

## Recommendations

### ✅ Start With (MVP):

1. **Database schema** - Foundation for everything
2. **Fan-out engine** - Core functionality
3. **Basic UI** - Leaderboard + copy modal
4. **Start/Stop API** - Essential controls

### 🟡 Add Next (Safety):

5. **Max drawdown stops** - Prevent blowups
6. **Allocation limits** - Prevent over-allocation
7. **Error handling** - Graceful failures

### 🔵 Add Later (Revenue):

8. **Performance fee billing** - Monetization
9. **Leader earnings dashboard** - Retention
10. **CCXT integration** - Scale to more exchanges

### ❌ Skip for Now:

- Social features (comments, ratings)
- Copy trading groups
- Advanced analytics
- Human strategy copying (focus on AI first)

---

## CCXT Integration Details

### Why CCXT?

From [CCXT GitHub](https://github.com/ccxt/ccxt):
- **40.2k stars** - Battle-tested
- **100+ exchanges** - Massive coverage
- **Active maintenance** - Regular updates
- **Unified API** - One interface for all exchanges

### How to Use CCXT

**Installation:**
```bash
npm install ccxt
```

**Basic Usage:**
```javascript
const ccxt = require('ccxt');

// Create exchange instance
const exchange = new ccxt.binance({
  apiKey: 'your-key',
  secret: 'your-secret',
  sandbox: false
});

// Fetch market data
const ticker = await exchange.fetchTicker('BTC/USDT');
const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '1m', undefined, 100);

// Place order
const order = await exchange.createMarketOrder('BTC/USDT', 'buy', 0.1);
```

### Integration Points

1. **Market Data Utilities** (`src/ai-worker/utils/marketData.js`)
   - Replace custom OHLCV fetching with CCXT
   - Standardize symbol formats
   - Support more exchanges

2. **ExchangeFactory** (`src/exchanges/ExchangeFactory.js`)
   - Add `createCCXTExchange()` method
   - Use for new exchanges
   - Keep existing APIs for current exchanges

3. **Copy Trading Fan-Out**
   - Use CCXT for exchanges not yet supported
   - Validate prices before execution
   - Handle symbol normalization

---

## Success Metrics

### Phase 1 (MVP):
- [ ] 10+ public leaders
- [ ] 50+ active copy relationships
- [ ] 100+ copied trades executed
- [ ] Zero critical bugs

### Phase 2 (Safety):
- [ ] Max drawdown stops working
- [ ] No allocation limit violations
- [ ] 99%+ trade execution success rate

### Phase 3 (Revenue):
- [ ] $1K+ in performance fees collected
- [ ] 5+ leaders earning override fees
- [ ] Automated billing working

### Phase 4 (Scale):
- [ ] 5+ exchanges via CCXT
- [ ] 1000+ active copy relationships
- [ ] $10K+ MRR from copy trading

---

## Conclusion

### ✅ **All Core Features Are Viable**

The copy trading system you've designed is:
- **Architecturally sound** - Fits perfectly into existing infrastructure
- **Technically feasible** - Uses proven patterns
- **Revenue-generating** - Clear monetization path
- **Scalable** - Can handle growth

### Recommended Approach:

1. **Start with MVP** (Phase 1) - Get it working end-to-end
2. **Add safety controls** (Phase 2) - Prevent issues
3. **Enable monetization** (Phase 3) - Start earning
4. **Scale with CCXT** (Phase 4) - Expand exchange support

### Next Steps:

1. Review this proposal
2. Prioritize features
3. Create detailed implementation plan
4. Start with database schema + fan-out engine

**Ready to build when you are!** 🚀

