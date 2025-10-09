import _ from 'lodash';
import RedisClient from './redis-client.js';

const grantable = new Set([
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
]);

const consumable = new Set([
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
]);

function grantKeyFor(id) {
  return `grant:${id}`;
}

function userCodeKeyFor(userCode) {
  return `userCode:${userCode}`;
}

function uidKeyFor(uid) {
  return `uid:${uid}`;
}

class TokenRedisAdapter {
  constructor(name) {
    if (!TokenRedisAdapter.client) {
      throw new Error('TokenRedisAdapter.init(env, errorFunc) must be called during app start-up');
    }
    this.name = name;
  }

  static client;

  static init(env = {}, errorFunc) {
    const { MCP_AUTH_PROXY_REDIS_PREFIX = 'oidc:' } = env;

    if (typeof errorFunc !== 'function') {
      throw new Error('TokenRedisAdapter.init second param "errorFunc" must be a function');
    }

    // Use our base RedisClient instead of direct ioredis
    const redisClient = RedisClient.create(env, {
      keyPrefix: MCP_AUTH_PROXY_REDIS_PREFIX,
      errorCallback: errorFunc,
    });

    // Maintain compatibility - expose the underlying ioredis client
    this.client = redisClient.getClient();
  }

  static disconnect() {
    this.client.disconnect();
  }

  async upsert(id, payload, expiresIn) {
    const key = this.key(id);
    const store = consumable.has(this.name)
      ? { payload: JSON.stringify(payload) }
      : JSON.stringify(payload);

    const multi = TokenRedisAdapter.client.multi();
    multi[consumable.has(this.name) ? 'hmset' : 'set'](key, store);

    if (expiresIn) {
      multi.expire(key, expiresIn);
    }

    if (grantable.has(this.name) && payload.grantId) {
      const grantKey = grantKeyFor(payload.grantId);
      multi.rpush(grantKey, key);
      // if you're seeing grant key lists growing out of acceptable proportions consider using LTRIM
      // here to trim the list to an appropriate length
      const ttl = await TokenRedisAdapter.client.ttl(grantKey);
      if (expiresIn > ttl) {
        multi.expire(grantKey, expiresIn);
      }
    }

    if (payload.userCode) {
      const userCodeKey = userCodeKeyFor(payload.userCode);
      multi.set(userCodeKey, id);
      multi.expire(userCodeKey, expiresIn);
    }

    if (payload.uid) {
      const uidKey = uidKeyFor(payload.uid);
      multi.set(uidKey, id);
      multi.expire(uidKey, expiresIn);
    }

    await multi.exec();
  }

  async find(id) {
    const data = consumable.has(this.name)
      ? await TokenRedisAdapter.client.hgetall(this.key(id))
      : await TokenRedisAdapter.client.get(this.key(id));

    if (_.isEmpty(data)) {
      return undefined;
    }

    if (typeof data === 'string') {
      return JSON.parse(data);
    }

    const { payload, ...rest } = data;
    return {
      ...rest,
      ...JSON.parse(payload),
    };
  }

  async findByUid(uid) {
    const id = await TokenRedisAdapter.client.get(uidKeyFor(uid));
    return this.find(id);
  }

  async findByUserCode(userCode) {
    const id = await TokenRedisAdapter.client.get(userCodeKeyFor(userCode));
    return this.find(id);
  }

  async destroy(id) {
    const key = this.key(id);
    await TokenRedisAdapter.client.del(key);
  }

  async revokeByGrantId(grantId) {
    const multi = TokenRedisAdapter.client.multi();
    const tokens = await TokenRedisAdapter.client.lrange(grantKeyFor(grantId), 0, -1);
    tokens.forEach((token) => multi.del(token));
    multi.del(grantKeyFor(grantId));
    await multi.exec();
  }

  async consume(id) {
    await TokenRedisAdapter.client.hset(this.key(id), 'consumed', Math.floor(Date.now() / 1000));
  }

  key(id) {
    return `${this.name}:${id}`;
  }
}

export default TokenRedisAdapter;
