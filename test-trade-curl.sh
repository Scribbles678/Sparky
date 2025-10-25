#!/bin/bash

# Test Trade Webhook - Curl Version
# Replace the values below with your actual VPS details

VPS_IP="your-vps-ip"  # Replace with your actual VPS IP
WEBHOOK_SECRET="your-webhook-secret"  # Replace with your actual webhook secret

echo "🚀 Sending test trade webhook to Sparky bot..."
echo "📊 Trade: BTCUSDT BUY with 2% SL, 3% TP"

curl -X POST "http://${VPS_IP}:3000/webhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"secret\": \"${WEBHOOK_SECRET}\",
    \"action\": \"buy\",
    \"symbol\": \"BTCUSDT\",
    \"stop_loss_percent\": 2.0,
    \"take_profit_percent\": 3.0,
    \"position_size\": 100
  }"

echo ""
echo "✅ Test trade webhook sent!"
echo "🔍 Check your Supabase database in a few seconds..."
echo "📊 Run this query in Supabase to check:"
echo "SELECT * FROM trades ORDER BY created_at DESC LIMIT 5;"
