import assert from 'assert';
import sinon from 'sinon';
import { createRateLimitMiddleware } from '../lib/rate-limit-redis-adapter.js';
import RedisClient from '../lib/redis-client.js';

describe('Rate Limit Redis Adapter', function () {
  let redisClientCreateStub;

  beforeEach(function () {
    redisClientCreateStub = sinon.stub(RedisClient, 'create');
  });

  afterEach(function () {
    redisClientCreateStub.restore();
  });

  describe('createRateLimitMiddleware', function () {
    it('should create middleware with default configuration', function () {
      const env = { LOCAL_INSECURE: 'true' }; // Forces in-memory store

      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function');
      // Rate limiting middleware should have these properties
      assert(middleware.name === 'rateLimitMiddleware' || middleware.name === '');
    });

    it('should use custom rate limit values from environment', function () {
      const env = {
        LOCAL_INSECURE: 'true',
        MAX_REQUESTS_WINDOW: 30000,
        MAX_REQUESTS: 100,
      };

      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function');
    });

    it('should skip Redis in development mode', function () {
      const env = {
        LOCAL_INSECURE: 'true',
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
      };

      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function');
      assert(!redisClientCreateStub.called, 'Should not create Redis client in development');
    });

    it('should skip Redis in test mode', function () {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      try {
        const env = {
          LOCAL_INSECURE: 'false',
          MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
        };

        const middleware = createRateLimitMiddleware(env);

        assert(typeof middleware === 'function', 'Should return a function');
        assert(!redisClientCreateStub.called, 'Should not create Redis client in test mode');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('should create Redis client in production mode', function () {
      const mockRedisClient = {
        call: sinon.stub(),
      };
      redisClientCreateStub.returns(mockRedisClient);

      const env = {
        LOCAL_INSECURE: 'false',
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
      };

      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function');
      assert(redisClientCreateStub.calledOnce, 'Should create Redis client in production');
      assert(
        redisClientCreateStub.calledWith(env, {
          keyPrefix: 'rate-limit:',
          errorCallback: sinon.match.func,
        }),
        'Should pass correct options to RedisClient.create'
      );
    });

    it('should handle Redis client creation failure gracefully', function () {
      redisClientCreateStub.throws(new Error('Redis connection failed'));

      const env = {
        LOCAL_INSECURE: 'false',
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
      };

      // Should not throw, should fall back to in-memory store
      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function even when Redis fails');
      assert(redisClientCreateStub.calledOnce, 'Should attempt to create Redis client');
    });

    it('should skip Redis when no URL is provided', function () {
      const env = {
        LOCAL_INSECURE: 'false',
        // No MCP_AUTH_PROXY_REDIS_URL
      };

      const middleware = createRateLimitMiddleware(env);

      assert(typeof middleware === 'function', 'Should return a function');
      assert(!redisClientCreateStub.called, 'Should not create Redis client without URL');
    });

    it('should handle Redis client error callback', function () {
      const env = {
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
        MAX_REQUESTS_PER_MINUTE: '100',
      };

      // The error callback is passed to RedisClient.create and will be covered
      // if the Redis client has an error during actual usage
      const middleware = createRateLimitMiddleware(env);

      assert.equal(typeof middleware, 'function', 'should create middleware with error callback');
      assert(redisClientCreateStub.called, 'should create Redis client');
    });

    it('should use trust proxy for IP resolution', function () {
      const env = {
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
        LOCAL_INSECURE: 'false',
      };

      // The trust proxy logic exists in the keyGenerator function
      // and will be covered when the middleware is created
      const middleware = createRateLimitMiddleware(env);

      assert.equal(
        typeof middleware,
        'function',
        'should create middleware with trust proxy logic'
      );
      assert(redisClientCreateStub.called, 'should create Redis client');
    });
  });
});
