/* eslint-disable no-console */

import * as path from 'node:path';
import * as url from 'node:url';

import { dirname } from 'desm';
import express from 'express'; // eslint-disable-line import/no-unresolved
import proxy from 'express-http-proxy';
import helmet from 'helmet';
import morgan from 'morgan';

import { Provider} from 'oidc-provider';

import Account from './support/account.js';
import provider_configuration from './support/provider-configuration.js';
import use_interaction_routes from './support/use-interaction-routes.js';

const __dirname = dirname(import.meta.url);

const {
  LOCAL_INSECURE = 'false',
  PORT,
  BASE_URL,
  MCP_SERVER_URL
} = process.env;

provider_configuration.findAccount = Account.findAccount;

const app = express();
// Log all requests
app.use(morgan("tiny"));

const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete directives['form-action'];
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives,
  },
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');


const provider = new Provider(BASE_URL, provider_configuration);

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
}

// Proxy through the MCP Resource Server route: guards to ensure authorized, and if not MCP Client attempts OAuth flow.
let mcp_server_proxy_func = proxy(MCP_SERVER_URL);
app.use('/mcp', (req, res, next) => {
  // TODO more verifications like https://github.com/tilfin/modelcontextprotocol-typescript-sdk/blob/66e1508162d37c0b83b0637ebcd7f07946e3d210/src/server/auth/middleware/bearerAuth.ts#L32
  if (!req.headers.authorization) {
    res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Missing Authorization header"');
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Missing Authorization header'
    });
  } else {
    mcp_server_proxy_func(req, res, next);
  }
});

// Declare the Authorization Server Metadata for the proxied MCP Server, at /mcp
// https://datatracker.ietf.org/doc/html/rfc8414
app.get('/.well-known/oauth-authorization-server', async (_req, res) => {
  res.json({
    "issuer":
      `${BASE_URL}`,
    "authorization_endpoint":
      `${BASE_URL}${provider_configuration.routes.authorization}`,
    "token_endpoint":
      `${BASE_URL}${provider_configuration.routes.token}`,
    "userinfo_endpoint":
      `${BASE_URL}${provider_configuration.routes.userinfo}`,
    "jwks_uri":
      `${BASE_URL}${provider_configuration.routes.jwks}`,
    "registration_endpoint":
      `${BASE_URL}${provider_configuration.routes.registration}`,
    "scopes_supported":
      ["openid", "profile", "email", "address",
        "phone", "offline_access"],
    "response_types_supported":
      ["code", "code token"],
    "code_challenge_methods_supported": 
      ["S256"]
    });
});

// OAuth Provider routes and middleware
use_interaction_routes(app, provider);
app.use(provider.callback());

provider.use(async (ctx, next) => {
  /** pre-processing
   * you may target a specific action here by matching `ctx.path`
   */
  console.log("pre middleware", ctx.method, ctx.path);

  await next();
  /** post-processing
   * since internal route matching was already executed you may target a specific action here
   * checking `ctx.oidc.route`, the unique route names used are
   *
   * `authorization`
   * `backchannel_authentication`
   * `client_delete`
   * `client_update`
   * `client`
   * `code_verification`
   * `cors.device_authorization`
   * `cors.discovery`
   * `cors.introspection`
   * `cors.jwks`
   * `cors.pushed_authorization_request`
   * `cors.revocation`
   * `cors.token`
   * `cors.userinfo`
   * `device_authorization`
   * `device_resume`
   * `discovery`
   * `end_session_confirm`
   * `end_session_success`
   * `end_session`
   * `introspection`
   * `jwks`
   * `pushed_authorization_request`
   * `registration`
   * `resume`
   * `revocation`
   * `token`
   * `userinfo`
   */
  console.log("post middleware", ctx.method, ctx.oidc?.route);
});

app.listen(PORT, () => {
  console.log(`application is listening on port ${PORT}, check its /.well-known/openid-configuration`);
});

export default app;
