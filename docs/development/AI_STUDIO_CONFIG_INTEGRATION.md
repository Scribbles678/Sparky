# AI Studio Config Integration

**How Sparky Bot reads and uses AI Studio configuration**

---

## Overview

AI Studio saves all strategy settings to the `config` JSONB field in the `ai_strategies` table. Sparky Bot's AI Worker reads this configuration and uses it for all decision-making.

**Key Principle:** The `config` JSONB is the primary source of truth. Direct columns are maintained for backward compatibility and are automatically synced from config.

---

## Configuration Loading

### Normalize Config Function

**File:** `src/ai-worker/utils/configReader.js`

```javascript
const { normalizeConfig } = require('./utils/configReader');

// In processStrategy()
const normalizedConfig = normalizeConfig(strategy);
```

**What it does:**
1. Merges `config` JSONB with direct columns
2. `config` JSONB takes precedence
3. Falls back to columns if config missing
4. Provides defaults for missing values

---

## Config Fields Used by Sparky

### Trading Configuration

- **`target_assets`** (array)
  - Assets to analyze and trade
  - Example: `['BTCUSDT', 'ETHUSDT']`
  - Used to filter market data fetching

- **`blacklist`** (array)
  - Symbols to never trade
  - Example: `['DOGEUSDT', 'SHIBUSDT']`
  - Applied before decision-making

- **`whitelist`** (array | null)
  - Only trade these symbols (if not null)
  - Overrides blacklist when enabled
  - Example: `['BTCUSDT']` (only BTC)

- **`daily_trade_limit`** (number)
  - Maximum trades per day
  - Default: 10
  - Enforced before executing trades

### ML/LLM Configuration

- **`confidence_threshold`** (number, 0-100)
  - ML confidence threshold
  - If ML confidence >= threshold → Use ML decision
  - If ML confidence < threshold → Use LLM decision
  - Default: 70

- **`hybrid_mode`** (object)
  ```javascript
  {
    type: 'hybrid',  // 'ml_only', 'llm_only', 'hybrid', 'smart'
    llm_percent: 60,
    ml_percent: 40
  }
  ```
  - Controls ML/LLM routing
  - Used in `determineModelUsage()` function

- **`feature_weights`** (object)
  ```javascript
  {
    rsi: 1.2,
    macd: 0.8,
    volume: 1.0
  }
  ```
  - Used during ML training (passed to Arthur ML)
  - Affects indicator importance

### LLM Configuration

- **`custom_prompt`** (string)
  - Custom instructions for LLM
  - Added to system prompt
  - Example: "Always use 2x leverage on ETH trades"

- **`strategy_styles`** (array)
  - Trading styles
  - Example: `['trend_following', 'momentum']`
  - Incorporated into LLM prompt

- **`market_regime_override`** (string)
  - Market regime: 'auto', 'bull', 'bear', 'volatile', 'ranging'
  - Used in LLM prompt

- **`timeframe`** (string)
  - Market data timeframe
  - Example: '15m', '1h', '4h'
  - Used for fetching OHLCV data

### Risk Configuration

- **`risk_profile_value`** (number, 0-100)
  - Risk profile: 0-33 (conservative), 34-66 (balanced), 67-100 (aggressive)
  - Affects position sizing and leverage

---

## Usage in AI Worker

### Example: Processing Strategy

```javascript
// src/ai-worker/main.js

async function processStrategy(strategy) {
  // Normalize config (merges JSONB with columns)
  const config = normalizeConfig(strategy);
  
  // Use config for all operations
  for (const symbol of config.target_assets) {
    // Check blacklist/whitelist
    if (config.blacklist?.includes(symbol)) continue;
    if (config.whitelist && !config.whitelist.includes(symbol)) continue;
    
    // Get market data with configured timeframe
    const marketData = await getMarketData(symbol, config.timeframe);
    
    // Get ML prediction
    const mlPrediction = await getMLPrediction(features, strategy.id);
    
    // Determine routing based on hybrid_mode
    const useML = determineModelUsage(mlPrediction, config);
    
    // Make decision (ML or LLM)
    const decision = useML 
      ? mlPredictionToDecision(mlPrediction, symbol, config)
      : await getLLMDecision(marketData, config);
    
    // Check daily trade limit
    if (tradeCountToday >= config.daily_trade_limit) {
      logger.info(`Daily trade limit reached for ${strategy.name}`);
      continue;
    }
    
    // Execute if not HOLD
    if (decision.action !== 'HOLD') {
      await sendSignal(decision, config);
    }
  }
}
```

---

## Config Sync

### SignalStudio → Sparky

1. User saves config in AI Studio
2. SignalStudio updates `config` JSONB in `ai_strategies`
3. SignalStudio syncs relevant fields to columns (backward compatibility)
4. Sparky fetches strategy with `SELECT * FROM ai_strategies`
5. Sparky normalizes config (config JSONB takes precedence)
6. Sparky uses normalized config for all operations

### Changes Take Effect

- **Immediate**: Config saved to database
- **Next AI Cycle**: Sparky picks up changes within 45 seconds
- **No Restart Needed**: Changes apply automatically

---

## Backward Compatibility

### Column Fallbacks

If `config` JSONB is missing or incomplete, Sparky falls back to columns:

- `config.target_assets` → `strategy.target_assets` (column)
- `config.confidence_threshold` → `strategy.ml_confidence_threshold` (column)
- `config.hybrid_mode.type` → `strategy.llm_usage_mode` (column)
- `config.hybrid_mode.llm_percent` → `strategy.llm_usage_percent` (column)

### Default Values

If both config and columns are missing, defaults are used:

- `target_assets`: `['BTCUSDT', 'ETHUSDT']`
- `confidence_threshold`: `70` (0-100 scale)
- `hybrid_mode`: `{ type: 'hybrid', llm_percent: 60, ml_percent: 40 }`
- `daily_trade_limit`: `10`

---

## Testing Config Changes

1. **Update Config in AI Studio**
   - Go to AI Studio → Select strategy → Configuration tab
   - Make changes (e.g., change `target_assets`)
   - Click "Save Changes"

2. **Verify in Sparky**
   - Check Sparky logs for next AI cycle (within 45 seconds)
   - Should see: "Processing strategy with config: { target_assets: [...] }"
   - Verify new assets are being analyzed

3. **Monitor Behavior**
   - Check `ai_trade_decisions` table for new decisions
   - Verify decisions reflect config changes

---

## Related Documentation

- [AI Worker Guide](../guides/AI_WORKER.md) - Complete AI Worker documentation
- [Arthur ML Integration](ARTHUR_ML_INTEGRATION.md) - ML service integration
- [SignalStudio AI Studio Guide](../../../SignalStudio/signal/docs/guides/AI_STUDIO_USER_GUIDE.md) - AI Studio user guide

---

**Last Updated:** January 2025

