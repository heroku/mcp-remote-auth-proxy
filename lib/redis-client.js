import Redis from 'ioredis';

/**
 * Base Redis client that handles connection, TLS, and error management
 * for all Redis operations in the MCP Auth Proxy.
 */
class RedisClient {
  constructor(redisUrl, options = {}) {
    const {
      keyPrefix = '',
      retryDelayOnFailover = 100,
      maxRetriesPerRequest = 3,
      lazyConnect = true,
      errorCallback = null
    } = options;

    if (!redisUrl) {
      throw new Error('Redis URL is required');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(redisUrl);
    } catch (err) {
      throw new Error(`Redis URL must be a valid URL: ${err.message}`);
    }

    // Build Redis connection options
    let redisOpts = { 
      keyPrefix,
      retryDelayOnFailover,
      maxRetriesPerRequest,
      lazyConnect
    };

    // Add TLS configuration for secure connections
    if (parsedUrl.protocol === 'rediss:') {
      redisOpts.tls = {
        // Accept self-signed certificates (common in development/staging)
        rejectUnauthorized: false
      };
    }

    // Create the Redis connection
    this.client = new Redis(parsedUrl.href, redisOpts);

    // Set up error handling
    if (typeof errorCallback === 'function') {
      this.client.on('error', errorCallback);
    } else {
      // Default error handling - log but don't crash
      this.client.on('error', (err) => {
        console.warn('Redis client error:', err);
      });
    }
  }

  /**
   * Static factory method for consistent initialization
   */
  static create(env, options = {}) {
    const { MCP_AUTH_PROXY_REDIS_URL } = env;
    
    if (!MCP_AUTH_PROXY_REDIS_URL) {
      throw new Error('MCP_AUTH_PROXY_REDIS_URL environment variable is required');
    }

    return new RedisClient(MCP_AUTH_PROXY_REDIS_URL, options);
  }

  /**
   * Core Redis operations that domain adapters will use
   */
  async get(key) {
    return await this.client.get(key);
  }

  async set(key, value, ttlSeconds = null) {
    if (ttlSeconds) {
      return await this.client.set(key, value, 'EX', ttlSeconds);
    }
    return await this.client.set(key, value);
  }

  async del(key) {
    return await this.client.del(key);
  }

  async hgetall(key) {
    return await this.client.hgetall(key);
  }

  async hset(key, field, value) {
    return await this.client.hset(key, field, value);
  }

  async hmset(key, hash) {
    return await this.client.hmset(key, hash);
  }

  async rpush(key, value) {
    return await this.client.rpush(key, value);
  }

  async lrange(key, start, stop) {
    return await this.client.lrange(key, start, stop);
  }

  async ttl(key) {
    return await this.client.ttl(key);
  }

  async expire(key, ttlSeconds) {
    return await this.client.expire(key, ttlSeconds);
  }

  /**
   * Transaction support
   */
  multi() {
    return this.client.multi();
  }

  /**
   * Generic command execution (for rate-limit-redis compatibility)
   */
  async call(...args) {
    return await this.client.call(...args);
  }

  /**
   * Disconnect the client
   */
  async disconnect() {
    await this.client.disconnect();
  }

  /**
   * Get the underlying ioredis client (for advanced use cases)
   */
  getClient() {
    return this.client;
  }
}

export default RedisClient;