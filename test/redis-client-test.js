import assert from 'assert';
import sinon from 'sinon';
import RedisClient from '../lib/redis-client.js';

describe('RedisClient', function() {
  describe('URL validation', function() {
    it('should throw error for invalid URL', function() {
      assert.throws(() => {
        new RedisClient('not-a-url');
      }, /Redis URL must be a valid URL/);
    });

    it('should throw error for missing URL', function() {
      assert.throws(() => {
        new RedisClient(null);
      }, /Redis URL is required/);
    });
  });

  describe('static create method', function() {
    it('should throw error if environment variable missing', function() {
      assert.throws(() => {
        RedisClient.create({});
      }, /MCP_AUTH_PROXY_REDIS_URL environment variable is required/);
    });
  });

  describe('Redis operations (with mocked client)', function() {
    let client;
    let mockRedisInstance;

    beforeEach(function() {
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
        disconnect: sinon.stub()
      };
      
      // Replace the internal client with our mock
      client.client = mockRedisInstance;
    });

    it('should delegate get operations', async function() {
        mockRedisInstance.get.resolves('test-value');
        
        const result = await client.get('test-key');
        
        assert(mockRedisInstance.get.calledWith('test-key'));
        assert.equal(result, 'test-value');
      });

    it('should delegate set operations without TTL', async function() {
      mockRedisInstance.set.resolves('OK');
      
      const result = await client.set('test-key', 'test-value');
      
      assert(mockRedisInstance.set.calledWith('test-key', 'test-value'));
      assert.equal(result, 'OK');
    });

    it('should delegate set operations with TTL', async function() {
      mockRedisInstance.set.resolves('OK');
      
      const result = await client.set('test-key', 'test-value', 300);
      
      assert(mockRedisInstance.set.calledWith('test-key', 'test-value', 'EX', 300));
      assert.equal(result, 'OK');
    });

    it('should delegate delete operations', async function() {
      mockRedisInstance.del.resolves(1);
      
      const result = await client.del('test-key');
      
      assert(mockRedisInstance.del.calledWith('test-key'));
      assert.equal(result, 1);
    });

    it('should delegate hash operations', async function() {
      mockRedisInstance.hgetall.resolves({ field1: 'value1' });
      
      const result = await client.hgetall('test-hash');
      
      assert(mockRedisInstance.hgetall.calledWith('test-hash'));
      assert.deepEqual(result, { field1: 'value1' });
    });

    it('should delegate list operations', async function() {
      mockRedisInstance.lrange.resolves(['item1', 'item2']);
      
      const result = await client.lrange('test-list', 0, -1);
      
      assert(mockRedisInstance.lrange.calledWith('test-list', 0, -1));
      assert.deepEqual(result, ['item1', 'item2']);
    });

    it('should delegate multi operations', function() {
      const mockMulti = { exec: sinon.stub().resolves([]) };
      mockRedisInstance.multi.returns(mockMulti);
      
      const result = client.multi();
      
      assert(mockRedisInstance.multi.calledOnce);
      assert.equal(result, mockMulti);
    });

    it('should delegate call operations for compatibility', async function() {
      mockRedisInstance.call.resolves('command-result');
      
      const result = await client.call('GET', 'test-key');
      
      assert(mockRedisInstance.call.calledWith('GET', 'test-key'));
      assert.equal(result, 'command-result');
    });

    it('should disconnect the underlying client', async function() {
      mockRedisInstance.disconnect.resolves();
      
      await client.disconnect();
      
      assert(mockRedisInstance.disconnect.calledOnce);
    });

    it('should return the underlying ioredis client', function() {
      const underlyingClient = client.getClient();
      
      assert.equal(underlyingClient, mockRedisInstance);
    });
  });
});