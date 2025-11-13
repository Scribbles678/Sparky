/**
 * Test script for Hyperliquid integration
 * Tests the HyperliquidAPI class and ExchangeFactory integration
 */

const { HyperliquidAPI } = require('../src/exchanges/hyperliquidApi');
const ExchangeFactory = require('../src/exchanges/ExchangeFactory');

async function testHyperliquidIntegration() {
  console.log('🧪 Testing Hyperliquid Integration...\n');

  try {
    // Test 1: HyperliquidAPI instantiation
    console.log('1️⃣ Testing HyperliquidAPI instantiation...');
    
    // Mock configuration for testing
    const mockConfig = {
      apiKey: '0x1234567890abcdef1234567890abcdef12345678',
      privateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      baseUrl: 'https://api.hyperliquid-testnet.xyz',
      isTestnet: true
    };

    const hyperliquidAPI = new HyperliquidAPI(
      mockConfig.apiKey,
      mockConfig.privateKey,
      mockConfig.baseUrl,
      mockConfig.isTestnet
    );

    console.log('✅ HyperliquidAPI instantiated successfully');
    console.log(`   - API Key: ${mockConfig.apiKey.substring(0, 10)}...`);
    console.log(`   - Base URL: ${mockConfig.baseUrl}`);
    console.log(`   - Testnet: ${mockConfig.isTestnet}\n`);

    // Test 2: ExchangeFactory integration
    console.log('2️⃣ Testing ExchangeFactory integration...');
    
    const testConfig = {
      hyperliquid: {
        apiKey: mockConfig.apiKey,
        privateKey: mockConfig.privateKey,
        baseUrl: mockConfig.baseUrl,
        isTestnet: mockConfig.isTestnet,
        tradeAmount: 100
      }
    };

    const exchange = ExchangeFactory.createExchange('hyperliquid', testConfig.hyperliquid);
    console.log('✅ ExchangeFactory created Hyperliquid instance successfully\n');

    // Test 3: Check supported exchanges
    console.log('3️⃣ Testing supported exchanges list...');
    const supportedExchanges = ExchangeFactory.getSupportedExchanges();
    console.log('✅ Supported exchanges:', supportedExchanges);
    
    if (supportedExchanges.includes('hyperliquid')) {
      console.log('✅ Hyperliquid is included in supported exchanges\n');
    } else {
      console.log('❌ Hyperliquid is NOT included in supported exchanges\n');
    }

    // Test 4: Check required methods exist
    console.log('4️⃣ Testing required API methods...');
    
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

    const missingMethods = requiredMethods.filter(method => 
      typeof exchange[method] !== 'function'
    );

    if (missingMethods.length === 0) {
      console.log('✅ All required methods are implemented');
    } else {
      console.log('❌ Missing methods:', missingMethods);
    }

    // Test 5: Check Hyperliquid-specific methods
    console.log('\n5️⃣ Testing Hyperliquid-specific methods...');
    
    const hyperliquidMethods = [
      'getAssetId',
      'getAssetInfo',
      'roundPrice',
      'roundSize',
      'generateSignature',
      'makeExchangeRequest',
      'makeInfoRequest',
      'getSupportedSymbols',
      'getAssetMetadata'
    ];

    const missingHyperliquidMethods = hyperliquidMethods.filter(method => 
      typeof exchange[method] !== 'function'
    );

    if (missingHyperliquidMethods.length === 0) {
      console.log('✅ All Hyperliquid-specific methods are implemented');
    } else {
      console.log('❌ Missing Hyperliquid methods:', missingHyperliquidMethods);
    }

    // Test 6: Test configuration validation
    console.log('\n6️⃣ Testing configuration validation...');
    
    try {
      ExchangeFactory.createExchange('hyperliquid', { apiKey: 'test' });
      console.log('❌ Should have failed with missing privateKey');
    } catch (error) {
      if (error.message.includes('privateKey')) {
        console.log('✅ Correctly validates missing privateKey');
      } else {
        console.log('❌ Wrong validation error:', error.message);
      }
    }

    try {
      ExchangeFactory.createExchange('hyperliquid', { privateKey: 'test' });
      console.log('❌ Should have failed with missing apiKey');
    } catch (error) {
      if (error.message.includes('apiKey')) {
        console.log('✅ Correctly validates missing apiKey');
      } else {
        console.log('❌ Wrong validation error:', error.message);
      }
    }

    console.log('\n🎉 All Hyperliquid integration tests completed!');
    console.log('\n📋 Next steps:');
    console.log('   1. Add your Hyperliquid API credentials to config.json');
    console.log('   2. Test with real API calls (be careful with testnet first)');
    console.log('   3. Update TradingView alerts to include exchange: "hyperliquid"');
    console.log('   4. Test webhook integration with real trades');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the tests
if (require.main === module) {
  testHyperliquidIntegration();
}

module.exports = { testHyperliquidIntegration };
