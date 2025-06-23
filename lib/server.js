/* eslint-disable no-console */
import fs from 'fs';
import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import helmet from 'helmet';
import morgan from 'morgan';

import { Provider } from 'oidc-provider';
import providerConfig from './provider-config.js';

import RedisAdapter from "./redis-adapter.js";
import { identityClientInit } from './identity-client.js';
import useInteractionRoutes from './use-interaction-routes.js';
import useMcpServerProxy from "./use-mcp-server-proxy.js";
import { useSessionReset } from "./use-session-reset.js";
import runMcpServerAndThen from "./run-mcp-server-and-then.js";
import rateLimit from "express-rate-limit";
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

const __dirname = dirname(import.meta.url);

function server(env = {}, listeningCallback, exitFunc) {
  const {
    LOCAL_INSECURE = 'false',
    PORT,
    BASE_URL,
    OIDC_PROVIDER_VIEWS_PATH,
    MAX_REQUESTS,
    MAX_REQUESTS_WINDOW,
    MCP_SERVER_URL,
    MCP_SERVER_RUN_COMMAND,
    MCP_SERVER_RUN_ARGS_JSON,
    MCP_SERVER_RUN_DIR,
    MCP_SERVER_RUN_ENV_JSON,
    MCP_AUTH_PROXY_REDIS_URL
  } = env;

  // Simple Redis client for rate limiting
  let rateLimitRedisClient = null;
  if (LOCAL_INSECURE !== 'true' && process.env.NODE_ENV !== 'test' && MCP_AUTH_PROXY_REDIS_URL) {
    try {
      rateLimitRedisClient = new Redis(MCP_AUTH_PROXY_REDIS_URL, {
        keyPrefix: 'rate-limit:',
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      rateLimitRedisClient.on('error', (err) => {
        console.warn('Rate limit Redis client error:', err);
        // Don't exit on Redis errors, just fall back to in-memory store
      });
    } catch (err) {
      console.warn('Failed to create rate limit Redis client:', err);
      rateLimitRedisClient = null;
    }
  }

  const rateLimitConfig = {
    windowMs: MAX_REQUESTS_WINDOW || 60000, // 1 minute
    max: MAX_REQUESTS || 60, // Limit each IP to 60 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: 'You have exceeded the rate limit for authorization requests'
  };

  // Use Redis store in production, in-memory store for testing/development
  if (LOCAL_INSECURE !== 'true' && process.env.NODE_ENV !== 'test' && rateLimitRedisClient) {
    rateLimitConfig.store = new RedisStore({
      sendCommand: (...args) => rateLimitRedisClient.call(...args)
    });
  }

  let authServerUrl;
  try {
    authServerUrl = new URL(BASE_URL);
  } catch (err) {
    throw new Error('BASE_URL must be a valid URL');
  }
  let mcpServerUrl;
  try {
    mcpServerUrl = new URL(MCP_SERVER_URL);
  } catch (err) {
    throw new Error('MCP_SERVER_URL must be a valid URL');
  }

  // Use process.exit to exit unless the exitFunc is defined (for tests)
  if (typeof exitFunc !== 'function') {
    exitFunc = (code) => {
      process.exit(code);
    };
  }

  RedisAdapter.init(process.env, (message) => {
    console.log("Exiting due to Redis", message);
    exitFunc(1);
  });

  identityClientInit(process.env);

  const app = express();
  app.use(express.json());
  
  // Create rate limiting middleware (but don't apply globally yet)
  const rateLimitMiddleware = rateLimitConfig !== false ? rateLimit(rateLimitConfig) : null;

  let oidcViewsPath;
  if (OIDC_PROVIDER_VIEWS_PATH) {
    if (fs.existsSync(OIDC_PROVIDER_VIEWS_PATH)) {
      oidcViewsPath = OIDC_PROVIDER_VIEWS_PATH;
      console.log('OAuth provider configured for views path', oidcViewsPath);
    } else {
      throw new Error(`The configured OIDC_PROVIDER_VIEWS_PATH does not exist, ${OIDC_PROVIDER_VIEWS_PATH}`);
    }
  } else {
    oidcViewsPath = path.join(__dirname, 'views');
  }
  app.set('views', oidcViewsPath);
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
    // only log all requests when local (Heroku router produces these logs)
    app.use(morgan("tiny"));
  }

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
    },
  }));

  // Declare the Authorization Server Metadata for the proxied MCP Server, at /mcp
  // https://datatracker.ietf.org/doc/html/rfc8414
  const middlewares = rateLimitMiddleware ? [rateLimitMiddleware] : [];
  app.get('/.well-known/oauth-authorization-server', ...middlewares, async (_req, res) => {
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

  useMcpServerProxy(app, provider, mcpServerUrl);
  useSessionReset(app, authServerUrl);

  // OAuth Provider routes and middleware
  useInteractionRoutes(app, provider);
  app.use(provider.callback());

  // Only connect the listener once the MCP Server is ready to accept requests
  const appListenFunc = (mcpServerProcess) => {
    const authProxyServer = app.listen(PORT, () => {
      console.log(`OAuth provider is listening on port ${PORT}, proxying ${mcpServerUrl.pathname} to ${mcpServerUrl} with bearer token authorization`);
    });
    // Support a caller that needs to know when the server is UP (for tests)
    if (typeof listeningCallback === 'function') {
      listeningCallback(authProxyServer, mcpServerProcess);
    }
  }
  try {
    runMcpServerAndThen(
      MCP_SERVER_RUN_COMMAND, 
      MCP_SERVER_RUN_ARGS_JSON,
      MCP_SERVER_RUN_DIR,
      MCP_SERVER_RUN_ENV_JSON,
      appListenFunc,
      exitFunc
    );
  } catch (err) {
    throw new Error(`Failed to start MCP Server sub-process, ${err}`);
  }
};

export default server;
