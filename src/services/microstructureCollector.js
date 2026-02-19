/**
 * Microstructure Data Collector
 * 
 * Subscribes to Aster WebSocket depth and aggTrade streams for crypto symbols,
 * maintains in-memory ring buffers of order book snapshots and trades.
 * Arthur's pattern scanner fetches this data on-demand via HTTP API.
 * 
 * Data shapes match Arthur's microstructure.py dataclasses:
 *   - OrderBookSnapshot: { timestamp, bid_price, bid_volume, ask_price, ask_volume, bids, asks }
 *   - Trade: { timestamp, price, volume, side }
 * 
 * @see Arthur/ml_service/sde/microstructure.py
 */

const logger = require('../utils/logger');

// Ring buffer sizes
const MAX_ORDERBOOK_SNAPSHOTS = 200;  // ~100s at 500ms updates
const MAX_TRADES = 500;

// Symbols to track — must match pattern scanner's active crypto symbols.
// Expand when CRYPTO_TESTNET_MODE is disabled and more symbols go live.
const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
];

/**
 * Simple ring buffer (circular array) for fixed-size storage
 */
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = [];
    this.writeIndex = 0;
    this.full = false;
  }

  push(item) {
    if (this.full) {
      this.buffer[this.writeIndex] = item;
    } else {
      this.buffer.push(item);
    }
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (!this.full && this.buffer.length >= this.capacity) {
      this.full = true;
    }
  }

  /** Return all items in chronological order */
  toArray() {
    if (!this.full) {
      return [...this.buffer];
    }
    // writeIndex points to the oldest entry
    return [
      ...this.buffer.slice(this.writeIndex),
      ...this.buffer.slice(0, this.writeIndex),
    ];
  }

  get size() {
    return this.buffer.length;
  }

  clear() {
    this.buffer = [];
    this.writeIndex = 0;
    this.full = false;
  }
}

class MicrostructureCollector {
  /**
   * @param {AsterWebSocket} asterWs - Existing Aster WebSocket instance
   * @param {object} [options]
   * @param {string[]} [options.symbols] - Symbols to track
   * @param {number} [options.maxSnapshots] - Max order book snapshots per symbol
   * @param {number} [options.maxTrades] - Max trades per symbol
   */
  constructor(asterWs, options = {}) {
    this.asterWs = asterWs;
    this.symbols = (options.symbols || DEFAULT_SYMBOLS).map(s => s.toUpperCase());
    this.maxSnapshots = options.maxSnapshots || MAX_ORDERBOOK_SNAPSHOTS;
    this.maxTrades = options.maxTrades || MAX_TRADES;

    // Per-symbol ring buffers
    // Map<symbol, { orderbooks: RingBuffer, trades: RingBuffer, startedAt: Date }>
    this.caches = new Map();

    // Stats
    this.stats = {
      depthUpdates: 0,
      tradeUpdates: 0,
      startTime: null,
      subscribedSymbols: 0,
    };

    this._depthHandler = null;
    this._tradeHandler = null;
    this._started = false;
  }

  /**
   * Start collecting data for configured symbols
   */
  async start() {
    if (this._started) {
      logger.warn('MicrostructureCollector already started');
      return;
    }

    if (!this.asterWs) {
      logger.warn('MicrostructureCollector: No Aster WebSocket available, skipping');
      return;
    }

    logger.info(`📊 MicrostructureCollector starting for ${this.symbols.length} symbols...`);
    this.stats.startTime = new Date();
    this._started = true;

    // Initialize caches for each symbol
    for (const symbol of this.symbols) {
      this.caches.set(symbol, {
        orderbooks: new RingBuffer(this.maxSnapshots),
        trades: new RingBuffer(this.maxTrades),
        startedAt: new Date(),
        lastDepthUpdate: null,
        lastTradeUpdate: null,
      });
    }

    // Attach event handlers
    this._depthHandler = (data) => this._handleDepth(data);
    this._tradeHandler = (data) => this._handleTrade(data);

    this.asterWs.on('depth', this._depthHandler);
    this.asterWs.on('trade', this._tradeHandler);

    // Subscribe to depth (10 levels, 500ms) and aggTrade for all symbols
    try {
      await this.asterWs.subscribePartialDepth(this.symbols, 10, '500ms');
      await this.asterWs.subscribeTrades(this.symbols);
      this.stats.subscribedSymbols = this.symbols.length;
      logger.info(`✅ MicrostructureCollector subscribed: ${this.symbols.length} symbols (depth10@500ms + aggTrade)`);
    } catch (error) {
      logger.warn(`⚠️ MicrostructureCollector subscription error: ${error.message}`);
      // Still keep handlers attached -- streams may come online after reconnect
    }
  }

