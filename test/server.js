import http from 'node:http';
import { Buffer } from 'node:buffer';
import assert from 'assert';

import server from '../lib/server.js';

describe('server', function () {
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

    let authProxyApp;
    let mcpServerProc;
    
    before(function(done) {
      server(env, (a, b) => {
        authProxyApp = a;
        mcpServerProc = b;
        done();
      });
    });

    after(function() {
      authProxyApp.closeAllConnections();
      mcpServerProc.kill();
    });

    it('should start successfully', function () {
      assert(authProxyApp.listening);
      assert(mcpServerProc.pid > 0);
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

    describe('POST /mcp', function () {
      it('should respond 401', function (done) {
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
