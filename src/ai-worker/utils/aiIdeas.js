/**
 * AI Ideas Generator
 * Creates AI ideas from high-confidence trading signals
 * Used for marketing and premium features
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Create an AI idea from a trading decision
 * Only creates ideas for high-confidence signals (>= 70%)
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.strategyId - AI strategy ID
 * @param {Object} params.decision - Trading decision object
 * @param {Object} params.indicators - Technical indicators
 * @param {Object} params.marketSnapshot - Market snapshot
 * @param {number} params.similarTradeCount - Number of similar historical trades
 * @param {number} params.similarTradeWinRate - Win rate of similar trades
 * @returns {Promise<Object|null>} Created idea or null
 */
async function createAIIdea({
  userId,
  strategyId,
  decision,
  indicators,
  marketSnapshot,
  similarTradeCount,
  similarTradeWinRate
}) {
  try {
    // Only create ideas for high-confidence signals (>= 70%)
    if (!decision || decision.action === 'HOLD' || (decision.confidence || 0) < 70) {
      return null;
    }

    // Only create ideas for LONG or SHORT actions
    if (decision.action !== 'LONG' && decision.action !== 'SHORT') {
      return null;
    }

    // Calculate stop loss and take profit if not provided
    const entryPrice = indicators?.currentPrice || decision.entry_price;
    if (!entryPrice) {
      logger.warn('Cannot create AI idea: no entry price available');
      return null;
    }

    // Default stop loss and take profit percentages
    const stopLossPercent = decision.stop_loss_percent || 2.5;
    const takeProfitPercent = decision.take_profit_percent || 5.0;

    const stopLossPrice = decision.action === 'LONG'
      ? entryPrice * (1 - stopLossPercent / 100)
      : entryPrice * (1 + stopLossPercent / 100);

    const takeProfitPrice = decision.action === 'LONG'
      ? entryPrice * (1 + takeProfitPercent / 100)
      : entryPrice * (1 - takeProfitPercent / 100);

    // Create idea
    const { data: idea, error } = await supabase
      .from('ai_ideas')
      .insert({
        user_id: userId,
        ai_strategy_id: strategyId,
        symbol: decision.symbol,
        action: decision.action,
        confidence: (decision.confidence || 0) * 100, // Convert to percentage
        reasoning: decision.reasoning || 'AI analysis suggests this trading opportunity.',
        entry_price: entryPrice,
        stop_loss_price: stopLossPrice,
        take_profit_price: takeProfitPrice,
        stop_loss_percent: stopLossPercent,
        take_profit_percent: takeProfitPercent,
        exchange: decision.exchange || 'binance',
        status: 'active',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        similar_trade_count: similarTradeCount || null,
        similar_trade_win_rate: similarTradeWinRate || null,
        indicators: indicators || {},
        market_snapshot: marketSnapshot || {},
        trade_size_usd: 10.00, // Default $10 trade size
        trade_status: 'pending'
      })
      .select()
      .single();

    if (error) {
      logger.logError('Failed to create AI idea', error);
      return null;
    }

    logger.info(`💡 Created AI idea: ${idea.symbol} ${idea.action} (${idea.confidence}% confidence)`);
    
    // Check if user wants notifications and meets confidence threshold
    try {
      const { notifyAIIdea, getUserPreferences } = require('../../utils/notifications');
      const prefs = await getUserPreferences(userId);
      
      if (prefs?.notify_ai_ideas && idea.confidence >= (prefs.ai_ideas_min_confidence || 70)) {
        // Check frequency setting - for now, only instant notifications
        // Daily/weekly digests can be implemented later with a scheduled job
        const frequency = prefs.ai_ideas_frequency || 'instant';
        
        if (frequency === 'instant') {
          // Create notification immediately
          notifyAIIdea(
            userId,
            idea.id,
            idea.symbol,
            idea.action,
            idea.confidence,
            idea.entry_price
          );
        } else {
          // For daily/weekly, we'll implement digest later
          // For now, log that it would be queued
          logger.debug(`AI idea queued for ${frequency} digest (not yet implemented)`);
        }
      }
    } catch (notifError) {
      logger.warn('Failed to create AI idea notification (non-critical):', notifError.message);
      // Don't fail idea creation if notification fails
    }
    
    return idea;
  } catch (error) {
    logger.logError('Exception creating AI idea', error);
    return null;
  }
}

/**
 * Execute a small trade ($10) on an AI idea
 * @param {string} ideaId - AI idea ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Trade result or null
 */
async function executeIdeaTrade(ideaId, userId) {
  try {
    // Fetch idea
    const { data: idea, error: fetchError } = await supabase
      .from('ai_ideas')
      .select('*')
      .eq('id', ideaId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !idea) {
      logger.warn(`Cannot execute trade for idea ${ideaId}: idea not found`);
      return null;
    }

    // Check if already executed
    if (idea.trade_status === 'open' || idea.trade_status === 'closed') {
      logger.warn(`Idea ${ideaId} already has an active trade`);
      return null;
    }

    // Check if idea is still active
    if (idea.status !== 'active') {
      logger.warn(`Cannot execute trade: idea ${ideaId} is ${idea.status}`);
      return null;
    }

    // Get user's webhook secret
    const { data: credentials } = await supabase
      .from('bot_credentials')
      .select('webhook_secret')
      .eq('user_id', userId)
      .eq('exchange', 'webhook')
      .single();

    if (!credentials?.webhook_secret) {
      logger.warn(`Cannot execute trade: no webhook secret for user ${userId}`);
      return null;
    }

    // Prepare webhook payload for small trade
    const webhookPayload = {
      user_id: userId,
      userId: userId,
      secret: credentials.webhook_secret,
      exchange: idea.exchange || 'binance',
      symbol: idea.symbol,
      action: idea.action === 'LONG' ? 'BUY' : 'SELL',
      position_size_usd: idea.trade_size_usd || 10.00, // $10 trade
      source: 'ai_idea_auto',
      ai_idea_id: ideaId,
      // Add stop loss and take profit
      stop_loss_percent: idea.stop_loss_percent,
      take_profit_percent: idea.take_profit_percent
    };

    // Send to webhook
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
      timeout: 10000
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Failed to execute trade for idea ${ideaId}: ${errorText}`);
      
      // Update idea status to failed
      await supabase
        .from('ai_ideas')
        .update({ trade_status: 'failed' })
        .eq('id', ideaId);
      
      return null;
    }

    const result = await response.json();
    
    // Update idea with trade status
    await supabase
      .from('ai_ideas')
      .update({
        trade_status: 'open',
        status: 'executed',
        executed_at: new Date()
      })
      .eq('id', ideaId);

    logger.info(`✅ Executed $${idea.trade_size_usd} trade for idea ${ideaId}`);
    return result;
  } catch (error) {
    logger.logError(`Exception executing trade for idea ${ideaId}`, error);
    return null;
  }
}

module.exports = {
  createAIIdea,
  executeIdeaTrade
};

