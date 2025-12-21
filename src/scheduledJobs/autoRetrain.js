/**
 * Auto-Retrain Scheduled Job
 * 
 * Phase 3: Self-Improvement System
 * 
 * Runs every hour to check if strategies need retraining
 * Triggers automatic retraining when conditions are met
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ARTHUR_ML_URL = process.env.ARTHUR_ML_URL || process.env.ML_SERVICE_URL || 'http://localhost:8001';

/**
 * Check and auto-retrain strategies
 * Runs every hour
 */
async function checkAndRetrainStrategies() {
  try {
    logger.info('🔄 Auto-retrain check started');

    // Get all active strategies with ML training enabled
    const { data: strategies, error } = await supabase
      .from('ai_strategies')
      .select('id, user_id, name, ml_training_enabled, ml_min_trades_for_training')
      .eq('status', 'running')
      .eq('ml_training_enabled', true);

    if (error) {
      logger.error('Failed to fetch strategies for auto-retrain:', error);
      return;
    }

    if (!strategies || strategies.length === 0) {
      logger.debug('No strategies with ML training enabled');
      return;
    }

    logger.info(`Checking ${strategies.length} strategy(ies) for auto-retraining`);

    let retrainedCount = 0;
    let skippedCount = 0;

    for (const strategy of strategies) {
      try {
        // Call SignalStudio API to check retrain conditions
        // (This will check conditions and trigger retraining if needed)
        const response = await fetch(
          `${process.env.SIGNALSTUDIO_API_URL || 'http://localhost:3000'}/api/ai-strategies/${strategy.id}/auto-retrain`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.SERVICE_API_KEY || ''}`
            }
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn(`Auto-retrain check failed for strategy ${strategy.id}: ${errorText}`);
          continue;
        }

        const result = await response.json();

        if (result.should_retrain && result.retrained) {
          retrainedCount++;
          logger.info(`✅ Auto-retrained strategy: ${strategy.name} (${strategy.id})`, {
            reason: result.reason,
            model_version: result.model?.version,
            accuracy: result.model?.accuracy,
            improvement: result.model?.improvement
          });
        } else if (result.should_retrain && !result.retrained) {
          logger.warn(`⚠️ Retraining needed but failed for strategy ${strategy.id}:`, result.error);
        } else {
          skippedCount++;
          logger.debug(`Skipped strategy ${strategy.id}: ${result.reason}`);
        }
      } catch (error) {
        logger.error(`Error checking strategy ${strategy.id} for auto-retrain:`, error.message);
      }
    }

    logger.info(`🔄 Auto-retrain check complete: ${retrainedCount} retrained, ${skippedCount} skipped`);
  } catch (error) {
    logger.error('Auto-retrain job error:', error);
  }
}

/**
 * Start auto-retrain scheduler
 * Runs every hour
 */
function startAutoRetrainScheduler() {
  // Run immediately on start
  checkAndRetrainStrategies();

  // Then run every hour
  const interval = setInterval(() => {
    checkAndRetrainStrategies();
  }, 60 * 60 * 1000); // 1 hour

  logger.info('✅ Auto-retrain scheduler started (runs every hour)');

  // Return cleanup function
  return () => {
    clearInterval(interval);
    logger.info('Auto-retrain scheduler stopped');
  };
}

module.exports = {
  checkAndRetrainStrategies,
  startAutoRetrainScheduler,
};

// If run directly, start the scheduler
if (require.main === module) {
  startAutoRetrainScheduler();
  
  // Keep process alive
  process.on('SIGINT', () => {
    logger.info('Stopping auto-retrain scheduler...');
    process.exit(0);
  });
}

