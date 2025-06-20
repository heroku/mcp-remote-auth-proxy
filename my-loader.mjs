import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL('./'), {
  data: {
    exclude: [/\/node_modules\/oidc-provider\/lib\/actions\/grants\/index.js/]
  }
})
