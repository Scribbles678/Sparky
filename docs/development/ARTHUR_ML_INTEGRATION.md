# Arthur ML Service Integration

**How Sparky AI Worker integrates with Arthur ML Service for hybrid ML + LLM predictions**

---

## Overview

Sparky AI Worker integrates with Arthur ML Service to provide:
- **Fast ML predictions** (<100ms latency)
- **Per-strategy ML models** (customized to each strategy)
- **Hybrid routing** (ML for high-confidence, LLM for edge cases)
- **Cost optimization** (70-80% reduction in LLM costs)

**Arthur ML Service:** Runs on `localhost:8001` (same VPS as Sparky)

---

## Architecture

```
Sparky AI Worker
    ↓
1. Fetches active strategies
    ↓
2. Gets market data & calculates indicators
    ↓
3. Calls Arthur ML Service
   POST /predict-strategy
   {
     strategy_id: "uuid",
     market_data: { sma20, rsi, ... }
   }
    ↓
4. Receives ML prediction
   {
     action: "LONG",
     confidence: 0.75,
     model_type: "strategy_specific"
   }
    ↓
5. Routing decision
   - If confidence >= threshold → Use ML
   - If confidence < threshold → Use LLM
    ↓
6. Execute decision
```

---

## Configuration

### Environment Variables

**Required:**
```env
ML_SERVICE_URL=http://localhost:8001
```

**Optional:**
```env
ARTHUR_ML_URL=http://localhost:8001  # Alias for ML_SERVICE_URL
```

### Strategy Config (AI Studio)

**ML Confidence Threshold:**
- `config.confidence_threshold` (0-100)
- Default: 70
- If ML confidence >= threshold → Use ML decision
- If ML confidence < threshold → Use LLM decision

**Hybrid Mode:**
```javascript
config.hybrid_mode = {
  type: 'hybrid',  // 'ml_only', 'llm_only', 'hybrid', 'smart'
  llm_percent: 60,
  ml_percent: 40
}
```

**Feature Weights:**
```javascript
config.feature_weights = {
  rsi: 1.2,      // 20% more important
  macd: 0.8,     // 20% less important
  volume: 1.0    // Normal weight
}
```
- Used during ML training
- Passed to Arthur ML `/train-strategy` endpoint

---

## Implementation

### ML Prediction Utility

**File:** `src/ai-worker/utils/mlPrediction.js`

**Key Functions:**

1. **`prepareMLFeatures(indicators, orderbook, positions, strategy)`**
   - Converts technical indicators to ML feature format
   - Matches Arthur ML FastAPI schema
   - Includes: SMAs, EMAs, RSI, MACD, Bollinger, ATR, Volume, Orderbook, Time features

2. **`getMLPrediction(features, strategyId)`**
   - Calls Arthur ML `/predict-strategy` endpoint
   - Passes strategy ID for per-strategy model lookup
   - Falls back to global model if strategy model unavailable
   - Returns: `{ action, confidence, probability, should_execute, model_type, model_version }`

3. **`checkMLServiceHealth()`**
   - Checks if Arthur ML service is available
   - Calls `/health` endpoint
   - Used for graceful degradation

4. **`mlPredictionToDecision(mlPrediction, symbol, strategy)`**
   - Converts ML prediction to decision format
   - Compatible with existing `parseDecision()` output

### Integration in AI Worker

**File:** `src/ai-worker/main.js`

```javascript
// 1. Get ML prediction
const mlFeatures = prepareMLFeatures(indicators, orderbook, positions, strategy);
const mlPrediction = await getMLPrediction(mlFeatures, strategy.id);

// 2. Determine routing
const useML = determineModelUsage(mlPrediction, normalizedConfig);

// 3. Make decision
let decision;
if (useML) {
  // Use ML decision
  decision = mlPredictionToDecision(mlPrediction, symbol, normalizedConfig);
  metrics.mlDecisions++;
} else {
  // Use LLM decision
  decision = await getLLMDecision(marketData, normalizedConfig);
  metrics.llmDecisions++;
}

// 4. Log decision with model type
await logDecision({
  ...decision,
  model_type: mlPrediction.model_type,
  ml_confidence: mlPrediction.confidence
});
```

### Routing Logic

**File:** `src/ai-worker/main.js` → `determineModelUsage()`

