/**
 * Identity Client using MCP OAuth Provider Adapters
 *
 * Primary identity client implementation using the standardized
 * OIDCProviderAdapter with fromEnvironment helper for seamless integration.
 * @module identity-client-adapter
 */

/**
 * @typedef {import('oidc-provider').Provider} Provider
 * @typedef {import('oidc-provider').ClientMetadata} ClientMetadata
 * @typedef {import('@heroku/oauth-provider-adapters-for-mcp').OIDCProviderAdapter} OIDCProviderAdapter
 * @typedef {import('@heroku/oauth-provider-adapters-for-mcp').PKCEStorageHook} PKCEStorageHook
 * @typedef {import('@heroku/oauth-provider-adapters-for-mcp').TokenResponse} TokenResponse
 */

/**
 * Client interface with identity auth fields
 * @typedef {Object} AuthProxyClient
 * @property {string} clientId
 * @property {string} [identityAuthCodeVerifier]
 * @property {string} [identityAuthState]
 * @property {string} [identityAuthId]
 * @property {string} [identityAuthAccessToken]
 * @property {string} [identityAuthRefreshToken]
 * @property {string} [identityAuthTokenType]
 * @property {string} [identityAuthScope]
 * @property {number} [identityAuthIssuedAt]
 * @property {string} [identityAuthIdToken]
 * @property {string} [identityAuthSignature]
 * @property {string} [identityAuthInstanceUrl]
 * @property {number} [identityAuthExpiresIn]
 * @property {string} [identityAuthSessionNonce]
 * @property {() => ClientMetadata} metadata
 */

/**
 * Environment variables for adapter configuration
 * @typedef {Object} AdapterEnvironmentVariables
 * @property {string} [IDENTITY_SERVER_URL]
 * @property {string} [IDENTITY_CLIENT_ID]
 * @property {string} [IDENTITY_CLIENT_SECRET]
 * @property {string} [IDENTITY_SCOPE]
 * @property {string} [IDENTITY_SERVER_METADATA_FILE]
 * @property {string} [IDENTITY_CALLBACK_PATH]
 * @property {string} [IDENTITY_UNIQUE_CALLBACK_PATH]
 * @property {string} [BASE_URL]
 */

/**
 * PKCE state data structure
 * @typedef {Object} PKCEStateData
 * @property {string} codeVerifier
 * @property {string} state
 * @property {string} clientId
 */

import {
  fromEnvironmentAsync,
  DefaultLogger,
  LogLevel,
} from '@heroku/oauth-provider-adapters-for-mcp';
import logger from './logger.js';

/** @type {OIDCProviderAdapter | null} */
let oidcAdapter = null;

/** @type {string} */
let identityScope;

/** @type {string} */
let identityCallbackPath;

/** @type {string} */
let identityUniqueCallbackPath;

/**
 * Storage hook implementation for PKCE state persistence
 * Maps to the existing client session storage mechanism
 * @param {Provider} provider - OIDC provider instance
 * @returns {PKCEStorageHook} Storage hook implementation
 */
const createStorageHook = (provider) => ({
  async storePKCEState(key, data) {
    // Store PKCE data in the client session via the key (interaction ID)
    // This matches the existing pattern where state = interactionId
    try {
      const client = await provider.Client.find(data.clientId);
      if (client) {
        client.identityAuthCodeVerifier = data.codeVerifier;
        client.identityAuthState = data.state;
        await provider.Client.adapter.upsert(client.clientId, client.metadata());
        logger.debug('Stored PKCE state', { key, clientId: data.clientId });
      }
    } catch (error) {
      logger.error('Failed to store PKCE state', { error: error.message, key });
      throw error;
    }
  },

  async retrievePKCEState(key) {
    // Retrieve PKCE data from client session using interaction ID
    try {
      const interaction = await provider.Interaction.find(key);
      if (!interaction) {
        throw new Error(`No interaction found for key: ${key}`);
      }

      const client = await provider.Client.find(interaction.params.client_id);
      if (!client || !client.identityAuthCodeVerifier) {
        throw new Error(`No PKCE data found for interaction: ${key}`);
      }

      return {
        codeVerifier: client.identityAuthCodeVerifier,
        state: client.identityAuthState,
        clientId: client.clientId,
      };
    } catch (error) {
      logger.error('Failed to retrieve PKCE state', { error: error.message, key });
      throw error;
    }
  },

  async cleanupExpiredState() {
    // This would be handled by the existing session cleanup mechanisms
    // For now, we'll implement a no-op as cleanup happens elsewhere
    logger.debug('PKCE state cleanup requested (handled by existing session management)');
  },
});

/**
 * Initialize the OIDC adapter with environment configuration
 * Maintains backward compatibility with existing env vars
 * @param {AdapterEnvironmentVariables} [env={}] - Environment variables
 * @param {Provider | null} [provider=null] - OIDC provider instance
 * @returns {Promise<void>}
 */
