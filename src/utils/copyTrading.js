/**
 * Copy Trading Fan-Out Engine
 * 
 * When a leader's trade executes successfully, this module:
 * 1. Finds all active followers copying this strategy
 * 2. Scales position sizes based on allocation %
 * 3. Executes trades for each follower
 * 4. Logs copied trades for billing
 */

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const logger = require('./logger');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';

/**
 * Fan-out a leader's trade to all active followers
 * 
 * @param {Object} leaderTrade - The leader's trade data
 * @param {string} leaderTrade.userId - Leader's user ID
 * @param {string} leaderTrade.strategyId - Strategy ID that was traded
 * @param {string} leaderTrade.exchange - Exchange name
 * @param {string} leaderTrade.symbol - Trading symbol
 * @param {string} leaderTrade.action - Trade action (BUY/SELL/CLOSE)
 * @param {number} leaderTrade.positionSizeUsd - Leader's position size in USD
 * @param {Object} leaderTrade.result - Trade execution result
 * @param {string} leaderTrade.originalTradeId - Trade ID from trades table (if available)
 * @returns {Promise<Object>} Summary of fan-out results
 */
async function fanOutToFollowers(leaderTrade) {
  const {
    userId: leaderUserId,
    strategyId,
    exchange,
    symbol,
    action,
    positionSizeUsd,
    result,
    originalTradeId
  } = leaderTrade;

  // Only fan-out if trade was successful
  if (!result || !result.success) {
    logger.debug('Skipping fan-out: leader trade was not successful');
    return {
      success: true,
      followersProcessed: 0,
      followersSucceeded: 0,
      followersFailed: 0,
      reason: 'leader_trade_failed'
    };
  }

  // Only fan-out for AI strategies (for now)
  // Can extend to regular strategies later
  if (!strategyId) {
    logger.debug('Skipping fan-out: no strategy_id provided');
    return {
      success: true,
      followersProcessed: 0,
      followersSucceeded: 0,
      followersFailed: 0,
      reason: 'no_strategy_id'
    };
  }

  try {
    // Get leader's strategy info (to get override fee, etc.)
    const { data: strategy, error: strategyError } = await supabase
      .from('ai_strategies')
      .select('id, user_id, name, copy_override_percent, is_public_leader')
      .eq('id', strategyId)
      .maybeSingle();

    if (strategyError) {
      logger.logError('Failed to fetch strategy for fan-out', strategyError);
      return {
        success: false,
        error: 'Failed to fetch strategy'
      };
    }

    if (!strategy || !strategy.is_public_leader) {
      logger.debug(`Skipping fan-out: strategy ${strategyId} is not public`);
      return {
        success: true,
        followersProcessed: 0,
        followersSucceeded: 0,
        followersFailed: 0,
        reason: 'strategy_not_public'
      };
    }

    // Get all active followers for this strategy
    const { data: followers, error: followersError } = await supabase
      .from('copy_relationships')
      .select('id, follower_user_id, allocation_percent, max_drawdown_stop, current_drawdown_percent')
      .eq('leader_strategy_id', strategyId)
      .eq('status', 'active');

    if (followersError) {
      logger.logError('Failed to fetch followers for fan-out', followersError);
      return {
        success: false,
        error: 'Failed to fetch followers'
      };
    }

    if (!followers || followers.length === 0) {
      logger.debug(`No active followers for strategy ${strategyId}`);
      return {
        success: true,
        followersProcessed: 0,
        followersSucceeded: 0,
        followersFailed: 0,
        reason: 'no_followers'
      };
    }

    logger.info(`📤 Fan-out: Executing trade for ${followers.length} follower(s)`, {
      strategyId,
      symbol,
      action,
      leaderSize: positionSizeUsd
    });

    // Get leader's webhook secret (needed for follower trades)
    const { data: leaderCredential } = await supabase
      .from('bot_credentials')
      .select('webhook_secret')
      .eq('user_id', leaderUserId)
      .eq('exchange', 'webhook')
      .eq('environment', 'production')
      .maybeSingle();

    if (!leaderCredential || !leaderCredential.webhook_secret) {
      logger.warn(`No webhook secret found for leader ${leaderUserId}, skipping fan-out`);
      return {
        success: false,
        error: 'Leader webhook secret not found'
      };
    }

    // Process each follower asynchronously
    const fanOutPromises = followers.map(async (follower) => {
      try {
        // PHASE 2: Enhanced validation checks
        
        // Check if relationship is still active (double-check status)
        if (follower.status !== 'active') {
          logger.debug(`Skipping follower ${follower.follower_user_id}: relationship status is ${follower.status}`);
          return {
            followerId: follower.follower_user_id,
            success: false,
            reason: `relationship_${follower.status}`
          };
        }
        
        // Check max drawdown (skip if exceeded)
        if (follower.current_drawdown_percent >= follower.max_drawdown_stop) {
          logger.debug(`Skipping follower ${follower.follower_user_id}: drawdown exceeded (${follower.current_drawdown_percent.toFixed(2)}% >= ${follower.max_drawdown_stop}%)`);
          
          // Auto-pause if not already paused (safety check)
          if (follower.status === 'active') {
            await supabase
              .from('copy_relationships')
              .update({ 
                status: 'paused',
                paused_at: new Date().toISOString()
              })
              .eq('id', follower.id);
          }
          
          return {
            followerId: follower.follower_user_id,
            success: false,
            reason: 'drawdown_exceeded',
            details: {
              currentDrawdown: follower.current_drawdown_percent,
              maxDrawdown: follower.max_drawdown_stop
            }
          };
        }

        // Calculate scaled position size
        const scaledSizeUsd = positionSizeUsd * (follower.allocation_percent / 100);

        // =====================================================================
        // PHASE 2: Margin Validation
        // =====================================================================
        // Check if follower has sufficient margin before executing trade
        // This prevents failed trades and improves user experience
        // =====================================================================
        try {
          // Get follower's exchange credentials to check margin
          const { getUserExchangeCredentials } = require('../supabaseClient');
          const followerCredentials = await getUserExchangeCredentials(follower.follower_user_id, exchange);
          
          if (followerCredentials) {
            // Create exchange API instance for follower
            const ExchangeFactory = require('../exchanges/ExchangeFactory');
            const followerExchangeApi = await ExchangeFactory.createExchangeForUser(follower.follower_user_id, exchange);
            
            if (followerExchangeApi) {
              const availableMargin = await followerExchangeApi.getAvailableMargin();
              
              // Check if we have enough margin (with 20% buffer)
              const minMarginPercent = 20; // Keep 20% margin buffer
              const requiredMargin = scaledSizeUsd;
              const marginAfterTrade = availableMargin - requiredMargin;
              const minRequiredMargin = (availableMargin * minMarginPercent) / 100;
              
              if (marginAfterTrade < minRequiredMargin) {
                logger.warn(`Insufficient margin for follower ${follower.follower_user_id}`, {
                  available: availableMargin,
                  required: requiredMargin,
                  minRequired: minRequiredMargin,
                  marginAfter: marginAfterTrade
                });
                
                // Log failed copied trade for transparency
                await logCopiedTrade({
                  copyRelationshipId: follower.id,
                  followerUserId: follower.follower_user_id,
                  leaderUserId: leaderUserId,
                  leaderStrategyId: strategyId,
                  symbol,
                  side: action,
                  leaderSizeUsd: positionSizeUsd,
                  followerSizeUsd: scaledSizeUsd,
                  originalTradeId: originalTradeId,
                  followerTradeId: null,
                  success: false,
                  error: `Insufficient margin: ${availableMargin.toFixed(2)} available, ${requiredMargin.toFixed(2)} required`
                });
                
                return {
                  followerId: follower.follower_user_id,
                  success: false,
                  reason: 'insufficient_margin',
                  details: {
                    available: availableMargin,
                    required: requiredMargin
                  }
                };
              }
              
              logger.debug(`Margin check passed for follower ${follower.follower_user_id}`, {
                available: availableMargin,
                required: requiredMargin
              });
            }
          }
        } catch (marginError) {
          // If margin check fails, log but don't block trade execution
          // The webhook handler will also check margin, so this is a pre-check
          logger.debug(`Margin check failed for follower ${follower.follower_user_id}, will rely on webhook validation`, marginError.message);
        }

        // Get follower's webhook secret
        const { data: followerCredential } = await supabase
          .from('bot_credentials')
          .select('webhook_secret')
          .eq('user_id', follower.follower_user_id)
          .eq('exchange', 'webhook')
          .eq('environment', 'production')
          .maybeSingle();

        if (!followerCredential || !followerCredential.webhook_secret) {
          logger.warn(`No webhook secret for follower ${follower.follower_user_id}`);
          return {
            followerId: follower.follower_user_id,
            success: false,
            reason: 'no_webhook_secret'
          };
        }

        // Prepare webhook payload for follower
        const followerPayload = {
          user_id: follower.follower_user_id,
          userId: follower.follower_user_id,
          secret: followerCredential.webhook_secret,
          exchange: exchange.toLowerCase(),
          symbol: symbol,
          action: action, // BUY, SELL, CLOSE
          position_size_usd: scaledSizeUsd,
          strategy_id: strategyId,
          source: 'copy_trading',
          copied_from_strategy_id: strategyId,
          copied_from_user_id: leaderUserId,
          copy_relationship_id: follower.id
        };

        // Execute follower's trade by calling webhook endpoint
        logger.debug(`Executing copied trade for follower ${follower.follower_user_id}`, {
          symbol,
          action,
          size: scaledSizeUsd,
          allocation: follower.allocation_percent
        });

        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(followerPayload),
          timeout: 10000 // 10 second timeout
        });

        const responseData = await response.json();

        if (!response.ok || !responseData.success) {
          logger.warn(`Follower trade failed: ${follower.follower_user_id}`, {
            status: response.status,
            error: responseData.error
          });

          // Log failed copied trade
          await logCopiedTrade({
            copyRelationshipId: follower.id,
            followerUserId: follower.follower_user_id,
            leaderUserId: leaderUserId,
            leaderStrategyId: strategyId,
            symbol,
            side: action,
            leaderSizeUsd: positionSizeUsd,
            followerSizeUsd: scaledSizeUsd,
            originalTradeId: originalTradeId,
            success: false,
            error: responseData.error || 'Unknown error'
          });

          return {
            followerId: follower.follower_user_id,
            success: false,
            reason: responseData.error || 'execution_failed'
          };
        }

        // Trade executed successfully - log to copied_trades
        // Note: follower_trade_id will be updated when trade closes (via updateCopiedTradePnl)
        await logCopiedTrade({
          copyRelationshipId: follower.id,
          followerUserId: follower.follower_user_id,
          leaderUserId: leaderUserId,
          leaderStrategyId: strategyId,
          symbol,
          side: action,
          leaderSizeUsd: positionSizeUsd,
          followerSizeUsd: scaledSizeUsd,
          originalTradeId: originalTradeId,
          followerTradeId: null, // Will be updated when trade closes
          success: true
        });

        logger.info(`✅ Follower trade executed: ${follower.follower_user_id}`, {
          symbol,
          size: scaledSizeUsd
        });

        return {
          followerId: follower.follower_user_id,
          success: true
        };

      } catch (error) {
        logger.logError(`Fan-out error for follower ${follower.follower_user_id}`, error);
        return {
          followerId: follower.follower_user_id,
          success: false,
          reason: error.message
        };
      }
    });

    // Wait for all fan-out operations to complete
    const results = await Promise.allSettled(fanOutPromises);
    
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - succeeded;

    logger.info(`📊 Fan-out complete: ${succeeded} succeeded, ${failed} failed`, {
      strategyId,
      symbol,
      totalFollowers: followers.length
    });

    return {
      success: true,
      followersProcessed: followers.length,
      followersSucceeded: succeeded,
      followersFailed: failed,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, reason: 'promise_rejected' })
    };

  } catch (error) {
    logger.logError('Fan-out engine error', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Log a copied trade to the database
 * 
 * @param {Object} tradeData - Copied trade data
 */
async function logCopiedTrade(tradeData) {
  try {
    const {
      copyRelationshipId,
      followerUserId,
      leaderUserId,
      leaderStrategyId,
      symbol,
      side,
      leaderSizeUsd,
      followerSizeUsd,
      originalTradeId,
      followerTradeId,
      success,
      error
    } = tradeData;

    const { error: insertError } = await supabase
      .from('copied_trades')
      .insert({
        copy_relationship_id: copyRelationshipId,
        follower_user_id: followerUserId,
        leader_user_id: leaderUserId,
        leader_strategy_id: leaderStrategyId,
        symbol: symbol,
        side: side,
        leader_size_usd: leaderSizeUsd,
        follower_size_usd: followerSizeUsd,
        original_trade_id: originalTradeId || null,
        follower_trade_id: followerTradeId || null,
        // P&L will be updated when trade closes
        pnl_usd: 0,
        entry_time: new Date().toISOString()
      });

    if (insertError) {
      logger.logError('Failed to log copied trade', insertError);
    } else {
      logger.debug('Copied trade logged', { copyRelationshipId, symbol, side });
    }
  } catch (error) {
    logger.logError('Exception logging copied trade', error);
  }
}

/**
 * Update copied trade with P&L when follower's trade closes
 * 
 * @param {string} followerTradeId - Follower's trade ID from trades table
 * @param {Object} tradeResult - Trade result with P&L
 */
async function updateCopiedTradePnl(followerTradeId, tradeResult) {
  try {
    if (!followerTradeId || !tradeResult) return;

    const { pnl_usd, pnl_percent, is_winner, exit_time } = tradeResult;

    // First, try to find copied trade by follower_trade_id
    // If not found, try to find by symbol and copy_relationship_id (for trades that were logged before follower_trade_id was set)
    let copiedTrade = null;
    
    const { data: foundByTradeId } = await supabase
      .from('copied_trades')
      .select('id, copy_relationship_id, leader_strategy_id')
      .eq('follower_trade_id', followerTradeId)
      .maybeSingle();

    if (foundByTradeId) {
      copiedTrade = foundByTradeId;
    } else {
      // Fallback: find by strategy and recent timestamp (within last hour)
      // This handles cases where follower_trade_id wasn't set initially
      const { data: foundByStrategy } = await supabase
        .from('copied_trades')
        .select('id, copy_relationship_id, leader_strategy_id')
        .eq('leader_strategy_id', tradeResult.strategyId || null)
        .is('follower_trade_id', null)
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      copiedTrade = foundByStrategy;
    }

    if (!copiedTrade) {
      logger.debug(`No copied trade found for follower trade ${followerTradeId}`);
      return;
    }

    // Get strategy override fee
    const { data: strategy } = await supabase
      .from('ai_strategies')
      .select('copy_override_percent')
      .eq('id', copiedTrade.leader_strategy_id)
      .maybeSingle();

    const overridePercent = strategy?.copy_override_percent || 15.00;
    
    // =====================================================================
    // PHASE 3: High-Water Mark (HWM) Compliance
    // =====================================================================
    // Legal requirement: Fees only on new profits above highest peak
    // Prevents charging fees on recovered losses
    // 
    // How it works:
    // 1. Track highest equity peak (HWM) per relationship
    // 2. Calculate current equity = initial + all P&L
    // 3. Fee only on: max(0, currentEquity - hwmEquity)
    // 4. Update HWM if current equity exceeds it
    // =====================================================================
    
    // Get relationship's high-water mark (highest equity peak)
    const { data: relationship } = await supabase
      .from('copy_relationships')
      .select('id, hwm_equity')
      .eq('id', copiedTrade.copy_relationship_id)
      .maybeSingle();

    let hwmEquity = parseFloat(relationship?.hwm_equity || 0);
    
    // Get all closed trades for this relationship (including this one)
    const { data: allTrades } = await supabase
      .from('copied_trades')
      .select('pnl_usd, follower_size_usd, exit_time')
      .eq('copy_relationship_id', copiedTrade.copy_relationship_id)
      .not('exit_time', 'is', null)
      .order('exit_time', { ascending: true });

    if (!allTrades || allTrades.length === 0) {
      logger.debug('No closed trades found for HWM calculation');
      // Fallback: no HWM, charge fee on this trade's profit
      const overrideFeeCharged = pnl_usd > 0 ? pnl_usd * (overridePercent / 100) : 0;
      const platformFeeUsd = overrideFeeCharged * 0.4;
      const leaderFeeUsd = overrideFeeCharged * 0.6;
      
      // Update copied trade with fees
      await supabase
        .from('copied_trades')
        .update({
          override_fee_charged: overrideFeeCharged,
          platform_fee_usd: platformFeeUsd,
          leader_fee_usd: leaderFeeUsd
        })
        .eq('id', copiedTrade.id);
      
      return;
    }

    // Get initial allocation (first trade size)
    const firstTrade = allTrades[0];
    const initialAllocation = parseFloat(firstTrade.follower_size_usd || 0);
    
    // Calculate current equity (initial + all P&L including this trade)
    const totalPnl = (allTrades || []).reduce((sum, t) => sum + (parseFloat(t.pnl_usd || 0)), 0);
    const currentEquity = initialAllocation + totalPnl;
    
    // Previous HWM (before this trade closed)
    // If no HWM set, use initial allocation as baseline
    const previousHWM = hwmEquity > 0 ? hwmEquity : initialAllocation;
    
    // Calculate fee only on profits above previous HWM
    // Example: HWM was $1,000, current equity is $1,200 → fee on $200
    const profitAboveHWM = Math.max(0, currentEquity - previousHWM);
    
    // Calculate fees (only on profit above previous HWM)
    let overrideFeeCharged = 0;
    let platformFeeUsd = 0;
    let leaderFeeUsd = 0;

    if (profitAboveHWM > 0 && pnl_usd > 0) {
      // Fee is calculated on the profit above HWM
      // This trade contributed to going above HWM, so fee on that portion
      // Simplified: if current equity > previous HWM, fee on the difference
      // For this specific trade, calculate proportional fee based on its contribution
      const tradeContribution = Math.min(pnl_usd, profitAboveHWM);
      
      if (tradeContribution > 0) {
        overrideFeeCharged = tradeContribution * (overridePercent / 100);
        platformFeeUsd = overrideFeeCharged * 0.4; // Platform gets 40%
        leaderFeeUsd = overrideFeeCharged * 0.6; // Leader gets 60%
      }
    }
    
    // Update HWM if current equity exceeds it (after calculating fee)
    if (currentEquity > previousHWM) {
      await supabase
        .from('copy_relationships')
        .update({ hwm_equity: currentEquity })
        .eq('id', copiedTrade.copy_relationship_id);
      
      logger.debug(`Updated HWM for relationship ${copiedTrade.copy_relationship_id}: ${previousHWM.toFixed(2)} → ${currentEquity.toFixed(2)}`);
    }

    // Update copied trade with P&L and fees
    const { error: updateError } = await supabase
      .from('copied_trades')
      .update({
        pnl_usd: pnl_usd || 0,
        pnl_percent: pnl_percent || 0,
        is_winner: is_winner || false,
        exit_time: exit_time || new Date().toISOString(),
        override_fee_charged: overrideFeeCharged,
        platform_fee_usd: platformFeeUsd,
        leader_fee_usd: leaderFeeUsd
        // fee_paid_at will be set when billing runs
      })
      .eq('id', copiedTrade.id);

    if (updateError) {
      logger.logError('Failed to update copied trade P&L', updateError);
    } else {
      logger.debug('Updated copied trade P&L', {
        copiedTradeId: copiedTrade.id,
        pnl: pnl_usd,
        fee: overrideFeeCharged
      });
    }

    // Update copy relationship drawdown if needed
    if (pnl_usd < 0) {
      await updateCopyRelationshipDrawdown(copiedTrade.copy_relationship_id);
    }

  } catch (error) {
    logger.logError('Exception updating copied trade P&L', error);
  }
}

/**
 * Update copied trade with follower_trade_id when trade is logged
 * 
 * @param {string} copyRelationshipId - Copy relationship ID
 * @param {string} followerTradeId - Follower's trade ID from trades table
 */
async function updateCopiedTradeFollowerId(copyRelationshipId, followerTradeId) {
  try {
    // Find the most recent copied trade for this relationship without a follower_trade_id
    const { data: copiedTrade } = await supabase
      .from('copied_trades')
      .select('id')
      .eq('copy_relationship_id', copyRelationshipId)
      .is('follower_trade_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (copiedTrade) {
      await supabase
        .from('copied_trades')
        .update({ follower_trade_id: followerTradeId })
        .eq('id', copiedTrade.id);
    }
  } catch (error) {
    logger.debug('Exception updating copied trade follower_trade_id', error);
  }
}

/**
 * Update copy relationship's current drawdown
 * 
 * @param {string} copyRelationshipId - Copy relationship ID
 */
async function updateCopyRelationshipDrawdown(copyRelationshipId) {
  try {
    // Calculate total P&L for this relationship
    const { data: trades, error } = await supabase
      .from('copied_trades')
      .select('pnl_usd')
      .eq('copy_relationship_id', copyRelationshipId)
      .not('exit_time', 'is', null);

    if (error || !trades) return;

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
    
    // Get relationship to find starting capital (approximate from first trade)
    const { data: relationship } = await supabase
      .from('copy_relationships')
      .select('id')
      .eq('id', copyRelationshipId)
      .maybeSingle();

    if (!relationship) return;

    // Calculate drawdown as negative P&L percentage
    // For simplicity, use first trade size as baseline
    const { data: firstTrade } = await supabase
      .from('copied_trades')
      .select('follower_size_usd')
      .eq('copy_relationship_id', copyRelationshipId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstTrade && firstTrade.follower_size_usd > 0) {
      const drawdownPercent = totalPnl < 0 
        ? Math.abs((totalPnl / firstTrade.follower_size_usd) * 100)
        : 0;

      await supabase
        .from('copy_relationships')
        .update({ current_drawdown_percent: drawdownPercent })
        .eq('id', copyRelationshipId);

      // Auto-pause if drawdown exceeded
      const { data: rel } = await supabase
        .from('copy_relationships')
        .select('max_drawdown_stop')
        .eq('id', copyRelationshipId)
        .maybeSingle();

      if (rel && drawdownPercent >= rel.max_drawdown_stop) {
        await supabase
          .from('copy_relationships')
          .update({ 
            status: 'paused',
            paused_at: new Date().toISOString()
          })
          .eq('id', copyRelationshipId);

        logger.warn(`Auto-paused copy relationship ${copyRelationshipId}: drawdown ${drawdownPercent.toFixed(2)}% >= ${rel.max_drawdown_stop}%`);
      }
    }

  } catch (error) {
    logger.logError('Exception updating copy relationship drawdown', error);
  }
}

module.exports = {
  fanOutToFollowers,
  logCopiedTrade,
  updateCopiedTradePnl,
  updateCopiedTradeFollowerId,
  updateCopyRelationshipDrawdown
};

