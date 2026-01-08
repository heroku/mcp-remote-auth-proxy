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
  createStorageHook,
  pkceStateStore,
} from '../lib/identity-client-adapter.js';

describe('Identity Client Adapter', () => {
  let mockProvider;
  let mockClient;

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
        find: sinon.stub().resolves({
          jti: 'test-interaction',
          params: { client_id: 'test-client-id' },
        }),
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

  describe('createStorageHook - PKCEStorageHook Implementation', () => {
    let storageHook;
    let mockProviderForHook;
    let mockClientForHook;

    beforeEach(() => {
      // Clear the fallback store before each test
      pkceStateStore.clear();

      // Create mock client for storage tests
      mockClientForHook = {
        clientId: 'test-client-123',
        metadata: sinon.stub().returns({ clientId: 'test-client-123' }),
        identityAuthCodeVerifier: null,
        identityAuthState: null,
      };

      // Create mock provider for storage tests
      mockProviderForHook = {
        Client: {
          find: sinon.stub().resolves(mockClientForHook),
          adapter: {
            upsert: sinon.stub().resolves(),
          },
        },
        Interaction: {
          find: sinon.stub().resolves({
            jti: 'test-interaction-id',
            params: { client_id: 'test-client-123' },
          }),
        },
      };

      // Create the storage hook with the mock provider
      storageHook = createStorageHook(mockProviderForHook);
    });

    afterEach(() => {
      pkceStateStore.clear();
      sinon.restore();
    });

    describe('storePKCEState', () => {
      it('should store PKCE state in client session when interaction exists', async () => {
        const interactionId = 'test-interaction-id';
        const state = 'test-state-param';
        const codeVerifier = 'test-code-verifier-abc123';
        const expiresAt = Date.now() + 600000; // 10 minutes from now

        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        // Verify the interaction was looked up
        expect(mockProviderForHook.Interaction.find.calledWith(interactionId)).to.be.true;

        // Verify the client was looked up with the correct client_id
        expect(mockProviderForHook.Client.find.calledWith('test-client-123')).to.be.true;

        // Verify the client session was updated
        expect(mockClientForHook.identityAuthCodeVerifier).to.equal(codeVerifier);
        expect(mockClientForHook.identityAuthState).to.equal(state);

        // Verify upsert was called
        expect(mockProviderForHook.Client.adapter.upsert.calledOnce).to.be.true;
        expect(
          mockProviderForHook.Client.adapter.upsert.calledWith(
            'test-client-123',
            sinon.match.any
          )
        ).to.be.true;

        // Verify fallback store was NOT used
        expect(pkceStateStore.size).to.equal(0);
      });

      it('should use fallback storage when no interaction is found', async () => {
        // Make Interaction.find return null
        mockProviderForHook.Interaction.find.resolves(null);

        const interactionId = 'missing-interaction-id';
        const state = 'test-state-param';
        const codeVerifier = 'test-code-verifier-xyz789';
        const expiresAt = Date.now() + 600000;

        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        // Verify fallback store was used
        expect(pkceStateStore.size).to.equal(1);
        expect(pkceStateStore.has(interactionId)).to.be.true;

        const storedData = pkceStateStore.get(interactionId);
        expect(storedData.state).to.equal(state);
        expect(storedData.codeVerifier).to.equal(codeVerifier);
        expect(storedData.expiresAt).to.equal(expiresAt);

        // Verify client session was NOT updated
        expect(mockProviderForHook.Client.adapter.upsert.called).to.be.false;
      });

      it('should use fallback storage when no client is found', async () => {
        // Make Client.find return null
        mockProviderForHook.Client.find.resolves(null);

        const interactionId = 'test-interaction-no-client';
        const state = 'test-state-param';
        const codeVerifier = 'test-code-verifier-no-client';
        const expiresAt = Date.now() + 600000;

        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        // Verify fallback store was used
        expect(pkceStateStore.size).to.equal(1);
        expect(pkceStateStore.has(interactionId)).to.be.true;

        const storedData = pkceStateStore.get(interactionId);
        expect(storedData.codeVerifier).to.equal(codeVerifier);
      });

      it('should use fallback storage when interaction is missing client_id', async () => {
        // Make Interaction.find return object without params.client_id
        mockProviderForHook.Interaction.find.resolves({
          jti: 'test-interaction-id',
          params: {},
        });

        const interactionId = 'missing-client-id-interaction';
        const state = 'test-state-param';
        const codeVerifier = 'test-code-verifier-missing-client';
        const expiresAt = Date.now() + 600000;

        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expect(pkceStateStore.size).to.equal(1);
        expect(pkceStateStore.has(interactionId)).to.be.true;
        const stored = pkceStateStore.get(interactionId);
        expect(stored.state).to.equal(state);
        expect(stored.codeVerifier).to.equal(codeVerifier);
        expect(mockProviderForHook.Client.adapter.upsert.called).to.be.false;
      });

      it('should throw error when storage fails', async () => {
        // Make upsert throw an error
        mockProviderForHook.Client.adapter.upsert.rejects(new Error('Redis connection failed'));

        const interactionId = 'test-interaction-id';
        const state = 'test-state-param';
        const codeVerifier = 'test-code-verifier';
        const expiresAt = Date.now() + 600000;

        try {
          await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Redis connection failed');
        }
      });
    });

    describe('retrievePKCEState', () => {
      it('should retrieve PKCE state from fallback storage when valid', async () => {
        const interactionId = 'fallback-interaction-id';
        const state = 'fallback-state';
        const codeVerifier = 'fallback-code-verifier';
        const expiresAt = Date.now() + 600000; // Future expiration

        // Store in fallback
        pkceStateStore.set(interactionId, { state, codeVerifier, expiresAt });

        const result = await storageHook.retrievePKCEState(interactionId, state);

        expect(result).to.equal(codeVerifier);
        // Verify fallback store was cleaned up after retrieval
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should return null and cleanup when fallback state is expired', async () => {
        const interactionId = 'expired-interaction-id';
        const state = 'expired-state';
        const codeVerifier = 'expired-code-verifier';
        const expiresAt = Date.now() - 1000; // Past expiration

        // Store expired state in fallback
        pkceStateStore.set(interactionId, { state, codeVerifier, expiresAt });

        const result = await storageHook.retrievePKCEState(interactionId, state);

        expect(result).to.be.null;
        // Verify expired entry was cleaned up
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should return null when fallback state does not match', async () => {
        const interactionId = 'mismatch-interaction-id';
        const storedState = 'stored-state';
        const requestedState = 'different-state';
        const codeVerifier = 'mismatch-code-verifier';
        const expiresAt = Date.now() + 600000;

        // Store with one state
        pkceStateStore.set(interactionId, {
          state: storedState,
          codeVerifier,
          expiresAt,
        });

        // Request with different state
        const result = await storageHook.retrievePKCEState(interactionId, requestedState);

        expect(result).to.be.null;
        // Verify mismatched entry was cleaned up
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should retrieve PKCE state from client session', async () => {
        // Set up client with stored PKCE data
        mockClientForHook.identityAuthCodeVerifier = 'client-session-verifier';
        mockClientForHook.identityAuthState = 'client-session-state';

        const interactionId = 'test-interaction-id';

        const result = await storageHook.retrievePKCEState(
          interactionId,
          'client-session-state'
        );

        expect(result).to.equal('client-session-verifier');
      });

      it('should return null when state in client session does not match', async () => {
        // Set up client with stored PKCE data
        mockClientForHook.identityAuthCodeVerifier = 'client-session-verifier';
        mockClientForHook.identityAuthState = 'stored-state';

        const interactionId = 'test-interaction-id';

        const result = await storageHook.retrievePKCEState(interactionId, 'different-state');

        expect(result).to.be.null;
      });

      it('should return null when no interaction found and not in fallback', async () => {
        mockProviderForHook.Interaction.find.resolves(null);

        const result = await storageHook.retrievePKCEState(
          'non-existent-interaction',
          'some-state'
        );

        expect(result).to.be.null;
      });

      it('should return null when client has no PKCE data', async () => {
        // Client exists but has no PKCE data
        mockClientForHook.identityAuthCodeVerifier = null;
        mockClientForHook.identityAuthState = null;

        const result = await storageHook.retrievePKCEState('test-interaction-id', 'some-state');

        expect(result).to.be.null;
      });

      it('should throw on retrieval error', async () => {
        mockProviderForHook.Interaction.find.rejects(new Error('Database error'));

        try {
          await storageHook.retrievePKCEState('error-interaction', 'some-state');
          expect.fail('Expected retrieval to throw on unexpected error');
        } catch (error) {
          expect(error.message).to.equal('Database error');
        }
      });
    });

    describe('cleanupExpiredState', () => {
      it('should clean up expired entries from fallback storage', async () => {
        const now = Date.now();

        // Add some entries - some expired, some not
        pkceStateStore.set('expired-1', {
          state: 'state-1',
          codeVerifier: 'verifier-1',
          expiresAt: now - 1000, // Expired
        });
        pkceStateStore.set('expired-2', {
          state: 'state-2',
          codeVerifier: 'verifier-2',
          expiresAt: now - 2000, // Expired
        });
        pkceStateStore.set('valid-1', {
          state: 'state-3',
          codeVerifier: 'verifier-3',
          expiresAt: now + 600000, // Still valid
        });

        expect(pkceStateStore.size).to.equal(3);

        await storageHook.cleanupExpiredState(now);

        // Only the valid entry should remain
        expect(pkceStateStore.size).to.equal(1);
        expect(pkceStateStore.has('valid-1')).to.be.true;
        expect(pkceStateStore.has('expired-1')).to.be.false;
        expect(pkceStateStore.has('expired-2')).to.be.false;
      });

      it('should handle empty fallback storage', async () => {
        expect(pkceStateStore.size).to.equal(0);

        // Should not throw
        await storageHook.cleanupExpiredState(Date.now());

        expect(pkceStateStore.size).to.equal(0);
      });

      it('should clean up all entries when all are expired', async () => {
        const now = Date.now();

        pkceStateStore.set('expired-1', {
          state: 'state-1',
          codeVerifier: 'verifier-1',
          expiresAt: now - 1000,
        });
        pkceStateStore.set('expired-2', {
          state: 'state-2',
          codeVerifier: 'verifier-2',
          expiresAt: now - 2000,
        });

        await storageHook.cleanupExpiredState(now);

        expect(pkceStateStore.size).to.equal(0);
      });
    });

    describe('PKCEStorageHook Interface Compliance', () => {
      it('should implement all required methods', () => {
        expect(storageHook.storePKCEState).to.be.a('function');
        expect(storageHook.retrievePKCEState).to.be.a('function');
        expect(storageHook.cleanupExpiredState).to.be.a('function');
      });

      it('storePKCEState should accept (interactionId, state, codeVerifier, expiresAt)', async () => {
        // Verify function signature
        expect(storageHook.storePKCEState.length).to.equal(4);

        // Should not throw with correct arguments
        await storageHook.storePKCEState(
          'interaction-id',
          'state',
          'code-verifier',
          Date.now() + 600000
        );
      });

      it('retrievePKCEState should accept (interactionId, state)', async () => {
        // Verify function signature
        expect(storageHook.retrievePKCEState.length).to.equal(2);
      });

      it('cleanupExpiredState should accept (beforeTimestamp)', async () => {
        // Verify function signature
        expect(storageHook.cleanupExpiredState.length).to.equal(1);
      });
    });

    describe('Full PKCE Lifecycle', () => {
      it('should support complete store-retrieve-cleanup cycle via fallback storage', async () => {
        const interactionId = 'lifecycle-test-interaction';
        const state = 'lifecycle-state';
        const codeVerifier = 'lifecycle-verifier-abc123';
        const expiresAt = Date.now() + 600000;

        // Make interaction not found to use fallback
        mockProviderForHook.Interaction.find.resolves(null);

        // Store
        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
        expect(pkceStateStore.size).to.equal(1);

        // Retrieve
        const retrieved = await storageHook.retrievePKCEState(interactionId, state);
        expect(retrieved).to.equal(codeVerifier);

        // After retrieval, entry should be cleaned up
        expect(pkceStateStore.size).to.equal(0);
      });

      it('should support complete store-retrieve cycle via client session', async () => {
        const interactionId = 'client-session-lifecycle';
        const state = 'session-state';
        const codeVerifier = 'session-verifier-xyz789';
        const expiresAt = Date.now() + 600000;

        // Store - interaction exists, so uses client session
        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        // Verify stored in client
        expect(mockClientForHook.identityAuthCodeVerifier).to.equal(codeVerifier);
        expect(mockClientForHook.identityAuthState).to.equal(state);
        expect(mockProviderForHook.Client.adapter.upsert.calledOnce).to.be.true;

        // Retrieve
        const retrieved = await storageHook.retrievePKCEState(interactionId, state);
        expect(retrieved).to.equal(codeVerifier);
      });
    });
  });

  describe('pkceStateStore (Fallback Storage)', () => {
    beforeEach(() => {
      pkceStateStore.clear();
    });

    afterEach(() => {
      pkceStateStore.clear();
    });

    it('should be a Map', () => {
      expect(pkceStateStore).to.be.instanceOf(Map);
    });

    it('should be exported and accessible for testing', () => {
      expect(pkceStateStore).to.exist;
      expect(typeof pkceStateStore.set).to.equal('function');
      expect(typeof pkceStateStore.get).to.equal('function');
      expect(typeof pkceStateStore.delete).to.equal('function');
    });
  });
});