export async function identityClientInit(env = {}, provider = null) {
  const {
    IDENTITY_SERVER_URL,
    IDENTITY_CLIENT_ID,
    IDENTITY_CLIENT_SECRET,
    IDENTITY_SCOPE,
    IDENTITY_SERVER_METADATA_FILE,
    IDENTITY_CALLBACK_PATH = '/interaction/identity/callback',
    IDENTITY_UNIQUE_CALLBACK_PATH = '/interaction/:uid/identity/callback',
  } = env;

  // Set up callback paths (same as before)
  identityCallbackPath = IDENTITY_CALLBACK_PATH;
  identityUniqueCallbackPath = IDENTITY_UNIQUE_CALLBACK_PATH;

  // Validate and parse scopes (same logic as before)
  let IDENTITY_SCOPE_parsed;
  try {
    IDENTITY_SCOPE_parsed = IDENTITY_SCOPE
      ? IDENTITY_SCOPE.split(new RegExp('[, ]+'))
      : ['openid', 'profile', 'email'];
    identityScope = IDENTITY_SCOPE || 'openid profile email';
  } catch (err) {
    throw new Error(
      `IDENTITY_SCOPE must contain a string of space or comma separated scopes (error: ${err})`
    );
  }

  // Prepare environment for adapter
  const adapterEnv = {
    IDENTITY_CLIENT_ID,
    IDENTITY_CLIENT_SECRET,
    IDENTITY_SERVER_URL,
    IDENTITY_REDIRECT_URI: `${env.BASE_URL}${IDENTITY_CALLBACK_PATH}`,
    IDENTITY_SCOPE: IDENTITY_SCOPE || 'openid profile email',
  };

  // Include metadata file if provided (for static metadata instead of discovery)
  if (IDENTITY_SERVER_METADATA_FILE) {
    adapterEnv.IDENTITY_SERVER_METADATA_FILE = IDENTITY_SERVER_METADATA_FILE;
  }

  try {
    // Create storage hook if provider is available
    const storageHook = provider ? createStorageHook(provider) : undefined;

    // Create Winston transport wrapper for OAuth adapter logging
    const winstonTransport = {
      log: (message) => {
        const contextLogger = logger.child({ component: 'oidc-adapter' });
        contextLogger.info(message);
      },
      error: (message) => {
        const contextLogger = logger.child({ component: 'oidc-adapter' });
        contextLogger.error(message);
      },
    };

    // Create adapter logger using Winston transport
    const adapterLogger = new DefaultLogger(
      { component: 'oidc-adapter' },
      { level: LogLevel.Info },
      winstonTransport
    );

    // Initialize adapter with environment mapping and Winston logger
    oidcAdapter = await fromEnvironmentAsync({
      env: adapterEnv,
      storageHook,
      defaultScopes: IDENTITY_SCOPE_parsed,
      logger: adapterLogger,
    });

    logger.info('Initialized identity provider using OIDC adapter', {
      identityServerUrl: IDENTITY_SERVER_URL,
      hasStaticMetadata: !!IDENTITY_SERVER_METADATA_FILE,
      scopes: IDENTITY_SCOPE_parsed,
    });
  } catch (error) {
    logger.error('Failed to initialize OIDC adapter', {
      error: error.message,
      identityServerUrl: IDENTITY_SERVER_URL,
      description: 'Check IDENTITY_* environment variables and server connectivity',
    });
    throw error;
  }
}

/**
 * Generate identity authorization URL using adapter
 * Maintains the same interface as the original function
 * @param {string} interactionId - Interaction ID (used as OAuth state)
 * @param {Provider} authProxyProvider - OIDC provider instance
 * @param {AuthProxyClient} authProxyClient - Auth proxy client
 * @param {string} redirectBaseUrl - Base URL for redirect
 * @returns {Promise<string>} Authorization URL
 */
async function generateIdentityAuthUrl(
  interactionId,
  authProxyProvider,
  authProxyClient,
  redirectBaseUrl
) {
  if (!oidcAdapter) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  try {
    const redirectUrl = new URL(identityCallbackPath, redirectBaseUrl).href;

    // Generate auth URL with adapter - this handles PKCE internally
    const authUrlResult = await oidcAdapter.generateAuthUrl(interactionId, redirectUrl);

    // Store PKCE data in client session (matches existing pattern)
    authProxyClient.identityAuthCodeVerifier = authUrlResult.codeVerifier;
    authProxyClient.identityAuthState = interactionId; // state = interactionId as before

    await authProxyProvider.Client.adapter.upsert(
      authProxyClient.clientId,
      authProxyClient.metadata()
    );

    logger.debug('Generated identity auth URL', {
      interactionId,
      clientId: authProxyClient.clientId,
      redirectUrl,
    });

    return authUrlResult.authUrl;
  } catch (error) {
    logger.error('Failed to generate identity auth URL', {
      error: error.message,
      interactionId,
      clientId: authProxyClient.clientId,
    });
    throw error;
  }
}

