import * as identityClient from 'openid-client';

const {
  BASE_URL,
  IDENTITY_SERVER_URL,
  IDENTITY_CLIENT_ID,
  IDENTITY_CLIENT_SECRET,
  IDENTITY_SCOPE,
  IDENTITY_CALLBACK_PATH = '/interaction/identity/callback',
  IDENTITY_UNIQUE_CALLBACK_PATH = '/interaction/:uid/identity/callback'
} = process.env;

let identityProviderMetadata = await identityClient.discovery(
  new URL(IDENTITY_SERVER_URL),
  IDENTITY_CLIENT_ID,
  IDENTITY_CLIENT_SECRET,
);

// Based on https://github.com/panva/openid-client?tab=readme-ov-file#authorization-code-flow
async function generateIdentityAuthUrl(interaction_id, auth_proxy_provider, auth_proxy_client) {
  let redirect_url = new URL(IDENTITY_CALLBACK_PATH, BASE_URL);
  /**
   * PKCE: The following MUST be generated for every redirect to the
   * authorization_endpoint. You must store the code_verifier and state in the
   * end-user session such that it can be recovered as the user gets redirected
   * from the authorization server back to your application.
   */
  let code_verifier = identityClient.randomPKCECodeVerifier()
  let code_challenge = await identityClient.calculatePKCECodeChallenge(code_verifier);
  let state;

  let parameters = {
    redirect_uri: redirect_url.href,
    IDENTITY_SCOPE,
    code_challenge,
    code_challenge_method: 'S256',
    state: interaction_id
  };
  // Using "state: interaction_id" in these params, so that we can always redirect 
  // generic callback URL to the Interaction-specific path, so that the session 
  // cookie will resume effect.
  //
  // Therefore, skipping the following conditional random state stuff at this time…
  // if (!identityProviderMetadata.serverMetadata().supportsPKCE()) {
  //   /**
  //    * We cannot be sure the server supports PKCE so we're going to use state too.
  //    * Use of PKCE is backwards compatible even if the AS doesn't support it which
  //    * is why we're using it regardless. Like PKCE, random state must be generated
  //    * for every redirect to the authorization_endpoint.
  //    */
  //   state = identityClient.randomState();
  //   parameters.state = state;
  // }

  auth_proxy_client['identity_auth_code_verifier'] = code_verifier;
  auth_proxy_client['identity_auth_state'] = parameters.state;
  await auth_proxy_provider.Client.adapter.upsert(
    auth_proxy_client.clientId, auth_proxy_client.metadata());

  let redirectTo = identityClient.buildAuthorizationUrl(identityProviderMetadata, parameters);

  return redirectTo.href;
}

export { 
  identityClient, 
  identityProviderMetadata, 
  generateIdentityAuthUrl, 
  IDENTITY_CALLBACK_PATH,
  IDENTITY_UNIQUE_CALLBACK_PATH 
};
