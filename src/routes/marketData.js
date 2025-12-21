/**
 * Market Data API Route
 * Provides OHLCV candles and technical indicators for ML validation
 * Used by SignalStudio for Phase 3 features
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { get1mOHLCV, calculateIndicators } = require('../ai-worker/utils/marketData_enhanced');

/**
 * GET /api/market-data/:exchange/:symbol
 * 
 * Query params:
 * - userId (required): User ID to fetch exchange credentials
 * - limit (optional): Number of candles to fetch (default: 100)
 * 
 * Returns:
 * {
 *   success: true,
 *   candles: [...],
 *   indicators: {...},
 *   symbol: "BTCUSDT",
 *   exchange: "binance",
 *   timestamp: "2024-01-01T00:00:00.000Z"
 * }
 */
router.get('/:exchange/:symbol', async (req, res) => {
  try {
    const { exchange, symbol } = req.params;
    const userId = req.query.userId;
    const limit = parseInt(req.query.limit) || 100;

    // Validate required params
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
        message: 'Please provide userId as a query parameter'
      });
    }

    if (!symbol || !exchange) {
      return res.status(400).json({
        success: false,
        error: 'symbol and exchange are required'
      });
    }

    logger.info(`Market data request: ${symbol}@${exchange} for user ${userId}`);

    // Fetch OHLCV candles
    const candles = await get1mOHLCV(userId, symbol, exchange, limit);

    if (!candles || candles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No market data available',
        message: `Exchange ${exchange} may not support ${symbol}, or credentials may be invalid`,
        symbol,
        exchange
      });
    }

    // Calculate technical indicators
    const indicators = calculateIndicators(candles);

    // Return data
    res.json({
      success: true,
      candles: candles.slice(-limit), // Ensure we return exactly the requested limit
      indicators,
      symbol,
      exchange,
      timestamp: new Date().toISOString(),
      candleCount: candles.length
    });
  } catch (error) {
    logger.logError('Market data endpoint error', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch market data'
    });
  }
});

/**
 * GET /api/market-data/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'market-data',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

