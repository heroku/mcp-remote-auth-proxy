/**
 * Identity Client using MCP OAuth Provider Adapters
 *
 * Primary identity client implementation using the standardized
 * OIDCProviderAdapter with fromEnvironment helper for seamless integration.
 */

import type { Provider, ClientMetadata } from 'oidc-provider';
import type {
  OIDCProviderAdapter,
  PKCEStorageHook,
  TokenResponse,
} from '@heroku/oauth-provider-adapters-for-mcp';
import {
  fromEnvironmentAsync,
  DefaultLogger,
  LogLevel,
} from '@heroku/oauth-provider-adapters-for-mcp';
import logger from './logger.js';

let oidcAdapter: OIDCProviderAdapter | null = null;
let identityScope: string;
let identityCallbackPath: string;
let identityUniqueCallbackPath: string;

/**
 * PKCE state data structure
 */
interface PKCEStateData {
  codeVerifier: string;
  state: string;
  clientId: string;
}

/**
 * Client interface with identity auth fields
 */
interface AuthProxyClient {
  clientId: string;
  identityAuthCodeVerifier?: string;
  identityAuthState?: string;
  identityAuthId?: string;
  identityAuthAccessToken?: string;
  identityAuthRefreshToken?: string;
  identityAuthTokenType?: string;
  identityAuthScope?: string;
  identityAuthIssuedAt?: number;
  metadata(): ClientMetadata;
}

/**
 * Environment variables for adapter configuration
 */
export interface AdapterEnvironmentVariables {
  IDENTITY_SERVER_URL?: string;
  IDENTITY_CLIENT_ID?: string;
  IDENTITY_CLIENT_SECRET?: string;
  IDENTITY_SCOPE?: string;
  IDENTITY_SERVER_METADATA_FILE?: string;
  IDENTITY_CALLBACK_PATH?: string;
  IDENTITY_UNIQUE_CALLBACK_PATH?: string;
  BASE_URL?: string;
  [key: string]: string | undefined;
}

/**
 * Storage hook implementation for PKCE state persistence
 * Maps to the existing client session storage mechanism
 */
const createStorageHook = (provider: Provider): PKCEStorageHook => ({
  async storePKCEState(
    interactionId: string,
    state: string,
    codeVerifier: string,
    expiresAt: number
  ): Promise<void> {
    // Store PKCE data in the client session via the key (interaction ID)
    // This matches the existing pattern where state = interactionId
    try {
      const interaction = await provider.Interaction.find(interactionId);
      if (!interaction) {
        throw new Error(`No interaction found for key: ${interactionId}`);
      }

      const client = (await provider.Client.find(
        interaction.params.client_id as string
      )) as AuthProxyClient;

      if (client) {
        client.identityAuthCodeVerifier = codeVerifier;
        client.identityAuthState = state;
        await provider.Client.adapter.upsert(client.clientId, client.metadata());
        logger.debug('Stored PKCE state', { key: interactionId, clientId: client.clientId });
      }
    } catch (error) {
      logger.error('Failed to store PKCE state', {
        error: (error as Error).message,
        key: interactionId,
      });
      throw error;
    }
  },

  async retrievePKCEState(interactionId: string, state: string): Promise<string | null> {
    // Retrieve PKCE data from client session using interaction ID
    try {
      const interaction = await provider.Interaction.find(interactionId);
      if (!interaction) {
        throw new Error(`No interaction found for key: ${interactionId}`);
      }

      const client = (await provider.Client.find(
        interaction.params.client_id as string
      )) as AuthProxyClient;

      if (!client || !client.identityAuthCodeVerifier) {
        throw new Error(`No PKCE data found for interaction: ${interactionId}`);
      }

      // Verify state matches
      if (client.identityAuthState !== state) {
        logger.warn('State mismatch in PKCE retrieval', {
          expected: client.identityAuthState,
          received: state,
        });
        return null;
      }

      return client.identityAuthCodeVerifier;
    } catch (error) {
      logger.error('Failed to retrieve PKCE state', {
        error: (error as Error).message,
        key: interactionId,
      });
      throw error;
    }
  },

  async cleanupExpiredState(beforeTimestamp: number): Promise<void> {
    // This would be handled by the existing session cleanup mechanisms
    // For now, we'll implement a no-op as cleanup happens elsewhere
    logger.debug('PKCE state cleanup requested (handled by existing session management)', {
      beforeTimestamp,
    });
  },
});

/**
 * Initialize the OIDC adapter with environment configuration
 * Maintains backward compatibility with existing env vars
 */
