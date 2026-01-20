const logger = require('../utils/logger');
const settingsService = require('../settings/settingsService');
const {
  getOptionTradesByStatus,
  updateOptionTrade,
  logTrade,
} = require('../supabaseClient');

const LEG_STATUS_FILLED = ['filled', 'partially_filled'];
const LEG_STATUS_ACTIVE = ['open', 'pending', 'partially_filled'];
const LEG_STATUS_INACTIVE = ['canceled', 'expired', 'rejected', 'error'];

class TradierOptionsMonitor {
  constructor(api, config, intervalMs = 15000) {
    this.api = api;
    this.config = config;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.processing = new Set();
    this.exchange = api.exchangeName || 'tradier_options';
  }

  start() {
    if (this.timer) {
      return;
    }

    logger.info('Starting Tradier Options monitor');
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick().catch((error) => {
      logger.warn('Tradier Options initial tick failed', error);
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Tradier Options monitor stopped');
    }
  }

  async tick() {
    try {
      const trades = await getOptionTradesByStatus(['pending_entry', 'open'], 500);
      if (!trades.length) {
        return;
      }

      for (const trade of trades) {
        if (this.processing.has(trade.id)) {
          continue;
        }

        this.processing.add(trade.id);
        this.processTrade(trade)
          .catch((error) => {
            logger.warn(`Option trade processing failed for ${trade.id}`, error);
          })
          .finally(() => {
            this.processing.delete(trade.id);
          });
      }
    } catch (error) {
      logger.warn('Tradier Options monitor tick failed', error);
    }
  }

  async processTrade(trade) {
    const order = await this.fetchOrder(trade);
    if (!order) {
      return;
    }

    const legs = this.normalizeLegs(order.leg);
    const entryLeg = this.findEntryLeg(legs);
    const tpLeg = this.findTakeProfitLeg(legs);
    const slLeg = this.findStopLossLeg(legs);

    if (!entryLeg) {
      logger.warn(`Option trade ${trade.id} missing entry leg data`);
      return;
    }

    await updateOptionTrade(trade.id, {
      entry_order: entryLeg,
      tp_leg: tpLeg || trade.tp_leg || null,
      sl_leg: slLeg || trade.sl_leg || null,
    });

    if (trade.status === 'pending_entry') {
      if (this.isFilled(entryLeg)) {
        await this.handleEntryFilled(trade, entryLeg, tpLeg, slLeg);
      } else if (this.isInactive(entryLeg)) {
        await this.handleEntryFailed(trade, entryLeg);
      }
      return;
    }

    if (trade.status === 'open') {
      const settings = settingsService.getExchangeSettings(this.exchange);

      // Check for time-based exit strategies (opening_range, etc.)
      const exitStrategy = this.getExitStrategy(trade);
      if (this.isTimeBasedExit(exitStrategy)) {
        const shouldExit = this.shouldTimeBasedExit(trade);
        if (shouldExit) {
          await this.executeTimeBasedExit(trade, entryLeg, exitStrategy);
          return;
        }
      }

      if (settings.auto_close_outside_window !== false && !this.isWithinTradingWindow(settings)) {
        await this.forceClosePosition(trade, entryLeg);
        return;
      }

      if (tpLeg && this.isFilled(tpLeg)) {
        await this.handleExit(trade, entryLeg, tpLeg, 'TAKE_PROFIT', order);
        return;
      }

      if (slLeg && this.isFilled(slLeg)) {
        await this.handleExit(trade, entryLeg, slLeg, 'STOP_LOSS', order);
        return;
      }
    }
  }

  getExitStrategy(trade) {
    const extraMetadata = trade.extra_metadata || {};
    const configSnapshot = trade.config_snapshot || {};
    return extraMetadata.exitStrategy || configSnapshot.exitStrategy || null;
  }

  isTimeBasedExit(exitStrategy) {
    return ['time_1h', 'time_2h', 'eod'].includes(exitStrategy);
  }

  shouldTimeBasedExit(trade) {
    const extraMetadata = trade.extra_metadata || {};
    const configSnapshot = trade.config_snapshot || {};
    const scheduledExitTime = extraMetadata.scheduledExitTime || configSnapshot.scheduledExitTime;

    if (!scheduledExitTime) {
      // Fallback: calculate based on exit strategy and entry time
      return this.shouldExitByStrategy(trade);
    }

    const exitTime = new Date(scheduledExitTime);
    const now = new Date();

    return now >= exitTime;
  }

  shouldExitByStrategy(trade) {
    const exitStrategy = this.getExitStrategy(trade);
    if (!exitStrategy) return false;

    const now = new Date();
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etNow = new Date(etString);
    const currentMinutes = etNow.getHours() * 60 + etNow.getMinutes();

    switch (exitStrategy) {
      case 'time_1h':
        // Exit at 11:00 AM ET
        return currentMinutes >= 11 * 60;
      case 'time_2h':
        // Exit at 12:00 PM ET
        return currentMinutes >= 12 * 60;
      case 'eod':
        // Exit at 3:55 PM ET
        return currentMinutes >= 15 * 60 + 55;
      default:
        return false;
    }
  }

  async executeTimeBasedExit(trade, entryLeg, exitStrategy) {
    try {
      const exitReasonMap = {
        'time_1h': 'TIME_1H',
        'time_2h': 'TIME_2H',
        'eod': 'EOD',
      };
      const exitReason = exitReasonMap[exitStrategy] || 'TIME_EXIT';

      logger.info(`Executing time-based exit for ${trade.option_symbol} (${exitStrategy})`);

      const quantityContracts = Number(trade.quantity_contracts) || 1;

      const order = await this.api.createOptionMarketOrder({
        underlyingSymbol: trade.underlying_symbol,
        optionSymbol: trade.option_symbol,
        quantity: quantityContracts,
        side: 'sell_to_close',
        duration: 'day',
        tag: `${exitStrategy}_exit`,
      });

      // Wait briefly for fill
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const exitOrder = await this.api.getOrder(trade.underlying_symbol, order.id);
      const exitLeg = this.normalizeLegs(exitOrder.leg).find((leg) =>
        (leg.side || '').toLowerCase() === 'sell_to_close'
      );

      if (exitLeg && this.isFilled(exitLeg)) {
        await this.handleExit(trade, entryLeg, exitLeg, exitReason, exitOrder);
      } else {
        logger.warn(`Time-based exit order ${order.id} did not fill immediately for ${trade.option_symbol}`);
        // Update trade with pending exit order
        await updateOptionTrade(trade.id, {
          time_exit_order: exitOrder,
          extra_metadata: {
            ...trade.extra_metadata,
            pendingTimeExit: true,
            timeExitOrderId: order.id,
          },
        });
      }
    } catch (error) {
      logger.error(`Failed to execute time-based exit for ${trade.id}`, error);
    }
  }

  async handleEntryFilled(trade, entryLeg, tpLeg, slLeg) {
    logger.info(`Tradier option entry filled for ${trade.option_symbol}`);
    await updateOptionTrade(trade.id, {
      status: 'open',
      entry_order: entryLeg,
      tp_leg: tpLeg || trade.tp_leg || null,
      sl_leg: slLeg || trade.sl_leg || null,
    });
  }

  async handleEntryFailed(trade, entryLeg) {
    logger.info(`Tradier option entry failed for ${trade.option_symbol} with status ${entryLeg.status}`);
    await updateOptionTrade(trade.id, {
      status: 'cancelled',
      entry_order: entryLeg,
    });
  }

  async forceClosePosition(trade, entryLeg) {
    try {
      logger.info(`Force closing Tradier option position ${trade.option_symbol} outside trading window`);
      const quantityContracts = Number(trade.quantity_contracts) || 1;

      const order = await this.api.createOptionMarketOrder({
        underlyingSymbol: trade.underlying_symbol,
        optionSymbol: trade.option_symbol,
        quantity: quantityContracts,
        side: 'sell_to_close',
        duration: 'day',
        tag: 'auto_close',
      });

      const exitOrder = await this.api.getOrder(trade.underlying_symbol, order.id);
      const exitLeg = this.normalizeLegs(exitOrder.leg).find((leg) =>
        (leg.side || '').toLowerCase() === 'sell_to_close'
      );

      if (exitLeg && this.isFilled(exitLeg)) {
        await this.handleExit(trade, entryLeg, exitLeg, 'AUTO_CLOSE', exitOrder);
      } else {
        logger.warn(`Auto-close order ${order.id} for ${trade.option_symbol} did not fill immediately`);
      }
    } catch (error) {
      logger.warn(`Failed to force close Tradier option trade ${trade.id}`, error);
    }
  }

  async handleExit(trade, entryLeg, exitLeg, exitReason = 'MANUAL', exitOrder = null) {
    const entryPrice = this.parsePrice(entryLeg.avg_fill_price || entryLeg.price);
    const exitPrice = this.parsePrice(exitLeg.avg_fill_price || exitLeg.price);

    if (entryPrice === null || exitPrice === null) {
      logger.warn(`Cannot compute P&L for ${trade.option_symbol}: missing fill prices`);
      return;
    }

    const contractSize = Number(trade.contract_size) || 100;
    const quantityContracts = Number(trade.quantity_contracts) || 1;
    const quantity = contractSize * quantityContracts;
    const pnlUsd = (exitPrice - entryPrice) * quantity;
    const pnlPercent = entryPrice === 0 ? 0 : ((exitPrice - entryPrice) / entryPrice) * 100;

    logger.info(`Option trade ${trade.option_symbol} closed with P&L $${pnlUsd.toFixed(2)}`);

    await logTrade({
      symbol: trade.underlying_symbol,
      side: 'BUY',
      entryPrice,
      entryTime: entryLeg.transaction_date || entryLeg.create_date || new Date().toISOString(),
      exitPrice,
      exitTime: exitLeg.transaction_date || exitLeg.create_date || new Date().toISOString(),
      quantity,
      positionSizeUsd: trade.cost_usd || entryPrice * quantity,
      stopLossPrice: trade.sl_stop_price || null,
      takeProfitPrice: trade.tp_limit_price || null,
      stopLossPercent: trade.sl_percent || null,
      takeProfitPercent: trade.tp_percent || null,
      pnlUsd,
      pnlPercent,
      assetClass: 'options',
      exchange: this.exchange,
      exitReason,
      notes: `Option symbol: ${trade.option_symbol}`,
    });

    const extraMetadata = trade.extra_metadata || {};

    await updateOptionTrade(trade.id, {
      status: exitReason === 'TAKE_PROFIT' ? 'closed_tp' : exitReason === 'STOP_LOSS' ? 'closed_sl' : 'closed',
      tp_leg: exitReason === 'TAKE_PROFIT' ? exitLeg : trade.tp_leg || exitLeg,
      sl_leg: exitReason === 'STOP_LOSS' ? exitLeg : trade.sl_leg || exitLeg,
      time_exit_order: exitOrder || null,
      pnl_usd: pnlUsd,
      pnl_percent: pnlPercent,
      extra_metadata: {
        ...extraMetadata,
        exit_reason: exitReason,
        exit_leg: exitLeg,
      },
    });
  }

  async fetchOrder(trade) {
    try {
      return await this.api.getOrder(trade.underlying_symbol, trade.entry_order_id);
    } catch (error) {
      logger.warn(`Failed to fetch order ${trade.entry_order_id} for ${trade.option_symbol}`, error);
      return null;
    }
  }

  normalizeLegs(legs) {
    if (!legs) {
      return [];
    }
    return Array.isArray(legs) ? legs : [legs];
  }

  findEntryLeg(legs) {
    return legs.find((leg) => (leg.side || '').toLowerCase() === 'buy_to_open');
  }

  findTakeProfitLeg(legs) {
    return legs.find((leg) => (leg.side || '').toLowerCase() === 'sell_to_close' && (leg.type || '').toLowerCase() === 'limit');
  }

  findStopLossLeg(legs) {
    return legs.find((leg) => (leg.side || '').toLowerCase() === 'sell_to_close' && ['stop', 'stop_limit'].includes((leg.type || '').toLowerCase()));
  }

  isFilled(leg) {
    return leg && LEG_STATUS_FILLED.includes((leg.status || '').toLowerCase());
  }

  isInactive(leg) {
    return leg && LEG_STATUS_INACTIVE.includes((leg.status || '').toLowerCase());
  }

  parsePrice(value) {
    if (value === undefined || value === null) {
      return null;
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  isWithinTradingWindow(settings) {
    const preset = settings.trading_hours_preset || settings.tradingHours || 'ny-session';
    const window = this.resolveWindow(preset, settings.customWindow || settings.trading_window);
    const timeZone = this.windowTimeZone(preset);
    const now = new Date();
    const minutesNow = this.getMinutesInZone(now, timeZone);
    const start = this.parseTimeToMinutes(window[0]);
    const end = this.parseTimeToMinutes(window[1]);

    if (start <= end) {
      return minutesNow >= start && minutesNow <= end;
    }

    return minutesNow >= start || minutesNow <= end;
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

  getMinutesInZone(date, timeZone) {
    const localeString = date.toLocaleString('en-US', { timeZone });
    const zoned = new Date(localeString);
    return zoned.getHours() * 60 + zoned.getMinutes();
  }

  parseTimeToMinutes(value) {
    const [hour, minute] = `${value}`.split(':').map((n) => parseInt(n, 10));
    return (hour || 0) * 60 + (minute || 0);
  }
}

module.exports = TradierOptionsMonitor;

