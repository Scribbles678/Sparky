require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const AsterAPI = require('./exchanges/asterApi');
const PositionTracker = require('./positionTracker');
const TradeExecutor = require('./tradeExecutor');
const TradierOptionsExecutor = require('./executors/tradierOptionsExecutor');
const TradierOptionsMonitor = require('./monitors/tradierOptionsMonitor');
const PositionUpdater = require('./positionUpdater');
const strategyRoutes = require('./api/strategies');
const settingsService = require('./settings/settingsService');
const ExchangeFactory = require('./exchanges/ExchangeFactory');
const { initRedis, isRedisAvailable } = require('./utils/redis');
const {
  testConnection,
  getBotCredentials,
  validateWebhookSecret,
  initializeCredentialCache,
  refreshCredentialCache,
} = require('./supabaseClient');
const { notifyInvalidCredentials, notifyTradeFailed } = require('./utils/notifications');
const { checkWebhookLimit, invalidateWebhookCountCache, cleanupOldMonthCaches } = require('./utils/webhookLimits');
const { checkRiskLimits } = require('./utils/riskLimits');
const { getExchangeTradeSettings } = require('./supabaseClient');

// ==================== Configuration ====================

// Load config file
let config;
const configPath = path.join(__dirname, '..', 'config.json');

try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    logger.info('Configuration loaded from config.json');
  } else {
    logger.warn('config.json not found, using environment variables only');
    config = {
      tradeAmount: parseFloat(process.env.TRADE_AMOUNT) || 100,
      webhookSecret: process.env.WEBHOOK_SECRET,
      aster: {
        apiUrl: process.env.ASTER_API_URL || 'https://fapi.asterdex.com',
        apiKey: process.env.ASTER_API_KEY,
        apiSecret: process.env.ASTER_API_SECRET,
      },
      riskManagement: {
        maxPositions: 10,
      },
    };
  }
} catch (error) {
  logger.logError('Failed to load configuration', error);
  process.exit(1);
}

config.aster = config.aster || {};
config.oanda = config.oanda || {};
config.tradier = config.tradier || {};
config.tradierOptions = config.tradierOptions || config.tradier_options || {};
config.riskManagement = config.riskManagement || { maxPositions: 10 };

let WEBHOOK_SECRET = config.webhookSecret || process.env.WEBHOOK_SECRET || null;
const PORT = process.env.PORT || 3000;

async function applySupabaseCredentials() {
  try {
    const credentials = await getBotCredentials();

    if (!credentials || credentials.length === 0) {
      logger.warn('No bot credentials found in Supabase. Using config.json values.');
      return;
    }

    const exchangeKeyMap = {
      aster: 'aster',
      oanda: 'oanda',
      tradier: 'tradier',
      tradier_options: 'tradierOptions',
    };

    // Sort credentials: process production entries LAST so they take priority
    // (both testnet and production may exist for the same exchange key,
    // and the last entry processed wins via overwrite)
    const sorted = [...credentials].sort((a, b) => {
      if (a.environment === 'production' && b.environment !== 'production') return 1;
      if (a.environment !== 'production' && b.environment === 'production') return -1;
      return 0;
    });

    // Only apply production credentials for the primary bot exchange.
    // Testnet credentials are loaded on-demand via ExchangeFactory.createExchangeForUser().
    sorted.forEach((entry) => {
      if (entry.exchange === 'webhook') {
        if (entry.webhook_secret) {
          config.webhookSecret = entry.webhook_secret;
        }
        return;
      }

      // Skip non-production credentials for the primary exchange config
      // (testnet is only used on-demand for specific API requests)
      if (entry.environment && entry.environment !== 'production') {
        logger.debug(`Skipping ${entry.exchange} ${entry.environment} credentials for primary config (label: ${entry.label || 'N/A'})`);
        return;
      }

      const configKey = exchangeKeyMap[entry.exchange];
      if (!configKey) {
        logger.warn(`Unknown credential exchange "${entry.exchange}" - skipping`);
        return;
      }

      config[configKey] = config[configKey] || {};
      if (entry.api_key) {
        config[configKey].apiKey = entry.api_key;
      }
      if (entry.api_secret) {
        config[configKey].apiSecret = entry.api_secret;
      }
      if (entry.account_id) {
        config[configKey].accountId = entry.account_id;
      }
      if (entry.environment) {
        config[configKey].environment = entry.environment;
      }
      if (entry.passphrase) {
        config[configKey].passphrase = entry.passphrase;
      }
      // Carry extra_metadata for V3 wallet-based auth (Aster V3, etc.)
      if (entry.extra_metadata && typeof entry.extra_metadata === 'object') {
        const meta = entry.extra_metadata;
        if (meta.api_version === 'v3') {
          config[configKey].apiVersion = 'v3';
          config[configKey].userAddress = meta.user_address;
          config[configKey].signerAddress = meta.signer_address;
          config[configKey].privateKey = meta.private_key;
          logger.info(`🔐 V3 wallet credentials detected for ${entry.exchange} (${entry.environment || 'production'})`);
        }
      }
    });
  } catch (error) {
    logger.warn(`Failed to load credentials from Supabase: ${error.message}`);
  }
}

