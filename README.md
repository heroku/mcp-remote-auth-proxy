# OAuth proxy for remote Model Context Protocol servers

⚠️ **This is a work in progress, not yet functional.** This contains hardcoded localhost:port references, and expects the MCP server to host its resource endpoints at `/mcp`.

Based on example https://github.com/panva/node-oidc-provider/blob/main/example/express.js

* using https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)

```
npm install

cp .env-example .env
echo "OIDC_PROVIDER_JWKS='[$(jwkgen --jwk)]'" >> .env

npm run server
```