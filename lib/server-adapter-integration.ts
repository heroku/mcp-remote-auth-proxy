/**
 * Server integration for OIDC adapter
 *
 * This file integrates the adapter-based identity client into the server setup.
 * Version control is managed through the buildpack deployment process.
 */

import type { Application } from 'express';
import type { Provider } from 'oidc-provider';
import { identityClientInit } from './identity-client-adapter.js';
import { refreshIdentityToken } from './identity-client-adapter.js';
import useInteractionRoutes from './use-interaction-routes-adapter.js';
import logger from './logger.js';

/**
 * Environment configuration for adapter initialization
 */
export interface AdapterEnvironment {
  IDENTITY_CLIENT_ID?: string;
  IDENTITY_CLIENT_SECRET?: string;
  IDENTITY_SERVER_URL?: string;
  IDENTITY_SERVER_METADATA_FILE?: string;
  IDENTITY_SCOPE?: string;
  BASE_URL?: string;
  IDENTITY_CALLBACK_PATH?: string;
  [key: string]: string | undefined;
}

/**
 * Initialize identity client with OIDC adapter
 * @param env - Environment configuration
 * @param provider - Optional OIDC provider instance
 */
export async function initializeIdentityClient(
  env: AdapterEnvironment,
  provider: Provider | null = null
): Promise<void> {
  logger.info('Initializing identity client with OIDC adapter');

  await identityClientInit(env, provider);

  logger.info('Identity client initialized successfully');
}

/**
 * Set up interaction routes with adapter implementation
 * @param app - Express application instance
 * @param provider - OIDC provider instance
 */
export function setupInteractionRoutes(app: Application, provider: Provider): void {
  logger.info('Setting up interaction routes with adapter implementation');

  useInteractionRoutes(app, provider);

  logger.info('Interaction routes configured successfully');
}

/**
 * Get the refresh function for token refresh operations
 * @returns Token refresh function
 */
export function getRefreshFunction(): typeof refreshIdentityToken {
  return refreshIdentityToken;
}

/**
 * Validate environment configuration for adapter implementation
 * @param env - Environment configuration to validate
 * @returns True if validation passes
 * @throws Error if required variables are missing
 */
export function validateEnvironmentConfig(env: AdapterEnvironment): boolean {
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

