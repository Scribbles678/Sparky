/**
 * Services Index for Sparky Trading Bot
 * 
 * Re-exports all service modules for convenient importing.
 */

const { MarketStructureAnalyzer, SwingType, TrendDirection } = require('./marketStructure');

module.exports = {
  // Market Structure Analysis
  MarketStructureAnalyzer,
  SwingType,
  TrendDirection
};

