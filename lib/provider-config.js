import RedisAdapter from "./redis-adapter.js";
import _ from 'lodash';

import interactionPolicy from "./interaction-policy.js";

const {
  PROVIDER_SCOPE = 'openid offline_access',
  OIDC_PROVIDER_JWKS
} = process.env;

let PROVIDER_SCOPE_parsed;
try {
  PROVIDER_SCOPE_parsed = PROVIDER_SCOPE.split(new RegExp("[, ]+"));
} catch(err) {
  throw new Error(`PROVIDER_SCOPE must contain a string of space or comma separated scopes (error: ${err}`);
}

let OIDC_PROVIDER_JWKS_parsed;
try {
  OIDC_PROVIDER_JWKS_parsed = JSON.parse(OIDC_PROVIDER_JWKS);
} catch(err) {
  throw new Error(`OIDC_PROVIDER_JWKS must contain a JSON array of one or more private JSON Web Keysets (error: ${err}`);
}

export default {
  adapter: RedisAdapter,
  extraClientMetadata: {
    properties: [
      'identityLoginConfirmed',
      'identityAuthCodeVerifier',
      'identityAuthState',
      'identityAuthAccessToken',
      'identityAuthRefreshToken',
      'identityAuthSignature',
      'identityAuthScope',
      'identityAuthIdToken',
      'identityAuthInstanceUrl',
      'identityAuthId',
      'identityAuthTokenType',
      'identityAuthIssuedAt',
      'identityAuthExpiresIn',
      'identityAuthSessionNonce'
    ]
  },
  extraParams: {
    // Scope is not included by MCP Client, so must be set to default.
    // If getting a 400 error:
    //   'authorization request resolved without requesting interactions but no scope was granted', 
    // then this value (scopes) may not intersect with the granted scope.
    scope: async function(ctx, value, client) {
      ctx.oidc.params.scope = value || PROVIDER_SCOPE;
    }
  },
  interactions: {
    policy: interactionPolicy,
    url(ctx, interaction) { // eslint-disable-line no-unused-vars
      return `/interaction/${interaction.uid}`;
    },
  },
  clientDefaults: {
    application_type: 'native',
    grant_types: [
      'authorization_code',
      'refresh_token'
    ],
    id_token_signed_response_alg: 'Ed25519',
    response_types: [
      'code',
      'code token'
    ]
  },
  features: {
    devInteractions: { enabled: false }, // defaults to true

    // Enabled to support VS Code
    // https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#featuresdeviceflow
    deviceFlow: {
      enabled: true
    },

    registration: {
      enabled: true,
      initialAccessToken: false,
      issueRegistrationAccessToken: false
    }
  },
  routes: {
    authorization: '/auth',
    backchannel_authentication: '/backchannel',
    code_verification: '/device',
    device_authorization: '/device/auth',
    end_session: '/session/end',
    introspection: '/token/introspection',
    jwks: '/jwks',
    pushed_authorization_request: '/request',
    registration: '/reg',
    revocation: '/token/revocation',
    token: '/token',
    userinfo: '/me'
  },
  jwks: {
    keys: OIDC_PROVIDER_JWKS_parsed
  },
  scopes: PROVIDER_SCOPE_parsed
};
