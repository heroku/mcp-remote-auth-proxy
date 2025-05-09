import RedisAdapter from "./redis-adapter.js";

let OIDC_PROVIDER_JWKS;
try {
  OIDC_PROVIDER_JWKS = JSON.parse(process.env.OIDC_PROVIDER_JWKS);
} catch(err) {
  throw new Error("OIDC_PROVIDER_JWKS must contain a JSON array of one or more private JSON Web Keysets (error: ${err}");
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
      'identity_auth_state'
    ]
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
    keys: OIDC_PROVIDER_JWKS
  },
};
