/**
 * Calculate position size based on fixed amount and leverage
 * @param {number} tradeAmount - Fixed dollar amount to trade
 * @param {number} leverage - Leverage multiplier
 * @param {number} price - Entry price
 * @returns {number} Quantity to trade
 */
function calculatePositionSize(tradeAmount, leverage, price) {
  if (!tradeAmount || !leverage || !price || price <= 0) {
    throw new Error('Invalid parameters for position size calculation');
  }
  
  const notionalValue = tradeAmount * leverage;
  const quantity = notionalValue / price;
  
  return quantity;
}

/**
 * Calculate stop loss price
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPercent - Stop loss percentage
 * @returns {number} Stop loss price
 */
function calculateStopLoss(side, entryPrice, stopLossPercent) {
  if (!side || !entryPrice || entryPrice <= 0) {
    throw new Error('Invalid parameters for stop loss calculation');
  }
  
  if (!stopLossPercent || stopLossPercent <= 0) {
    throw new Error('Stop loss percent must be positive');
  }
  
  let stopPrice;
  
  if (side.toUpperCase() === 'BUY') {
    // Long position: stop loss below entry
    stopPrice = entryPrice * (1 - stopLossPercent / 100);
  } else if (side.toUpperCase() === 'SELL') {
    // Short position: stop loss above entry
    stopPrice = entryPrice * (1 + stopLossPercent / 100);
  } else {
    throw new Error('Invalid side. Must be BUY or SELL');
  }
  
  return stopPrice;
}

/**
 * Calculate take profit price
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} entryPrice - Entry price
 * @param {number} takeProfitPercent - Take profit percentage
 * @returns {number} Take profit price
 */
function calculateTakeProfit(side, entryPrice, takeProfitPercent) {
  if (!side || !entryPrice || entryPrice <= 0) {
    throw new Error('Invalid parameters for take profit calculation');
  }
  
  if (!takeProfitPercent || takeProfitPercent <= 0) {
    throw new Error('Take profit percent must be positive');
  }
  
  let tpPrice;
  
  if (side.toUpperCase() === 'BUY') {
    // Long position: take profit above entry
    tpPrice = entryPrice * (1 + takeProfitPercent / 100);
  } else if (side.toUpperCase() === 'SELL') {
    // Short position: take profit below entry
    tpPrice = entryPrice * (1 - takeProfitPercent / 100);
  } else {
    throw new Error('Invalid side. Must be BUY or SELL');
  }
  
  return tpPrice;
}

/**
 * Get opposite side for closing positions or stop losses
 * @param {string} side - 'BUY' or 'SELL'
 * @returns {string} Opposite side
 */
function getOppositeSide(side) {
  if (side.toUpperCase() === 'BUY') {
    return 'SELL';
  } else if (side.toUpperCase() === 'SELL') {
    return 'BUY';
  } else {
    throw new Error('Invalid side. Must be BUY or SELL');
  }
}

/**
 * Round price to appropriate decimal places
 * @param {number} price - Price to round
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Rounded price
 */
function roundPrice(price, decimals = 2) {
  return Math.round(price * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Round quantity to appropriate decimal places
 * @param {number} quantity - Quantity to round
 * @param {number} decimals - Number of decimal places (default: 3)
 * @returns {number} Rounded quantity
 */
function roundQuantity(quantity, decimals = 3) {
  return Math.round(quantity * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Validate if margin is sufficient
 * @param {number} availableMargin - Available margin
 * @param {number} requiredMargin - Required margin
 * @param {number} minMarginPercent - Minimum margin percent to keep (default: 20)
 * @returns {boolean} True if sufficient
 */
function hassufficientMargin(availableMargin, requiredMargin, minMarginPercent = 20) {
  const marginAfterTrade = availableMargin - requiredMargin;
  const minRequiredMargin = (availableMargin * minMarginPercent) / 100;
  
  return marginAfterTrade >= minRequiredMargin;
}

module.exports = {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  getOppositeSide,
  roundPrice,
  roundQuantity,
  hassufficientMargin,
};

