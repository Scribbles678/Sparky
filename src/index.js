require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const AsterAPI = require('./asterApi');
const PositionTracker = require('./positionTracker');
const TradeExecutor = require('./tradeExecutor');

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
      leverage: {
        BTCUSDT: 20,
        ETHUSDT: 20,
        SOLUSDT: 10,
        default: 5,
      },
      webhookSecret: process.env.WEBHOOK_SECRET,
      aster: {
        apiUrl: process.env.ASTER_API_URL || 'https://api.aster.finance',
        apiKey: process.env.ASTER_API_KEY,
        apiSecret: process.env.ASTER_API_SECRET,
      },
      riskManagement: {
        maxPositions: 10,
        minMarginPercent: 20,
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

// ==================== Express App Setup ====================

const app = express();

// Trust proxy (needed when behind Nginx reverse proxy)
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 requests per minute
  message: 'Too many webhook requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
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

    // Validate webhook secret
    if (!alertData.secret || alertData.secret !== WEBHOOK_SECRET) {
      logger.warn('Unauthorized webhook attempt', {
        ip: req.ip,
        secret: alertData.secret ? '[PROVIDED]' : '[MISSING]',
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid webhook secret',
      });
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

    // Validate action type
    const validActions = ['buy', 'sell', 'close'];
    if (!validActions.includes(alertData.action.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
      });
    }

    // Additional validation for buy/sell actions
    if (['buy', 'sell'].includes(alertData.action.toLowerCase())) {
      if (!alertData.price) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: price (for buy/sell actions)',
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
  logger.info(`Trade amount: $${config.tradeAmount}`);
  logger.info(`Default leverage: ${config.leverage.default}x`);
  
  // Test API connection
  try {
    const balance = await asterApi.getAvailableMargin();
    logger.info(`✅ API connection successful. Available margin: $${balance.toFixed(2)}`);
  } catch (error) {
    logger.error('❌ Failed to connect to Aster API', error.message);
    logger.error('Please check your API credentials');
  }

  // Sync positions on startup
  try {
    await positionTracker.syncWithExchange(asterApi);
    logger.info('✅ Positions synced with exchange on startup');
  } catch (error) {
    logger.warn('⚠️  Failed to sync positions on startup', error.message);
  }
});

// ==================== Graceful Shutdown ====================

const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  
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

