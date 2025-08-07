import assert from 'node:assert';
import { describe, it } from 'mocha';
import { interactionPolicy } from 'oidc-provider';
import policy from '../lib/interaction-policy.js';

describe('interaction-policy', function() {
  it('should export an interaction policy instance', function() {
    assert(policy, 'should export a policy');
    assert.equal(typeof policy.get, 'function', 'should have get method');
    assert.equal(typeof policy.add, 'function', 'should have add method');
  });

  it('should have confirm-login prompt added', function() {
    const confirmLoginPrompt = policy.get('confirm-login');
    assert(confirmLoginPrompt, 'should have confirm-login prompt');
    assert.equal(confirmLoginPrompt.name, 'confirm-login', 'should have correct name');
    assert.equal(confirmLoginPrompt.requestable, true, 'should be requestable');
  });

  it('should not have consent prompt (removed)', function() {
    const consentPrompt = policy.get('consent');
    assert.equal(consentPrompt, undefined, 'consent prompt should be removed');
  });

  describe('is_login_confirmed check', function() {
    let confirmLoginPrompt;
    let loginConfirmedCheck;

    beforeEach(function() {
      confirmLoginPrompt = policy.get('confirm-login');
      loginConfirmedCheck = confirmLoginPrompt.checks.find(check => check.reason === 'is_login_confirmed');
    });

    it('should request prompt when identityLoginConfirmed is falsy', function() {
      // Test case covering lines 12-15: when !oidc.client['identityLoginConfirmed'] is true
      const mockContext = {
        oidc: {
          client: {
            // identityLoginConfirmed is undefined (falsy)
          }
        }
      };

      const result = loginConfirmedCheck.check(mockContext);
      assert.equal(result, interactionPolicy.Check.REQUEST_PROMPT, 
                   'should request prompt when identityLoginConfirmed is falsy');
    });

    it('should request prompt when identityLoginConfirmed is explicitly false', function() {
      // Another test case for lines 12-15
      const mockContext = {
        oidc: {
          client: {
            identityLoginConfirmed: false
          }
        }
      };

      const result = loginConfirmedCheck.check(mockContext);
      assert.equal(result, interactionPolicy.Check.REQUEST_PROMPT, 
                   'should request prompt when identityLoginConfirmed is false');
    });

    it('should not need prompt when identityLoginConfirmed is truthy', function() {
      // Test case covering lines 17: when !oidc.client['identityLoginConfirmed'] is false
      const mockContext = {
        oidc: {
          client: {
            identityLoginConfirmed: true
          }
        }
      };

      const result = loginConfirmedCheck.check(mockContext);
      assert.equal(result, interactionPolicy.Check.NO_NEED_TO_PROMPT, 
                   'should not need prompt when identityLoginConfirmed is true');
    });
  });
});