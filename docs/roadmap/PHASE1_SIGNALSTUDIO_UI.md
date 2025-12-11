# Phase 1: SignalStudio UI Components for AI Strategies

**Goal:** Add UI in SignalStudio for users to create, manage, and monitor AI trading strategies

## What Needs to Be Built

### 1. New Page: AI Strategies (`/ai-strategies`)
- List all AI strategies
- Create new AI strategy
- Edit existing strategy
- Start/stop/pause strategies
- View strategy performance

### 2. Server API Endpoints (`/api/ai-strategies`)
- `GET /api/ai-strategies` - List user's AI strategies
- `POST /api/ai-strategies` - Create new AI strategy
- `PATCH /api/ai-strategies?id=...` - Update strategy
- `DELETE /api/ai-strategies?id=...` - Delete strategy

### 3. Components
- `AIStrategyCard.vue` - Display strategy with status, performance
- `AIStrategyModal.vue` - Create/edit form
- `AIStrategyDetail.vue` - Detailed view with trade log

### 4. Menu Integration
- Add "AI Strategies" to sidebar navigation

---

## Implementation Plan

### Step 1: Server API (`server/api/ai-strategies/index.ts`)

**File:** `C:\Users\mjjoh\SignalStudio\signal\server\api\ai-strategies\index.ts`

This will handle CRUD operations for AI strategies, similar to the existing `/api/strategies` endpoint.

### Step 2: AI Strategies Page (`app/pages/ai-strategies.vue`)

**File:** `C:\Users\mjjoh\SignalStudio\signal\app\pages\ai-strategies.vue`

Main page showing:
- List of AI strategies
- Create button
- Strategy cards with status badges
- Quick actions (start/stop/pause)

### Step 3: Strategy Detail Page (`app/pages/ai-strategies/[id].vue`)

**File:** `C:\Users\mjjoh\SignalStudio\signal\app\pages\ai-strategies\[id].vue`

Detailed view showing:
- Strategy configuration
- Live performance metrics
- Trade log (from `ai_trade_log` table)
- Confidence scores over time
- Equity curve chart

### Step 4: Menu Integration

Add to `app/composables/useMenuItems.ts`:
- New menu item "AI Strategies" under Trading section

---

## UI Mockup

### AI Strategies List Page

```
┌─────────────────────────────────────────────────┐
│ AI Strategies                    [+ New AI]    │
├─────────────────────────────────────────────────┤
│                                                 │
│ ┌───────────────────────────────────────────┐ │
│ │ 🟢 Balanced Strategy          [Running]    │ │
│ │ BTCUSDT, ETHUSDT                          │ │
│ │ P&L: +$245.50 | Win Rate: 68%            │ │
│ │ [Pause] [Edit] [View Details]             │ │
│ └───────────────────────────────────────────┘ │
│                                                 │
│ ┌───────────────────────────────────────────┐ │
│ │ ⏸️ Aggressive Strategy        [Paused]    │ │
│ │ SOLUSDT                                   │ │
│ │ P&L: -$12.30 | Win Rate: 45%            │ │
│ │ [Start] [Edit] [View Details]            │ │
│ └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Create/Edit Modal

```
┌─────────────────────────────────────────────┐
│ Create AI Strategy                    [X]   │
├─────────────────────────────────────────────┤
│ Strategy Name: [________________]           │
│                                             │
│ Risk Profile:                               │
│ ○ Conservative  ○ Balanced  ● Aggressive   │
│                                             │
│ Target Assets:                              │
│ [BTCUSDT] [ETHUSDT] [SOLUSDT] [+ Add]      │
│                                             │
│ Max Drawdown: [20]%                         │
│ Max Leverage: [10]x                         │
│                                             │
│ Performance Fee: [20]%                      │
│                                             │
│ [Cancel] [Create Strategy]                  │
└─────────────────────────────────────────────┘
```

---

## Key Features

### Strategy Configuration
- **Name** - User-friendly name
- **Risk Profile** - Conservative/Balanced/Aggressive
- **Target Assets** - Multi-select (BTCUSDT, ETHUSDT, etc.)
- **Max Drawdown** - Percentage (default 20%)
- **Max Leverage** - Integer (default 10x)
- **Performance Fee** - Percentage (default 20%)

### Strategy Status
- **Running** - AI is actively making decisions
- **Paused** - Temporarily stopped
- **Terminated** - Permanently stopped

### Monitoring
- **Live P&L** - Real-time profit/loss
- **Win Rate** - Percentage of winning trades
- **Confidence Scores** - Average confidence over time
- **Trade Log** - All AI decisions with outcomes

---

## Database Integration

The UI will read/write to:
- `ai_strategies` table - Strategy configuration
- `ai_trade_log` table - Decision history
- `trades` table - Completed trades (for P&L)
- `positions` table - Open positions (for unrealized P&L)

---

## Next Steps

1. Create server API endpoint
2. Create main AI strategies page
3. Create strategy detail page
4. Add menu item
5. Test end-to-end flow

