import { strict as assert } from 'node:assert';
import { getBrandingConfig, isHerokuProvider } from '../lib/branding-config.js';

describe('Branding Configuration', function() {
  const originalEnv = process.env;

  beforeEach(function() {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
  });

  afterEach(function() {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('isHerokuProvider', function() {
    it('should return true when BRANDING_PROVIDER is set to heroku', function() {
      // Clear any conflicting values from .env-test
      delete process.env.IDENTITY_SERVER_URL;
      process.env.BRANDING_PROVIDER = 'heroku';
      assert(isHerokuProvider(), 'Should detect Heroku when BRANDING_PROVIDER is set to heroku');
    });

    it('should return true when IDENTITY_SERVER_URL contains heroku.com', function() {
      process.env.IDENTITY_SERVER_URL = 'https://id.heroku.com/';
      assert(isHerokuProvider(), 'Should detect Heroku when IDENTITY_SERVER_URL contains heroku.com');
    });

    it('should return true when IDENTITY_SERVER_URL contains herokudev.com', function() {
      process.env.IDENTITY_SERVER_URL = 'https://identity.staging.herokudev.com/';
      assert(isHerokuProvider(), 'Should detect Heroku when IDENTITY_SERVER_URL contains herokudev.com');
    });

    it('should return false for generic providers', function() {
      process.env.IDENTITY_SERVER_URL = 'https://auth.example.com/';
      assert(!isHerokuProvider(), 'Should not detect Heroku for generic providers');
    });

    it('should return false when no relevant environment variables are set', function() {
      delete process.env.BRANDING_PROVIDER;
      delete process.env.IDENTITY_SERVER_URL;
      assert(!isHerokuProvider(), 'Should not detect Heroku when no relevant env vars are set');
    });
  });

  describe('getBrandingConfig', function() {
    it('should return Heroku branding when Heroku is detected', function() {
      process.env.IDENTITY_SERVER_URL = 'https://id.heroku.com/';
      const config = getBrandingConfig();
      
      assert(config.title.includes('Heroku'), 'Title should include Heroku');
      assert(config.favicon === 'https://www.herokucdn.com/favicon.ico', 'Should use Heroku favicon');
      assert(config.colors.primary === '#8363a1', 'Should use Heroku primary color');
      assert(config.colors.background.includes('linear-gradient'), 'Should use Heroku gradient background');
    });

    it('should return generic branding when Heroku is not detected', function() {
      process.env.IDENTITY_SERVER_URL = 'https://auth.example.com/';
      const config = getBrandingConfig();
      
      assert(!config.title.includes('Heroku'), 'Title should not include Heroku');
      assert(config.favicon === '/favicon.svg', 'Should use generic favicon');
      assert(config.colors.primary === '#4a5568', 'Should use generic primary color');
      assert(config.colors.background.includes('linear-gradient'), 'Should use generic gradient background');
    });

    it('should use custom BRANDING_TITLE when provided', function() {
      process.env.BRANDING_TITLE = 'Custom Auth Service';
      process.env.IDENTITY_SERVER_URL = 'https://auth.example.com/';
      const config = getBrandingConfig();
      
      assert(config.title === 'Custom Auth Service', 'Should use custom title');
    });

    it('should use custom BRANDING_FAVICON when provided', function() {
      process.env.BRANDING_FAVICON = 'https://example.com/custom-favicon.ico';
      process.env.IDENTITY_SERVER_URL = 'https://auth.example.com/';
      const config = getBrandingConfig();
      
      assert(config.favicon === 'https://example.com/custom-favicon.ico', 'Should use custom favicon');
    });

    it('should append Heroku to custom title when Heroku is detected', function() {
      process.env.BRANDING_TITLE = 'Custom Auth Service';
      process.env.IDENTITY_SERVER_URL = 'https://id.heroku.com/';
      const config = getBrandingConfig();
      
      assert(config.title === 'Custom Auth Service | Heroku', 'Should append Heroku to custom title');
    });
  });
}); 