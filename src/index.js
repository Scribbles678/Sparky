require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const AsterAPI = require('./asterApi');
const PositionTracker = require('./positionTracker');
const TradeExecutor = require('./tradeExecutor');
const TradierOptionsExecutor = require('./executors/tradierOptionsExecutor');
const TradierOptionsMonitor = require('./monitors/tradierOptionsMonitor');
const PositionUpdater = require('./positionUpdater');
const strategyRoutes = require('./api/strategies');
const settingsService = require('./settings/settingsService');
const {
  testConnection,
  getBotCredentials,
  validateWebhookSecret,
} = require('./supabaseClient');

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
        apiUrl: process.env.ASTER_API_URL || 'https://api.aster.finance',
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
config.hyperliquid = config.hyperliquid || {};
config.lighter = config.lighter || {};
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
      lighter: 'lighter',
      hyperliquid: 'hyperliquid',
    };

    credentials.forEach((entry) => {
      if (entry.exchange === 'webhook') {
        if (entry.webhook_secret) {
          config.webhookSecret = entry.webhook_secret;
        }
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
    });
  } catch (error) {
    logger.warn(`Failed to load credentials from Supabase: ${error.message}`);
  }
}

// ==================== Initialize Components ====================

const ExchangeFactory = require('./exchanges/ExchangeFactory');
const positionTracker = new PositionTracker();
const StrategyManager = require('./strategyManager');
const sharedStrategyManager = new StrategyManager();
const tradeExecutors = {};
const positionUpdaters = {};
const optionMonitors = {};
let exchanges = {};
let asterApi = null;
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

    res.json({
      status: 'ok',
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      apiStatus,
      balance: balance ? parseFloat(balance.availableBalance) : null,
      openPositions: summary.totalPositions,
      positions: summary.positions,
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
 * Test webhook endpoint - accepts any data and shows what was received
 * Useful for debugging TradingView webhook configuration
 */
app.post('/webhook/test', (req, res) => {
  const receivedData = {
    headers: {
      'content-type': req.get('content-type'),
      'user-agent': req.get('user-agent'),
    },
    body: req.body,
    bodyIsEmpty: Object.keys(req.body).length === 0,
    bodyKeys: Object.keys(req.body),
    rawBody: JSON.stringify(req.body, null, 2),
  };

  logger.info('Test webhook received', receivedData);

  res.json({
    success: true,
    message: 'Test webhook received successfully',
    received: receivedData,
    expectedFormat: {
      secret: 'your-webhook-secret',
      action: 'buy or sell or close',
      symbol: 'BTCUSDT',
      orderType: 'market (optional, defaults to market)',
      stop_loss_percent: 2,
      take_profit_percent: 4,
    },
  });
});

/**
 * Sync positions with exchange
 */
app.post('/positions/sync', async (req, res) => {
  try {
    if (!asterApi) {
      return res.status(503).json({
        success: false,
        error: 'Exchange not initialized'
      });
    }

    const summary = await positionTracker.syncWithExchange(asterApi);
    res.json({
      success: true,
      message: 'Positions synced with exchange',
      summary,
    });
  } catch (error) {
    logger.logError('Failed to sync positions', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
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

    // Validate webhook secret
    // First try per-user validation from Supabase (preferred method)
    let userCredential = null;
    if (alertData.secret) {
      try {
        userCredential = await validateWebhookSecret(alertData.secret);
      } catch (error) {
        logger.warn('Error validating webhook secret from Supabase:', error);
        // Fall through to legacy validation
      }
    }

    // If Supabase validation failed, fall back to legacy single-secret validation
    // This provides backward compatibility for direct webhooks
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

    if (!tradeExecutors[exchange]) {
      return res.status(400).json({
        success: false,
        error: `Exchange "${exchange}" not configured. Available exchanges: ${Object.keys(tradeExecutors).join(', ')}`,
      });
    }

    // Execute the trade on the correct exchange
    logger.info('Processing webhook', {
      exchange: exchange.toUpperCase(),
      action: alertData.action,
      symbol: alertData.symbol,
    });

    const result = await tradeExecutors[exchange].executeWebhook(alertData);

    const duration = Date.now() - startTime;
    logger.info(`Webhook processed successfully in ${duration}ms`, result);

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
  await applySupabaseCredentials();

  WEBHOOK_SECRET = config.webhookSecret || process.env.WEBHOOK_SECRET || WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    logger.error('Missing WEBHOOK_SECRET. Configure it via TradeFI or the WEBHOOK_SECRET env variable.');
    process.exit(1);
  }

  exchanges = ExchangeFactory.createAllExchanges(config);

  if (Object.keys(exchanges).length === 0) {
    logger.error('No exchanges configured! Please add at least one exchange via TradeFI.');
    process.exit(1);
  }

  logger.info(`Configured exchanges: ${Object.keys(exchanges).join(', ')}`);

  await settingsService.initialize({
    exchanges: Object.keys(exchanges),
    config,
    intervalMs: 60_000,
  }).catch((error) => {
    logger.warn(`Failed to initialize trade settings service: ${error.message}`);
  });

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
    logger.info(`✅ ${exchangeName.toUpperCase()} executor initialized`);
  }

  asterApi = exchanges.aster || Object.values(exchanges)[0];
  primaryPositionUpdater = positionUpdaters.aster || Object.values(positionUpdaters)[0];

  server = app.listen(PORT, async () => {
    logger.info(`🚀 Sparky Trading Bot started on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`API URL: ${config.aster.apiUrl || 'N/A'}`);
    logger.info(`Position size: $${config.tradeAmount || 0} per trade`);
    
    let dbConnected = false;
    
    try {
      const balance = await asterApi.getAvailableMargin();
      logger.info(`✅ API connection successful. Available margin: $${balance.toFixed(2)}`);
    } catch (error) {
      logger.error('❌ Failed to connect to Aster API', error.message);
      logger.error('Please check your API credentials');
    }

    try {
      dbConnected = await testConnection();
      if (dbConnected) {
        logger.info('✅ Database connection successful');
      } else {
        logger.warn('⚠️  Database not configured. Trades will not be logged to Supabase.');
        logger.warn('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env to enable database logging.');
      }
    } catch (error) {
      logger.warn('⚠️  Database connection failed', error.message);
      dbConnected = false;
    }

    try {
      await positionTracker.syncWithExchange(asterApi);
      logger.info('✅ Positions synced with exchange on startup');
    } catch (error) {
      logger.warn('⚠️  Failed to sync positions on startup', error.message);
    }

    if (dbConnected && primaryPositionUpdater) {
      primaryPositionUpdater.start();
      logger.info('✅ Position price updater started (updates every 30s)');
      logger.info('✅ Auto-sync enabled (syncs with exchange every 5 minutes)');
    } else {
      logger.info('ℹ️  Position price updater skipped (database not configured)');
    }

    Object.entries(optionMonitors).forEach(([name, monitor]) => {
      try {
        monitor.start();
        logger.info(`✅ ${name.toUpperCase()} options monitor started`);
      } catch (error) {
        logger.warn(`⚠️  Failed to start ${name} options monitor: ${error.message}`);
      }
    });
  });
}

bootstrap().catch((error) => {
  logger.logError('Failed to start Sparky bot', error);
  process.exit(1);
});

// ==================== Graceful Shutdown ====================

const shutdown = async () => {
  logger.info('Shutting down gracefully...');

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

