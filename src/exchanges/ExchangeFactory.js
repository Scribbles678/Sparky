/**
 * Exchange Factory
 * Creates and returns the appropriate exchange API instance
 * 
 * MULTI-TENANT SUPPORT:
 * - createExchangeForUser(): Creates exchange instance with user's credentials from Supabase
 * - createExchange(): Creates instance from provided config (legacy/fallback)
 */

const AsterAPI = require('./asterApi');
const AsterAPIV3 = require('./asterApiV3');
const AsterWebSocket = require('./asterWebSocket');
const OandaAPI = require('./oandaApi');
const TradierAPI = require('./tradierApi');
const TradierOptionsAPI = require('./tradierOptionsApi');
const CCXTExchangeAPI = require('./ccxtExchangeApi');
const KalshiAPI = require('./kalshiApi');
const AlpacaAPI = require('./alpacaApi');
const CapitalAPI = require('./capitalApi');
const RobinhoodAPI = require('./robinhoodApi');
const Trading212API = require('./trading212Api');
const LimeAPI = require('./limeApi');
const PublicAPI = require('./publicApi');
const WebullAPI = require('./webullApi');
const TradeStationAPI = require('./tradestationApi');
// const EtradeAPI = require('./etradeApi'); // Disabled - OAuth 1.0 with daily expiration is too burdensome
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
        // V3 API (EIP-712 wallet-based auth)
        if (config.apiVersion === 'v3' || config.userAddress) {
          if (!config.userAddress || !config.signerAddress || !config.privateKey) {
            throw new Error('Aster DEX V3 requires userAddress, signerAddress, and privateKey');
          }
          const isTestnet = config.environment === 'testnet';
          const v3Api = new AsterAPIV3({
            userAddress: config.userAddress,
            signerAddress: config.signerAddress,
            privateKey: config.privateKey,
            apiUrl: config.apiUrl || (isTestnet 
              ? 'https://fapi.asterdex-testnet.com' 
              : 'https://fapi.asterdex.com'),
            wsUrl: config.wsUrl || (isTestnet
              ? 'wss://fstream.asterdex-testnet.com'
              : 'wss://fstream.asterdex.com'),
            environment: config.environment || 'production',
          });
          logger.info(`✅ Aster V3 API created (${config.environment || 'production'}, EIP-712 auth)`);
          return v3Api;
        }
        // V1/V2 API (legacy HMAC auth — backward compatible)
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

      case 'alpaca':
        if (!config.apiKey || !config.apiSecret) {
          throw new Error('Alpaca requires apiKey and apiSecret');
        }
        return new AlpacaAPI(
          config.apiKey,
          config.apiSecret,
          config.environment || 'production'
        );

      case 'capital':
        if (!config.apiKey || !config.login || !config.password) {
          throw new Error('Capital.com requires apiKey, login, and password');
        }
        return new CapitalAPI(
          config.apiKey,
          config.login,
          config.password,
          config.accountId || null,
          config.environment || 'production'
        );

      case 'robinhood':
        if (!config.apiKey || !config.privateKey) {
          throw new Error('Robinhood Crypto requires apiKey and privateKey (Ed25519)');
        }
        return new RobinhoodAPI(
          config.apiKey,
          config.privateKey,
          config.environment || 'production'
        );

      case 'trading212':
        if (!config.apiKey || !config.apiSecret) {
          throw new Error('Trading212 requires apiKey and apiSecret');
        }
        return new Trading212API(
          config.apiKey,
          config.apiSecret,
          config.environment || 'production'
        );

      case 'lime':
        if (!config.clientId || !config.clientSecret || !config.username || !config.password) {
          throw new Error('Lime requires clientId, clientSecret, username, and password');
        }
        return new LimeAPI(
          config.clientId,
          config.clientSecret,
          config.username,
          config.password,
          config.accountNumber || null,
          config.environment || 'production'
        );

      case 'public':
        if (!config.secretKey) {
          throw new Error('Public.com requires secretKey');
        }
        return new PublicAPI(
          config.secretKey,
          config.accountId || null,
          config.tokenValidityMinutes || 1440,
          config.environment || 'production'
        );

      case 'webull':
        if (!config.appKey || !config.appSecret) {
          throw new Error('Webull requires appKey and appSecret');
        }
        return new WebullAPI(
          config.appKey,
          config.appSecret,
          config.accountId || null,
          config.regionId || 'us',
          config.environment || 'production'
        );

      case 'tradestation':
        if (!config.clientId || !config.clientSecret || !config.refreshToken) {
          throw new Error('TradeStation requires clientId, clientSecret, and refreshToken');
        }
        return new TradeStationAPI(
          config.clientId,
          config.clientSecret,
          config.refreshToken,
          config.accountId || null,
          config.environment || 'production'
        );

      // E*TRADE disabled - OAuth 1.0 with daily token expiration is too burdensome for users
      // case 'etrade':
      //   if (!config.consumerKey || !config.consumerSecret) {
      //     throw new Error('E*TRADE requires consumerKey and consumerSecret');
      //   }
      //   if (!config.accessToken || !config.accessTokenSecret) {
      //     throw new Error('E*TRADE requires accessToken and accessTokenSecret (complete OAuth flow)');
      //   }
      //   return new EtradeAPI(
      //     config.consumerKey,
      //     config.consumerSecret,
      //     config.accessToken,
      //     config.accessTokenSecret,
      //     config.accountIdKey || null,
      //     config.environment || 'production'
      //   );
      
      default:
        // Try CCXT for any other exchange (apex, binance, coinbase, etc.)
        // CCXT supports 100+ exchanges with unified API
        try {
          return new CCXTExchangeAPI(name, config);
        } catch (ccxtError) {
          throw new Error(
            `Unknown exchange: ${exchangeName}. ` +
            `Custom exchanges: aster, oanda, tradier, tradier_options, kalshi, alpaca, capital, robinhood, trading212, lime, public, webull, tradestation. ` +
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

    // Create Alpaca instance if configured
    if (fullConfig.alpaca && fullConfig.alpaca.apiKey) {
      try {
        exchanges.alpaca = this.createExchange('alpaca', fullConfig.alpaca);
        logger.info('✅ Alpaca API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Alpaca: ${error.message}`);
      }
    }

    // Create Capital.com instance if configured
    if (fullConfig.capital && fullConfig.capital.apiKey) {
      try {
        exchanges.capital = this.createExchange('capital', fullConfig.capital);
        logger.info('✅ Capital.com API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Capital.com: ${error.message}`);
      }
    }

    // Create Robinhood Crypto instance if configured
    if (fullConfig.robinhood && fullConfig.robinhood.apiKey) {
      try {
        exchanges.robinhood = this.createExchange('robinhood', fullConfig.robinhood);
        logger.info('✅ Robinhood Crypto API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Robinhood Crypto: ${error.message}`);
      }
    }

    // Create Trading212 instance if configured
    if (fullConfig.trading212 && fullConfig.trading212.apiKey) {
      try {
        exchanges.trading212 = this.createExchange('trading212', fullConfig.trading212);
        logger.info('✅ Trading212 API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Trading212: ${error.message}`);
      }
    }

    // Create Lime instance if configured
    if (fullConfig.lime && fullConfig.lime.clientId) {
      try {
        exchanges.lime = this.createExchange('lime', fullConfig.lime);
        logger.info('✅ Lime Trading API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Lime Trading: ${error.message}`);
      }
    }

    // Create Public.com instance if configured
    if (fullConfig.public && fullConfig.public.secretKey) {
      try {
        exchanges.public = this.createExchange('public', fullConfig.public);
        logger.info('✅ Public.com API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Public.com: ${error.message}`);
      }
    }

    // Create Webull instance if configured
    if (fullConfig.webull && fullConfig.webull.appKey) {
      try {
        exchanges.webull = this.createExchange('webull', fullConfig.webull);
        logger.info('✅ Webull API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize Webull: ${error.message}`);
      }
    }

    // Create TradeStation instance if configured
    if (fullConfig.tradestation && fullConfig.tradestation.refreshToken) {
      try {
        exchanges.tradestation = this.createExchange('tradestation', fullConfig.tradestation);
        logger.info('✅ TradeStation API initialized');
      } catch (error) {
        logger.warn(`⚠️  Failed to initialize TradeStation: ${error.message}`);
      }
    }

    // E*TRADE disabled - OAuth 1.0 with daily token expiration is too burdensome
    // if (fullConfig.etrade && fullConfig.etrade.consumerKey) {
    //   try {
    //     exchanges.etrade = this.createExchange('etrade', fullConfig.etrade);
    //     logger.info('✅ E*TRADE API initialized');
    //   } catch (error) {
    //     logger.warn(`⚠️  Failed to initialize E*TRADE: ${error.message}`);
    //   }
    // }
    
    return exchanges;
  }

  /**
   * Create an Aster WebSocket client paired with a V3 REST API instance
   * @param {object} asterV3Api - AsterAPIV3 instance (from createExchange)
   * @param {string} [environment='production'] - 'production' or 'testnet'
   * @returns {AsterWebSocket} WebSocket client instance
   */
  static createAsterWebSocket(asterV3Api, environment = 'production') {
    if (!asterV3Api || asterV3Api.apiVersion !== 'v3') {
      throw new Error('Aster WebSocket requires a V3 API instance');
    }
    const ws = new AsterWebSocket({
      restApi: asterV3Api,
      environment: environment,
      wsUrl: asterV3Api.wsUrl,
    });
    logger.info(`✅ Aster WebSocket client created (${environment})`);
    return ws;
  }

  /**
   * Get list of supported exchanges
   * @returns {array} List of supported exchange names
   */
  static getSupportedExchanges() {
    // Custom exchanges + CCXT exchanges (100+)
    const customExchanges = ['aster', 'oanda', 'tradier', 'tradier_options', 'kalshi', 'alpaca', 'capital', 'robinhood', 'trading212', 'lime', 'public', 'webull', 'tradestation'];
    
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
   * @param {string} [environment='production'] - 'production' or 'testnet'
   * @returns {Promise<object|null>} Exchange API instance or null if credentials not found
   */
  static async createExchangeForUser(userId, exchangeName, environment = 'production') {
    const name = exchangeName.toLowerCase();
    
    logger.info(`🔐 Loading ${name} credentials for user ${userId} (${environment})...`);
    
    // Fetch user's credentials from Supabase (SignalStudio is source of truth)
    const credentials = await getUserExchangeCredentials(userId, name, environment);
    
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
      case 'aster': {
        const asterExtra = credentials.extra || credentials.extra_metadata || {};
        // Detect V3 credentials (wallet-based auth)
        if (asterExtra.api_version === 'v3' || asterExtra.user_address) {
          const isTestnet = credentials.environment === 'testnet';
          logger.info(`🔐 Loading Aster V3 credentials (${credentials.environment || 'production'})`);
          return {
            apiVersion: 'v3',
            userAddress: asterExtra.user_address,
            signerAddress: asterExtra.signer_address,
            privateKey: asterExtra.private_key,
            apiUrl: asterExtra.apiUrl || (isTestnet
              ? 'https://fapi.asterdex-testnet.com'
              : 'https://fapi.asterdex.com'),
            wsUrl: asterExtra.wsUrl || (isTestnet
              ? 'wss://fstream.asterdex-testnet.com'
              : 'wss://fstream.asterdex.com'),
            environment: credentials.environment || 'production',
          };
        }
        // Legacy V1/V2 credentials (HMAC auth)
        return {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          apiUrl: asterExtra.apiUrl || 'https://fapi.asterdex.com',
        };
      }
      
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

      case 'alpaca':
        return {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          environment: credentials.environment || 'production',
        };

      case 'capital':
        // Capital.com uses API key, login, and password
        const extra = credentials.extra || credentials.extra_metadata || {};
        return {
          apiKey: credentials.apiKey,
          login: extra.login || extra.username || credentials.login,
          password: credentials.apiSecret, // API key password stored in api_secret field
          accountId: extra.accountId || null, // Optional, auto-fetched from session
          environment: credentials.environment || 'production',
        };

      case 'robinhood':
        // Robinhood Crypto uses API key and Ed25519 private key
        return {
          apiKey: credentials.apiKey,
          privateKey: credentials.apiSecret, // Ed25519 private key (Base64) stored in api_secret field
          environment: credentials.environment || 'production',
        };

      case 'trading212':
        // Trading212 uses API key and API secret (HTTP Basic Auth)
        return {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          environment: credentials.environment || 'production',
        };

      case 'lime':
        // Lime uses OAuth 2.0 password flow
        // Requires: client_id, client_secret, username, password
        // Storage: client_id → api_key, client_secret → api_secret, username/password → extra_metadata
        const limeExtra = credentials.extra || credentials.extra_metadata || {};
        if (!credentials.apiKey || !credentials.apiSecret || !limeExtra.username || !limeExtra.password) {
          throw new Error('Lime requires client_id (api_key), client_secret (api_secret), username (extra_metadata), and password (extra_metadata)');
        }
        return {
          clientId: credentials.apiKey, // Client ID stored in api_key field
          clientSecret: credentials.apiSecret, // Client Secret stored in api_secret field
          username: limeExtra.username, // Username stored in extra_metadata.username
          password: limeExtra.password, // Password stored in extra_metadata.password
          accountNumber: limeExtra.accountNumber || credentials.accountNumber || null, // Optional, auto-detected
          environment: credentials.environment || 'production',
        };

      case 'public':
        // Public.com uses secret key → access token flow
        // Storage: secret_key → api_key
        const publicExtra = credentials.extra || credentials.extra_metadata || {};
        if (!credentials.apiKey) {
          throw new Error('Public.com requires secretKey (api_key)');
        }
        return {
          secretKey: credentials.apiKey, // Secret key stored in api_key field
          accountId: publicExtra.accountId || credentials.accountId || null, // Optional, auto-detected
          tokenValidityMinutes: publicExtra.tokenValidityMinutes || 1440, // Default 24 hours
          environment: credentials.environment || 'production',
        };

      case 'webull':
        // Webull uses HMAC-SHA1 signature with App Key and App Secret
        // Storage: app_key → api_key, app_secret → api_secret
        const webullExtra = credentials.extra || credentials.extra_metadata || {};
        if (!credentials.apiKey || !credentials.apiSecret) {
          throw new Error('Webull requires appKey (api_key) and appSecret (api_secret)');
        }
        return {
          appKey: credentials.apiKey, // App Key stored in api_key field
          appSecret: credentials.apiSecret, // App Secret stored in api_secret field
          accountId: webullExtra.accountId || credentials.accountId || null, // Optional, auto-detected
          regionId: webullExtra.regionId || credentials.regionId || 'us', // Default: US
          environment: credentials.environment || 'production',
        };

      case 'tradestation':
        // TradeStation uses OAuth 2.0 Authorization Code Flow
        // Storage: client_id → api_key, client_secret → api_secret, refresh_token → extra_metadata
        const tsExtra = credentials.extra || credentials.extra_metadata || {};
        if (!credentials.apiKey || !credentials.apiSecret) {
          throw new Error('TradeStation requires clientId (api_key) and clientSecret (api_secret)');
        }
        if (!tsExtra.refreshToken && !credentials.refreshToken) {
          throw new Error('TradeStation requires refreshToken (stored in extra_metadata.refreshToken)');
        }
        return {
          clientId: credentials.apiKey, // Client ID stored in api_key field
          clientSecret: credentials.apiSecret, // Client Secret stored in api_secret field
          refreshToken: tsExtra.refreshToken || credentials.refreshToken, // Refresh token from OAuth flow
          accountId: tsExtra.accountId || credentials.accountId || null, // Optional, auto-detected
          environment: credentials.environment || 'production', // 'production' or 'sim'
        };

      // E*TRADE disabled - OAuth 1.0 with daily token expiration is too burdensome
      // case 'etrade':
      //   const extra = credentials.extra || credentials.extra_metadata || {};
      //   return {
      //     consumerKey: credentials.apiKey,
      //     consumerSecret: credentials.apiSecret,
      //     accessToken: extra.accessToken,
      //     accessTokenSecret: extra.accessTokenSecret,
      //     accountIdKey: extra.accountIdKey || null,
      //     environment: credentials.environment || 'production',
      //   };
      
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

