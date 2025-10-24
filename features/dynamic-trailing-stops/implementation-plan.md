# Dynamic Trailing Stops - Implementation Plan

## Technical Requirements

### 1. Profit Monitoring System
**File:** `src/positionTracker.js`
- Add `currentProfit` field to position objects
- Calculate profit percentage: `(currentPrice - entryPrice) / entryPrice * 100`
- Update profit in real-time during position monitoring
- Store profit history for analytics

### 2. Oanda API Enhancement
**File:** `src/exchanges/oandaApi.js`
- Add `modifyTrailingStop(symbol, newDistance)` method
- Use Oanda's order modification API
- Handle order ID tracking for modifications
- Error handling for failed modifications

### 3. Configuration System
**File:** `config.json`
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 1.0,
        "trailingPips": 25,
        "description": "First profit level"
      },
      {
        "profitPercent": 2.0,
        "trailingPips": 15,
        "description": "Second profit level"
      }
    ]
  }
}
```

### 4. Trade Executor Logic
**File:** `src/tradeExecutor.js`
- Monitor open positions for profit thresholds
- Automatically trigger stop modifications
- Log all dynamic stop changes
- Handle multiple profit levels

### 5. Database Schema (Future)
**Table:** `dynamic_stop_changes`
- `position_id`
- `original_pips`
- `new_pips`
- `profit_at_change`
- `timestamp`
- `success`

## Implementation Steps

### Step 1: Foundation
1. Add profit monitoring to position tracker
2. Create Oanda API modification method
3. Add configuration structure

### Step 2: Core Logic
1. Implement profit threshold checking
2. Add automatic stop modification
3. Error handling and logging

### Step 3: Advanced Features
1. Progressive tightening (multiple thresholds)
2. Time-based tightening options
3. Performance analytics

### Step 4: Dashboard Integration
1. Real-time profit monitoring
2. Dynamic stop change history
3. Performance comparisons

## Testing Strategy

### Phase 1: Manual Testing
- Test profit monitoring accuracy
- Verify Oanda API modifications
- Check configuration loading

### Phase 2: Automated Testing
- Test automatic threshold triggers
- Verify error handling
- Performance under load

### Phase 3: Live Testing
- Small position testing
- Compare against fixed trailing stops
- Monitor performance metrics

## Risk Considerations

### Technical Risks
- **API Rate Limits:** Oanda modification limits
- **Order Failures:** Failed stop modifications
- **Timing Issues:** Profit calculation delays

### Trading Risks
- **Over-Tightening:** Stops too close to market
- **False Triggers:** Temporary profit spikes
- **Market Gaps:** Slippage during modifications

## Success Metrics

### Performance Metrics
- **Profit Protection:** Average profit retention
- **Win Rate:** Comparison vs fixed stops
- **Drawdown Reduction:** Maximum drawdown improvement

### Technical Metrics
- **Modification Success Rate:** % of successful changes
- **Response Time:** Speed of profit detection
- **Error Rate:** Failed modifications

## Future Enhancements

### Advanced Features
- **Time-Based Tightening:** Stops tighten over time
- **Volatility Adjustment:** Dynamic pips based on ATR
- **Market Condition Awareness:** Different rules for trending vs ranging

### Analytics
- **Performance Dashboard:** Real-time metrics
- **Backtesting:** Historical performance
- **Optimization Tools:** Parameter tuning
