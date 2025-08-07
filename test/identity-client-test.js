import assert from 'assert';
import sinon from 'sinon';
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