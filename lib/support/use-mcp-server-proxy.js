import http from 'node:http';
import https from 'node:https';

import { refreshIdentityToken } from './identity-client.js';

const proxyAgent = new http.Agent({ keepAlive: false });
const proxyOptions = { agent: proxyAgent };

// Proxy through the MCP Resource Server route: guards to ensure authorized, and if not MCP Client attempts OAuth flow.
export default function useMcpServerProxy(app, provider, mcpServerUrl) {
  app.use(mcpServerUrl.pathname, async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Missing Authorization header"');
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing Authorization header'
      });
      return;
    }

    const [type, token] = authHeader.split(' ');
    if (type.toLowerCase() !== 'bearer' || !token) {
      res.set('WWW-Authenticate', `Bearer error="invalid_token", error_description="Invalid Authorization header format, expected 'Bearer TOKEN'"`);
      res.status(401).json({
        error: 'invalid_token',
        error_description: "Invalid Authorization header format, expected 'Bearer TOKEN'"
      });
      return;
    }

    // Check if proxy access token is valid
    const accessToken = await provider.AccessToken.find(token);
    if (!accessToken) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Invalid access token, may be expired');
      res.status(401).json({
        error: 'invalid_token',
        error_description: "Invalid access token, may be expired"
      });
      return;
    }

    // Verify that a primary Identity access token exists 
    const proxyClient = await provider.Client.find(accessToken.clientId);
    if (!proxyClient?.identityAuthAccessToken) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Missing identity authorization');
      res.status(401).json({
        error: 'invalid_token',
        error_description: "Missing identity authorization"
      });
      return;
    }

    console.log('/mcp applying authorization', proxyClient.identityAuthId);

    const reqBodyBuf = Buffer.from(JSON.stringify(req.body));

    const proxyReqHeaders = {
      'user-agent': req.headers['user-agent'] || 'MCP-Auth-Proxy'
    };

    if (proxyClient.identityAuthScope) {
      proxyReqHeaders['x-authorization-scope'] = proxyClient.identityAuthScope;
    }
    if (proxyClient.clientId) {
      proxyReqHeaders['x-dynamic-client-id'] = proxyClient.clientId;
    }

    if (req.headers['accept']) {
      proxyReqHeaders['accept'] = req.headers['accept'];
    }
    if (req.headers['accept-encoding']) {
      proxyReqHeaders['accept-encoding'] = req.headers['accept-encoding'];
    }
    if (req.headers['accept-language']) {
      proxyReqHeaders['accept-language'] = req.headers['accept-language'];
    }
    if (req.headers['content-length']) {
      proxyReqHeaders['content-length'] = reqBodyBuf.byteLength;
    }
    if (req.headers['content-type']) {
      proxyReqHeaders['content-type'] = req.headers['content-type'];
    }

    let didTryRefresh = false;
    const httpModule = mcpServerUrl.protocol === 'https:' ? https : http;
    const proxyReqFunc = () => {
      const proxyReq = httpModule.request(
        {
          hostname: mcpServerUrl.hostname,
          port: mcpServerUrl.port || (mcpServerUrl.protocol === 'https:' ? 443 : 80),
          path: mcpServerUrl.pathname + mcpServerUrl.search,
          method: req.method,
          headers: {
            ...proxyReqHeaders,
            authorization: `bearer ${proxyClient.identityAuthAccessToken}`
          },
          ...proxyOptions
        },
        async (proxyRes) => {
          console.log('proxyReqFunc proxyRes', proxyRes.statusCode);

          switch (proxyRes.statusCode) {
            case 401: {
              if (didTryRefresh) {
                console.log('/mcp token refreshed already attempted');
                await invalidateIdentityAuth(proxyClient, provider);
                res.set('WWW-Authenticate', `Bearer error="invalid_token", error_description="Token refresh already attempted"`);
                return res.status(401).json({
                  error: 'invalid_token',
                  error_description: 'Token refresh already attempted'
                });
              }
              try {
                console.log('proxyReqFunc refreshIdentityToken');
                await refreshIdentityToken(provider, proxyClient);
              } catch(err) {
                console.log(`/mcp token refresh failed: ${err}`);
                await invalidateIdentityAuth(proxyClient, provider);
                res.set('WWW-Authenticate', `Bearer error="invalid_token", error_description="Token refresh failed: ${err}"`);
                return res.status(401).json({
                  error: 'invalid_token',
                  error_description: `Token refresh failed: ${err}`
                });
              }
              didTryRefresh = true;
              console.log('/mcp token refreshed', proxyClient.identityAuthId);
              await proxyReqFunc();
              return;
            }
          }
          
          console.log('proxyReqFunc proxyRes', proxyRes.headers);
          if (proxyRes.headers['content-type']) {
            res.setHeader('content-type', proxyRes.headers['content-type']);
          }
          if (proxyRes.headers['date']) {
            res.setHeader('date', proxyRes.headers['date']);
          }
          if (proxyRes.headers['transfer-encoding']) {
            res.setHeader('transfer-encoding', proxyRes.headers['transfer-encoding']);
          }

          proxyRes.on("data", (chunk) => {
            console.log('proxy write response body', chunk.toString('utf8'));
            res.write(chunk);
          });
        
          proxyRes.on('end', () => {
            console.log('proxy response end');
            res.end();
            if (!res.headersSent) {
              next();
            }
          });

          proxyRes.on('error', (err) => {
            console.log('proxy streaming error', err);
            next(err);
          });
        }
      );

      proxyReq.on('error', (err) => {
        console.log('proxy request error', err);
        next(err);
      });

      req.on('close', () => {
          proxyReq.destroy();
      });

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        // Send the body contents
        console.log('proxy write request body');
        proxyReq.write(reqBodyBuf);
      } else {
        console.log('proxy request end');
        proxyReq.end();
      }
    }

    proxyReqFunc();
  });
}

async function invalidateIdentityAuth(proxyClient, provider) {
  proxyClient['identityAuthAccessToken'] = null;
  proxyClient['identityAuthRefreshToken'] = null;
  proxyClient['identityAuthSignature'] = null;
  proxyClient['identityAuthScope'] = null;
  proxyClient['identityAuthIdToken'] = null;
  proxyClient['identityAuthInstanceUrl'] = null;
  proxyClient['identityAuthId'] = null;
  proxyClient['identityAuthTokenType'] = null;
  proxyClient['identityAuthIssuedAt'] = null;
  proxyClient['identityAuthExpiresIn'] = null;
  proxyClient['identityAuthSessionNonce'] = null;
  await provider.Client.adapter.upsert(proxyClient.clientId, proxyClient.metadata());
}

