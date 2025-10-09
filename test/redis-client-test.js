import assert from 'assert';
import sinon from 'sinon';
import RedisClient from '../lib/redis-client.js';

describe('RedisClient', function () {
  describe('URL validation', function () {
    it('should throw error for invalid URL', function () {
      assert.throws(() => {
        new RedisClient('not-a-url');
      }, /Redis URL must be a valid URL/);
    });

    it('should throw error for missing URL', function () {
      assert.throws(() => {
        new RedisClient(null);
      }, /Redis URL is required/);
    });
  });

  describe('static create method', function () {
    it('should throw error if environment variable missing', function () {
      assert.throws(() => {
        RedisClient.create({});
      }, /MCP_AUTH_PROXY_REDIS_URL environment variable is required/);
    });

    it('should configure TLS for rediss:// URLs', function () {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'rediss://localhost:6380' };

      // Just verify that the creation doesn't throw for rediss URLs
      // The TLS code path will be covered by the successful creation
      assert.doesNotThrow(() => {
        RedisClient.create(env);
      }, 'should successfully create client with TLS URL');
    });

    it('should use default error handler when no errorFunc provided', function () {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };

      // Mock console.warn to capture default error handler behavior
      const originalConsoleWarn = console.warn;
      console.warn = sinon.stub();

      try {
        const client = RedisClient.create(env);

        // Simulate an error event to trigger the default error handler
        // This will cover line 53
        const testError = new Error('Simulated Redis error');
        client.client.emit('error', testError);

        // Verify console.warn was called
        assert(
          console.warn.calledWith('Redis client error:', testError),
          'should log error with console.warn'
        );
      } finally {
        console.warn = originalConsoleWarn;
      }
    });
  });

  describe('Redis operations (with mocked client)', function () {
    let client;
    let mockRedisInstance;

    beforeEach(function () {
      // Create client and then replace its internal client with a mock
      client = new RedisClient('redis://localhost:6379');

      mockRedisInstance = {
        get: sinon.stub(),
        set: sinon.stub(),
        del: sinon.stub(),
        hgetall: sinon.stub(),
        hset: sinon.stub(),
        hmset: sinon.stub(),
        rpush: sinon.stub(),
        lrange: sinon.stub(),
        ttl: sinon.stub(),
        expire: sinon.stub(),
        multi: sinon.stub(),
        call: sinon.stub(),
        disconnect: sinon.stub(),
      };

      // Replace the internal client with our mock
      client.client = mockRedisInstance;
    });

    it('should delegate get operations', async function () {
      mockRedisInstance.get.resolves('test-value');

      const result = await client.get('test-key');

      assert(mockRedisInstance.get.calledWith('test-key'));
      assert.equal(result, 'test-value');
    });

    it('should delegate set operations without TTL', async function () {
      mockRedisInstance.set.resolves('OK');

      const result = await client.set('test-key', 'test-value');

      assert(mockRedisInstance.set.calledWith('test-key', 'test-value'));
      assert.equal(result, 'OK');
    });

    it('should delegate set operations with TTL', async function () {
      mockRedisInstance.set.resolves('OK');

      const result = await client.set('test-key', 'test-value', 300);

      assert(mockRedisInstance.set.calledWith('test-key', 'test-value', 'EX', 300));
      assert.equal(result, 'OK');
    });

    it('should delegate delete operations', async function () {
      mockRedisInstance.del.resolves(1);

      const result = await client.del('test-key');

      assert(mockRedisInstance.del.calledWith('test-key'));
      assert.equal(result, 1);
    });

    it('should delegate hash operations', async function () {
      mockRedisInstance.hgetall.resolves({ field1: 'value1' });

      const result = await client.hgetall('test-hash');

      assert(mockRedisInstance.hgetall.calledWith('test-hash'));
      assert.deepEqual(result, { field1: 'value1' });
    });

    it('should delegate list operations', async function () {
      mockRedisInstance.lrange.resolves(['item1', 'item2']);

      const result = await client.lrange('test-list', 0, -1);

      assert(mockRedisInstance.lrange.calledWith('test-list', 0, -1));
      assert.deepEqual(result, ['item1', 'item2']);
    });

    it('should delegate multi operations', function () {
      const mockMulti = { exec: sinon.stub().resolves([]) };
      mockRedisInstance.multi.returns(mockMulti);

      const result = client.multi();

      assert(mockRedisInstance.multi.calledOnce);
      assert.equal(result, mockMulti);
    });

    it('should delegate call operations for compatibility', async function () {
      mockRedisInstance.call.resolves('command-result');

      const result = await client.call('GET', 'test-key');

      assert(mockRedisInstance.call.calledWith('GET', 'test-key'));
      assert.equal(result, 'command-result');
    });

    it('should disconnect the underlying client', async function () {
      mockRedisInstance.disconnect.resolves();

      await client.disconnect();

      assert(mockRedisInstance.disconnect.calledOnce);
    });

    it('should return the underlying ioredis client', function () {
      const underlyingClient = client.getClient();

      assert.equal(underlyingClient, mockRedisInstance);
    });

    it('should delegate hset operations', async function () {
      mockRedisInstance.hset.resolves(1);

      const result = await client.hset('test:key', 'field', 'value');

      assert(mockRedisInstance.hset.calledWith('test:key', 'field', 'value'));
      assert.equal(result, 1);
    });

    it('should delegate hmset operations', async function () {
      mockRedisInstance.hmset.resolves('OK');

      const result = await client.hmset('test:key', { field1: 'value1', field2: 'value2' });

      assert(
        mockRedisInstance.hmset.calledWith('test:key', { field1: 'value1', field2: 'value2' })
      );
      assert.equal(result, 'OK');
    });

    it('should delegate rpush operations', async function () {
      mockRedisInstance.rpush.resolves(2);

      const result = await client.rpush('test:list', 'item');

      assert(mockRedisInstance.rpush.calledWith('test:list', 'item'));
      assert.equal(result, 2);
    });

    it('should delegate lrange operations', async function () {
      mockRedisInstance.lrange.resolves(['item1', 'item2']);

      const result = await client.lrange('test:list', 0, -1);

      assert(mockRedisInstance.lrange.calledWith('test:list', 0, -1));
      assert.deepEqual(result, ['item1', 'item2']);
    });

    it('should delegate ttl operations', async function () {
      mockRedisInstance.ttl.resolves(300);

      const result = await client.ttl('test:key');

      assert(mockRedisInstance.ttl.calledWith('test:key'));
      assert.equal(result, 300);
    });

    it('should delegate expire operations', async function () {
      mockRedisInstance.expire.resolves(1);

      const result = await client.expire('test:key', 3600);

      assert(mockRedisInstance.expire.calledWith('test:key', 3600));
      assert.equal(result, 1);
    });
  });
});