export async function identityClientInit(
  env: AdapterEnvironmentVariables = {},
  provider: Provider | null = null
): Promise<void> {
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
  let IDENTITY_SCOPE_parsed: string[];
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
  const adapterEnv: Record<string, string> = {
    IDENTITY_CLIENT_ID: IDENTITY_CLIENT_ID || '',
    IDENTITY_CLIENT_SECRET: IDENTITY_CLIENT_SECRET || '',
    IDENTITY_SERVER_URL: IDENTITY_SERVER_URL || '',
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
      log: (message: string) => {
        const contextLogger = logger.child({ component: 'oidc-adapter' });
        contextLogger.info(message);
      },
      error: (message: string) => {
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
      scopes: identityScope,
    });
  } catch (error) {
    logger.error('Failed to initialize OIDC adapter', {
      error: (error as Error).message || error,
      identityServerUrl: IDENTITY_SERVER_URL,
      description: 'Check IDENTITY_* environment variables and server connectivity',
    });
    throw error;
  }
}

/**
 * Generate authorization URL for the identity provider
 */
export async function generateIdentityAuthUrl(
  interactionId: string,
  provider: Provider,
  client: AuthProxyClient,
  redirectBaseUrl: string
): Promise<string> {
  if (!oidcAdapter) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  try {
    // Generate auth URL with PKCE - adapter handles PKCE internally via storage hook
    const redirectUrl = `${redirectBaseUrl}${identityCallbackPath}`;
    const authUrl = await oidcAdapter.generateAuthUrl(interactionId, redirectUrl);

    logger.debug('Generated identity auth URL with PKCE', {
      interactionId,
      clientId: client.clientId,
    });

    return authUrl;
  } catch (error) {
    logger.error('Failed to generate identity auth URL', {
      error: (error as Error).message,
      interactionId,
      clientId: client.clientId,
    });
    throw error;
  }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeIdentityCode(
  provider: Provider,
  client: AuthProxyClient,
  code: string,
  callbackUrl: string
): Promise<TokenResponse> {
  if (!oidcAdapter) {
    throw new Error('identityClientInit(env) must be called during app start-up');
  }

  try {
    // Retrieve the code verifier from client session
    const codeVerifier = client.identityAuthCodeVerifier;
    if (!codeVerifier) {
      throw new Error('No PKCE code verifier found for client');
    }

    // Exchange code for tokens using adapter
    const tokenResponse = await oidcAdapter.exchangeCode(code, codeVerifier, callbackUrl);

    // Store tokens in client session
    client.identityAuthAccessToken = tokenResponse.accessToken;
    if (tokenResponse.refreshToken) {
      client.identityAuthRefreshToken = tokenResponse.refreshToken;
    }
    client.identityAuthTokenType = 'Bearer';
    client.identityAuthScope = tokenResponse.scope || identityScope;
    client.identityAuthIssuedAt = Math.floor(Date.now() / 1000);

    // Clear PKCE data
    delete client.identityAuthCodeVerifier;
    delete client.identityAuthState;

    await provider.Client.adapter.upsert(client.clientId, client.metadata());

    logger.debug('Exchanged authorization code for tokens', {
      clientId: client.clientId,
      hasRefreshToken: !!tokenResponse.refreshToken,
    });

    return tokenResponse;
  } catch (error) {
    logger.error('Failed to exchange authorization code', {
      error: (error as Error).message,
      clientId: client.clientId,
    });
    throw error;
  }
}

/**
 * Refresh identity tokens using refresh token
 */
export async function refreshIdentityToken(
  provider: Provider,
  authProxyClient: AuthProxyClient
): Promise<TokenResponse> {
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
    authProxyClient.identityAuthTokenType = 'Bearer';
    authProxyClient.identityAuthScope = tokenResponse.scope || identityScope;
    authProxyClient.identityAuthIssuedAt = Math.floor(Date.now() / 1000);

    // Update database
    await provider.Client.adapter.upsert(authProxyClient.clientId, authProxyClient.metadata());

    logger.info('Successfully refreshed identity token', {
      clientId: authProxyClient.clientId,
      hasNewRefreshToken: !!tokenResponse.refreshToken,
    });

    return tokenResponse;
  } catch (error) {
    logger.error('Failed to refresh identity token', {
      error: (error as Error).message,
      clientId: authProxyClient.clientId,
      errorType: (error as Error).constructor.name,
    });
    throw error;
  }
}

/**
 * Export callback paths
 */
export { identityCallbackPath, identityUniqueCallbackPath };

/**
 * Legacy compatibility exports - these would be populated after init
 */
export function getIdentityScope(): string {
  return identityScope;
}

export function getOidcAdapter(): OIDCProviderAdapter | null {
  return oidcAdapter;
}

