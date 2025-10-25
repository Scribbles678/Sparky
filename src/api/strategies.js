/**
 * Strategy Management API Endpoints
 * Handles strategy CRUD operations and analytics
 */

const express = require('express');
const router = express.Router();
const StrategyManager = require('../strategyManager');

const strategyManager = new StrategyManager();

/**
 * Get all strategies with analytics
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await strategyManager.getStrategyAnalytics();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      success: true,
      strategies: data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get strategy performance comparison
 */
router.get('/comparison', async (req, res) => {
  try {
    const { data, error } = await strategyManager.getStrategyComparison();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      success: true,
      comparison: data,
      best_strategy: data[0]?.name || null,
      worst_strategy: data[data.length - 1]?.name || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get specific strategy details
 */
router.get('/:strategyName', async (req, res) => {
  try {
    const { strategyName } = req.params;
    const { data, error } = await strategyManager.getStrategyAnalytics(strategyName);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({
      success: true,
      strategy: data[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create a new strategy
 */
router.post('/', async (req, res) => {
  try {
    const { data, error } = await strategyManager.createStrategy(req.body);
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      success: true,
      strategy: data,
      message: 'Strategy created successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get strategy performance over time
 */
router.get('/:strategyName/performance', async (req, res) => {
  try {
    const { strategyName } = req.params;
    const { days = 30 } = req.query;

    // This would require additional database queries to get historical performance
    // For now, return basic strategy info
    const { data, error } = await strategyManager.getStrategyAnalytics(strategyName);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({
      success: true,
      strategy: data[0],
      performance_period: `${days} days`,
      message: 'Historical performance data would be implemented here'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
