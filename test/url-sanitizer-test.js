import assert from 'assert';
import { sanitizeUrl } from '../lib/url-sanitizer.js';

describe('URL Sanitizer', function () {
  describe('sanitizeUrl', function () {
    describe('absolute URLs', function () {
      it('should remove all sensitive OAuth parameters', function () {
        const url =
          'https://example.com/auth?client_id=abc123&code_challenge=xyz&code_challenge_method=S256&state=state123&redirect_uri=https://callback.com&code=auth_code';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth');
      });

      it('should preserve non-sensitive query parameters', function () {
        const url = 'https://example.com/auth?scope=openid&response_type=code&nonce=test123';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth?scope=openid&response_type=code&nonce=test123');
      });

      it('should remove sensitive parameters while preserving non-sensitive ones', function () {
        const url =
          'https://example.com/auth?client_id=abc123&scope=openid&state=state123&response_type=code&code_challenge=xyz';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth?scope=openid&response_type=code');
      });

      it('should handle URLs without query strings', function () {
        const url = 'https://example.com/auth';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth');
      });

      it('should handle URLs with empty query strings', function () {
        const url = 'https://example.com/auth?';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth');
      });

      it('should handle URLs with only sensitive parameters', function () {
        const url = 'https://example.com/auth?client_id=abc123&state=state123';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth');
      });
    });

    describe('relative URLs', function () {
      it('should remove sensitive parameters from relative URLs', function () {
        const url = '/auth?client_id=abc123&state=state123&scope=openid';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, '/auth?scope=openid');
      });

      it('should handle relative URLs without query strings', function () {
        const url = '/auth';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, '/auth');
      });

      it('should handle relative URLs with pathname and query', function () {
        const url = '/interaction/123?code=auth_code&redirect_uri=https://callback.com';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, '/interaction/123');
      });
    });

    describe('edge cases', function () {
      it('should handle null input', function () {
        const result = sanitizeUrl(null);
        assert.strictEqual(result, '');
      });

      it('should handle undefined input', function () {
        const result = sanitizeUrl(undefined);
        assert.strictEqual(result, '');
      });

      it('should handle empty string', function () {
        const result = sanitizeUrl('');
        assert.strictEqual(result, '');
      });

      it('should handle malformed URLs gracefully', function () {
        const url = 'not-a-valid-url?client_id=abc123&state=test';
        const result = sanitizeUrl(url);
        // Should attempt to sanitize and remove sensitive params
        assert(!result.includes('client_id=abc123'), 'Should remove client_id');
        assert(!result.includes('state=test'), 'Should remove state');
      });

      it('should handle URLs with encoded parameters', function () {
        const url =
          'https://example.com/auth?client_id=abc%20123&redirect_uri=https%3A%2F%2Fcallback.com&scope=openid';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth?scope=openid');
      });

      it('should handle query parameters without values', function () {
        const url = 'https://example.com/auth?client_id&state&scope=openid';
        const result = sanitizeUrl(url);
        // Sensitive parameters without values should be removed
        assert(!result.includes('client_id'), 'Should remove sensitive client_id param');
        assert(!result.includes('state'), 'Should remove sensitive state param');
        assert(result.includes('scope=openid'), 'Should preserve non-sensitive param');
      });

      it('should handle multiple values for same parameter', function () {
        const url = 'https://example.com/auth?client_id=abc123&client_id=def456&scope=openid';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://example.com/auth?scope=openid');
      });
    });

    describe('all sensitive parameters', function () {
      it('should remove client_id', function () {
        const url = 'https://example.com/auth?client_id=abc123&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('client_id'), 'Should remove client_id');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });

      it('should remove code_challenge', function () {
        const url = 'https://example.com/auth?code_challenge=xyz789&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('code_challenge'), 'Should remove code_challenge');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });

      it('should remove code_challenge_method', function () {
        const url = 'https://example.com/auth?code_challenge_method=S256&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('code_challenge_method'), 'Should remove code_challenge_method');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });

      it('should remove state', function () {
        const url = 'https://example.com/auth?state=state123&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('state='), 'Should remove state');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });

      it('should remove redirect_uri', function () {
        const url = 'https://example.com/auth?redirect_uri=https://callback.com&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('redirect_uri'), 'Should remove redirect_uri');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });

      it('should remove code (authorization code)', function () {
        const url = 'https://example.com/auth?code=auth_code_123&scope=openid';
        const result = sanitizeUrl(url);
        assert(!result.includes('code='), 'Should remove code');
        assert(result.includes('scope=openid'), 'Should preserve scope');
      });
    });

    describe('real-world OAuth scenarios', function () {
      it('should sanitize authorization request URL', function () {
        const url =
          'https://auth.example.com/authorize?client_id=my_client&response_type=code&redirect_uri=https://app.com/callback&scope=openid%20profile&state=random_state_123&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
        const result = sanitizeUrl(url);
        assert.strictEqual(
          result,
          'https://auth.example.com/authorize?response_type=code&scope=openid%20profile'
        );
      });

      it('should sanitize callback URL with authorization code', function () {
        const url = 'https://app.com/callback?code=4/0AeanS0dXyZ&state=random_state_123';
        const result = sanitizeUrl(url);
        assert.strictEqual(result, 'https://app.com/callback');
      });

      it('should sanitize error callback URL', function () {
        const url =
          'https://app.com/callback?error=access_denied&error_description=User%20denied&state=random_state_123';
        const result = sanitizeUrl(url);
        assert.strictEqual(
          result,
          'https://app.com/callback?error=access_denied&error_description=User%20denied'
        );
      });
    });
  });
});

