/**
 * Strategy Manager for Sparky Trading Bot
 * Handles strategy creation, tracking, and analytics
 */

const logger = require('./utils/logger');
const { supabase } = require('./supabaseClient');

class StrategyManager {
  constructor() {
    this.strategies = new Map();
    this.loadStrategies();
  }

  /**
   * Load strategies from database
   */
  async loadStrategies() {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select('*')
        .eq('status', 'active');

      if (error) {
        logger.logError('Failed to load strategies', error);
        return;
      }

      // Cache strategies for fast lookup
      data.forEach(strategy => {
        this.strategies.set(strategy.name, strategy);
      });

      logger.info(`Loaded ${data.length} active strategies`);
    } catch (error) {
      logger.logError('Error loading strategies', error);
    }
  }

  /**
   * Get strategy by name
   */
  getStrategy(strategyName) {
    return this.strategies.get(strategyName);
  }

  /**
   * Validate strategy exists and is active
   */
  validateStrategy(strategyName) {
    const strategy = this.getStrategy(strategyName);
    
    if (!strategy) {
      logger.warn(`Strategy '${strategyName}' not found or inactive`);
      return null;
    }

    if (strategy.status !== 'active') {
      logger.warn(`Strategy '${strategyName}' is not active (status: ${strategy.status})`);
      return null;
    }

    return strategy;
  }

  /**
   * Create a new strategy
   */
  async createStrategy(strategyData) {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .insert([{
          name: strategyData.name,
          description: strategyData.description,
          asset_class: strategyData.assetClass,
          status: strategyData.status || 'active',
          pine_script: strategyData.pineScript,
          success_rate: strategyData.successRate,
          avg_profit: strategyData.avgProfit,
          risk_level: strategyData.riskLevel,
          max_position_size_usd: strategyData.maxPositionSize,
          stop_loss_percent: strategyData.stopLossPercent,
          take_profit_percent: strategyData.takeProfitPercent,
          timeframe: strategyData.timeframe,
          symbols: strategyData.symbols,
          webhook_secret: strategyData.webhookSecret,
          notes: strategyData.notes
        }])
        .select();

      if (error) {
        logger.logError('Failed to create strategy', error);
        return { error };
      }

      // Reload strategies
      await this.loadStrategies();
      
      logger.info(`✅ Strategy '${strategyData.name}' created successfully`);
      return { data: data[0] };
    } catch (error) {
      logger.logError('Error creating strategy', error);
      return { error };
    }
  }

  /**
   * Update strategy performance metrics
   */
  async updateStrategyMetrics(strategyName, tradeResult) {
    try {
      const strategy = this.getStrategy(strategyName);
      if (!strategy) return;

      // Calculate new metrics
      const isWinner = tradeResult.pnlUsd > 0;
      const newTotalTrades = (strategy.total_trades || 0) + 1;
      const newWinningTrades = (strategy.winning_trades || 0) + (isWinner ? 1 : 0);
      const newSuccessRate = (newWinningTrades / newTotalTrades) * 100;
      
      // Calculate average profit
      const currentAvgProfit = strategy.avg_profit || 0;
      const newAvgProfit = ((currentAvgProfit * (newTotalTrades - 1)) + tradeResult.pnlUsd) / newTotalTrades;

      const { error } = await supabase
        .from('strategies')
        .update({
          total_trades: newTotalTrades,
          winning_trades: newWinningTrades,
          success_rate: newSuccessRate,
          avg_profit: newAvgProfit,
          updated_at: new Date().toISOString()
        })
        .eq('name', strategyName);

      if (error) {
        logger.logError('Failed to update strategy metrics', error);
      } else {
        logger.info(`📊 Strategy '${strategyName}' metrics updated: ${newSuccessRate.toFixed(1)}% win rate`);
      }
    } catch (error) {
      logger.logError('Error updating strategy metrics', error);
    }
  }

  /**
   * Get strategy analytics
   */
  async getStrategyAnalytics(strategyName = null) {
    try {
      let query = supabase
        .from('strategies')
        .select(`
          name,
          description,
          asset_class,
          status,
          success_rate,
          avg_profit,
          total_trades,
          winning_trades,
          losing_trades,
          risk_level,
          created_at,
          updated_at
        `);

      if (strategyName) {
        query = query.eq('name', strategyName);
      }

      const { data, error } = await query.order('success_rate', { ascending: false });

      if (error) {
        logger.logError('Failed to get strategy analytics', error);
        return { error };
      }

      return { data };
    } catch (error) {
      logger.logError('Error getting strategy analytics', error);
      return { error };
    }
  }

  /**
   * Get strategy performance comparison
   */
  async getStrategyComparison() {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select(`
          name,
          success_rate,
          avg_profit,
          total_trades,
          risk_level,
          asset_class
        `)
        .eq('status', 'active')
        .order('success_rate', { ascending: false });

      if (error) {
        logger.logError('Failed to get strategy comparison', error);
        return { error };
      }

      // Add performance ranking
      const rankedStrategies = data.map((strategy, index) => ({
        ...strategy,
        rank: index + 1,
        performance_score: (strategy.success_rate * 0.7) + (Math.abs(strategy.avg_profit) * 0.3)
      }));

      return { data: rankedStrategies };
    } catch (error) {
      logger.logError('Error getting strategy comparison', error);
      return { error };
    }
  }
}

module.exports = StrategyManager;
