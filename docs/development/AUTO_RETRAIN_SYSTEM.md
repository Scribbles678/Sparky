# Auto-Retrain System

**Automatic ML model retraining for self-improving trading bots**

---

## Overview

Sparky Bot includes an auto-retrain scheduler that periodically checks if AI strategies need ML model retraining and triggers the Arthur ML service to retrain models automatically.

**Purpose:** Enable bots to improve themselves over time by learning from new trading data.

---

## Architecture

```
Sparky Auto-Retrain Scheduler (runs hourly)
    ↓
1. Fetches active strategies with ml_training_enabled = true
    ↓
2. For each strategy:
   Calls SignalStudio API
   POST /api/ai-strategies/[id]/auto-retrain
    ↓
3. SignalStudio checks retrain conditions:
   - 50+ new trades since last training?
   - Performance degradation?
   - Weekly schedule?
    ↓
4. If retraining needed:
   SignalStudio → POST /auto-retrain (Arthur ML)
    ↓
5. Arthur ML trains new model
    ↓
6. Updates ai_strategy_ml_models table
    ↓
7. Activates new model if better than previous
```

---

## Implementation

### Auto-Retrain Scheduler

**File:** `src/scheduledJobs/autoRetrain.js`

**Key Functions:**

1. **`checkAndRetrainStrategies()`**
   - Runs every hour
   - Fetches active strategies with `ml_training_enabled = true`
   - Calls SignalStudio API to check retrain conditions
   - Logs results

2. **`startAutoRetrainScheduler()`**
   - Starts the scheduler
   - Runs immediately on start
   - Then runs every hour (3,600,000 ms)

### Integration in Main Bot

**File:** `src/index.js`

```javascript
// Phase 3: Start auto-retrain scheduler
try {
  const { startAutoRetrainScheduler } = require('./scheduledJobs/autoRetrain');
  startAutoRetrainScheduler();
  logger.info('✅ Auto-retrain scheduler started (runs hourly)');
} catch (error) {
  logger.warn('⚠️  Failed to start auto-retrain scheduler:', error.message);
}
```

### PM2 Configuration

**File:** `ecosystem.config.js`

The auto-retrain scheduler runs as part of the main bot process. No separate PM2 app needed.

---

## Retrain Conditions

SignalStudio checks these conditions (via `/api/ai-strategies/[id]/auto-retrain`):

### 1. New Trades Threshold

- **Condition:** 50+ new trades since last training
- **Check:** Count trades where `decided_at >= ml_model_trained_at`
- **Action:** Trigger retraining if threshold met

### 2. Performance Degradation

- **Condition:** Current win rate < 90% of model's expected performance
- **Check:** Compare recent performance to `ml_model_performance.accuracy`
- **Action:** Trigger retraining if degradation detected

### 3. Weekly Schedule

- **Condition:** Last training was > 7 days ago
- **Check:** `ml_model_trained_at < NOW() - INTERVAL '7 days'`
- **Action:** Trigger retraining if scheduled time reached

### 4. Initial Training

- **Condition:** 100+ trades available, no model exists
- **Check:** `ml_model_version IS NULL AND trade_count >= 100`
- **Action:** Trigger initial training

---

## Retraining Process

### 1. SignalStudio Checks Conditions

**Endpoint:** `POST /api/ai-strategies/[id]/auto-retrain`

**Response:**
```json
{
  "should_retrain": true,
  "reason": "50+ new trades since last training",
  "retrained": true,
  "model": {
    "version": "v2",
    "accuracy": 0.68,
    "improvement": 0.03
  }
}
```

### 2. SignalStudio Calls Arthur ML

**Endpoint:** `POST /auto-retrain` (Arthur ML)

**Request:**
```json
{
  "strategy_id": "uuid",
  "strategy_type": "ai_strategy",
  "feature_weights": {
    "rsi": 1.2,
    "macd": 0.8
  },
  "min_trades": 100,
  "reason": "50+ new trades since last training"
}
```

### 3. Arthur ML Trains Model

- Fetches strategy-specific trades from Supabase
- Applies feature weights
- Trains LightGBM model
- Evaluates performance
- Saves model to disk
- Updates `ai_strategy_ml_models` table

### 4. Model Activation

- New model is activated if better than previous
- Previous model marked `is_active = false`
- New model marked `is_active = true`
- `ai_strategies.ml_model_version` updated

---

## Configuration

### Strategy Settings

**Enable/Disable Auto-Retraining:**
- `ai_strategies.ml_training_enabled` (BOOLEAN)
- Default: `true`
- Set to `false` to disable auto-retraining

**Minimum Trades:**
- `ai_strategies.ml_min_trades_for_training` (INTEGER)
- Default: 100
- Minimum trades required for training

### Environment Variables

**SignalStudio API URL:**
```env
SIGNALSTUDIO_API_URL=http://localhost:3000
# Or production URL: https://app.signal-studio.co
```

**Arthur ML URL:**
```env
ML_SERVICE_URL=http://localhost:8001
# Or
ARTHUR_ML_URL=http://localhost:8001
```

---

## Monitoring

### Logs

**Check Auto-Retrain Activity:**
```bash
pm2 logs aster-bot | grep -i "auto-retrain"
```

**Example Logs:**
```
🔄 Auto-retrain check started
Checking 3 strategy(ies) for auto-retraining
✅ Auto-retrained strategy: My Strategy (uuid-123)
  reason: 50+ new trades since last training
  model_version: v2
  accuracy: 0.68
  improvement: 0.03
🔄 Auto-retrain check complete: 1 retrained, 2 skipped
```

### Metrics

Track in `ai_strategies.ml_model_performance`:
- `accuracy` - Model accuracy
- `roc_auc` - ROC-AUC score
- `training_samples` - Number of trades used
- `improvement` - Improvement over previous model

---

## Manual Retraining

### Via AI Studio

1. Go to AI Studio → Select strategy → ML Training tab
2. Click "Train ML Model"
3. Model trains and activates automatically

### Via API

```bash
curl -X POST http://localhost:8001/train-strategy \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "uuid",
    "strategy_type": "ai_strategy",
    "min_trades": 100
  }'
```

---

## Troubleshooting

### "Auto-retrain not running"

**Solutions:**
1. Check scheduler is started: `pm2 logs aster-bot | grep "auto-retrain"`
2. Verify `ml_training_enabled = true` for strategies
3. Check SignalStudio API is accessible
4. Verify Arthur ML service is running

### "Retraining fails"

**Possible Causes:**
1. Not enough trades (< 100)
2. Arthur ML service unavailable
3. Supabase connection issues

**Solutions:**
1. Wait for more trades to accumulate
2. Check Arthur ML health: `curl http://localhost:8001/health`
3. Verify Supabase credentials

### "No improvement after retraining"

**Possible Causes:**
1. Market conditions changed
2. Strategy needs different feature weights
3. Need more training data

**Solutions:**
1. Adjust feature weights in AI Studio
2. Wait for more diverse trading data
3. Review strategy configuration

---

## Related Documentation

- [AI Worker Guide](../guides/AI_WORKER.md) - AI Worker documentation
- [Arthur ML Integration](ARTHUR_ML_INTEGRATION.md) - ML service integration
- [AI Studio Config Integration](AI_STUDIO_CONFIG_INTEGRATION.md) - Config system
- [Arthur ML Auto-Retrain](../../../Arthur/docs/development/SIGNALSTUDIO_INTEGRATION.md#auto-retrain) - Arthur ML docs

---

**Last Updated:** January 2025

