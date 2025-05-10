/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { urlencoded } from 'express'; // eslint-disable-line import/no-unresolved

import Account from './account.js';
import { 
  identityClient, 
  generateIdentityAuthUrl, 
  identityProviderMetadata,
  IDENTITY_CALLBACK_PATH,
  IDENTITY_UNIQUE_CALLBACK_PATH 
} from './identity-client.js';
import { errors } from 'oidc-provider';

const {
  BASE_URL
} = process.env;

const body = urlencoded({ extended: false });

const keys = new Set();
const debug = (obj) => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
  keys.add(key);
  if (isEmpty(value)) return acc;
  acc[key] = inspect(value, { depth: null });
  return acc;
}, {}), '<br/>', ': ', {
  encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value; },
});
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
        case 'login': {
          const identity_auth_url = await generateIdentityAuthUrl(req.params.uid, provider, client);
          return res.redirect(identity_auth_url);
        }
        default:
          throw new Error(`Expected "login" prompt, but "${prompt.name}" was requested. Reasons: ${prompt.reasons}, ${JSON.stringify(prompt.details)}`);
      }
    } catch (err) {
      return next(err);
    }
  });

  app.get(IDENTITY_CALLBACK_PATH, setNoCache, async (req, res, next) => {
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

  app.get(IDENTITY_UNIQUE_CALLBACK_PATH, setNoCache, async (req, res, next) => {
    try {
      const {
        uid, prompt, params, session, grantId,
      } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      // Fetch tokens for the authenticated primary Identity
      const originalQuerystring = URL.parse(req.originalUrl, BASE_URL).search;
      const originalCallbackPath = `${IDENTITY_CALLBACK_PATH}${originalQuerystring}`;
      const identityCallbackUrl = new URL(originalCallbackPath, BASE_URL);
      let tokens = await identityClient.authorizationCodeGrant(
        identityProviderMetadata, 
        identityCallbackUrl, 
        {
          pkceCodeVerifier: client['identity_auth_code_verifier'],
          expectedState: client['identity_auth_state']
        }
      );
      client['identity_auth_access_token'] = tokens.access_token;
      client['identity_auth_refresh_token'] = tokens.refresh_token;
      client['identity_auth_signature'] = tokens.signature;
      client['identity_auth_scope'] = tokens.scope;
      client['identity_auth_id_token'] = tokens.id_token;
      client['identity_auth_instance_url'] = tokens.instance_url;
      client['identity_auth_id'] = tokens.id;
      client['identity_auth_token_type'] = tokens.token_type;
      client['identity_auth_issued_at'] = tokens.issued_at;
      await provider.Client.adapter.upsert(client.clientId, client.metadata());

      // Set consent for auth proxy access (the user already gave consent for their primary auth)
      let grant;
      if (grantId) {
        grant = await provider.Grant.find(grantId);
      } else {
        grant = new provider.Grant({
          accountId: tokens.id,
          clientId: params.client_id
        });
      }

      // Pass-through scopes of the primary Identity access
      grant.addOIDCScope(tokens.scope);

      const savedGrantId = await grant.save();

      // See user flow docs
      // https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#user-flows
      const result = {
        login: {
          accountId: tokens.id,
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
