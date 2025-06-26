import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL('./'), {
  data: {
    // This particular file can't be correctly wrapped by import-in-the-middle,
    // so we need to exclude it.
    exclude: [/\/node_modules\/oidc-provider\/lib\/actions\/grants\/index.js/]
  }
});
