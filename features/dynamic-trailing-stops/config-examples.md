# Dynamic Trailing Stops - Configuration Examples

## Basic Configuration

### Simple Two-Level System
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 1.5,
        "trailingPips": 15,
        "description": "Tighten after 1.5% profit"
      }
    ]
  }
}
```

## Advanced Configuration

### Progressive Tightening (3 Levels)
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
      },
      {
        "profitPercent": 3.0,
        "trailingPips": 10,
        "description": "Third profit level"
      }
    ]
  }
}
```

## Conservative Strategy

### Wide Initial, Gradual Tightening
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 0.5,
        "trailingPips": 30,
        "description": "Early profit protection"
      },
      {
        "profitPercent": 1.0,
        "trailingPips": 20,
        "description": "Moderate protection"
      },
      {
        "profitPercent": 2.0,
        "trailingPips": 15,
        "description": "Strong protection"
      }
    ]
  }
}
```

## Aggressive Strategy

### Quick Tightening for Trend Following
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 2.0,
        "trailingPips": 20,
        "description": "Let trends run initially"
      },
      {
        "profitPercent": 4.0,
        "trailingPips": 10,
        "description": "Protect big gains"
      }
    ]
  }
}
```

## Time-Based Configuration (Future)

### Time + Profit Combination
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "profitThresholds": [
      {
        "profitPercent": 1.0,
        "trailingPips": 25,
        "timeMinutes": 30,
        "description": "After 30 minutes or 1% profit"
      },
      {
        "profitPercent": 2.0,
        "trailingPips": 15,
        "timeMinutes": 60,
        "description": "After 1 hour or 2% profit"
      }
    ]
  }
}
```

## Volatility-Based Configuration (Future)

### ATR-Adjusted Stops
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "useATR": true,
    "atrMultiplier": 2.0,
    "profitThresholds": [
      {
        "profitPercent": 1.0,
        "atrMultiplier": 2.5,
        "description": "Wide stops initially"
      },
      {
        "profitPercent": 2.0,
        "atrMultiplier": 1.5,
        "description": "Tighter stops with profit"
      }
    ]
  }
}
```

## Per-Symbol Configuration

### Different Rules for Different Pairs
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "symbolSpecific": {
      "EUR_USD": {
        "profitThresholds": [
          {
            "profitPercent": 1.0,
            "trailingPips": 20
          }
        ]
      },
      "GBP_USD": {
        "profitThresholds": [
          {
            "profitPercent": 1.5,
            "trailingPips": 25
          }
        ]
      }
    }
  }
}
```

## Testing Configuration

### Development/Testing Mode
```json
{
  "dynamicTrailingStops": {
    "enabled": true,
    "testingMode": true,
    "logLevel": "debug",
    "profitThresholds": [
      {
        "profitPercent": 0.5,
        "trailingPips": 30,
        "description": "Test with small profit"
      }
    ]
  }
}
```

## Disabled Configuration

### Turn Off Dynamic Stops
```json
{
  "dynamicTrailingStops": {
    "enabled": false
  }
}
```

## Configuration Validation

### Required Fields
- `enabled`: boolean
- `profitThresholds`: array of objects
- Each threshold must have:
  - `profitPercent`: number (0.1 to 100)
  - `trailingPips`: number (5 to 100)

### Optional Fields
- `description`: string
- `timeMinutes`: number (future)
- `atrMultiplier`: number (future)
- `testingMode`: boolean
- `logLevel`: string

## Best Practices

### 1. Start Conservative
- Begin with wide initial stops (25-30 pips)
- Use moderate profit thresholds (1-2%)
- Test thoroughly before tightening

### 2. Gradual Implementation
- Test with small positions first
- Monitor performance closely
- Adjust based on results

### 3. Market Awareness
- Consider different rules for trending vs ranging markets
- Adjust for high/low volatility periods
- Account for news events

### 4. Performance Monitoring
- Track modification success rates
- Monitor profit protection effectiveness
- Compare against fixed trailing stops
