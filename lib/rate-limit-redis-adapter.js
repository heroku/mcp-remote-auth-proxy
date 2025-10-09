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
      },
    });

    return new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
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

  // Ensure windowMs and max are numbers, not strings
  const windowMs = parseInt(MAX_REQUESTS_WINDOW, 10) || 60000; // 1 minute
  const max = parseInt(MAX_REQUESTS, 10) || 60; // Limit each IP to 60 requests per windowMs

  const rateLimitConfig = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'You have exceeded the rate limit for authorization requests',
    // Let express-rate-limit use its default key generator which handles IPv6 correctly
    // The default key generator uses req.ip which respects trust proxy settings
    store: createRateLimitRedisStore(env),
  };

  return rateLimit(rateLimitConfig);
};
