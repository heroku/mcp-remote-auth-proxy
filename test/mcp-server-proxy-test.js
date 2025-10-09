import sinon from 'sinon';
import assert from 'assert';
import { Buffer } from 'node:buffer';
import http from 'node:http';

import express from 'express';

import { Provider } from 'oidc-provider';
import instance from '../node_modules/oidc-provider/lib/helpers/weak_cache.js';
import providerConfig from '../lib/provider-config.js';
import { identityClient, identityClientInit } from '../lib/identity-client.js';
import runMcpServerAndThen from '../lib/run-mcp-server-and-then.js';
import useMcpServerProxy from '../lib/use-mcp-server-proxy.js';
import { useSessionReset, getSessionResetUrl } from '../lib/use-session-reset.js';

import { clientData, grantData, accessTokenData } from './mocks/authorized-client-data.js';

describe('Auth Proxy for MCP Server', function () {
  // loaded from .env-test by npm test script
  const env = process.env;
  const authProxyUrl = new URL(env.BASE_URL);
  const mcpServerUrl = new URL(env.MCP_SERVER_URL);

  let sinonSandbox;
  let parentExpressApp;
  let parentServer;
  let mcpServerProcess;
  let oidcProvider;

  let validAccessToken;

  beforeEach(async function () {
    sinonSandbox = sinon.createSandbox();

    let {
      adapter: _, // do not use the Redis adapter here
      ...testProviderConfig
    } = providerConfig;
    oidcProvider = new Provider(authProxyUrl.href, testProviderConfig);

    await oidcProvider.Client.adapter.upsert(clientData.client_id, clientData);
    await oidcProvider.Grant.adapter.upsert(grantData.jti, grantData);
    await oidcProvider.AccessToken.adapter.upsert(accessTokenData.jti, accessTokenData);
    validAccessToken = accessTokenData.jti;

    identityClientInit(env);

    parentExpressApp = express();
    parentExpressApp.use(express.json());

    useMcpServerProxy(parentExpressApp, oidcProvider, mcpServerUrl);

    // Get provider instance config for session reset (same as main server)
    const providerInstanceConfig = instance(oidcProvider).configuration;

    useSessionReset(parentExpressApp, authProxyUrl, providerInstanceConfig);

    await new Promise((resolve, reject) => {
      runMcpServerAndThen(
        env.MCP_SERVER_RUN_COMMAND,
        env.MCP_SERVER_RUN_ARGS_JSON,
        env.MCP_SERVER_RUN_DIR,
        env.MCP_SERVER_RUN_ENV_JSON,
        (subprocess) => {
          parentServer = parentExpressApp.listen(env.PORT, resolve);
          mcpServerProcess = subprocess;
        },
        (code) => {
          if (code != 0) {
            reject(new Error(`MCP Server sub-process exited ${code}`));
          }
        }
      );
    });
  });

  afterEach(function (done) {
    sinonSandbox.restore();
    mcpServerProcess.kill();
    parentServer.close((err) => {
      err ? done(err) : done();
    });
  });

  describe('POST /mcp without authorization', function () {
    it('should respond 401', function (done) {
      const postData = JSON.stringify({
        msg: 'Hello World!',
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
        },
      };
      const req = http.request(options, (res) => {
        assert.equal(res.statusCode, 401);
        done();
      });
      req.on('error', (e) => {
        done(e);
      });
      req.write(postData);
      req.end();
    });
  });

  describe('POST /mcp with valid authorization', function () {
    it('should respond 200', function (done) {
      const postData = JSON.stringify({
        'test-mode': 'check-for-identity-token',
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
          Authorization: `bearer ${validAccessToken}`,
        },
      };
      const req = http.request(options, (res) => {
        assert.equal(res.statusCode, 200);
        let resBody = '';

        res.on('data', (chunk) => {
          resBody = resBody + chunk;
        });

        res.on('end', () => {
          try {
            let parsedBody = JSON.parse(resBody);
            assert.equal(parsedBody.msg, 'Received correct test authorization.');
            done();
          } catch (err) {
            done(err);
          }
        });
      });
      req.on('error', (e) => {
        done(e);
      });
      req.write(postData);
      req.end();
    });
  });

  describe('POST /mcp with invalid authorization', function () {
    it('should perform identity token refresh and automatically retry the request', function (done) {
      sinonSandbox.stub(identityClient, 'refreshTokenGrant').returns({
        access_token: 'refreshed_test_identity_access_token',
        signature: 'x',
        scope: 'global',
        token_type: 'bearer',
        issued_at: new Date().getTime(),
      });

      const postData = JSON.stringify({
        'test-mode': 'respond-unauthorized',
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
          Authorization: `bearer ${validAccessToken}`,
        },
      };
      const req = http.request(options, (res) => {
        assert.equal(res.statusCode, 200);
        let resBody = '';

        res.on('data', (chunk) => {
          resBody = resBody + chunk;
        });

        res.on('end', () => {
          try {
            let parsedBody = JSON.parse(resBody);
            assert.equal(parsedBody.msg, 'Received refreshed test authorization');
            done();
          } catch (err) {
            done(err);
          }
        });
      });
      req.on('error', (e) => {
        done(e);
      });
      req.write(postData);
      req.end();
    });
  });

  it('should reset client auth when token refresh fails', function (done) {
    sinonSandbox
      .stub(identityClient, 'refreshTokenGrant')
      .throws(new Error('Test token refresh failure'));

    const postData = JSON.stringify({
      'test-mode': 'respond-unauthorized',
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
        Authorization: `bearer ${validAccessToken}`,
      },
    };
    const req = http.request(options, (res) => {
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers['location'], getSessionResetUrl());
      done();
    });
    req.on('error', (e) => {
      done(e);
    });
    req.write(postData);
    req.end();
  });

  describe('POST /mcp with expired refresh token (OAuth lifecycle bug)', function () {
    it('should demonstrate working auth then OAuth lifecycle bug FIX when refresh token expires', function (done) {
      const postData = JSON.stringify({
        'test-mode': 'check-for-identity-token',
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
          Authorization: `bearer ${validAccessToken}`,
        },
      };
      const req = http.request(options, (res) => {
        assert.equal(res.statusCode, 200);
        let resBody = '';

        res.on('data', (chunk) => {
          resBody = resBody + chunk;
        });

        res.on('end', () => {
          try {
            let parsedBody = JSON.parse(resBody);
            assert.equal(parsedBody.msg, 'Received correct test authorization.');

            console.log('✅ Step 1 passed - normal auth working');

            // STEP 2: Now simulate refresh token expiration and try again
            console.log('Step 2: Simulating refresh token expiration...');

            // Mock the identity client refresh to fail (simulating expired refresh token)
            sinonSandbox
              .stub(identityClient, 'refreshTokenGrant')
              .rejects(new Error('invalid_grant: refresh token expired'));

            // Use the mock server's test mode that returns 401 to trigger refresh attempt
            const expiredPostData = JSON.stringify({
              'test-mode': 'respond-unauthorized',
            });

            const expiredOptions = {
              protocol: authProxyUrl.protocol,
              hostname: authProxyUrl.hostname,
              port: authProxyUrl.port,
              path: '/mcp',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(expiredPostData),
                Authorization: `bearer ${validAccessToken}`,
              },
            };

            console.log('Step 3: Making request that will trigger refresh failure...');

            const expiredReq = http.request(expiredOptions, function (expiredRes) {
              console.log(`Step 4: Expired token request got ${expiredRes.statusCode}`);

              if (expiredRes.statusCode === 302) {
                console.log(`Step 6: Redirected to: ${expiredRes.headers['location']}`);
                console.log(
                  '✅ This confirms the bug - refresh failed, redirected to session reset'
                );

                // Follow the redirect to demonstrate the FIXED session reset behavior
                const resetUrl = new URL(expiredRes.headers['location'], authProxyUrl.href);
                const resetReq = http.request(
                  {
                    protocol: authProxyUrl.protocol,
                    hostname: authProxyUrl.hostname,
                    port: authProxyUrl.port,
                    path: resetUrl.pathname,
                    method: 'GET',
                  },
                  function (resetRes) {
                    console.log(`Step 7: Session reset responded with ${resetRes.statusCode}`);

                    if (resetRes.statusCode === 302) {
                      // Follow to the "done" endpoint to see our FIXED behavior
                      const doneUrl = new URL(resetRes.headers['location'], authProxyUrl.href);
                      const doneReq = http.request(
                        {
                          protocol: authProxyUrl.protocol,
                          hostname: authProxyUrl.hostname,
                          port: authProxyUrl.port,
                          path: doneUrl.pathname,
                          method: 'GET',
                        },
                        function (doneRes) {
                          console.log(
                            `Step 8: Session reset done responded with ${doneRes.statusCode}`
                          );

                          if (doneRes.statusCode === 401) {
                            // Check for our enhanced MCP-compliant response
                            const wwwAuth = doneRes.headers['www-authenticate'];
                            console.log(`Step 9: WWW-Authenticate header: ${wwwAuth}`);

                            let body = '';
                            doneRes.on('data', (chunk) => (body += chunk));
                            doneRes.on('end', () => {
                              const response = JSON.parse(body);
                              console.log(
                                `Step 10: Enhanced response: ${JSON.stringify(response, null, 2)}`
                              );

                              // Verify our fix provides recovery information
                              if (
                                wwwAuth &&
                                wwwAuth.includes('authorization_uri') &&
                                response.error === 'session_expired' &&
                                response.error_uri
                              ) {
                                console.log('\n🎉 OAuth Lifecycle Bug FIXED!');
                                console.log('   ✅ Normal auth worked');
                                console.log('   🚨 Refresh token expired (simulated)');
                                console.log('   🔄 Session destroyed → redirect to reset');
                                console.log('   ✅ MCP-compliant recovery information provided!');
                                console.log(
                                  '   ✅ MCP clients can now restart OAuth flow using WWW-Authenticate header'
                                );
                                console.log('   ✅ Endless loop bug eliminated!\n');
                                done();
                              } else {
                                done(
                                  new Error(
                                    `Expected MCP-compliant recovery response, got: ${JSON.stringify(response)}`
                                  )
                                );
                              }
                            });
                          } else {
                            done(
                              new Error(
                                `Expected 401 from session reset done, got ${doneRes.statusCode}`
                              )
                            );
                          }
                        }
                      );
                      doneReq.on('error', done);
                      doneReq.end();
                    } else {
                      done(
                        new Error(`Expected 302 from session reset, got ${resetRes.statusCode}`)
                      );
                    }
                  }
                );
                resetReq.on('error', done);
                resetReq.end();
              } else {
                console.log('❌ Expected 302 redirect after refresh failure');
                let body = '';
                expiredRes.on('data', (chunk) => (body += chunk));
                expiredRes.on('end', () => {
                  console.log('Response body:', body);
                  done(new Error(`Expected 302 redirect, got ${expiredRes.statusCode}`));
                });
              }
            });

            expiredReq.on('error', done);
            expiredReq.write(expiredPostData);
            expiredReq.end();
          } catch (err) {
            done(err);
          }
        });
      });
      req.on('error', (e) => {
        done(e);
      });
      req.write(postData);
      req.end();
    });
  });
});
