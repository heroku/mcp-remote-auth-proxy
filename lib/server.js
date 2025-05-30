/* eslint-disable no-console */

import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import helmet from 'helmet';
import morgan from 'morgan';

import { Provider } from 'oidc-provider';

import providerConfig from './support/provider-config.js';
import useInteractionRoutes from './support/use-interaction-routes.js';
import useMcpServerProxy from "./support/use-mcp-server-proxy.js";
import runMcpServerAndThen from "./support/run-mcp-server-and-then.js";

const __dirname = dirname(import.meta.url);

const {
  LOCAL_INSECURE = 'false',
  PORT,
  BASE_URL,
  MCP_SERVER_URL,
  MCP_SERVER_RUN_COMMAND,
  MCP_SERVER_RUN_ARGS_JSON,
  MCP_SERVER_RUN_DIR,
  MCP_SERVER_RUN_ENV_JSON
} = process.env;

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

let authServerUrl;
try {
  authServerUrl = new URL(BASE_URL);
} catch (err) {
  console.log('BASE_URL must be a valid URL', err);
  process.exit(1);
}
let mcpServerUrl;
try {
  mcpServerUrl = new URL(MCP_SERVER_URL);
} catch (err) {
  console.log('MCP_SERVER_URL must be a valid URL', err);
  process.exit(1);
}
useMcpServerProxy(app, provider, authServerUrl, mcpServerUrl);

// OAuth Provider routes and middleware
useInteractionRoutes(app, provider);
app.use(provider.callback());

// Setup app listener to connect once, after the MCP Server sub-process starts-up
let appListenCalled = false;
const appListenFunc = () => {
  if (!appListenCalled) {
    app.listen(PORT, () => {
      console.log(`OAuth provider is listening on port ${PORT}, proxying ${mcpServerUrl.pathname} to ${mcpServerUrl} with bearer token authorization`);
    });
  }
  appListenCalled = true;
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

export default app;
