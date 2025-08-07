import assert from 'assert';
import sinon from 'sinon';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { identityClientInit, identityClient, identityProviderMetadata } from '../lib/identity-client.js';
import logger from '../lib/logger.js'; // Import logger to mock it

describe('identityClientInit', function() {
  let discoveryStub;
  let loggerInfoStub;
  let loggerErrorStub;

  beforeEach(function() {
    // Mock the discovery method and logger
    discoveryStub = sinon.stub(identityClient, 'discovery');
    loggerInfoStub = sinon.stub(logger, 'info');
    loggerErrorStub = sinon.stub(logger, 'error');
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('input validation', function() {
    it('should throw error for invalid IDENTITY_SCOPE', async function() {
      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 123 // Invalid scope type
      };

      return assert.rejects(
        identityClientInit(env),
        /IDENTITY_SCOPE must contain a string of space or comma separated scopes/
      );
    });
  });

  describe('initialization via metadata file', function() {
    it('should successfully initialize from metadata file', async function() {
      // Create a temporary metadata file for testing
      const tempFile = path.join(process.cwd(), 'test-metadata.json');
      const metadataContent = {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/auth',
        token_endpoint: 'https://auth.example.com/token'
      };
      
      await writeFile(tempFile, JSON.stringify(metadataContent));
      
      try {
        // Mock the Configuration constructor
        const ConfigurationStub = sinon.stub(identityClient, 'Configuration').returns({ test: 'metadata' });

        const env = {
          IDENTITY_SERVER_URL: 'https://auth.example.com',
          IDENTITY_CLIENT_ID: 'test_client',
          IDENTITY_CLIENT_SECRET: 'test_secret',
          IDENTITY_SCOPE: 'openid profile',
          IDENTITY_SERVER_METADATA_FILE: tempFile
        };

        await identityClientInit(env);

        assert(loggerInfoStub.calledWith('Initialized identity provider from server metadata file'), 'Should log success');
        
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

    it('should handle file read errors', async function() {
      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile',
        IDENTITY_SERVER_METADATA_FILE: '/non/existent/file.json'
      };

      await assert.rejects(
        identityClientInit(env),
        (err) => {
          assert(err.message.includes('ENOENT'), 'should be a file not found error');
          return true;
        }
      );

      assert(loggerErrorStub.calledWith('Error reading IDENTITY_SERVER_METADATA_FILE'), 'Should log error');
    });
  });

  describe('initialization via discovery', function() {
    it('should successfully initialize via OIDC discovery', async function() {
      const mockMetadata = { issuer: 'https://auth.example.com' };
      discoveryStub.resolves(mockMetadata);

      const env = {
        IDENTITY_SERVER_URL: 'https://auth.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile'
      };

      await identityClientInit(env);

      assert(discoveryStub.calledOnce, 'discovery should be called once');
      const callArgs = discoveryStub.getCall(0).args;
      assert.equal(callArgs[0].href, 'https://auth.example.com/', 'should pass correct URL');
      assert.equal(callArgs[1], 'test_client', 'should pass client ID');
      assert.equal(callArgs[2], 'test_secret', 'should pass client secret');
      assert(loggerInfoStub.calledWith('Initialized identity provider using OIDC discovery'), 'Should log success');
    });

    it('should handle discovery errors and re-throw them', async function() {
      const discoveryError = new Error('Failed to connect to identity server');
      discoveryStub.rejects(discoveryError);

      const env = {
        IDENTITY_SERVER_URL: 'https://invalid.example.com',
        IDENTITY_CLIENT_ID: 'test_client',
        IDENTITY_CLIENT_SECRET: 'test_secret',
        IDENTITY_SCOPE: 'openid profile'
      };

      await assert.rejects(
        identityClientInit(env),
        (err) => {
          assert.equal(err.message, 'Failed to connect to identity server');
          return true;
        }
      );

      assert(discoveryStub.calledOnce, 'discovery should be attempted');
      assert(loggerErrorStub.calledWith('Error using OpenID Connect Discovery'), 'Should log error');
    });
  });
});