```javascript
function determineModelUsage(mlPrediction, config) {
  const hybridMode = config.hybrid_mode || { type: 'hybrid', llm_percent: 60 };
  
  switch (hybridMode.type) {
    case 'ml_only':
      return true;  // Always use ML
      
    case 'llm_only':
      return false;  // Always use LLM
      
    case 'hybrid':
      // Use ML if confidence >= threshold
      const threshold = (config.confidence_threshold || 70) / 100;
      return mlPrediction.confidence >= threshold;
      
    case 'smart':
      // Percentage-based routing
      const random = Math.random();
      return random < (hybridMode.ml_percent / 100);
      
    default:
      return mlPrediction.confidence >= 0.70;  // Default threshold
  }
}
```

---

## Per-Strategy ML Models

### How It Works

1. **Strategy-Specific Model**
   - Each strategy can have its own ML model
   - Trained on strategy-specific trading history
   - Better accuracy than global model

2. **Model Lookup**
   - Arthur ML checks for active strategy model first
   - Falls back to global model if not available
   - Returns `model_type: 'strategy_specific'` or `'global'`

3. **Training**
   - Triggered from SignalStudio AI Studio
   - Requires 100+ trades with outcomes
   - Uses `config.feature_weights` during training

**See:** [Auto-Retrain System](AUTO_RETRAIN_SYSTEM.md)

---

## Error Handling

### ML Service Unavailable

**Graceful Degradation:**
```javascript
const mlHealth = await checkMLServiceHealth();
if (!mlHealth) {
  logger.warn('ML service unavailable, using LLM only');
  // Fall back to LLM for all decisions
  return await getLLMDecision(marketData, config);
}
```

### Prediction Failures

**Retry Logic:**
- 2 retries with exponential backoff
- 5-second timeout per request
- Falls back to LLM if all retries fail

**Logging:**
- All ML failures logged
- Metrics tracked: `mlCalls`, `mlLatency`, `mlDecisions`

---

## Metrics & Monitoring

### Tracked Metrics

```javascript
metrics = {
  mlCalls: 0,           // Total ML API calls
  mlLatency: [],        // ML response times
  mlDecisions: 0,       // Decisions made by ML
  llmDecisions: 0,      // Decisions made by LLM
  costSavings: 0        // Estimated cost savings
}
```

### Cost Savings Calculation

```javascript
// ML prediction: ~$0.000001
// LLM call: ~$0.0001
// Savings per ML decision: ~$0.000099

const savingsPerMLDecision = 0.000099;
metrics.costSavings += savingsPerMLDecision * metrics.mlDecisions;
```

---

## Testing

### Test ML Service Connection

```bash
# From Sparky directory
curl http://localhost:8001/health
```

### Test ML Prediction

```bash
curl -X POST http://localhost:8001/predict-strategy \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "your-strategy-uuid",
    "market_data": {
      "sma20": 50000,
      "rsi": 55,
      "current_price": 51000
    }
  }'
```

### Verify in Logs

```bash
# Check AI Worker logs
pm2 logs ai-signal-engine | grep -i "ml"

# Should see:
# "ML prediction received: confidence=0.75, model_type=strategy_specific"
# "Using ML decision for strategy..."
```

---

## Troubleshooting

### "ML service unavailable"

**Solutions:**
1. Verify Arthur ML is running: `pm2 status`
2. Check `ML_SERVICE_URL` in `.env`
3. Test connection: `curl http://localhost:8001/health`
4. Check Arthur logs: `pm2 logs arthur-ml-service`

### "All decisions using LLM"

**Possible Causes:**
1. ML confidence always below threshold
2. `hybrid_mode.type` set to `'llm_only'`
3. ML service returning low confidence

**Solutions:**
1. Lower `confidence_threshold` in strategy config
2. Check ML model accuracy (may need retraining)
3. Verify ML service is working correctly

### "Strategy model not found"

**Solutions:**
1. Train strategy model in AI Studio (ML Training tab)
2. Verify strategy has 100+ trades with outcomes
3. Check `ai_strategy_ml_models` table for active model

---

## Related Documentation

- [AI Worker Guide](../guides/AI_WORKER.md) - Complete AI Worker documentation
- [AI Studio Config Integration](AI_STUDIO_CONFIG_INTEGRATION.md) - Config system
- [Auto-Retrain System](AUTO_RETRAIN_SYSTEM.md) - Self-improvement system
- [Arthur ML Documentation](../../../Arthur/docs/README.md) - Arthur ML service docs

---

**Last Updated:** January 2025

