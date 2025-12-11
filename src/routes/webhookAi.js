/**
 * Internal AI Webhook Route
 * 
 * This endpoint is ONLY called by the internal AI worker (localhost).
 * It validates AI worker requests and forwards them to the existing webhook handler.
 * 
 * The AI worker sends signals here, which then flow through the same execution
 * pipeline as TradingView webhooks - zero changes to execution logic.
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { validateWebhookSecret } = require('../supabaseClient');

/**
 * Internal AI signal endpoint
 * POST /webhook/ai-signal
 * 
 * Body:
 * {
 *   user_id: string,
 *   secret: string,
 *   exchange: string,
 *   symbol: string,
 *   action: 'BUY' | 'SELL' | 'CLOSE',
 *   position_size_usd: number,
 *   strategy_id: string (optional),
 *   ai_confidence: number (optional),
 *   ai_reasoning: string (optional)
 * }
 */
router.post('/ai-signal', async (req, res) => {
  try {
    const { user_id, secret, exchange, symbol, action, position_size_usd, strategy_id, ai_confidence, ai_reasoning } = req.body;

    // Validate required fields
    if (!user_id || !secret || !exchange || !symbol || !action) {
      logger.warn('AI signal missing required fields', { body: req.body });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: user_id, secret, exchange, symbol, action'
      });
    }

    // Validate webhook secret (reuse existing function)
    const userCredential = validateWebhookSecret(secret);
    if (!userCredential || userCredential.userId !== user_id) {
      logger.warn('AI signal invalid webhook secret', { user_id, hasSecret: !!secret });
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook secret for user'
      });
    }

    logger.info('🤖 AI signal received', {
      user_id,
      exchange,
      symbol,
      action,
      position_size_usd,
      strategy_id,
      confidence: ai_confidence
    });

    // Format payload for main webhook handler
    // The AI worker will call /webhook directly with this validated payload
    const webhookPayload = {
      user_id: user_id,
      userId: user_id,
      exchange: exchange.toLowerCase(),
      symbol: symbol,
      action: action, // BUY, SELL, CLOSE
      position_size_usd: position_size_usd,
      strategy_id: strategy_id,
      source: 'ai_engine_v1',
      // AI-specific metadata (will be passed through)
      ai_confidence: ai_confidence,
      ai_reasoning: ai_reasoning
    };

    // Return validated payload - AI worker will POST this to /webhook
    res.json({
      success: true,
      message: 'AI signal validated',
      payload: webhookPayload
    });

  } catch (error) {
    logger.logError('AI Signal Webhook Error', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;

