/**
 * Market Data Utilities for AI Worker - ENHANCED VERSION
 * 
 * Phase 1: Expanded feature engineering with 15+ technical indicators
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
 * Calculate SMA (Simple Moving Average)
 */
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Calculate RSI (Relative Strength Index) - Enhanced version
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - i] - prices[prices.length - i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
function calculateMACD(prices) {
  if (prices.length < 26) return { macd: null, signal: null, histogram: null };
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (!ema12 || !ema26) return { macd: null, signal: null, histogram: null };
  
  const macd = ema12 - ema26;
  
  // For signal line, we'd need to calculate EMA of MACD, but for simplicity:
  // Use a 9-period EMA approximation
  const signal = null; // Would need MACD history for this
  
  return {
    macd: macd,
    signal: signal,
    histogram: macd // Simplified
  };
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null };
  
  const sma = calculateSMA(prices, period);
  if (!sma) return { upper: null, middle: null, lower: null };
  
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
  const stdDeviation = Math.sqrt(variance);
  
  return {
    upper: sma + (stdDev * stdDeviation),
    middle: sma,
    lower: sma - (stdDev * stdDeviation)
  };
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return null;
  
  const atrSlice = trueRanges.slice(-period);
  return atrSlice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate OBV (On-Balance Volume)
 */
function calculateOBV(candles) {
  if (candles.length < 2) return null;
  
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv += candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv -= candles[i].volume;
    }
    // If close == prevClose, OBV stays the same
  }
  
  return obv;
}

/**
 * Calculate ADX (Average Directional Index) - Simplified
 */
function calculateADX(candles, period = 14) {
  if (candles.length < period + 1) return null;
  
  // Simplified ADX calculation
  // Full ADX requires +DI and -DI calculations
  const priceChanges = [];
  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;
    priceChanges.push({ highDiff, lowDiff });
  }
  
  // Simplified: return trend strength indicator
  const recent = priceChanges.slice(-period);
  const avgHighDiff = recent.reduce((sum, c) => sum + Math.max(0, c.highDiff), 0) / period;
  const avgLowDiff = recent.reduce((sum, c) => sum + Math.max(0, c.lowDiff), 0) / period;
  
  if (avgHighDiff + avgLowDiff === 0) return 0;
  const adx = Math.abs(avgHighDiff - avgLowDiff) / (avgHighDiff + avgLowDiff) * 100;
  
  return Math.min(100, Math.max(0, adx));
}

/**
 * Calculate Realized Volatility (standard deviation of returns)
 */
function calculateRealizedVolatility(prices, period = 20) {
  if (prices.length < period + 1) return null;
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  const recentReturns = returns.slice(-period);
  const meanReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  const variance = recentReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / recentReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(1440); // Annualized (1440 = minutes per day)
  
  return volatility * 100; // Return as percentage
}

/**
 * Calculate Volume SMA
 */
function calculateVolumeSMA(candles, period = 20) {
  if (candles.length < period) return null;
  const volumes = candles.slice(-period).map(c => c.volume);
  return volumes.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate price position within Bollinger Bands (%B)
 */
function calculateBBPercent(price, bb) {
  if (!bb.upper || !bb.lower || bb.upper === bb.lower) return null;
  return (price - bb.lower) / (bb.upper - bb.lower);
}

/**
 * ENHANCED: Calculate technical indicators from candles
 * Phase 1: Expanded from 3 to 15+ indicators
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
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];

  // Basic indicators (existing)
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  
  // Price change calculations
  const priceChange24h = closes.length >= 1440
    ? ((currentPrice - closes[closes.length - 1440]) / closes[closes.length - 1440]) * 100
    : closes.length >= 2
    ? ((currentPrice - closes[0]) / closes[0]) * 100
    : null;

  // NEW: Additional SMAs
  const sma5 = calculateSMA(closes, 5);
  const sma10 = calculateSMA(closes, 10);
  const sma100 = closes.length >= 100 ? calculateSMA(closes, 100) : null;
  
  // NEW: EMAs
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  // NEW: MACD
  const macd = calculateMACD(closes);
  
  // NEW: Bollinger Bands
  const bb = calculateBollingerBands(closes, 20, 2);
  const bbPercent = bb.middle ? calculateBBPercent(currentPrice, bb) : null;
  
  // NEW: ATR (volatility)
  const atr = calculateATR(candles, 14);
  const atrPercent = atr && currentPrice ? (atr / currentPrice) * 100 : null;
  
  // NEW: Volume indicators
  const volumeSMA20 = calculateVolumeSMA(candles, 20);
  const obv = calculateOBV(candles);
  const volumeRatio = volumeSMA20 && candles[candles.length - 1].volume 
    ? candles[candles.length - 1].volume / volumeSMA20 
    : null;
  
  // NEW: Volatility
  const realizedVol = calculateRealizedVolatility(closes, 20);
  
  // NEW: ADX (trend strength)
  const adx = calculateADX(candles, 14);
  
  // NEW: Price position indicators
  const priceAboveSMA20 = sma20 ? currentPrice > sma20 : null;
  const priceAboveSMA50 = sma50 ? currentPrice > sma50 : null;
  const sma20AboveSMA50 = sma20 && sma50 ? sma20 > sma50 : null;

  return {
    // Basic (existing)
    sma20,
    sma50,
    rsi,
    currentPrice,
    priceChange24h,
    
    // NEW: Additional SMAs
    sma5,
    sma10,
    sma100,
    
    // NEW: EMAs
    ema12,
    ema26,
    
    // NEW: MACD
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    
    // NEW: Bollinger Bands
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbPercent,
    
    // NEW: Volatility
    atr,
    atrPercent,
    realizedVolatility: realizedVol,
    
    // NEW: Volume
    volumeSMA20,
    obv,
    volumeRatio,
    currentVolume: candles[candles.length - 1].volume,
    
    // NEW: Trend
    adx,
    
    // NEW: Price position
    priceAboveSMA20,
    priceAboveSMA50,
    sma20AboveSMA50,
    
    // Metadata
    candleCount: candles.length,
    timestamp: candles[candles.length - 1].time
  };
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

