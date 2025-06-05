import { readFile } from "node:fs/promises";

import * as identityClient from 'openid-client';

let didInit = false;
let identityProviderMetadata;
let identityScope;
let identityCallbackPath;
let identityUniqueCallbackPath;

export async function identityClientInit(env = {}) {
  const {
    IDENTITY_SERVER_URL,
    IDENTITY_CLIENT_ID,
    IDENTITY_CLIENT_SECRET,
    IDENTITY_SCOPE,
    IDENTITY_SERVER_METADATA_FILE,
    IDENTITY_CALLBACK_PATH = '/interaction/identity/callback',
    IDENTITY_UNIQUE_CALLBACK_PATH = '/interaction/:uid/identity/callback'
  } = env;

  identityCallbackPath = IDENTITY_CALLBACK_PATH;
  identityUniqueCallbackPath = IDENTITY_UNIQUE_CALLBACK_PATH;

  let IDENTITY_SCOPE_parsed;
  try {
    IDENTITY_SCOPE_parsed = IDENTITY_SCOPE.split(new RegExp("[, ]+"));
    identityScope = IDENTITY_SCOPE;
  } catch(err) {
    throw new Error(`IDENTITY_SCOPE must contain a string of space or comma separated scopes (error: ${err}`);
  }
  
  if (IDENTITY_SERVER_METADATA_FILE && IDENTITY_SERVER_METADATA_FILE != '') {
    try {
      const metadataJSON = await readFile(IDENTITY_SERVER_METADATA_FILE);
      const metadata = JSON.parse(metadataJSON);
      identityProviderMetadata = new identityClient.Configuration(
        metadata, 
        IDENTITY_CLIENT_ID, 
        IDENTITY_CLIENT_SECRET
      );
      console.log(`Initialized identity provider ${IDENTITY_SERVER_URL} from server metadata file ${IDENTITY_SERVER_METADATA_FILE}`)
    } catch (err) {
      console.log('Error reading IDENTITY_SERVER_METADATA_FILE, which should be a JSON file containing OpenID Provider Metadata for the configured IDENTITY_* provider (only required if the identity provider does not directly support OpenID Connect Discovery 1.0)', err.message);
      throw err;
    }
  } else {
    try {
      identityProviderMetadata = await identityClient.discovery(
        new URL(IDENTITY_SERVER_URL),
        IDENTITY_CLIENT_ID,
        IDENTITY_CLIENT_SECRET,
      );
      console.log(`Initialized identity provider ${IDENTITY_SERVER_URL} using OIDC discovery`);
    } catch (err) {
      console.log(`Error using OpenID Connect Discovery for IDENTITY_SERVER_URL (${IDENTITY_SERVER_URL}/.well-known/openid-configuration), which should return OpenID Provider Metadata (alternatively, write the metadata in a local JSON file, path configured IDENTITY_SERVER_METADATA_FILE)`, err.message);
      throw err;
    }
  }
  didInit = true;
}

// Based on https://github.com/panva/openid-client?tab=readme-ov-file#authorization-code-flow
async function generateIdentityAuthUrl(interactionId, authProxyProvider, authProxyClient, redirectBaseUrl) {
  if (!didInit) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  let redirectUrl = new URL(identityCallbackPath, redirectBaseUrl);
  /**
   * PKCE: The following MUST be generated for every redirect to the
   * authorization_endpoint. You must store the codeVerifier and state in the
   * end-user session such that it can be recovered as the user gets redirected
   * from the authorization server back to your application.
   */
  let codeVerifier = identityClient.randomPKCECodeVerifier()
  let codeChallenge = await identityClient.calculatePKCECodeChallenge(codeVerifier);

  let parameters = {
    redirect_uri: redirectUrl.href,
    scope: identityScope,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: interactionId
  };
  // Using "state: interactionId" in these params, so that we can always redirect 
  // generic callback URL to the Interaction-specific path, so that the session 
  // cookie will resume effect.
  //
  // Therefore, skipping the following conditional random state stuff at this time…
  // if (!identityProviderMetadata.serverMetadata().supportsPKCE()) {
  //   /**
  //    * We cannot be sure the server supports PKCE so we're going to use state too.
  //    * Use of PKCE is backwards compatible even if the AS doesn't support it which
  //    * is why we're using it regardless. Like PKCE, random state must be generated
  //    * for every redirect to the authorization_endpoint.
  //    */
  //   state = identityClient.randomState();
  //   parameters.state = state;
  // }

  authProxyClient['identityAuthCodeVerifier'] = codeVerifier;
  authProxyClient['identityAuthState'] = parameters.state;
  await authProxyProvider.Client.adapter.upsert(
    authProxyClient.clientId, authProxyClient.metadata());

  let redirectTo = identityClient.buildAuthorizationUrl(identityProviderMetadata, parameters);

  return redirectTo.href;
}

async function refreshIdentityToken(authProxyProvider, authProxyClient) {
  if (!didInit) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  let refreshTokenGrant = await identityClient.refreshTokenGrant(
    identityProviderMetadata, 
    authProxyClient.identityAuthRefreshToken
  );

  // Save fresh access token in Client model
  authProxyClient['identityAuthAccessToken'] = refreshTokenGrant.access_token;
  authProxyClient['identityAuthSignature'] = refreshTokenGrant.signature;
  authProxyClient['identityAuthScope'] = refreshTokenGrant.scope;
  authProxyClient['identityAuthTokenType'] = refreshTokenGrant.token_type;
  authProxyClient['identityAuthIssuedAt'] = refreshTokenGrant.issued_at;
  
  await authProxyProvider.Client.adapter.upsert(authProxyClient.clientId, authProxyClient.metadata());
}

export { 
  identityClient, 
  identityProviderMetadata, 
  identityScope,
  generateIdentityAuthUrl, 
  refreshIdentityToken,
  identityCallbackPath,
  identityUniqueCallbackPath 
};
