/**
 * Interaction Routes with OAuth Provider Adapter Integration
 *
 * Handles OAuth interaction flows using the OIDC provider adapter
 */

import type { Application, Request, Response, NextFunction, RequestHandler } from 'express';
import type { Provider } from 'oidc-provider';
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
 * Client interface with identity auth fields
 */
interface AuthProxyClient {
  clientId: string;
  identityAuthId?: string;
  identityLoginConfirmed?: boolean;
  identityAuthCodeVerifier?: string;
  identityAuthState?: string;
  metadata(): Record<string, unknown>;
}

/**
 * Setup interaction routes for OAuth flows
 */
export default (app: Application, provider: Provider): void => {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view: string, locals?: Record<string, unknown>) => {
      app.render(view, locals || {}, (err: Error | null, html?: string) => {
        if (err) throw err;
        orig.call(res, '_layout', {
          ...(locals || {}),
          body: html,
          branding: getBrandingConfig(),
        });
      });
    };
    next();
  });

  function setNoCache(req: Request, res: Response, next: NextFunction): void {
    res.set('cache-control', 'no-store');
    next();
  }

  app.get(
    '/interaction/:uid',
    setNoCache as RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { uid, prompt, params, session } = await provider.interactionDetails(req, res);

        const client = (await provider.Client.find(params.client_id as string)) as AuthProxyClient;

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
              BASE_URL || ''
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
    }
  );

  app.post(
    '/interaction/:uid/confirm-login',
    setNoCache as RequestHandler,
    body,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { uid, prompt, params, session } = await provider.interactionDetails(req, res);
        assert.equal(prompt.name, 'confirm-login');

        const isConfirmed = req.body.confirmed == 'true';
        let result = {};

        if (isConfirmed) {
          const client = (await provider.Client.find(
            params.client_id as string
          )) as AuthProxyClient;
          client.identityLoginConfirmed = isConfirmed;
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
    }
  );

  app.get(
    identityCallbackPath,
    setNoCache as RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const interaction = await provider.Interaction.find(req.query.state as string);
        if (!interaction) {
          throw new Error('Interaction not found from callback "state" param');
        }

        const originalQuerystring = new URL(req.originalUrl, BASE_URL || '').search;
        const next_url = new URL(
          `/interaction/${interaction.jti}/identity/callback${originalQuerystring}`,
          BASE_URL || ''
        );

        res.redirect(next_url.href);
      } catch (err) {
        return next(err);
      }
    }
  );

  app.get(
    identityUniqueCallbackPath,
    setNoCache as RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { uid, prompt, params, session, grantId } = await provider.interactionDetails(
          req,
          res
        );

        const client = (await provider.Client.find(params.client_id as string)) as AuthProxyClient;

        // Extract authorization code from callback
        const code = req.query.code as string;
        if (!code) {
          throw new Error('No authorization code received in callback');
        }

        // Build callback URL for token exchange
        const url = new URL(req.originalUrl, BASE_URL || '');
        const originalQuerystring = url.search;
        const originalCallbackPath = `${identityCallbackPath}${originalQuerystring}`;
        const identityCallbackUrl = new URL(originalCallbackPath, BASE_URL || '');

        // Use adapter-based code exchange
        const tokenResponse = await exchangeIdentityCode(
          provider,
          client,
          code,
          identityCallbackUrl.href
        );

        const tokenId =
          (tokenResponse.userData?.id as string) || (tokenResponse.userData?.user_id as string);
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
          grant = await provider.Grant.find(grantId as string);
        } else {
          grant = new provider.Grant({
            accountId: tokenId,
            clientId: params.client_id as string,
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
    }
  );

  app.get(
    '/interaction/:uid/abort',
    setNoCache as RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = {
          error: 'access_denied',
          error_description: 'End-User aborted interaction',
        };
        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      } catch (err) {
        next(err);
      }
    }
  );

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
