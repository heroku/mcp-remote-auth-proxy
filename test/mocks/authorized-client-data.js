// Seed data for tests to make a fully authorized client.

const issued = new Date();
const expiry = new Date();
expiry.setDate(expiry.getDate() + 1);

// "oidc:Client:GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-"
const clientData = JSON.parse(`{"application_type":"native","grant_types":["authorization_code","refresh_token"],"id_token_signed_response_alg":"Ed25519","require_auth_time":false,"response_types":["code"],"subject_type":"public","token_endpoint_auth_method":"none","post_logout_redirect_uris":[],"require_pushed_authorization_requests":false,"dpop_bound_access_tokens":false,"client_id_issued_at":${issued.getTime()},"client_id":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-","client_name":"MCP CLI Proxy","client_uri":"https://github.com/modelcontextprotocol/mcp-cli","redirect_uris":["http://127.0.0.1:3334/oauth/callback"],"identityLoginConfirmed":true,"identityAuthCodeVerifier":"Q-5fI4srPrtSB3EtOvibkMSAF7F7hYP7_V2QcllmiHw","identityAuthState":"LTj4xas33iv67VurMMFK7IEsSE1DhhCBPJcKx06nyFw","identityAuthAccessToken":"test_identity_access_token","identityAuthRefreshToken":"test_identity_refresh_token","identityAuthScope":"global","identityAuthId":"test_auth_identity","identityAuthTokenType":"bearer","identityAuthExpiresIn":28799,"identityAuthSessionNonce":null}`);

// "oidc:Grant:2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp"
const grantData = JSON.parse(`{"iat":${issued.getTime()},"exp":${expiry.getTime()},"accountId":"test_auth_identity","clientId":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-","kind":"Grant","jti":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp","openid":{"scope":"openid offline_access"}}`);

// "oidc:Interaction:LTj4xas33iv67VurMMFK7IEsSE1DhhCBPJcKx06nyFw"
const interactionData = JSON.parse(`{"iat":1749164771,"exp":${expiry.getTime()},"returnTo":"http://localhost:3001/auth/LTj4xas33iv67VurMMFK7IEsSE1DhhCBPJcKx06nyFw","prompt":{"name":"login","reasons":["no_session"],"details":{}},"lastSubmission":{"confirm-login":{"confirmed":true}},"params":{"client_id":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-","code_challenge":"vhFpUu8KpfoFrxhlKCW8HdD06ZAdosgFgRpg6GlhqWY","code_challenge_method":"S256","redirect_uri":"http://127.0.0.1:3334/oauth/callback","response_type":"code","scope":"openid offline_access"},"trusted":[],"cid":"dMmGgysbTbm3SaPHPPA_sMzG_J6j7KAlZleyi4D0niJ","kind":"Interaction","jti":"LTj4xas33iv67VurMMFK7IEsSE1DhhCBPJcKx06nyFw","result":{"confirm-login":{"confirmed":true},"login":{"accountId":"test_auth_identity","remember":true},"consent":{"grantId":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp"}}}`);

// "oidc:AuthorizationCode:QBrMa2bEQoHO5funO6dpgCl1rOTwOfNWMyPfsoG7Neu" "payload" 
const authorizationCodePayloadData = JSON.parse(`{"iat":${issued.getTime()},"exp":1749164832,"accountId":"test_auth_identity","authTime":${issued.getTime()},"codeChallenge":"vhFpUu8KpfoFrxhlKCW8HdD06ZAdosgFgRpg6GlhqWY","codeChallengeMethod":"S256","grantId":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp","redirectUri":"http://127.0.0.1:3334/oauth/callback","scope":"openid offline_access","sessionUid":"sikg7Dhu0Nxdv3XkSNLBuQlPGZfZXutD3bfltoBZbPP","kind":"AuthorizationCode","jti":"QBrMa2bEQoHO5funO6dpgCl1rOTwOfNWMyPfsoG7Neu","clientId":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-"}`);

// "oidc:Session:bbOVQvLP0d74o53GkyHR6cdXdjHVD-6ULu3SWwm-cvq"
const sessionData = JSON.parse(`{"iat":1749164738,"exp":${expiry.getTime()},"uid":"sikg7Dhu0Nxdv3XkSNLBuQlPGZfZXutD3bfltoBZbPP","kind":"Session","jti":"bbOVQvLP0d74o53GkyHR6cdXdjHVD-6ULu3SWwm-cvq","accountId":"test_auth_identity","loginTs":${issued.getTime()},"authorizations":{"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-":{"sid":"w02Kr5WIAZjUVojkeoLXYSJV9IGQ9pej7wCqEulwwkJ","grantId":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp","persistsLogout":true}}}`);

// "oidc:AccessToken:AkzhnLBmPVrp8QEhRiXgTjWom9lGb-O6za94WpYU3Ab"
const accessTokenData = JSON.parse(`{"iat":${issued.getTime()},"exp":${expiry.getTime()},"accountId":"test_auth_identity","grantId":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp","gty":"authorization_code","sessionUid":"sikg7Dhu0Nxdv3XkSNLBuQlPGZfZXutD3bfltoBZbPP","kind":"AccessToken","jti":"AkzhnLBmPVrp8QEhRiXgTjWom9lGb-O6za94WpYU3Ab","clientId":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-","scope":"openid offline_access"}`);

// "oidc:RefreshToken:lD0XenIpdoiV06aj2avydHYRBmjb7xWzFH72m7HwnfN" "payload" 
const refreshTokenPayloadData = JSON.parse(`{"iat":${issued.getTime()},"exp":${expiry.getTime()},"accountId":"test_auth_identity","authTime":${issued.getTime()},"grantId":"2Ypv-rvVxWMzhXuRR5J-xC7TwrFxRtsP4tGz2g4WuIp","gty":"authorization_code","rotations":0,"scope":"openid offline_access","sessionUid":"sikg7Dhu0Nxdv3XkSNLBuQlPGZfZXutD3bfltoBZbPP","kind":"RefreshToken","jti":"lD0XenIpdoiV06aj2avydHYRBmjb7xWzFH72m7HwnfN","clientId":"GIaajXo6t9q-VAq-98qDpjKIOs2h25HEw0QgddwChd-","iiat":${issued.getTime()}}`);

export {
  clientData,
  grantData,
  interactionData,
  authorizationCodePayloadData,
  sessionData,
  accessTokenData,
  refreshTokenPayloadData
}
