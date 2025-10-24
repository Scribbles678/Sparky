# Dynamic Trailing Stop Loss Feature

## Overview
Automatically tighten trailing stop pips based on profit thresholds to better protect profits as positions move in your favor.

## Concept
- **Initial Trailing Stop:** 30 pips (wide protection)
- **Profit Threshold:** 1.5% profit reached
- **Tightened Stop:** 15 pips (better profit protection)

## Example Scenario
- **Entry:** 1.1000 EUR/USD
- **Initial:** 30 pip trailing stop
- **Price moves to 1.1165:** 1.5% profit reached
- **Stop tightens:** Now 15 pips behind
- **Better protection:** Less likely to give back gains

## Implementation Phases

### Phase 1: Foundation
- [ ] Add profit monitoring to position tracker
- [ ] Create Oanda API method for modifying existing trailing stop orders
- [ ] Add profit threshold configuration to config.json

### Phase 2: Automation
- [ ] Implement automatic stop modification logic in tradeExecutor
- [ ] Add progressive tightening options (multiple profit thresholds)
- [ ] Error handling and logging for stop modifications

### Phase 3: Analytics
- [ ] Create dashboard metrics for dynamic trailing stops
- [ ] Track performance comparison between fixed vs dynamic trailing stops
- [ ] Optimization tools and recommendations

## Configuration Example (Future)
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 1.0,
        "trailingPips": 25
      },
      {
        "profitPercent": 2.0, 
        "trailingPips": 15
      },
      {
        "profitPercent": 3.0,
        "trailingPips": 10
      }
    ]
  }
}
```

## Benefits
- **Better Profit Protection:** Tighter stops as profits increase
- **Reduced Drawdowns:** Less likely to give back gains
- **Automated Management:** No manual intervention required
- **Flexible Configuration:** Multiple profit thresholds supported

## Status
**Pending** - Ready for future development after basic trailing stops testing is complete.
