import assert from 'assert';
import sinon from 'sinon';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  identityClientInit,
  identityClient,
  refreshIdentityToken,
} from '../lib/identity-client.js';
import logger from '../lib/logger.js'; // Import logger to mock it

describe('identityClientInit', function () {
  let discoveryStub;
  let loggerInfoStub;
  let loggerErrorStub;

  beforeEach(function () {
    // Mock the discovery method and logger
    discoveryStub = sinon.stub(identityClient, 'discovery');
    loggerInfoStub = sinon.stub(logger, 'info');
    loggerErrorStub = sinon.stub(logger, 'error');
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('input validation', function () {
    it('should throw error for invalid IDENTITY_SCOPE', async function () {
      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 123, // Invalid scope type
      };

      return assert.rejects(
        identityClientInit(env),
        /IDENTITY_SCOPE must contain a string of space or comma separated scopes/
      );
    });
  });

  describe('initialization via metadata file', function () {
    it('should successfully initialize from metadata file', async function () {
      // Create a temporary metadata file for testing
      const tempFile = path.join(process.cwd(), 'test-metadata.json');
      const metadataContent = {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/auth',
        token_endpoint: 'https://auth.example.com/token',
      };

      await writeFile(tempFile, JSON.stringify(metadataContent));

      try {
        // Mock the Configuration constructor
        const ConfigurationStub = sinon
          .stub(identityClient, 'Configuration')
          .returns({ test: 'metadata' });

        const env = {
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          IDENTITY_CLIENT_ID: 'test_client',
          IDENTITY_CLIENT_SECRET: 'test_secret',
          IDENTITY_SCOPE: 'openid profile',
          IDENTITY_SERVER_METADATA_FILE: tempFile,
        };

        await identityClientInit(env);

        assert(
          loggerInfoStub.calledWith('Initialized identity provider from server metadata file'),
          'Should log success'
        );

        // Verify Configuration was called with correct parameters
        assert(ConfigurationStub.calledOnce, 'Configuration should be called once');
        const configArgs = ConfigurationStub.getCall(0).args;
        assert.deepEqual(configArgs[0], metadataContent, 'should pass correct metadata');
        assert.equal(configArgs[1], 'test_client', 'should pass client ID');
        assert.equal(configArgs[2], 'test_secret', 'should pass client secret');

        ConfigurationStub.restore();
      } finally {
        // Clean up the temporary file
        await unlink(tempFile);
      }
    });

    it('should handle file read errors', async function () {
      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile',
        IDENTITY_SERVER_METADATA_FILE: '/non/existent/file.json',
      };

      await assert.rejects(identityClientInit(env), (err) => {
        assert(err.message.includes('ENOENT'), 'should be a file not found error');
        return true;
      });

      assert(
        loggerErrorStub.calledWith('Error reading IDENTITY_SERVER_METADATA_FILE'),
        'Should log error'
      );
    });
  });

  describe('initialization via discovery', function () {
    it('should successfully initialize via OIDC discovery', async function () {
      const mockMetadata = { issuer: 'https://auth.example.com' };
      discoveryStub.resolves(mockMetadata);

      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile',
      };

      await identityClientInit(env);

      assert(discoveryStub.calledOnce, 'discovery should be called once');
      const callArgs = discoveryStub.getCall(0).args;
      assert.equal(callArgs[0].href, 'https://auth.example.com/', 'should pass correct URL');
      assert.equal(callArgs[1], 'test_client', 'should pass client ID');
      assert.equal(callArgs[2], 'test_secret', 'should pass client secret');
      assert(
        loggerInfoStub.calledWith('Initialized identity provider using OIDC discovery'),
        'Should log success'
      );
    });

    it('should handle discovery errors and re-throw them', async function () {
      const discoveryError = new Error('Failed to connect to identity server');
      discoveryStub.rejects(discoveryError);

      const env = {
        IDENTITY_SERVER_URL: 'https://invalid.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile',
      };

      await assert.rejects(identityClientInit(env), (err) => {
        assert.equal(err.message, 'Failed to connect to identity server');
        return true;
      });

      assert(discoveryStub.calledOnce, 'discovery should be attempted');
      assert(
        loggerErrorStub.calledWith('Error using OpenID Connect Discovery'),
        'Should log error'
      );
    });
  });
});

describe('refreshIdentityToken', function () {
  let refreshTokenGrantStub;

  beforeEach(function () {
    // Mock the refreshTokenGrant method
    refreshTokenGrantStub = sinon.stub(identityClient, 'refreshTokenGrant');
  });

  afterEach(function () {
    sinon.restore();
  });

  it('should successfully refresh token and update client', async function () {
    // Mock the refresh token grant response
    const mockTokenResponse = {
      access_token: 'new_access_token',
      signature: 'new_signature',
      scope: 'openid profile',
      token_type: 'Bearer',
      issued_at: 1234567890,
    };
    refreshTokenGrantStub.resolves(mockTokenResponse);

    // Mock provider and client
    const mockUpsert = sinon.stub().resolves();
    const mockProvider = {
      Client: {
        adapter: {
          upsert: mockUpsert,
        },
      },
    };
    const mockClient = {
      clientId: 'test_client_id',
      identityAuthRefreshToken: 'old_refresh_token',
      metadata: sinon.stub().returns({ test: 'metadata' }),
    };

    // Since module was already initialized by previous tests, this should work
    await refreshIdentityToken(mockProvider, mockClient);

    // Verify refreshTokenGrant was called correctly
    assert(refreshTokenGrantStub.calledOnce, 'refreshTokenGrant should be called once');
    const grantArgs = refreshTokenGrantStub.getCall(0).args;
    assert.equal(grantArgs[1], 'old_refresh_token', 'should pass refresh token');

    // Verify client was updated with new token data
    assert.equal(
      mockClient.identityAuthAccessToken,
      'new_access_token',
      'should update access token'
    );
    assert.equal(mockClient.identityAuthSignature, 'new_signature', 'should update signature');
    assert.equal(mockClient.identityAuthScope, 'openid profile', 'should update scope');
    assert.equal(mockClient.identityAuthTokenType, 'Bearer', 'should update token type');
    assert.equal(mockClient.identityAuthIssuedAt, 1234567890, 'should update issued at');

    // Verify upsert was called with correct parameters
    assert(mockUpsert.calledOnce, 'upsert should be called once');
    const upsertArgs = mockUpsert.getCall(0).args;
    assert.equal(upsertArgs[0], 'test_client_id', 'should pass client ID');
    assert.deepEqual(upsertArgs[1], { test: 'metadata' }, 'should pass client metadata');
  });
});
