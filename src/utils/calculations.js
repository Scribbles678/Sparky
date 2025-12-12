/**
 * Calculate position size based on fixed dollar amount
 * @param {number} tradeAmount - Fixed dollar amount to trade (position size)
 * @param {number} price - Entry price
 * @returns {number} Quantity to trade
 */
function calculatePositionSize(tradeAmount, price) {
  if (!tradeAmount || !price || price <= 0) {
    throw new Error('Invalid parameters for position size calculation');
  }
  
  const quantity = tradeAmount / price;
  
  return quantity;
}

/**
 * Calculate stop loss price based on percentage of position value
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPercent - Stop loss percentage (% of position value)
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
 * Calculate take profit price based on percentage of position value
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} entryPrice - Entry price
 * @param {number} takeProfitPercent - Take profit percentage (% of position value)
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
 * Round quantity to appropriate decimal places based on symbol and exchange
 * @param {number} quantity - Quantity to round
 * @param {string} symbol - Trading symbol (optional, for symbol-specific precision)
 * @param {string} exchange - Exchange name (optional, for exchange-specific rules)
 * @returns {number} Rounded quantity
 */
function roundQuantity(quantity, symbol = null, exchange = 'aster') {
  // For stocks (Tradier), always use whole shares (0 decimals)
  if (exchange && exchange.toLowerCase() === 'tradier') {
    return Math.floor(quantity); // Stocks are whole shares
  }
  
  // For forex (OANDA), use appropriate precision
  if (exchange && exchange.toLowerCase() === 'oanda') {
    return Math.round(quantity); // Forex units are usually whole numbers
  }
  
  // Symbol-specific precision mapping (for crypto on Aster DEX)
  const precisionMap = {
    'BTCUSDT': 3,   // 0.001
    'ETHUSDT': 2,   // 0.01
    'SOLUSDT': 1,   // 0.1
    'BNBUSDT': 2,   // 0.01
    'ADAUSDT': 0,   // 1
    'DOGEUSDT': 0,  // 1
    'XRPUSDT': 0,   // 1
    'DOTUSDT': 1,   // 0.1
    'MATICUSDT': 0, // 1
    'LINKUSDT': 1,  // 0.1
    'AVAXUSDT': 1,  // 0.1
    'UNIUSDT': 1,   // 0.1
    'ATOMUSDT': 1,  // 0.1
    'LTCUSDT': 2,   // 0.01
    'NEARUSDT': 1,  // 0.1
    'APTUSDT': 1,   // 0.1
    'OPUSDT': 0,    // 1
    'ARBUSDT': 0,   // 1
  };
  
  // Try to get symbol-specific precision
  let decimals = 2; // Default fallback
  
  if (symbol && precisionMap[symbol.toUpperCase()]) {
    decimals = precisionMap[symbol.toUpperCase()];
  } else if (symbol) {
    // If symbol not in map, try to infer from price magnitude
    // High-value coins (>$1000) usually need more decimals
    // Low-value coins (<$10) usually need fewer decimals
    // This is a fallback heuristic
    decimals = 1; // Conservative default
  }
  
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

/**
 * Calculate pip value for Oanda symbols
 * @param {string} symbol - Trading symbol (e.g., EUR_USD, GBP_USD)
 * @param {number} price - Current price
 * @returns {number} Pip value (0.0001 for most pairs, 0.01 for JPY pairs)
 */
function calculatePipValue(symbol, price) {
  // JPY pairs have different pip values
  const jpyPairs = ['USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'CAD_JPY', 'CHF_JPY', 'NZD_JPY'];
  
  if (jpyPairs.includes(symbol)) {
    return 0.01; // 1 pip = 0.01 for JPY pairs
  }
  
  return 0.0001; // 1 pip = 0.0001 for most pairs
}

/**
 * Convert percentage to pips for Oanda
 * @param {string} symbol - Trading symbol
 * @param {number} price - Current price
 * @param {number} percentage - Percentage (e.g., 1.5 for 1.5%)
 * @returns {number} Equivalent pips
 */
function percentageToPips(symbol, price, percentage) {
  const pipValue = calculatePipValue(symbol, price);
  const priceMove = price * (percentage / 100);
  return Math.round(priceMove / pipValue);
}

/**
 * Convert pips to percentage for Oanda
 * @param {string} symbol - Trading symbol
 * @param {number} price - Current price
 * @param {number} pips - Number of pips
 * @returns {number} Equivalent percentage
 */
function pipsToPercentage(symbol, price, pips) {
  const pipValue = calculatePipValue(symbol, price);
  const priceMove = pips * pipValue;
  return (priceMove / price) * 100;
}

module.exports = {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  getOppositeSide,
  roundPrice,
  roundQuantity,
  hassufficientMargin,
  calculatePipValue,
  percentageToPips,
  pipsToPercentage,
};

