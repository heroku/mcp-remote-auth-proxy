import sinon from 'sinon';
import assert from 'assert';
import { default as defaultLogger, createRequestLogger } from '../lib/logger.js';

describe('Logger', function () {
  let stdoutStub;

  beforeEach(function () {
    // Winston Console transport writes to process.stdout rather than console.log
    stdoutStub = sinon.stub(process.stdout, 'write');
  });

  afterEach(function () {
    stdoutStub.restore();
  });

  describe('default logger', function () {
    it('should log a splunk-formatted message', function () {
      const message = 'Hello, world!';
      const meta = { foo: 'bar', baz: 123 };
      
      defaultLogger.info(message, meta);

      // Assert that stdout.write was called
      assert(stdoutStub.calledOnce, 'process.stdout.write should be called once');
      
      // Get the actual arguments passed to stdout.write
      const loggedArgs = stdoutStub.getCall(0).args;
      const logLine = loggedArgs[0];
  
      assert(logLine.includes(message), `Log line should contain message: ${message}`);
      assert(logLine.includes('foo=bar'), 'Log line should contain foo=bar');
      assert(logLine.includes('baz=123'), 'Log line should contain baz=123');
      assert(logLine.includes('app=mcp-auth-proxy'), 'Log line should contain app name');
      assert(logLine.includes('proxy=true'), 'Log line should contain proxy=true');
    });
  });

  describe('request logger', function () {
    describe('with a request', function () {
      let req;

      beforeEach(function () {
        req = {
          method: 'GET',
          path: '/test',
          query: {},
          body: {},
          headers: {}
        };
      });

      describe('when the request-id header is present', function () {
        beforeEach(function () {
          req.headers['x-request-id'] = '123';
        });

        it('should log a splunk-formatted message with request-id', function () {
          const reqLogger = createRequestLogger(req);
          reqLogger.info('Hello, world!');

          const loggedArgs = stdoutStub.getCall(0).args;
          const logLine = loggedArgs[0];

          assert(logLine.includes('Hello, world!'), 'Log line should contain message');
          assert(logLine.includes('request-id=123'), 'Log line should contain request-id');
        });
      });

      describe('when the request-id header is not present', function () {
        beforeEach(function () {
          delete req.headers['request-id'];
        });

        it('should log a splunk-formatted message without request-id', function () {
          const reqLogger = createRequestLogger(req);
          reqLogger.info('Hello, world!');

          const loggedArgs = stdoutStub.getCall(0).args;
          const logLine = loggedArgs[0];

          assert(logLine.includes('Hello, world!'), 'Log line should contain message');
          assert(!logLine.includes('request-id'), 'Log line should not contain request-id');
        });
      });

      it('should log a splunk-formatted message with method and path', function () {
        const reqLogger = createRequestLogger(req);
        reqLogger.info('Hello, world!');

        const loggedArgs = stdoutStub.getCall(0).args;
        const logLine = loggedArgs[0];

        assert(logLine.includes('Hello, world!'), 'Log line should contain message');
        assert(logLine.includes('method=GET'), 'Log line should contain method');
        assert(logLine.includes('path=/test'), 'Log line should contain path');
      });
    });

    describe('without a request', function () {
      it('should log a splunk-formatted message', function () {
        const reqLogger = createRequestLogger();
        reqLogger.info('Hello, world!');

        const loggedArgs = stdoutStub.getCall(0).args;
        const logLine = loggedArgs[0];

        assert(logLine.includes('Hello, world!'), 'Log line should contain message');
        assert(logLine.includes('app=mcp-auth-proxy'), 'Log line should contain app name');
        assert(logLine.includes('proxy=true'), 'Log line should contain proxy=true');
      });
    });
  });
});
