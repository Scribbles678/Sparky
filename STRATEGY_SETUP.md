# Strategy Management System

## 🎯 **Overview**

The Sparky bot now supports **multiple trading strategies** with comprehensive analytics and performance tracking. Each strategy can be tracked separately to identify which ones are performing best.

## 🚀 **How It Works**

### **1. Strategy-Based Webhooks**

Instead of generic webhooks, you now include a `strategy` field:

```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "buy",
  "symbol": "ETHUSDT",
  "strategy": "momentum_breakout",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 2.5
}
```

### **2. Strategy Creation**

Create strategies via API or database:

```bash
# Create a new strategy
curl -X POST http://localhost:3000/api/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "momentum_breakout",
    "description": "Momentum breakout strategy for crypto",
    "assetClass": "crypto",
    "status": "active",
    "riskLevel": "medium",
    "maxPositionSize": 750,
    "stopLossPercent": 1.5,
    "takeProfitPercent": 2.5,
    "timeframe": "5m",
    "symbols": ["ETHUSDT", "BTCUSDT", "ADAUSDT"],
    "notes": "Breakout strategy with tight stops"
  }'
```

### **3. Strategy Analytics**

Get performance data:

```bash
# Get all strategies with analytics
curl -X GET http://localhost:3000/api/strategies

# Get strategy comparison
curl -X GET http://localhost:3000/api/strategies/comparison

# Get specific strategy details
curl -X GET http://localhost:3000/api/strategies/momentum_breakout
```

## 📊 **Strategy Performance Tracking**

### **Automatic Metrics:**
- **Win Rate**: Percentage of profitable trades
- **Average Profit**: Average P&L per trade
- **Total Trades**: Number of trades executed
- **Success Rate**: Overall performance score
- **Risk Level**: Low/Medium/High classification

### **Dashboard Integration:**
- **Strategy Comparison**: See which strategies perform best
- **Performance Charts**: Track strategy performance over time
- **Risk Analysis**: Identify high-risk vs high-reward strategies
- **Symbol Analysis**: See which symbols work best for each strategy

## 🎯 **Example Strategies**

### **1. Momentum Breakout**
```json
{
  "name": "momentum_breakout",
  "description": "Breakout strategy for trending markets",
  "assetClass": "crypto",
  "riskLevel": "medium",
  "stopLossPercent": 1.5,
  "takeProfitPercent": 2.5,
  "symbols": ["ETHUSDT", "BTCUSDT", "ADAUSDT"]
}
```

### **2. Mean Reversion**
```json
{
  "name": "mean_reversion",
  "description": "Mean reversion strategy for ranging markets",
  "assetClass": "crypto",
  "riskLevel": "low",
  "stopLossPercent": 2.0,
  "takeProfitPercent": 1.5,
  "symbols": ["ETHUSDT", "BTCUSDT"]
}
```

### **3. Scalping Strategy**
```json
{
  "name": "scalping",
  "description": "Quick scalping for volatile periods",
  "assetClass": "crypto",
  "riskLevel": "high",
  "stopLossPercent": 0.8,
  "takeProfitPercent": 1.2,
  "symbols": ["ETHUSDT", "BTCUSDT"]
}
```

## 🔧 **TradingView Alert Setup**

### **Alert Message Format:**
```json
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "strategy": "momentum_breakout",
  "stop_loss_percent": 1.5,
  "take_profit_percent": 2.5
}
```

### **Strategy-Specific Alerts:**
- **Momentum Breakout**: Use for trending markets
- **Mean Reversion**: Use for ranging markets  
- **Scalping**: Use for high volatility periods

## 📈 **Performance Analytics**

### **Strategy Comparison API:**
```bash
curl -X GET http://localhost:3000/api/strategies/comparison
```

**Response:**
```json
{
  "success": true,
  "comparison": [
    {
      "name": "momentum_breakout",
      "success_rate": 75.5,
      "avg_profit": 12.3,
      "total_trades": 45,
      "rank": 1,
      "performance_score": 89.2
    },
    {
      "name": "mean_reversion", 
      "success_rate": 68.2,
      "avg_profit": 8.7,
      "total_trades": 32,
      "rank": 2,
      "performance_score": 76.8
    }
  ],
  "best_strategy": "momentum_breakout",
  "worst_strategy": "scalping"
}
```

## 🎯 **Best Practices**

### **1. Strategy Naming:**
- Use descriptive names: `momentum_breakout`, `mean_reversion`
- Include timeframe: `scalping_1m`, `swing_4h`
- Include asset class: `crypto_momentum`, `forex_scalping`

### **2. Risk Management:**
- Set appropriate stop losses per strategy
- Use different position sizes for different risk levels
- Monitor strategy performance regularly

### **3. Testing:**
- Start with small position sizes for new strategies
- Test strategies in different market conditions
- Keep detailed notes on strategy performance

## 🚀 **Next Steps**

1. **Create your first strategy** using the API
2. **Set up TradingView alerts** with strategy names
3. **Monitor performance** via the dashboard
4. **Optimize strategies** based on analytics
5. **Scale successful strategies** and retire poor performers

## 📊 **Dashboard Integration**

The TradeFI dashboard will automatically:
- **Track strategy performance** in real-time
- **Show strategy comparison** charts
- **Display risk metrics** for each strategy
- **Provide optimization suggestions** based on data

**Your trading bot is now a sophisticated strategy management system!** 🚀
