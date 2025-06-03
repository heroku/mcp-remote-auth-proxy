import assert from 'assert';

import server from '../lib/server.js';

describe('server', function () {
  describe('without env', function () {
    it('should crash', function () {
      assert.throws(() => server());
    });
  });
});
