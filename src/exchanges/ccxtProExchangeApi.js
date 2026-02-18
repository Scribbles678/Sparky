/**
 * CCXT Pro Exchange API Adapter
 * 
 * Extends BaseExchangeAPI with CCXT Pro WebSocket streaming support.
 * Works with any CCXT Pro-supported exchange (Apex, Hyperliquid, Binance, etc.)
 * 
 * Two capabilities in one adapter:
 *   1. REST trading (same as CCXTExchangeAPI) via unified CCXT methods
 *   2. WebSocket streaming via CCXT Pro watch* methods, bridged to EventEmitter
 *      events compatible with PositionUpdater
 * 
 * Usage:
 *   const api = new CCXTProExchangeAPI('apex', { apiKey, secret, password });
 *   await api.startStreaming();  // begins watch* loops
 *   api.on('ticker', (data) => ...);
 *   api.on('accountUpdate', (data) => ...);
 *   api.on('orderFilled', (data) => ...);
 */

const ccxtPro = require('ccxt').pro;
const EventEmitter = require('events');
const BaseExchangeAPI = require('./BaseExchangeAPI');
const logger = require('../utils/logger');

class CCXTProExchangeAPI extends BaseExchangeAPI {
  /**
   * @param {string} exchangeId - CCXT exchange ID (e.g., 'apex', 'binance', 'hyperliquid')
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} config.apiSecret / config.secret
   * @param {string} [config.passphrase] / [config.password]
   * @param {string} [config.environment] - 'production' or 'sandbox'
   * @param {object} [config.options] - Exchange-specific options
   */
  constructor(exchangeId, config) {
    super(config);
    this.exchangeId = exchangeId.toLowerCase();
    this.exchangeName = this.exchangeId;

    const ExchangeClass = ccxtPro[this.exchangeId];
    if (!ExchangeClass) {
      const available = Object.keys(ccxtPro).filter(
        k => !k.startsWith('_') && typeof ccxtPro[k] === 'function'
      );
      throw new Error(
        `CCXT Pro exchange '${this.exchangeId}' not found. ` +
        `Available: ${available.slice(0, 20).join(', ')}... (${available.length} total)`
      );
    }

    const ccxtConfig = {
      apiKey: config.apiKey || config.api_key,
      secret: config.apiSecret || config.secret || config.api_secret,
      sandbox: config.environment === 'sandbox' || config.sandbox === true,
      enableRateLimit: true,
      newUpdates: true,
      options: config.options || {},
    };

    if (config.passphrase || config.password) {
      ccxtConfig.password = config.passphrase || config.password;
    }

    this.exchange = new ExchangeClass(ccxtConfig);
    this.marketsLoaded = false;

    // Streaming state
    this._emitter = new EventEmitter();
    this._streaming = false;
    this._streamLoops = [];
    this._subscribedTickerSymbols = new Set();

    logger.info(`CCXT Pro ${this.exchangeId} initialized (WS-capable)`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EventEmitter bridge — PositionUpdater compatibility
  // ──────────────────────────────────────────────────────────────────────────

  on(event, listener) { return this._emitter.on(event, listener); }
  once(event, listener) { return this._emitter.once(event, listener); }
  off(event, listener) { return this._emitter.off(event, listener); }
  removeListener(event, listener) { return this._emitter.removeListener(event, listener); }
  emit(event, ...args) { return this._emitter.emit(event, ...args); }

  // ──────────────────────────────────────────────────────────────────────────
  // Market loading
  // ──────────────────────────────────────────────────────────────────────────

  async loadMarkets(reload = false) {
    if (!this.marketsLoaded || reload) {
      try {
        await this.exchange.loadMarkets();
        this.marketsLoaded = true;
        const count = Object.keys(this.exchange.markets).length;
        logger.info(`Markets loaded for ${this.exchangeId}: ${count} markets`);
      } catch (error) {
        logger.logError(`Failed to load markets for ${this.exchangeId}`, error);
        throw error;
      }
    }
  }

  /**
   * Normalize symbol to CCXT format using loaded markets
   */
  normalizeSymbol(symbol) {
    if (this.marketsLoaded) {
      try {
        const market = this.exchange.market(symbol);
        if (market) return market.symbol || market.id;
      } catch (e) { /* fall through */ }
    }
    if (symbol.includes('/')) return symbol;
    if (symbol.endsWith('USDT')) return `${symbol.slice(0, -4)}/USDT`;
    if (symbol.endsWith('USD')) return `${symbol.slice(0, -3)}/USD`;
    return symbol;
  }

  getExchangeName() {
    return this.exchangeName;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REST methods — BaseExchangeAPI interface
  // ──────────────────────────────────────────────────────────────────────────

  async getBalance() {
    await this.loadMarkets();
    try {
      const balance = await this.exchange.fetchBalance();
      const balances = [];
      for (const [currency, amount] of Object.entries(balance)) {
        if (['info', 'free', 'used', 'total'].includes(currency)) continue;
        if (amount && (amount.free > 0 || amount.used > 0 || amount.total > 0)) {
          balances.push({
            asset: currency,
            free: parseFloat(amount.free || 0),
            locked: parseFloat(amount.used || 0),
            total: parseFloat(amount.total || 0),
          });
        }
      }
      return balances;
    } catch (error) {
      logger.logError(`Failed to fetch balance for ${this.exchangeId}`, error);
      throw error;
    }
  }

  async getAvailableMargin() {
    await this.loadMarkets();
    try {
      const balance = await this.exchange.fetchBalance();
      if (this.exchange.has['fetchPositions']) {
        const margin = balance.info?.availableMargin ||
                       balance.info?.availableBalance ||
                       balance.info?.marginAvailable ||
                       balance.USDC?.free ||
                       balance.USDT?.free ||
                       balance.USD?.free || 0;
        return parseFloat(margin);
      }
      return parseFloat(balance.USDT?.free || balance.USDC?.free || balance.USD?.free || 0);
    } catch (error) {
      logger.logError(`Failed to fetch available margin for ${this.exchangeId}`, error);
      throw error;
    }
  }

  async getPositions() {
    await this.loadMarkets();
    try {
      if (!this.exchange.has['fetchPositions']) return [];
      const positions = await this.exchange.fetchPositions();
      return positions
        .filter(p => parseFloat(p.contracts || 0) !== 0)
        .map(p => ({
          symbol: p.symbol,
          side: p.side,
          size: Math.abs(parseFloat(p.contracts || 0)),
          entryPrice: parseFloat(p.entryPrice || 0),
          markPrice: parseFloat(p.markPrice || 0),
          unrealizedPnl: parseFloat(p.unrealizedPnl || 0),
          leverage: parseFloat(p.leverage || 1),
          percentage: parseFloat(p.percentage || 0),
          notional: parseFloat(p.notional || 0),
          collateral: parseFloat(p.collateral || 0),
          initialMargin: parseFloat(p.initialMargin || 0),
        }));
    } catch (error) {
      logger.logError(`Failed to fetch positions for ${this.exchangeId}`, error);
      if (error.message.includes('not supported') || error.message.includes('not available')) {
        return [];
      }
      throw error;
    }
  }

  async getPosition(symbol) {
    const positions = await this.getPositions();
    const normalizedSymbol = this.normalizeSymbol(symbol);
    return positions.find(p => p.symbol === normalizedSymbol) || null;
  }

  async hasOpenPosition(symbol) {
    const position = await this.getPosition(symbol);
    return position !== null && parseFloat(position.size || 0) !== 0;
  }

  async getTicker(symbol) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const ticker = await this.exchange.fetchTicker(normalizedSymbol);
      return {
        symbol: normalizedSymbol,
        lastPrice: parseFloat(ticker.last || 0),
        bid: parseFloat(ticker.bid || 0),
        ask: parseFloat(ticker.ask || 0),
        volume: parseFloat(ticker.quoteVolume || ticker.baseVolume || 0),
        price: parseFloat(ticker.last || ticker.close || 0),
        high: parseFloat(ticker.high || 0),
        low: parseFloat(ticker.low || 0),
        open: parseFloat(ticker.open || 0),
        change: parseFloat(ticker.change || 0),
        percentage: parseFloat(ticker.percentage || 0),
      };
    } catch (error) {
      logger.logError(`Failed to fetch ticker for ${symbol}`, error);
      throw error;
    }
  }

  async placeMarketOrder(symbol, side, quantity) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      const order = await this.exchange.createOrder(
        normalizedSymbol, 'market', normalizedSide, quantity
      );
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || 0),
        status: order.status || 'FILLED',
        filled: parseFloat(order.filled || 0),
      };
    } catch (error) {
      logger.logError(`Failed to place market order for ${symbol}`, error);
      throw error;
    }
  }

  async placeLimitOrder(symbol, side, quantity, price) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      const order = await this.exchange.createOrder(
        normalizedSymbol, 'limit', normalizedSide, quantity, price
      );
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || price),
        status: order.status || 'NEW',
        filled: parseFloat(order.filled || 0),
      };
    } catch (error) {
      logger.logError(`Failed to place limit order for ${symbol}`, error);
      throw error;
    }
  }

  async placeStopLoss(symbol, side, quantity, stopPrice) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      const normalizedSide = side.toLowerCase();
      let order;
      if (this.exchange.has['createStopOrder']) {
        order = await this.exchange.createStopOrder(
          normalizedSymbol, normalizedSide, quantity, stopPrice
        );
      } else {
        order = await this.exchange.createOrder(
          normalizedSymbol, 'stop', normalizedSide, quantity, stopPrice,
          { stopPrice, reduceOnly: true }
        );
      }
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        price: parseFloat(order.price || stopPrice),
        status: order.status || 'NEW',
        type: 'STOP',
      };
    } catch (error) {
      logger.logError(`Failed to place stop loss for ${symbol}`, error);
      throw error;
    }
  }

  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    return this.placeLimitOrder(symbol, side, quantity, takeProfitPrice);
  }

  async closePosition(symbol, side, quantity) {
    const oppositeSide = side.toLowerCase() === 'buy' ? 'sell' : 'buy';
    return this.placeMarketOrder(symbol, oppositeSide, quantity);
  }

  async cancelOrder(symbol, orderId) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      return await this.exchange.cancelOrder(orderId, normalizedSymbol);
    } catch (error) {
      logger.logError(`Failed to cancel order ${orderId}`, error);
      throw error;
    }
  }

  async getOrder(symbol, orderId) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      return await this.exchange.fetchOrder(orderId, normalizedSymbol);
    } catch (error) {
      logger.logError(`Failed to fetch order ${orderId}`, error);
      throw error;
    }
  }

  async cancelAllOrders(symbol) {
    await this.loadMarkets();
    try {
      const normalizedSymbol = this.normalizeSymbol(symbol);
      return await this.exchange.cancelAllOrders(normalizedSymbol);
    } catch (error) {
      logger.logError(`Failed to cancel all orders for ${symbol}`, error);
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Apex-specific order methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Place a bracket order (entry + TP + SL) for Apex DEX
   * @param {string} symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {string} type - 'market' or 'limit'
   * @param {number} quantity
   * @param {number} [price] - required for limit orders
   * @param {object} options
   * @param {number} options.takeProfitPrice - TP trigger price
   * @param {number} options.stopLossPrice - SL trigger price
   * @param {number} [options.trailingPercent] - trailing stop %
   */
  async placeBracketOrder(symbol, side, type, quantity, price, options = {}) {
    await this.loadMarkets();
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedSide = side.toLowerCase();
    const oppositeSide = normalizedSide === 'buy' ? 'sell' : 'buy';
    const { takeProfitPrice, stopLossPrice, trailingPercent } = options;

    const params = { reduceOnly: false };

    if (takeProfitPrice || stopLossPrice) {
      params.isOpenTpslOrder = true;
    }
    if (takeProfitPrice) {
      params.isSetOpenTp = true;
      params.tpTriggerPrice = String(takeProfitPrice);
      params.tpPrice = String(takeProfitPrice);
      params.tpSide = oppositeSide.toUpperCase();
      params.tpSize = String(quantity);
    }
    if (stopLossPrice) {
      params.isSetOpenSl = true;
      params.slTriggerPrice = String(stopLossPrice);
      params.slPrice = String(stopLossPrice);
      params.slSide = oppositeSide.toUpperCase();
      params.slSize = String(quantity);
    }
    if (trailingPercent) {
      params.trailingPercent = String(trailingPercent);
    }

    try {
      const order = await this.exchange.createOrder(
        normalizedSymbol, type, normalizedSide, quantity, price, params
      );

      const result = {
        entryOrder: {
          orderId: order.id,
          symbol: normalizedSymbol,
          side: normalizedSide,
          quantity: parseFloat(order.amount || quantity),
          price: parseFloat(order.price || price || 0),
          status: order.status || 'FILLED',
        },
      };

      if (takeProfitPrice) {
        result.takeProfitOrder = {
          symbol: normalizedSymbol,
          side: oppositeSide,
          triggerPrice: takeProfitPrice,
          status: 'PLACED',
        };
      }
      if (stopLossPrice) {
        result.stopLossOrder = {
          symbol: normalizedSymbol,
          side: oppositeSide,
          triggerPrice: stopLossPrice,
          status: 'PLACED',
        };
      }

      logger.info(`Bracket order placed on ${this.exchangeId}: ${normalizedSide} ${quantity} ${normalizedSymbol} ` +
        `${takeProfitPrice ? `TP@${takeProfitPrice}` : ''} ${stopLossPrice ? `SL@${stopLossPrice}` : ''}`);

      return result;
    } catch (error) {
      logger.logError(`Failed to place bracket order on ${this.exchangeId}`, error);
      throw error;
    }
  }

  /**
   * Place a trailing stop order
   */
  async placeTrailingStop(symbol, side, quantity, callbackRate, activationPrice = null) {
    await this.loadMarkets();
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const normalizedSide = side.toLowerCase();

    const params = {
      reduceOnly: true,
      trailingPercent: String(callbackRate),
    };
    if (activationPrice) {
      params.triggerPrice = String(activationPrice);
    }

    try {
      const order = await this.exchange.createOrder(
        normalizedSymbol, 'market', normalizedSide, quantity, undefined, params
      );
      return {
        orderId: order.id,
        symbol: normalizedSymbol,
        side: normalizedSide,
        quantity: parseFloat(order.amount || quantity),
        callbackRate,
        status: order.status || 'NEW',
        type: 'TRAILING_STOP',
      };
    } catch (error) {
      logger.logError(`Failed to place trailing stop for ${symbol}`, error);
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket streaming — CCXT Pro watch* loops bridged to EventEmitter
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start all WebSocket streaming loops.
   * Call this after the exchange is created and markets are loaded.
   */
  async startStreaming() {
    if (this._streaming) {
      logger.warn(`${this.exchangeId} streaming already active`);
      return;
    }

    await this.loadMarkets();
    this._streaming = true;

    logger.info(`Starting CCXT Pro WebSocket streams for ${this.exchangeId}`);

    if (this.exchange.has['watchPositions']) {
      this._startLoop('positions', () => this._runPositionStream());
    }
    if (this.exchange.has['watchOrders']) {
      this._startLoop('orders', () => this._runOrderStream());
    }
    if (this.exchange.has['watchBalance']) {
      this._startLoop('balance', () => this._runBalanceStream());
    }

    logger.info(`CCXT Pro streaming started for ${this.exchangeId}`);
  }

  /**
   * Subscribe specific symbols to ticker streaming
   */
  async subscribeTickers(symbols) {
    const normalizedSymbols = [];
    for (const sym of symbols) {
      const ns = this.normalizeSymbol(sym);
      if (!this._subscribedTickerSymbols.has(ns)) {
        this._subscribedTickerSymbols.add(ns);
        normalizedSymbols.push(ns);
      }
    }
    if (normalizedSymbols.length > 0 && this._streaming) {
      if (!this._tickerLoopRunning && this.exchange.has['watchTickers']) {
        this._tickerLoopRunning = true;
        this._startLoop('tickers', () => this._runTickerStream());
      }
    }
  }

  /**
   * Stop all streaming loops and close the connection
   */
  async stopAllStreams() {
    this._streaming = false;
    this._tickerLoopRunning = false;
    this._subscribedTickerSymbols.clear();

    try {
      await this.exchange.close();
    } catch (e) {
      logger.logError(`Error closing ${this.exchangeId} connection`, e);
    }

    logger.info(`CCXT Pro streaming stopped for ${this.exchangeId}`);
  }

  /** @private */
  _startLoop(name, fn) {
    const promise = fn().catch(err => {
      logger.logError(`${this.exchangeId} ${name} stream fatal error`, err);
    });
    this._streamLoops.push(promise);
  }

  /** @private — watches positions and emits accountUpdate events */
  async _runPositionStream() {
    while (this._streaming) {
      try {
        const rawPositions = await this.exchange.watchPositions();

        const positions = rawPositions.map(p => ({
          symbol: p.symbol,
          positionAmount: parseFloat(p.contracts || 0) * (p.side === 'short' ? -1 : 1),
          entryPrice: parseFloat(p.entryPrice || 0),
          markPrice: parseFloat(p.markPrice || 0),
          unrealizedPnl: parseFloat(p.unrealizedPnl || 0),
          side: p.side,
        }));

        this.emit('accountUpdate', {
          reason: 'POSITION_UPDATE',
          positions,
          balances: [],
        });
      } catch (e) {
        if (!this._streaming) break;
        logger.logError(`${this.exchangeId} position stream error`, e);
        await this.exchange.sleep(5000);
      }
    }
  }

  /** @private — watches orders and emits orderFilled events for fills */
  async _runOrderStream() {
    while (this._streaming) {
      try {
        const orders = await this.exchange.watchOrders();

        for (const order of orders) {
          if (order.status === 'closed' || order.filled > 0) {
            this.emit('orderFilled', {
              symbol: order.symbol,
              side: (order.side || '').toUpperCase(),
              orderId: order.id,
              type: (order.type || '').toUpperCase(),
              cumulativeFilledQty: parseFloat(order.filled || 0),
              averagePrice: parseFloat(order.average || order.price || 0),
              realizedProfit: '0',
              status: order.status,
            });
          }
        }
      } catch (e) {
        if (!this._streaming) break;
        logger.logError(`${this.exchangeId} order stream error`, e);
        await this.exchange.sleep(5000);
      }
    }
  }

  /** @private — watches balance and emits accountUpdate events */
  async _runBalanceStream() {
    while (this._streaming) {
      try {
        const balance = await this.exchange.watchBalance();

        const balances = [];
        for (const [currency, amount] of Object.entries(balance)) {
          if (['info', 'free', 'used', 'total', 'timestamp', 'datetime'].includes(currency)) continue;
          if (amount && amount.total > 0) {
            balances.push({
              asset: currency,
              walletBalance: String(amount.total || 0),
              balanceChange: '0',
            });
          }
        }

        if (balances.length > 0) {
          this.emit('accountUpdate', {
            reason: 'BALANCE_UPDATE',
            positions: [],
            balances,
          });
        }
      } catch (e) {
        if (!this._streaming) break;
        logger.logError(`${this.exchangeId} balance stream error`, e);
        await this.exchange.sleep(5000);
      }
    }
  }

  /** @private — watches tickers for subscribed symbols */
  async _runTickerStream() {
    while (this._streaming && this._tickerLoopRunning) {
      try {
        const symbols = Array.from(this._subscribedTickerSymbols);
        if (symbols.length === 0) {
          await this.exchange.sleep(1000);
          continue;
        }

        const tickers = await this.exchange.watchTickers(symbols);

        for (const [symbol, ticker] of Object.entries(tickers)) {
          this.emit('ticker', {
            symbol,
            close: parseFloat(ticker.last || ticker.close || 0),
            open: parseFloat(ticker.open || 0),
            high: parseFloat(ticker.high || 0),
            low: parseFloat(ticker.low || 0),
            volume: parseFloat(ticker.quoteVolume || ticker.baseVolume || 0),
          });
        }
      } catch (e) {
        if (!this._streaming) break;
        logger.logError(`${this.exchangeId} ticker stream error`, e);
        await this.exchange.sleep(3000);
      }
    }
  }

  /**
   * Check if this exchange has WebSocket support for a specific capability
   */
  hasStreaming(capability) {
    const map = {
      positions: 'watchPositions',
      orders: 'watchOrders',
      balance: 'watchBalance',
      tickers: 'watchTickers',
      trades: 'watchTrades',
      orderbook: 'watchOrderBook',
    };
    return !!this.exchange.has[map[capability] || capability];
  }
}

module.exports = CCXTProExchangeAPI;
