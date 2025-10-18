const logger = require('./utils/logger');

/**
 * In-memory position tracker
 * Keeps track of open positions and their details
 */
class PositionTracker {
  constructor() {
    this.positions = new Map();
  }

  /**
   * Add or update a position
   */
  addPosition(symbol, positionData) {
    const position = {
      symbol,
      side: positionData.side,
      quantity: positionData.quantity,
      entryPrice: positionData.entryPrice,
      leverage: positionData.leverage,
      stopLossOrderId: positionData.stopLossOrderId || null,
      takeProfitOrderId: positionData.takeProfitOrderId || null,
      orderId: positionData.orderId,
      timestamp: Date.now(),
      ...positionData,
    };

    this.positions.set(symbol, position);
    logger.logPosition('opened', symbol, position);
    
    return position;
  }

  /**
   * Get position by symbol
   */
  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  /**
   * Check if position exists
   */
  hasPosition(symbol) {
    return this.positions.has(symbol);
  }

  /**
   * Remove position
   */
  removePosition(symbol) {
    const position = this.positions.get(symbol);
    
    if (position) {
      this.positions.delete(symbol);
      logger.logPosition('closed', symbol, position);
    }
    
    return position;
  }

  /**
   * Update position details
   */
  updatePosition(symbol, updates) {
    const position = this.positions.get(symbol);
    
    if (position) {
      Object.assign(position, updates);
      this.positions.set(symbol, position);
      logger.logPosition('updated', symbol, updates);
    }
    
    return position;
  }

  /**
   * Get all open positions
   */
  getAllPositions() {
    return Array.from(this.positions.values());
  }

  /**
   * Get position count
   */
  getPositionCount() {
    return this.positions.size;
  }

  /**
   * Clear all positions (use with caution)
   */
  clearAll() {
    logger.info('Clearing all tracked positions');
    this.positions.clear();
  }

  /**
   * Get position summary
   */
  getSummary() {
    const positions = this.getAllPositions();
    
    return {
      totalPositions: positions.length,
      longPositions: positions.filter(p => p.side === 'BUY').length,
      shortPositions: positions.filter(p => p.side === 'SELL').length,
      symbols: positions.map(p => p.symbol),
      positions: positions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        leverage: p.leverage,
        timestamp: new Date(p.timestamp).toISOString(),
      })),
    };
  }

  /**
   * Sync with actual exchange positions
   * Useful for reconciliation after restart
   */
  async syncWithExchange(asterApi) {
    try {
      logger.info('Syncing positions with exchange');
      const exchangePositions = await asterApi.getPositions();
      
      // Clear current positions
      this.clearAll();
      
      // Add actual positions from exchange
      for (const pos of exchangePositions) {
        const positionAmt = parseFloat(pos.positionAmt);
        
        if (positionAmt !== 0) {
          const side = positionAmt > 0 ? 'BUY' : 'SELL';
          
          this.addPosition(pos.symbol, {
            side,
            quantity: Math.abs(positionAmt),
            entryPrice: parseFloat(pos.entryPrice),
            leverage: parseInt(pos.leverage),
            orderId: null, // Unknown after restart
            stopLossOrderId: null,
            takeProfitOrderId: null,
            synced: true,
          });
        }
      }
      
      logger.info(`Synced ${this.getPositionCount()} positions from exchange`);
      return this.getSummary();
    } catch (error) {
      logger.logError('Position sync failed', error);
      throw error;
    }
  }
}

module.exports = PositionTracker;

