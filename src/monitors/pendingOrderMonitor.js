/**
 * Pending Order Monitor
 * 
 * Monitors pending/unfilled orders and automatically cancels them based on user settings.
 * Supports time-based cancellation (1m, 5m, 15m, 30m, 1h) and session-based cancellation.
 * 
 * Usage:
 *   const monitor = new PendingOrderMonitor(exchangeApi, config);
 *   monitor.start();
 */

const logger = require('../utils/logger');
const settingsService = require('../settings/settingsService');

class PendingOrderMonitor {
  constructor(exchangeApi, config, intervalMs = 30000) {
    this.api = exchangeApi;
    this.config = config;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.processing = new Set();
    this.exchange = exchangeApi.exchangeName || exchangeApi.getExchangeName?.() || 'unknown';
  }

  /**
   * Start the monitoring loop
   */
  start() {
    if (this.timer) {
      logger.info(`Pending Order Monitor already running for ${this.exchange}`);
      return;
    }

    logger.info(`Starting Pending Order Monitor for ${this.exchange}`);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick().catch((error) => {
      logger.warn(`Pending Order Monitor initial tick failed for ${this.exchange}`, error);
    });
  }

  /**
   * Stop the monitoring loop
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info(`Pending Order Monitor stopped for ${this.exchange}`);
    }
  }

  /**
   * Main monitoring tick - checks all pending orders
   */
  async tick() {
    try {
      // Get exchange settings
      const settings = settingsService.getExchangeSettings(this.exchange);
      
      // Check if pending order cancellation is enabled
      if (!settings.cancel_pending_orders) {
        return; // Feature disabled
      }

      // Fetch all pending/open orders from the exchange
      const pendingOrders = await this.fetchPendingOrders();
      
      if (!pendingOrders || pendingOrders.length === 0) {
        return;
      }

      logger.info(`[${this.exchange}] Found ${pendingOrders.length} pending orders to check`);

      // Process each order
      for (const order of pendingOrders) {
        if (this.processing.has(order.id)) {
          continue; // Already processing this order
        }

        this.processing.add(order.id);
        this.processOrder(order, settings)
          .catch((error) => {
            logger.warn(`Failed to process pending order ${order.id} on ${this.exchange}`, error);
          })
          .finally(() => {
            this.processing.delete(order.id);
          });
      }
    } catch (error) {
      logger.warn(`Pending Order Monitor tick failed for ${this.exchange}`, error);
    }
  }

  /**
   * Process a single pending order
   */
  async processOrder(order, settings) {
    const cancelAfter = settings.cancel_pending_after || '15m';
    
    // Check if order should be cancelled
    const shouldCancel = this.shouldCancelOrder(order, cancelAfter, settings);
    
    if (!shouldCancel) {
      return; // Order is still within acceptable time
    }

    // Cancel the order
    try {
      logger.info(`[${this.exchange}] Cancelling pending order ${order.id} (${order.symbol}) - exceeded ${cancelAfter} timeout`);
      
      await this.cancelOrder(order);
      
      logger.info(`[${this.exchange}] Successfully cancelled pending order ${order.id}`);
    } catch (error) {
      logger.error(`[${this.exchange}] Failed to cancel pending order ${order.id}`, error);
    }
  }

  /**
   * Determine if an order should be cancelled based on settings
   */
  shouldCancelOrder(order, cancelAfter, settings) {
    const now = new Date();
    const orderTime = new Date(order.timestamp || order.created_at || order.datetime);
    
    // Handle "before_session" mode
    if (cancelAfter === 'before_session') {
      return this.shouldCancelBeforeSession(orderTime, settings);
    }
    
    // Handle time-based modes (1m, 5m, 15m, 30m, 1h)
    const timeoutMs = this.parseTimeoutToMs(cancelAfter);
    const orderAgeMs = now.getTime() - orderTime.getTime();
    
    return orderAgeMs >= timeoutMs;
  }

