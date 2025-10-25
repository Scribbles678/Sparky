/**
 * Test Trade Webhook
 * This will send a test webhook to your Sparky bot to create a trade
 */

const https = require('https');

// Configuration - Update these values
const SPARKY_BOT_URL = 'http://your-vps-ip:3000'; // Replace with your actual VPS IP
const WEBHOOK_SECRET = 'your-webhook-secret'; // Replace with your actual webhook secret

// Test trade data
const testTrade = {
  secret: WEBHOOK_SECRET,
  action: 'buy',
  symbol: 'BTCUSDT',
  stop_loss_percent: 2.0,
  take_profit_percent: 3.0,
  position_size: 100
};

// Function to send webhook
function sendTestWebhook() {
  const postData = JSON.stringify(testTrade);
  
  const options = {
    hostname: 'your-vps-ip', // Replace with your actual VPS IP
    port: 3000,
    path: '/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log('🚀 Sending test trade webhook...');
  console.log('📊 Trade Details:', testTrade);
  
  const req = https.request(options, (res) => {
    console.log(`📡 Response Status: ${res.statusCode}`);
    console.log(`📡 Response Headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('📋 Response Body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Test trade webhook sent successfully!');
        console.log('🔍 Check your Supabase database in a few seconds...');
      } else {
        console.log('❌ Test trade webhook failed!');
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ Error sending webhook:', e.message);
  });

  req.write(postData);
  req.end();
}

// Run the test
sendTestWebhook();
