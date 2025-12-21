# Sparky Bot: ML Pre-Trade Validation Integration Guide

**Version:** 1.0  
**Date:** December 2024  
**Status:** Implementation Ready

---

## 📋 Overview

This document provides complete implementation instructions for integrating ML Pre-Trade Validation into Sparky Bot. When enabled on a manual strategy, every incoming TradingView webhook will be validated by Arthur ML service before execution.

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

## 🔧 Implementation Steps

### Step 1: Add ML Validation Function

**File:** `src/tradeExecutor.js`

Add this function after the existing validation functions:

```javascript
/**
 * Validate trade signal using ML Pre-Trade Validation
 * 
 * @param {Object} strategy - Strategy object from Supabase
 * @param {Object} alertData - Webhook alert data
 * @param {Object} marketContext - Current market conditions
 * @returns {Object} { allowed: boolean, confidence: number, reasons: string[] }
 */
async function validateWithML(strategy, alertData, marketContext) {
  const ARTHUR_ML_URL = process.env.ARTHUR_ML_URL || 'http://localhost:8001';
  
  try {
    console.log(`[ML VALIDATION] Checking signal for strategy ${strategy.name}...`);
    
    const response = await fetch(`${ARTHUR_ML_URL}/validate-strategy-signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategy_id: strategy.id,
        user_id: strategy.user_id,
        symbol: alertData.symbol,
        action: alertData.action,
        price: marketContext.current_price,
        timestamp: new Date().toISOString(),
      }),
      timeout: 5000, // 5 second timeout
    });

    if (!response.ok) {
      console.error(`[ML VALIDATION] Arthur ML service error: ${response.status}`);
      // Fail open: allow trade if ML service is down
      return {
        allowed: true,
        confidence: null,
        reasons: ['ML service unavailable - trade allowed by default'],
        error: true
      };
    }

    const result = await response.json();
    
    const threshold = strategy.ml_config?.confidence_threshold || 70;
    const allowed = result.confidence >= threshold;
    
    console.log(`[ML VALIDATION] Strategy: ${strategy.name}`);
    console.log(`[ML VALIDATION] Confidence: ${result.confidence}%`);
    console.log(`[ML VALIDATION] Threshold: ${threshold}%`);
    console.log(`[ML VALIDATION] Decision: ${allowed ? 'ALLOW' : 'BLOCK'}`);
    
    return {
      allowed,
      confidence: result.confidence,
      threshold,
      reasons: result.reasons || [],
      market_context: result.market_context || {},
      feature_scores: result.feature_scores || {},
      error: false
    };
    
  } catch (error) {
    console.error('[ML VALIDATION] Error calling Arthur ML service:', error);
    
    // Fail open: allow trade if ML validation fails
    return {
      allowed: true,
      confidence: null,
      reasons: ['ML validation error - trade allowed by default'],
      error: true
    };
  }
}
```

---

### Step 2: Integrate ML Validation into Webhook Handler

**File:** `src/tradeExecutor.js`

Find the `executeWebhook` function and add ML validation after existing checks:

```javascript
async function executeWebhook(req, res) {
  const alertData = req.body;
  
  try {
    // 1. Existing validation (secret, user, limits)
    // ... existing code ...
    
    // 2. Load strategy details
    const { data: strategy, error: strategyError } = await supabase
      .from('strategies')
      .select('*')
      .eq('id', alertData.strategy_id)
      .eq('user_id', alertData.user_id)
      .single();
    
    if (strategyError || !strategy) {
      console.error(`Strategy ${alertData.strategy_id} not found`);
      return res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
    }
    
    // 3. Check if ML validation is enabled
    if (strategy.ml_assistance_enabled) {
      console.log(`[ML VALIDATION] Strategy ${strategy.name} has ML validation enabled`);
      
      // Get current market context
      const marketContext = await getMarketContext(alertData.symbol, alertData.exchange);
      
      // Validate with ML
      const validationResult = await validateWithML(strategy, alertData, marketContext);
      
      // Log validation attempt to Supabase
      await logValidationAttempt(strategy.id, strategy.user_id, alertData, validationResult);
      
      // Check if trade should be blocked
      if (!validationResult.allowed && !validationResult.error) {
        console.log(`[ML BLOCK] Trade blocked by ML validation`);
        console.log(`[ML BLOCK] Confidence: ${validationResult.confidence}% < ${validationResult.threshold}%`);
        console.log(`[ML BLOCK] Reasons: ${validationResult.reasons.join(', ')}`);
        
        // Send notification to user
        await notifyTradeBlocked(strategy.user_id, {
          strategy_name: strategy.name,
          symbol: alertData.symbol,
          action: alertData.action,
          confidence: validationResult.confidence,
          threshold: validationResult.threshold,
          reasons: validationResult.reasons
        });
        
        return res.json({
          success: false,
          blocked_by_ml: true,
          confidence: validationResult.confidence,
          threshold: validationResult.threshold,
          reasons: validationResult.reasons,
          message: `Trade blocked by ML validation (confidence ${validationResult.confidence}% < ${validationResult.threshold}%)`
        });
      }
      
      // Trade allowed (or ML error - fail open)
      if (validationResult.error) {
        console.warn(`[ML VALIDATION] ML service error, allowing trade by default`);
      } else {
        console.log(`[ML ALLOW] Trade allowed by ML validation (confidence ${validationResult.confidence}% >= ${validationResult.threshold}%)`);
      }
    }
    
    // 4. Continue with normal trade execution
    await executeTrade(alertData);
    
    return res.json({
      success: true,
      message: 'Trade executed successfully'
    });
    
  } catch (error) {
    console.error('[WEBHOOK ERROR]', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
```

---

### Step 3: Add Market Context Helper

**File:** `src/tradeExecutor.js`

```javascript
/**
 * Get current market context for ML validation
 * 
 * @param {string} symbol - Trading symbol
 * @param {string} exchange - Exchange name
 * @returns {Object} Market context data
 */
async function getMarketContext(symbol, exchange) {
  try {
    // For now, just get current price
    // In future, add volume, volatility, support/resistance
    const ccxtExchange = await getCCXTExchange(exchange);
    const ticker = await ccxtExchange.fetchTicker(symbol);
    
    return {
      current_price: ticker.last,
      volume: ticker.quoteVolume,
      timestamp: new Date().toISOString(),
      exchange,
      symbol
    };
  } catch (error) {
    console.error('[MARKET CONTEXT ERROR]', error);
    return {
      current_price: null,
      volume: null,
      timestamp: new Date().toISOString(),
      exchange,
      symbol
    };
  }
}
```

---

### Step 4: Add Validation Logging Function

**File:** `src/tradeExecutor.js`

```javascript
/**
 * Log ML validation attempt to Supabase
 * 
 * @param {string} strategyId - Strategy ID
 * @param {string} userId - User ID
 * @param {Object} alertData - Webhook alert data
 * @param {Object} validationResult - ML validation result
 */
async function logValidationAttempt(strategyId, userId, alertData, validationResult) {
  try {
    const { error } = await supabase
      .from('strategy_validation_log')
      .insert({
        strategy_id: strategyId,
        user_id: userId,
        signal_timestamp: new Date().toISOString(),
        symbol: alertData.symbol,
        action: alertData.action,
        price_at_signal: validationResult.market_context?.current_price,
        ml_confidence: validationResult.confidence,
        confidence_threshold: validationResult.threshold,
        validation_result: validationResult.allowed ? 'allowed' : 'blocked',
        market_context: validationResult.market_context,
        feature_scores: validationResult.feature_scores,
        decision_reasons: validationResult.reasons,
        trade_executed: validationResult.allowed,
      });
    
    if (error) {
      console.error('[VALIDATION LOG ERROR]', error);
    }
  } catch (error) {
    console.error('[VALIDATION LOG ERROR]', error);
    // Don't fail the trade if logging fails
  }
}
```

---

### Step 5: Add Notification Functions

**File:** `src/utils/notifications.js`

```javascript
/**
 * Notify user that a trade was blocked by ML validation
 * 
 * @param {string} userId - User ID
 * @param {Object} data - Notification data
 */
async function notifyTradeBlocked(userId, data) {
  // Check if user has this notification enabled
  const { data: prefs, error: prefsError } = await supabase
    .from('notification_preferences')
    .select('trade_alerts_enabled')
    .eq('user_id', userId)
    .single();
  
  if (prefsError || !prefs?.trade_alerts_enabled) {
    return; // User has this notification disabled
  }
  
  const message = [
    `${data.symbol} ${data.action} signal blocked`,
    `Confidence: ${data.confidence}% (threshold: ${data.threshold}%)`,
    data.reasons.length > 0 ? `Reasons: ${data.reasons.join(', ')}` : ''
  ].filter(Boolean).join(' • ');
  
  await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'trade_blocked',
      title: `Trade Blocked: ${data.strategy_name}`,
      message,
      data: {
        strategy_name: data.strategy_name,
        symbol: data.symbol,
        action: data.action,
        confidence: data.confidence,
        threshold: data.threshold,
        reasons: data.reasons
      },
      read: false
    });
}

module.exports = {
  // ... existing exports ...
  notifyTradeBlocked
};
```

---

### Step 6: Environment Variables

**File:** `.env`

Add Arthur ML service URL:

```env
# Arthur ML Service
ARTHUR_ML_URL=http://localhost:8001
```

---

### Step 7: Update Package Dependencies

**File:** `package.json`

Ensure `node-fetch` is installed (if not already):

```bash
npm install node-fetch@2
```

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

## 📋 Deployment Checklist

Before deploying to production:

- [ ] Arthur ML service is running on same VPS
- [ ] `ARTHUR_ML_URL` environment variable is set
- [ ] Database migration `strategy_validation_log.sql` has been run
- [ ] Supabase RLS policies are enabled for validation log
- [ ] Unit tests pass for ML validation
- [ ] End-to-end test with real TradingView alert
- [ ] Monitoring/logging is set up
- [ ] Error alerting is configured (if ML service goes down)
- [ ] Fail-open behavior tested (disconnect Arthur ML)

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

