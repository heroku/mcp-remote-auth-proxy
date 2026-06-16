// Integration test for the prompt=consent fix.
//
// Background: Claude Desktop's MCP Custom Connector flow appends `prompt=consent`
// to the OAuth authorization request. Before the fix, oidc-provider rejected the
// request with `invalid_request` ("unsupported prompt value requested") because
// `policy.remove('consent')` had stripped the consent prompt from the supported
// set (see configuration.js#collectPrompts). The fix re-registers a no-op
// consent prompt so `prompt=consent` is accepted while still skipping any
// consent UI (Heroku Identity collects consent upstream).
//
// This test exercises the real `/auth` endpoint via `provider.callback()` to
// verify the spec-compatibility regression cannot reappear.

import assert from 'node:assert';
import http from 'node:http';
import { URLSearchParams } from 'node:url';
import express from 'express';
import { Provider } from 'oidc-provider';

import providerConfig from '../lib/provider-config.js';
import { clientData } from './mocks/authorized-client-data.js';

describe('GET /auth with prompt parameter', function () {
  const env = process.env;
  const authProxyUrl = new URL(env.BASE_URL);

  let server;
  let provider;

  beforeEach(async function () {
    // Use the real provider config but drop the Redis-backed adapter so the
    // test runs on the in-memory adapter — same pattern as
    // mcp-server-proxy-test.js.
    const { adapter: _ignored, ...testProviderConfig } = providerConfig;
    provider = new Provider(authProxyUrl.href, testProviderConfig);

    // Seed a native PKCE client so /auth has a valid client_id to bind to.
    // identityLoginConfirmed=true (set in the fixture) lets the confirm-login
    // prompt resolve immediately, so the only interactions left to drive the
    // redirect are `login` (and, when requested, `consent`).
    await provider.Client.adapter.upsert(clientData.client_id, clientData);

    const app = express();
    app.use(provider.callback());

    await new Promise((resolve) => {
      server = app.listen(authProxyUrl.port, resolve);
    });
  });

  afterEach(function (done) {
    server.close((err) => (err ? done(err) : done()));
  });

  // PKCE values are arbitrary; the authorize endpoint only validates the
  // shape, not the verifier — there's no /token call in this test.
  const codeChallenge = 'vhFpUu8KpfoFrxhlKCW8HdD06ZAdosgFgRpg6GlhqWY';

  function buildAuthorizePath(extraParams = {}) {
    const params = new URLSearchParams({
      client_id: clientData.client_id,
      redirect_uri: clientData.redirect_uris[0],
      response_type: 'code',
      scope: 'openid offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'test-state',
      ...extraParams,
    });
    return `/auth?${params.toString()}`;
  }

  function get(path) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          protocol: authProxyUrl.protocol,
          hostname: authProxyUrl.hostname,
          port: authProxyUrl.port,
          path,
          method: 'GET',
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('redirects to /interaction/:uid when prompt=consent is requested', async function () {
    const res = await get(buildAuthorizePath({ prompt: 'consent' }));

    // Regression guard: before the fix this was a redirect back to the client
    // (clientData.redirect_uris[0]) with `error=invalid_request` and
    // `error_description=unsupported%20prompt%20value%20requested`.
    assert.equal(res.statusCode, 303, 'should redirect to interaction, not error');
    assert(res.headers.location, 'response must include a Location header');
    assert(
      res.headers.location.startsWith('/interaction/'),
      `expected redirect to /interaction/:uid, got ${res.headers.location}`
    );
    assert(
      !res.headers.location.includes('error=invalid_request'),
      'response must not redirect back to the client with error=invalid_request'
    );
  });

  it('redirects to /interaction/:uid with no prompt parameter (control)', async function () {
    const res = await get(buildAuthorizePath());

    assert.equal(res.statusCode, 303);
    assert(
      res.headers.location?.startsWith('/interaction/'),
      `expected redirect to /interaction/:uid, got ${res.headers.location}`
    );
  });

  it('redirects to /interaction/:uid when prompt=login is requested (control)', async function () {
    const res = await get(buildAuthorizePath({ prompt: 'login' }));

    assert.equal(res.statusCode, 303);
    assert(
      res.headers.location?.startsWith('/interaction/'),
      `expected redirect to /interaction/:uid, got ${res.headers.location}`
    );
  });
});
