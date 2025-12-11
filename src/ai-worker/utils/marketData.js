/**
 * Market Data Utilities for AI Worker
 * 
 * Fetches price data, OHLCV candles, calculates technical indicators,
 * and gets orderbook snapshots for ML-ready logging.
 */

const logger = require('../../utils/logger');
const ExchangeFactory = require('../../exchanges/ExchangeFactory');

/**
 * Get 1-minute OHLCV candles for symbol
 */
async function get1mOHLCV(userId, symbol, exchange = 'aster', limit = 100) {
  try {
    const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
    if (!exchangeApi) {
      throw new Error(`No ${exchange} credentials found for user ${userId}`);
    }

    if (exchange === 'aster') {
      if (typeof exchangeApi.getKlines === 'function') {
        const candles = await exchangeApi.getKlines(symbol, '1m', limit);
        return candles.map(c => ({
          time: c[0],
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5])
        }));
      }
    }

    // Fallback for other exchanges or missing klines
    logger.warn(`OHLCV fallback for ${symbol}@${exchange}`);
    const ticker = await exchangeApi.getTicker(symbol);
    const price = parseFloat(ticker.lastPrice || ticker.price || ticker.close);
    return [{
      time: Date.now(),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0
    }];
  } catch (error) {
    logger.logError(`Failed to fetch OHLCV ${symbol}`, error);
    return [];
  }
}

/**
 * Get current ticker price
 */
async function getCurrentPrice(userId, symbol, exchange = 'aster') {
  try {
    const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
    if (!exchangeApi) return null;

    const ticker = await exchangeApi.getTicker(symbol);
    return parseFloat(ticker.lastPrice || ticker.price || ticker.close);
  } catch (error) {
    logger.logError(`Failed to fetch price ${symbol}`, error);
    return null;
  }
}

/**
 * Get user's current positions from Supabase
 */
async function getUserPositions(userId) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data || [];
  } catch (error) {
    logger.logError('Failed to fetch user positions', error);
    return [];
  }
}

/**
 * Calculate technical indicators from candles
 */
function calculateIndicators(candles) {
  if (!candles || candles.length < 2) {
    return {
      sma20: null,
      sma50: null,
      rsi: null,
      currentPrice: candles?.[candles.length - 1]?.close || null,
      priceChange24h: null
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const sma20 = closes.length >= 20
    ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : null;

  const sma50 = closes.length >= 50
    ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
    : null;

  const rsi = calculateRSI(closes.slice(-15)); // 14-period + current

  const priceChange24h = closes.length >= 1440
    ? ((currentPrice - closes[closes.length - 1440]) / closes[closes.length - 1440]) * 100
    : closes.length >= 2
    ? ((currentPrice - closes[0]) / closes[0]) * 100
    : null;

  return {
    sma20,
    sma50,
    rsi,
    currentPrice,
    priceChange24h
  };
}

/**
 * RSI helper
 */
function calculateRSI(prices) {
  if (prices.length < 14) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Get orderbook snapshot — critical for Tier 2+ ML models
 */
async function getOrderBookSnapshot(userId, symbol, exchange = 'aster', depth = 10) {
  try {
    const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
    if (!exchangeApi || typeof exchangeApi.fetchOrderBook !== 'function') {
      return null;
    }

    const ob = await exchangeApi.fetchOrderBook(symbol, { limit: depth * 2 });

    const bids = ob.bids.slice(0, depth).map(b => ({ price: Number(b[0]), amount: Number(b[1]) }));
    const asks = ob.asks.slice(0, depth).map(a => ({ price: Number(a[0]), amount: Number(a[1]) }));

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;

    return {
      symbol,
      timestamp: Date.now(),
      bids,
      asks,
      spread_bps: bestAsk && bestBid ? ((bestAsk - bestBid) / bestBid) * 10000 : null,
      mid_price: (bestBid + bestAsk) / 2 || null,
      imbalance_ratio: bids.reduce((s, b) => s + b.amount, 0) / asks.reduce((s, a) => s + a.amount, 0) || 1
    };
  } catch (error) {
    logger.warn(`Orderbook failed for ${symbol}: ${error.message}`);
    return null;
  }
}

// Export everything
module.exports = {
  get1mOHLCV,
  getCurrentPrice,
  getUserPositions,
  calculateIndicators,
  getOrderBookSnapshot
};