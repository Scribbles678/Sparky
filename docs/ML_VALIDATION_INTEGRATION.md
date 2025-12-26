# Sparky Bot: ML Pre-Trade Validation Integration Guide

**Version:** 1.1  
**Date:** January 2025  
**Status:** ✅ **IMPLEMENTED** - Production Ready

---

## 📋 Overview

This document describes the ML Pre-Trade Validation feature in Sparky Bot. **This feature is fully implemented and production-ready.** When enabled on a manual strategy, every incoming TradingView webhook is validated by Arthur ML service before execution.

**Implementation Status:**
- ✅ ML validation function implemented in `src/tradeExecutor.js`
- ✅ Integration with webhook handler complete
- ✅ Market context fetching implemented
- ✅ Validation logging to Supabase
- ✅ Notification system for blocked trades
- ✅ Fail-open error handling (trades allowed if ML service unavailable)

---

## 🎯 Integration Points

### 1. **Webhook Handler** (`src/tradeExecutor.js`)
- Add ML validation check after standard validation
- Call Arthur ML service for confidence score
- Block or allow trade based on threshold
- Log validation result to Supabase

### 2. **Notification Service** (`src/utils/notifications.js`)
- Add notification for blocked trades
- Add notification for validation errors

### 3. **Settings Service** (`src/settings/settingsService.js`)
- No changes needed (already loads `ml_assistance_enabled` and `ml_config`)

---

## 🔧 Implementation Details

### Implementation Location

**File:** `src/tradeExecutor.js`

The ML validation is implemented in the `TradeExecutor` class:

### 1. ML Validation Function

**Location:** `src/tradeExecutor.js` → `validateWithML()` method (lines 101-165)

**Current Implementation:**

The function is implemented as a method in the `TradeExecutor` class. It:
- Calls Arthur ML service at `/validate-strategy-signal` endpoint
- Uses a 5-second timeout for fast fail-over
- Implements fail-open behavior (allows trades if ML service is unavailable)
- Returns validation result with confidence score and reasons

**Key Features:**
- ✅ Automatic fail-open on ML service errors
- ✅ Configurable confidence threshold (default: 70%)
- ✅ Detailed logging for debugging
- ✅ Returns comprehensive validation result object

---

### 2. Webhook Handler Integration

**Location:** `src/tradeExecutor.js` → `executeWebhook()` method (lines 215-329)

**Current Implementation:**

ML validation is integrated into the webhook execution flow:

1. **Trigger Condition:** Only runs for SignalStudio orders with `strategy_id` and `ml_assistance_enabled = true`
2. **Validation Flow:**
   - Loads strategy from Supabase
   - Fetches current market context (price, volume)
   - Calls ML validation service
   - Logs validation attempt
   - Blocks trade if confidence < threshold
   - Sends notification if blocked
3. **Error Handling:** Fail-open behavior ensures trades proceed if ML service fails

**Key Implementation Details:**
- ✅ Only validates manual strategies (not AI strategies)
- ✅ Requires `strategy_id` in webhook payload
- ✅ Checks `ml_assistance_enabled` flag on strategy
- ✅ Blocks trades with low confidence scores
- ✅ Sends user notifications for blocked trades

---

### 3. Market Context Helper

**Location:** `src/tradeExecutor.js` → `getMarketContext()` method (lines 71-92)

**Current Implementation:**
- Fetches current ticker data from exchange API
- Returns price, volume, and timestamp
- Handles errors gracefully (returns null values if fetch fails)

**Future Enhancements:**
- Add volatility metrics
- Add support/resistance levels
- Add order book depth

---

### 4. Validation Logging

**Location:** `src/tradeExecutor.js` → `logValidationAttempt()` method (lines 167-208)