  /**
   * Check if order should be cancelled before trading session ends
   */
  shouldCancelBeforeSession(orderTime, settings) {
    const preset = settings.trading_hours_preset || '24/5';
    const window = this.resolveWindow(preset, settings.trading_window);
    const timeZone = this.windowTimeZone(preset);
    
    const now = new Date();
    const minutesNow = this.getMinutesInZone(now, timeZone);
    const endMinutes = this.parseTimeToMinutes(window[1]);
    
    // Cancel orders 5 minutes before session ends
    const cancelThreshold = endMinutes - 5;
    
    return minutesNow >= cancelThreshold;
  }

  /**
   * Parse timeout string (1m, 5m, 15m, 30m, 1h) to milliseconds
   */
  parseTimeoutToMs(timeout) {
    const match = timeout.match(/^(\d+)([mh])$/);
    if (!match) {
      logger.warn(`Invalid timeout format: ${timeout}, defaulting to 15m`);
      return 15 * 60 * 1000; // 15 minutes default
    }
    
    const value = parseInt(match[1], 10);
    const unit = match[2];
    
    if (unit === 'm') {
      return value * 60 * 1000; // minutes to ms
    } else if (unit === 'h') {
      return value * 60 * 60 * 1000; // hours to ms
    }
    
    return 15 * 60 * 1000; // Default 15 minutes
  }

  /**
   * Fetch pending orders from the exchange
   * This method should be overridden by exchange-specific implementations
   * or use the exchange API's native method if available
   */
  async fetchPendingOrders() {
    try {
      // Try to use exchange API's fetchOpenOrders method if available
      if (typeof this.api.fetchOpenOrders === 'function') {
        return await this.api.fetchOpenOrders();
      }
      
      // For custom exchange APIs, implement exchange-specific logic
      if (typeof this.api.getOpenOrders === 'function') {
        return await this.api.getOpenOrders();
      }
      
      logger.warn(`[${this.exchange}] No method available to fetch pending orders`);
      return [];
    } catch (error) {
      logger.error(`[${this.exchange}] Failed to fetch pending orders`, error);
      return [];
    }
  }

  /**
   * Cancel an order
   * This method should be overridden by exchange-specific implementations
   * or use the exchange API's native method if available
   */
  async cancelOrder(order) {
    try {
      // Try to use exchange API's cancelOrder method if available
      if (typeof this.api.cancelOrder === 'function') {
        return await this.api.cancelOrder(order.id, order.symbol);
      }
      
      // For custom exchange APIs, implement exchange-specific logic
      if (typeof this.api.cancel === 'function') {
        return await this.api.cancel(order.id, order.symbol);
      }
      
      throw new Error(`No method available to cancel order on ${this.exchange}`);
    } catch (error) {
      logger.error(`[${this.exchange}] Failed to cancel order ${order.id}`, error);
      throw error;
    }
  }

  /**
   * Helper: Resolve trading window from preset
   */
  resolveWindow(preset, customWindow) {
    switch (preset) {
      case '24/7':
      case '24/5':
        return ['00:00', '23:59'];
      case 'market-hours':
        return ['09:30', '16:00'];
      case 'forex-hours':
        return ['00:00', '23:59'];
      case 'custom':
        if (Array.isArray(customWindow) && customWindow.length === 2) {
          return customWindow;
        }
        return ['00:00', '23:59'];
      default:
        return ['09:30', '16:00'];
    }
  }

  /**
   * Helper: Get timezone for trading window
   */
  windowTimeZone(preset) {
    switch (preset) {
      case 'forex-hours':
        return 'UTC';
      default:
        return 'America/New_York';
    }
  }

  /**
   * Helper: Get current minutes in specified timezone
   */
  getMinutesInZone(date, timeZone) {
    const localeString = date.toLocaleString('en-US', { timeZone });
    const zoned = new Date(localeString);
    return zoned.getHours() * 60 + zoned.getMinutes();
  }

  /**
   * Helper: Parse time string (HH:MM) to minutes
   */
  parseTimeToMinutes(value) {
    const [hour, minute] = `${value}`.split(':').map((n) => parseInt(n, 10));
    return (hour || 0) * 60 + (minute || 0);
  }
}

module.exports = PendingOrderMonitor;

