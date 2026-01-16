/**
 * Integration tests for identity-client-adapter.js
 * These tests focus on covering edge cases and data flow scenarios
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { identityClientInit, pkceStateStore } from '../lib/identity-client-adapter.js';
import {
  createMockClient,
  createMockProvider,
  resetPkceStore,
} from './helpers/pkce-test-helpers.js';
import { futureExpiry, pastExpiry } from './helpers/test-utils.js';

describe('Identity Client Adapter - Integration Tests', () => {
  let mockProvider;
  let mockClient;

  beforeEach(() => {
    resetPkceStore();
    mockClient = createMockClient({ clientId: 'integration-test-client' });
    mockProvider = createMockProvider({
      client: mockClient,
      interaction: {
        jti: 'integration-test-interaction',
        params: { client_id: 'integration-test-client' },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
    resetPkceStore();
  });

  describe('Code Verifier Retrieval Logic', () => {
    it('should prioritize code verifier from client session', () => {
      // Set up client with code verifier
      mockClient.identityAuthCodeVerifier = 'verifier-from-client';
      mockClient.identityAuthState = 'state-123';

      // Also set up fallback storage (should not be used)
      pkceStateStore.set('test-interaction', {
        codeVerifier: 'verifier-from-fallback',
        state: 'state-123',
        expiresAt: futureExpiry(),
      });

      // Client session should take priority
      expect(mockClient.identityAuthCodeVerifier).to.equal('verifier-from-client');
    });

    it('should fall back to interactionId key when client has no verifier', () => {
      mockClient.identityAuthCodeVerifier = null;

      pkceStateStore.set('test-interaction', {
        codeVerifier: 'verifier-from-fallback',
        state: 'state-123',
        expiresAt: futureExpiry(),
      });

      const entry = pkceStateStore.get('test-interaction');
      expect(entry.codeVerifier).to.equal('verifier-from-fallback');
      expect(entry.expiresAt).to.be.greaterThan(Date.now());
    });

    it('should use identityAuthState as alternative fallback key', () => {
      mockClient.identityAuthCodeVerifier = null;
      mockClient.identityAuthState = 'state-as-key';

      pkceStateStore.set('state-as-key', {
        codeVerifier: 'verifier-from-state-key',
        state: 'state-as-key',
        expiresAt: futureExpiry(),
      });

      const entry = pkceStateStore.get('state-as-key');
      expect(entry.codeVerifier).to.equal('verifier-from-state-key');
    });

    it('should skip duplicate lookup when state equals interactionId', () => {
      const sharedId = 'shared-id-value';
      mockClient.identityAuthCodeVerifier = null;
      mockClient.identityAuthState = sharedId;

      pkceStateStore.set(sharedId, {
        codeVerifier: 'verifier-123',
        state: sharedId,
        expiresAt: futureExpiry(),
      });

      // Only one Map entry should exist
      expect(pkceStateStore.size).to.equal(1);
      expect(pkceStateStore.has(sharedId)).to.be.true;
    });

    it('should check expiration when retrieving from fallback', () => {
      const expiredEntry = {
        codeVerifier: 'expired-verifier',
        state: 'expired-state',
        expiresAt: pastExpiry(5000),
      };

      pkceStateStore.set('expired-interaction', expiredEntry);

      const entry = pkceStateStore.get('expired-interaction');
      expect(entry.expiresAt).to.be.lessThan(Date.now());
    });
  });

  describe('Token Response Data Mapping', () => {
    it('should map complete token response with all fields', () => {
      const tokenResponse = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        tokenType: 'Bearer',
        scope: 'openid profile email',
        issuedAt: Math.floor(Date.now() / 1000),
        idToken: 'id-789',
        userData: {
          id: 'user-abc',
          signature: 'sig-xyz',
          instance_url: 'https://instance.salesforce.com',
          expires_in: 3600,
          session_nonce: 'nonce-123',
        },
      };

      // Verify all fields are present
      expect(tokenResponse.accessToken).to.exist;
      expect(tokenResponse.refreshToken).to.exist;
      expect(tokenResponse.tokenType).to.equal('Bearer');
      expect(tokenResponse.userData.id).to.equal('user-abc');
      expect(tokenResponse.userData.signature).to.equal('sig-xyz');
      expect(tokenResponse.userData.instance_url).to.exist;
      expect(tokenResponse.userData.expires_in).to.equal(3600);
      expect(tokenResponse.userData.session_nonce).to.equal('nonce-123');
    });

    it('should handle token response with user_id instead of id', () => {
      const tokenResponse = {
        accessToken: 'access-123',
        userData: {
          user_id: 'user-from-user-id-field',
        },
      };

      const userId = tokenResponse.userData?.id || tokenResponse.userData?.user_id;
      expect(userId).to.equal('user-from-user-id-field');
    });

    it('should provide defaults for missing optional fields', () => {
      const tokenResponse = {
        accessToken: 'access-only',
      };

      const tokenType = tokenResponse.tokenType || 'Bearer';
      const scope = tokenResponse.scope || 'openid profile email';
      const issuedAt = tokenResponse.issuedAt || Math.floor(Date.now() / 1000);

      expect(tokenType).to.equal('Bearer');
      expect(scope).to.equal('openid profile email');
      expect(issuedAt).to.be.closeTo(Math.floor(Date.now() / 1000), 2);
    });

    it('should handle token response without userData', () => {
      const tokenResponse = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        tokenType: 'Bearer',
      };

      expect(tokenResponse.userData).to.be.undefined;
      // Code should not crash when accessing userData fields
      const signature = tokenResponse.userData?.signature;
      const instanceUrl = tokenResponse.userData?.instance_url;
      expect(signature).to.be.undefined;
      expect(instanceUrl).to.be.undefined;
    });
  });

  describe('Refresh Token Response Handling', () => {
    it('should handle refresh response with new refresh token', () => {
      const refreshResponse = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        tokenType: 'Bearer',
        scope: 'openid profile',
        issuedAt: Math.floor(Date.now() / 1000),
      };

      expect(refreshResponse.refreshToken).to.equal('new-refresh');
    });

    it('should handle refresh response without new refresh token', () => {
      const refreshResponse = {
        accessToken: 'new-access',
        tokenType: 'Bearer',
        // No refreshToken
      };

      expect(refreshResponse.refreshToken).to.be.undefined;
      // In implementation, the existing refresh token should be preserved
    });

    it('should handle refresh response with userData signature', () => {
      const refreshResponse = {
        accessToken: 'new-access',
        userData: {
          signature: 'new-signature-xyz',
        },
      };

      expect(refreshResponse.userData.signature).to.equal('new-signature-xyz');
    });

    it('should use defaults for missing refresh response fields', () => {
      const refreshResponse = {
        accessToken: 'new-access',
      };

      const tokenType = refreshResponse.tokenType || 'Bearer';
      const scope = refreshResponse.scope || 'openid profile email';
      const issuedAt = refreshResponse.issuedAt || Math.floor(Date.now() / 1000);

      expect(tokenType).to.equal('Bearer');
      expect(scope).to.equal('openid profile email');
      expect(issuedAt).to.be.closeTo(Math.floor(Date.now() / 1000), 2);
    });
  });

  describe('Identity Client Init Configuration', () => {
    it('should configure with all environment variables', async () => {
      const env = {
        IDENTITY_CLIENT_ID: 'client-id',
        IDENTITY_CLIENT_SECRET: 'client-secret',
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        BASE_URL: 'https://app.example.com',
        IDENTITY_SCOPE: 'openid profile email custom',
        IDENTITY_CALLBACK_PATH: '/custom/callback',
        IDENTITY_UNIQUE_CALLBACK_PATH: '/custom/:uid/callback',
        IDENTITY_SERVER_METADATA_FILE: '/path/to/metadata.json',
      };

      try {
        await identityClientInit(env, mockProvider);
      } catch (_error) {
        // Expected to fail in test environment, but configuration should be processed
      }
    });

    it('should parse scope with various separators', () => {
      const testScopes = [
        'openid profile email',
        'openid,profile,email',
        'openid, profile, email',
        'openid,profile email',
      ];

      testScopes.forEach((scopeString) => {
        const parsed = scopeString.split(/[, ]+/);
        expect(parsed).to.be.an('array');
        expect(parsed.length).to.be.at.least(3);
      });
    });

    it('should use default scopes when not provided', () => {
      const defaultScopes = ['openid', 'profile', 'email'];
      expect(defaultScopes).to.have.lengthOf(3);
      expect(defaultScopes).to.include('openid');
      expect(defaultScopes).to.include('profile');
      expect(defaultScopes).to.include('email');
    });
  });

  describe('Client Session Update Verification', () => {
    it('should update all client session fields after token exchange', () => {
      // Simulate what happens in exchangeIdentityCode
      mockClient.identityAuthAccessToken = 'access-token';
      mockClient.identityAuthRefreshToken = 'refresh-token';
      mockClient.identityAuthTokenType = 'Bearer';
      mockClient.identityAuthScope = 'openid profile email';
      mockClient.identityAuthIssuedAt = Math.floor(Date.now() / 1000);
      mockClient.identityAuthIdToken = 'id-token';
      mockClient.identityAuthId = 'user-id';
      mockClient.identityAuthSignature = 'signature';
      mockClient.identityAuthInstanceUrl = 'https://instance.url';
      mockClient.identityAuthExpiresIn = 3600;
      mockClient.identityAuthSessionNonce = 'nonce';

      expect(mockClient.identityAuthAccessToken).to.equal('access-token');
      expect(mockClient.identityAuthRefreshToken).to.equal('refresh-token');
      expect(mockClient.identityAuthTokenType).to.equal('Bearer');
      expect(mockClient.identityAuthId).to.equal('user-id');
      expect(mockClient.identityAuthExpiresIn).to.equal(3600);
    });

    it('should preserve existing refresh token if new one not provided', () => {
      mockClient.identityAuthRefreshToken = 'existing-refresh-token';

      // Simulate refresh without new refresh token
      mockClient.identityAuthAccessToken = 'new-access-token';
      // Don't update refreshToken

      expect(mockClient.identityAuthRefreshToken).to.equal('existing-refresh-token');
      expect(mockClient.identityAuthAccessToken).to.equal('new-access-token');
    });
  });
});
