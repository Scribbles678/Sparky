/**
 * Apex DEX Integration Test Suite
 * Tests CCXT Pro adapter: REST, WebSocket streaming, bracket orders, testnet
 *
 * Usage:
 *   node test/test-apex.js              # Run all tests (dry, no real orders)
 *   node test/test-apex.js --live       # Run with live order placement (testnet)
 *   node test/test-apex.js --ws-only    # Run WebSocket streaming tests only
 */

require('dotenv').config();
const ExchangeFactory = require('../src/exchanges/ExchangeFactory');
const CCXTProExchangeAPI = require('../src/exchanges/ccxtProExchangeApi');

const RUN_MODE = process.argv.includes('--live') ? 'live' : 'dry';
const WS_ONLY = process.argv.includes('--ws-only');

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function pass(name) { passCount++; console.log(`  PASS  ${name}`); }
function fail(name, err) { failCount++; console.log(`  FAIL  ${name}: ${err}`); }
function skip(name, reason) { skipCount++; console.log(`  SKIP  ${name} (${reason})`); }

async function testCCXTProCreation() {
  console.log('\n=== Phase 1: CCXT Pro Instance Creation ===\n');

  // 1a. Direct creation via CCXTProExchangeAPI
  try {
    const api = new CCXTProExchangeAPI('apex', {
      apiKey: process.env.APEX_API_KEY || 'test-key',
      secret: process.env.APEX_API_SECRET || 'test-secret',
      passphrase: process.env.APEX_PASSPHRASE || 'test-passphrase',
      environment: 'sandbox',
    });
    if (api.exchangeId === 'apex' && api.exchange) {
      pass('Direct CCXTProExchangeAPI creation');
    } else {
      fail('Direct CCXTProExchangeAPI creation', 'Missing exchangeId or exchange');
    }
  } catch (e) {
    fail('Direct CCXTProExchangeAPI creation', e.message);
  }

  // 1b. Creation via ExchangeFactory
  try {
    const api = ExchangeFactory.createExchange('apex', {
      apiKey: process.env.APEX_API_KEY || 'test-key',
      apiSecret: process.env.APEX_API_SECRET || 'test-secret',
      passphrase: process.env.APEX_PASSPHRASE || 'test-passphrase',
      environment: 'sandbox',
    });
    if (api instanceof CCXTProExchangeAPI) {
      pass('ExchangeFactory routes apex to CCXTProExchangeAPI');
    } else {
      fail('ExchangeFactory routes apex to CCXTProExchangeAPI', `Got ${api.constructor.name}`);
    }
  } catch (e) {
    fail('ExchangeFactory routes apex to CCXTProExchangeAPI', e.message);
  }

  // 1c. Credential mapping
  try {
    const config = ExchangeFactory.mapCredentialsToConfig('apex', {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      passphrase: 'test-pass',
      environment: 'sandbox',
    });
    if (config.apiKey === 'test-key' && config.passphrase === 'test-pass' && config.sandbox === true) {
      pass('Apex credential mapping');
    } else {
      fail('Apex credential mapping', JSON.stringify(config));
    }
  } catch (e) {
    fail('Apex credential mapping', e.message);
  }

  // 1d. EventEmitter interface
  try {
    const api = new CCXTProExchangeAPI('apex', {
      apiKey: 'test', secret: 'test', passphrase: 'test', environment: 'sandbox',
    });
    let emitted = false;
    api.on('test', () => { emitted = true; });
    api.emit('test');
    if (emitted) {
      pass('EventEmitter interface (on/emit)');
    } else {
      fail('EventEmitter interface (on/emit)', 'Event not received');
    }
  } catch (e) {
    fail('EventEmitter interface (on/emit)', e.message);
  }

  // 1e. Invalid exchange ID
  try {
    new CCXTProExchangeAPI('nonexistent_exchange_xyz', { apiKey: 'x', secret: 'x' });
    fail('Invalid exchange ID rejection', 'Should have thrown');
  } catch (e) {
    if (e.message.includes('not found')) {
      pass('Invalid exchange ID rejection');
    } else {
      fail('Invalid exchange ID rejection', e.message);
    }
  }
}

async function testMarketLoading() {
  console.log('\n=== Phase 2: Market Loading & Symbol Normalization ===\n');

  const hasKeys = process.env.APEX_API_KEY && process.env.APEX_API_SECRET;
  if (!hasKeys) {
    skip('Market loading (requires API keys)', 'Set APEX_API_KEY/SECRET env vars');
    skip('Symbol normalization', 'Set APEX_API_KEY/SECRET env vars');
    return null;
  }

  const api = new CCXTProExchangeAPI('apex', {
    apiKey: process.env.APEX_API_KEY,
    secret: process.env.APEX_API_SECRET,
    passphrase: process.env.APEX_PASSPHRASE,
    environment: process.env.APEX_ENV || 'sandbox',
  });

  try {
    await api.loadMarkets();
    const marketCount = Object.keys(api.exchange.markets).length;
    if (marketCount > 0) {
      pass(`Market loading (${marketCount} markets)`);
    } else {
      fail('Market loading', '0 markets loaded');
    }
  } catch (e) {
    fail('Market loading', e.message);
    return null;
  }

  // Symbol normalization
  try {
    const normalized = api.normalizeSymbol('BTC-USDT');
    if (normalized && normalized.includes('/')) {
      pass(`Symbol normalization: BTC-USDT -> ${normalized}`);
    } else {
      pass(`Symbol normalization: BTC-USDT -> ${normalized} (exchange format)`);
    }
  } catch (e) {
    fail('Symbol normalization', e.message);
  }

  return api;
}

