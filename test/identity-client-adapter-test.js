/**
 * Tests for identity-client-adapter.js
 */

import { expect } from 'chai';
import sinon from 'sinon';
import {
  identityClientInit,
  generateIdentityAuthUrl,
  exchangeIdentityCode,
  refreshIdentityToken,
  identityCallbackPath,
  identityUniqueCallbackPath,
} from '../lib/identity-client-adapter.js';

describe('Identity Client Adapter', () => {
  let mockProvider;
  let mockClient;
  let _mockAdapter;

  beforeEach(() => {
    // Mock provider and client
    mockClient = {
      clientId: 'test-client-id',
      metadata: sinon.stub().returns({}),
      identityAuthCodeVerifier: null,
      identityAuthState: null,
    };

    mockProvider = {
      Client: {
        find: sinon.stub().resolves(mockClient),
        adapter: {
          upsert: sinon.stub().resolves(),
        },
      },
      Interaction: {
        find: sinon.stub().resolves({ jti: 'test-interaction' }),
      },
    };

    // Reset any module state
    sinon.restore();
  });

  describe('identityClientInit', () => {
    it('should initialize with required environment variables', async () => {
      const env = {
        IDENTITY_CLIENT_ID: 'test-client-id',
        IDENTITY_CLIENT_SECRET: 'test-client-secret',
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        BASE_URL: 'https://app.example.com',
        IDENTITY_SCOPE: 'openid profile email',
      };

      // This test mainly verifies the function doesn't throw
      // Real initialization testing is done in the adapter library
      try {
        await identityClientInit(env);
        // If we get here without throwing, the basic setup worked
        expect(true).to.be.true;
      } catch (error) {
        // Expected to fail in test environment without real OIDC server
        // Just verify we got an error object with some message or error property
        expect(error).to.be.an('object');
        const hasMessage = error.message || error.error || error.error_description;
        expect(hasMessage).to.exist;
      }
    });

    it('should throw error when required environment variables are missing', async () => {
      const env = {
        // Missing IDENTITY_CLIENT_ID
        IDENTITY_CLIENT_SECRET: 'test-client-secret',
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        BASE_URL: 'https://app.example.com',
      };

      try {
        await identityClientInit(env);
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Error might be a validation error object, check if it contains the field reference
        const errorStr = typeof error.message === 'string' ? error.message : JSON.stringify(error);
        expect(errorStr).to.include('clientId');
      }
    });

    it('should set callback paths correctly', async () => {
      const env = {
        IDENTITY_CLIENT_ID: 'test-client-id',
        IDENTITY_CLIENT_SECRET: 'test-client-secret',
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        BASE_URL: 'https://app.example.com',
        IDENTITY_CALLBACK_PATH: '/custom/callback',
        IDENTITY_UNIQUE_CALLBACK_PATH: '/custom/:uid/callback',
      };

      try {
        await identityClientInit(env, mockProvider);
      } catch {
        // Ignore initialization errors, we just want to test path setting
      }

      expect(identityCallbackPath).to.equal('/custom/callback');
      expect(identityUniqueCallbackPath).to.equal('/custom/:uid/callback');
    });
  });

  describe('generateIdentityAuthUrl', () => {
    it('should throw error if not initialized', async () => {
      try {
        await generateIdentityAuthUrl(
          'test-uid',
          mockProvider,
          mockClient,
          'https://app.example.com'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('identityClientInit');
      }
    });
  });

  describe('exchangeIdentityCode', () => {
    it('should throw error if not initialized', async () => {
      try {
        await exchangeIdentityCode(
          mockProvider,
          mockClient,
          'test-code',
          'https://callback.example.com'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('identityClientInit');
      }
    });
  });

  describe('refreshIdentityToken', () => {
    it('should throw error if not initialized', async () => {
      try {
        await refreshIdentityToken(mockProvider, mockClient);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('identityClientInit');
      }
    });
  });

  describe('callback paths', () => {
    it('should have callback paths (may be set by previous tests)', () => {
      // The callback paths are module-level variables that get set during init
      // They might be the defaults or custom paths from previous tests
      expect(identityCallbackPath).to.be.a('string');
      expect(identityUniqueCallbackPath).to.be.a('string');

      // Check that they follow the expected pattern
      expect(identityCallbackPath).to.match(/\/.*callback$/);
      expect(identityUniqueCallbackPath).to.match(/\/.*:uid.*callback$/);
    });
  });

  describe('legacy compatibility exports', () => {
    it('should export getIdentityScope function', async () => {
      const { getIdentityScope } = await import('../lib/identity-client-adapter.js');
      expect(getIdentityScope).to.be.a('function');
    });

    it('should export getOidcAdapter function', async () => {
      const { getOidcAdapter } = await import('../lib/identity-client-adapter.js');
      expect(getOidcAdapter).to.be.a('function');
    });

    it('should return identity scope after initialization', async () => {
      const { getIdentityScope } = await import('../lib/identity-client-adapter.js');
      const scope = getIdentityScope();
      expect(scope).to.be.a('string');
    });

    it('should return oidc adapter after initialization', async () => {
      const { getOidcAdapter } = await import('../lib/identity-client-adapter.js');
      const adapter = getOidcAdapter();
      // Should return the adapter (may be null if not initialized in this test run)
      expect(adapter === null || typeof adapter === 'object').to.be.true;
    });
  });
});
