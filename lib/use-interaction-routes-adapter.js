/**
 * Interaction Routes with OAuth Provider Adapter Integration
 *
 * Handles OAuth interaction flows using the OIDC provider adapter
 * @module use-interaction-routes-adapter
 */

/**
 * @typedef {import('express').Application} Application
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('express').RequestHandler} RequestHandler
 * @typedef {import('oidc-provider').Provider} Provider
 * @typedef {import('oidc-provider').ClientMetadata} ClientMetadata
 * @typedef {import('@heroku/oauth-provider-adapters-for-mcp').TokenResponse} TokenResponse
 */

/**
 * Auth proxy client interface with identity auth fields
 * @typedef {Object} AuthProxyClient
 * @property {string} clientId
 * @property {string} [identityAuthId]
 * @property {boolean} [identityLoginConfirmed]
 * @property {string} [identityAuthCodeVerifier]
 * @property {string} [identityAuthState]
 * @property {() => ClientMetadata} metadata
 */

/**
 * Branding configuration
 * @typedef {Object} BrandingConfig
 * @property {string} [logoUrl]
 * @property {string} [primaryColor]
 * @property {string} [companyName]
 */

/* eslint-disable no-unused-vars */
import { strict as assert } from 'node:assert';
import { urlencoded } from 'express';

import provider_config from './provider-config.js';
import { createRequestLogger } from './logger.js';
import { getBrandingConfig } from './branding-config.js';
import {
  generateIdentityAuthUrl,
  exchangeIdentityCode,
  identityCallbackPath,
  identityUniqueCallbackPath,
} from './identity-client-adapter.js';
import { getSessionResetUrl } from './use-session-reset.js';
import { errors } from 'oidc-provider';

const { BASE_URL, IDENTITY_SERVER_URL } = process.env;

const body = urlencoded({ extended: false });

const { SessionNotFound, AccessDenied } = errors;

/**
 * Setup interaction routes for OAuth flows
 * @param {Application} app - Express application
 * @param {Provider} provider - OIDC provider instance
 * @returns {void}
 */
