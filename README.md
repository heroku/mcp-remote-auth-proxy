# OAuth proxy for remote Model Context Protocol servers

⚠️ **This is a work in progress, not yet functional.** This contains hardcoded localhost:port references, and expects the MCP server to host its resource endpoints at `/mcp`.

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
