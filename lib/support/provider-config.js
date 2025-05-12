import RedisAdapter from "./redis-adapter.js";
import _ from 'lodash';

const {
  IDENTITY_SCOPE,
  OIDC_PROVIDER_JWKS
} = process.env;

let IDENTITY_SCOPE_parsed;
try {
  IDENTITY_SCOPE_parsed = IDENTITY_SCOPE.split(new RegExp("[, ]+"));
} catch(err) {
  throw new Error(`IDENTITY_SCOPE must contain a string of space or comma separated scopes (error: ${err}`);
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
      'identity_auth_code_verifier',
      'identity_auth_state',
      'identity_auth_access_token',
      'identity_auth_refresh_token',
      'identity_auth_signature',
      'identity_auth_scope',
      'identity_auth_id_token',
      'identity_auth_instance_url',
      'identity_auth_id',
      'identity_auth_token_type',
      'identity_auth_issued_at'
    ]
  },
  extraParams: {
    // Scope is not included by MCP Client, so must be set to default
    scope: async function(ctx, value, client) {
      ctx.oidc.params.scope = value || IDENTITY_SCOPE;
    }
  },
  interactions: {
    url(ctx, interaction) { // eslint-disable-line no-unused-vars
      return `/interaction/${interaction.uid}`;
    },
  },
  clientDefaults: {
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
  scopes: [
    'openid',
    'offline_access'
  ] 
};
