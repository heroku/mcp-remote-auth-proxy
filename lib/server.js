/* eslint-disable no-console */

import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import helmet from 'helmet';
import morgan from 'morgan';

import { Provider } from 'oidc-provider';
import providerConfig from './provider-config.js';

import { redisAdapterInit } from "./redis-adapter.js";
import { identityClientInit } from './identity-client.js';
import useInteractionRoutes from './use-interaction-routes.js';
import useMcpServerProxy from "./use-mcp-server-proxy.js";
import { useSessionReset } from "./use-session-reset.js";
import runMcpServerAndThen from "./run-mcp-server-and-then.js";

const __dirname = dirname(import.meta.url);

function server(env = {}, listeningCallback) {
  const {
    LOCAL_INSECURE = 'false',
    PORT,
    BASE_URL,
    MCP_SERVER_URL,
    MCP_SERVER_RUN_COMMAND,
    MCP_SERVER_RUN_ARGS_JSON,
    MCP_SERVER_RUN_DIR,
    MCP_SERVER_RUN_ENV_JSON
  } = env;

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

  redisAdapterInit(process.env);
  identityClientInit(process.env);

  const app = express();
  // Log all requests
  app.use(morgan("tiny"));

  app.use(express.json());

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
    if (typeof listeningCallback === 'function') {
      listeningCallback(authProxyServer, mcpServerProcess);
    }
  }
  const exitFunc = (code) => {
    process.exit(code);
  };
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
