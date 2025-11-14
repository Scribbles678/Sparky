## Alert Templates

Use these snippets as starting points. Replace placeholders with your symbols, strikes, and strategy-specific fields.  
⚠️ `size` / `sizePercent` currently only affect Tradier options flows—other exchanges use the fixed dollar amounts defined in `config.json`.

### Aster (crypto perps)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "buy",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "strategy": "{{strategy.order.comment}}",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}
```

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "sell",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "strategy": "{{strategy.order.comment}}",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}
```

### OANDA (fixed TP/SL)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}
```

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "sell",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}
```

### OANDA with Trailing Stop
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "{{ticker}}",
  "useTrailingStop": true,
  "trailing_stop_pips": 30
}
```

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "sell",
  "symbol": "{{ticker}}",
  "useTrailingStop": true,
  "trailing_stop_pips": 30
}
```

### Tradier (stocks/ETFs)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "tradier",
  "action": "buy",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "strategy": "{{strategy.order.comment}}",
  "stop_loss_percent": 2.0,
  "take_profit_percent": 4.0
}
```

### Tradier Options (OTCO)
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "tradier_options",
  "action": "buy",
  "symbol": "{{ticker}}",
  "right": "call",
  "strike": 225,
  "sizePercent": 15,
  "strategy": "supply_demand_ma_crossover",
  "stop_loss_percent": 30,
  "take_profit_percent": 60
}
```

### Hyperliquid / Lighter
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "hyperliquid",
  "action": "long",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 3.5
}
```

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "lighter",
  "action": "short",
  "symbol": "{{ticker}}",
  "order_type": "market",
  "stop_loss_percent": 1.2,
  "take_profit_percent": 2.8
}
```

---
Always include `{{strategy.order.alert_message}}` in your TradingView alert if you build custom payloads inside Pine:
```
{{strategy.order.alert_message}}
```
