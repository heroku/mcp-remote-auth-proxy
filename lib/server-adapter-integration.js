/**
 * Server integration for OIDC adapter
 *
 * This file integrates the adapter-based identity client into the server setup.
 * Version control is managed through the buildpack deployment process.
 * @module server-adapter-integration
 */

/**
 * @typedef {import('express').Application} Application
 * @typedef {import('oidc-provider').Provider} Provider
 * @typedef {import('@heroku/oauth-provider-adapters-for-mcp').TokenResponse} TokenResponse
 */

/**
 * Environment configuration for adapter initialization
 * @typedef {Object} AdapterEnvironment
 * @property {string} [IDENTITY_CLIENT_ID]
 * @property {string} [IDENTITY_CLIENT_SECRET]
 * @property {string} [IDENTITY_SERVER_URL]
 * @property {string} [IDENTITY_SERVER_METADATA_FILE]
 * @property {string} [IDENTITY_SCOPE]
 * @property {string} [BASE_URL]
 * @property {string} [IDENTITY_CALLBACK_PATH]
 */

/**
 * Auth proxy client interface
 * @typedef {Object} AuthProxyClient
 * @property {string} clientId
 * @property {string} [identityAuthRefreshToken]
 * @property {() => import('oidc-provider').ClientMetadata} metadata
 */

import { identityClientInit } from './identity-client-adapter.js';
import { refreshIdentityToken } from './identity-client-adapter.js';
import useInteractionRoutes from './use-interaction-routes-adapter.js';
import logger from './logger.js';

/**
 * Initialize identity client with OIDC adapter
 * @param {AdapterEnvironment} env - Environment configuration
 * @param {Provider | null} [provider=null] - Optional OIDC provider instance
 * @returns {Promise<void>}
 */
export async function initializeIdentityClient(env, provider = null) {
  logger.info('Initializing identity client with OIDC adapter');

  await identityClientInit(env, provider);

  logger.info('Identity client initialized successfully');
}

/**
 * Set up interaction routes with adapter implementation
 * @param {Application} app - Express application instance
 * @param {Provider} provider - OIDC provider instance
 * @returns {void}
 */
export function setupInteractionRoutes(app, provider) {
  logger.info('Setting up interaction routes with adapter implementation');

  useInteractionRoutes(app, provider);

  logger.info('Interaction routes configured successfully');
}

/**
 * Get the refresh function for token refresh operations
 * @returns {(provider: Provider, client: AuthProxyClient) => Promise<TokenResponse>} Token refresh function
 */
export function getRefreshFunction() {
  return refreshIdentityToken;
}

/**
 * Validate environment configuration for adapter implementation
 * @param {AdapterEnvironment} env - Environment configuration to validate
 * @returns {boolean} True if validation passes
 * @throws {Error} If required variables are missing
 */
export function validateEnvironmentConfig(env) {
  const requiredVars = [
    'IDENTITY_CLIENT_ID',
    'IDENTITY_CLIENT_SECRET',
    'IDENTITY_SERVER_URL',
    'BASE_URL',
  ];

  const missing = requiredVars.filter((varName) => !env[varName]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  logger.info('Environment configuration validated');

  // The adapter will validate the redirect URI construction
  const redirectUri = `${env.BASE_URL}${env.IDENTITY_CALLBACK_PATH || '/interaction/identity/callback'}`;
  logger.debug('Adapter redirect URI configured', { redirectUri });

  return true;
}
