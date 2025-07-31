import assert from 'assert';
import { 
  refreshIdentityToken, 
  RefreshTokenExpiredError, 
  TokenRefreshError, 
  identityClient,
  identityClientInit 
} from './lib/identity-client.js';

// Test error classification behavior (Chunk 2: Real behavior testing)
async function testErrorClassification() {
  console.log('🧪 Testing Error Classification Logic (Chunk 2)...\n');

  // Initialize the client for testing
  await identityClientInit({
    IDENTITY_SERVER_URL: 'http://localhost:3002',
    IDENTITY_CLIENT_ID: 'test-client',
    IDENTITY_CLIENT_SECRET: 'test-secret',
    IDENTITY_SCOPE: '["openid", "profile"]',
    IDENTITY_SERVER_METADATA_FILE: './test/mocks/idp_metadata.json'
  });

  const mockProvider = {
    Client: { adapter: { upsert: async () => {} } }
  };

  const mockClient = {
    identityAuthRefreshToken: 'test-refresh-token',
    clientId: 'test-client',
    metadata: () => ({})
  };

  // Store original function to restore later
  const originalRefreshTokenGrant = identityClient.refreshTokenGrant;

  try {
    // Test 1: invalid_grant error should become RefreshTokenExpiredError
    console.log('Test 1: invalid_grant → RefreshTokenExpiredError');
    identityClient.refreshTokenGrant = async () => {
      throw { error: 'invalid_grant', message: 'Refresh token expired' };
    };

    try {
      await refreshIdentityToken(mockProvider, mockClient);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert(err instanceof RefreshTokenExpiredError, 'Should be RefreshTokenExpiredError');
      assert(err.message.includes('Refresh token expired, full re-authentication required'));
      assert.strictEqual(err.isRecoverable, true);
      assert.strictEqual(err.shouldRetry, false);
      console.log('✅ invalid_grant correctly classified');
    }

    // Test 2: Network error should become TokenRefreshError
    console.log('\nTest 2: ECONNREFUSED → TokenRefreshError');
    identityClient.refreshTokenGrant = async () => {
      throw { code: 'ECONNREFUSED', message: 'Connection refused' };
    };

    try {
      await refreshIdentityToken(mockProvider, mockClient);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert(err instanceof TokenRefreshError, 'Should be TokenRefreshError');
      assert(err.message.includes('Network error during token refresh'));
      assert.strictEqual(err.isRecoverable, false);
      assert.strictEqual(err.shouldRetry, true);
      assert(err.originalError.code === 'ECONNREFUSED');
      console.log('✅ Network error correctly classified');
    }

    // Test 3: Server error should become TokenRefreshError
    console.log('\nTest 3: HTTP 500 → TokenRefreshError');
    identityClient.refreshTokenGrant = async () => {
      throw { status: 500, message: 'Internal Server Error' };
    };

    try {
      await refreshIdentityToken(mockProvider, mockClient);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert(err instanceof TokenRefreshError, 'Should be TokenRefreshError');
      assert(err.message.includes('Server error during token refresh (500)'));
      assert.strictEqual(err.shouldRetry, true);
      console.log('✅ Server error correctly classified');
    }

    // Test 4: Unknown error should become TokenRefreshError
    console.log('\nTest 4: Unknown error → TokenRefreshError');
    identityClient.refreshTokenGrant = async () => {
      throw { someUnknownProp: true, message: 'Mystery error' };
    };

    try {
      await refreshIdentityToken(mockProvider, mockClient);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert(err instanceof TokenRefreshError, 'Should be TokenRefreshError');
      assert(err.message.includes('Token refresh failed'));
      console.log('✅ Unknown error correctly classified');
    }

    // Test 5: invalid_token error should become RefreshTokenExpiredError
    console.log('\nTest 5: invalid_token → RefreshTokenExpiredError');
    identityClient.refreshTokenGrant = async () => {
      throw { error: 'invalid_token', message: 'Token is invalid' };
    };

    try {
      await refreshIdentityToken(mockProvider, mockClient);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert(err instanceof RefreshTokenExpiredError, 'Should be RefreshTokenExpiredError');
      console.log('✅ invalid_token correctly classified');
    }

    console.log('\n🎉 Chunk 2 Complete: Error classification logic working correctly!');
    console.log('📝 Next: Chunk 3 will enhance proxy error handling');

  } finally {
    // Restore original function
    identityClient.refreshTokenGrant = originalRefreshTokenGrant;
  }
}

try {
  await testErrorClassification();
  console.log('\n✅ All error classification tests passed!');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
} 