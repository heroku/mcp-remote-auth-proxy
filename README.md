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

## Build & Launch 🚀

Now the Heroku app should be ready to build & launch. In the Heroku Dashboard, start a new deployment for the app.

# Local Dev

* using https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)
* Redis aka KeyValueStore is required, set in `MCP_AUTH_PROXY_REDIS_URL`

```
npm install

cp .env-example .env
echo "OIDC_PROVIDER_JWKS='[$(jwkgen --jwk)]'" >> .env
```

Inspect `.env` to fill in missing values:
* `IDENTITY_SERVER_URL`, `IDENTITY_CLIENT_ID`, `IDENTITY_CLIENT_SECRET`, `IDENTITY_SCOPE` should be set for the upstream/primary Identity OAuth provider (like a Heroku OAuth client, or Salesforce External Client App) to provide the API access required by the MCP Server's tools.
* redirect URL for the Identity OAuth client should use the path `/interaction/identity/callback`, such as `http://localhost:3001/interaction/identity/callback` for local dev.

```
npm start
```

Now, run MCP Inspector pointed at the proxy:
```
rm -rf ~/.mcp-auth && npx -y @modelcontextprotocol/inspector npx -y mcp-remote@next http://localhost:3001/mcp
```

And, run the MCP Server itself at `http://localhost:3000`.

When you visit MCP Inspector at `http://localhost:6274` and click Connect, you should be redirected into the Idenity OAuth flow, as configured by the `IDENTITY_*` env variables.

## Testing

```
npm test
```

This script runs `mocha` with the environment loaded from `.env-test`.

## Debug

```
DEBUG=express-http-proxy npm start
```
