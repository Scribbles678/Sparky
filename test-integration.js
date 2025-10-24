/**
 * Sparky-TradeFI Integration Test Script
 * Tests the complete flow from Sparky bot to TradeFI dashboard
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://yfzfdvghkhctzqjtwajy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testIntegration() {
  console.log('🧪 Testing Sparky-TradeFI Integration...\n');

  try {
    // Test 1: Database Schema Check
    console.log('1️⃣ Testing Database Schema...');
    
    const { data: tradesColumns, error: tradesError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'trades')
      .in('column_name', ['asset_class', 'exchange']);

    if (tradesError) {
      console.error('❌ Error checking trades table schema:', tradesError);
      return;
    }

    const hasAssetClass = tradesColumns.some(col => col.column_name === 'asset_class');
    const hasExchange = tradesColumns.some(col => col.column_name === 'exchange');

    if (hasAssetClass && hasExchange) {
      console.log('✅ Database schema is correct (asset_class and exchange columns exist)');
    } else {
      console.log('❌ Database schema is missing required columns');
      console.log('   Run the supabase-schema-updated.sql script first');
      return;
    }

    // Test 2: Insert Test Trade
    console.log('\n2️⃣ Testing Trade Insertion...');
    
    const testTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      asset_class: 'crypto',
      exchange: 'aster',
      entry_price: 95000,
      entry_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      exit_price: 96000,
      exit_time: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
      quantity: 0.001,
      position_size_usd: 100,
      pnl_usd: 1.0,
      pnl_percent: 1.0,
      is_winner: true,
      exit_reason: 'TAKE_PROFIT',
      order_id: 'test_order_123',
      notes: 'Integration test trade'
    };

    const { data: insertedTrade, error: insertError } = await supabase
      .from('trades')
      .insert([testTrade])
      .select();

    if (insertError) {
      console.error('❌ Error inserting test trade:', insertError);
      return;
    }

    console.log('✅ Test trade inserted successfully:', insertedTrade[0].id);

    // Test 3: Insert Test Position
    console.log('\n3️⃣ Testing Position Insertion...');
    
    const testPosition = {
      symbol: 'ETHUSDT',
      side: 'SELL',
      asset_class: 'crypto,
      exchange: 'aster',
      entry_price: 3500,
      entry_time: new Date().toISOString(),
      quantity: 0.0286,
      position_size_usd: 100,
      current_price: 3450,
      unrealized_pnl_usd: -1.43,
      unrealized_pnl_percent: -1.43,
      last_price_update: new Date().toISOString()
    };

    const { data: insertedPosition, error: positionError } = await supabase
      .from('positions')
      .upsert([testPosition], { onConflict: 'symbol' })
      .select();

    if (positionError) {
      console.error('❌ Error inserting test position:', positionError);
      return;
    }

    console.log('✅ Test position inserted successfully:', insertedPosition[0].symbol);

    // Test 4: Query Test (TradeFI Dashboard Simulation)
    console.log('\n4️⃣ Testing TradeFI Dashboard Queries...');
    
    // Test crypto filter query
    const { data: cryptoTrades, error: cryptoError } = await supabase
      .from('trades')
      .select('*')
      .eq('asset_class', 'crypto')
      .order('exit_time', { ascending: false })
      .limit(10);

    if (cryptoError) {
      console.error('❌ Error querying crypto trades:', cryptoError);
      return;
    }

    console.log(`✅ Found ${cryptoTrades.length} crypto trades`);

    // Test positions query
    const { data: openPositions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('asset_class', 'crypto')
      .order('created_at', { ascending: false });

    if (positionsError) {
      console.error('❌ Error querying positions:', positionsError);
      return;
    }

    console.log(`✅ Found ${openPositions.length} open crypto positions`);

    // Test 5: Cleanup Test Data
    console.log('\n5️⃣ Cleaning up test data...');
    
    // Delete test trade
    const { error: deleteTradeError } = await supabase
      .from('trades')
      .delete()
      .eq('order_id', 'test_order_123');

    if (deleteTradeError) {
      console.error('❌ Error deleting test trade:', deleteTradeError);
    } else {
      console.log('✅ Test trade deleted');
    }

    // Delete test position
    const { error: deletePositionError } = await supabase
      .from('positions')
      .delete()
      .eq('symbol', 'ETHUSDT');

    if (deletePositionError) {
      console.error('❌ Error deleting test position:', deletePositionError);
    } else {
      console.log('✅ Test position deleted');
    }

    console.log('\n🎉 Integration test completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('1. Deploy updated Sparky bot code to your VPS');
    console.log('2. Restart Sparky bot: pm2 restart aster-bot');
    console.log('3. Execute a test trade to verify integration');
    console.log('4. Check TradeFI dashboard for the trade data');

  } catch (error) {
    console.error('❌ Integration test failed:', error);
  }
}

// Run the test
testIntegration();
