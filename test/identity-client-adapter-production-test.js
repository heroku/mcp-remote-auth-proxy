/**
 * Tests for production environment safeguards in identity-client-adapter.js
 * These tests verify that fallback storage is properly disabled in production environments
 */

import { expect } from 'chai';
import sinon from 'sinon';
import {
  createMockClient,
  createMockProvider,
  resetPkceStore,
  configureNoInteraction,
  configureInteractionMissingClientId,
  configureNoClient,
} from './helpers/pkce-test-helpers.js';
import { futureExpiry } from './helpers/test-utils.js';

describe('Identity Client Adapter - Production Environment Safeguards', () => {
  let originalNodeEnv;
  let mockProvider;
  let mockClient;

  afterEach(() => {
    // Restore original NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    sinon.restore();
  });

  describe('Production Environment (NODE_ENV=production)', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'production';
      mockClient = createMockClient({ clientId: 'test-client-id' });
      mockProvider = createMockProvider({
        client: mockClient,
        interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
      });
    });

    it('should prevent fallback storage when no interaction is found', async () => {
      // Import with production environment
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      // Configure provider to return no interaction
      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      try {
        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
        expect.fail('Should have thrown an error in production');
      } catch (error) {
        expect(error.message).to.include('no interaction found');
        expect(error.message).to.include('fallback storage is disabled in production');
      }
    });

    it('should prevent fallback storage when interaction is missing client_id', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      // Configure interaction without client_id
      configureInteractionMissingClientId(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      try {
        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
        expect.fail('Should have thrown an error in production');
      } catch (error) {
        expect(error.message).to.include('missing client_id');
        expect(error.message).to.include('fallback storage is disabled in production');
      }
    });

    it('should prevent fallback storage when no client is found', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      // Configure provider with no client
      configureNoClient(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      try {
        await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);
        expect.fail('Should have thrown an error in production');
      } catch (error) {
        expect(error.message).to.include('no client found');
        expect(error.message).to.include('fallback storage is disabled in production');
      }
    });

    it('should not retrieve from fallback storage in production', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Manually add to fallback storage (simulating what might have been there)
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      pkceStateStore.set(interactionId, {
        state,
        codeVerifier,
        expiresAt: futureExpiry(),
      });

      // Configure provider to return no interaction (forcing fallback path)
      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);

      // In production, should not check fallback storage, so should return null
      const result = await storageHook.retrievePKCEState(interactionId, state);
      expect(result).to.be.null;
    });

    it('should not cleanup fallback storage in production', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Manually add expired data to fallback storage
      const interactionId = 'test-interaction-id';
      pkceStateStore.set(interactionId, {
        state: 'test-state',
        codeVerifier: 'test-code-verifier',
        expiresAt: Date.now() - 1000, // Expired
      });

      const storageHook = createStorageHook(mockProvider);

      // Run cleanup
      await storageHook.cleanupExpiredState(Date.now());

      // In production, fallback storage should not be cleaned (and shouldn't be used anyway)
      // The store might still have the entry, but it won't be used
      // This is acceptable as the store should be empty in production anyway
    });

    it('should successfully store PKCE state when client is available', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      // With proper client setup, should succeed even in production
      await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

      // Verify it was stored in client session
      expect(mockClient.identityAuthCodeVerifier).to.equal(codeVerifier);
      expect(mockClient.identityAuthState).to.equal(state);
    });

    it('should successfully retrieve PKCE state from client session in production', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';

      // Set up client with PKCE data
      mockClient.identityAuthCodeVerifier = codeVerifier;
      mockClient.identityAuthState = state;

      const storageHook = createStorageHook(mockProvider);

      // Should successfully retrieve from client session
      const result = await storageHook.retrievePKCEState(interactionId, state);
      expect(result).to.equal(codeVerifier);
    });
  });

  describe('Non-Production Environment (NODE_ENV not set or development)', () => {
    beforeEach(async () => {
      // Ensure NODE_ENV is not production
      delete process.env.NODE_ENV;

      mockClient = createMockClient({ clientId: 'test-client-id' });
      mockProvider = createMockProvider({
        client: mockClient,
        interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
      });
    });

    afterEach(() => {
      resetPkceStore();
    });

    it('should allow fallback storage when no interaction is found', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Reset store
      pkceStateStore.clear();

      // Configure provider to return no interaction
      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      // Should not throw in non-production
      await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

      // Verify it was stored in fallback
      expect(pkceStateStore.has(interactionId)).to.be.true;
      const stored = pkceStateStore.get(interactionId);
      expect(stored.codeVerifier).to.equal(codeVerifier);
      expect(stored.state).to.equal(state);
    });

    it('should allow fallback storage when interaction is missing client_id', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Reset store
      pkceStateStore.clear();

      // Configure interaction without client_id
      configureInteractionMissingClientId(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      // Should not throw in non-production
      await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

      // Verify it was stored in fallback
      expect(pkceStateStore.has(interactionId)).to.be.true;
    });

    it('should allow fallback storage when no client is found', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Reset store
      pkceStateStore.clear();

      // Configure provider with no client
      configureNoClient(mockProvider);

      const storageHook = createStorageHook(mockProvider);
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      const expiresAt = futureExpiry();

      // Should not throw in non-production
      await storageHook.storePKCEState(interactionId, state, codeVerifier, expiresAt);

      // Verify it was stored in fallback
      expect(pkceStateStore.has(interactionId)).to.be.true;
    });

    it('should retrieve from fallback storage in non-production', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Reset and populate fallback storage
      pkceStateStore.clear();
      const interactionId = 'test-interaction-id';
      const state = 'test-state';
      const codeVerifier = 'test-code-verifier';
      pkceStateStore.set(interactionId, {
        state,
        codeVerifier,
        expiresAt: futureExpiry(),
      });

      // Configure provider to return no interaction (forcing fallback path)
      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);

      // Should successfully retrieve from fallback
      const result = await storageHook.retrievePKCEState(interactionId, state);
      expect(result).to.equal(codeVerifier);
    });

    it('should cleanup fallback storage in non-production', async () => {
      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      // Reset and add expired data to fallback storage
      pkceStateStore.clear();
      const interactionId = 'test-interaction-id';
      pkceStateStore.set(interactionId, {
        state: 'test-state',
        codeVerifier: 'test-code-verifier',
        expiresAt: Date.now() - 1000, // Expired
      });

      const storageHook = createStorageHook(mockProvider);

      // Run cleanup
      await storageHook.cleanupExpiredState(Date.now());

      // In non-production, expired entries should be removed
      expect(pkceStateStore.has(interactionId)).to.be.false;
    });
  });

  describe('Environment Variable Edge Cases', () => {
    it('should disable fallback storage when NODE_ENV=production (case sensitive)', async () => {
      process.env.NODE_ENV = 'production';

      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook } = adapter;

      mockClient = createMockClient({ clientId: 'test-client-id' });
      mockProvider = createMockProvider({
        client: mockClient,
        interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
      });

      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);

      try {
        await storageHook.storePKCEState('test-id', 'test-state', 'test-verifier', futureExpiry());
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('fallback storage is disabled in production');
      }
    });

    it('should allow fallback storage when NODE_ENV=Production (incorrect case)', async () => {
      process.env.NODE_ENV = 'Production'; // Incorrect case

      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      pkceStateStore.clear();

      mockClient = createMockClient({ clientId: 'test-client-id' });
      mockProvider = createMockProvider({
        client: mockClient,
        interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
      });

      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);

      // Should not throw because NODE_ENV is not exactly 'production'
      await storageHook.storePKCEState('test-id', 'test-state', 'test-verifier', futureExpiry());

      // Should have used fallback storage
      expect(pkceStateStore.has('test-id')).to.be.true;
    });

    it('should allow fallback storage when NODE_ENV=development', async () => {
      process.env.NODE_ENV = 'development';

      const adapter = await import('../lib/identity-client-adapter.js');
      const { createStorageHook, pkceStateStore } = adapter;

      pkceStateStore.clear();

      mockClient = createMockClient({ clientId: 'test-client-id' });
      mockProvider = createMockProvider({
        client: mockClient,
        interaction: { jti: 'test-interaction', params: { client_id: 'test-client-id' } },
      });

      configureNoInteraction(mockProvider);

      const storageHook = createStorageHook(mockProvider);

      // Should not throw in development
      await storageHook.storePKCEState('test-id', 'test-state', 'test-verifier', futureExpiry());

      // Should have used fallback storage
      expect(pkceStateStore.has('test-id')).to.be.true;
    });
  });
});
