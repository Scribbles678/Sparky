const logger = require('../utils/logger');
const settingsService = require('../settings/settingsService');
const {
  saveOptionTrade,
} = require('../supabaseClient');

class TradierOptionsExecutor {
  constructor(api, positionTracker, config) {
    this.api = api;
    this.tracker = positionTracker;
    this.config = config;
    this.exchange = api.exchangeName || 'tradier_options';
    const StrategyManager = require('../strategyManager');
    this.strategyManager = new StrategyManager();
  }

  async executeWebhook(alertData) {
    try {
      const action = (alertData.action || '').toLowerCase();

      if (!['buy', 'open', 'long'].includes(action)) {
        if (action === 'close') {
          return this.closePosition(alertData);
        }
        return {
          success: false,
          action: 'skipped',
          message: `Action "${alertData.action}" not supported for Tradier options`,
        };
      }

      return this.openPosition(alertData);
    } catch (error) {
      logger.logError('Tradier options webhook failed', error, { alertData });
      throw error;
    }
  }

  async openPosition(alertData) {
    const settings = settingsService.getExchangeSettings(this.exchange);
    const symbol = (alertData.symbol || alertData.underlying || '').toUpperCase();
    const optionRight = (alertData.right || alertData.option_type || 'call').toLowerCase();
    const desiredStrike = alertData.strike ? parseFloat(alertData.strike) : null;
    const desiredExpiration = alertData.expiration || null;
    const sizePercent = alertData.sizePercent || alertData.size || settings.position_size_percent || 0;

    if (!symbol) {
      throw new Error('Underlying symbol is required for Tradier options orders');
    }

    this.ensureWithinTradingWindow(settings);

    const underlyingQuote = await this.api.getUnderlyingQuote(symbol);
    const underlyingPrice = parseFloat(underlyingQuote.last || underlyingQuote.price);

    const strike = this.pickStrike(
      underlyingPrice,
      desiredStrike,
      settings.strike_tolerance_percent || settings.strikeTolerancePercent || 1
    );

    const expiration = await this.pickExpiration(symbol, desiredExpiration);

    const optionSymbol = this.api.createOptionSymbol(symbol, expiration, optionRight, strike);
    const optionQuote = await this.api.getOptionQuote(optionSymbol);
    const optionAsk = parseFloat(optionQuote.ask || optionQuote.last || optionQuote.price);
    const optionBid = parseFloat(optionQuote.bid || optionAsk);
    const contractSize = parseInt(optionQuote.contract_size, 10) || 100;

    const buyingPower = await this.api.getAvailableMargin();
    const positionUsd = Math.max(0, buyingPower * (sizePercent / 100));
    const contractCost = optionAsk * contractSize;
    const quantityContracts = Math.floor(positionUsd / contractCost) || 1;

    const entryLimitPrice = this.roundPrice(
      optionAsk * (1 + (settings.entry_limit_offset_percent || settings.entryLimitOffsetPercent || 1) / 100)
    );
    const tpPrice = this.roundPrice(
      entryLimitPrice * (1 + (settings.tp_percent || settings.takeProfit || 5) / 100)
    );
    const slStop = this.roundPrice(
      optionBid * (1 - (settings.sl_percent || settings.stopLoss || 8) / 100)
    );

    const legs = [
      {
        underlyingSymbol: symbol,
        optionSymbol,
        quantity: quantityContracts,
        side: 'buy_to_open',
        type: 'limit',
        price: entryLimitPrice,
      },
      {
        underlyingSymbol: symbol,
        optionSymbol,
        quantity: quantityContracts,
        side: 'sell_to_close',
        type: 'limit',
        price: tpPrice,
      },
      {
        underlyingSymbol: symbol,
        optionSymbol,
        quantity: quantityContracts,
        side: 'sell_to_close',
        type: 'stop',
        stop: slStop,
      },
    ];

    const order = await this.api.createOtocoOrder(legs, { tag: alertData.strategy || '' });

    await saveOptionTrade({
      status: 'pending_entry',
      strategy: alertData.strategy || null,
      underlyingSymbol: symbol,
      optionSymbol,
      optionType: optionRight,
      strikePrice: strike,
      expirationDate: expiration,
      contractSize,
      quantityContracts,
      entryOrderId: order.id,
      tpOrderId: null,
      slOrderId: null,
      entryOrder: order,
      entryLimitPrice,
      tpLimitPrice: tpPrice,
      slStopPrice: slStop,
      costUsd: positionUsd,
      configSnapshot: {
        sizePercent,
        settings,
      },
      extraMetadata: {
        signal: alertData,
      },
    });

    logger.info('Tradier options OTOCO order placed', { optionSymbol, quantityContracts });

    return {
      success: true,
      action: 'opened',
      optionSymbol,
      quantity: quantityContracts,
      orderId: order.id,
    };
  }

