/* eslint-disable no-console */

import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import proxy from 'express-http-proxy';
import handleProxyErrors from "express-http-proxy/app/steps/handleProxyErrors.js";
import helmet from 'helmet';
import morgan from 'morgan';

import { Provider, interactionPolicy } from 'oidc-provider';

import { refreshIdentityToken } from './support/identity-client.js';
import providerConfig from './support/provider-config.js';
import useInteractionRoutes from './support/use-interaction-routes.js';

const __dirname = dirname(import.meta.url);

const {
  LOCAL_INSECURE = 'false',
  PORT,
  BASE_URL,
  MCP_SERVER_URL
} = process.env;

const app = express();
// Log all requests
app.use(morgan("tiny"));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const provider = new Provider(BASE_URL, providerConfig);

// Log events such as server errors
// https://github.com/panva/node-oidc-provider/blob/main/docs/events.md
function logEventCtxError(ctx, error) {
  console.log(ctx.request.method, ctx.request.url, ctx.response.status, error);
}
provider.on("server_error", logEventCtxError);
provider.on("authorization.error", logEventCtxError);
provider.on("backchannel.error", logEventCtxError);
provider.on("jwks.error", logEventCtxError);
provider.on("discovery.error", logEventCtxError);
provider.on("end_session.error", logEventCtxError);
provider.on("grant.error", logEventCtxError);
provider.on("introspection.error", logEventCtxError);
provider.on("pushed_authorization_request.error", logEventCtxError);
provider.on("registration_create.error", logEventCtxError);
provider.on("registration_delete.error", logEventCtxError);
provider.on("registration_read.error", logEventCtxError);
provider.on("registration_update.error", logEventCtxError);
provider.on("revocation.error", logEventCtxError);
provider.on("userinfo.error", logEventCtxError);

const cspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete cspDirectives['form-action'];

// Enforce HTTPS and cooperate with TLS-terminating router
if (LOCAL_INSECURE !== 'true') {
  app.enable('trust proxy');
  provider.proxy = true;

  app.use((req, res, next) => {
    if (req.secure) {
      next();
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      res.redirect(url.format({
        protocol: 'https',
        host: req.get('host'),
        pathname: req.originalUrl,
      }));
    } else {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'do yourself a favor and only use https',
      });
    }
  });
} else {
  // fix for confirm-login form in Safari with localhost
  delete cspDirectives['upgrade-insecure-requests'];
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives,
  },
}));

// Proxy through the MCP Resource Server route: guards to ensure authorized, and if not MCP Client attempts OAuth flow.
const mcpServerUrl = new URL(MCP_SERVER_URL);
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
    proxyErrorHandler: async function(err, res, next) {
      switch (err && err.code) {
        case 401: {
          if (didTryRefresh) {
            return res.status(500).json({
              error: 'invalid_token',
              error_description: 'Token refresh already attempted'
            });
          }
          try {
            await refreshIdentityToken(provider, proxyClient);
          } catch(err) {
            return res.status(500).json({
              error: 'invalid_token',
              error_description: `Token refresh failed: ${err}`
            });
          }
          didTryRefresh = true;
          console.log('/mcp token refreshed', proxyClient.identityAuthId);
          return proxyFunc(originalReq, res, next);
        }
      }
      return handleProxyErrors(err, res, next);
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

// Declare the Authorization Server Metadata for the proxied MCP Server, at /mcp
// https://datatracker.ietf.org/doc/html/rfc8414
app.get('/.well-known/oauth-authorization-server', async (_req, res) => {
  res.json({
    "issuer":
      `${BASE_URL}`,
    "authorization_endpoint":
      `${BASE_URL}${providerConfig.routes.authorization}`,
    "token_endpoint":
      `${BASE_URL}${providerConfig.routes.token}`,
    "token_introspection_endpoint":
      `${BASE_URL}${providerConfig.routes.introspection}`,
    "userinfo_endpoint":
      `${BASE_URL}${providerConfig.routes.userinfo}`,
    "jwks_uri":
      `${BASE_URL}${providerConfig.routes.jwks}`,
    "registration_endpoint":
      `${BASE_URL}${providerConfig.routes.registration}`,
    "scopes_supported":
      providerConfig.scopes,
    "response_types_supported":
      ["code", "code token"],
    "code_challenge_methods_supported": 
      ["S256"],
    "grant_types_supported":
      ["authorization_code", "refresh_token"]
    });
});

// OAuth Provider routes and middleware
useInteractionRoutes(app, provider);
app.use(provider.callback());

app.listen(PORT, () => {
  console.log(`OAuth provider is listening on port ${PORT}, proxying ${mcpServerUrl.pathname} with bearer token authorization`);
});

export default app;