// ==================== Initialize Components ====================

const positionTracker = new PositionTracker();
const StrategyManager = require('./strategyManager');
const sharedStrategyManager = new StrategyManager();
const tradeExecutors = {};
const positionUpdaters = {};
const optionMonitors = {};
let exchanges = {};
let asterApi = null;
let asterWs = null;  // Aster V3 WebSocket client
let microstructureCollector = null;  // Order book + trade flow collector for ML
let primaryPositionUpdater = null;
let server;

// ==================== Express App Setup ====================

const app = express();

// Export shared strategy manager for API routes
app.locals.strategyManager = sharedStrategyManager;

// Trust proxy (needed when behind Nginx reverse proxy)
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware for dashboard access
app.use((req, res, next) => {
  // Allow requests from dashboard (adjust port if needed)
  const allowedOrigins = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    process.env.DASHBOARD_URL,
  ].filter(Boolean);
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 requests per minute
  message: 'Too many webhook requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false }, // Skip validation warnings for Nginx proxy
});

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// ==================== Routes ====================

// Strategy management routes
app.use('/api/strategies', strategyRoutes);

// Market data routes (for ML validation and Phase 3 features)
const marketDataRouter = require('./routes/marketData');
app.use('/api/market-data', marketDataRouter);

// AI webhook routes (internal use only)
const webhookAiRouter = require('./routes/webhookAi');
app.use('/webhook', webhookAiRouter);

// ==================== Microstructure API (for Arthur ML) ====================

/**
 * Get microstructure collector status and health info.
 * NOTE: Must be registered BEFORE the :symbol route so "status" isn't captured as a symbol param.
 */
