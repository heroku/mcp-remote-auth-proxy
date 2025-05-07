import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import RedisClient from './redis-client.js';

/**
 * Creates a Redis store for rate limiting using our base RedisClient.
 * Returns null if Redis should not be used (development/test mode).
 */
const createRateLimitRedisStore = (env) => {
  const { LOCAL_INSECURE, MCP_AUTH_PROXY_REDIS_URL } = env;
  
  // Skip Redis in development/test modes
  if (LOCAL_INSECURE === 'true' || process.env.NODE_ENV === 'test') {
    return null; // Falls back to in-memory store
  }

  if (!MCP_AUTH_PROXY_REDIS_URL) {
    return null; // No Redis URL configured
  }

  try {
    const redisClient = RedisClient.create(env, {
      keyPrefix: 'rate-limit:',
      errorCallback: (err) => {
        console.warn('Rate limit Redis client error:', err);
        // Don't exit on Redis errors, just fall back to in-memory store
      }
    });

    return new RedisStore({
      sendCommand: (...args) => redisClient.call(...args)
    });
  } catch (err) {
    console.warn('Failed to create rate limit Redis client:', err);
    return null;
  }
};

/**
 * Creates the rate limiting middleware with Redis or in-memory store.
 * Extracted from server.js for cleaner separation of concerns.
 */
export const createRateLimitMiddleware = (env) => {
  const { MAX_REQUESTS_WINDOW, MAX_REQUESTS } = env;

  const rateLimitConfig = {
    windowMs: MAX_REQUESTS_WINDOW || 60000, // 1 minute
    max: MAX_REQUESTS || 60, // Limit each IP to 60 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: 'You have exceeded the rate limit for authorization requests',
    // Handle trust proxy configuration
    validate: {
      trustProxy: false // Acknowledge we understand the implications
    },
    // Use a more secure key generator when trust proxy is enabled
    keyGenerator: (req) => {
      // In production with trust proxy, use the rightmost IP from X-Forwarded-For
      // This assumes your proxy setup properly sanitizes the header
      if (req.app.get('trust proxy')) {
        return req.ip; // Express handles this based on trust proxy settings
      }
      return req.connection.remoteAddress || req.socket.remoteAddress;
    },
    store: createRateLimitRedisStore(env)
  };

  return rateLimit(rateLimitConfig);
};