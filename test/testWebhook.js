/**
 * Test script for TradingView webhook
 * Run with: node test/testWebhook.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_SECRET = 'your-webhook-secret'; // Change this to match your config

// Test payloads
const testCases = {
  buySignal: {
    secret: WEBHOOK_SECRET,
    action: 'buy',
    symbol: 'BTCUSDT',
    order_type: 'market',
    stop_loss_percent: 2.0,
    take_profit_percent: 5.0,
    price: 45000,
  },
  sellSignal: {
    secret: WEBHOOK_SECRET,
    action: 'sell',
    symbol: 'ETHUSDT',
    order_type: 'market',
    stop_loss_percent: 2.5,
    take_profit_percent: 6.0,
    price: 2500,
  },
  closeSignal: {
    secret: WEBHOOK_SECRET,
    action: 'close',
    symbol: 'BTCUSDT',
  },
  invalidSecret: {
    secret: 'wrong-secret',
    action: 'buy',
    symbol: 'BTCUSDT',
    price: 45000,
  },
  missingFields: {
    secret: WEBHOOK_SECRET,
    action: 'buy',
    // Missing symbol and price
  },
};

async function testWebhook(testName, payload) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testName}`);
  console.log(`${'='.repeat(60)}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(`${BASE_URL}/webhook`, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      validateStatus: () => true, // Don't throw on any status
    });

    console.log(`\nStatus: ${response.status}`);
    console.log('Response:', JSON.stringify(response.data, null, 2));

    if (response.status === 200) {
      console.log('✅ Test passed');
    } else {
      console.log('⚠️  Expected error response');
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

async function testHealthCheck() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing: Health Check');
  console.log(`${'='.repeat(60)}`);

  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('✅ Health check passed');
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

async function testGetPositions() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing: Get Positions');
  console.log(`${'='.repeat(60)}`);

  try {
    const response = await axios.get(`${BASE_URL}/positions`);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('✅ Get positions passed');
  } catch (error) {
    console.error('❌ Get positions failed:', error.message);
  }
}

async function runTests() {
  console.log('\n🚀 Starting Webhook Tests');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Make sure the bot is running (npm start or npm run dev)\n`);

  // Wait a moment for user to read
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test health check first
  await testHealthCheck();

  // Test get positions
  await testGetPositions();

  // Test valid buy signal
  await testWebhook('Valid BUY Signal', testCases.buySignal);

  // Small delay between tests
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test valid sell signal
  await testWebhook('Valid SELL Signal', testCases.sellSignal);

  // Small delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test close signal
  await testWebhook('Close Position Signal', testCases.closeSignal);

  // Test error cases
  await testWebhook('Invalid Secret (should fail)', testCases.invalidSecret);
  await testWebhook('Missing Fields (should fail)', testCases.missingFields);

  console.log(`\n${'='.repeat(60)}`);
  console.log('Tests completed!');
  console.log(`${'='.repeat(60)}\n`);
}

// Run the tests
runTests().catch(console.error);

