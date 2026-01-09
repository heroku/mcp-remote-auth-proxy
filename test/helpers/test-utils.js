/**
 * General test utilities for reducing code duplication across test files
 */

import { expect } from 'chai';

/**
 * Assert that an async function throws an error containing the expected message
 * @param {Function} asyncFn - Async function to execute
 * @param {string} messageSubstring - Expected substring in error message
 * @param {string} [failMessage] - Custom message if assertion fails
 * @returns {Promise<Error>} The caught error for additional assertions
 */
export async function expectThrowsWithMessage(asyncFn, messageSubstring, failMessage) {
  try {
    await asyncFn();
    expect.fail(failMessage || `Expected function to throw error containing "${messageSubstring}"`);
  } catch (error) {
    if (error.message?.includes('Expected function to throw')) {
      throw error; // Re-throw expect.fail errors
    }
    expect(error.message).to.include(messageSubstring);
    return error;
  }
}

/**
 * Assert that an async function throws an error with exact message match
 * @param {Function} asyncFn - Async function to execute
 * @param {string} exactMessage - Expected exact error message
 * @returns {Promise<Error>} The caught error for additional assertions
 */
export async function expectThrowsExactMessage(asyncFn, exactMessage) {
  try {
    await asyncFn();
    expect.fail(`Expected function to throw error: "${exactMessage}"`);
  } catch (error) {
    if (error.message?.includes('Expected function to throw')) {
      throw error;
    }
    expect(error.message).to.equal(exactMessage);
    return error;
  }
}

/**
 * Assert that a function throws an initialization error
 * Specifically for testing functions that require identityClientInit to be called first
 * @param {Function} asyncFn - Async function to execute
 * @returns {Promise<Error>} The caught error
 */
export async function expectInitError(asyncFn) {
  return expectThrowsWithMessage(
    asyncFn,
    'identityClientInit',
    'Expected function to throw initialization error'
  );
}

/**
 * Generate a future expiration timestamp
 * @param {number} [minutes=10] - Minutes from now
 * @returns {number} Timestamp in milliseconds
 */
export function futureExpiry(minutes = 10) {
  return Date.now() + minutes * 60 * 1000;
}

/**
 * Generate a past expiration timestamp
 * @param {number} [ms=1000] - Milliseconds in the past
 * @returns {number} Timestamp in milliseconds
 */
export function pastExpiry(ms = 1000) {
  return Date.now() - ms;
}

/**
 * Create standard PKCE state data object
 * @param {Object} options - Override options
 * @param {string} [options.interactionId] - Interaction identifier
 * @param {string} [options.state] - OAuth state parameter
 * @param {string} [options.codeVerifier] - PKCE code verifier
 * @param {number} [options.expiresAt] - Expiration timestamp
 * @returns {Object} PKCE state data
 */
export function createPkceStateData(options = {}) {
  return {
    interactionId: options.interactionId || 'test-interaction-id',
    state: options.state || 'test-state-param',
    codeVerifier: options.codeVerifier || 'test-code-verifier-abc123',
    expiresAt: options.expiresAt ?? futureExpiry(),
  };
}
