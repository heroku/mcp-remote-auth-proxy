import http from 'node:http';
import https from 'node:https';

import { refreshIdentityToken } from './identity-client-adapter.js';
import { getSessionResetUrl, destroyAccess } from './use-session-reset.js';
import { createRequestLogger } from './logger.js';

const proxyAgent = new http.Agent({ keepAlive: true });
const proxyOptions = { agent: proxyAgent };

// Proxy through the MCP Resource Server route: guards to ensure authorized, and if not MCP Client attempts OAuth flow.
export default function useMcpServerProxy(app, provider, mcpServerUrl) {
  app.use(mcpServerUrl.pathname, async (req, res, next) => {
    const logger = createRequestLogger(req);
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.set(
        'WWW-Authenticate',
        'Bearer error="invalid_token", error_description="Missing Authorization header"'
      );
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing Authorization header',
      });
      return;
    }

    const [type, token] = authHeader.split(' ');
    if (type.toLowerCase() !== 'bearer' || !token) {
      res.set(
        'WWW-Authenticate',
        'Bearer error="invalid_token", error_description="Invalid Authorization header format, expected \'Bearer TOKEN\'"'
      );
      res.status(401).json({
        error: 'invalid_token',
        error_description: "Invalid Authorization header format, expected 'Bearer TOKEN'",
      });
      return;
    }

    // Check if proxy access token is valid
    const accessToken = await provider.AccessToken.find(token);
    if (!accessToken) {
      res.set(
        'WWW-Authenticate',
        'Bearer error="invalid_token", error_description="Invalid access token, may be expired"'
      );
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid access token, may be expired',
      });
      return;
    }

    // Verify that a primary Identity access token exists
    const proxyClient = await provider.Client.find(accessToken.clientId);
    if (!proxyClient?.identityAuthAccessToken) {
      await destroyAccess(provider, accessToken);
      return res.redirect(getSessionResetUrl());
    }

    logger.info('proxy request applying authorization for identity', {
      identityAuthId: proxyClient.identityAuthId,
    });

    const hasBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
    let reqBodyBuf;
    if (hasBody && req.body) {
      reqBodyBuf = Buffer.from(JSON.stringify(req.body));
    }

    const proxyReqHeaders = {
      'user-agent': req.headers['user-agent'] || 'MCP-Auth-Proxy',
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
    if (hasBody && req.headers['content-length']) {
      proxyReqHeaders['content-length'] = reqBodyBuf?.byteLength || 0;
    }
    if (req.headers['content-type']) {
      proxyReqHeaders['content-type'] = req.headers['content-type'];
    }
    if (req.headers['x-request-id']) {
      proxyReqHeaders['x-request-id'] = req.headers['x-request-id'];
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
            authorization: `bearer ${proxyClient.identityAuthAccessToken}`,
          },
          ...proxyOptions,
        },
        async (proxyRes) => {
          logger.info('proxy request received response', {
            statusCode: proxyRes.statusCode,
          });

          switch (proxyRes.statusCode) {
          case 401: {
            if (didTryRefresh) {
              logger.warn('proxy request token refreshed already attempted');
              await destroyAccess(provider, accessToken);
              return res.redirect(getSessionResetUrl());
            }
            try {
              logger.info('proxy request begin token refresh');
              await refreshIdentityToken(provider, proxyClient);
            } catch (err) {
              logger.error('proxy request token refresh failed', {
                error: err.message,
                identityAuthId: proxyClient.identityAuthId,
              });
              await destroyAccess(provider, accessToken);
              return res.redirect(getSessionResetUrl());
            }
            didTryRefresh = true;
            logger.info('proxy request token refreshed for identity', {
              identityAuthId: proxyClient.identityAuthId,
            });

            // Retry original request to MCP Server
            proxyReqFunc();

            return;
          }
          }

          res.status(proxyRes.statusCode);

          if (proxyRes.headers['content-type']) {
            res.setHeader('content-type', proxyRes.headers['content-type']);
          }
          if (proxyRes.headers['date']) {
            res.setHeader('date', proxyRes.headers['date']);
          }
          if (proxyRes.headers['transfer-encoding']) {
            res.setHeader('transfer-encoding', proxyRes.headers['transfer-encoding']);
          }

          proxyRes.on('data', (chunk) => {
            res.write(chunk);
          });

          proxyRes.on('end', () => {
            res.end();
            if (!res.headersSent) {
              next();
            }
          });

          proxyRes.on('error', (err) => {
            logger.error('proxy request streaming error', {
              error: err.message,
            });
            next(err);
          });
        }
      );

      proxyReq.on('error', (err) => {
        logger.error('proxy request error', {
          error: err.message,
        });
        next(err);
      });

      req.on('close', () => {
        proxyReq.destroy();
      });

      if (hasBody && reqBodyBuf) {
        proxyReq.write(reqBodyBuf);
      } else {
        proxyReq.end();
      }
    };

    proxyReqFunc();
  });
}
