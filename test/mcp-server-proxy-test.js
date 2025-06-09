import assert from 'assert';
import { Buffer } from 'node:buffer';
import http from 'node:http';

import { Provider } from 'oidc-provider';
import providerConfig from '../lib/provider-config.js';

import express from 'express';

import runMcpServerAndThen from '../lib/run-mcp-server-and-then.js';
import useMcpServerProxy from '../lib/use-mcp-server-proxy.js';

import {
  clientData,
  grantData,
  interactionData,
  authorizationCodePayloadData,
  sessionData,
  accessTokenData,
  refreshTokenPayloadData
} from './mocks/authorized-client-data.js';

describe('Auth Proxy for MCP Server', function () {
  // loaded from .env-test by npm test script
  const env = process.env;
  const authProxyUrl = new URL(env.BASE_URL);
  const mcpServerUrl = new URL(env.MCP_SERVER_URL);

  let parentExpressApp;
  let parentServer;
  let mcpServerProcess;
  let oidcProvider;

  let validAccessToken;

  before(async function() {
    let {
      adapter: _,  // do not use the Redis adapter here
      ...testProviderConfig
    } = providerConfig;
    oidcProvider = new Provider(authProxyUrl.href, testProviderConfig);

    await oidcProvider.Client.adapter.upsert(
      clientData.client_id, 
      clientData
    );
    await oidcProvider.Grant.adapter.upsert(
      grantData.jti, 
      grantData
    );
    await oidcProvider.AccessToken.adapter.upsert(
      accessTokenData.jti, 
      accessTokenData
    );
    validAccessToken = accessTokenData.jti;

    parentExpressApp = express();
    parentExpressApp.use(express.json());

    useMcpServerProxy(parentExpressApp, oidcProvider, mcpServerUrl);

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
          };
        }
      );
    });
  });

  after(function(done) {
    mcpServerProcess.kill();
    parentServer.close((err) => {
      err ? done(err) : done();
    });
  });

  describe('POST /mcp without authorization', function () {
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

  describe('POST /mcp with valid access token', function () {
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
          'Authorization': `bearer ${validAccessToken}`
        }
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
              assert.equal(parsedBody.msg, 'Received correct test identity token.');
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
      req.write(postData);
      req.end();
    });
  });
  
});
