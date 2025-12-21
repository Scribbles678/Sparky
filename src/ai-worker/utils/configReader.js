/**
 * Config Reader Utility
 * 
 * Phase 1: Normalize AI strategy config
 * Merges config JSONB with columns (config takes precedence)
 * 
 * This ensures Sparky Bot uses all AI Studio configuration settings
 */

/**
 * Normalize AI strategy config
 * Merges config JSONB with columns (config takes precedence)
 * 
 * @param {Object} strategy - Strategy object from Supabase
 * @returns {Object} Normalized config object
 */
function normalizeConfig(strategy) {
  const config = strategy.config || {};
  
  // Merge config JSONB with columns (config takes precedence)
  return {
    // From config JSONB (preferred)
    ...config,
    
    // Fallback to columns if config missing
    target_assets: config.target_assets || strategy.target_assets || [],
    confidence_threshold: config.confidence_threshold !== undefined
      ? config.confidence_threshold
      : strategy.ml_confidence_threshold !== null
      ? strategy.ml_confidence_threshold
      : 0.70, // default
    
    hybrid_mode: config.hybrid_mode || {
      type: strategy.llm_usage_mode || 'hybrid',
      llm_percent: strategy.llm_usage_percent || 20,
      ml_percent: strategy.llm_usage_percent !== null 
        ? 100 - (strategy.llm_usage_percent || 20)
        : 80
    },
    
    performance_fee_percent: config.performance_fee_percent !== undefined
      ? config.performance_fee_percent
      : strategy.performance_fee_percent !== null
      ? strategy.performance_fee_percent
      : 20.0,
    
    // Feature weights (only in config, no column fallback)
    feature_weights: config.feature_weights || {},
    
    // All other settings from config only
    risk_profile_value: config.risk_profile_value || 50,
    strategy_styles: config.strategy_styles || [],
    market_regime_override: config.market_regime_override || 'auto',
    custom_prompt: config.custom_prompt,
    timeframe: config.timeframe || '1h',
    blacklist: config.blacklist || [],
    whitelist: config.whitelist,
    daily_trade_limit: config.daily_trade_limit,
    
    // Phase 2 Week 1: Volatility-Adjusted Position Sizing
    use_volatility_sizing: config.use_volatility_sizing !== undefined
      ? config.use_volatility_sizing
      : strategy.use_volatility_sizing || false,
    risk_per_trade: config.risk_per_trade !== undefined
      ? config.risk_per_trade
      : strategy.risk_per_trade || 0.01,
    atr_multiplier: config.atr_multiplier !== undefined
      ? config.atr_multiplier
      : strategy.atr_multiplier || 2.0,
    
    // Phase 2 Week 2: Transaction Cost Modeling
    skip_high_cost_trades: config.skip_high_cost_trades !== undefined
      ? config.skip_high_cost_trades
      : strategy.skip_high_cost_trades || false,
    max_cost_bps: config.max_cost_bps !== undefined
      ? config.max_cost_bps
      : strategy.max_cost_bps || 50,
    include_slippage_estimate: config.include_slippage_estimate !== undefined
      ? config.include_slippage_estimate
      : strategy.include_slippage_estimate !== false,
    
    // Phase 2 Week 3: Smart Order Routing
    use_smart_routing: config.use_smart_routing !== undefined
      ? config.use_smart_routing
      : strategy.use_smart_routing || false,
    twap_threshold_usd: config.twap_threshold_usd !== undefined
      ? config.twap_threshold_usd
      : strategy.twap_threshold_usd || 10000,
    twap_duration_min: config.twap_duration_min !== undefined
      ? config.twap_duration_min
      : strategy.twap_duration_min || 5,
    twap_slices: config.twap_slices !== undefined
      ? config.twap_slices
      : strategy.twap_slices || 5,
    
    // Phase 2 Week 4: Correlation Management
    enforce_correlation_limits: config.enforce_correlation_limits !== undefined
      ? config.enforce_correlation_limits
      : strategy.enforce_correlation_limits || false,
    max_correlation: config.max_correlation !== undefined
      ? config.max_correlation
      : strategy.max_correlation || 0.70,
    max_correlated_exposure: config.max_correlated_exposure !== undefined
      ? config.max_correlated_exposure
      : strategy.max_correlated_exposure || 0.50,
    
    // Phase 3 Week 1: Ensemble Models
    use_ensemble: config.use_ensemble !== undefined
      ? config.use_ensemble
      : strategy.use_ensemble || false,
    ensemble_models: config.ensemble_models !== undefined
      ? config.ensemble_models
      : strategy.ensemble_models || ['lgbm', 'xgb', 'rf'],
    use_adaptive_weights: config.use_adaptive_weights !== undefined
      ? config.use_adaptive_weights
      : strategy.use_adaptive_weights !== false,
    
    // Phase 3 Week 2: Walk-Forward Validation
    walk_forward_enabled: config.walk_forward_enabled !== undefined
      ? config.walk_forward_enabled
      : strategy.walk_forward_enabled || false,
    walk_forward_train_days: config.walk_forward_train_days !== undefined
      ? config.walk_forward_train_days
      : strategy.walk_forward_train_days || 90,
    walk_forward_test_days: config.walk_forward_test_days !== undefined
      ? config.walk_forward_test_days
      : strategy.walk_forward_test_days || 30,
    walk_forward_num_periods: config.walk_forward_num_periods !== undefined
      ? config.walk_forward_num_periods
      : strategy.walk_forward_num_periods || 6,
    walk_forward_min_score: config.walk_forward_min_score !== undefined
      ? config.walk_forward_min_score
      : strategy.walk_forward_min_score || 70,
    walk_forward_is_approved: config.walk_forward_is_approved !== undefined
      ? config.walk_forward_is_approved
      : strategy.walk_forward_is_approved || false,
    
    // Phase 3 Week 3 Part 1: Feature Selection
    feature_selection_enabled: config.feature_selection_enabled !== undefined
      ? config.feature_selection_enabled
      : strategy.feature_selection_enabled || false,
    selected_features: config.selected_features !== undefined
      ? config.selected_features
      : strategy.selected_features || null,
    feature_count: config.feature_count !== undefined
      ? config.feature_count
      : strategy.feature_count || null,
    
    // Phase 3 Week 3 Part 2: RFE Optimization
    rfe_enabled: config.rfe_enabled !== undefined
      ? config.rfe_enabled
      : strategy.rfe_enabled || false,
    rfe_optimal_feature_count: config.rfe_optimal_feature_count !== undefined
      ? config.rfe_optimal_feature_count
      : strategy.rfe_optimal_feature_count || null,
    rfe_optimal_accuracy: config.rfe_optimal_accuracy !== undefined
      ? config.rfe_optimal_accuracy
      : strategy.rfe_optimal_accuracy || null,
    
    // Phase 3 Week 4: Online Learning & Drift Detection
    use_online_learning: config.use_online_learning !== undefined
      ? config.use_online_learning
      : strategy.use_online_learning || false,
    incremental_update_frequency: config.incremental_update_frequency !== undefined
      ? config.incremental_update_frequency
      : strategy.incremental_update_frequency || 'daily',
    incremental_update_min_trades: config.incremental_update_min_trades !== undefined
      ? config.incremental_update_min_trades
      : strategy.incremental_update_min_trades || 50,
    forgetting_factor: config.forgetting_factor !== undefined
      ? config.forgetting_factor
      : strategy.forgetting_factor !== null
      ? strategy.forgetting_factor
      : 0.95,
    
    enable_drift_detection: config.enable_drift_detection !== undefined
      ? config.enable_drift_detection
      : strategy.enable_drift_detection || false,
    drift_detection_window_size: config.drift_detection_window_size !== undefined
      ? config.drift_detection_window_size
      : strategy.drift_detection_window_size || 100,
    drift_detection_threshold: config.drift_detection_threshold !== undefined
      ? config.drift_detection_threshold
      : strategy.drift_detection_threshold !== null
      ? strategy.drift_detection_threshold
      : 0.05,
    auto_retrain_on_drift: config.auto_retrain_on_drift !== undefined
      ? config.auto_retrain_on_drift
      : strategy.auto_retrain_on_drift || false
  };
}

/**
 * Load strategy config from Supabase
 * Fetches strategy and normalizes config
 * 
 * @param {string} strategyId - Strategy ID
 * @returns {Promise<Object>} Normalized config
 */
async function loadStrategyConfig(strategyId, supabase) {
  try {
    const { data: strategy, error } = await supabase
      .from('ai_strategies')
      .select('*, config')
      .eq('id', strategyId)
      .single();
    
    if (error || !strategy) {
      throw new Error(`Strategy ${strategyId} not found: ${error?.message || 'Not found'}`);
    }
    
    // Normalize config (config JSONB + columns)
    const config = normalizeConfig(strategy);
    
    return {
      strategy,
      config
    };
  } catch (error) {
    throw new Error(`Failed to load strategy config: ${error.message}`);
  }
}

module.exports = {
  normalizeConfig,
  loadStrategyConfig,
};

