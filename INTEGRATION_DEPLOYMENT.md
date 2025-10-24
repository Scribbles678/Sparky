# Sparky-TradeFI Integration Deployment Guide

## 🚨 **CRITICAL INTEGRATION FIXES REQUIRED**

Your Sparky bot and TradeFI dashboard have **schema mismatches** that prevent proper data flow. Follow these steps to fix the integration.

---

## 📋 **DEPLOYMENT CHECKLIST**

### **Step 1: Update Database Schema**

1. **Go to Supabase SQL Editor:**
   - URL: https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
   - Click "SQL Editor"

2. **Run the Schema Update:**
   ```sql
   -- Copy and paste the contents of supabase-schema-updated.sql
   -- This adds asset_class and exchange columns to both tables
   ```

3. **Verify Schema:**
   ```sql
   -- Check that columns exist
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name IN ('trades', 'positions')
     AND column_name IN ('asset_class', 'exchange');
   ```

### **Step 2: Deploy Updated Sparky Bot Code**

1. **Update Sparky Bot Files:**
   - ✅ `src/supabaseClient.js` - Updated to include asset_class and exchange
   - ✅ `src/tradeExecutor.js` - Updated to pass asset_class and exchange
   - ✅ `src/positionUpdater.js` - Updated to include asset_class and exchange

2. **Deploy to VPS:**
   ```bash
   # SSH into your VPS
   ssh root@your-vps-ip
   
   # Navigate to bot directory
   cd /opt/sparky-bot
   
   # Pull latest changes
   git pull origin main
   
   # Install any new dependencies
   npm install
   
   # Restart the bot
   pm2 restart aster-bot
   
   # Check logs
   pm2 logs aster-bot --lines 20
   ```

3. **Verify Bot Startup:**
   Look for these log messages:
   ```
   ✅ Database connection successful
   ✅ Position price updater started (updates every 30s)
   ```

### **Step 3: Test Integration**

1. **Run Integration Test:**
   ```bash
   # On your local machine
   cd c:\Users\mjjoh\Sparky
   node test-integration.js
   ```

2. **Expected Output:**
   ```
   ✅ Database schema is correct
   ✅ Test trade inserted successfully
   ✅ Test position inserted successfully
   ✅ Found X crypto trades
   ✅ Found X open crypto positions
   🎉 Integration test completed successfully!
   ```

### **Step 4: Execute Real Test Trade**

1. **Trigger a Test Trade:**
   ```bash
   # Test webhook (replace with your actual webhook secret)
   curl -X POST http://your-vps-ip:3000/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "secret": "your-webhook-secret",
       "action": "buy",
       "symbol": "BTCUSDT",
       "stopLoss": 2,
       "takeProfit": 4
     }'
   ```

2. **Check Supabase Database:**
   - Go to https://app.supabase.com/project/yfzfdvghkhctzqjtwajy/editor
   - Check `positions` table - should see new position with `asset_class: 'crypto'` and `exchange: 'aster'`

3. **Check TradeFI Dashboard:**
   - Open http://localhost:3001
   - Click "Crypto" filter
   - Should see the new position and trade data

### **Step 5: Verify Complete Integration**

1. **Check Position Updates:**
   - Wait 30 seconds for position updater to run
   - Check Supabase `positions` table - `current_price` and `unrealized_pnl_usd` should update

2. **Check TradeFI Dashboard:**
   - Dashboard should show real-time position updates
   - Crypto filter should display all your trades and P&L

---

## 🔍 **TROUBLESHOOTING**

### **Issue: "Database schema is missing required columns"**
**Solution:** Run the `supabase-schema-updated.sql` script in Supabase SQL Editor

### **Issue: "Error inserting test trade"**
**Solution:** Check that Supabase service role key is correct in Sparky bot `.env` file

### **Issue: "No trades showing in TradeFI dashboard"**
**Solution:** 
1. Verify Supabase anon key is correct in TradeFI `.env`
2. Check that trades have `asset_class: 'crypto'` and `exchange: 'aster'`
3. Run the test script to verify data flow

### **Issue: "Position prices not updating"**
**Solution:**
1. Check Sparky bot logs: `pm2 logs aster-bot`
2. Verify position updater is running
3. Check for API rate limiting

---

## 📊 **EXPECTED RESULTS AFTER FIXES**

### **Sparky Bot:**
- ✅ Logs trades with `asset_class: 'crypto'` and `exchange: 'aster'`
- ✅ Updates position prices every 30 seconds
- ✅ Auto-detects closed positions and logs them

### **TradeFI Dashboard:**
- ✅ "Crypto" filter shows all your trades and P&L
- ✅ Real-time position updates
- ✅ Recent trades display correctly
- ✅ P&L calculations accurate

### **Data Flow:**
```
TradingView Alert → Sparky Bot → Supabase Database → TradeFI Dashboard
```

---

## 🎯 **SUCCESS CRITERIA**

After completing all steps, you should have:

1. **Working Trade Logging:** All Sparky trades appear in TradeFI dashboard
2. **Real-time Updates:** Position prices update every 30 seconds
3. **Proper Filtering:** Crypto filter shows all your crypto trades and P&L
4. **Complete Integration:** Seamless data flow from Sparky to TradeFI

---

**Last Updated:** October 20, 2025  
**Status:** Ready for Deployment ✅

**Remember:** Test with small amounts first to verify everything works correctly!
