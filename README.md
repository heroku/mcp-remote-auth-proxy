# OAuth Proxy for Remote Model Context Protocol Servers

This app functions as an MCP auth proxy within your Heroku app and enables you to use a remote MCP server. Alternatively, you can run this code as a separate free-standing proxy app.

> This repo is based on a [node-oidc-provider Express.js example](https://github.com/panva/node-oidc-provider/blob/main/example/express.js).

# Deployment

This app uses the [Heroku Buildpack MCP Auth Proxy](https://github.com/heroku/heroku-buildpack-mcp-auth-proxy#quick-setup) to install the server on your Heroku app.

## Configuration

Configure a new Heroku app you've created in a [Private Space](https://devcenter.heroku.com/articles/private-spaces) for an [MCP Server repo](https://github.com/heroku/mcp-heroku-com) with the following steps.

### Key-Value Store

[Heroku Key-Value store](https://devcenter.heroku.com/articles/heroku-redis) (KVS) with Redis is required for client and authorization storage. To provision KVS, run:

```bash
heroku addons:create heroku-redis:private-3 --as=MCP_AUTH_PROXY_REDIS
```

### Auth Proxy Base URL

Set the base URL for the auth proxy to the public-facing https hostname of the Heroku app. The base URL is self-referential in auth flow redirect URIs. If you plan to deploy the app, use a [custom domain name](https://devcenter.heroku.com/articles/custom-domains).

```bash
heroku config:set \
  BASE_URL=https://<app-subdomain>.herokuapp.com
```

### Auth Proxy Views Directory

The auth proxy uses embedded JavaScript templates (EJS) for interaction views. Currently, there are [two required templates](lib/views): `confirm-login.ejs` and `_layout.ejs`.

To use the templates, their directory path must be absolute and start with `/`.

For example, to use the directory `/support/auth-views` committed along with the MCP Server source code and running on Heroku:

```
heroku config:set \
  OIDC_PROVIDER_VIEWS_PATH=/app/mcp-auth-proxy/mcp-auth-proxy/support/auth-views
```

### Brand Customization

The auth proxy automatically detects and applies branding based on the Identity Provider URL (IdP). You can also customize the branding appearance with the following environment variables.

#### `BRANDING_TITLE`

Use BRANDING_TITLE to customize the page title displayed in the browser tab and page header.

- **Default**: `"Login for Model Context Protocol"`
- **Example**: `heroku config:set BRANDING_TITLE="My Custom Auth Service"`

#### `BRANDING_FAVICON`

Use BRANDING_FAVICON to customize the favicon URL for authentication pages.

- **Default**: `undefined` (no favicon)
- **Example**: `heroku config:set BRANDING_FAVICON="https://example.com/custom-favicon.ico"`

#### Brand Color Scheme

Edit the default brand color scheme in `branding-config.js`:

```javascript
colors: {
  primary: '#a7bcd9',
  secondary: '#718096',
  background: 'linear-gradient(135deg, #f7fafc 0%, #e2e8f0 100%)',
  text: '#2d3748',
  textMuted: '#718096',
  border: '#bbc2c9'
}
```

### MCP Server URL and Command

Set the internal, local URL for the proxy to reach the MCP Server, and the command to start it, by overriding the `PORT` set by Heroku runtime. For example:

```bash
heroku config:set \
  MCP_SERVER_URL=http://localhost:3000/mcp \
  MCP_SERVER_RUN_COMMAND="npm" \
  MCP_SERVER_RUN_ARGS_JSON='["start"]' \
  MCP_SERVER_RUN_DIR="/app/mcp-heroku-com" \
  MCP_SERVER_RUN_ENV_JSON='{"PORT":3000,"HEROKU_API_URL":"https://api.staging.herokudev.com"}'
```

### Auth Proxy Provider Cryptography

Generate the [JSON Web Key Set](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks) (jwks) for auth proxy cryptographic material with the [JSON Web Key Generator](https://github.com/rakutentech/jwkgen):

```bash
heroku config:set \
  OIDC_PROVIDER_JWKS="[$(jwkgen --jwk)]"
```

### Identity Provider OAuth Client

Generate a new static OAuth client for the Identity provider. This client's redirect URI origin must match the [Auth Proxy Base URL](#auth-proxy-base-url) (`BASE_URL`) origin. For example, for Heroku Identity:

```bash
heroku clients:create mcp-heroku-com-with-auth-proxy 'https://<app-subdomain>.herokuapp.com/interaction/identity/callback'
```

> Each identity provider has its own process/interface to create OAuth clients. Please see their documentation for instructions.

Once created, set the client ID, secret, Identity Provider URL, and OAuth scope to be granted with config vars:

```bash
heroku config:set \
  IDENTITY_SERVER_URL=https://identity.staging.herokudev.com \
  IDENTITY_CLIENT_ID=yyyyy \
  IDENTITY_CLIENT_SECRET=zzzzz \
  IDENTITY_SCOPE=global
```

#### Non-OIDC Providers

Optionally, for identity providers that do not support OIDC discovery,
reference a [ServerMetadata JSON file](https://github.com/panva/openid-client/blob/v6.x/docs/interfaces/ServerMetadata.md) that contains the `"issuer"`, `"authorization_endpoint"`, `"token_endpoint"`, and `"scopes_supported"` fields.

For example, Heroku Identity staging (or production) requires:

```bash
heroku config:set \
  IDENTITY_SERVER_METADATA_FILE='/app/mcp-auth-proxy/heroku_identity_staging_metadata.json'
```

### Deployment

Your Heroku app is now ready to deploy. Start a new deployment for the app in your [Heroku Dashboard](https://dashboard.heroku.com/).

# Buildpack Deployment

Install the [Remote MCP Auth Proxy Buildpack](https://github.com/heroku/heroku-buildpack-mcp-auth-proxy) to deploy this repository as a buildpack alongside a remote MCP server.

# Development

* Use https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)
* KeyValueStore with Redis is required, which you can set in `MCP_AUTH_PROXY_REDIS_URL`

```
npm install

cp .env-example .env
echo "OIDC_PROVIDER_JWKS='[$(jwkgen --jwk)]'" >> .env
```

Inspect `.env` to fill in missing values:

* `IDENTITY_SERVER_URL`, `IDENTITY_CLIENT_ID`, `IDENTITY_CLIENT_SECRET`, and `IDENTITY_SCOPE` should be set for the upstream/primary identity OAuth provider (like a Heroku OAuth client, or Salesforce External Client App) to provide the API access required by the MCP server's tools.
* The redirect URL for the identity OAuth client must use the path `/interaction/identity/callback`, such as `http://localhost:3001/interaction/identity/callback` for local development.

Start NPM:

```
npm start
```

Run MCP Inspector pointed at the proxy:

```
rm -rf ~/.mcp-auth && npx -y @modelcontextprotocol/inspector npx -y mcp-remote@next http://localhost:3001/mcp
```

Run the MCP server itself at `http://localhost:3000`.

When you visit MCP Inspector at `http://localhost:6274` and click **Connect**, you should be redirected to the identity OAuth flow, as configured by the `IDENTITY_*` env variables.

## Patching Third-party Packages

Some third-party packages require patches to support the quirks of the emerging MCP Clients. We use [patch-package](https://www.npmjs.com/package/patch-package) for this.

Patching is configured with:

1. [`package.json`](package.json) `postinstall` script
2. Code diffs in [`patches/`](patches/)
3. Create or update a patch `npm exec patch-package MODULE_NAME`

## Testing

```
npm test
```

This script runs `mocha` with the environment loaded from `.env-test`.

## Debug

```
DEBUG=express-http-proxy npm start
```
