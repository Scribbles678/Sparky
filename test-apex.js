/**
 * Quick test script for Apex DEX via CCXT
 * Tests: ETH/USDT on Apex
 */

require('dotenv').config();
const ExchangeFactory = require('./src/exchanges/ExchangeFactory');

async function test() {
  console.log('🚀 Testing Apex DEX Integration via CCXT...\n');
  
  try {
    // Test 1: Create Apex exchange instance
    console.log('1️⃣ Creating Apex exchange instance...');
    const api = await ExchangeFactory.createExchangeForUser(
      'test-user-id', // Will be replaced with actual user ID from SignalStudio
      'apex'
    );
    
    if (!api) {
      console.log('⚠️  No credentials found. Testing with direct config...');
      
      // Fallback: test with direct config (for testing)
      const api2 = ExchangeFactory.createExchange('apex', {
        apiKey: process.env.APEX_API_KEY || 'test-key',
        apiSecret: process.env.APEX_API_SECRET || 'test-secret',
        environment: 'sandbox', // Start with sandbox
      });
      
      console.log('✅ Apex API created (using test config)\n');
      
      // Test 2: Load markets
      console.log('2️⃣ Loading markets...');
      await api2.loadMarkets();
      console.log('✅ Markets loaded\n');
      
      // Test 3: Get ticker for ETH/USDT
      console.log('3️⃣ Fetching ETH/USDT ticker...');
      try {
        // Try different symbol formats
        const symbols = ['ETH/USDT', 'ETHUSDT', 'ETH/USD:USD'];
        let ticker = null;
        
        for (const sym of symbols) {
          try {
            ticker = await api2.getTicker(sym);
            console.log(`✅ Ticker found for ${sym}:`, ticker);
            break;
          } catch (e) {
            console.log(`   Trying ${sym}... ${e.message}`);
          }
        }
        
        if (!ticker) {
          console.log('⚠️  Could not find ETH/USDT. Listing available markets...');
          const markets = Object.values(api2.exchange.markets)
            .filter(m => m.symbol.includes('ETH') || m.symbol.includes('USDT'))
            .slice(0, 10)
            .map(m => m.symbol);
          console.log('   Available ETH/USDT markets:', markets.join(', '));
        }
      } catch (error) {
        console.log('⚠️  Ticker test failed:', error.message);
      }
      console.log();
      
      // Test 4: Get balance
      console.log('4️⃣ Fetching balance...');
      try {
        const balance = await api2.getBalance();
        console.log('✅ Balance:', balance.length > 0 ? balance : 'No balances found');
      } catch (error) {
        console.log('⚠️  Balance test failed (may need real API keys):', error.message);
      }
      console.log();
      
      // Test 5: Check futures support
      console.log('5️⃣ Checking futures support...');
      try {
        const positions = await api2.getPositions();
        console.log('✅ Positions:', positions.length > 0 ? positions : 'No open positions');
        console.log('   Futures supported:', api2.exchange.has['fetchPositions'] ? 'YES' : 'NO');
      } catch (error) {
        console.log('⚠️  Positions test failed:', error.message);
      }
      
      console.log('\n✅ Basic tests complete!');
      console.log('\n📝 Next steps:');
      console.log('   1. Add Apex API keys in SignalStudio');
      console.log('   2. Test with real credentials');
      console.log('   3. Try placing a small test order');
      
    } else {
      console.log('✅ Apex API created (using user credentials)\n');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();

