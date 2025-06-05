/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { urlencoded } from 'express'; // eslint-disable-line import/no-unresolved

import provider_config from './provider-config.js';
import { 
  identityClient, 
  identityScope, 
  generateIdentityAuthUrl, 
  identityProviderMetadata,
  identityCallbackPath,
  identityUniqueCallbackPath 
} from './identity-client.js';
import { errors } from 'oidc-provider';

const {
  BASE_URL,
  IDENTITY_SERVER_URL
} = process.env;

const body = urlencoded({ extended: false });

const { SessionNotFound } = errors;
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
        });
      });
    };
    next();
  });

  function setNoCache(req, res, next) {
    res.set('cache-control', 'no-store');
    next();
  }

  app.get('/interaction/:uid', setNoCache, async (req, res, next) => {
    try {
      const {
        uid, prompt, params, session,
      } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      switch (prompt.name) {
        case 'confirm-login': {
          return res.render('confirm-login', {
            client,
            uid,
            details: prompt.details,
            params,
            title: 'Confirm Login',
            identityServerUrl: IDENTITY_SERVER_URL
          });
        }
        case 'login': {
          const identity_auth_url = await generateIdentityAuthUrl(req.params.uid, provider, client, BASE_URL);
          return res.redirect(identity_auth_url);
        }
        default:
          throw new Error(`"${prompt.name}" was requested, but does not exist. Reasons: ${prompt.reasons}, ${JSON.stringify(prompt.details)}`);
      }
    } catch (err) {
      return next(err);
    }
  });

  app.post('/interaction/:uid/confirm-login', setNoCache, body, async (req, res, next) => {
    try {
      const {
        uid, prompt, params, session,
      } = await provider.interactionDetails(req, res);
      assert.equal(prompt.name, 'confirm-login');

      const isConfirmed = req.body.confirmed == 'true';
      let result = {};

      if (isConfirmed) {
        const client = await provider.Client.find(params.client_id);
        client['identityLoginConfirmed'] = isConfirmed;
        await provider.Client.adapter.upsert(client.clientId, client.metadata());
        result = {
          'confirm-login': {
            confirmed: isConfirmed
          }
        };
      }
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  app.get(identityCallbackPath, setNoCache, async (req, res, next) => {
    try {
      const interaction = await provider.Interaction.find(req.query.state);
      if (!interaction) {
        throw new Error('Interaction not found from callback "state" param');
      }

      const originalQuerystring = URL.parse(req.originalUrl, BASE_URL).search;
      const next_url = new URL(`/interaction/${interaction.jti}/identity/callback${originalQuerystring}`, BASE_URL);
      
      res.redirect(next_url);
    } catch (err) {
      return next(err);
    }
  });

  app.get(identityUniqueCallbackPath, setNoCache, async (req, res, next) => {
    try {
      const {
        uid, prompt, params, session, grantId,
      } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      // Fetch tokens for the authenticated primary Identity
      const originalQuerystring = URL.parse(req.originalUrl, BASE_URL).search;
      const originalCallbackPath = `${identityCallbackPath}${originalQuerystring}`;
      const identityCallbackUrl = new URL(originalCallbackPath, BASE_URL);
      let tokens = await identityClient.authorizationCodeGrant(
        identityProviderMetadata, 
        identityCallbackUrl, 
        {
          pkceCodeVerifier: client['identityAuthCodeVerifier'],
          expectedState: client['identityAuthState']
        }
      );

      const tokenId = tokens.id || tokens.user_id;
      if (!tokenId) {
        throw new Error('access token must contain either "id" or "user_id"');
      }

      const tokenScope = tokens.scope && tokens.scope != '' ? tokens.scope : identityScope;

      client['identityAuthAccessToken'] = tokens.access_token;
      client['identityAuthRefreshToken'] = tokens.refresh_token;
      client['identityAuthSignature'] = tokens.signature;
      client['identityAuthScope'] = tokenScope;
      client['identityAuthIdToken'] = tokens.id_token;
      client['identityAuthInstanceUrl'] = tokens.instance_url;
      client['identityAuthId'] = tokenId;
      client['identityAuthTokenType'] = tokens.token_type;
      client['identityAuthIssuedAt'] = tokens.issued_at;
      client['identityAuthExpiresIn'] = tokens.expires_in;
      client['identityAuthSessionNonce'] = tokens.session_nonce;
      await provider.Client.adapter.upsert(client.clientId, client.metadata());

      // Set consent for auth proxy access (the user already gave consent for their primary auth)
      let grant;
      if (grantId) {
        grant = await provider.Grant.find(grantId);
      } else {
        grant = new provider.Grant({
          accountId: tokenId,
          clientId: params.client_id
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
          remember: true
        },
        consent: {
          grantId: savedGrantId
        }
      };

      await provider.interactionFinished(req, res, result);
    } catch (err) {
      return next(err);
    }
  });

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
    if (err instanceof SessionNotFound) {
      // handle interaction expired / session not found error
    }
    next(err);
  });
};
