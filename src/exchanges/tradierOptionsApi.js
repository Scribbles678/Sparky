const TradierAPI = require('./tradierApi');
const logger = require('../utils/logger');

class TradierOptionsAPI extends TradierAPI {
  constructor(accountId, accessToken, environment = 'sandbox') {
    super(accountId, accessToken, environment);
    this.exchangeName = 'tradier_options';
  }

  async getQuotes(symbols = []) {
    const symbolList = Array.isArray(symbols) ? symbols : [symbols];
    if (!symbolList.length) {
      throw new Error('Symbols array cannot be empty for getQuotes');
    }

    const response = await this.makeRequest('GET', '/markets/quotes', {
      symbols: symbolList.join(','),
      greeks: false,
    });

    if (!response.quotes || !response.quotes.quote) {
      throw new Error(`No quote data returned for ${symbolList.join(', ')}`);
    }

    const quotes = response.quotes.quote;
    return Array.isArray(quotes) ? quotes : [quotes];
  }

  async getUnderlyingQuote(symbol) {
    const [quote] = await this.getQuotes([symbol]);
    return quote;
  }

  async getOptionQuote(optionSymbol) {
    const [quote] = await this.getQuotes([optionSymbol]);
    return quote;
  }

  async getOptionExpirations(symbol) {
    const response = await this.makeRequest('GET', '/markets/options/expirations', {
      symbol,
      strikes: true,
      expirationType: true,
    });

    if (!response.expirations || !response.expirations.expiration) {
      return [];
    }

    return response.expirations.expiration;
  }

  async getOptionChains(symbol, expiration) {
    const response = await this.makeRequest('GET', '/markets/options/chains', {
      symbol,
      expiration,
      greeks: false,
    });

    if (!response.options || !response.options.option) {
      return [];
    }

    return Array.isArray(response.options.option)
      ? response.options.option
      : [response.options.option];
  }

  createOptionSymbol(underlying, expiration, right, strike) {
    const date = new Date(expiration);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid expiration date: ${expiration}`);
    }
    const year = String(date.getUTCFullYear()).slice(-2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const datePart = `${year}${month}${day}`;
    const strikePart = String(Math.round(parseFloat(strike) * 1000)).padStart(8, '0');
    return `${underlying.toUpperCase()}${datePart}${right[0].toUpperCase()}${strikePart}`;
  }

  async createOtocoOrder(legs = [], options = {}) {
    if (!Array.isArray(legs) || legs.length === 0) {
      throw new Error('OTOC order requires at least one leg');
    }

    const params = {
      class: 'otoco',
      duration: options.duration || 'day',
    };

    if (options.tag) {
      params.tag = options.tag;
    }

    legs.forEach((leg, index) => {
      params[`symbol[${index}]`] = leg.underlyingSymbol;
      params[`quantity[${index}]`] = String(leg.quantity);
      params[`type[${index}]`] = leg.type;
      params[`side[${index}]`] = leg.side;
      params[`option_symbol[${index}]`] = leg.optionSymbol;
      if (leg.price !== undefined && leg.price !== null) {
        params[`price[${index}]`] = String(leg.price);
      }
      if (leg.stop !== undefined && leg.stop !== null) {
        params[`stop[${index}]`] = String(leg.stop);
      }
    });

    logger.info('Placing Tradier OTOCO order', { legs, options });
    const response = await this.makeRequest(
      'POST',
      `/accounts/${this.accountId}/orders`,
      params
    );

    return response.order;
  }

  async createOptionMarketOrder({
    underlyingSymbol,
    optionSymbol,
    quantity,
    side,
    duration = 'day',
    tag = '',
  }) {
    const params = {
      side,
      type: 'market',
      class: 'option',
      duration,
      quantity: String(quantity),
      symbol: underlyingSymbol,
      option_symbol: optionSymbol,
    };

    if (tag) {
      params.tag = tag;
    }

    logger.info('Placing Tradier option market order', params);
    const response = await this.makeRequest(
      'POST',
      `/accounts/${this.accountId}/orders`,
      params
    );

    return response.order;
  }
}

module.exports = TradierOptionsAPI;