  /**
   * Stop collecting and clean up
   */
  stop() {
    if (!this._started) return;

    logger.info('📊 MicrostructureCollector stopping...');
    
    if (this.asterWs && this._depthHandler) {
      this.asterWs.removeListener('depth', this._depthHandler);
    }
    if (this.asterWs && this._tradeHandler) {
      this.asterWs.removeListener('trade', this._tradeHandler);
    }

    this._depthHandler = null;
    this._tradeHandler = null;
    this._started = false;

    // Keep caches -- they'll be cleared on restart
    logger.info('✅ MicrostructureCollector stopped');
  }

  /**
   * Handle depth (order book) update from WebSocket
   * @private
   */
  _handleDepth(data) {
    const symbol = data.symbol;
    const cache = this.caches.get(symbol);
    if (!cache) return; // Not a tracked symbol

    this.stats.depthUpdates++;

    // Convert to Arthur's OrderBookSnapshot format
    const snapshot = {
      timestamp: new Date(data.eventTime || Date.now()).toISOString(),
      bid_price: data.bids.length > 0 ? data.bids[0].price : 0,
      bid_volume: data.bids.length > 0 ? data.bids[0].quantity : 0,
      ask_price: data.asks.length > 0 ? data.asks[0].price : 0,
      ask_volume: data.asks.length > 0 ? data.asks[0].quantity : 0,
      bids: data.bids.map(b => [b.price, b.quantity]),   // [(price, volume), ...]
      asks: data.asks.map(a => [a.price, a.quantity]),
    };

    cache.orderbooks.push(snapshot);
    cache.lastDepthUpdate = Date.now();
  }

  /**
   * Handle aggTrade update from WebSocket
   * @private
   */
  _handleTrade(data) {
    const symbol = data.symbol;
    const cache = this.caches.get(symbol);
    if (!cache) return;

    this.stats.tradeUpdates++;

    // Convert to Arthur's Trade format
    const trade = {
      timestamp: new Date(data.tradeTime || Date.now()).toISOString(),
      price: data.price,
      volume: data.quantity,
      side: data.side,  // 'buy' or 'sell'
    };

    cache.trades.push(trade);
    cache.lastTradeUpdate = Date.now();
  }

  /**
   * Get cached microstructure data for a symbol
   * @param {string} symbol - e.g., 'BTCUSDT'
   * @returns {object|null} { orderbook_snapshots, trades, symbol, cached_since, snapshot_count, trade_count }
   */
  getData(symbol) {
    const normalizedSymbol = symbol.toUpperCase().replace('/', '');
    const cache = this.caches.get(normalizedSymbol);

    if (!cache) {
      return null;
    }

    return {
      symbol: normalizedSymbol,
      orderbook_snapshots: cache.orderbooks.toArray(),
      trades: cache.trades.toArray(),
      cached_since: cache.startedAt.toISOString(),
      snapshot_count: cache.orderbooks.size,
      trade_count: cache.trades.size,
      last_depth_update: cache.lastDepthUpdate ? new Date(cache.lastDepthUpdate).toISOString() : null,
      last_trade_update: cache.lastTradeUpdate ? new Date(cache.lastTradeUpdate).toISOString() : null,
    };
  }

  /**
   * Get status/health information for the collector
   * @returns {object}
   */
  getStatus() {
    const symbolsStatus = {};
    for (const [symbol, cache] of this.caches.entries()) {
      symbolsStatus[symbol] = {
        snapshots: cache.orderbooks.size,
        trades: cache.trades.size,
        last_depth_age_s: cache.lastDepthUpdate ? Math.round((Date.now() - cache.lastDepthUpdate) / 1000) : null,
        last_trade_age_s: cache.lastTradeUpdate ? Math.round((Date.now() - cache.lastTradeUpdate) / 1000) : null,
      };
    }

    return {
      running: this._started,
      uptime_s: this.stats.startTime ? Math.round((Date.now() - this.stats.startTime.getTime()) / 1000) : 0,
      subscribed_symbols: this.stats.subscribedSymbols,
      total_depth_updates: this.stats.depthUpdates,
      total_trade_updates: this.stats.tradeUpdates,
      symbols: symbolsStatus,
    };
  }

  /**
   * List all tracked symbols
   * @returns {string[]}
   */
  getTrackedSymbols() {
    return [...this.caches.keys()];
  }
}

module.exports = MicrostructureCollector;
