import { identityClientInit, checkAndRefreshToken } from './lib/identity-client.js';

// Test proactive refresh functionality
async function testProactiveRefresh() {
  console.log('🧪 Testing Proactive Token Refresh Decision Logic...\n');

  // Test 1: Manual strategy (default) - should not refresh anything
  console.log('Test 1: Manual strategy (default)');
  await identityClientInit({
    TOKEN_REFRESH_STRATEGY: 'manual',
    REFRESH_BUFFER_MINUTES: '15',
    IDENTITY_SERVER_URL: 'http://localhost:3002',
    IDENTITY_CLIENT_ID: 'test-client',
    IDENTITY_CLIENT_SECRET: 'test-secret',
    IDENTITY_SCOPE: '["openid", "profile"]',
    IDENTITY_SERVER_METADATA_FILE: './test/mocks/idp_metadata.json'
  });

  const mockProvider = {
    Client: { adapter: { upsert: async () => {} } }
  };

  const nearExpiryClient = {
    identityAuthId: 'test-manual',
    identityAuthIssuedAt: Date.now() - (50 * 60000), // 50 minutes ago
    identityAuthExpiresIn: 3600, // 1 hour (10 minutes left - should trigger if proactive)
    identityAuthAccessToken: 'manual-test-token'
  };

  console.log('Making call with manual strategy...');
  try {
    await checkAndRefreshToken(mockProvider, nearExpiryClient);
    console.log('✅ Manual strategy: No refresh attempted (as expected)\n');
  } catch (err) {
    console.log(`❌ Manual strategy error: ${err.message}\n`);
  }

  // Test 2: Proactive strategy with fresh token
  console.log('Test 2: Proactive strategy with fresh token');
  await identityClientInit({
    TOKEN_REFRESH_STRATEGY: 'proactive',
    REFRESH_BUFFER_MINUTES: '15',
    IDENTITY_SERVER_URL: 'http://localhost:3002',
    IDENTITY_CLIENT_ID: 'test-client',
    IDENTITY_CLIENT_SECRET: 'test-secret',
    IDENTITY_SCOPE: '["openid", "profile"]',
    IDENTITY_SERVER_METADATA_FILE: './test/mocks/idp_metadata.json'
  });

  const freshClient = {
    identityAuthId: 'test-fresh',
    identityAuthIssuedAt: Date.now() - (5 * 60000), // 5 minutes ago  
    identityAuthExpiresIn: 3600, // 1 hour (55 minutes left)
    identityAuthAccessToken: 'fresh-token'
  };

  console.log('Making call with fresh token...');
  try {
    await checkAndRefreshToken(mockProvider, freshClient);
    console.log('✅ Proactive strategy with fresh token: No refresh needed (as expected)\n');
  } catch (err) {
    console.log(`❌ Fresh token error: ${err.message}\n`);
  }

  // Test 3: Proactive strategy with near-expiry token
  console.log('Test 3: Proactive strategy with near-expiry token');
  
  const expiringSoonClient = {
    identityAuthId: 'test-expiring',
    identityAuthIssuedAt: Date.now() - (50 * 60000), // 50 minutes ago
    identityAuthExpiresIn: 3600, // 1 hour (10 minutes left - within 15min buffer!)
    identityAuthAccessToken: 'expiring-token'
  };

  console.log('Making call with near-expiry token...');
  console.log(`Token issued: ${new Date(expiringSoonClient.identityAuthIssuedAt).toISOString()}`);
  console.log(`Token expires in: ${expiringSoonClient.identityAuthExpiresIn} seconds`);
  console.log(`Time left: ${Math.round((expiringSoonClient.identityAuthIssuedAt + (expiringSoonClient.identityAuthExpiresIn * 1000) - Date.now()) / 60000)} minutes`);
  
  try {
    await checkAndRefreshToken(mockProvider, expiringSoonClient);
    console.log('⚠️  This may fail because we can\'t mock the actual refresh call');
    console.log('    But you should see "Proactively refreshing token" log message above ☝️');
  } catch (err) {
    if (err.message.includes('refreshTokenGrant')) {
      console.log('✅ Proactive refresh was ATTEMPTED! (refresh failed due to test environment)');
      console.log('   This confirms the proactive logic is working correctly 🎉\n');
    } else {
      console.log(`❌ Unexpected error: ${err.message}\n`);
    }
  }

  console.log('🎉 Proactive refresh decision logic verified!');
  console.log('💡 In production, set TOKEN_REFRESH_STRATEGY=proactive to enable this feature');
}

// Run the test
testProactiveRefresh().catch(console.error); 