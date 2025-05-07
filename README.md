Based on example https://github.com/panva/node-oidc-provider/blob/main/example/express.js

* using https://github.com/rakutentech/jwkgen to generate [jwks](https://github.com/panva/node-oidc-provider/tree/main/docs#jwks)

```
npm install

echo "OIDC_PROVIDER_JWKS='[$(jwkgen --jwk)]'" > .env

npm run server
```