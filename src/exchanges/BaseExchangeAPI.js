/**
 * Base Exchange API Class
 * All exchange implementations should extend this class
 */

class BaseExchangeAPI {
  constructor(config) {
    this.config = config;
    this.exchangeName = 'base';
  }

  /**
   * Required methods that all exchanges must implement
   */

  // Account methods
  async getBalance() {
    throw new Error('getBalance() must be implemented by exchange');
  }

  async getAvailableMargin() {
    throw new Error('getAvailableMargin() must be implemented by exchange');
  }

  // Position methods
  async getPositions() {
    throw new Error('getPositions() must be implemented by exchange');
  }

  async getPosition(symbol) {
    throw new Error('getPosition() must be implemented by exchange');
  }

  async hasOpenPosition(symbol) {
    throw new Error('hasOpenPosition() must be implemented by exchange');
  }

  // Market data methods
  async getTicker(symbol) {
    throw new Error('getTicker() must be implemented by exchange');
  }

  // Order methods
  async placeMarketOrder(symbol, side, quantity) {
    throw new Error('placeMarketOrder() must be implemented by exchange');
  }

  async placeLimitOrder(symbol, side, quantity, price) {
    throw new Error('placeLimitOrder() must be implemented by exchange');
  }

  async placeStopLoss(symbol, side, quantity, stopPrice) {
    throw new Error('placeStopLoss() must be implemented by exchange');
  }

  async placeTakeProfit(symbol, side, quantity, takeProfitPrice) {
    throw new Error('placeTakeProfit() must be implemented by exchange');
  }

  async closePosition(symbol, side, quantity) {
    throw new Error('closePosition() must be implemented by exchange');
  }

  async cancelOrder(symbol, orderId) {
    throw new Error('cancelOrder() must be implemented by exchange');
  }

  async getOrder(symbol, orderId) {
    throw new Error('getOrder() must be implemented by exchange');
  }

  /**
   * Helper method for sleeping
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get exchange name
   */
  getExchangeName() {
    return this.exchangeName;
  }
}

module.exports = BaseExchangeAPI;