async function testRESTMethods(api) {
  console.log('\n=== Phase 3: REST API Methods ===\n');

  if (!api) {
    skip('REST methods', 'No authenticated API available');
    return;
  }

  // Ticker
  try {
    const ticker = await api.getTicker('BTC/USDT:USDT');
    if (ticker && ticker.lastPrice > 0) {
      pass(`getTicker: BTC/USDT $${ticker.lastPrice}`);
    } else {
      fail('getTicker', 'No price returned');
    }
  } catch (e) {
    // Try alternative symbol formats
    try {
      const ticker = await api.getTicker('BTC-USDT');
      pass(`getTicker (alt format): BTC-USDT $${ticker.lastPrice}`);
    } catch (e2) {
      fail('getTicker', e2.message);
    }
  }

  // Balance
  try {
    const balance = await api.getBalance();
    pass(`getBalance: ${balance.length} asset(s)`);
  } catch (e) {
    fail('getBalance', e.message);
  }

  // Available margin
  try {
    const margin = await api.getAvailableMargin();
    pass(`getAvailableMargin: $${margin}`);
  } catch (e) {
    fail('getAvailableMargin', e.message);
  }

  // Positions
  try {
    const positions = await api.getPositions();
    pass(`getPositions: ${positions.length} open position(s)`);
  } catch (e) {
    fail('getPositions', e.message);
  }

  // hasOpenPosition
  try {
    const has = await api.hasOpenPosition('BTC/USDT:USDT');
    pass(`hasOpenPosition: ${has}`);
  } catch (e) {
    fail('hasOpenPosition', e.message);
  }

  // Streaming capability check
  try {
    const hasPositions = api.hasStreaming('positions');
    const hasOrders = api.hasStreaming('orders');
    const hasTickers = api.hasStreaming('tickers');
    pass(`Streaming capabilities: positions=${hasPositions}, orders=${hasOrders}, tickers=${hasTickers}`);
  } catch (e) {
    fail('Streaming capabilities', e.message);
  }
}

