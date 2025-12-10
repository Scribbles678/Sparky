/**
 * Redis Cache Utility for Sparky
 * 
 * Provides caching for user credentials and other frequently accessed data.
 * Falls back gracefully if Redis is unavailable.
 */

const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;
let redisEnabled = false;

/**
 * Initialize Redis connection
 */
function initRedis() {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;
  const redisPassword = process.env.REDIS_PASSWORD;

  // Check if Redis is configured
  if (!redisUrl && !redisHost) {
    logger.warn('[Redis] Redis not configured - credential caching disabled.');
    logger.warn('[Redis] Set REDIS_URL in .env for faster credential lookups.');
    return null;
  }

  try {
    // Use connection URL if provided
    if (redisUrl) {
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableOfflineQueue: false,
        lazyConnect: true,
      });
    } else if (redisHost && redisPort) {
      redisClient = new Redis({
        host: redisHost,
        port: parseInt(redisPort),
        password: redisPassword,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableOfflineQueue: false,
        lazyConnect: true,
      });
    } else {
      logger.warn('[Redis] Redis configuration incomplete - caching disabled.');
      return null;
    }

    // Connect
    redisClient.connect().catch(err => {
      logger.error('[Redis] Failed to connect:', err.message);
    });

    redisClient.on('connect', () => {
      logger.info('[Redis] ✅ Connected successfully - credential caching enabled');
      redisEnabled = true;
    });

    redisClient.on('error', (error) => {
      logger.error('[Redis] Connection error:', error.message);
      redisEnabled = false;
    });

    redisClient.on('close', () => {
      logger.warn('[Redis] Connection closed');
      redisEnabled = false;
    });

    return redisClient;
  } catch (error) {
    logger.error('[Redis] Failed to initialize:', error.message);
    return null;
  }
}

/**
 * Get Redis client (lazy initialization)
 */
function getRedisClient() {
  if (!redisClient) {
    redisClient = initRedis();
  }
  return redisClient;
}

/**
 * Check if Redis is available
 */
function isRedisAvailable() {
  return redisEnabled && redisClient !== null;
}

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Cached value or null
 */
async function getCache(key) {
  const client = getRedisClient();
  if (!client || !redisEnabled) {
    return null;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value);
  } catch (error) {
    logger.debug(`[Redis] Cache miss for "${key}": ${error.message}`);
    return null;
  }
}

/**
 * Set value in cache with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttlSeconds - Time to live in seconds (default: 60)
 */
async function setCache(key, value, ttlSeconds = 60) {
  const client = getRedisClient();
  if (!client || !redisEnabled) {
    return false;
  }

  try {
    const serialized = JSON.stringify(value);
    await client.setex(key, ttlSeconds, serialized);
    return true;
  } catch (error) {
    logger.debug(`[Redis] Error setting cache key "${key}": ${error.message}`);
    return false;
  }
}

/**
 * Delete cache key
 * @param {string} key - Cache key to delete
 */
async function deleteCache(key) {
  const client = getRedisClient();
  if (!client || !redisEnabled) {
    return false;
  }

  try {
    await client.del(key);
    return true;
  } catch (error) {
    logger.debug(`[Redis] Error deleting cache key "${key}": ${error.message}`);
    return false;
  }
}

/**
 * Delete all keys matching a pattern
 * @param {string} pattern - Pattern to match (e.g., "user:*:credentials")
 */
async function deleteCachePattern(pattern) {
  const client = getRedisClient();
  if (!client || !redisEnabled) {
    return 0;
  }

  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) {
      return 0;
    }
    const deleted = await client.del(...keys);
    return deleted;
  } catch (error) {
    logger.debug(`[Redis] Error deleting pattern "${pattern}": ${error.message}`);
    return 0;
  }
}

/**
 * Get or set pattern - fetch from cache or source
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch data on cache miss
 * @param {number} ttlSeconds - TTL in seconds
 */
async function getOrSetCache(key, fetchFn, ttlSeconds = 60) {
  // Try cache first
  const cached = await getCache(key);
  if (cached !== null) {
    logger.debug(`[Redis] Cache HIT for "${key}"`);
    return cached;
  }

  // Cache miss - fetch from source
  logger.debug(`[Redis] Cache MISS for "${key}" - fetching from source`);
  const value = await fetchFn();
  
  // Store in cache (don't wait)
  if (value !== null && value !== undefined) {
    setCache(key, value, ttlSeconds).catch(err => {
      logger.debug(`[Redis] Failed to cache "${key}": ${err.message}`);
    });
  }

  return value;
}

module.exports = {
  initRedis,
  getRedisClient,
  isRedisAvailable,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  getOrSetCache,
};

