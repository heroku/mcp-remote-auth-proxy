# OAuth proxy for remote Model Context Protocol servers

Heroku RFC: [Authorization Proxy for Remote MCP Servers](https://salesforce.quip.com/TtBWAC0Ub9eJ).

This app is intended be deployed as an MCP Auth Proxy within a Heroku app for a Remote MCP Server, although it can be run as a separate free-standing proxy app.

Originally based on [node-oidc-provider Express.js example](https://github.com/panva/node-oidc-provider/blob/main/example/express.js).

# Deployment

With a new Heroku app, created in a Private Space, for an MCP Server repo like [mcp-heroku-com](https://github.com/heroku/mcp-heroku-com)…

## Buildpacks

Add the required buildpacks for this auth proxy. Ensure that `mcp-remote-auth-proxy` is always last, so that its [default web process](bin/release) is launched.

```bash
heroku buildpacks:add --index 1 https://github.com/heroku/heroku-buildpack-github-netrc.git
heroku buildpacks:set --index 2 heroku/nodejs
heroku buildpacks:set --index 3 https://github.com/heroku/mcp-remote-auth-proxy.git
```

If a different language than Node.js for the MCP Server, then insert that buildpack before `mcp-remote-auth-proxy`.

### GitHub User Token for `mcp-remote-auth-proxy` buildpack

[Create a GitHub auth token](https://github.com/heroku/heroku-buildpack-github-netrc) for the app to access the private mcp-remote-auth-proxy repo:

```bash
heroku config:set \
  GITHUB_AUTH_TOKEN=xxxxx
```

## Key-Value Store

Key-Value store is required for clients & authorizations storage.

```bash
heroku addons:create heroku-redis:private-3 --as=MCP_AUTH_PROXY_REDIS
```

## Auth Proxy Base URL

Set the base URL for the auth proxy to the public-facing https hostname of the Heroku app. Should be a custom domain name for real deployments. This is self-referential in auth flow redirect URIs:

```bash
heroku config:set \
  BASE_URL=https://mcp-heroku-com-with-auth-proxy-5f63807b3fb0.herokuapp.com
```

## Auth Proxy Views Directory

The Auth Proxy leverages EJS for templating of interaction views. As of this writing, the only templates required are `confirm-login.ejs` and `_layout.ejs`.

See the default, built-in templates for Heroku: [lib/views/](lib/views).

The directory path must be an absolute path, starting with `/`.

For example, to use a directory such as `/support/auth-views` committed along with the MCP Server source code, running on Heroku:

```
heroku config:set \
  OIDC_PROVIDER_VIEWS_PATH=/app/support/auth-views
```

## MCP Server URL & Command

Set the internal, local URL for the proxy to reach the MCP Server, and the command to start it, overriding whatever the `PORT` is already set to be by Heroku runtime. For example:

```bash
heroku config:set \
  MCP_SERVER_URL=http://localhost:3000/mcp \  
  MCP_SERVER_RUN_COMMAND="npm" \
  MCP_SERVER_RUN_ARGS_JSON='["start"]' \
  MCP_SERVER_RUN_DIR="/Users/mars.hall/Projects/mcp-heroku-com" \
  MCP_SERVER_RUN_ENV_JSON='{"PORT":3000,"HEROKU_API_URL":"https://api.staging.herokudev.com"}'
```

## Auth Proxy Provider Cryptography

Generate the cryptographic material for the auth proxy. Uses https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks):

```bash
heroku config:set \
  OIDC_PROVIDER_JWKS="[$(jwkgen --jwk)]"
```

## Identity Provider OAuth Client

Generate a new static OAuth client for the Identity provider. This client's redirect URI origin must match the [Auth Proxy Base URL](#auth-proxy-base-url) `BASE_URL` origin. 

For example, Heroku Identity:

```bash
heroku clients:create mcp-heroku-com-with-auth-proxy 'https://mcp-heroku-com-with-auth-proxy-5f63807b3fb0.herokuapp.com/interaction/identity/callback'
```

*Each identity provider has its own process/interface to create OAuth clients. Please see their documentation for instructions.*

Once created, set the client ID & secret in the config vars, along with the Identity Provider's URL & OAuth scope to be granted.

```bash
heroku config:set \
  IDENTITY_SERVER_URL=https://identity.staging.herokudev.com \
  IDENTITY_CLIENT_ID=yyyyy \
  IDENTITY_CLIENT_SECRET=zzzzz \
  IDENTITY_SCOPE=global
```

### Non-OIDC Providers

Optionally, for Identity providers that do not support OIDC discovery, 
reference a [ServerMetadata JSON file](https://github.com/panva/openid-client/blob/v6.x/docs/interfaces/ServerMetadata.md), containing: `"issuer"`, `"authorization_endpoint"`, `"token_endpoint"`, & `"scopes_supported"`.

For example, Heroku Identity staging (or production) requires,

```bash
heroku config:set \
  IDENTITY_SERVER_METADATA_FILE='/app/mcp-auth-proxy/heroku_identity_staging_metadata.json'
```

## OpenTelemetry

The Auth Proxy supports sending OpenTelemetry traces to an observability platform for storage and monitoring, using standard OpenTelemetry environment variables for configuration.

For environments that don't require telemetry data to be sent, set the following config var on the Heroku app:

```bash
heroku config:set \
  OTEL_SDK_DISABLED='true'
```

If the `OTEL_SDK_DISABLED` config var is omitted or set to a value different from `true`, the Auth Proxy will attempt to enable OpenTelemetry tracing provided the required config vars `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL` have been correctly set according to the observability platform where traces are to be sent. Additionally, some platforms require specific headers with API or License Keys to be set in `OTEL_EXPORTER_OTLP_HEADERS` in order for the telemetry information to reach the endpoint.

For Honeycomb, the following config vars should be set:

```bash
heroku config:set \
  OTEL_EXPORTER_OTLP_ENDPOINT='https://api.honeycomb.io' \
  OTEL_EXPORTER_OTLP_HEADERS='x-honeycomb-team=<HONEYCOMB_ENVIRONMENT_API_KEY>' \
  OTEL_EXPORTER_OTLP_PROTOCOL='http/protobuf' \
```

In the previous command, replace `<HONEYCOMB_ENVIRONMENT_API_KEY>` with a valid ingestion API Key specific for the Honeycomb Environment matching the app environment (development, staging or production).

Finally, the `OTEL_SERVICE_NAME` needs to be set to the logical name of the service. According to [OpenTelemetry's documentation](https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/#service-attributes) it MUST be the same for all instances of horizontally scaled services. For Heroku apps, the preferred value is the app name:

```bash
heroku config:set \
  OTEL_SERVICE_NAME=<app-name>
```

If `OTEL_SERVICE_NAME` isn't set, the `service.name` attribute will be set to `unnamed_mcp_remote_auth_proxy` following OpenTelemetry requirements.

## Build & Launch 🚀

Now the Heroku app should be ready to build & launch. In the Heroku Dashboard, start a new deployment for the app.

# Development

* using https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)
* Redis aka KeyValueStore is required, set in `MCP_AUTH_PROXY_REDIS_URL`

```
npm install

cp .env.template .env
```

Inspect `.env` to fill in missing values:
* `IDENTITY_SERVER_URL`, `IDENTITY_CLIENT_ID`, `IDENTITY_CLIENT_SECRET`, `IDENTITY_SCOPE` should be set for the upstream/primary Identity OAuth provider (like a Heroku OAuth client, or Salesforce External Client App) to provide the API access required by the MCP Server's tools.
* redirect URL for the Identity OAuth client should use the path `/interaction/identity/callback`, such as `http://localhost:3001/interaction/identity/callback` for local dev.
* `OTEL_SDK_DISABLED` must be set to `false` and both `OTEL_SERVICE_NAME` and `HONEYCOMB_DEVELOPMENT_API_KEY` must be set according to instructions on the `.env.template` file if you want OTel traces to be sent to Honeycomb.

```
npm start
```

Now, run MCP Inspector pointed at the proxy:
```
rm -rf ~/.mcp-auth && npx -y @modelcontextprotocol/inspector npx -y mcp-remote@next http://localhost:3001/mcp
```

And, run the MCP Server itself at `http://localhost:3000`.

When you visit MCP Inspector at `http://localhost:6274` and click Connect, you should be redirected into the Idenity OAuth flow, as configured by the `IDENTITY_*` env variables.

## Patching Third-party Packages

In order to support the quirks of the emerging MCP Clients, some third-party packages must be patched.

We use [patch-package](https://www.npmjs.com/package/patch-package) to perform this trick.

Patching is configured with:
1. [`package.json`](package.json) `postinstall` script
2. code diffs in [`patches/`](patches/)
3. create or update a patch `npm exec patch-package MODULE_NAME` 

## Testing

```
npm test
```

This script runs `mocha` with the environment loaded from `.env-test`.

## Debug

```
DEBUG=express-http-proxy npm start
```
# Rolling Credentials

### Platform OAuth Client

Both production and canary use a [Trusted Platform Client](https://github.com/heroku/api/blob/master/docs/daily-operations/platform_clients.md)

#### Production

1. There is no zero downtime way to do the credroll. Notify #heroku-support and #heroku-ecosystem that you will be performing maintenance on Heroku MCP for a few minutes when rolling credentials for the production app. Try to do it in a low usage time window, preferrably between 00:00-01:00 UTC (21:00-22:00 ART / 17:00-18:00 PT).

2. Get the Trusted Platform Client UUID
  ```sh
  heroku config:get IDENTITY_CLIENT_ID -a mcp-heroku-com
  ```
3. Put the application in maintenance mode.
  ```sh
  heroku maintenance:on -a mcp-heroku-com
  ```
4. Rotate the client's credentials
  ```sh
  heroku sudo -u api+oauth@heroku.com -- clients:rotate <IDENTITY_CLIENT_ID>
  ```
5. If the last command seems to fail (503) with a timeout message, it won't output the new credentials. Instead, you will need to download a JSON
containing all clients, search MCP OAuth Clients with the UUID and copy the associated secret token.
  ```sh
  heroku sudo -u api+oauth@heroku.com -- clients --json > all_client_secrets.json
  ```
6. Edit the `HEROKU_OAUTH_SECRET` config var value
  ```sh
  heroku config:edit IDENTITY_CLIENT_SECRET -a mcp-heroku-com
  ```
7. Paste the new secret token, save and quit.
8. Wait for all dynos to cycle
  ```sh
  heroku ps:wait -a mcp-heroku-com
  ```
9. Take the application out of maintenance mode.
  ```sh
  heroku maintenance:off -a mcp-heroku-com
  ```