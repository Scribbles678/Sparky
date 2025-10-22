require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const AsterAPI = require('./asterApi');
const PositionTracker = require('./positionTracker');
const TradeExecutor = require('./tradeExecutor');
const PositionUpdater = require('./positionUpdater');

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

// Validate required configuration
if (!config.aster.apiKey || !config.aster.apiSecret) {
  logger.error('Missing required API credentials. Set ASTER_API_KEY and ASTER_API_SECRET');
  process.exit(1);
}

if (!config.webhookSecret && !process.env.WEBHOOK_SECRET) {
  logger.error('Missing WEBHOOK_SECRET. This is required for security.');
  process.exit(1);
}

const WEBHOOK_SECRET = config.webhookSecret || process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

// ==================== Initialize Components ====================

const asterApi = new AsterAPI(
  config.aster.apiKey,
  config.aster.apiSecret,
  config.aster.apiUrl
);

const positionTracker = new PositionTracker();
const tradeExecutor = new TradeExecutor(asterApi, positionTracker, config);
const positionUpdater = new PositionUpdater(asterApi, positionTracker, config);

// ==================== Express App Setup ====================

const app = express();

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

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
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
    if (!alertData.secret || alertData.secret !== WEBHOOK_SECRET) {
      logger.warn('Unauthorized webhook attempt', {
        ip: req.ip,
        secret: alertData.secret ? '[PROVIDED]' : '[MISSING]',
        hasBody: Object.keys(alertData).length > 0,
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid webhook secret',
        hint: alertData.secret ? 'Secret provided but incorrect' : 'Secret missing from webhook body',
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

    // Execute the trade
    logger.info('Processing webhook', {
      action: alertData.action,
      symbol: alertData.symbol,
    });

    const result = await tradeExecutor.executeWebhook(alertData);

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

const server = app.listen(PORT, async () => {
  logger.info(`🚀 Sparky Trading Bot started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`API URL: ${config.aster.apiUrl}`);
  logger.info(`Position size: $${config.tradeAmount} per trade`);
  
  // Initialize dbConnected at function scope
  let dbConnected = false;
  
  // Test API connection
  try {
    const balance = await asterApi.getAvailableMargin();
    logger.info(`✅ API connection successful. Available margin: $${balance.toFixed(2)}`);
  } catch (error) {
    logger.error('❌ Failed to connect to Aster API', error.message);
    logger.error('Please check your API credentials');
  }

  // Test database connection
  try {
    const { testConnection } = require('./supabaseClient');
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

  // Sync positions on startup
  try {
    await positionTracker.syncWithExchange(asterApi);
    logger.info('✅ Positions synced with exchange on startup');
  } catch (error) {
    logger.warn('⚠️  Failed to sync positions on startup', error.message);
  }

  // Start position price updater service
  if (dbConnected) {
    positionUpdater.start();
    logger.info('✅ Position price updater started (updates every 30s)');
  } else {
    logger.info('ℹ️  Position price updater skipped (database not configured)');
  }
});

// ==================== Graceful Shutdown ====================

const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  
  // Stop position updater
  positionUpdater.stop();
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Log final position summary
    const summary = positionTracker.getSummary();
    logger.info('Final position summary:', summary);
    
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
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

