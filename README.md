# OAuth Proxy for Remote Model Context Protocol Servers

This app functions as an MCP auth proxy within your Heroku app and enables you to use a remote MCP server. Alternatively, you can run this code as a separate free-standing proxy app.

> This repo is based on a [node-oidc-provider Express.js example](https://github.com/panva/node-oidc-provider/blob/main/example/express.js).

# Deployment

This app uses the [Heroku Buildpack MCP Auth Proxy](https://github.com/heroku/heroku-buildpack-mcp-auth-proxy#quick-setup) to install the server on your Heroku app.

## Configuration

Configure a new Heroku app you created in a [Private Space](https://devcenter.heroku.com/articles/private-spaces) for an MCP Server that requires authorization for MCP clients.

### Key-Value Store

[Heroku Key-Value Store](https://devcenter.heroku.com/articles/heroku-redis) (KVS) with Redis is required for client and authorization storage. To provision KVS, run:

```bash
heroku addons:create heroku-redis:private-3 --as=MCP_AUTH_PROXY_REDIS
```

### Auth Proxy Base URL

Set the base URL for the auth proxy to the public-facing HTTPS hostname of the Heroku app. The base URL is self-referential in auth flow redirect URIs. If you plan to deploy the app, use a [custom domain name](https://devcenter.heroku.com/articles/custom-domains).

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

The auth proxy automatically detects and applies branding based on the Identity Provider (IdP) URL. You can also customize the branding appearance with the following environment variables.

#### `BRANDING_TITLE`

Use `BRANDING_TITLE` to customize the page title displayed in the browser tab and page header.

- **Default**: `"Login for Model Context Protocol"`
- **Example**: `heroku config:set BRANDING_TITLE="My Custom Auth Service"`

#### `BRANDING_FAVICON`

Use `BRANDING_FAVICON` to customize the favicon URL for authentication pages.

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
  MCP_SERVER_RUN_COMMAND="pnpm" \
  MCP_SERVER_RUN_ARGS_JSON='["start"]' \
  MCP_SERVER_RUN_DIR="/app" \
  MCP_SERVER_RUN_ENV_JSON='{"PORT":3000,"BACKEND_API_URL":"https://mcp.example.com"}'
```

### Auth Proxy Provider Cryptography

Generate the [JSON Web Key Set](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks) (jwks) for auth proxy cryptographic material with the [JSON Web Key Generator](https://github.com/rakutentech/jwkgen):

```bash
heroku config:set \
  OIDC_PROVIDER_JWKS="[$(jwkgen --jwk)]"
```

### Identity Provider OAuth Client

Generate a new static OAuth client for the identity provider. This client's redirect URI origin must match the [Auth Proxy Base URL](#auth-proxy-base-url) (`BASE_URL`) origin.

> Each identity provider has its own process and interface to create OAuth clients. See their documentation for instructions.

After creating it, set the client ID, secret, Identity Provider URL, and OAuth scope to be granted with config vars:

```bash
heroku config:set \
  IDENTITY_SERVER_URL=https://identity.example.com \
  IDENTITY_CLIENT_ID=yyyyy \
  IDENTITY_CLIENT_SECRET=zzzzz \
  IDENTITY_SCOPE=global
```

### Deployment

Your Heroku app is now ready to deploy. Start a new deployment for the app in your [Heroku Dashboard](https://dashboard.heroku.com/).

# Buildpack Deployment

Install the [Remote MCP Auth Proxy Buildpack](https://github.com/heroku/heroku-buildpack-mcp-auth-proxy) to deploy this repository as a buildpack alongside a remote MCP server.

## Using the OAuth Provider Adapter Library

Use the [OAuth Provider Adapter Library](https://github.com/heroku/oauth-provider-adapters-for-mcp) to implement the authorization flow for a remote MCP server. The OAuth Provider Adapter Library ensures your authorization implementation is consistent, and includes robust logging and validation features.

We recommend using OIDC discovery. If OIDC discovery isn't possible in your environment, configure static metadata using the adapter library. The adapter supports pointing `IDENTITY_SERVER_METADATA_FILE` to a JSON file that includes fields like `"issuer"`, `"authorization_endpoint"`, `"token_endpoint"`, and `"jwks_uri"`. This auth proxy no longer supports static OpenID Provider metadata directly.

### Install in Remote Server

- npm:

  ```bash
  npm install @heroku/oauth-provider-adapters-for-mcp
  ```

- pnpm:

  ```bash
  pnpm add @heroku/oauth-provider-adapters-for-mcp
  ```

### Configure with Environment Variables

The adapter supports discovery or static metadata:

- `IDENTITY_CLIENT_ID`: OAuth client ID
- `IDENTITY_CLIENT_SECRET`: OAuth client secret
- `IDENTITY_SERVER_URL`: Issuer URL (for OIDC discovery)
- `IDENTITY_REDIRECT_URI`: Redirect URI registered with your IdP
- `IDENTITY_SCOPE`: Space or comma separated scopes (for example, `openid profile email offline_access`)
- `IDENTITY_SERVER_METADATA_FILE`: Absolute path to JSON with static metadata (adapter-only)

> Note: Static metadata is handled by the adapter library, not by this proxy.

### Usage with Discovery (Recommended)

```ts
import { fromEnvironmentAsync } from '@heroku/oauth-provider-adapters-for-mcp';

// Provide a durable storageHook in production to store PKCE state between steps
const oidc = await fromEnvironmentAsync({
  env: process.env,
  storageHook,            // for example, Redis or your DB
});

await oidc.initialize();

// Begin the login flow
const state = crypto.randomUUID();
const authUrl = await oidc.generateAuthUrl(state, process.env.IDENTITY_REDIRECT_URI!);
// Redirect the user to authUrl

// Handle callback
const tokens = await oidc.exchangeCode(code, codeVerifier, process.env.IDENTITY_REDIRECT_URI!);
// Optionally refresh later
// const refreshed = await oidc.refreshToken(tokens.refreshToken!);
```
# Development

* Use the [JSON Web Key Generator](https://github.com/rakutentech/jwkgen) to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks).
* Key-Value Store with Redis is required, which you can set in `MCP_AUTH_PROXY_REDIS_URL`

```
pnpm install

cp .env-example .env
echo "OIDC_PROVIDER_JWKS='[$(jwkgen --jwk)]'" >> .env
```

Inspect `.env` to fill in missing values:

* Set the `IDENTITY_SERVER_URL`, `IDENTITY_CLIENT_ID`, `IDENTITY_CLIENT_SECRET`, and `IDENTITY_SCOPE` fields in the upstream/primary identity OAuth provider, like a Heroku OAuth client, or Salesforce External Client App. These fields provide the API access required by the MCP server's tools.
* The redirect URL for the identity OAuth client must use the path `/interaction/identity/callback`, such as `http://localhost:3001/interaction/identity/callback` for local development.

Start via `pnpm`:

```
pnpm start
```

Run MCP Inspector pointed at the proxy:

```
rm -rf ~/.mcp-auth && npx -y @modelcontextprotocol/inspector npx -y mcp-remote@next http://localhost:3001/mcp
```

Run the MCP server itself at `http://localhost:3000`.

When you visit MCP Inspector at `http://localhost:6274` and click **`Connect`**, you should be redirected to the identity OAuth flow, as configured by the `IDENTITY_*` env variables.

## Patching Third-party Packages

Some third-party packages require patches to support the quirks of the emerging MCP Clients. We use [patch-package](https://www.npmjs.com/package/patch-package) for patches.

Patching is configured with:

1. [`package.json`](package.json) `postinstall` script
2. Code diffs in [`patches/`](patches/)
3. Create or update a patch `pnpm exec patch-package MODULE_NAME`

## Code Quality and Testing

This project uses pnpm for package management and includes comprehensive code quality tools to maintain high standards.

### Available Scripts

```bash

# Run the full Mocha test suite with c8 coverage reporting using the `.env-test` environment configuration
pnpm test

# Check code quality with ESLint
pnpm lint

# Automatically fix linting issues and format code with Prettier
pnpm format

# Run TypeScript type checks on enabled JS files with JSDoc tag annotations
# Note: Add @ts-check at the top of the file to enable type checking
# Full instrucitons here: https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html
pnpm type-check

# All code quality checks and tests
pnpm check

# Run the continuous integration checks (linting, type checking, and tests)
pnpm ci
```

### Development Workflow

For the best development experience:

1. **Before starting work**: Ensure dependencies are installed with `pnpm install`
2. **During development**: Run `pnpm type-check` periodically to catch type errors early
3. **Before committing**: Run `pnpm check` to ensure all quality standards are met
4. **Fix issues quickly**: Use `pnpm format` to auto-fix formatting and linting issues

### Test Environment

Tests require:
- Redis instance running (local or configured via `MCP_AUTH_PROXY_REDIS_URL` in `.env-test`)
- Valid test configuration in `.env-test` file
- All identity provider settings configured for test scenarios

## Debug

Enable verbose logging for the proxy middleware:

```
DEBUG=express-http-proxy pnpm start
```
