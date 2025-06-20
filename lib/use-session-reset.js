import { Provider } from 'oidc-provider';
import providerConfig from './provider-config.js';

let providerInstanceConfig;
let sessionResetUrl;
let sessionResetDoneUrl;

// Call this before redirecting into sessionResetUrl
export async function destroyAccess(provider, accessToken) {
  await provider.Client.adapter.destroy(accessToken.clientId);
  await provider.Grant.adapter.destroy(accessToken.grantId);
  await provider.AccessToken.adapter.destroy(accessToken.jti);

  const session = await provider.Session.adapter.findByUid(accessToken.sessionUid);
  if (session) {
    await provider.Session.adapter.destroy(session.jti);
  }
}

// Two-step redirect to clear cookies and respond with 401
export function useSessionReset(app, authServerUrl, instanceConfig) {
  providerInstanceConfig = instanceConfig;
  sessionResetUrl = new URL('/session/reset', authServerUrl);
  sessionResetDoneUrl = new URL('/session/reset/done', authServerUrl);


  app.get(sessionResetUrl.pathname, (req, res, next) => {
    clearCookies(res);
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

export function clearCookies(res) {
  if (!providerInstanceConfig) {
    throw new Error('useSessionReset(app, authServerUrl, providerInstanceConfig) must be called to initialize this module');
  }
  for (const name in providerInstanceConfig.cookies.names) {
    res.clearCookie(providerInstanceConfig.cookies.names[name], providerInstanceConfig.cookies.long);
  };
}

export function getSessionResetUrl() {
  return sessionResetUrl;
}