  async closePosition(alertData) {
    const optionSymbol = (alertData.option_symbol || alertData.symbol || '').toUpperCase();
    const underlying = (alertData.underlying || alertData.underlying_symbol || '').toUpperCase();

    if (!optionSymbol) {
      throw new Error('Option symbol is required to close option trades');
    }

    if (!underlying) {
      throw new Error('Underlying symbol is required to close option trades');
    }

    const quantity = parseFloat(alertData.quantity || 1);
    const order = await this.api.createOptionMarketOrder({
      underlyingSymbol: underlying,
      optionSymbol,
      quantity,
      side: 'sell_to_close',
    });

    return {
      success: true,
      action: 'closed',
      orderId: order.id,
      optionSymbol,
    };
  }

  ensureWithinTradingWindow(settings) {
    const preset = settings.trading_hours_preset || settings.tradingHours || 'ny-session';
    const window = this.resolveWindow(preset, settings.customWindow || settings.trading_window);
    const timeZone = this.windowTimeZone(preset);
    const now = new Date();

    if (!this.isWithinWindow(now, window, timeZone)) {
      throw new Error('Outside configured trading window for Tradier options');
    }
  }

  resolveWindow(preset, customWindow) {
    switch (preset) {
      case '24/5':
        return ['00:00', '23:59'];
      case 'ny-session':
        return ['09:30', '16:00'];
      case 'london-session':
        return ['08:00', '14:00'];
      case 'weekend':
        return ['00:00', '23:59'];
      case 'custom':
        if (
          Array.isArray(customWindow) &&
          customWindow.length === 2 &&
          customWindow[0] &&
          customWindow[1]
        ) {
          return customWindow;
        }
        return ['00:00', '23:59'];
      default:
        return ['09:30', '16:00'];
    }
  }

  windowTimeZone(preset) {
    switch (preset) {
      case 'london-session':
        return 'Europe/London';
      case 'weekend':
        return 'UTC';
      default:
        return 'America/New_York';
    }
  }

  isWithinWindow(date, window, timeZone) {
    const minutesNow = this.getMinutesInZone(date, timeZone);
    const start = this.parseTimeToMinutes(window[0]);
    const end = this.parseTimeToMinutes(window[1]);

    if (start <= end) {
      return minutesNow >= start && minutesNow <= end;
    }

    return minutesNow >= start || minutesNow <= end;
  }

  getMinutesInZone(date, timeZone) {
    const localeString = date.toLocaleString('en-US', { timeZone });
    const zoned = new Date(localeString);
    return zoned.getHours() * 60 + zoned.getMinutes();
  }

  parseTimeToMinutes(value) {
    const [hour, minute] = `${value}`.split(':').map((n) => parseInt(n, 10));
    return (hour || 0) * 60 + (minute || 0);
  }

  pickStrike(price, desiredStrike, tolerancePercent) {
    if (desiredStrike) {
      return desiredStrike;
    }

    const rounded = Math.floor(price);
    const toleranceValue = rounded * (tolerancePercent / 100);
    return Math.max(0, rounded - toleranceValue);
  }

  async pickExpiration(symbol, desiredExpiration) {
    const expirations = await this.api.getOptionExpirations(symbol);
    if (!expirations.length) {
      throw new Error(`No option expirations available for ${symbol}`);
    }

    if (desiredExpiration) {
      const match = expirations.find((exp) => exp.date === desiredExpiration);
      if (match) {
        return match.date;
      }
    }

    return expirations[0].date;
  }

  roundPrice(value) {
    return Math.round(value * 100) / 100;
  }
}

module.exports = TradierOptionsExecutor;

