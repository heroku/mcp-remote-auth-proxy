import Redis from 'ioredis';
import _ from 'lodash';

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

class RedisAdapter {
  constructor(name) {
    if (!RedisAdapter.client) {
      throw new Error('RedisAdapter.init(env) must be called during app start-up');
    }
    this.name = name;
  }

  static client;

  static init(env = {}) {
    const {
      MCP_AUTH_PROXY_REDIS_URL,
      MCP_AUTH_PROXY_REDIS_PREFIX = 'oidc:'
    } = env;
    
    let mcpAuthProxyRedisUrl;
    try {
      mcpAuthProxyRedisUrl = new URL(MCP_AUTH_PROXY_REDIS_URL);
    } catch (err) {
      console.log('MCP_AUTH_PROXY_REDIS_URL must be a valid URL', err);
      process.exit(1);
    }
    let redisOpts = {keyPrefix: MCP_AUTH_PROXY_REDIS_PREFIX};
    if (mcpAuthProxyRedisUrl.protocol === 'rediss:') {
      // Only add TLS opts to secure connection
      redisOpts.tls = {
        // Accept self-signed certificates
        rejectUnauthorized: false
      }
    }
    this.client = new Redis(mcpAuthProxyRedisUrl.href, redisOpts);
    this.client.on("error", (message) => {
      console.log("Exiting due to Redis", message);
      process.exit(1);
    });
  }

  static disconnect() {
    this.client.disconnect();
  }

  async upsert(id, payload, expiresIn) {
    const key = this.key(id);
    const store = consumable.has(this.name)
      ? { payload: JSON.stringify(payload) } : JSON.stringify(payload);

    const multi = RedisAdapter.client.multi();
    multi[consumable.has(this.name) ? 'hmset' : 'set'](key, store);

    if (expiresIn) {
      multi.expire(key, expiresIn);
    }

    if (grantable.has(this.name) && payload.grantId) {
      const grantKey = grantKeyFor(payload.grantId);
      multi.rpush(grantKey, key);
      // if you're seeing grant key lists growing out of acceptable proportions consider using LTRIM
      // here to trim the list to an appropriate length
      const ttl = await RedisAdapter.client.ttl(grantKey);
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
      ? await RedisAdapter.client.hgetall(this.key(id))
      : await RedisAdapter.client.get(this.key(id));

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
    const id = await RedisAdapter.client.get(uidKeyFor(uid));
    return this.find(id);
  }

  async findByUserCode(userCode) {
    const id = await RedisAdapter.client.get(userCodeKeyFor(userCode));
    return this.find(id);
  }

  async destroy(id) {
    const key = this.key(id);
    await RedisAdapter.client.del(key);
  }

  async revokeByGrantId(grantId) {
    const multi = RedisAdapter.client.multi();
    const tokens = await RedisAdapter.client.lrange(grantKeyFor(grantId), 0, -1);
    tokens.forEach((token) => multi.del(token));
    multi.del(grantKeyFor(grantId));
    await multi.exec();
  }

  async consume(id) {
    await RedisAdapter.client.hset(this.key(id), 'consumed', Math.floor(Date.now() / 1000));
  }

  key(id) {
    return `${this.name}:${id}`;
  }
}

export default RedisAdapter;
