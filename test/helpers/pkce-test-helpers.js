/**
 * PKCE-specific test helpers for identity-client-adapter tests
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { createStorageHook, pkceStateStore } from '../../lib/identity-client-adapter.js';

/**
 * Create a mock OIDC client for testing
 * @param {Object} [options] - Override options
 * @param {string} [options.clientId] - Client identifier
 * @param {string} [options.codeVerifier] - Pre-set code verifier
 * @param {string} [options.state] - Pre-set state
 * @returns {Object} Mock client object
 */
export function createMockClient(options = {}) {
  const clientId = options.clientId || 'test-client-123';
  return {
    clientId,
    metadata: sinon.stub().returns({ clientId }),
    identityAuthCodeVerifier: options.codeVerifier ?? null,
    identityAuthState: options.state ?? null,
  };
}

/**
 * Create a mock OIDC provider for testing
 * @param {Object} [options] - Override options
 * @param {Object} [options.client] - Mock client to return from Client.find
 * @param {Object} [options.interaction] - Mock interaction to return from Interaction.find
 * @returns {Object} Mock provider object
 */
export function createMockProvider(options = {}) {
  const mockClient = options.client || createMockClient();
  const interaction = options.interaction ?? {
    jti: 'test-interaction-id',
    params: { client_id: mockClient.clientId },
  };

  return {
    Client: {
      find: sinon.stub().resolves(mockClient),
      adapter: {
        upsert: sinon.stub().resolves(),
      },
    },
    Interaction: {
      find: sinon.stub().resolves(interaction),
    },
  };
}

/**
 * Create a complete PKCE test context with mock provider, client, and storage hook
 * @param {Object} [options] - Override options
 * @param {Object} [options.clientOptions] - Options for createMockClient
 * @param {Object} [options.providerOptions] - Options for createMockProvider
 * @returns {Object} Test context with mockClient, mockProvider, storageHook
 */
export function createPkceTestContext(options = {}) {
  const mockClient = createMockClient(options.clientOptions);
  const mockProvider = createMockProvider({
    client: mockClient,
    ...options.providerOptions,
  });
  const storageHook = createStorageHook(mockProvider);

  return {
    mockClient,
    mockProvider,
    storageHook,
  };
}

/**
 * Reset the PKCE state store (should be called in beforeEach/afterEach)
 */
export function resetPkceStore() {
  pkceStateStore.clear();
}

/**
 * Assert that PKCE state was stored in fallback storage with expected values
 * @param {Object} params - Assertion parameters
 * @param {string} params.interactionId - Expected interaction ID key
 * @param {string} params.state - Expected state value
 * @param {string} params.codeVerifier - Expected code verifier
 * @param {number} [params.expiresAt] - Expected expiration (optional)
 * @param {Object} [params.adapterUpsertStub] - Stub to verify was NOT called
 */
export function expectFallbackStoreEntry({
  interactionId,
  state,
  codeVerifier,
  expiresAt,
  adapterUpsertStub,
}) {
  expect(pkceStateStore.size).to.equal(1, 'Fallback store should have exactly 1 entry');
  expect(pkceStateStore.has(interactionId)).to.be.true;

  const stored = pkceStateStore.get(interactionId);
  expect(stored.state).to.equal(state);
  expect(stored.codeVerifier).to.equal(codeVerifier);

  if (expiresAt !== undefined) {
    expect(stored.expiresAt).to.equal(expiresAt);
  }

  if (adapterUpsertStub) {
    expect(adapterUpsertStub.called).to.be.false;
  }
}

/**
 * Assert that PKCE state was stored in client session (not fallback)
 * @param {Object} params - Assertion parameters
 * @param {Object} params.mockClient - Mock client to check
 * @param {string} params.state - Expected state value
 * @param {string} params.codeVerifier - Expected code verifier
 * @param {Object} params.adapterUpsertStub - Stub to verify was called
 */
export function expectClientSessionStorage({ mockClient, state, codeVerifier, adapterUpsertStub }) {
  expect(mockClient.identityAuthCodeVerifier).to.equal(codeVerifier);
  expect(mockClient.identityAuthState).to.equal(state);
  expect(mockClient.metadata.calledOnce).to.be.true;

  expect(adapterUpsertStub.calledOnce).to.be.true;
  expect(
    adapterUpsertStub.calledWith(
      mockClient.clientId,
      sinon.match.has('clientId', mockClient.clientId)
    )
  ).to.be.true;
  expect(pkceStateStore.size).to.equal(0, 'Fallback store should be empty');
}

/**
 * Configure mock provider to simulate "no interaction found" scenario
 * @param {Object} mockProvider - Mock provider to configure
 */
export function configureNoInteraction(mockProvider) {
  mockProvider.Interaction.find.resolves(null);
}

/**
 * Configure mock provider to simulate "interaction without client_id" scenario
 * @param {Object} mockProvider - Mock provider to configure
 */
export function configureInteractionMissingClientId(mockProvider) {
  mockProvider.Interaction.find.resolves({
    jti: 'test-interaction-id',
    params: {},
  });
}

/**
 * Configure mock provider to simulate "no client found" scenario
 * @param {Object} mockProvider - Mock provider to configure
 */
export function configureNoClient(mockProvider) {
  mockProvider.Client.find.resolves(null);
}

/**
 * Configure mock provider to simulate storage failure
 * @param {Object} mockProvider - Mock provider to configure
 * @param {string} [errorMessage='Redis connection failed'] - Error message
 */
export function configureStorageFailure(mockProvider, errorMessage = 'Redis connection failed') {
  mockProvider.Client.adapter.upsert.rejects(new Error(errorMessage));
}

/**
 * Configure mock provider to simulate retrieval failure
 * @param {Object} mockProvider - Mock provider to configure
 * @param {string} [errorMessage='Database error'] - Error message
 */
export function configureRetrievalFailure(mockProvider, errorMessage = 'Database error') {
  mockProvider.Interaction.find.rejects(new Error(errorMessage));
}

export { pkceStateStore };
