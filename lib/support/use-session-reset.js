
import providerConfig from './provider-config.js';

let sessionResetUrl;
let sessionResetDoneUrl;

// Call this before redirecting into sessionResetUrl
export async function destroyAccess(provider, accessToken) {
  await provider.Client.adapter.destroy(accessToken.clientId);
  await provider.Grant.adapter.destroy(accessToken.grantId);
  await provider.AccessToken.adapter.destroy(accessToken.jti);

  const session = await provider.Session.adapter.findByUid(accessToken.sessionUid);
  await provider.Session.adapter.destroy(session.jti);
}

// Two-step redirect to clear cookies and respond with 401
export function useSessionReset(app, authServerUrl) {
  sessionResetUrl = new URL('/session/reset', authServerUrl);
  sessionResetDoneUrl = new URL('/session/reset/done', authServerUrl);

  if (!providerConfig?.cookies?.names) {
    throw new Error('OIDC provider config must include cookies.names');
  }

  app.get(sessionResetUrl.pathname, (req, res, next) => {
    for (const name in providerConfig.cookies.names) {
      res.clearCookie(name, { httpOnly: true, secure: true });
    };
    res.redirect(sessionResetDoneUrl);
  });

  app.get(sessionResetDoneUrl.pathname, (req, res, next) => {
    res.set('WWW-Authenticate', 'Bearer error="invalid_client", error_description="Session reset');
    res.status(401).json({
      error: 'invalid_client',
      error_description: "Session reset"
    });
  });
}

export function getSessionResetUrl() {
  return sessionResetUrl;
}