export default (app, provider) => {
  app.use((req, res, next) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view, locals) => {
      app.render(view, locals, (err, html) => {
        if (err) throw err;
        orig.call(res, '_layout', {
          ...locals,
          body: html,
          branding: getBrandingConfig(),
        });
      });
    };
    next();
  });

  function setNoCache(req, res, next) {
    res.set('cache-control', 'no-store');
    next();
  }

  /* c8 ignore start - ES module stubbing limitation
   * This route handler calls ES module exports (generateIdentityAuthUrl) that cannot be stubbed
   * in unit tests due to Sinon v21 limitations. These routes are comprehensively tested via
   * integration tests in test/server-test.js which exercise complete OAuth flows including:
   * - Full authorization flow with real oidc-provider interactions
   * - Token exchange and callback handling
   * - Error scenarios and edge cases
   * Attempting to add unit test coverage here would require significant test infrastructure
   * refactoring (dependency injection or CJS conversion) without providing additional value
   * beyond existing integration test coverage.
   */
  app.get('/interaction/:uid', setNoCache, async (req, res, next) => {
    try {
      const { uid, prompt, params, session } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      switch (prompt.name) {
      case 'confirm-login': {
        return res.render('confirm-login', {
          client,
          uid,
          details: prompt.details,
          params,
          title: 'Confirm Login',
          identityServerUrl: IDENTITY_SERVER_URL,
        });
      }
      case 'login': {
        // Use adapter-based auth URL generation
        const identity_auth_url = await generateIdentityAuthUrl(
          req.params.uid,
          provider,
          client,
          BASE_URL
        );
        return res.redirect(identity_auth_url);
      }
      default:
        throw new Error(
          `"${prompt.name}" was requested, but does not exist. Reasons: ${prompt.reasons}, ${JSON.stringify(prompt.details)}`
        );
      }
    } catch (err) {
      return next(err);
    }
  });
  /* c8 ignore stop */

  app.post('/interaction/:uid/confirm-login', setNoCache, body, async (req, res, next) => {
    try {
      const { uid, prompt, params, session } = await provider.interactionDetails(req, res);
      assert.equal(prompt.name, 'confirm-login');

      const isConfirmed = req.body.confirmed == 'true';
      let result = {};

      if (isConfirmed) {
        const client = await provider.Client.find(params.client_id);
        client['identityLoginConfirmed'] = isConfirmed;
        await provider.Client.adapter.upsert(client.clientId, client.metadata());
        result = {
          'confirm-login': {
            confirmed: isConfirmed,
          },
        };
      }
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  /* c8 ignore start - ES module stubbing limitation
   * These OAuth callback routes call ES module exports (exchangeIdentityCode) that cannot be
   * stubbed in unit tests due to Sinon v21 limitations. These critical callback flows are
   * comprehensively tested via integration tests in test/server-test.js which verify:
   * - Complete OAuth authorization code flow with PKCE
   * - Token exchange with real identity provider interactions
   * - Grant creation and scope management
   * - Session state management across redirects
   * - Error handling for missing codes, invalid states, etc.
   * The integration tests provide full coverage of these routes' behavior in realistic
   * scenarios. Unit testing these routes would require significant architectural changes
   * (dependency injection or conversion to CommonJS) without providing additional quality
   * assurance beyond what integration tests already verify.
   */
  app.get(identityCallbackPath, setNoCache, async (req, res, next) => {
    try {
      const interaction = await provider.Interaction.find(req.query.state);
      if (!interaction) {
        throw new Error('Interaction not found from callback "state" param');
      }

      const originalQuerystring = URL.parse(req.originalUrl, BASE_URL).search;
      const next_url = new URL(
        `/interaction/${interaction.jti}/identity/callback${originalQuerystring}`,
        BASE_URL
      );

      res.redirect(next_url);
    } catch (err) {
      return next(err);
    }
  });

  app.get(identityUniqueCallbackPath, setNoCache, async (req, res, next) => {
    try {
      const { uid, prompt, params, session, grantId } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      // Extract authorization code from callback
      const code = req.query.code;
      if (!code) {
        throw new Error('No authorization code received in callback');
      }

      // Build callback URL for token exchange
      const url = new URL(req.originalUrl, BASE_URL);
      const originalQuerystring = url.search;
      const originalCallbackPath = `${identityCallbackPath}${originalQuerystring}`;
      const identityCallbackUrl = new URL(originalCallbackPath, BASE_URL);

      // Use adapter-based code exchange
      const tokenResponse = await exchangeIdentityCode(
        provider,
        client,
        code,
        identityCallbackUrl.href
      );

      const tokenId = tokenResponse.userData?.id || tokenResponse.userData?.user_id;
      if (!tokenId) {
        throw new Error('access token must contain either "id" or "user_id"');
      }

      // Update the client session with the user ID
      if (!client.identityAuthId) {
        client.identityAuthId = tokenId;
        await provider.Client.adapter.upsert(client.clientId, client.metadata());
      }

      // Set consent for auth proxy access (the user already gave consent for their primary auth)
      let grant;
      if (grantId) {
        grant = await provider.Grant.find(grantId);
      } else {
        grant = new provider.Grant({
          accountId: tokenId,
          clientId: params.client_id,
        });
      }

      // Set configured scopes for the auth proxy, not the ones passed back from primary Identity
      grant.addOIDCScope(provider_config.scopes);
      const savedGrantId = await grant.save();

      // See user flow docs
      // https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#user-flows
      const result = {
        login: {
          accountId: tokenId,
          remember: true,
        },
        consent: {
          grantId: savedGrantId,
        },
      };

      await provider.interactionFinished(req, res, result);
    } catch (err) {
      return next(err);
    }
  });
  /* c8 ignore stop */

  app.get('/interaction/:uid/abort', setNoCache, async (req, res, next) => {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    if (err instanceof SessionNotFound || err instanceof AccessDenied) {
      const logger = createRequestLogger(req);
      logger.warn('Resetting session', {
        method: req.method,
        path: req.path,
        errorName: err.name,
        errorMessage: err.message,
      });
      return res.redirect(getSessionResetUrl());
    }
    next(err);
  });
};
