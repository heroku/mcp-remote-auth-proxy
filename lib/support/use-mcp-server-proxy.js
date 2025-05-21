import proxy from 'express-http-proxy';

import { refreshIdentityToken } from './identity-client.js';

// Proxy through the MCP Resource Server route: guards to ensure authorized, and if not MCP Client attempts OAuth flow.
export default function useMcpServerProxy(app, provider, mcpServerUrl) {
  let makeMcpServerProxy = function(mcpUrl, proxyClient, originalReq) {
    let didTryRefresh = false;
    let proxyFunc = proxy(mcpUrl.origin, {
      proxyReqPathResolver: function (req) {
        // Prefix the proxied request path with original path (/mcp)
        return mcpUrl.pathname + req.path;
      },
      proxyReqOptDecorator: function(proxyReqOpts, _srcReq) {
        delete proxyReqOpts.headers['authorization'];
        delete proxyReqOpts.headers['Authorization'];
        proxyReqOpts.headers['authorization'] = `Bearer ${proxyClient.identityAuthAccessToken}`;
        if (proxyClient.identityAuthScope) {
          proxyReqOpts.headers['x-authorization-scope'] = proxyClient.identityAuthScope;
        }
        if (proxyClient.clientId) {
          proxyReqOpts.headers['x-dynamic-client-id'] = proxyClient.clientId;
        }
        return proxyReqOpts;
      },
      userResDecorator: async function(proxyRes, proxyResData, userReq, userRes) {
        console.log('userResDecorator upstream response ', proxyRes.statusCode, proxyResData.toString('utf8'));
        switch (proxyRes.statusCode) {
          case 401: {
            if (didTryRefresh) {
              console.log('userResDecorator didTryRefresh');
              userRes.statusCode = 401;
              return JSON.stringify({
                error: 'invalid_token',
                error_description: 'Token refresh already attempted'
              });
            }
            try {
              await refreshIdentityToken(provider, proxyClient);
            } catch(err) {
              console.log('userResDecorator refreshIdentityToken error', err);
              userRes.statusCode = 401;
              return JSON.stringify({
                error: 'invalid_token',
                error_description: 'Token refresh failed: ${err}'
              });
            }
            didTryRefresh = true;
            console.log('/mcp token refreshed', proxyClient.identityAuthId);
            
            userRes.statusCode = 408;
            return JSON.stringify({
              error: 'invalid_token',
              error_description: 'Token refreshed, please retry'
            });
          }
        }
        return proxyResData;
      }
    });
    return proxyFunc;
  };

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
    makeMcpServerProxy(mcpServerUrl, proxyClient, req)(req, res, next);
  });
}
