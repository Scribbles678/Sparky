/**
 * Data Validation Utilities for AI Worker
 * 
 * Phase 1: Validate market data quality before making decisions
 * - Missing candles check
 * - Stale data detection
 * - Data freshness validation
 */

const logger = require('../../utils/logger');

/**
 * Check if candles data is valid
 * @param {Array} candles - Array of candle objects
 * @param {number} minRequired - Minimum number of candles required
 * @returns {{valid: boolean, reason?: string}}
 */
function validateCandles(candles, minRequired = 50) {
  if (!candles || !Array.isArray(candles)) {
    return { valid: false, reason: 'Candles is not an array' };
  }

  if (candles.length < minRequired) {
    return { 
      valid: false, 
      reason: `Insufficient candles: ${candles.length} < ${minRequired}` 
    };
  }

  // Check for missing required fields
  const requiredFields = ['time', 'open', 'high', 'low', 'close', 'volume'];
  for (const candle of candles.slice(-10)) { // Check last 10 candles
    for (const field of requiredFields) {
      if (candle[field] === undefined || candle[field] === null) {
        return { 
          valid: false, 
          reason: `Missing field '${field}' in candle at time ${candle.time}` 
        };
      }
    }
  }

  // Check for invalid prices (negative, zero, NaN)
  for (const candle of candles) {
    const priceFields = ['open', 'high', 'low', 'close'];
    for (const field of priceFields) {
      const value = candle[field];
      if (value <= 0 || isNaN(value) || !isFinite(value)) {
        return { 
          valid: false, 
          reason: `Invalid ${field} price: ${value}` 
        };
      }
    }
    
    // Check high >= low
    if (candle.high < candle.low) {
      return { 
        valid: false, 
        reason: `Invalid OHLC: high (${candle.high}) < low (${candle.low})` 
      };
    }
    
    // Check close is within high/low range
    if (candle.close > candle.high || candle.close < candle.low) {
      return { 
        valid: false, 
        reason: `Close price (${candle.close}) outside high/low range` 
      };
    }
  }

  return { valid: true };
}

/**
 * Check if data is stale (too old)
 * @param {Array} candles - Array of candle objects
 * @param {number} maxAgeMinutes - Maximum age in minutes (default: 5 minutes)
 * @returns {{stale: boolean, ageMinutes?: number}}
 */
function checkDataFreshness(candles, maxAgeMinutes = 5) {
  if (!candles || candles.length === 0) {
    return { stale: true, reason: 'No candles to check' };
  }

  const latestCandle = candles[candles.length - 1];
  const latestTime = latestCandle.time;
  const now = Date.now();
  
  // Handle both timestamp formats (milliseconds or seconds)
  const candleTime = typeof latestTime === 'number' 
    ? (latestTime > 1e12 ? latestTime : latestTime * 1000) // Convert seconds to ms if needed
    : new Date(latestTime).getTime();
  
  const ageMinutes = (now - candleTime) / (1000 * 60);
  
  if (ageMinutes > maxAgeMinutes) {
    return { 
      stale: true, 
      ageMinutes: Math.round(ageMinutes * 10) / 10,
      reason: `Data is ${Math.round(ageMinutes)} minutes old (max: ${maxAgeMinutes} minutes)`
    };
  }

  return { stale: false, ageMinutes: Math.round(ageMinutes * 10) / 10 };
}

/**
 * Check for suspicious price movements (potential data errors)
 * @param {Array} candles - Array of candle objects
 * @param {number} maxChangePercent - Maximum allowed change per candle (default: 50%)
 * @returns {{suspicious: boolean, reason?: string}}
 */
function checkPriceAnomalies(candles, maxChangePercent = 50) {
  if (!candles || candles.length < 2) {
    return { suspicious: false };
  }

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    // Check for extreme price jumps
    const changePercent = Math.abs((curr.close - prev.close) / prev.close) * 100;
    
    if (changePercent > maxChangePercent) {
      return {
        suspicious: true,
        reason: `Extreme price movement: ${changePercent.toFixed(2)}% change from ${prev.close} to ${curr.close}`
      };
    }
  }

  return { suspicious: false };
}

/**
 * Comprehensive data validation
 * @param {Array} candles - Array of candle objects
 * @param {Object} indicators - Technical indicators object
 * @returns {{valid: boolean, reason?: string, checks: Object}}
 */
function validateMarketData(candles, indicators) {
  const checks = {};

  // 1. Validate candles
  const candleCheck = validateCandles(candles);
  checks.candles = candleCheck;
  if (!candleCheck.valid) {
    return {
      valid: false,
      reason: candleCheck.reason,
      checks
    };
  }

  // 2. Check data freshness
  const freshnessCheck = checkDataFreshness(candles);
  checks.freshness = freshnessCheck;
  if (freshnessCheck.stale) {
    return {
      valid: false,
      reason: freshnessCheck.reason || 'Data is stale',
      checks
    };
  }

  // 3. Check for price anomalies
  const anomalyCheck = checkPriceAnomalies(candles);
  checks.anomalies = anomalyCheck;
  if (anomalyCheck.suspicious) {
    logger.warn('⚠️ Price anomaly detected:', anomalyCheck.reason);
    // Don't fail on anomalies, just warn (could be legitimate market moves)
  }

  // 4. Validate indicators
  if (indicators) {
    const requiredIndicators = ['currentPrice'];
    for (const indicator of requiredIndicators) {
      if (indicators[indicator] === undefined || indicators[indicator] === null) {
        return {
          valid: false,
          reason: `Missing required indicator: ${indicator}`,
          checks
        };
      }
    }
  }

  return {
    valid: true,
    checks
  };
}

module.exports = {
  validateCandles,
  checkDataFreshness,
  checkPriceAnomalies,
  validateMarketData
};