/**
 * Exchange authorization code for tokens using adapter
 * Maps normalized token response to existing client session fields
 * @param {Provider} authProxyProvider - OIDC provider instance
 * @param {AuthProxyClient} authProxyClient - Auth proxy client
 * @param {string} code - Authorization code
 * @param {string} redirectUrl - Redirect URL used in authorization request
 * @returns {Promise<TokenResponse>} Token response
 */
async function exchangeIdentityCode(authProxyProvider, authProxyClient, code, redirectUrl) {
  if (!oidcAdapter) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  try {
    const codeVerifier = authProxyClient.identityAuthCodeVerifier;
    if (!codeVerifier) {
      throw new Error('No code verifier found in client session');
    }

    // Exchange code for tokens using adapter
    const tokenResponse = await oidcAdapter.exchangeCode(code, codeVerifier, redirectUrl);

    // Map normalized token response to existing client session field names
    authProxyClient.identityAuthAccessToken = tokenResponse.accessToken;
    authProxyClient.identityAuthRefreshToken = tokenResponse.refreshToken;
    authProxyClient.identityAuthTokenType = tokenResponse.tokenType || 'Bearer';
    authProxyClient.identityAuthScope = tokenResponse.scope || identityScope;
    authProxyClient.identityAuthIssuedAt = tokenResponse.issuedAt || Math.floor(Date.now() / 1000);
    authProxyClient.identityAuthIdToken = tokenResponse.idToken;

    // Handle provider-specific fields that might be in userData
    if (tokenResponse.userData) {
      authProxyClient.identityAuthSignature = tokenResponse.userData.signature;
      authProxyClient.identityAuthInstanceUrl = tokenResponse.userData.instance_url;
      authProxyClient.identityAuthExpiresIn = tokenResponse.userData.expires_in;
      authProxyClient.identityAuthSessionNonce = tokenResponse.userData.session_nonce;
    }

    // Extract user ID (maintains existing logic)
    const tokenId = tokenResponse.userData?.id || tokenResponse.userData?.user_id;
    if (tokenId) {
      authProxyClient.identityAuthId = tokenId;
    }

    // Save updated client session
    await authProxyProvider.Client.adapter.upsert(
      authProxyClient.clientId,
      authProxyClient.metadata()
    );

    logger.info('Successfully exchanged identity code for tokens', {
      clientId: authProxyClient.clientId,
      hasRefreshToken: !!tokenResponse.refreshToken,
      scope: tokenResponse.scope,
    });

    return tokenResponse;
  } catch (error) {
    logger.error('Failed to exchange identity code', {
      error: error.message,
      clientId: authProxyClient.clientId,
      errorType: error.constructor.name,
    });
    throw error;
  }
}

/**
 * Refresh identity token using adapter
 * Maintains the same interface as the original function
 * @param {Provider} authProxyProvider - OIDC provider instance
 * @param {AuthProxyClient} authProxyClient - Auth proxy client
 * @returns {Promise<TokenResponse>} Token response
 */
async function refreshIdentityToken(authProxyProvider, authProxyClient) {
  if (!oidcAdapter) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  try {
    const refreshToken = authProxyClient.identityAuthRefreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    // Refresh tokens using adapter
    const tokenResponse = await oidcAdapter.refreshToken(refreshToken);

    // Update client session with fresh tokens (same mapping as exchange)
    authProxyClient.identityAuthAccessToken = tokenResponse.accessToken;
    if (tokenResponse.refreshToken) {
      authProxyClient.identityAuthRefreshToken = tokenResponse.refreshToken;
    }
    authProxyClient.identityAuthTokenType = tokenResponse.tokenType || 'Bearer';
    authProxyClient.identityAuthScope = tokenResponse.scope || identityScope;
    authProxyClient.identityAuthIssuedAt = tokenResponse.issuedAt || Math.floor(Date.now() / 1000);

    // Handle provider-specific fields
    if (tokenResponse.userData) {
      authProxyClient.identityAuthSignature = tokenResponse.userData.signature;
    }

    await authProxyProvider.Client.adapter.upsert(
      authProxyClient.clientId,
      authProxyClient.metadata()
    );

    logger.info('Successfully refreshed identity token', {
      clientId: authProxyClient.clientId,
      hasNewRefreshToken: !!tokenResponse.refreshToken,
    });

    return tokenResponse;
  } catch (error) {
    logger.error('Failed to refresh identity token', {
      error: error.message,
      clientId: authProxyClient.clientId,
      errorType: error.constructor.name,
    });
    throw error;
  }
}

// Export the identity client interface
export {
  generateIdentityAuthUrl,
  exchangeIdentityCode, // New function for cleaner code exchange
  refreshIdentityToken,
  identityCallbackPath,
  identityUniqueCallbackPath,
};
