import { Provider } from 'oidc-provider';
import providerConfig from './provider-config.js';

let providerInstanceConfig;
let sessionResetUrl;
let sessionResetDoneUrl;
let authServerBaseUrl; // Store for building OAuth recovery URLs

// Call this before redirecting into sessionResetUrl
export async function destroyAccess(provider, accessToken) {
  await provider.Grant.adapter.destroy(accessToken.grantId);
  await provider.AccessToken.adapter.destroy(accessToken.jti);

  const session = await provider.Session.adapter.findByUid(accessToken.sessionUid);
  if (session) {
    await provider.Session.adapter.destroy(session.jti);
  }
}

// Two-step redirect to clear cookies and respond with MCP-compliant recovery information
export function useSessionReset(app, authServerUrl, instanceConfig) {
  providerInstanceConfig = instanceConfig;
  authServerBaseUrl = authServerUrl; // Store for building recovery URLs
  sessionResetUrl = new URL('/session/reset', authServerUrl);
  sessionResetDoneUrl = new URL('/session/reset/done', authServerUrl);

  app.get(sessionResetUrl.pathname, (req, res, next) => {
    clearCookies(res);
    res.redirect(sessionResetDoneUrl);
  });

  app.get(sessionResetDoneUrl.pathname, (req, res, next) => {
    // Build OAuth recovery URLs using provider configuration
    const authorizationEndpoint = `${authServerBaseUrl.href.replace(/\/$/, '')}${providerConfig.routes.authorization}`;
    const resourceServerMetadataUri = `${authServerBaseUrl.href.replace(/\/$/, '')}/.well-known/oauth-protected-resource`;
    
    // MCP-compliant WWW-Authenticate header as required by specification
    // https://modelcontextprotocol.io/specification/draft/basic/authorization
    res.set('WWW-Authenticate', 
      `Bearer realm="mcp-auth-proxy", ` +
      `authorization_uri="${authorizationEndpoint}", ` +
      `resource_metadata="${resourceServerMetadataUri}"`
    );
    
    // Standard OAuth 2.0 error response with recovery information
    res.status(401).json({
      error: 'session_expired',
      error_description: 'Authentication session has expired and must be renewed',
      error_uri: `${authorizationEndpoint}?response_type=code&redirect_uri=${encodeURIComponent(`${authServerBaseUrl.href.replace(/\/$/, '')}/interaction/identity/callback`)}`
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
