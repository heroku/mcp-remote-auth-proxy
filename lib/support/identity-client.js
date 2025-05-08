import * as identity_client from 'openid-client';

const {
  BASE_URL,
  IDENTITY_SERVER_URL,
  IDENTITY_CLIENT_ID,
  IDENTITY_CLIENT_SECRET,
  IDENTITY_SCOPE,
  IDENTITY_REDIRECT_PATH = '/interaction/identity/callback'
} = process.env;

let identity_provider_metadata = await identity_client.discovery(
  new URL(IDENTITY_SERVER_URL),
  IDENTITY_CLIENT_ID,
  IDENTITY_CLIENT_SECRET,
);

// Based on https://github.com/panva/openid-client?tab=readme-ov-file#authorization-code-flow
async function generate_identity_auth_url(auth_proxy_provider, auth_proxy_client) {
  let redirect_uri = BASE_URL + IDENTITY_REDIRECT_PATH;
  /**
   * PKCE: The following MUST be generated for every redirect to the
   * authorization_endpoint. You must store the code_verifier and state in the
   * end-user session such that it can be recovered as the user gets redirected
   * from the authorization server back to your application.
   */
  let code_verifier = identity_client.randomPKCECodeVerifier()
  let code_challenge = await identity_client.calculatePKCECodeChallenge(code_verifier);
  let state;

  let parameters = {
    redirect_uri,
    IDENTITY_SCOPE,
    code_challenge,
    code_challenge_method: 'S256',
  };

  if (!identity_provider_metadata.serverMetadata().supportsPKCE()) {
    /**
     * We cannot be sure the server supports PKCE so we're going to use state too.
     * Use of PKCE is backwards compatible even if the AS doesn't support it which
     * is why we're using it regardless. Like PKCE, random state must be generated
     * for every redirect to the authorization_endpoint.
     */
    state = identity_client.randomState();
    parameters.state = state;
  }

  auth_proxy_client['identity_auth_code_verifier'] = code_verifier;
  auth_proxy_client['identity_auth_state'] = state;
  await auth_proxy_provider.Client.adapter.upsert(
    auth_proxy_client.clientId, auth_proxy_client.metadata());

  let redirectTo = identity_client.buildAuthorizationUrl(identity_provider_metadata, parameters);

  return redirectTo.href;
}

export { 
  identity_client, 
  identity_provider_metadata, 
  generate_identity_auth_url, 
  IDENTITY_REDIRECT_PATH 
};