**Current Implementation:**
- Logs all validation attempts to Supabase `strategy_validation_log` table
- Records confidence scores, thresholds, and decision reasons
- Non-blocking (doesn't fail trades if logging fails)
- Includes market context and feature scores for analysis

**Database Table:** `strategy_validation_log`
- Stores validation history for analytics
- Enables ML model improvement over time
- Tracks false positives/negatives

---

### 5. Notification System

**Location:** `src/utils/notifications.js` → `notifyTradeBlocked()` function

**Current Implementation:**
- ✅ Sends notification when trade is blocked by ML validation
- ✅ Respects user notification preferences
- ✅ Includes confidence score, threshold, and reasons
- ✅ Creates notification in Supabase `notifications` table
- ✅ Non-blocking (doesn't affect trade execution)

**Notification Content:**
- Strategy name
- Symbol and action
- ML confidence score vs threshold
- Decision reasons (if provided)

---

### 6. Environment Variables

**File:** `.env`

**Required:**
```env
# Arthur ML Service (for ML validation)
ARTHUR_ML_URL=http://localhost:8001
```

**Note:** If `ARTHUR_ML_URL` is not set, defaults to `http://localhost:8001`

---

### 7. Dependencies

**File:** `package.json`

✅ `node-fetch@2` is already included in dependencies (line 30)

No additional packages required.

---

## 🧪 Testing

### Unit Test: ML Validation Function

**File:** `tests/mlValidation.test.js`

```javascript
const { validateWithML } = require('../src/tradeExecutor');

describe('ML Pre-Trade Validation', () => {
  test('should allow high-confidence signal', async () => {
    const strategy = {
      id: 'test-strategy-id',
      user_id: 'test-user-id',
      name: 'Test Strategy',
      ml_assistance_enabled: true,
      ml_config: { confidence_threshold: 70 }
    };
    
    const alertData = {
      symbol: 'BTC/USDT',
      action: 'BUY'
    };
    
    const marketContext = {
      current_price: 50000,
      volume: 1000000
    };
    
    // Mock Arthur ML response with high confidence
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          confidence: 85,
          reasons: ['High volume', 'Strong support'],
          market_context: {},
          feature_scores: {}
        })
      })
    );
    
    const result = await validateWithML(strategy, alertData, marketContext);
    
    expect(result.allowed).toBe(true);
    expect(result.confidence).toBe(85);
  });
  
  test('should block low-confidence signal', async () => {
    const strategy = {
      id: 'test-strategy-id',
      user_id: 'test-user-id',
      name: 'Test Strategy',
      ml_assistance_enabled: true,
      ml_config: { confidence_threshold: 70 }
    };
    
    const alertData = {
      symbol: 'BTC/USDT',
      action: 'BUY'
    };
    
    const marketContext = {
      current_price: 50000,
      volume: 1000000
    };
    
    // Mock Arthur ML response with low confidence
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          confidence: 45,
          reasons: ['Low volume', 'Weak support'],
          market_context: {},
          feature_scores: {}
        })
      })
    );
    
    const result = await validateWithML(strategy, alertData, marketContext);
    
    expect(result.allowed).toBe(false);
    expect(result.confidence).toBe(45);
  });
  
  test('should fail open if ML service is down', async () => {
    const strategy = {
      id: 'test-strategy-id',
      user_id: 'test-user-id',
      name: 'Test Strategy',
      ml_assistance_enabled: true,
      ml_config: { confidence_threshold: 70 }
    };
    
    const alertData = {
      symbol: 'BTC/USDT',
      action: 'BUY'
    };
    
    const marketContext = {
      current_price: 50000,
      volume: 1000000
    };
    
    // Mock ML service error
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('Connection refused'))
    );
    
    const result = await validateWithML(strategy, alertData, marketContext);
    
    expect(result.allowed).toBe(true);  // Fail open
    expect(result.error).toBe(true);
  });
});
```

---

## 📊 Monitoring & Logging

### Key Metrics to Track

1. **ML Validation Requests**
   - Total validations per hour/day
   - Success rate (ML service responded)
   - Error rate (ML service failed)

2. **Block Rate**
   - % of signals blocked by ML
   - Block rate by strategy
   - Block rate by symbol/exchange

3. **Performance Impact**
   - Average ML validation latency
   - Trade execution delay (before/after ML)

4. **ML Service Health**
   - Arthur ML uptime
   - Response time p50/p95/p99
   - Error rate

### Log Examples

**Successful validation (allowed):**
```
[ML VALIDATION] Strategy: BTC Momentum has ML validation enabled
[ML VALIDATION] Checking signal for strategy BTC Momentum...
[ML VALIDATION] Strategy: BTC Momentum
[ML VALIDATION] Confidence: 82%
[ML VALIDATION] Threshold: 70%
[ML VALIDATION] Decision: ALLOW
[ML ALLOW] Trade allowed by ML validation (confidence 82% >= 70%)
```

**Successful validation (blocked):**
```
[ML VALIDATION] Strategy: BTC Momentum has ML validation enabled
[ML VALIDATION] Checking signal for strategy BTC Momentum...
[ML VALIDATION] Strategy: BTC Momentum
[ML VALIDATION] Confidence: 48%
[ML VALIDATION] Threshold: 70%
[ML VALIDATION] Decision: BLOCK
[ML BLOCK] Trade blocked by ML validation
[ML BLOCK] Confidence: 48% < 70%
[ML BLOCK] Reasons: low_volume, weak_support, overbought_rsi
```

**ML service error (fail open):**
```
[ML VALIDATION] Strategy: BTC Momentum has ML validation enabled
[ML VALIDATION] Checking signal for strategy BTC Momentum...
[ML VALIDATION ERROR] Error calling Arthur ML service: Error: connect ECONNREFUSED 127.0.0.1:8001
[ML VALIDATION] ML service error, allowing trade by default
```

---

## 🚨 Error Handling

### Fail-Open Philosophy

**Critical:** The ML validation should ALWAYS fail open. This means:
- If Arthur ML service is down → Allow trade
- If ML returns an error → Allow trade
- If ML times out (>5s) → Allow trade

**Rationale:**  
We never want ML validation to prevent a user from trading. ML is an enhancement, not a blocker. If it fails, default to allowing the trade (the user's original intent).

### Error Scenarios

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| ML service down | Allow trade + log warning | Trade executes normally |
| ML timeout (>5s) | Allow trade + log warning | Slight delay, then executes |
| Invalid ML response | Allow trade + log error | Trade executes normally |
| Supabase logging fails | Allow/block + log error locally | No impact on validation |

---

## 📋 Production Checklist

**Current Status:** ✅ Feature is deployed and operational

**Verification Steps:**

1. ✅ **Arthur ML Service:** Running on same VPS at `localhost:8001`
2. ✅ **Environment Variable:** `ARTHUR_ML_URL` configured in `.env`
3. ✅ **Database Table:** `strategy_validation_log` table exists in Supabase
4. ✅ **RLS Policies:** Row-level security enabled for validation log
5. ✅ **Integration:** ML validation integrated into webhook handler
6. ✅ **Notifications:** Blocked trade notifications working
7. ✅ **Error Handling:** Fail-open behavior tested and working
8. ✅ **Logging:** Validation attempts logged to database

**To Enable ML Validation on a Strategy:**

1. In SignalStudio, edit your strategy
2. Enable "ML Assistance" toggle
3. Set confidence threshold (default: 70%)
4. Save strategy
5. Future webhooks for this strategy will be validated by ML

---

## 🔄 Future Enhancements

### Phase 2 (Optional)
- Add more market context (volatility, support/resistance, order book)
- Cache ML models in Sparky for faster predictions
- Add ML validation bypass for "emergency" trades
- Track and display ML accuracy over time
- A/B test different confidence thresholds

### Phase 3 (Optional)
- Real-time ML model updates (WebSocket from Arthur)
- Per-symbol ML models
- Multi-model ensemble predictions
- User-defined ML features

---

**Document Owner:** Sparky Bot Team  
**Last Updated:** December 2024  
**Status:** Implementation Ready

---

**END OF SPARKY INTEGRATION GUIDE**

