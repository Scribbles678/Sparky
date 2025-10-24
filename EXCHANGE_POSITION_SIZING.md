# Exchange-Specific Position Sizing

## Overview
This feature allows you to set different position sizes for different exchanges, enabling larger forex positions than crypto positions.

## Configuration Options

### Option 1: Direct Trade Amounts (Recommended)
Set specific dollar amounts for each exchange:

```json
{
  "tradeAmount": 750,
  "webhookSecret": "Sparky_Bot_Secret_XYZ123",
  
  "aster": {
    "apiKey": "HIDDEN",
    "apiSecret": "HIDDEN",
    "apiUrl": "https://fapi.asterdex.com",
    "tradeAmount": 500
  },
  
  "oanda": {
    "accountId": "101-001-28692540-001",
    "accessToken": "HIDDEN",
    "environment": "practice",
    "tradeAmount": 1500
  },
  
  "tradier": {
    "accountId": "VA55402267",
    "accessToken": "HIDDEN",
    "environment": "sandbox",
    "tradeAmount": 1000
  }
}
```

**Result:**
- **Aster (Crypto):** $500 positions
- **Oanda (Forex):** $1,500 positions (3x larger)
- **Tradier (Stocks):** $1,000 positions

### Option 2: Multiplier System
Use multipliers based on the global `tradeAmount`:

```json
{
  "tradeAmount": 750,
  "webhookSecret": "Sparky_Bot_Secret_XYZ123",
  
  "aster": {
    "apiKey": "HIDDEN",
    "apiSecret": "HIDDEN",
    "apiUrl": "https://fapi.asterdex.com",
    "positionMultiplier": 0.67
  },
  
  "oanda": {
    "accountId": "101-001-28692540-001",
    "accessToken": "HIDDEN",
    "environment": "practice",
    "positionMultiplier": 2.0
  },
  
  "tradier": {
    "accountId": "VA55402267",
    "accessToken": "HIDDEN",
    "environment": "sandbox",
    "positionMultiplier": 1.33
  }
}
```

**Result:**
- **Aster (Crypto):** $750 × 0.67 = $500 positions
- **Oanda (Forex):** $750 × 2.0 = $1,500 positions
- **Tradier (Stocks):** $750 × 1.33 = $1,000 positions

### Option 3: Hybrid Approach
Combine both methods for maximum flexibility:

```json
{
  "tradeAmount": 750,
  "webhookSecret": "Sparky_Bot_Secret_XYZ123",
  
  "aster": {
    "apiKey": "HIDDEN",
    "apiSecret": "HIDDEN",
    "apiUrl": "https://fapi.asterdex.com",
    "tradeAmount": 500
  },
  
  "oanda": {
    "accountId": "101-001-28692540-001",
    "accessToken": "HIDDEN",
    "environment": "practice",
    "positionMultiplier": 2.0
  },
  
  "tradier": {
    "accountId": "VA55402267",
    "accessToken": "HIDDEN",
    "environment": "sandbox",
    "tradeAmount": 1000
  }
}
```

**Result:**
- **Aster (Crypto):** $500 (direct amount)
- **Oanda (Forex):** $750 × 2.0 = $1,500 (multiplier)
- **Tradier (Stocks):** $1,000 (direct amount)

## Priority Logic

The bot uses this priority order:

1. **Exchange-specific `tradeAmount`** (highest priority)
2. **Global `tradeAmount` × `positionMultiplier`**
3. **Global `tradeAmount`** (fallback)

## Examples

### Conservative Setup
```json
{
  "tradeAmount": 500,
  "aster": { "tradeAmount": 300 },
  "oanda": { "tradeAmount": 800 },
  "tradier": { "tradeAmount": 600 }
}
```
- **Crypto:** $300 (smaller, more volatile)
- **Forex:** $800 (larger, more stable)
- **Stocks:** $600 (medium)

### Aggressive Setup
```json
{
  "tradeAmount": 1000,
  "aster": { "positionMultiplier": 0.5 },
  "oanda": { "positionMultiplier": 3.0 },
  "tradier": { "positionMultiplier": 2.0 }
}
```
- **Crypto:** $500 (reduced risk)
- **Forex:** $3,000 (maximum leverage)
- **Stocks:** $2,000 (high conviction)

