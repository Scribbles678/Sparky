/**
 * Test script for Lighter DEX integration
 * Run with: node test/testLighterIntegration.js
 */

const LighterAPI = require('../src/exchanges/lighterApi');
const ExchangeFactory = require('../src/exchanges/ExchangeFactory');

// Test configuration
const testConfig = {
  lighter: {
    apiKey: 'test-api-key',
    privateKey: 'test-private-key',
    accountIndex: 0,
    apiKeyIndex: 2,
    baseUrl: 'https://testnet.zklighter.elliot.ai',
    tradeAmount: 100
  }
};

async function testLighterIntegration() {
  console.log('🧪 Testing Lighter DEX Integration...\n');

  try {
    // Test 1: Create Lighter API instance
    console.log('1. Testing LighterAPI instantiation...');
    const lighterApi = new LighterAPI(
      testConfig.lighter.apiKey,
      testConfig.lighter.privateKey,
      testConfig.lighter.accountIndex,
      testConfig.lighter.apiKeyIndex,
      testConfig.lighter.baseUrl
    );
    console.log('✅ LighterAPI created successfully');
    console.log(`   Exchange: ${lighterApi.exchangeName}`);
    console.log(`   Base URL: ${lighterApi.baseUrl}\n`);

    // Test 2: Test ExchangeFactory integration
    console.log('2. Testing ExchangeFactory integration...');
    const exchanges = ExchangeFactory.createAllExchanges(testConfig);
    
    if (exchanges.lighter) {
      console.log('✅ Lighter exchange created via ExchangeFactory');
      console.log(`   Available exchanges: ${Object.keys(exchanges).join(', ')}\n`);
    } else {
      console.log('❌ Lighter exchange not created via ExchangeFactory\n');
    }

    // Test 3: Test supported exchanges
    console.log('3. Testing supported exchanges...');
    const supportedExchanges = ExchangeFactory.getSupportedExchanges();
    console.log(`✅ Supported exchanges: ${supportedExchanges.join(', ')}`);
    
    if (supportedExchanges.includes('lighter')) {
      console.log('✅ Lighter is in supported exchanges list\n');
    } else {
      console.log('❌ Lighter not in supported exchanges list\n');
    }

    // Test 4: Test API method signatures
    console.log('4. Testing API method signatures...');
    const requiredMethods = [
      'getBalance',
      'getAvailableMargin',
      'getPositions',
      'getPosition',
      'hasOpenPosition',
      'getTicker',
      'placeMarketOrder',
      'placeLimitOrder',
      'placeStopLoss',
      'placeTakeProfit',
      'closePosition',
      'cancelOrder',
      'getOrder'
    ];

    let allMethodsExist = true;
    requiredMethods.forEach(method => {
      if (typeof lighterApi[method] === 'function') {
        console.log(`   ✅ ${method}() exists`);
      } else {
        console.log(`   ❌ ${method}() missing`);
        allMethodsExist = false;
      }
    });

    if (allMethodsExist) {
      console.log('✅ All required methods implemented\n');
    } else {
      console.log('❌ Some required methods missing\n');
    }

    // Test 5: Test configuration validation
    console.log('5. Testing configuration validation...');
    
    // Test valid configuration
    try {
      const validConfig = {
        apiKey: 'test-api-key',
        privateKey: 'test-private-key',
        accountIndex: 0
      };
      ExchangeFactory.createExchange('lighter', validConfig);
      console.log('✅ Valid configuration accepted');
    } catch (error) {
      console.log(`❌ Valid configuration rejected: ${error.message}`);
    }

    // Test invalid configuration (missing required fields)
    try {
      ExchangeFactory.createExchange('lighter', { apiKey: 'test' });
      console.log('❌ Invalid configuration accepted (should have failed)');
    } catch (error) {
      console.log('✅ Invalid configuration properly rejected');
    }

    console.log('\n🎉 Lighter DEX integration test completed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Get real Lighter API credentials');
    console.log('2. Update config.json with your credentials');
    console.log('3. Test with a small trade amount');
    console.log('4. Monitor logs for any issues');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testLighterIntegration();
}

module.exports = { testLighterIntegration };
