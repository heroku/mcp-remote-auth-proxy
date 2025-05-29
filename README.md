# OAuth proxy for remote Model Context Protocol servers

⚠️ **This is a work in progress, not yet functional.** This contains hardcoded localhost:port references, and expects the MCP server to host its resource endpoints at `/mcp`.

# Deployment

This app can be deployed as an MCP Auth Proxy within a Heroku app for a Remote MCP Server.

```bash
heroku buildpacks:set --index 1 https://github.com/poetic-labs/git-ssh-key-buildpack.git
heroku buildpacks:set --index 2 heroku/nodejs
heroku buildpacks:set --index 3 https://github.com/heroku/mcp-remote-auth-proxy.git
```

Key-Value store is required for clients & authorizations storage.

```bash
heroku addons:create heroku-redis:private-3 --as=MCP_AUTH_PROXY_REDIS
```

If a different language than Node.js for the MCP Server, then insert that buildpack before `mcp-remote-auth-proxy`.

[Create a deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#deploy-keys) for the app to access the private mcp-remote-auth-proxy repo. The public key must be added as deploy key in GitHub. The private key must be set in the app's config vars:

```bash
heroku config:set \
  GIT_SSH_KEY=$(echo path/to/deploy_key_ed25519 | base64 ) \
  GIT_SSH_HOST="github.com"
```

Set the base URL for the auth proxy to the public-facing https hostname of the Heroku app. Should be a custom domain name for real deployments:

```bash
heroku config:set \
  BASE_URL=https://mcp-heroku-com-with-auth-proxy-5f63807b3fb0.herokuapp.com
```

Set the internal, local URL for the proxy to reach the MCP Server, and the command to start it, overriding whatever the `PORT` is already set to be Heroku. For example:

```bash
heroku config:set \
  MCP_SERVER_URL=http://localhost:3000/mcp \
  MCP_SERVER_RUN_COMMAND="cd /app && PORT=3000 npm start"
```

Generate the cryptographic material for the auth proxy:

```bash
heroku config:set \
  OIDC_PROVIDER_JWKS="[$(jwkgen --jwk)]"
```

Generate a new OAuth client for the Identity provider, for example, Heroku Identity:

```bash
heroku clients:create mcp-heroku-com-with-auth-proxy 'https://mcp-heroku-com-with-auth-proxy-5f63807b3fb0.herokuapp.com/interaction/identity/callback'
```

```bash
heroku config:set \
  IDENTITY_SERVER_URL=https://identity.staging.herokudev.com \
  IDENTITY_CLIENT_ID=yyyyy \
  IDENTITY_CLIENT_SECRET=zzzzz \
  IDENTITY_SCOPE=global
```

Optionally, for Identity providers that do not support OIDC discovery, 
reference a [ServerMetadata JSON file](https://github.com/panva/openid-client/blob/v6.x/docs/interfaces/ServerMetadata.md), containing: `"issuer"`, `"authorization_endpoint"`, `"token_endpoint"`, & `"scopes_supported"`.

For example, Heroku Identity staging (or production) requires,

```bash
heroku config:set \
  IDENTITY_SERVER_METADATA_FILE='/app/mcp-auth-proxy/heroku_identity_staging_metadata.json'
```

# Local Dev

Based on example https://github.com/panva/node-oidc-provider/blob/main/example/express.js

* using https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)
* Redis aka KeyValueStore is required, set in `REDIS_URL`

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

## Debug

```
DEBUG=express-http-proxy npm start
```
