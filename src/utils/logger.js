const winston = require('winston');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Trade logs
    new winston.transports.File({
      filename: path.join('logs', 'trades.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});

// Console logging for non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

// Helper functions
logger.logWebhook = (data) => {
  logger.info('Webhook received', { type: 'webhook', data });
};

logger.logTrade = (action, symbol, details) => {
  logger.info(`Trade ${action}`, {
    type: 'trade',
    action,
    symbol,
    ...details,
  });
};

logger.logPosition = (action, symbol, details) => {
  logger.info(`Position ${action}`, {
    type: 'position',
    action,
    symbol,
    ...details,
  });
};

logger.logError = (context, error, details = {}) => {
  logger.error(`Error in ${context}`, {
    type: 'error',
    context,
    error: error.message,
    stack: error.stack,
    ...details,
  });
};

logger.logApiCall = (method, endpoint, status, duration) => {
  logger.info('API call', {
    type: 'api',
    method,
    endpoint,
    status,
    duration: `${duration}ms`,
  });
};

module.exports = logger;