app.get('/api/microstructure/status', (req, res) => {
  try {
    if (!microstructureCollector) {
      return res.json({
        success: true,
        running: false,
        message: 'Microstructure collector not initialized (WebSocket may not be available)',
      });
    }

    res.json({
      success: true,
      ...microstructureCollector.getStatus(),
    });
  } catch (error) {
    logger.logError('Microstructure status error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get cached microstructure data (order book snapshots + trades) for a symbol.
 * Used by Arthur's pattern scanner to calculate real microstructure features.
 */
app.get('/api/microstructure/:symbol', (req, res) => {
  try {
    if (!microstructureCollector) {
      return res.status(503).json({
        success: false,
        error: 'Microstructure collector not initialized',
      });
    }

    const symbol = req.params.symbol.toUpperCase().replace('/', '');
    const data = microstructureCollector.getData(symbol);

    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Symbol ${symbol} not tracked. Available: ${microstructureCollector.getTrackedSymbols().join(', ')}`,
      });
    }

    res.json({
      success: true,
      ...data,
    });
  } catch (error) {
    logger.logError('Microstructure data fetch error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * AI Worker health check endpoint
 */
app.get('/health/ai-worker', async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: strategies, error } = await supabase
      .from('ai_strategies')
      .select('id, status')
      .eq('status', 'running');

    if (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch strategies',
        error: error.message
      });
    }

    res.json({
      status: 'ok',
      activeStrategies: strategies?.length || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.logError('AI Worker health check failed', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    if (!asterApi) {
      return res.status(503).json({
        status: 'starting',
        message: 'Exchange connections are still initializing.'
      });
    }

    const uptime = process.uptime();
    const summary = positionTracker.getSummary();
    
    // Try to get balance to verify API connection
    let apiStatus = 'unknown';
    let balance = null;
    
    try {
      const balances = await asterApi.getBalance();
      apiStatus = 'connected';
      balance = balances.find(b => b.asset === 'USDT');
    } catch (error) {
      apiStatus = 'disconnected';
      logger.logError('API health check failed', error);
    }

    // WebSocket status (if V3)
    const wsStatus = asterWs ? asterWs.getStatus() : null;

    res.json({
      status: 'ok',
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      apiStatus,
      apiVersion: asterApi?.apiVersion || 'v1',
      balance: balance ? parseFloat(balance.availableBalance) : null,
      openPositions: summary.totalPositions,
      positions: summary.positions,
      webSocket: wsStatus ? {
        market: wsStatus.market.connected,
        user: wsStatus.user.connected,
        streams: wsStatus.market.streamCount,
        messages: wsStatus.stats.marketMessages + wsStatus.stats.userMessages,
        uptime: wsStatus.stats.uptime,
      } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError('Health check failed', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

/**
 * Get testnet account balance
 * Creates a testnet V3 API instance on-the-fly and fetches the USDT balance
 */
app.get('/balance/testnet', async (req, res) => {
  try {
    let api = null;

    // Try user-specific credential first, then fall back to environment-based lookup
    const userId = req.query.userId;
    if (userId) {
      api = await ExchangeFactory.createExchangeForUser(userId, 'aster', 'testnet');
    } else {
      const { getExchangeCredentialsByEnvironment } = require('./supabaseClient');
      const testnetCreds = await getExchangeCredentialsByEnvironment('aster', 'testnet');
      if (testnetCreds) {
        const testnetConfig = ExchangeFactory.mapCredentialsToConfig('aster', testnetCreds);
        if (testnetConfig) {
          api = ExchangeFactory.createExchange('aster', testnetConfig);
        }
      }
    }

    if (!api) {
      return res.json({
        success: false,
        exchange: 'Aster Testnet',
        balance: null,
        error: 'Testnet credentials not configured',
      });
    }

    // Use getAccountInfo for comprehensive balance (includes unrealized PnL)
    const accountInfo = await api.getAccountInfo();

    // totalMarginBalance = equity (wallet + unrealized PnL) - matches "Perp total value" on Aster UI
    // totalWalletBalance = deposited funds only
    // availableBalance = margin available for new positions
    const totalMargin = parseFloat(accountInfo?.totalMarginBalance || '0');
    const totalWallet = parseFloat(accountInfo?.totalWalletBalance || '0');
    const available = parseFloat(accountInfo?.availableBalance || '0');
    const unrealizedPnl = parseFloat(accountInfo?.totalUnrealizedProfit || '0');

    res.json({
      success: true,
      exchange: 'Aster Testnet',
      balance: totalMargin,
      availableBalance: available,
      totalWalletBalance: totalWallet,
      totalUnrealizedPnl: unrealizedPnl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError('Testnet balance check failed', error);
    res.json({
      success: false,
      exchange: 'Aster Testnet',
      balance: null,
      error: error.message,
    });
  }
});

/**
 * Get current positions
 */
app.get('/positions', (req, res) => {
  try {
    const summary = positionTracker.getSummary();
    res.json(summary);
  } catch (error) {
    logger.logError('Failed to get positions', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Full exchange positions endpoint
 * Returns raw position data from the exchange API (V3-compatible)
 * Used by SignalStudio's trade sync endpoint
 */
app.get('/positions/exchange', async (req, res) => {
  try {
    const environment = req.query.environment || 'production';
    let api = asterApi;

    // For testnet requests, dynamically create a testnet API instance
    if (environment === 'testnet') {
      logger.info('📡 Fetching testnet positions - creating testnet API instance...');
      const userId = req.query.userId || null;
      if (userId) {
        api = await ExchangeFactory.createExchangeForUser(userId, 'aster', 'testnet');
      } else {
        // Load testnet credentials without requiring a specific userId
        const { getExchangeCredentialsByEnvironment } = require('./supabaseClient');
        const testnetCreds = await getExchangeCredentialsByEnvironment('aster', 'testnet');
        if (testnetCreds) {
          const testnetConfig = ExchangeFactory.mapCredentialsToConfig('aster', testnetCreds);
          if (testnetConfig) {
            api = ExchangeFactory.createExchange('aster', testnetConfig);
          }
        }
      }
      if (!api) {
        return res.status(503).json({ success: false, error: 'Testnet exchange API not available - no testnet credentials found' });
      }
    } else if (!api) {
      return res.status(503).json({ success: false, error: 'Exchange API not initialized' });
    }

    const rawPositions = await api.getPositions();
    const activePositions = (rawPositions || []).filter(p => parseFloat(p.positionAmt) !== 0);

    // Normalize to a consistent format
    const positions = activePositions.map(p => {
      const positionAmt = parseFloat(p.positionAmt);
      const entryPrice = parseFloat(p.entryPrice);
      const markPrice = parseFloat(p.markPrice || 0);
      const notional = parseFloat(p.notional || 0);
      const unrealizedProfit = parseFloat(p.unrealizedProfit || p.unRealizedProfit || 0);
      const quantity = Math.abs(positionAmt);
      const positionSizeUsd = Math.abs(notional) || (quantity * markPrice);

      return {
        symbol: p.symbol,
        positionAmt: p.positionAmt,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice || String(markPrice),
        notional: p.notional || String(notional),
        unrealizedProfit: String(unrealizedProfit),
        positionSide: p.positionSide || 'BOTH',
        // Normalized fields for easy consumption
        side: positionAmt > 0 ? 'BUY' : 'SELL',
        quantity,
        positionSizeUsd,
        unrealizedPnlUsd: unrealizedProfit,
        unrealizedPnlPercent: positionSizeUsd > 0 ? (unrealizedProfit / positionSizeUsd) * 100 : 0,
      };
    });

    res.json({
      success: true,
      exchange: 'aster',
      environment,
      apiVersion: api.apiVersion || 'v1',
      count: positions.length,
      positions,
    });
  } catch (error) {
    logger.logError('Failed to get exchange positions', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Close a specific position on the exchange (supports testnet)
 * Used by the Testnet Execution Router for exit synchronization
 */
app.post('/positions/close', async (req, res) => {
  try {
    const { symbol, environment, userId, linked_exchange_id } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }
    
    const env = environment || 'production';
    let api = asterApi;
    
    if (env === 'testnet') {
      if (userId) {
        api = await ExchangeFactory.createExchangeForUser(userId, 'aster', 'testnet');
      } else {
        const { getExchangeCredentialsByEnvironment } = require('./supabaseClient');
        const testnetCreds = await getExchangeCredentialsByEnvironment('aster', 'testnet');
        if (testnetCreds) {
          const testnetConfig = ExchangeFactory.mapCredentialsToConfig('aster', testnetCreds);
          if (testnetConfig) {
            api = ExchangeFactory.createExchange('aster', testnetConfig);
          }
        }
      }
    }
    
    if (!api) {
      return res.status(503).json({ success: false, error: 'Exchange API not available' });
    }
    
    // Get current position to determine side and quantity
    const rawPositions = await api.getPositions();
    const position = (rawPositions || []).find(p => {
      const sym = p.symbol || '';
      return sym === symbol && parseFloat(p.positionAmt) !== 0;
    });
    
    if (!position) {
      return res.json({ success: true, message: 'No open position found', already_closed: true });
    }
    
    const positionAmt = parseFloat(position.positionAmt);
    const closeSide = positionAmt > 0 ? 'SELL' : 'BUY';
    const closeQuantity = Math.abs(positionAmt);
    
    logger.info(`📤 Closing ${env} position: ${symbol} ${closeSide} qty=${closeQuantity}`);
    
    const result = await api.placeOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: closeQuantity,
      reduceOnly: true,
    });
    
    // Get fill price from result if available
    const fillPrice = result?.avgPrice || result?.price || parseFloat(position.markPrice || 0);
    
    res.json({
      success: true,
      symbol,
      side: closeSide,
      quantity: closeQuantity,
      fill_price: fillPrice,
      orderId: result?.orderId,
      environment: env,
    });
    
  } catch (error) {
    logger.logError('Failed to close position', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get recent fills/trades from the exchange (supports testnet)
 * Returns recent trade history with order IDs, timestamps, and fees
 */
app.get('/positions/exchange/fills', async (req, res) => {
  try {
    const environment = req.query.environment || 'production';
    const symbol = req.query.symbol || null;
    const limit = parseInt(req.query.limit) || 50;
    let api = asterApi;
    
    if (environment === 'testnet') {
      const userId = req.query.userId || null;
      if (userId) {
        api = await ExchangeFactory.createExchangeForUser(userId, 'aster', 'testnet');
      } else {
        const { getExchangeCredentialsByEnvironment } = require('./supabaseClient');
        const testnetCreds = await getExchangeCredentialsByEnvironment('aster', 'testnet');
        if (testnetCreds) {
          const testnetConfig = ExchangeFactory.mapCredentialsToConfig('aster', testnetCreds);
          if (testnetConfig) {
            api = ExchangeFactory.createExchange('aster', testnetConfig);
          }
        }
      }
    }
    
    if (!api) {
      return res.status(503).json({ success: false, error: 'Exchange API not available' });
    }
    
    // Fetch recent trades
    let trades = [];
    if (api.getTradeHistory) {
      trades = await api.getTradeHistory(symbol ? { symbol, limit } : { limit });
    } else if (api.getUserTrades) {
      trades = await api.getUserTrades(symbol ? { symbol, limit } : { limit });
    }
    
    // Normalize trade data
    const fills = (trades || []).map(t => ({
      orderId: t.orderId,
      symbol: t.symbol,
      side: t.side,
      quantity: parseFloat(t.qty || t.quantity || 0),
      price: parseFloat(t.price || 0),
      commission: parseFloat(t.commission || t.fee || 0),
      commissionAsset: t.commissionAsset || t.feeAsset || 'USDT',
      time: t.time || t.timestamp,
      realizedPnl: parseFloat(t.realizedPnl || t.realizedProfit || 0),
      isMaker: t.isMaker || false,
    }));
    
    res.json({
      success: true,
      exchange: 'aster',
      environment,
      count: fills.length,
      fills,
    });
  } catch (error) {
    logger.logError('Failed to get exchange fills', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * TradingView webhook endpoint
 * 
 * NOTE: This endpoint now receives pre-built orders from SignalStudio.
 * SignalStudio handles strategy configuration lookup and order building.
 * This bot just validates and executes the order.
 * 
 * Still supports direct webhooks for backward compatibility.
 */
app.post('/webhook', webhookLimiter, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const alertData = req.body;
    
    // Debug: Log received data
    logger.info('Webhook received', {
      body: JSON.stringify(alertData),
      contentType: req.get('content-type'),
      bodySize: JSON.stringify(alertData).length,
      isEmpty: Object.keys(alertData).length === 0,
      source: alertData.strategy_id ? 'SignalStudio (pre-built)' : 'Direct (legacy)',
    });

    // Check if body is empty
    if (!alertData || Object.keys(alertData).length === 0) {
      logger.error('Webhook received with empty body', {
        ip: req.ip,
        contentType: req.get('content-type'),
      });
      return res.status(400).json({
        success: false,
        error: 'Empty webhook body. Check your TradingView alert message configuration.',
        hint: 'Alert message should be valid JSON like: {"secret":"YOUR_SECRET","action":"buy","symbol":"BTCUSDT"}',
      });
    }

    // =========================================================================
    // AUTHENTICATION: Trust SignalStudio or Validate Direct Webhooks
    // =========================================================================
    // If the order comes from SignalStudio (has user_id), trust it - SignalStudio
    // already validated the webhook secret and user authentication.
    // 
    // For direct webhooks (no user_id), validate the secret ourselves.
    // =========================================================================
    
    let userCredential = null;
    const isFromSignalStudio = alertData.user_id || alertData.userId;
    
    if (isFromSignalStudio) {
      // TRUSTED: Order forwarded from SignalStudio (already validated)
      logger.info('🔐 Webhook from SignalStudio - trusting pre-validated order', {
        userId: alertData.user_id || alertData.userId,
        exchange: alertData.exchange,
        source: 'SignalStudio (trusted)',
      });
      
      // Create a pseudo-credential object for downstream use
      userCredential = {
        userId: alertData.user_id || alertData.userId,
        label: 'SignalStudio',
        exchange: 'webhook',
      };
    } else {
      // DIRECT WEBHOOK: Need to validate secret ourselves
      logger.info('Direct webhook received - validating secret...');
      
      if (alertData.secret) {
        try {
          // Use cached validation (fast, no DB query) - synchronous
          userCredential = validateWebhookSecret(alertData.secret);
          
          // If not in cache, fall back to Supabase query (shouldn't happen often)
          if (!userCredential) {
            logger.debug('Secret not in cache, querying Supabase (this should be rare)');
            const { validateWebhookSecretFromDb } = require('./supabaseClient');
            userCredential = await validateWebhookSecretFromDb(alertData.secret);
            
            // If found in DB but not cache, refresh cache
            if (userCredential) {
              await refreshCredentialCache();
            }
          }
        } catch (error) {
          logger.warn('Error validating webhook secret:', error);
        }
      }

      // If Supabase validation failed, fall back to legacy single-secret validation
      if (!userCredential) {
        if (!alertData.secret || alertData.secret !== WEBHOOK_SECRET) {
          logger.warn('Unauthorized webhook attempt', {
            ip: req.ip,
            secret: alertData.secret ? '[PROVIDED]' : '[MISSING]',
            hasBody: Object.keys(alertData).length > 0,
            validationMethod: 'legacy',
          });
          return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid webhook secret',
            hint: alertData.secret ? 'Secret provided but incorrect' : 'Secret missing from webhook body',
          });
        }
        logger.info('Webhook validated using legacy single-secret method');
      } else {
        logger.info('Webhook validated using per-user secret from Supabase', {
          userId: userCredential.userId,
          label: userCredential.label,
        });
      }
    }

    // Clean up symbol (remove exchange prefix if present)
    // TradingView might send "BINANCE:BTCUSDT" or "BYBIT:ETHUSDT"
    if (alertData.symbol && alertData.symbol.includes(':')) {
      const parts = alertData.symbol.split(':');
      alertData.symbol = parts[parts.length - 1]; // Take the last part
      logger.info(`Symbol contained exchange prefix, cleaned to: ${alertData.symbol}`);
    }

    // Validate required fields
    if (!alertData.action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: action',
      });
    }

    if (!alertData.symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: symbol',
      });
    }

    // Normalize action (TradingView might send "long"/"short" or "buy"/"sell")
    const normalizedAction = alertData.action.toLowerCase();
    if (normalizedAction === 'long') {
      alertData.action = 'buy';
      logger.info('Normalized action from "long" to "buy"');
    } else if (normalizedAction === 'short') {
      alertData.action = 'sell';
      logger.info('Normalized action from "short" to "sell"');
    }

    // Validate action type
    const validActions = ['buy', 'sell', 'close'];
    if (!validActions.includes(alertData.action.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: buy, sell, close (or long, short)`,
      });
    }

    // Additional validation for buy/sell actions
    if (['buy', 'sell'].includes(alertData.action.toLowerCase())) {
      // Price is only required for LIMIT orders
      if (alertData.orderType && alertData.orderType.toUpperCase() === 'LIMIT' && !alertData.price) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: price (required for LIMIT orders)',
        });
      }
    }

    // Validate exchange selection
    if (!alertData.exchange) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: exchange',
      });
    }

    const exchange = alertData.exchange.toLowerCase();

    // Validate exchange is supported
    const supportedExchanges = ExchangeFactory.getSupportedExchanges();
    if (!supportedExchanges.includes(exchange)) {
      return res.status(400).json({
        success: false,
        error: `Exchange "${exchange}" not supported. Available exchanges: ${supportedExchanges.join(', ')}`,
      });
    }

    // Extract userId from SignalStudio forwarded order or from Supabase validation
    const userId = alertData.user_id || alertData.userId || userCredential?.userId || null;
    
    logger.info('Processing webhook', {
      exchange: exchange.toUpperCase(),
      action: alertData.action,
      symbol: alertData.symbol,
      userId: userId || 'not provided',
      source: isFromSignalStudio ? 'SignalStudio (trusted)' : 'direct webhook',
    });

    // =========================================================================
    // WEBHOOK LIMIT CHECK: Check monthly subscription limits
    // =========================================================================
    // Only check limits if we have a userId (multi-tenant mode)
    // Legacy webhooks without userId bypass limit checks
    // =========================================================================
    if (userId) {
      try {
        const limitCheck = await checkWebhookLimit(userId);
        
        if (!limitCheck.allowed) {
          logger.warn('Webhook rejected: limit exceeded', {
            userId,
            current: limitCheck.current,
            limit: limitCheck.limit,
            plan: limitCheck.plan,
          });
          
          return res.status(429).json({
            success: false,
            error: 'Webhook limit exceeded',
            message: limitCheck.reason || `Monthly webhook limit exceeded: ${limitCheck.current}/${limitCheck.limit}`,
            data: {
              current: limitCheck.current,
              limit: limitCheck.limit,
              plan: limitCheck.plan,
              resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
            },
          });
        }
        
        logger.debug('Webhook limit check passed', {
          userId,
          current: limitCheck.current,
          limit: limitCheck.limit,
          plan: limitCheck.plan,
        });
      } catch (limitError) {
        // On error, log but allow webhook (graceful degradation)
        logger.warn('Webhook limit check failed, allowing webhook (graceful degradation)', {
          userId,
          error: limitError.message,
        });
      }
    }

    // =========================================================================
    // RISK LIMIT CHECK: Check weekly trade/loss limits from Trade Settings
    // =========================================================================
    // Only check limits if we have a userId (multi-tenant mode)
    // Legacy webhooks without userId bypass risk limit checks
    // =========================================================================
    if (userId) {
      try {
        // Load exchange trade settings (with caching)
        const exchangeSettings = await getExchangeTradeSettings(exchange, userId);
        
        // Check risk limits (max trades per week, max loss per week)
        const riskCheck = await checkRiskLimits(userId, exchange, exchangeSettings);
        
        if (!riskCheck.allowed) {
          logger.warn('Trade rejected: risk limit exceeded', {
            userId,
            exchange,
            limitType: riskCheck.limitType,
            current: riskCheck.current,
            limit: riskCheck.limit,
          });
          
          return res.status(429).json({
            success: false,
            error: 'Risk limit exceeded',
            message: riskCheck.reason,
            data: {
              limitType: riskCheck.limitType,
              current: riskCheck.current,
              limit: riskCheck.limit,
            },
          });
        }
        
        logger.debug('Risk limit check passed', {
          userId,
          exchange,
          maxTradesPerWeek: exchangeSettings.max_trades_per_week || 'unlimited',
          maxLossPerWeek: exchangeSettings.max_loss_per_week_usd || 'unlimited',
        });
      } catch (riskError) {
        // On error, log but allow webhook (graceful degradation)
        logger.warn('Risk limit check failed, allowing webhook (graceful degradation)', {
          userId,
          exchange,
          error: riskError.message,
        });
      }
    }

    // =========================================================================
    // MULTI-TENANT: Create exchange API with user's credentials
    // =========================================================================
    // For multi-tenant operation, each user's API credentials are stored in
    // SignalStudio (bot_credentials table). We load them dynamically here.
    // =========================================================================
    
    let exchangeApi;
    let executor;
    
    if (userId) {
      // MULTI-TENANT: Load user's exchange credentials from Supabase
      // Support testnet environment from Signal Monitor webhook payload
      const environment = alertData.environment || 'production';
      logger.info(`🔐 Loading ${exchange} credentials for user ${userId} (${environment})...`);
      exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange, environment);
      
      if (!exchangeApi) {
        // Send notification about missing credentials
        notifyInvalidCredentials(userId, exchange);
        
        return res.status(400).json({
          success: false,
          error: `No ${exchange} API credentials found for user. Please configure your ${exchange} API keys in SignalStudio.`,
          hint: 'Go to SignalStudio → Settings → Bot Credentials to add your API keys.',
        });
      }
      
      // Create a temporary trade executor with user's exchange API
      executor = new TradeExecutor(exchangeApi, positionTracker, config, exchange);
      logger.info(`✅ Created ${exchange} executor for user ${userId}`);
    } else {
      // LEGACY: Fall back to pre-initialized executors (for backward compatibility)
      logger.warn('⚠️ No userId provided - using legacy pre-initialized executor');
      if (!tradeExecutors[exchange]) {
        return res.status(400).json({
          success: false,
          error: `Exchange "${exchange}" not configured and no user credentials available.`,
        });
      }
      executor = tradeExecutors[exchange];
    }

    // Execute the trade
    const result = await executor.executeWebhook(alertData, userId);

    const duration = Date.now() - startTime;
    logger.info(`Webhook processed successfully in ${duration}ms`, result);

    // Log webhook request to database (async, fire-and-forget)
    // This is needed for limit tracking and analytics
    if (userId) {
      const { logWebhookRequest } = require('./supabaseClient');
      logWebhookRequest({
        userId,
        webhookSecret: alertData.secret,
        exchange: exchange,
        action: alertData.action,
        symbol: alertData.symbol,
        strategyId: alertData.strategy_id || null,
        payload: alertData,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.success ? null : result.message,
      }).then(() => {
        // Invalidate cache after logging so next check sees updated count
        invalidateWebhookCountCache(userId);
      }).catch(err => {
        logger.debug('[Webhook] Failed to log webhook request:', err.message);
      });
    }

    res.json({
      success: true,
      duration: `${duration}ms`,
      ...result,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logError('Webhook processing failed', error, {
      duration: `${duration}ms`,
      body: req.body,
    });

    // Send failure notification (async, fire-and-forget)
    const userId = alertData?.user_id || alertData?.userId;
    if (userId && alertData?.symbol) {
      notifyTradeFailed(
        userId,
        alertData.symbol,
        alertData.action || 'unknown',
        alertData.exchange || 'unknown',
        error.message
      );
    }

    res.status(500).json({
      success: false,
      error: error.message,
      duration: `${duration}ms`,
    });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  logger.logError('Express error handler', err, {
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// ==================== Server Startup ====================

async function bootstrap() {
  // Initialize Redis for credential caching (optional but recommended)
  initRedis();
  if (isRedisAvailable()) {
    logger.info('✅ Redis connected - credential caching enabled');
  } else {
    logger.warn('⚠️ Redis not available - credentials will be fetched from Supabase on each request');
    logger.warn('   Set REDIS_URL in .env for faster performance');
  }

  await applySupabaseCredentials();

  // Initialize credential cache for fast webhook secret validation
  await initializeCredentialCache();
  logger.info('✅ Credential cache initialized');

  // Refresh credential cache every 30 seconds to keep it up-to-date
  setInterval(async () => {
    try {
      await refreshCredentialCache();
      logger.debug('Credential cache refreshed');
    } catch (error) {
      logger.warn('Failed to refresh credential cache:', error.message);
    }
  }, 30000); // 30 seconds

  WEBHOOK_SECRET = config.webhookSecret || process.env.WEBHOOK_SECRET || WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    logger.error('Missing WEBHOOK_SECRET. Configure it via TradeFI or the WEBHOOK_SECRET env variable.');
    process.exit(1);
  }

  // =========================================================================
  // MULTI-TENANT MODE: Exchange credentials loaded per-user from Supabase
  // =========================================================================
  // In multi-tenant mode, exchanges are created dynamically when webhooks arrive.
  // Pre-configured exchanges in config.json are optional (for legacy/testing).
  // =========================================================================
  
  exchanges = ExchangeFactory.createAllExchanges(config);

  if (Object.keys(exchanges).length === 0) {
    logger.info('ℹ️  No pre-configured exchanges in config.json');
    logger.info('   Running in MULTI-TENANT mode - credentials loaded per-user from Supabase');
  } else {
    logger.info(`Pre-configured exchanges (legacy): ${Object.keys(exchanges).join(', ')}`);
    
    // Initialize legacy executors for backward compatibility
    for (const [exchangeName, exchangeApi] of Object.entries(exchanges)) {
      const ExecutorClass = exchangeName === 'tradier_options'
        ? TradierOptionsExecutor
        : TradeExecutor;

      const executor = new ExecutorClass(exchangeApi, positionTracker, config);
      executor.strategyManager = sharedStrategyManager;
      tradeExecutors[exchangeName] = executor;
      positionUpdaters[exchangeName] = new PositionUpdater(exchangeApi, positionTracker, config);

      if (exchangeName === 'tradier_options') {
        optionMonitors[exchangeName] = new TradierOptionsMonitor(exchangeApi, config);
      }
      logger.info(`✅ ${exchangeName.toUpperCase()} executor initialized (legacy)`);
    }
  }

  // Initialize settings service with supported exchanges
  await settingsService.initialize({
    exchanges: ExchangeFactory.getSupportedExchanges(),
    config,
    intervalMs: 60_000,
  }).catch((error) => {
    logger.warn(`Failed to initialize trade settings service: ${error.message}`);
  });

  asterApi = exchanges.aster || Object.values(exchanges)[0] || null;
  primaryPositionUpdater = positionUpdaters.aster || Object.values(positionUpdaters)[0] || null;

  server = app.listen(PORT, async () => {
    logger.info(`🚀 Sparky Trading Bot started on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Mode: ${Object.keys(exchanges).length > 0 ? 'Legacy + Multi-tenant' : 'Multi-tenant only'}`);
    
    let dbConnected = false;
    
    // Test database connection (REQUIRED for multi-tenant mode)
    try {
      dbConnected = await testConnection();
      if (dbConnected) {
        logger.info('✅ Database connection successful');
      } else {
        logger.error('❌ Database not configured - REQUIRED for multi-tenant mode!');
        logger.error('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env');
      }
    } catch (error) {
      logger.error('❌ Database connection failed:', error.message);
      dbConnected = false;
    }

    // Test legacy exchange connection (optional)
    if (asterApi) {
      try {
        const balance = await asterApi.getAvailableMargin();
        logger.info(`✅ Legacy API connection successful. Available margin: $${balance.toFixed(2)}`);
      } catch (error) {
        logger.warn('⚠️  Legacy API connection failed:', error.message);
        logger.info('   This is OK in multi-tenant mode - credentials loaded per-user');
      }

      try {
        await positionTracker.syncWithExchange(asterApi);
        logger.info('✅ Positions synced with exchange on startup');
      } catch (error) {
        logger.warn('⚠️  Failed to sync positions on startup:', error.message);
      }
    } else {
      logger.info('ℹ️  No legacy exchange configured - skipping startup sync');
      logger.info('   Position sync will happen per-user when webhooks arrive');
    }

    if (dbConnected && primaryPositionUpdater) {
      // If Aster V3 is detected, wire up WebSocket for real-time updates
      if (asterApi && asterApi.apiVersion === 'v3') {
        try {
          asterWs = ExchangeFactory.createAsterWebSocket(asterApi, asterApi.environment);
          
          // Attach WebSocket to position updater (enables WS mode)
          primaryPositionUpdater.setWebSocket(asterWs);
          
          // Start WebSocket connections
          const trackedSymbols = positionTracker.getAllPositions().map(p => p.symbol);
          await asterWs.start({
            allTickers: true,       // Subscribe to all tickers (for position updates)
            userStream: true,       // Subscribe to user data stream (order fills, position changes)
            tickerSymbols: trackedSymbols.length > 0 ? trackedSymbols : undefined,
          });
          
          logger.info('✅ Aster V3 WebSocket connected (real-time position updates)');

          // Start microstructure data collector (order book + trade flow for ML)
          try {
            const MicrostructureCollector = require('./services/microstructureCollector');
            microstructureCollector = new MicrostructureCollector(asterWs);
            await microstructureCollector.start();
            logger.info('✅ Microstructure collector started (order book + trade flow for ML)');
          } catch (mcError) {
            logger.warn(`⚠️ Microstructure collector failed to start: ${mcError.message}`);
            microstructureCollector = null;
          }
        } catch (wsError) {
          logger.warn(`⚠️ Aster WebSocket failed to start: ${wsError.message}`);
          logger.info('   Falling back to REST polling mode');
          asterWs = null;
        }
      }
      
      primaryPositionUpdater.start();
      const mode = primaryPositionUpdater.wsMode ? 'WebSocket (real-time)' : 'REST polling (30s)';
      logger.info(`✅ Position price updater started (${mode})`);
      logger.info('✅ Auto-sync enabled (syncs with exchange every 5 minutes)');
    } else if (dbConnected) {
      logger.info('ℹ️  Position price updater skipped (no legacy exchange configured)');
    } else {
      logger.warn('⚠️  Position price updater skipped (database not configured)');
    }

    Object.entries(optionMonitors).forEach(([name, monitor]) => {
      try {
        monitor.start();
        logger.info(`✅ ${name.toUpperCase()} options monitor started`);
      } catch (error) {
        logger.warn(`⚠️  Failed to start ${name} options monitor: ${error.message}`);
      }
    });

    // Clean up old month caches on startup and set up periodic cleanup
    try {
      cleanupOldMonthCaches();
      // Run cleanup every hour to catch month transitions
      setInterval(() => {
        cleanupOldMonthCaches();
      }, 3600000); // 1 hour
      logger.info('✅ Webhook limit cache cleanup scheduled (runs hourly)');
    } catch (error) {
      logger.warn('⚠️  Failed to setup cache cleanup:', error.message);
    }

    // Phase 3: Start auto-retrain scheduler
    try {
      const { startAutoRetrainScheduler } = require('./scheduledJobs/autoRetrain');
      startAutoRetrainScheduler();
      logger.info('✅ Auto-retrain scheduler started (runs hourly)');
    } catch (error) {
      logger.warn('⚠️  Failed to start auto-retrain scheduler:', error.message);
    }
  });
}

bootstrap().catch((error) => {
  logger.logError('Failed to start Sparky bot', error);
  process.exit(1);
});

// ==================== Graceful Shutdown ====================

const shutdown = async () => {
  logger.info('Shutting down gracefully...');

  // Shutdown Microstructure collector
  if (microstructureCollector) {
    try {
      microstructureCollector.stop();
      logger.info('✅ Microstructure collector shut down');
    } catch (error) {
      logger.warn('Failed to shutdown Microstructure collector', error);
    }
  }

  // Shutdown Aster WebSocket connections
  if (asterWs) {
    try {
      await asterWs.shutdown();
      logger.info('✅ Aster WebSocket shut down');
    } catch (error) {
      logger.warn('Failed to shutdown Aster WebSocket', error);
    }
  }

  // Stop position updaters
  Object.values(positionUpdaters).forEach((updater) => {
    try {
      updater.stop();
    } catch (error) {
      logger.warn('Failed to stop position updater', error);
    }
  });

  // Stop options monitors
  Object.values(optionMonitors).forEach((monitor) => {
    try {
      monitor.stop();
    } catch (error) {
      logger.warn('Failed to stop options monitor', error);
    }
  });

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');

      const summary = positionTracker.getSummary();
      logger.info('Final position summary:', summary);

      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.logError('Uncaught exception', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

module.exports = app; // For testing