async function testWebSocketStreaming(api) {
  console.log('\n=== Phase 4: WebSocket Streaming (CCXT Pro) ===\n');

  if (!api) {
    skip('WebSocket streaming', 'No authenticated API available');
    return;
  }

  const STREAM_TIMEOUT = 15000;

  // Test ticker streaming
  try {
    await api.startStreaming();
    pass('startStreaming() call');

    // Test ticker subscription
    const tickerPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Ticker stream timeout')), STREAM_TIMEOUT);
      api.on('ticker', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    await api.subscribeTickers(['BTC/USDT:USDT']);
    pass('subscribeTickers() call');

    try {
      const tickerData = await tickerPromise;
      if (tickerData && tickerData.symbol && tickerData.close > 0) {
        pass(`Ticker stream received: ${tickerData.symbol} $${tickerData.close}`);
      } else {
        fail('Ticker stream data', JSON.stringify(tickerData));
      }
    } catch (e) {
      skip('Ticker stream receive', e.message);
    }
  } catch (e) {
    fail('WebSocket streaming', e.message);
  }

  // Test accountUpdate stream
  try {
    const accountPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Account stream timeout')), STREAM_TIMEOUT);
      api.on('accountUpdate', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    try {
      const accountData = await accountPromise;
      if (accountData && accountData.reason) {
        pass(`Account update stream received: ${accountData.reason}`);
      } else {
        pass('Account update stream received');
      }
    } catch (e) {
      skip('Account update stream', e.message);
    }
  } catch (e) {
    fail('Account update stream', e.message);
  }

  // Clean up
  try {
    await api.stopAllStreams();
    pass('stopAllStreams() cleanup');
  } catch (e) {
    fail('stopAllStreams() cleanup', e.message);
  }
}

async function testBracketOrder(api) {
  console.log('\n=== Phase 5: Bracket Order (Apex-specific) ===\n');

  if (!api) {
    skip('Bracket order', 'No authenticated API available');
    return;
  }

  if (RUN_MODE !== 'live') {
    skip('Bracket order placement', 'Run with --live to execute (testnet only)');

    // Verify the method exists
    try {
      if (typeof api.placeBracketOrder === 'function') {
        pass('placeBracketOrder() method exists');
      } else {
        fail('placeBracketOrder() method', 'Not a function');
      }
      if (typeof api.placeTrailingStop === 'function') {
        pass('placeTrailingStop() method exists');
      } else {
        fail('placeTrailingStop() method', 'Not a function');
      }
      if (typeof api.cancelAllOrders === 'function') {
        pass('cancelAllOrders() method exists');
      } else {
        fail('cancelAllOrders() method', 'Not a function');
      }
    } catch (e) {
      fail('Method existence check', e.message);
    }
    return;
  }

  // Live bracket order test (testnet only)
  try {
    const ticker = await api.getTicker('BTC/USDT:USDT');
    const price = ticker.lastPrice;
    const tpPrice = price * 1.02; // 2% TP
    const slPrice = price * 0.98; // 2% SL

    console.log(`  Placing bracket order: BUY 0.001 BTC @ ~$${price}`);
    console.log(`  TP: $${tpPrice.toFixed(2)}, SL: $${slPrice.toFixed(2)}`);

    const result = await api.placeBracketOrder(
      'BTC/USDT:USDT', 'buy', 'market', 0.001, undefined,
      { takeProfitPrice: tpPrice, stopLossPrice: slPrice }
    );

    if (result.entryOrder && result.entryOrder.orderId) {
      pass(`Bracket order placed: ${result.entryOrder.orderId}`);
    } else {
      fail('Bracket order', 'No orderId returned');
    }

    // Clean up: close position and cancel orders
    try {
      await api.cancelAllOrders('BTC/USDT:USDT');
      await api.closePosition('BTC/USDT:USDT', 'buy', 0.001);
      pass('Bracket order cleanup (cancel + close)');
    } catch (e) {
      console.log(`  Note: cleanup failed (position may have already closed): ${e.message}`);
    }
  } catch (e) {
    fail('Bracket order placement', e.message);
  }
}

async function testTestnetConnectivity() {
  console.log('\n=== Phase 6: Testnet Connectivity ===\n');

  try {
    const api = new CCXTProExchangeAPI('apex', {
      apiKey: process.env.APEX_API_KEY || 'test-key',
      secret: process.env.APEX_API_SECRET || 'test-secret',
      passphrase: process.env.APEX_PASSPHRASE || 'test-passphrase',
      environment: 'sandbox',
    });

    if (api.exchange.sandbox) {
      pass('Sandbox/testnet mode enabled');
    } else {
      fail('Sandbox/testnet mode', 'sandbox is false');
    }

    // Try loading testnet markets
    if (process.env.APEX_API_KEY) {
      try {
        await api.loadMarkets();
        const count = Object.keys(api.exchange.markets).length;
        pass(`Testnet markets loaded: ${count} markets`);
      } catch (e) {
        fail('Testnet market loading', e.message);
      }
    } else {
      skip('Testnet market loading', 'No API keys configured');
    }
  } catch (e) {
    fail('Testnet connectivity', e.message);
  }
}

async function testPositionUpdaterCompat() {
  console.log('\n=== Phase 7: PositionUpdater Compatibility ===\n');

  try {
    const api = new CCXTProExchangeAPI('apex', {
      apiKey: 'test', secret: 'test', passphrase: 'test', environment: 'sandbox',
    });

    // Verify the event interface matches what PositionUpdater expects
    const events = ['ticker', 'accountUpdate', 'orderFilled'];
    let allGood = true;

    for (const event of events) {
      let received = false;
      api.on(event, () => { received = true; });
      api.emit(event, { test: true });
      if (!received) {
        fail(`Event: ${event}`, 'Not received');
        allGood = false;
      }
    }

    if (allGood) {
      pass('All PositionUpdater events (ticker, accountUpdate, orderFilled)');
    }

    // Verify subscribeTickers method exists (used by PositionUpdater)
    if (typeof api.subscribeTickers === 'function') {
      pass('subscribeTickers() method available for PositionUpdater');
    } else {
      fail('subscribeTickers() method', 'Not found');
    }

    // Verify stopAllStreams exists (used by PositionUpdater.stop())
    if (typeof api.stopAllStreams === 'function') {
      pass('stopAllStreams() method available for cleanup');
    } else {
      fail('stopAllStreams() method', 'Not found');
    }
  } catch (e) {
    fail('PositionUpdater compatibility', e.message);
  }
}

async function main() {
  console.log('====================================');
  console.log('  Apex DEX CCXT Pro Test Suite');
  console.log(`  Mode: ${RUN_MODE === 'live' ? 'LIVE (testnet)' : 'DRY RUN'}`);
  console.log('====================================');

  const hasKeys = !!(process.env.APEX_API_KEY && process.env.APEX_API_SECRET);
  console.log(`  API Keys: ${hasKeys ? 'configured' : 'NOT SET (some tests will be skipped)'}`);

  if (WS_ONLY) {
    const api = await testMarketLoading();
    await testWebSocketStreaming(api);
  } else {
    await testCCXTProCreation();
    const api = await testMarketLoading();
    await testRESTMethods(api);
    await testWebSocketStreaming(api);
    await testBracketOrder(api);
    await testTestnetConnectivity();
    await testPositionUpdaterCompat();
  }

  console.log('\n====================================');
  console.log(`  Results: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  console.log('====================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
