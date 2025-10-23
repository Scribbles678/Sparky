/**
 * Exchange Factory
 * Creates and returns the appropriate exchange API instance
 */

const AsterAPI = require('../asterApi');
const OandaAPI = require('./oandaApi');
const TradierAPI = require('./tradierApi');
const logger = require('../utils/logger');

class ExchangeFactory {
  /**
   * Create an exchange API instance based on configuration
   * @param {string} exchangeName - Name of the exchange ('aster', 'oanda', 'tradier')
   * @param {object} config - Configuration object for the exchange
   * @returns {object} Exchange API instance
   */
  static createExchange(exchangeName, config) {
    const name = exchangeName.toLowerCase();
    
    logger.info(`Creating exchange API instance for: ${name}`);
    
    switch (name) {
      case 'aster':
        if (!config.apiKey || !config.apiSecret) {
          throw new Error('Aster DEX requires apiKey and apiSecret');
        }
        return new AsterAPI(
          config.apiKey,
          config.apiSecret,
          config.apiUrl || 'https://fapi.asterdex.com'
        );
      
      case 'oanda':
        if (!config.accountId || !config.accessToken) {
          throw new Error('OANDA requires accountId and accessToken');
        }
        return new OandaAPI(
          config.accountId,
          config.accessToken,
          config.environment || 'practice'
        );
      
      case 'tradier':
        if (!config.accountId || !config.accessToken) {
          throw new Error('Tradier requires accountId and accessToken');
        }
        return new TradierAPI(
          config.accountId,
          config.accessToken,
          config.environment || 'sandbox'
        );
      
      default:
        throw new Error(`Unknown exchange: ${exchangeName}. Supported: aster, oanda, tradier`);
    }
  }

  /**
   * Create multiple exchange instances from config
   * @param {object} fullConfig - Complete configuration object
   * @returns {object} Map of exchange name to API instance
   */
  static createAllExchanges(fullConfig) {
    const exchanges = {};
    
    // Create Aster DEX instance if configured
    if (fullConfig.aster && fullConfig.aster.apiKey) {
      try {
        exchanges.aster = this.createExchange('aster', fullConfig.aster);
        logger.info('✅ Aster DEX API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Aster DEX: ${error.message}`);
      }
    }
    
    // Create OANDA instance if configured
    if (fullConfig.oanda && fullConfig.oanda.accountId) {
      try {
        exchanges.oanda = this.createExchange('oanda', fullConfig.oanda);
        logger.info('✅ OANDA API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize OANDA: ${error.message}`);
      }
    }
    
    // Create Tradier instance if configured
    if (fullConfig.tradier && fullConfig.tradier.accessToken) {
      try {
        exchanges.tradier = this.createExchange('tradier', fullConfig.tradier);
        logger.info('✅ Tradier API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Tradier: ${error.message}`);
      }
    }
    
    return exchanges;
  }

  /**
   * Get list of supported exchanges
   * @returns {array} List of supported exchange names
   */
  static getSupportedExchanges() {
    return ['aster', 'oanda', 'tradier'];
  }
}

module.exports = ExchangeFactory;

