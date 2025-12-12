/**
 * Exchange Factory
 * Creates and returns the appropriate exchange API instance
 * 
 * MULTI-TENANT SUPPORT:
 * - createExchangeForUser(): Creates exchange instance with user's credentials from Supabase
 * - createExchange(): Creates instance from provided config (legacy/fallback)
 */

const AsterAPI = require('./asterApi');
const OandaAPI = require('./oandaApi');
const TradierAPI = require('./tradierApi');
const TradierOptionsAPI = require('./tradierOptionsApi');
const CCXTExchangeAPI = require('./ccxtExchangeApi');
const KalshiAPI = require('./kalshiApi');
const logger = require('../utils/logger');
const { getUserExchangeCredentials } = require('../supabaseClient');

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

      case 'tradier_options':
        if (!config.accountId || !config.accessToken) {
          throw new Error('Tradier Options requires accountId and accessToken');
        }
        return new TradierOptionsAPI(
          config.accountId,
          config.accessToken,
          config.environment || 'sandbox'
        );

      case 'kalshi':
        if (!config.apiKeyId || !config.privateKey) {
          throw new Error('Kalshi requires apiKeyId and privateKey');
        }
        return new KalshiAPI(
          config.apiKeyId,
          config.privateKey,
          config.environment || 'production'
        );
      
      default:
        // Try CCXT for any other exchange (apex, binance, coinbase, etc.)
        // CCXT supports 100+ exchanges with unified API
        try {
          return new CCXTExchangeAPI(name, config);
        } catch (ccxtError) {
          throw new Error(
            `Unknown exchange: ${exchangeName}. ` +
            `Custom exchanges: aster, oanda, tradier, tradier_options, kalshi. ` +
            `CCXT error: ${ccxtError.message}`
          );
        }
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

    // Create Tradier Options instance if configured
    if (fullConfig.tradierOptions && fullConfig.tradierOptions.accessToken) {
      try {
        exchanges.tradier_options = this.createExchange('tradier_options', fullConfig.tradierOptions);
        logger.info('✅ Tradier Options API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Tradier Options: ${error.message}`);
      }
    }

    // Create Kalshi instance if configured
    if (fullConfig.kalshi && fullConfig.kalshi.apiKeyId) {
      try {
        exchanges.kalshi = this.createExchange('kalshi', fullConfig.kalshi);
        logger.info('✅ Kalshi API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Kalshi: ${error.message}`);
      }
    }
    
    return exchanges;
  }

  /**
   * Get list of supported exchanges
   * @returns {array} List of supported exchange names
   */
  static getSupportedExchanges() {
    // Custom exchanges + CCXT exchanges (100+)
    const customExchanges = ['aster', 'oanda', 'tradier', 'tradier_options', 'kalshi'];
    
    // Get CCXT exchanges (dynamically)
    try {
      const ccxt = require('ccxt');
      const ccxtExchanges = Object.keys(ccxt)
        .filter(k => !k.startsWith('_') && typeof ccxt[k] === 'function')
        .map(k => k.toLowerCase());
      
      return [...customExchanges, ...ccxtExchanges];
    } catch (e) {
      // CCXT not installed, return only custom exchanges
      return customExchanges;
    }
  }

  /**
   * MULTI-TENANT: Create an exchange API instance using user's credentials from Supabase
   * This is the PRIMARY method for creating exchange connections in a multi-tenant environment.
   * 
   * @param {string} userId - The user's UUID (from SignalStudio)
   * @param {string} exchangeName - Name of the exchange ('aster', 'oanda', etc.)
   * @returns {Promise<object|null>} Exchange API instance or null if credentials not found
   */
  static async createExchangeForUser(userId, exchangeName) {
    const name = exchangeName.toLowerCase();
    
    logger.info(`🔐 Loading ${name} credentials for user ${userId}...`);
    
    // Fetch user's credentials from Supabase (SignalStudio is source of truth)
    const credentials = await getUserExchangeCredentials(userId, name);
    
    if (!credentials) {
      logger.error(`❌ No ${name} credentials found for user ${userId}`);
      logger.error(`   User must configure their ${name} API keys in SignalStudio`);
      return null;
    }
    
    // Map database fields to exchange config format
    const config = this.mapCredentialsToConfig(name, credentials);
    
    if (!config) {
      logger.error(`❌ Failed to map credentials for ${name}`);
      return null;
    }
    
    try {
      const api = this.createExchange(name, config);
      logger.info(`✅ Created ${name} API instance for user ${userId}`);
      return api;
    } catch (error) {
      logger.error(`❌ Failed to create ${name} API for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Map database credential fields to exchange-specific config format
   * @param {string} exchangeName - Name of the exchange
   * @param {object} credentials - Credentials from Supabase
   * @returns {object|null} Config object for createExchange()
   */
  static mapCredentialsToConfig(exchangeName, credentials) {
    const name = exchangeName.toLowerCase();
    
    switch (name) {
      case 'aster':
        return {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          apiUrl: credentials.extra?.apiUrl || 'https://fapi.asterdex.com',
        };
      
      case 'oanda':
        return {
          accountId: credentials.accountId || credentials.extra?.accountId,
          accessToken: credentials.accessToken || credentials.apiKey,
          environment: credentials.environment || 'practice',
        };
      
      case 'tradier':
        return {
          accountId: credentials.accountId || credentials.extra?.accountId,
          accessToken: credentials.accessToken || credentials.apiKey,
          environment: credentials.environment || 'sandbox',
        };

      case 'tradier_options':
        return {
          accountId: credentials.accountId || credentials.extra?.accountId,
          accessToken: credentials.accessToken || credentials.apiKey,
          environment: credentials.environment || 'sandbox',
        };

      case 'kalshi':
        return {
          apiKeyId: credentials.apiKey, // Key ID goes in api_key field
          privateKey: credentials.apiSecret, // Private key goes in api_secret field
          environment: credentials.environment || 'production',
        };
      
      default:
        // Try CCXT exchange (apex, binance, coinbase, etc.)
        // CCXT uses standard apiKey/apiSecret format
        return {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          passphrase: credentials.passphrase || credentials.extra?.passphrase, // Some exchanges need this
          environment: credentials.environment || 'production',
          sandbox: credentials.environment === 'sandbox',
          options: credentials.extra?.options || {},
        };
    }
  }
}

module.exports = ExchangeFactory;