### Balanced Setup
```json
{
  "tradeAmount": 750,
  "aster": { "tradeAmount": 500 },
  "oanda": { "tradeAmount": 1500 },
  "tradier": { "tradeAmount": 1000 }
}
```
- **Crypto:** $500 (moderate)
- **Forex:** $1,500 (2x larger)
- **Stocks:** $1,000 (balanced)

## Risk Considerations

### Position Size Guidelines

#### Crypto (Aster)
- **Conservative:** $200-500
- **Moderate:** $500-1000
- **Aggressive:** $1000-2000

#### Forex (Oanda)
- **Conservative:** $500-1000
- **Moderate:** $1000-2000
- **Aggressive:** $2000-5000

#### Stocks (Tradier)
- **Conservative:** $300-800
- **Moderate:** $800-1500
- **Aggressive:** $1500-3000

### Risk Management Tips

1. **Start Conservative:** Begin with smaller position sizes
2. **Monitor Performance:** Track win rates and drawdowns
3. **Adjust Gradually:** Increase sizes based on performance
4. **Consider Volatility:** Higher volatility = smaller positions
5. **Account for Leverage:** Forex has higher leverage than crypto

## Implementation

### Step 1: Update Your Config
Add exchange-specific `tradeAmount` or `positionMultiplier` to your `config.json`:

```json
{
  "tradeAmount": 750,
  "webhookSecret": "Sparky_Bot_Secret_XYZ123",
  
  "aster": {
    "apiKey": "HIDDEN",
    "apiSecret": "HIDDEN",
    "apiUrl": "https://fapi.asterdex.com",
    "tradeAmount": 500
  },
  
  "oanda": {
    "accountId": "101-001-28692540-001",
    "accessToken": "HIDDEN",
    "environment": "practice",
    "tradeAmount": 1500
  }
}
```

### Step 2: Restart Sparky
```bash
pm2 restart aster-bot
```

### Step 3: Test with Alerts
Send test alerts to verify position sizes:
- **Aster alert:** Should create $500 position
- **Oanda alert:** Should create $1,500 position

### Step 4: Monitor Logs
Check the logs to confirm position sizes:
```bash
pm2 logs aster-bot
```

Look for messages like:
```
Position size calculated: 0.5 at 50000 ($500 position)
Position size calculated: 1500 at 1.1000 ($1500 position)
```

## Benefits

### 1. **Risk-Adjusted Sizing**
- Smaller positions for volatile assets (crypto)
- Larger positions for stable assets (forex)

### 2. **Exchange Optimization**
- Different risk profiles per exchange
- Capital allocation based on confidence

### 3. **Flexibility**
- Easy to adjust per exchange
- No need to change webhook messages

### 4. **Backward Compatibility**
- Existing configs still work
- Gradual migration possible

## Troubleshooting

### Issue: Position sizes not changing
**Solution:** Check that you've added the exchange-specific config and restarted the bot.

### Issue: Config validation errors
**Solution:** Ensure JSON syntax is correct and all required fields are present.

### Issue: Unexpected position sizes
**Solution:** Check the priority logic - `tradeAmount` overrides `positionMultiplier`.

## Future Enhancements

### Planned Features
- **Symbol-specific sizing:** Different sizes per currency pair
- **Volatility-based sizing:** Automatic adjustment based on ATR
- **Time-based sizing:** Different sizes for different trading sessions
- **Performance-based sizing:** Adjust based on recent performance

### Advanced Configuration
```json
{
  "positionSizing": {
    "aster": {
      "default": 500,
      "symbols": {
        "BTC_USDT": 1000,
        "ETH_USDT": 750
      }
    },
    "oanda": {
      "default": 1500,
      "symbols": {
        "EUR_USD": 2000,
        "GBP_USD": 1200
      }
    }
  }
}
```

This feature gives you complete control over position sizing across all exchanges! 🎯
