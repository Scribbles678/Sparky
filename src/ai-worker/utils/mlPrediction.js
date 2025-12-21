/**
 * ML Prediction Utility
 * 
 * Phase 2: Integration with Arthur ML Service
 * Supports both global and per-strategy ML models
 */

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

// ML Service Configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001';
const ML_SERVICE_TIMEOUT = 5000; // 5 seconds
const ML_SERVICE_RETRIES = 2;

/**
 * Convert technical indicators to ML feature format
 * @param {Object} indicators - Technical indicators from calculateIndicators()
 * @param {Object} orderbook - Orderbook snapshot (optional)
 * @param {Array} positions - Current positions
 * @param {Object} strategy - Strategy configuration
 * @returns {Object} ML feature object matching FastAPI schema
 */
function prepareMLFeatures(indicators, orderbook, positions, strategy) {
  const now = new Date();
  
  return {
    // Technical indicators
    sma20: indicators.sma20 || null,
    sma50: indicators.sma50 || null,
    rsi: indicators.rsi || null,
    
    // Additional SMAs
    sma5: indicators.sma5 || null,
    sma10: indicators.sma10 || null,
    sma100: indicators.sma100 || null,
    
    // EMAs
    ema12: indicators.ema12 || null,
    ema26: indicators.ema26 || null,
    
    // MACD
    macd: indicators.macd || null,
    macd_signal: indicators.macdSignal || null,
    macd_histogram: indicators.macdHistogram || null,
    
    // Bollinger Bands
    bb_upper: indicators.bbUpper || null,
    bb_middle: indicators.bbMiddle || null,
    bb_lower: indicators.bbLower || null,
    bb_percent: indicators.bbPercent || null,
    
    // Volatility
    atr: indicators.atr || null,
    atr_percent: indicators.atrPercent || null,
    realized_volatility: indicators.realizedVolatility || null,
    
    // Volume
    volume_sma20: indicators.volumeSMA20 || null,
    obv: indicators.obv || null,
    volume_ratio: indicators.volumeRatio || null,
    
    // Trend
    adx: indicators.adx || null,
    
    // Price position
    price_above_sma20: indicators.priceAboveSMA20 ? 1 : 0,
    price_above_sma50: indicators.priceAboveSMA50 ? 1 : 0,
    sma20_above_sma50: indicators.sma20AboveSMA50 ? 1 : 0,
    
    // Current price
    current_price: indicators.currentPrice || null,
    price_change_24h: indicators.priceChange24h || null,
    
    // Orderbook features
    spread_bps: orderbook?.spread_bps || null,
    imbalance_ratio: orderbook?.imbalance_ratio || null,
    mid_price: orderbook?.mid_price || null,
    
    // Portfolio state
    position_count: positions?.length || 0,
    total_unrealized_pnl: positions?.reduce((sum, p) => sum + (p.unrealized_pnl_usd || 0), 0) || 0,
    
    // LLM features (will be 0 for ML prediction, but included for consistency)
    llm_action_encoded: 0,
    llm_size_usd: null,
    llm_confidence: null,
    
    // Time features
    hour_of_day: now.getHours(),
    day_of_week: now.getDay(), // 0=Sunday, 6=Saturday
    is_weekend: (now.getDay() === 0 || now.getDay() === 6) ? 1 : 0,
    is_market_hours: (now.getHours() >= 9 && now.getHours() < 17) ? 1 : 0,
  };
}

/**
 * Call ML service for prediction (Phase 2: Per-Strategy Models)
 * @param {Object} features - ML features object
 * @param {string} strategyId - Strategy ID (for per-strategy model lookup)
 * @returns {Promise<Object>} ML prediction result
 */
async function getMLPrediction(features, strategyId = null) {
  const startTime = Date.now();
  
  // Phase 2: Use per-strategy endpoint if strategyId provided
  const endpoint = strategyId 
    ? `${ML_SERVICE_URL}/predict-strategy`
    : `${ML_SERVICE_URL}/predict`;
  
  const requestBody = strategyId
    ? { strategy_id: strategyId, market_data: features }
    : features;
  
  for (let attempt = 0; attempt < ML_SERVICE_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ML_SERVICE_TIMEOUT);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ML service error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      const latency = Date.now() - startTime;
      
      logger.debug(`ML prediction received in ${latency}ms`, {
        confidence: result.confidence,
        action: result.action,
        should_execute: result.should_execute,
        model_type: result.model_type || 'global',
        strategy_id: strategyId
      });
      
      return {
        success: true,
        confidence: result.confidence,
        action: result.action,
        probability: result.probability,
        should_execute: result.should_execute,
        model_version: result.model_version,
        model_type: result.model_type || 'global',
        latency: latency,
      };
      
    } catch (error) {
      if (attempt === ML_SERVICE_RETRIES - 1) {
        logger.warn(`ML prediction failed after ${ML_SERVICE_RETRIES} attempts:`, error.message);
        return {
          success: false,
          error: error.message,
          latency: Date.now() - startTime,
        };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

/**
 * Check if ML service is available
 * @returns {Promise<boolean>}
 */
async function checkMLServiceHealth() {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`, {
      method: 'GET',
      timeout: 2000,
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Convert ML prediction to decision format (compatible with parseDecision output)
 * @param {Object} mlPrediction - ML prediction result
 * @param {string} symbol - Symbol to trade
 * @param {Object} strategy - Strategy configuration
 * @returns {Object} Decision object compatible with existing format
 */
function mlPredictionToDecision(mlPrediction, symbol, strategy) {
  // ML predicts profitable (LONG) or not profitable (HOLD)
  // For now, we'll use ML confidence to determine action
  // In future, can train ML to predict LONG/SHORT/HOLD directly
  
  const action = mlPrediction.action || 'HOLD';
  const confidence = mlPrediction.confidence || 0.5;
  
  // Calculate position size based on confidence and strategy
  // This is a simplified version - can be enhanced
  const baseSize = 1000; // Base position size in USD
  const sizeUsd = action !== 'HOLD' 
    ? Math.round(baseSize * confidence) 
    : 0;
  
  const modelType = mlPrediction.model_type === 'strategy_specific' ? 'strategy-specific' : 'global';
  
  return {
    action: action,
    symbol: symbol,
    size_usd: sizeUsd,
    confidence: confidence,
    reasoning: `ML prediction (${modelType}): ${(confidence * 100).toFixed(1)}% confidence (${mlPrediction.model_version || 'unknown'})`
  };
}

module.exports = {
  prepareMLFeatures,
  getMLPrediction,
  checkMLServiceHealth,
  mlPredictionToDecision,
};
