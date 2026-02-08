/**
 * Aster DEX WebSocket Client
 * 
 * Manages two types of WebSocket connections:
 * 
 * 1. Market Data Streams (public, no auth):
 *    - miniTicker: Real-time price updates (replaces REST getTicker polling)
 *    - depth: Order book updates (feeds microstructure features)
 *    - aggTrade: Aggregate trade stream (feeds pattern recognition)
 *    - kline: Real-time candle updates
 *    - markPrice: Mark price + funding rate countdown
 * 
 * 2. User Data Stream (authenticated via listenKey):
 *    - ACCOUNT_UPDATE: Balance/position changes (instant)
 *    - ORDER_TRADE_UPDATE: Order fills, cancellations
 *    - MARGIN_CALL: Margin warnings
 *    - ACCOUNT_CONFIG_UPDATE: Leverage changes
 * 
 * Features:
 *    - Auto-reconnect with exponential backoff (1s → 30s max)
 *    - Listen key keepalive every 25 minutes (expires at 60 min)
 *    - Heartbeat monitoring (detects stale connections)
 *    - Event emitter pattern for clean component decoupling
 *    - Multi-stream via combined stream URL
 *    - Graceful shutdown with cleanup
 * 
 * @see https://github.com/asterdex/api-docs/blob/master/aster-finance-futures-api-v3.md#websocket-market-streams
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const logger = require('../utils/logger');

// Default WebSocket URLs
const WS_URLS = {
  production: 'wss://fstream.asterdex.com',
  testnet: 'wss://fstream.asterdex-testnet.com',
};

// Reconnection config
const RECONNECT_MIN_DELAY = 1000;    // 1 second
const RECONNECT_MAX_DELAY = 30000;   // 30 seconds
const RECONNECT_BACKOFF = 2;         // Exponential backoff multiplier

// Keepalive config
const LISTEN_KEY_KEEPALIVE_MS = 25 * 60 * 1000;  // 25 minutes (key expires at 60 min)
const HEARTBEAT_TIMEOUT_MS = 60000;               // 60 seconds without message = stale

class AsterWebSocket extends EventEmitter {
  /**
   * @param {object} config
   * @param {object} config.restApi - AsterAPIV3 instance (for listenKey management)
   * @param {string} [config.environment='production'] - 'production' or 'testnet'
   * @param {string} [config.wsUrl] - Custom WebSocket URL override
   */
  constructor(config) {
    super();
    this.restApi = config.restApi;
    this.environment = config.environment || 'production';
    this.baseUrl = config.wsUrl || WS_URLS[this.environment] || WS_URLS.production;

    // Connection state
    this.marketWs = null;           // Market data WebSocket
    this.userWs = null;             // User data WebSocket
    this.listenKey = null;          // Current user data listen key
    this.listenKeyTimer = null;     // Keepalive timer
    this.isShuttingDown = false;

    // Subscribed streams
    this.marketStreams = new Set();  // e.g., 'btcusdt@miniTicker', 'ethusdt@depth@100ms'

    // Reconnection state
    this.marketReconnectDelay = RECONNECT_MIN_DELAY;
    this.userReconnectDelay = RECONNECT_MIN_DELAY;
    this.marketReconnectTimer = null;
    this.userReconnectTimer = null;

    // Heartbeat tracking
    this.lastMarketMessage = null;
    this.lastUserMessage = null;
    this.heartbeatTimer = null;

    // Stats
    this.stats = {
      marketMessagesReceived: 0,
      userMessagesReceived: 0,
      marketReconnects: 0,
      userReconnects: 0,
      errors: 0,
      startTime: null,
    };

    logger.info(`🌐 Aster WebSocket initialized (${this.environment})`);
    logger.info(`   Base URL: ${this.baseUrl}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MARKET DATA STREAMS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to market data streams
   * @param {string[]} streams - Array of stream names (e.g., ['btcusdt@miniTicker', 'ethusdt@depth@100ms'])
   */
  async subscribeMarketStreams(streams) {
    // Add to tracked streams
    for (const stream of streams) {
      this.marketStreams.add(stream.toLowerCase());
    }

    // If already connected, send subscribe message via live subscription
    if (this.marketWs && this.marketWs.readyState === WebSocket.OPEN) {
      this._sendMarketSubscribe(streams);
      return;
    }

    // If currently connecting, don't tear it down — just let it connect
    // with the full stream set (streams were already added above)
    if (this.marketWs && this.marketWs.readyState === WebSocket.CONNECTING) {
      logger.debug(`WebSocket still connecting — ${streams.length} stream(s) queued for reconnect`);
      return;
    }

    // Otherwise, connect with all streams
    await this.connectMarketStreams();
  }

  /**
   * Unsubscribe from market data streams
   * @param {string[]} streams - Array of stream names to remove
   */
  unsubscribeMarketStreams(streams) {
    for (const stream of streams) {
      this.marketStreams.delete(stream.toLowerCase());
    }

    if (this.marketWs && this.marketWs.readyState === WebSocket.OPEN) {
      this._sendMarketUnsubscribe(streams);
    }
  }

  /**
   * Connect to market data WebSocket with all subscribed streams
   */
  async connectMarketStreams() {
    if (this.marketStreams.size === 0) {
      logger.warn('No market streams to subscribe to');
      return;
    }

    // Close existing connection
    this._closeWs(this.marketWs);

    const streamList = Array.from(this.marketStreams).join('/');
    const url = `${this.baseUrl}/stream?streams=${streamList}`;

    logger.info(`📡 Connecting to market streams (${this.marketStreams.size} streams)`);
    logger.debug(`   URL: ${url.substring(0, 120)}...`);

    // Snapshot which streams are in the URL so we can detect late additions
    const initialStreams = new Set(this.marketStreams);

    try {
      this.marketWs = new WebSocket(url);
      this.stats.startTime = this.stats.startTime || Date.now();

      this.marketWs.on('open', () => {
        logger.info(`✅ Market WebSocket connected (${initialStreams.size} streams)`);
        this.marketReconnectDelay = RECONNECT_MIN_DELAY;
        this.lastMarketMessage = Date.now();
        this.emit('market:connected');
        this._startHeartbeat();

        // If streams were added while we were connecting, live-subscribe them now
        const lateStreams = [];
        for (const s of this.marketStreams) {
          if (!initialStreams.has(s)) lateStreams.push(s);
        }
        if (lateStreams.length > 0) {
          logger.info(`📡 Late-subscribing ${lateStreams.length} stream(s) added during connect`);
          this._sendMarketSubscribe(lateStreams);
        }
      });

      this.marketWs.on('message', (data) => {
        this._handleMarketMessage(data);
      });

      this.marketWs.on('close', (code, reason) => {
        logger.warn(`⚠️ Market WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.emit('market:disconnected', { code, reason: reason?.toString() });
        this._scheduleMarketReconnect();
      });

      this.marketWs.on('error', (error) => {
        this.stats.errors++;
        logger.logError('Market WebSocket error', error);
        this.emit('market:error', error);
      });

      this.marketWs.on('ping', () => {
        this.marketWs.pong();
      });

    } catch (error) {
      logger.logError('Failed to connect market WebSocket', error);
      this._scheduleMarketReconnect();
    }
  }

  /**
   * Send live subscribe message to existing connection
   * @private
   */
  _sendMarketSubscribe(streams) {
    const msg = {
      method: 'SUBSCRIBE',
      params: streams.map(s => s.toLowerCase()),
      id: Date.now(),
    };
    this.marketWs.send(JSON.stringify(msg));
    logger.info(`📡 Subscribed to ${streams.length} additional stream(s)`);
  }

  /**
   * Send live unsubscribe message
   * @private
   */
  _sendMarketUnsubscribe(streams) {
    const msg = {
      method: 'UNSUBSCRIBE',
      params: streams.map(s => s.toLowerCase()),
      id: Date.now(),
    };
    this.marketWs.send(JSON.stringify(msg));
    logger.info(`🔇 Unsubscribed from ${streams.length} stream(s)`);
  }

  /**
   * Handle incoming market data message
   * @private
   */
  _handleMarketMessage(rawData) {
    try {
      this.stats.marketMessagesReceived++;
      this.lastMarketMessage = Date.now();

      const data = JSON.parse(rawData.toString());

      // Combined stream format: { stream: "btcusdt@miniTicker", data: {...} }
      if (data.stream && data.data) {
        const streamName = data.stream;
        const payload = data.data;
        const eventType = payload.e; // e.g., '24hrMiniTicker', 'depthUpdate', 'aggTrade', 'kline', 'markPriceUpdate'

        // Emit typed events for consumers
        switch (eventType) {
          case '24hrMiniTicker':
            this.emit('ticker', {
              symbol: payload.s,
              close: parseFloat(payload.c),
              open: parseFloat(payload.o),
              high: parseFloat(payload.h),
              low: parseFloat(payload.l),
              volume: parseFloat(payload.v),
              quoteVolume: parseFloat(payload.q),
              eventTime: payload.E,
            });
            break;

          case 'depthUpdate':
            this.emit('depth', {
              symbol: payload.s,
              eventTime: payload.E,
              transactionTime: payload.T,
              firstUpdateId: payload.U,
              lastUpdateId: payload.u,
              prevLastUpdateId: payload.pu,
              bids: payload.b?.map(([price, qty]) => ({
                price: parseFloat(price),
                quantity: parseFloat(qty),
              })) || [],
              asks: payload.a?.map(([price, qty]) => ({
                price: parseFloat(price),
                quantity: parseFloat(qty),
              })) || [],
            });
            break;

          case 'aggTrade':
            this.emit('trade', {
              symbol: payload.s,
              price: parseFloat(payload.p),
              quantity: parseFloat(payload.q),
              tradeTime: payload.T,
              isBuyerMaker: payload.m,
              side: payload.m ? 'sell' : 'buy', // Buyer is maker = taker sold
              tradeId: payload.a,
            });
            break;

          case 'kline':
            const k = payload.k;
            this.emit('kline', {
              symbol: payload.s,
              interval: k.i,
              startTime: k.t,
              closeTime: k.T,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              trades: k.n,
              isClosed: k.x, // Is this candle closed?
              quoteVolume: parseFloat(k.q),
              takerBuyVolume: parseFloat(k.V),
            });
            break;

          case 'markPriceUpdate':
            this.emit('markPrice', {
              symbol: payload.s,
              markPrice: parseFloat(payload.p),
              indexPrice: parseFloat(payload.i),
              fundingRate: parseFloat(payload.r),
              nextFundingTime: payload.T,
              eventTime: payload.E,
            });
            break;

          case 'forceOrder':
            this.emit('liquidation', {
              symbol: payload.o?.s,
              side: payload.o?.S,
              orderType: payload.o?.o,
              price: parseFloat(payload.o?.p || 0),
              quantity: parseFloat(payload.o?.q || 0),
              tradeTime: payload.o?.T,
            });
            break;

          default:
            // Emit raw for unknown event types
            this.emit('market:raw', { stream: streamName, data: payload });
        }

        // Always emit the raw stream event too (for custom handlers)
        this.emit(`stream:${streamName}`, payload);

      } else if (data.result !== undefined && data.id) {
        // Subscription confirmation response
        logger.debug(`WebSocket subscription response: id=${data.id}, result=${data.result}`);
      }

    } catch (error) {
      this.stats.errors++;
      logger.logError('Error parsing market message', error);
    }
  }

  /**
   * Schedule market WebSocket reconnection
   * @private
   */
  _scheduleMarketReconnect() {
    if (this.isShuttingDown) return;

    clearTimeout(this.marketReconnectTimer);
    this.marketReconnectTimer = setTimeout(async () => {
      this.stats.marketReconnects++;
      logger.info(`🔄 Reconnecting market WebSocket (attempt #${this.stats.marketReconnects}, delay: ${this.marketReconnectDelay}ms)`);
      await this.connectMarketStreams();
      // Exponential backoff
      this.marketReconnectDelay = Math.min(
        this.marketReconnectDelay * RECONNECT_BACKOFF,
        RECONNECT_MAX_DELAY
      );
    }, this.marketReconnectDelay);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // USER DATA STREAM
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Connect to user data stream
   * Requires a valid AsterAPIV3 instance for listenKey management
   */
  async connectUserDataStream() {
    if (!this.restApi) {
      logger.error('Cannot start user data stream: no REST API instance provided');
      return;
    }

    try {
      // Get a listen key from REST API
      const { listenKey } = await this.restApi.startUserDataStream();
      this.listenKey = listenKey;

      // Close existing connection
      this._closeWs(this.userWs);

      const url = `${this.baseUrl}/ws/${this.listenKey}`;
      logger.info(`🔐 Connecting to user data stream...`);

      this.userWs = new WebSocket(url);

      this.userWs.on('open', () => {
        logger.info('✅ User data stream connected');
        this.userReconnectDelay = RECONNECT_MIN_DELAY;
        this.lastUserMessage = Date.now();
        this.emit('user:connected');
        this._startListenKeyKeepalive();
      });

      this.userWs.on('message', (data) => {
        this._handleUserMessage(data);
      });

      this.userWs.on('close', (code, reason) => {
        logger.warn(`⚠️ User data stream closed (code: ${code}, reason: ${reason || 'none'})`);
        this.emit('user:disconnected', { code, reason: reason?.toString() });
        this._stopListenKeyKeepalive();
        this._scheduleUserReconnect();
      });

      this.userWs.on('error', (error) => {
        this.stats.errors++;
        logger.logError('User data stream error', error);
        this.emit('user:error', error);
      });

      this.userWs.on('ping', () => {
        this.userWs.pong();
      });

    } catch (error) {
      logger.logError('Failed to start user data stream', error);
      this._scheduleUserReconnect();
    }
  }

  /**
   * Handle incoming user data message
   * @private
   */
  _handleUserMessage(rawData) {
    try {
      this.stats.userMessagesReceived++;
      this.lastUserMessage = Date.now();

      const data = JSON.parse(rawData.toString());
      const eventType = data.e;

      switch (eventType) {
        case 'ACCOUNT_UPDATE': {
          const updateData = data.a;
          this.emit('accountUpdate', {
            eventTime: data.E,
            transactionTime: data.T,
            reason: updateData?.m, // e.g., 'ORDER', 'DEPOSIT', 'WITHDRAW', 'FUNDING_FEE'
            balances: updateData?.B?.map(b => ({
              asset: b.a,
              walletBalance: parseFloat(b.wb),
              crossWalletBalance: parseFloat(b.cw),
              balanceChange: parseFloat(b.bc),
            })) || [],
            positions: updateData?.P?.map(p => ({
              symbol: p.s,
              positionAmount: parseFloat(p.pa),
              entryPrice: parseFloat(p.ep),
              accumulatedRealized: parseFloat(p.cr),
              unrealizedPnl: parseFloat(p.up),
              marginType: p.mt, // 'isolated' or 'cross'
              isolatedWallet: parseFloat(p.iw),
              positionSide: p.ps, // 'BOTH', 'LONG', 'SHORT'
            })) || [],
          });
          break;
        }

        case 'ORDER_TRADE_UPDATE': {
          const order = data.o;
          const orderEvent = {
            eventTime: data.E,
            transactionTime: data.T,
            symbol: order.s,
            clientOrderId: order.c,
            side: order.S,           // 'BUY' or 'SELL'
            orderType: order.o,      // 'LIMIT', 'MARKET', etc.
            timeInForce: order.f,    // 'GTC', 'IOC', 'FOK', 'GTX'
            originalQuantity: parseFloat(order.q),
            originalPrice: parseFloat(order.p),
            averagePrice: parseFloat(order.ap),
            stopPrice: parseFloat(order.sp),
            executionType: order.x,  // 'NEW', 'CANCELED', 'CALCULATED', 'EXPIRED', 'TRADE'
            orderStatus: order.X,    // 'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', etc.
            orderId: order.i,
            lastFilledQty: parseFloat(order.l),
            cumulativeFilledQty: parseFloat(order.z),
            lastFilledPrice: parseFloat(order.L),
            commissionAsset: order.N,
            commission: parseFloat(order.n || 0),
            orderTradeTime: order.T,
            tradeId: order.t,
            realizedProfit: parseFloat(order.rp),
            isReduceOnly: order.R,
            positionSide: order.ps,  // 'BOTH', 'LONG', 'SHORT'
            workingType: order.wt,   // 'MARK_PRICE' or 'CONTRACT_PRICE'
          };

          this.emit('orderUpdate', orderEvent);

          // Emit specific sub-events for convenience
          if (order.X === 'FILLED') {
            this.emit('orderFilled', orderEvent);
          } else if (order.X === 'CANCELED') {
            this.emit('orderCanceled', orderEvent);
          } else if (order.X === 'PARTIALLY_FILLED') {
            this.emit('orderPartialFill', orderEvent);
          }
          break;
        }

        case 'MARGIN_CALL': {
          const positions = data.p || [];
          this.emit('marginCall', {
            eventTime: data.E,
            crossWalletBalance: parseFloat(data.cw),
            positions: positions.map(p => ({
              symbol: p.s,
              positionSide: p.ps,
              positionAmount: parseFloat(p.pa),
              marginType: p.mt,
              isolatedWallet: parseFloat(p.iw),
              markPrice: parseFloat(p.mp),
              unrealizedPnl: parseFloat(p.up),
              maintenanceMarginRequired: parseFloat(p.mm),
            })),
          });
          logger.warn(`⚠️ MARGIN CALL received for ${positions.length} position(s)!`);
          break;
        }

        case 'ACCOUNT_CONFIG_UPDATE': {
          this.emit('configUpdate', {
            eventTime: data.E,
            transactionTime: data.T,
            leverage: data.ac ? {
              symbol: data.ac.s,
              leverage: data.ac.l,
            } : null,
            multiAssets: data.ai ? {
              multiAssetsMode: data.ai.j,
            } : null,
          });
          break;
        }

        case 'listenKeyExpired': {
          logger.warn('⚠️ Listen key expired — reconnecting user data stream');
          this.emit('user:keyExpired');
          this._stopListenKeyKeepalive();
          this._scheduleUserReconnect();
          break;
        }

        default:
          this.emit('user:raw', data);
          logger.debug(`Unknown user event type: ${eventType}`);
      }

    } catch (error) {
      this.stats.errors++;
      logger.logError('Error parsing user data message', error);
    }
  }

  /**
   * Start listen key keepalive timer
   * @private
   */
  _startListenKeyKeepalive() {
    this._stopListenKeyKeepalive();
    this.listenKeyTimer = setInterval(async () => {
      try {
        await this.restApi.keepaliveUserDataStream();
        logger.debug('🔑 Listen key keepalive sent');
      } catch (error) {
        logger.logError('Listen key keepalive failed', error);
        // If keepalive fails, reconnect
        this._scheduleUserReconnect();
      }
    }, LISTEN_KEY_KEEPALIVE_MS);
  }

  /**
   * Stop listen key keepalive timer
   * @private
   */
  _stopListenKeyKeepalive() {
    if (this.listenKeyTimer) {
      clearInterval(this.listenKeyTimer);
      this.listenKeyTimer = null;
    }
  }

  /**
   * Schedule user data stream reconnection
   * @private
   */
  _scheduleUserReconnect() {
    if (this.isShuttingDown) return;

    clearTimeout(this.userReconnectTimer);
    this.userReconnectTimer = setTimeout(async () => {
      this.stats.userReconnects++;
      logger.info(`🔄 Reconnecting user data stream (attempt #${this.stats.userReconnects}, delay: ${this.userReconnectDelay}ms)`);
      await this.connectUserDataStream();
      this.userReconnectDelay = Math.min(
        this.userReconnectDelay * RECONNECT_BACKOFF,
        RECONNECT_MAX_DELAY
      );
    }, this.userReconnectDelay);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HEARTBEAT MONITORING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Start heartbeat monitoring for stale connections
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      // Check market connection staleness
      if (this.lastMarketMessage && (now - this.lastMarketMessage) > HEARTBEAT_TIMEOUT_MS) {
        logger.warn(`⚠️ Market WebSocket stale (${Math.round((now - this.lastMarketMessage) / 1000)}s since last message)`);
        this._closeWs(this.marketWs);
        this._scheduleMarketReconnect();
      }

      // Check user connection staleness (less strict — user events are infrequent)
      // Only check if stream is supposed to be connected
      if (this.userWs && this.lastUserMessage && (now - this.lastUserMessage) > HEARTBEAT_TIMEOUT_MS * 3) {
        logger.warn(`⚠️ User data stream stale (${Math.round((now - this.lastUserMessage) / 1000)}s since last message)`);
        // Don't auto-reconnect user stream on staleness — it might just be quiet
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop heartbeat monitoring
   * @private
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS: Stream Builders
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to mini ticker for symbols (real-time price updates)
   * Replaces REST getTicker polling
   * @param {string[]} symbols - e.g., ['BTCUSDT', 'ETHUSDT']
   */
  async subscribeTickers(symbols) {
    const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`);
    await this.subscribeMarketStreams(streams);
    logger.info(`📊 Subscribed to ticker for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to all tickers at once (single stream for all symbols)
   */
  async subscribeAllTickers() {
    await this.subscribeMarketStreams(['!miniTicker@arr']);
    logger.info('📊 Subscribed to ALL tickers stream');
  }

  /**
   * Subscribe to order book depth for symbols
   * @param {string[]} symbols - e.g., ['BTCUSDT', 'ETHUSDT']
   * @param {string} [updateSpeed='100ms'] - Update speed: '100ms', '250ms', '500ms'
   */
  async subscribeDepth(symbols, updateSpeed = '100ms') {
    const streams = symbols.map(s => `${s.toLowerCase()}@depth@${updateSpeed}`);
    await this.subscribeMarketStreams(streams);
    logger.info(`📚 Subscribed to depth for ${symbols.length} symbol(s) @ ${updateSpeed}`);
  }

  /**
   * Subscribe to partial book depth (top N levels, pushed at interval)
   * @param {string[]} symbols 
   * @param {number} [levels=10] - 5, 10, or 20
   * @param {string} [updateSpeed='100ms']
   */
  async subscribePartialDepth(symbols, levels = 10, updateSpeed = '100ms') {
    const streams = symbols.map(s => `${s.toLowerCase()}@depth${levels}@${updateSpeed}`);
    await this.subscribeMarketStreams(streams);
    logger.info(`📚 Subscribed to depth${levels} for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to aggregate trades for symbols
   * @param {string[]} symbols - e.g., ['BTCUSDT', 'ETHUSDT']
   */
  async subscribeTrades(symbols) {
    const streams = symbols.map(s => `${s.toLowerCase()}@aggTrade`);
    await this.subscribeMarketStreams(streams);
    logger.info(`📈 Subscribed to trades for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to kline/candle streams
   * @param {string[]} symbols - e.g., ['BTCUSDT', 'ETHUSDT']
   * @param {string} [interval='1m'] - Kline interval
   */
  async subscribeKlines(symbols, interval = '1m') {
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`);
    await this.subscribeMarketStreams(streams);
    logger.info(`🕯️ Subscribed to ${interval} klines for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to mark price stream (includes funding rate)
   * @param {string[]} symbols - e.g., ['BTCUSDT', 'ETHUSDT']
   */
  async subscribeMarkPrice(symbols) {
    const streams = symbols.map(s => `${s.toLowerCase()}@markPrice`);
    await this.subscribeMarketStreams(streams);
    logger.info(`🏷️ Subscribed to mark price for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to liquidation order stream for symbols
   * @param {string[]} symbols
   */
  async subscribeLiquidations(symbols) {
    const streams = symbols.map(s => `${s.toLowerCase()}@forceOrder`);
    await this.subscribeMarketStreams(streams);
    logger.info(`⚠️ Subscribed to liquidation stream for ${symbols.length} symbol(s)`);
  }

  /**
   * Subscribe to all liquidation events across all symbols
   */
  async subscribeAllLiquidations() {
    await this.subscribeMarketStreams(['!forceOrder@arr']);
    logger.info('⚠️ Subscribed to ALL liquidation events');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Start all WebSocket connections
   * @param {object} options
   * @param {string[]} [options.tickerSymbols] - Symbols for price tickers
   * @param {string[]} [options.depthSymbols] - Symbols for order book depth
   * @param {string[]} [options.tradeSymbols] - Symbols for trade flow
   * @param {boolean} [options.userStream=true] - Connect user data stream
   * @param {boolean} [options.allTickers=false] - Subscribe to all tickers
   */
  async start(options = {}) {
    logger.info('🚀 Starting Aster WebSocket connections...');
    this.isShuttingDown = false;

    // Build market stream subscriptions
    const streams = [];

    if (options.allTickers) {
      streams.push('!miniTicker@arr');
    } else if (options.tickerSymbols?.length) {
      for (const s of options.tickerSymbols) {
        streams.push(`${s.toLowerCase()}@miniTicker`);
      }
    }

    if (options.depthSymbols?.length) {
      for (const s of options.depthSymbols) {
        streams.push(`${s.toLowerCase()}@depth@100ms`);
      }
    }

    if (options.tradeSymbols?.length) {
      for (const s of options.tradeSymbols) {
        streams.push(`${s.toLowerCase()}@aggTrade`);
      }
    }

    // Connect market streams
    if (streams.length > 0) {
      for (const stream of streams) {
        this.marketStreams.add(stream);
      }
      await this.connectMarketStreams();
    }

    // Connect user data stream
    if (options.userStream !== false && this.restApi) {
      await this.connectUserDataStream();
    }

    logger.info('✅ Aster WebSocket startup complete');
  }

  /**
   * Gracefully shut down all connections
   */
  async shutdown() {
    logger.info('🛑 Shutting down Aster WebSocket connections...');
    this.isShuttingDown = true;

    // Clear all timers
    clearTimeout(this.marketReconnectTimer);
    clearTimeout(this.userReconnectTimer);
    this._stopListenKeyKeepalive();
    this._stopHeartbeat();

    // Close listen key on server
    if (this.listenKey && this.restApi) {
      try {
        await this.restApi.closeUserDataStream();
      } catch (error) {
        logger.debug('Error closing listen key (non-critical):', error.message);
      }
    }

    // Close WebSocket connections
    this._closeWs(this.marketWs);
    this._closeWs(this.userWs);
    this.marketWs = null;
    this.userWs = null;

    // Clear streams
    this.marketStreams.clear();
    this.listenKey = null;

    logger.info('✅ Aster WebSocket shutdown complete');
    this.emit('shutdown');
  }

  /**
   * Close a WebSocket connection safely
   * @private
   */
  _closeWs(ws) {
    if (ws) {
      try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Normal closure');
        }
        ws.terminate();
      } catch (error) {
        // Ignore close errors
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATUS & DIAGNOSTICS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get connection status
   * @returns {object} Status info
   */
  getStatus() {
    return {
      environment: this.environment,
      market: {
        connected: this.marketWs?.readyState === WebSocket.OPEN,
        streams: Array.from(this.marketStreams),
        streamCount: this.marketStreams.size,
        lastMessage: this.lastMarketMessage ? new Date(this.lastMarketMessage).toISOString() : null,
        reconnects: this.stats.marketReconnects,
      },
      user: {
        connected: this.userWs?.readyState === WebSocket.OPEN,
        hasListenKey: !!this.listenKey,
        lastMessage: this.lastUserMessage ? new Date(this.lastUserMessage).toISOString() : null,
        reconnects: this.stats.userReconnects,
      },
      stats: {
        marketMessages: this.stats.marketMessagesReceived,
        userMessages: this.stats.userMessagesReceived,
        errors: this.stats.errors,
        uptime: this.stats.startTime ? Math.round((Date.now() - this.stats.startTime) / 1000) : 0,
      },
    };
  }

  /**
   * Check if market connection is healthy
   * @returns {boolean}
   */
  isMarketConnected() {
    return this.marketWs?.readyState === WebSocket.OPEN;
  }

  /**
   * Check if user data stream is healthy
   * @returns {boolean}
   */
  isUserConnected() {
    return this.userWs?.readyState === WebSocket.OPEN;
  }
}

module.exports = AsterWebSocket;
