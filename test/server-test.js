import http from 'node:http';
import { Buffer } from 'node:buffer';
import assert from 'assert';

import server from '../lib/server.js';
import RedisAdapter from "../lib/redis-adapter.js";

describe('Server', function () {
  describe('without environment', function () {
    it('should crash', function () {
      assert.throws(() => server(), {
        message: 'BASE_URL must be a valid URL'
      });
    });
  });
  describe('with environment', function () {
    // loaded from .env-test by npm test script
    const env = process.env;
    const authProxyUrl = new URL(env.BASE_URL);

    let authProxyServer;
    let mcpServerProc;
    
    beforeEach(function(done) {
      try {
        server(env, (a, b) => {
          authProxyServer = a;
          mcpServerProc = b;
          done();
        }, (code) => {
          if (code !== 0) {
            assert(false, `Server exited code=${code} before tests completed. Check for errors logged above.`);
          }
        });
      } catch (err) {
        done(err);
      }
    });

    afterEach(function(done) {
      RedisAdapter.disconnect();
      if (mcpServerProc) {
        mcpServerProc.kill();
        mcpServerProc = null;
      }
      if (authProxyServer) {
        authProxyServer.close((err) => {
          err ? done(err) : done();
        });
        authProxyServer= null;
      } else {
        done()
      }
    });

    it('should start successfully', function () {
      assert(authProxyServer.listening);
      assert(mcpServerProc.pid > 0);
    });

    it('should be connected to Redis', async function () {
      const redisInfo = await RedisAdapter.client.info();
      assert(redisInfo);
    });

    describe('GET /.well-known/oauth-authorization-server', function () {
      it('should respond with JSON metadata', function (done) {
        const options = {
          protocol: authProxyUrl.protocol,
          hostname: authProxyUrl.hostname,
          port: authProxyUrl.port,
          path: '/.well-known/oauth-authorization-server',
          method: 'GET'
        };
        const req = http.request(
          options,
          (res) => {
            assert.equal(res.statusCode, 200);
            let resBody = '';

            res.on("data", (chunk) => {
              resBody = resBody + chunk;
            });
        
            res.on("end", () => {
              try {
                let parsedBody = JSON.parse(resBody);
                assert.equal(parsedBody.issuer, env.BASE_URL);
                done()
              } catch (err) {
                done(err);
              }
            });
          }
        );
        req.on('error', (e) => {
          done(e);
        });
        req.end();
      });
    });

    describe('POST /mcp without authorization', function () {
      it('should be rejected by Auth Proxy', function (done) {
        const postData = JSON.stringify({
          'msg': 'Hello World!',
        });
        const options = {
          protocol: authProxyUrl.protocol,
          hostname: authProxyUrl.hostname,
          port: authProxyUrl.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          }
        };
        const req = http.request(
          options,
          (res) => {
            assert.equal(res.statusCode, 401);
            done();
          }
        );
        req.on('error', (e) => {
          done(e);
        });
        req.write(postData);
        req.end();
      });
    });
  });
});
