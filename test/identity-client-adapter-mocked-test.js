/**
 * Tests for identity-client-adapter.js using esmock for ES module mocking
 * These tests cover the actual implementation code paths with mocked dependencies
 */

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import {
  createMockClient,
  createMockProvider,
  resetPkceStore,
} from './helpers/pkce-test-helpers.js';
import { futureExpiry } from './helpers/test-utils.js';

describe('Identity Client Adapter - Mocked Implementation Tests', () => {
  let identityClientAdapter;
  let mockOidcAdapter;
  let mockProvider;
  let mockClient;

  beforeEach(async () => {
    // Create mock OIDC adapter with all required methods
    mockOidcAdapter = {
      generateAuthUrl: sinon.stub(),
      exchangeCode: sinon.stub(),
      refreshToken: sinon.stub(),
    };

    // Mock the @heroku/oauth-provider-adapters-for-mcp module
    identityClientAdapter = await esmock('../lib/identity-client-adapter.js', {
      '@heroku/oauth-provider-adapters-for-mcp': {
        fromEnvironmentAsync: sinon.stub().resolves(mockOidcAdapter),
        DefaultLogger: class {
          constructor() {}
        },
        LogLevel: { Info: 'info' },
      },
    });

    resetPkceStore();
    mockClient = createMockClient({ clientId: 'mock-test-client' });
    mockProvider = createMockProvider({
      client: mockClient,
      interaction: {
        jti: 'mock-test-interaction',
        params: { client_id: 'mock-test-client' },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
    resetPkceStore();
  });

  describe('generateIdentityAuthUrl with initialized adapter', () => {
    beforeEach(async () => {
      // Initialize the adapter first
      await identityClientAdapter.identityClientInit(
        {
          IDENTITY_CLIENT_ID: 'test-client',
          IDENTITY_CLIENT_SECRET: 'secret',
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          BASE_URL: 'https://app.example.com',
        },
        mockProvider
      );
    });

    it('should generate auth URL and log success', async () => {
      const testAuthUrl = 'https://auth.example.com/authorize?client_id=test&state=state123';
      mockOidcAdapter.generateAuthUrl.resolves(testAuthUrl);

      const result = await identityClientAdapter.generateIdentityAuthUrl(
        'test-interaction-id',
        mockProvider,
        mockClient,
        'https://app.example.com'
      );

      expect(result).to.equal(testAuthUrl);
      expect(mockOidcAdapter.generateAuthUrl.calledOnce).to.be.true;
      expect(
        mockOidcAdapter.generateAuthUrl.calledWith(
          'test-interaction-id',
          'https://app.example.com/interaction/identity/callback'
        )
      ).to.be.true;
    });

    it('should log error when auth URL generation fails', async () => {
      mockOidcAdapter.generateAuthUrl.rejects(new Error('Network timeout'));

      try {
        await identityClientAdapter.generateIdentityAuthUrl(
          'test-interaction-id',
          mockProvider,
          mockClient,
          'https://app.example.com'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('Network timeout');
      }
    });
  });

  describe('exchangeIdentityCode with initialized adapter', () => {
    beforeEach(async () => {
      await identityClientAdapter.identityClientInit(
        {
          IDENTITY_CLIENT_ID: 'test-client',
          IDENTITY_CLIENT_SECRET: 'secret',
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          BASE_URL: 'https://app.example.com',
        },
        mockProvider
      );
    });

    it('should exchange code with verifier from client session', async () => {
      const mockTokenResponse = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        tokenType: 'Bearer',
        scope: 'openid profile email',
        issuedAt: Math.floor(Date.now() / 1000),
        idToken: 'id-token-789',
        userData: {
          id: 'user-id-abc',
          signature: 'sig-xyz',
          instance_url: 'https://instance.salesforce.com',
          expires_in: 3600,
          session_nonce: 'nonce-123',
        },
      };

      mockClient.identityAuthCodeVerifier = 'code-verifier-from-session';
      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      const result = await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'authorization-code-123',
        'https://app.example.com/callback'
      );

      expect(result).to.deep.equal(mockTokenResponse);
      expect(mockOidcAdapter.exchangeCode.calledOnce).to.be.true;

      // Verify client session was updated with all token fields
      expect(mockClient.identityAuthAccessToken).to.equal('access-token-123');
      expect(mockClient.identityAuthRefreshToken).to.equal('refresh-token-456');
      expect(mockClient.identityAuthTokenType).to.equal('Bearer');
      expect(mockClient.identityAuthScope).to.equal('openid profile email');
      expect(mockClient.identityAuthIdToken).to.equal('id-token-789');
      expect(mockClient.identityAuthId).to.equal('user-id-abc');
      expect(mockClient.identityAuthSignature).to.equal('sig-xyz');
      expect(mockClient.identityAuthInstanceUrl).to.equal('https://instance.salesforce.com');
      expect(mockClient.identityAuthExpiresIn).to.equal(3600);
      expect(mockClient.identityAuthSessionNonce).to.equal('nonce-123');
      expect(mockProvider.Client.adapter.upsert.calledOnce).to.be.true;
    });

    it('should exchange code with verifier from fallback storage', async () => {
      const mockTokenResponse = {
        accessToken: 'access-token-fallback',
        refreshToken: 'refresh-token-fallback',
        tokenType: 'Bearer',
        scope: 'openid',
      };

      mockClient.identityAuthCodeVerifier = null;
      identityClientAdapter.pkceStateStore.set('fallback-interaction-id', {
        codeVerifier: 'verifier-from-fallback',
        state: 'state-123',
        expiresAt: futureExpiry(),
      });

      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      const result = await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'auth-code',
        'https://callback.example.com',
        'fallback-interaction-id'
      );

      expect(result).to.deep.equal(mockTokenResponse);
      expect(mockOidcAdapter.exchangeCode.calledWith('auth-code', 'verifier-from-fallback')).to.be
        .true;
      expect(identityClientAdapter.pkceStateStore.has('fallback-interaction-id')).to.be.false;
    });

    it('should handle token response with user_id instead of id', async () => {
      const mockTokenResponse = {
        accessToken: 'access-token-user-id',
        userData: {
          user_id: 'user-id-from-user_id-field',
        },
      };

      mockClient.identityAuthCodeVerifier = 'verifier-123';
      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'code',
        'https://callback.example.com'
      );

      expect(mockClient.identityAuthId).to.equal('user-id-from-user_id-field');
    });

    it('should handle token response without userData', async () => {
      const mockTokenResponse = {
        accessToken: 'access-token-no-userdata',
        refreshToken: 'refresh-token-no-userdata',
        tokenType: 'Bearer',
      };

      mockClient.identityAuthCodeVerifier = 'verifier-123';
      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      const result = await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'code',
        'https://callback.example.com'
      );

      expect(result.accessToken).to.equal('access-token-no-userdata');
      expect(mockClient.identityAuthSignature).to.be.undefined;
      expect(mockClient.identityAuthInstanceUrl).to.be.undefined;
    });

    it('should use default values for missing token response fields', async () => {
      const mockTokenResponse = {
        accessToken: 'minimal-token',
        // Missing: tokenType, scope, issuedAt
      };

      mockClient.identityAuthCodeVerifier = 'verifier-123';
      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'code',
        'https://callback.example.com'
      );

      expect(mockClient.identityAuthTokenType).to.equal('Bearer');
      expect(mockClient.identityAuthScope).to.equal('openid profile email');
      expect(mockClient.identityAuthIssuedAt).to.be.closeTo(Math.floor(Date.now() / 1000), 2);
    });

    it('should log error when token exchange fails', async () => {
      mockClient.identityAuthCodeVerifier = 'verifier-123';
      mockOidcAdapter.exchangeCode.rejects(new Error('Invalid authorization code'));

      try {
        await identityClientAdapter.exchangeIdentityCode(
          mockProvider,
          mockClient,
          'invalid-code',
          'https://callback.example.com'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('Invalid authorization code');
      }
    });
  });

  describe('refreshIdentityToken with initialized adapter', () => {
    beforeEach(async () => {
      await identityClientAdapter.identityClientInit(
        {
          IDENTITY_CLIENT_ID: 'test-client',
          IDENTITY_CLIENT_SECRET: 'secret',
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          BASE_URL: 'https://app.example.com',
        },
        mockProvider
      );
    });

    it('should refresh token successfully with new refresh token', async () => {
      const mockRefreshResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        scope: 'openid profile email',
        issuedAt: Math.floor(Date.now() / 1000),
        userData: {
          signature: 'new-signature',
        },
      };

      mockClient.identityAuthRefreshToken = 'old-refresh-token';
      mockOidcAdapter.refreshToken.resolves(mockRefreshResponse);

      const result = await identityClientAdapter.refreshIdentityToken(mockProvider, mockClient);

      expect(result).to.deep.equal(mockRefreshResponse);
      expect(mockOidcAdapter.refreshToken.calledOnce).to.be.true;
      expect(mockOidcAdapter.refreshToken.calledWith('old-refresh-token')).to.be.true;

      // Verify client session was updated
      expect(mockClient.identityAuthAccessToken).to.equal('new-access-token');
      expect(mockClient.identityAuthRefreshToken).to.equal('new-refresh-token');
      expect(mockClient.identityAuthTokenType).to.equal('Bearer');
      expect(mockClient.identityAuthScope).to.equal('openid profile email');
      expect(mockClient.identityAuthSignature).to.equal('new-signature');
      expect(mockProvider.Client.adapter.upsert.calledOnce).to.be.true;
    });

    it('should refresh token without updating refresh token if not provided', async () => {
      const mockRefreshResponse = {
        accessToken: 'new-access-token-only',
        tokenType: 'Bearer',
        scope: 'openid',
        // No refreshToken in response
      };

      mockClient.identityAuthRefreshToken = 'existing-refresh-token';
      mockOidcAdapter.refreshToken.resolves(mockRefreshResponse);

      await identityClientAdapter.refreshIdentityToken(mockProvider, mockClient);

      expect(mockClient.identityAuthAccessToken).to.equal('new-access-token-only');
      expect(mockClient.identityAuthRefreshToken).to.equal('existing-refresh-token');
    });

    it('should use default values for missing refresh response fields', async () => {
      const mockRefreshResponse = {
        accessToken: 'new-access',
        // Missing: tokenType, scope, issuedAt, userData
      };

      mockClient.identityAuthRefreshToken = 'refresh-token';
      mockOidcAdapter.refreshToken.resolves(mockRefreshResponse);

      await identityClientAdapter.refreshIdentityToken(mockProvider, mockClient);

      expect(mockClient.identityAuthTokenType).to.equal('Bearer');
      expect(mockClient.identityAuthScope).to.equal('openid profile email');
      expect(mockClient.identityAuthIssuedAt).to.be.closeTo(Math.floor(Date.now() / 1000), 2);
    });

    it('should handle refresh response with only signature in userData', async () => {
      const mockRefreshResponse = {
        accessToken: 'new-access',
        userData: {
          signature: 'only-signature',
        },
      };

      mockClient.identityAuthRefreshToken = 'refresh-token';
      mockOidcAdapter.refreshToken.resolves(mockRefreshResponse);

      await identityClientAdapter.refreshIdentityToken(mockProvider, mockClient);

      expect(mockClient.identityAuthSignature).to.equal('only-signature');
    });

    it('should log error when refresh fails', async () => {
      mockClient.identityAuthRefreshToken = 'invalid-refresh-token';
      mockOidcAdapter.refreshToken.rejects(new Error('Invalid refresh token'));

      try {
        await identityClientAdapter.refreshIdentityToken(mockProvider, mockClient);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('Invalid refresh token');
      }
    });
  });

  describe('exchangeIdentityCode with state-based fallback', () => {
    beforeEach(async () => {
      await identityClientAdapter.identityClientInit(
        {
          IDENTITY_CLIENT_ID: 'test-client',
          IDENTITY_CLIENT_SECRET: 'secret',
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          BASE_URL: 'https://app.example.com',
        },
        mockProvider
      );
    });

    it('should retrieve code verifier using identityAuthState as key', async () => {
      const mockTokenResponse = {
        accessToken: 'access-token-state',
        tokenType: 'Bearer',
      };

      mockClient.identityAuthCodeVerifier = null;
      mockClient.identityAuthState = 'state-key-123';

      identityClientAdapter.pkceStateStore.set('state-key-123', {
        codeVerifier: 'verifier-from-state-key',
        state: 'state-key-123',
        expiresAt: futureExpiry(),
      });

      mockOidcAdapter.exchangeCode.resolves(mockTokenResponse);

      const result = await identityClientAdapter.exchangeIdentityCode(
        mockProvider,
        mockClient,
        'auth-code',
        'https://callback.example.com',
        'different-interaction-id'
      );

      expect(result.accessToken).to.equal('access-token-state');
      expect(identityClientAdapter.pkceStateStore.has('state-key-123')).to.be.false;
    });
  });
});
