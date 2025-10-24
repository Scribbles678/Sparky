# Oanda Trailing Stop Loss Implementation

## 🎯 Overview

Your Sparky bot now supports **Oanda's native trailing stop loss** functionality! This allows you to:

- ✅ Use Oanda's built-in trailing stops (no custom monitoring needed)
- ✅ Compare performance between regular stops vs trailing stops
- ✅ Track win rates and profitability for different stop types
- ✅ Test different trailing distances (pips) for optimization

---

## 🔧 How It Works

### **Regular Stop Loss (Current)**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}
```
- Places a **static stop loss** at 0.5% below entry
- Stop loss price never changes
- Risk: Fixed at 0.5% of position value

### **Trailing Stop Loss (New)**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 20,
  "take_profit_percent": 1.5
}
```
- Places a **trailing stop** that follows price in your favor
- Trails 20 pips behind the best price achieved
- Risk: Reduces as price moves in your favor

---

## 📊 Trailing Stop vs Regular Stop Comparison

### **Example: EUR/USD Long Position**

**Entry:** 1.1000, **Position:** $100

#### **Regular Stop (0.5%)**
- Stop Loss: 1.0945 (0.5% below entry)
- **Risk:** Fixed at $0.50 loss
- **Behavior:** Stop never moves, even if price goes to 1.1200

#### **Trailing Stop (20 pips)**
- **Initial:** Stop at 1.0980 (20 pips below 1.1000)
- **If price hits 1.1100:** Stop moves to 1.1080 (20 pips below 1.1100)
- **If price hits 1.1200:** Stop moves to 1.1180 (20 pips below 1.1200)
- **Risk:** Reduces as price moves in your favor

---

## 🎯 Webhook Message Formats

### **For Regular Stop Loss:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}
```

### **For Trailing Stop Loss:**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 20,
  "take_profit_percent": 1.5
}
```

### **Alternative Format (snake_case):**
```json
{
  "secret": "your-webhook-secret",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "use_trailing_stop": true,
  "trailing_stop_pips": 20,
  "take_profit_percent": 1.5
}
```

---

## 📈 Pip Values by Symbol

### **Major Pairs (1 pip = 0.0001)**
- EUR_USD, GBP_USD, AUD_USD, NZD_USD
- EUR_GBP, EUR_AUD, EUR_NZD
- GBP_AUD, GBP_NZD, AUD_NZD

### **JPY Pairs (1 pip = 0.01)**
- USD_JPY, EUR_JPY, GBP_JPY
- AUD_JPY, CAD_JPY, CHF_JPY, NZD_JPY

### **Example Pip Calculations:**

**EUR/USD at 1.1000:**
- 20 pips = 0.0020 = 0.18% move
- 50 pips = 0.0050 = 0.45% move

**USD/JPY at 110.00:**
- 20 pips = 0.20 = 0.18% move
- 50 pips = 0.50 = 0.45% move

---

## 🧪 Testing Different Strategies

### **Strategy A: Conservative Trailing**
```json
{
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 10,
  "take_profit_percent": 1.0
}
```
- **Tight trailing:** 10 pips
- **Quick exits:** 1% TP
- **Best for:** Volatile markets, quick scalping

### **Strategy B: Moderate Trailing**
```json
{
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 25,
  "take_profit_percent": 2.0
}
```
- **Medium trailing:** 25 pips
- **Balanced approach:** 2% TP
- **Best for:** Swing trading, trend following

### **Strategy C: Wide Trailing**
```json
{
  "exchange": "oanda",
  "action": "buy",
  "symbol": "EUR_USD",
  "useTrailingStop": true,
  "trailing_stop_pips": 50,
  "take_profit_percent": 3.0
}
```
- **Wide trailing:** 50 pips
- **Let winners run:** 3% TP
- **Best for:** Strong trends, breakout strategies

---

## 📊 Performance Tracking

### **Database Fields Added:**
- `stopLossType`: 'REGULAR' or 'TRAILING'
- `trailingStopDistance`: Number of pips
- `exchange`: 'oanda' for tracking

### **Dashboard Analytics:**
- **Win Rate by Stop Type:** Regular vs Trailing
- **Average P&L by Stop Type:** Which performs better
- **Trailing Distance Optimization:** Which pip distance works best
- **Symbol Performance:** Which pairs work best with trailing stops

---

## 🎯 Recommended Testing Approach

### **Phase 1: A/B Testing (2 weeks)**
- **Week 1:** Use regular stops on all Oanda trades
- **Week 2:** Use trailing stops on all Oanda trades
- **Compare:** Win rate, average P&L, max drawdown

### **Phase 2: Distance Optimization (2 weeks)**
- **Week 1:** Test 15 pips trailing distance
- **Week 2:** Test 30 pips trailing distance
- **Compare:** Which distance gives better risk/reward

### **Phase 3: Symbol-Specific Optimization (2 weeks)**
- **EUR/USD:** Test different trailing distances
- **GBP/USD:** Test different trailing distances
- **USD/JPY:** Test different trailing distances
- **Find:** Optimal settings per symbol

---

## ⚠️ Important Notes

### **Trailing Stop Behavior:**
- ✅ **Only moves in your favor** (never worse)
- ✅ **Oanda handles everything** (no bot monitoring needed)
- ✅ **Works 24/7** (even when bot is offline)
- ✅ **No slippage** (Oanda's native implementation)

### **Risk Management:**
- **Start small:** Test with $50-100 positions first
- **Track performance:** Use dashboard to compare strategies
- **Don't mix:** Either use trailing OR regular stops, not both
- **Monitor closely:** Check first few trades manually

### **Best Practices:**
- **Use trailing stops** for trending markets
- **Use regular stops** for ranging markets
- **Adjust pip distance** based on symbol volatility
- **Keep TP targets** reasonable (1-3%)

---

## 🚀 Getting Started

### **Step 1: Update Your TradingView Alerts**

**For Regular Stops:**
```json
{"secret":"your-secret","exchange":"oanda","action":"buy","symbol":"EUR_USD","stop_loss_percent":0.5,"take_profit_percent":1.5}
```

**For Trailing Stops:**
```json
{"secret":"your-secret","exchange":"oanda","action":"buy","symbol":"EUR_USD","useTrailingStop":true,"trailing_stop_pips":20,"take_profit_percent":1.5}
```

### **Step 2: Test with Small Positions**
- Start with $50-100 positions
- Monitor the first few trades
- Check Oanda platform to see trailing stops in action

### **Step 3: Track Performance**
- Use the dashboard to compare strategies
- Look for patterns in win rates
- Optimize based on results

---

## 📈 Expected Benefits

### **Trailing Stops Should:**
- ✅ **Reduce losses** on winning trades that reverse
- ✅ **Let winners run** longer
- ✅ **Improve risk/reward ratio**
- ✅ **Reduce emotional trading** (automated)

### **Potential Drawbacks:**
- ❌ **May exit too early** in strong trends
- ❌ **Wider initial risk** than tight regular stops
- ❌ **Requires trending markets** to be effective

---

## 🎯 Success Metrics

Track these metrics to determine if trailing stops are working:

1. **Win Rate:** % of profitable trades
2. **Average Winner:** Average profit per winning trade
3. **Average Loser:** Average loss per losing trade
4. **Profit Factor:** Total wins / Total losses
5. **Max Drawdown:** Largest peak-to-trough decline
6. **Risk/Reward Ratio:** Average winner / Average loser

**Target:** Trailing stops should improve at least 3 of these 6 metrics.

---

Ready to test? Start with small positions and track the results! 🚀
