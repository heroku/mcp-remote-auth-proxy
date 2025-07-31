import { readFile } from "node:fs/promises";

import * as identityClientModule from 'openid-client';
import logger from './logger.js';

const identityClient = {
  ...identityClientModule
};

let didInit = false;
let identityProviderMetadata;
let identityScope;
let identityCallbackPath;
let identityUniqueCallbackPath;

// Token refresh configuration (set during init)
let isProactiveRefreshEnabled = false;
let refreshBufferMs = 900000; // 15 minutes in milliseconds

// Time conversion constants
const MINUTES_TO_MS = 60000; // 1 minute = 60,000 milliseconds

export async function identityClientInit(env = {}) {
  const {
    IDENTITY_SERVER_URL,
    IDENTITY_CLIENT_ID,
    IDENTITY_CLIENT_SECRET,
    IDENTITY_SCOPE,
    IDENTITY_SERVER_METADATA_FILE,
    IDENTITY_CALLBACK_PATH = '/interaction/identity/callback',
    IDENTITY_UNIQUE_CALLBACK_PATH = '/interaction/:uid/identity/callback',
    // Token refresh strategy configuration
    TOKEN_REFRESH_STRATEGY = 'manual', // 'proactive' | 'manual'
    REFRESH_BUFFER_MINUTES = '15', // Minutes before expiration to refresh
  } = env;

  identityCallbackPath = IDENTITY_CALLBACK_PATH;
  identityUniqueCallbackPath = IDENTITY_UNIQUE_CALLBACK_PATH;

  // Parse token refresh configuration
  isProactiveRefreshEnabled = TOKEN_REFRESH_STRATEGY === 'proactive';
  const refreshBufferMinutes = parseInt(REFRESH_BUFFER_MINUTES);
  refreshBufferMs = refreshBufferMinutes * MINUTES_TO_MS;
  
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
      logger.info('Initialized identity provider from server metadata file', {
        identityServerUrl: IDENTITY_SERVER_URL
      });
    } catch (err) {
      logger.error('Error reading IDENTITY_SERVER_METADATA_FILE', {
        error: err.message,
        description: 'Should be a JSON file containing OpenID Provider Metadata for the configured IDENTITY_* provider (only required if the identity provider does not directly support OpenID Connect Discovery 1.0)'
      });
      throw err;
    }
  } else {
    try {
      identityProviderMetadata = await identityClient.discovery(
        new URL(IDENTITY_SERVER_URL),
        IDENTITY_CLIENT_ID,
        IDENTITY_CLIENT_SECRET,
      );
      logger.info('Initialized identity provider using OIDC discovery', {
        identityServerUrl: IDENTITY_SERVER_URL
      });
    } catch (err) {
      logger.error('Error using OpenID Connect Discovery', {
        error: err.message,
        identityServerUrl: IDENTITY_SERVER_URL,
        discoveryUrl: `${IDENTITY_SERVER_URL}/.well-known/openid-configuration`,
        description: 'which should return OpenID Provider Metadata (alternatively, write the metadata in a local JSON file, path configured IDENTITY_SERVER_METADATA_FILE)'
      });
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

// Check if token needs proactive refresh based on expiration time
function shouldProactivelyRefreshToken(authProxyClient) {
  // Only check if proactive refresh is enabled
  if (!isProactiveRefreshEnabled) {
    return false;
  }

  const issuedAt = authProxyClient.identityAuthIssuedAt;
  const expiresIn = authProxyClient.identityAuthExpiresIn;
  
  // If we don't have expiration info, can't determine need for refresh
  if (!issuedAt || !expiresIn) {
    return false;
  }
  
  const expiresInMs = expiresIn * 1000; // OAuth tokens expire in seconds, convert to ms
  const expiresAt = issuedAt + expiresInMs;
  const refreshThreshold = expiresAt - refreshBufferMs;
  const now = Date.now();
  
  return now > refreshThreshold;
}

// Proactively refresh token if needed (only when enabled)
async function checkAndRefreshToken(authProxyProvider, authProxyClient) {
  if (shouldProactivelyRefreshToken(authProxyClient)) {
    logger.info('Proactively refreshing token before expiration', {
      identityAuthId: authProxyClient.identityAuthId,
      refreshBufferMinutes: refreshBufferMs / MINUTES_TO_MS // Convert ms back to minutes for logging
    });
    
    try {
      await refreshIdentityToken(authProxyProvider, authProxyClient);
      logger.info('Proactive token refresh successful', {
        identityAuthId: authProxyClient.identityAuthId
      });
    } catch (err) {
      // Log but don't throw - let the normal request proceed and handle error there
      logger.warn('Proactive token refresh failed, will try again on next request', {
        identityAuthId: authProxyClient.identityAuthId,
        error: err.message
      });
    }
  }
}

export { 
  identityClient, 
  identityProviderMetadata, 
  identityScope,
  generateIdentityAuthUrl,
  refreshIdentityToken,
  checkAndRefreshToken, // New proactive refresh function
  identityCallbackPath,
  identityUniqueCallbackPath 
};
