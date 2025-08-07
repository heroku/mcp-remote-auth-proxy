import assert from 'assert';
import sinon from 'sinon';
import TokenRedisAdapter from '../lib/token-redis-adapter.js';
import RedisClient from '../lib/redis-client.js';

describe('TokenRedisAdapter', function() {
  let redisClientCreateStub;
  let mockRedisClient;
  let mockIoredisInstance;

  beforeEach(function() {
    // Mock the underlying ioredis client
    mockIoredisInstance = {
      multi: sinon.stub(),
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
      exec: sinon.stub(),
      disconnect: sinon.stub()
    };

    // Mock the RedisClient wrapper
    mockRedisClient = {
      getClient: sinon.stub().returns(mockIoredisInstance)
    };

    // Stub RedisClient.create to return our mock
    redisClientCreateStub = sinon.stub(RedisClient, 'create').returns(mockRedisClient);

    // Clear any existing client
    TokenRedisAdapter.client = null;
  });

  afterEach(function() {
    redisClientCreateStub.restore();
    TokenRedisAdapter.client = null;
  });

  describe('static init', function() {
    it('should initialize with RedisClient using default prefix', function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };
      const errorFunc = sinon.stub();

      TokenRedisAdapter.init(env, errorFunc);

      assert(redisClientCreateStub.calledOnce, 'Should call RedisClient.create once');
      assert(redisClientCreateStub.calledWith(env, {
        keyPrefix: 'oidc:',
        errorCallback: errorFunc
      }), 'Should pass correct options to RedisClient.create');
      
      assert.equal(TokenRedisAdapter.client, mockIoredisInstance, 'Should set client to underlying ioredis instance');
    });

    it('should initialize with custom prefix', function() {
      const env = { 
        MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379',
        MCP_AUTH_PROXY_REDIS_PREFIX: 'custom:'
      };
      const errorFunc = sinon.stub();

      TokenRedisAdapter.init(env, errorFunc);

      assert(redisClientCreateStub.calledWith(env, {
        keyPrefix: 'custom:',
        errorCallback: errorFunc
      }), 'Should use custom prefix');
    });

    it('should throw error if errorFunc is not a function', function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };

      assert.throws(() => {
        TokenRedisAdapter.init(env, 'not-a-function');
      }, /TokenRedisAdapter.init second param "errorFunc" must be a function/);
    });

    it('should throw error if errorFunc is missing', function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };

      assert.throws(() => {
        TokenRedisAdapter.init(env);
      }, /TokenRedisAdapter.init second param "errorFunc" must be a function/);
    });
  });

  describe('static disconnect', function() {
    it('should disconnect the client', function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };
      const errorFunc = sinon.stub();

      TokenRedisAdapter.init(env, errorFunc);
      TokenRedisAdapter.disconnect();

      assert(mockIoredisInstance.disconnect.calledOnce, 'Should call disconnect on underlying client');
    });
  });

  describe('constructor', function() {
    beforeEach(function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };
      const errorFunc = sinon.stub();
      TokenRedisAdapter.init(env, errorFunc);
    });

    it('should create instance with name', function() {
      const adapter = new TokenRedisAdapter('AccessToken');
      assert.equal(adapter.name, 'AccessToken');
    });

    it('should throw error if not initialized', function() {
      TokenRedisAdapter.client = null;
      
      assert.throws(() => {
        new TokenRedisAdapter('AccessToken');
      }, /TokenRedisAdapter.init\(env, errorFunc\) must be called during app start-up/);
    });
  });

  describe('instance methods', function() {
    let adapter;

    beforeEach(function() {
      const env = { MCP_AUTH_PROXY_REDIS_URL: 'redis://localhost:6379' };
      const errorFunc = sinon.stub();
      TokenRedisAdapter.init(env, errorFunc);
      adapter = new TokenRedisAdapter('AccessToken');
    });

    describe('key', function() {
      it('should generate correct key format', function() {
        const key = adapter.key('test-id');
        assert.equal(key, 'AccessToken:test-id');
      });
    });

    describe('upsert', function() {
      it('should store non-consumable token as JSON string', async function() {
        const mockMulti = {
          set: sinon.stub(),
          expire: sinon.stub(),
          exec: sinon.stub().resolves([])
        };
        mockIoredisInstance.multi.returns(mockMulti);

        const payload = { token: 'value' };
        await adapter.upsert('test-id', payload, 3600);

        assert(mockMulti.set.calledWith('AccessToken:test-id', JSON.stringify(payload)));
        assert(mockMulti.expire.calledWith('AccessToken:test-id', 3600));
        assert(mockMulti.exec.calledOnce);
      });

      it('should store consumable token as hash', async function() {
        const consumableAdapter = new TokenRedisAdapter('AuthorizationCode');
        const mockMulti = {
          hmset: sinon.stub(),
          expire: sinon.stub(),
          exec: sinon.stub().resolves([])
        };
        mockIoredisInstance.multi.returns(mockMulti);

        const payload = { token: 'value' };
        await consumableAdapter.upsert('test-id', payload, 3600);

        assert(mockMulti.hmset.calledWith('AuthorizationCode:test-id', { 
          payload: JSON.stringify(payload) 
        }));
        assert(mockMulti.expire.calledWith('AuthorizationCode:test-id', 3600));
        assert(mockMulti.exec.calledOnce);
      });

      it('should handle grantable tokens with grant tracking', async function() {
        const mockMulti = {
          set: sinon.stub(),
          expire: sinon.stub(),
          rpush: sinon.stub(),
          exec: sinon.stub().resolves([])
        };
        mockIoredisInstance.multi.returns(mockMulti);
        mockIoredisInstance.ttl.resolves(1800); // existing TTL

        const payload = { token: 'value', grantId: 'grant-123' };
        await adapter.upsert('test-id', payload, 3600);

        assert(mockMulti.set.calledWith('AccessToken:test-id', JSON.stringify(payload)));
        assert(mockMulti.rpush.calledWith('grant:grant-123', 'AccessToken:test-id'));
        assert(mockMulti.expire.calledWith('grant:grant-123', 3600));
        assert(mockMulti.exec.calledOnce);
      });
    });

    describe('find', function() {
      it('should find non-consumable token', async function() {
        const tokenData = JSON.stringify({ token: 'value' });
        mockIoredisInstance.get.resolves(tokenData);

        const result = await adapter.find('test-id');

        assert(mockIoredisInstance.get.calledWith('AccessToken:test-id'));
        assert.deepEqual(result, { token: 'value' });
      });

      it('should find consumable token', async function() {
        const consumableAdapter = new TokenRedisAdapter('AuthorizationCode');
        const hashData = { payload: JSON.stringify({ token: 'value' }), consumed: '1234567890' };
        mockIoredisInstance.hgetall.resolves(hashData);

        const result = await consumableAdapter.find('test-id');

        assert(mockIoredisInstance.hgetall.calledWith('AuthorizationCode:test-id'));
        assert.deepEqual(result, { token: 'value', consumed: '1234567890' });
      });

      it('should return undefined for empty result', async function() {
        mockIoredisInstance.get.resolves(null);

        const result = await adapter.find('test-id');

        assert.equal(result, undefined);
      });
    });

    describe('findByUid', function() {
      it('should find token by UID', async function() {
        mockIoredisInstance.get.resolves('found-id');
        const tokenData = JSON.stringify({ token: 'value' });
        mockIoredisInstance.get.onSecondCall().resolves(tokenData);

        const result = await adapter.findByUid('user-123');

        assert(mockIoredisInstance.get.calledWith('uid:user-123'));
        assert(mockIoredisInstance.get.calledWith('AccessToken:found-id'));
        assert.deepEqual(result, { token: 'value' });
      });
    });

    describe('findByUserCode', function() {
      it('should find token by user code', async function() {
        mockIoredisInstance.get.resolves('found-id');
        const tokenData = JSON.stringify({ token: 'value' });
        mockIoredisInstance.get.onSecondCall().resolves(tokenData);

        const result = await adapter.findByUserCode('code-456');

        assert(mockIoredisInstance.get.calledWith('userCode:code-456'));
        assert(mockIoredisInstance.get.calledWith('AccessToken:found-id'));
        assert.deepEqual(result, { token: 'value' });
      });
    });

    describe('destroy', function() {
      it('should delete token', async function() {
        mockIoredisInstance.del.resolves(1);

        await adapter.destroy('test-id');

        assert(mockIoredisInstance.del.calledWith('AccessToken:test-id'));
      });
    });

    describe('revokeByGrantId', function() {
      it('should revoke all tokens for a grant', async function() {
        const mockMulti = {
          del: sinon.stub(),
          exec: sinon.stub().resolves([])
        };
        mockIoredisInstance.multi.returns(mockMulti);
        mockIoredisInstance.lrange.resolves(['AccessToken:token1', 'RefreshToken:token2']);

        await adapter.revokeByGrantId('grant-123');

        assert(mockIoredisInstance.lrange.calledWith('grant:grant-123', 0, -1));
        assert(mockMulti.del.calledWith('AccessToken:token1'));
        assert(mockMulti.del.calledWith('RefreshToken:token2'));
        assert(mockMulti.del.calledWith('grant:grant-123'));
        assert(mockMulti.exec.calledOnce);
      });
    });

    describe('consume', function() {
      it('should mark token as consumed', async function() {
        const timestamp = Math.floor(Date.now() / 1000);
        mockIoredisInstance.hset.resolves(1);

        await adapter.consume('test-id');

        assert(mockIoredisInstance.hset.calledWith('AccessToken:test-id', 'consumed'));
        // Check that second argument is a timestamp (within 1 second of now)
        const actualTimestamp = mockIoredisInstance.hset.getCall(0).args[2];
        assert(Math.abs(actualTimestamp - timestamp) <= 1, 'Should set current timestamp');
      });
    });
  });
});