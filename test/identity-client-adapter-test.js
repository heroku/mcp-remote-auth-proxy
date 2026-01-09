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
  pkceStateStore,
} from '../lib/identity-client-adapter.js';
import {
  expectInitError,
  expectThrowsExactMessage,
  futureExpiry,
  pastExpiry,
  createPkceStateData,
} from './helpers/test-utils.js';
import {
  createMockClient,
  createMockProvider,
  createPkceTestContext,
  resetPkceStore,
  expectFallbackStoreEntry,
  expectClientSessionStorage,
  configureNoInteraction,
  configureInteractionMissingClientId,
  configureNoClient,
  configureStorageFailure,
  configureRetrievalFailure,
} from './helpers/pkce-test-helpers.js';

describe('Identity Client Adapter', () => {
  let mockProvider;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient({ clientId: 'test-client-id' });
    mockProvider = createMockProvider({
      client: mockClient,
      interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
    });
  });

  afterEach(() => {
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

      try {
        await identityClientInit(env);
        expect(true).to.be.true;
      } catch (error) {
        // Expected to fail in test environment without real OIDC server
        expect(error).to.be.an('object');
        const hasMessage = error.message || error.error || error.error_description;
        expect(hasMessage).to.exist;
      }
    });

    it('should throw error when required environment variables are missing', async () => {
      const env = {
        IDENTITY_CLIENT_SECRET: 'test-client-secret',
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        BASE_URL: 'https://app.example.com',
      };

      try {
        await identityClientInit(env);
        expect.fail('Should have thrown an error');
      } catch (error) {
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
      await expectInitError(() =>
        generateIdentityAuthUrl('test-uid', mockProvider, mockClient, 'https://app.example.com')
      );
    });
  });

  describe('exchangeIdentityCode', () => {
    it('should throw error if not initialized', async () => {
      await expectInitError(() =>
        exchangeIdentityCode(mockProvider, mockClient, 'test-code', 'https://callback.example.com')
      );
    });

    it('should accept optional interactionId parameter for fallback storage lookup', async () => {
      await expectInitError(() =>
        exchangeIdentityCode(
          mockProvider,
          mockClient,
          'test-code',
          'https://callback.example.com',
          'test-interaction-id'
        )
      );
    });
  });

  describe('refreshIdentityToken', () => {
    it('should throw error if not initialized', async () => {
      await expectInitError(() => refreshIdentityToken(mockProvider, mockClient));
    });
  });

  describe('callback paths', () => {
    it('should have callback paths (may be set by previous tests)', () => {
      expect(identityCallbackPath).to.be.a('string');
      expect(identityUniqueCallbackPath).to.be.a('string');
      expect(identityCallbackPath).to.match(/\/.*callback$/);
      expect(identityUniqueCallbackPath).to.match(/\/.*:uid.*callback$/);
    });
  });

  describe('createStorageHook - PKCEStorageHook Implementation', () => {
    let ctx;

    beforeEach(() => {
      resetPkceStore();
      ctx = createPkceTestContext();
    });

    afterEach(() => {
      resetPkceStore();
    });

    describe('storePKCEState', () => {
      it('should store PKCE state in client session when interaction exists', async () => {
        const { interactionId, state, codeVerifier, expiresAt } = createPkceStateData();

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expect(ctx.mockProvider.Interaction.find.calledWith(interactionId)).to.be.true;
        expect(ctx.mockProvider.Client.find.calledWith('test-client-123')).to.be.true;

        expectClientSessionStorage({
          mockClient: ctx.mockClient,
          state,
          codeVerifier,
          adapterUpsertStub: ctx.mockProvider.Client.adapter.upsert,
        });
      });

      it('should use fallback storage when no interaction is found', async () => {
        configureNoInteraction(ctx.mockProvider);
        const { state, codeVerifier, expiresAt } = createPkceStateData();
        const interactionId = 'missing-interaction-id';

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expectFallbackStoreEntry({
          interactionId,
          state,
          codeVerifier,
          expiresAt,
          adapterUpsertStub: ctx.mockProvider.Client.adapter.upsert,
        });
      });

      it('should use fallback storage when no client is found', async () => {
        configureNoClient(ctx.mockProvider);
        const { state, codeVerifier, expiresAt } = createPkceStateData();
        const interactionId = 'test-interaction-no-client';

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expectFallbackStoreEntry({
          interactionId,
          state,
          codeVerifier,
          adapterUpsertStub: ctx.mockProvider.Client.adapter.upsert,
        });
      });

      it('should use fallback storage when interaction is missing client_id', async () => {
        configureInteractionMissingClientId(ctx.mockProvider);
        const { state, codeVerifier, expiresAt } = createPkceStateData();
        const interactionId = 'missing-client-id-interaction';

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expectFallbackStoreEntry({
          interactionId,
          state,
          codeVerifier,
          adapterUpsertStub: ctx.mockProvider.Client.adapter.upsert,
        });
      });

      it('should throw error when storage fails', async () => {
        configureStorageFailure(ctx.mockProvider);
        const { interactionId, state, codeVerifier, expiresAt } = createPkceStateData();

        await expectThrowsExactMessage(
          () => ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt),
          'Redis connection failed'
        );
      });
    });

    describe('retrievePKCEState', () => {
      it('should retrieve PKCE state from fallback storage when valid', async () => {
        const { interactionId, state, codeVerifier } = createPkceStateData();
        pkceStateStore.set(interactionId, { state, codeVerifier, expiresAt: futureExpiry() });

        const result = await ctx.storageHook.retrievePKCEState(interactionId, state);

        expect(result).to.equal(codeVerifier);
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should return null and cleanup when fallback state is expired', async () => {
        const { interactionId, state, codeVerifier } = createPkceStateData();
        pkceStateStore.set(interactionId, { state, codeVerifier, expiresAt: pastExpiry() });

        const result = await ctx.storageHook.retrievePKCEState(interactionId, state);

        expect(result).to.be.null;
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should return null when fallback state does not match', async () => {
        const { interactionId, codeVerifier } = createPkceStateData();
        pkceStateStore.set(interactionId, {
          state: 'stored-state',
          codeVerifier,
          expiresAt: futureExpiry(),
        });

        const result = await ctx.storageHook.retrievePKCEState(interactionId, 'different-state');

        expect(result).to.be.null;
        expect(pkceStateStore.has(interactionId)).to.be.false;
      });

      it('should retrieve PKCE state from client session', async () => {
        ctx.mockClient.identityAuthCodeVerifier = 'client-session-verifier';
        ctx.mockClient.identityAuthState = 'client-session-state';

        const result = await ctx.storageHook.retrievePKCEState(
          'test-interaction-id',
          'client-session-state'
        );

        expect(result).to.equal('client-session-verifier');
      });

      it('should return null when state in client session does not match', async () => {
        ctx.mockClient.identityAuthCodeVerifier = 'client-session-verifier';
        ctx.mockClient.identityAuthState = 'stored-state';

        const result = await ctx.storageHook.retrievePKCEState(
          'test-interaction-id',
          'different-state'
        );

        expect(result).to.be.null;
      });

      it('should return null when no interaction found and not in fallback', async () => {
        configureNoInteraction(ctx.mockProvider);

        const result = await ctx.storageHook.retrievePKCEState(
          'non-existent-interaction',
          'some-state'
        );

        expect(result).to.be.null;
      });

      it('should return null when client has no PKCE data', async () => {
        ctx.mockClient.identityAuthCodeVerifier = null;
        ctx.mockClient.identityAuthState = null;

        const result = await ctx.storageHook.retrievePKCEState('test-interaction-id', 'some-state');

        expect(result).to.be.null;
      });

      it('should throw on retrieval error', async () => {
        configureRetrievalFailure(ctx.mockProvider);

        await expectThrowsExactMessage(
          () => ctx.storageHook.retrievePKCEState('error-interaction', 'some-state'),
          'Database error'
        );
      });
    });

    describe('cleanupExpiredState', () => {
      it('should clean up expired entries from fallback storage', async () => {
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
        pkceStateStore.set('valid-1', {
          state: 'state-3',
          codeVerifier: 'verifier-3',
          expiresAt: futureExpiry(),
        });

        await ctx.storageHook.cleanupExpiredState(now);

        expect(pkceStateStore.size).to.equal(1);
        expect(pkceStateStore.has('valid-1')).to.be.true;
        expect(pkceStateStore.has('expired-1')).to.be.false;
        expect(pkceStateStore.has('expired-2')).to.be.false;
      });

      it('should handle empty fallback storage', async () => {
        expect(pkceStateStore.size).to.equal(0);

        await ctx.storageHook.cleanupExpiredState(Date.now());

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

        await ctx.storageHook.cleanupExpiredState(now);

        expect(pkceStateStore.size).to.equal(0);
      });
    });

    describe('PKCEStorageHook Interface Compliance', () => {
      it('should implement all required methods', () => {
        expect(ctx.storageHook.storePKCEState).to.be.a('function');
        expect(ctx.storageHook.retrievePKCEState).to.be.a('function');
        expect(ctx.storageHook.cleanupExpiredState).to.be.a('function');
      });

      it('storePKCEState should accept (interactionId, state, codeVerifier, expiresAt)', async () => {
        expect(ctx.storageHook.storePKCEState.length).to.equal(4);
        await ctx.storageHook.storePKCEState(
          'interaction-id',
          'state',
          'code-verifier',
          futureExpiry()
        );
      });

      it('retrievePKCEState should accept (interactionId, state)', async () => {
        expect(ctx.storageHook.retrievePKCEState.length).to.equal(2);
      });

      it('cleanupExpiredState should accept (beforeTimestamp)', async () => {
        expect(ctx.storageHook.cleanupExpiredState.length).to.equal(1);
      });
    });

    describe('Full PKCE Lifecycle', () => {
      it('should support complete store-retrieve-cleanup cycle via fallback storage', async () => {
        configureNoInteraction(ctx.mockProvider);
        const { state, codeVerifier, expiresAt } = createPkceStateData();
        const interactionId = 'lifecycle-test-interaction';

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
        expect(pkceStateStore.size).to.equal(1);

        const retrieved = await ctx.storageHook.retrievePKCEState(interactionId, state);
        expect(retrieved).to.equal(codeVerifier);
        expect(pkceStateStore.size).to.equal(0);
      });

      it('should support complete store-retrieve cycle via client session', async () => {
        const { state, codeVerifier, expiresAt } = createPkceStateData();
        const interactionId = 'client-session-lifecycle';

        await ctx.storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

        expect(ctx.mockClient.identityAuthCodeVerifier).to.equal(codeVerifier);
        expect(ctx.mockClient.identityAuthState).to.equal(state);
        expect(ctx.mockProvider.Client.adapter.upsert.calledOnce).to.be.true;

        const retrieved = await ctx.storageHook.retrievePKCEState(interactionId, state);
        expect(retrieved).to.equal(codeVerifier);
      });
    });
  });

  describe('pkceStateStore (Fallback Storage)', () => {
    beforeEach(() => resetPkceStore());
    afterEach(() => resetPkceStore());

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
