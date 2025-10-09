/**
 * Server integration for OIDC adapter
 *
 * This file integrates the adapter-based identity client into the server setup.
 * Version control is managed through the buildpack deployment process.
 */

import { identityClientInit } from './identity-client-adapter.js';
import { refreshIdentityToken } from './identity-client-adapter.js';
import useInteractionRoutes from './use-interaction-routes-adapter.js';
import logger from './logger.js';

/**
 * Initialize identity client with OIDC adapter
 */
export async function initializeIdentityClient(env, provider = null) {
  logger.info('Initializing identity client with OIDC adapter');

  await identityClientInit(env, provider);

  logger.info('Identity client initialized successfully');
}

/**
 * Set up interaction routes with adapter implementation
 */
export function setupInteractionRoutes(app, provider) {
  logger.info('Setting up interaction routes with adapter implementation');

  useInteractionRoutes(app, provider);

  logger.info('Interaction routes configured successfully');
}

/**
 * Get the refresh function for token refresh operations
 */
export function getRefreshFunction() {
  return refreshIdentityToken;
}

/**
 * Validate environment configuration for adapter implementation
 */
export function validateEnvironmentConfig(env) {
  const requiredVars = [
    'IDENTITY_CLIENT_ID',
    'IDENTITY_CLIENT_SECRET',
    'IDENTITY_SERVER_URL',
    'BASE_URL'
  ];

  const missing = requiredVars.filter(varName => !env[varName]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  logger.info('Environment configuration validated');

  // The adapter will validate the redirect URI construction
  const redirectUri = `${env.BASE_URL}${env.IDENTITY_CALLBACK_PATH || '/interaction/identity/callback'}`;
  logger.debug('Adapter redirect URI configured', { redirectUri });

  return true;
}
