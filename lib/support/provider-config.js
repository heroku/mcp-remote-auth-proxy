import RedisAdapter from "./redis-adapter.js";
import _ from 'lodash';

const {
  IDENTITY_SCOPE,
  OIDC_PROVIDER_JWKS
} = process.env;

let IDENTITY_SCOPE_parsed;
try {
  IDENTITY_SCOPE_parsed = IDENTITY_SCOPE.split(new RegExp("[, ]"));
  IDENTITY_SCOPE_parsed = _.union(['openid'], IDENTITY_SCOPE_parsed);
} catch(err) {
  throw new Error(`IDENTITY_SCOPE must contain a string of space or comman separated scopes (error: ${err}`);
}

let OIDC_PROVIDER_JWKS_parsed;
try {
  OIDC_PROVIDER_JWKS_parsed = JSON.parse(OIDC_PROVIDER_JWKS);
} catch(err) {
  throw new Error(`OIDC_PROVIDER_JWKS must contain a JSON array of one or more private JSON Web Keysets (error: ${err}`);
}

export default {
  adapter: RedisAdapter,
  clients: [
    // {
    //   client_id: 'oidcCLIENT',
    //   client_secret: '...',
    //   grant_types: ['refresh_token', 'authorization_code'],
    //   redirect_uris: ['http://sso-client.dev/providers/7/open_id', 'http://sso-client.dev/providers/8/open_id'],
    // }
  ],
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
  claims: {
    address: ['address'],
    email: ['email', 'email_verified'],
    phone: ['phone_number', 'phone_number_verified'],
    profile: ['birthdate', 'family_name', 'gender', 'given_name', 'locale', 'middle_name', 'name',
      'nickname', 'picture', 'preferred_username', 'profile', 'updated_at', 'website', 'zoneinfo'],
  },
  clientDefaults: {
    id_token_signed_response_alg: 'Ed25519'
  },
  features: {
    devInteractions: { enabled: false }, // defaults to true

    registration: {
      enabled: true,
      initialAccessToken: false,
      issueRegistrationAccessToken: false
    }
  },
  grantTypes: [
    'authorization_code',
    'refresh_token'
  ],
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
  scopes: IDENTITY_SCOPE_parsed
};
