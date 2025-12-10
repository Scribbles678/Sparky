/**
 * Exchange Factory
 * Creates and returns the appropriate exchange API instance
 * 
 * MULTI-TENANT SUPPORT:
 * - createExchangeForUser(): Creates exchange instance with user's credentials from Supabase
 * - createExchange(): Creates instance from provided config (legacy/fallback)
 */

const AsterAPI = require('../asterApi');
const OandaAPI = require('./oandaApi');
const TradierAPI = require('./tradierApi');
const TradierOptionsAPI = require('./tradierOptionsApi');
const LighterAPI = require('./lighterApi');
const { HyperliquidAPI } = require('./hyperliquidApi');
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
      
      case 'lighter':
        if (!config.apiKey || !config.privateKey || !config.accountIndex) {
          throw new Error('Lighter requires apiKey, privateKey, and accountIndex');
        }
        return new LighterAPI(
          config.apiKey,
          config.privateKey,
          config.accountIndex,
          config.apiKeyIndex || 2,
          config.baseUrl || 'https://mainnet.zklighter.elliot.ai'
        );
      
      case 'hyperliquid':
        if (!config.apiKey || !config.privateKey) {
          throw new Error('Hyperliquid requires apiKey and privateKey');
        }
        return new HyperliquidAPI(
          config.apiKey,
          config.privateKey,
          config.baseUrl || 'https://api.hyperliquid.xyz',
          config.isTestnet || false
        );
      
      default:
        throw new Error(`Unknown exchange: ${exchangeName}. Supported: aster, oanda, tradier, tradier_options, lighter, hyperliquid`);
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
    
    // Create Lighter instance if configured
    if (fullConfig.lighter && fullConfig.lighter.apiKey) {
      try {
        exchanges.lighter = this.createExchange('lighter', fullConfig.lighter);
        logger.info('✅ Lighter DEX API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Lighter: ${error.message}`);
      }
    }
    
    // Create Hyperliquid instance if configured
    if (fullConfig.hyperliquid && fullConfig.hyperliquid.apiKey) {
      try {
        exchanges.hyperliquid = this.createExchange('hyperliquid', fullConfig.hyperliquid);
        logger.info('✅ Hyperliquid API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Hyperliquid: ${error.message}`);
      }
    }
    
    return exchanges;
  }

  /**
   * Get list of supported exchanges
   * @returns {array} List of supported exchange names
   */
  static getSupportedExchanges() {
    return ['aster', 'oanda', 'tradier', 'tradier_options', 'lighter', 'hyperliquid'];
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
      
      case 'lighter':
        return {
          apiKey: credentials.apiKey,
          privateKey: credentials.apiSecret,
          accountIndex: credentials.extra?.accountIndex || 0,
          apiKeyIndex: credentials.extra?.apiKeyIndex || 2,
          baseUrl: credentials.extra?.baseUrl || 'https://mainnet.zklighter.elliot.ai',
        };
      
      case 'hyperliquid':
        return {
          apiKey: credentials.apiKey,
          privateKey: credentials.apiSecret,
          baseUrl: credentials.extra?.baseUrl || 'https://api.hyperliquid.xyz',
          isTestnet: credentials.extra?.isTestnet || false,
        };
      
      default:
        logger.error(`Unknown exchange for credential mapping: ${exchangeName}`);
        return null;
    }
  }
}

module.exports = ExchangeFactory;

