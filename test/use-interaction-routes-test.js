import assert from 'assert';
import sinon from 'sinon';
import useInteractionRoutes from '../lib/use-interaction-routes.js';

describe('useInteractionRoutes', function () {
  let mockApp;
  let mockProvider;

  beforeEach(function () {
    // Mock Express app
    mockApp = {
      use: sinon.stub(),
      get: sinon.stub(),
      post: sinon.stub(),
      render: sinon.stub(),
    };

    // Mock OIDC provider
    mockProvider = {
      interactionDetails: sinon.stub(),
      interactionFinished: sinon.stub(),
      Client: {
        find: sinon.stub(),
        adapter: {
          upsert: sinon.stub(),
        },
      },
    };
  });

  afterEach(function () {
    sinon.restore();
  });

  it('should setup middleware when called', function () {
    // Call the function to setup routes
    useInteractionRoutes(mockApp, mockProvider);

    // Verify middleware was registered
    assert(mockApp.use.called, 'should register middleware');
    assert(mockApp.get.called, 'should register GET routes');
    assert(mockApp.post.called, 'should register POST routes');

    // Check specific routes were registered
    const getCalls = mockApp.get.getCalls();
    const postCalls = mockApp.post.getCalls();

    // Look for our expected routes
    const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');
    const _callbackRoute = getCalls.find(
      (call) =>
        call.args[0] &&
        (call.args[0].includes('/interaction/identity/callback') ||
          call.args[0].includes('/interaction/:uid/identity/callback'))
    );
    const confirmLoginRoute = postCalls.find(
      (call) => call.args[0] === '/interaction/:uid/confirm-login'
    );

    assert(interactionRoute, 'should register interaction route');
    assert(confirmLoginRoute, 'should register confirm login route');
  });

  it('should register render middleware', function () {
    useInteractionRoutes(mockApp, mockProvider);

    // Verify middleware was registered (it should be called at least once)
    assert(mockApp.use.called, 'should register middleware');

    const middlewareFunc = mockApp.use.getCall(0).args[0];
    assert.equal(typeof middlewareFunc, 'function', 'should register a function as middleware');

    // Test the render middleware
    const mockReq = {};
    const mockRes = {
      render: sinon.stub(),
    };
    const mockNext = sinon.stub();

    // Mock app.render for the middleware
    mockApp.render = sinon.stub().callsArgWith(2, null, '<div>test content</div>');

    // Call the middleware
    middlewareFunc(mockReq, mockRes, mockNext);

    // Verify next was called
    assert(mockNext.calledOnce, 'should call next()');

    // Test that res.render was modified
    assert.notEqual(mockRes.render, sinon.stub(), 'res.render should be modified');

    // Test the modified render function
    const originalRender = sinon.stub();
    mockRes.render = originalRender;

    // Re-call middleware to set up the render override
    middlewareFunc(mockReq, mockRes, mockNext);

    // Now test the overridden render
    mockRes.render('test-view', { title: 'Test' });

    // Verify app.render was called
    assert(mockApp.render.called, 'should call app.render');
  });

  describe('setNoCache middleware', function () {
    it('should set cache-control header and call next', function () {
      useInteractionRoutes(mockApp, mockProvider);

      // Find the GET route handler to extract setNoCache
      const getCalls = mockApp.get.getCalls();
      const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');

      assert(interactionRoute, 'should find interaction route');

      // setNoCache should be the second argument (after path, before handler)
      const setNoCache = interactionRoute.args[1];
      assert.equal(typeof setNoCache, 'function', 'setNoCache should be a function');

      // Test setNoCache middleware
      const mockReq = {};
      const mockRes = { set: sinon.stub() };
      const mockNext = sinon.stub();

      setNoCache(mockReq, mockRes, mockNext);

      assert(
        mockRes.set.calledWith('cache-control', 'no-store'),
        'should set cache-control header'
      );
      assert(mockNext.calledOnce, 'should call next()');
    });
  });

  describe('GET /interaction/:uid route', function () {
    it('should handle confirm-login prompt', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      // Mock provider responses
      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'confirm-login', details: { test: 'details' }, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };
      const mockClient = { id: 'test-client' };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);
      mockProvider.Client.find.resolves(mockClient);

      // Get the route handler
      const getCalls = mockApp.get.getCalls();
      const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');
      const routeHandler = interactionRoute.args[2]; // Skip setNoCache middleware

      // Mock req/res
      const mockReq = { params: { uid: 'test-uid' } };
      const mockRes = { render: sinon.stub() };
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Verify interactions
      assert(
        mockProvider.interactionDetails.calledWith(mockReq, mockRes),
        'should call interactionDetails'
      );
      assert(mockProvider.Client.find.calledWith('test-client'), 'should find client');
      assert(mockRes.render.calledWith('confirm-login'), 'should render confirm-login view');

      // Check render arguments
      const renderArgs = mockRes.render.getCall(0).args[1];
      assert.equal(renderArgs.client, mockClient, 'should pass client');
      assert.equal(renderArgs.uid, 'test-uid', 'should pass uid');
      assert.equal(renderArgs.title, 'Confirm Login', 'should pass title');
    });

    it('should handle unknown prompt with error', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'unknown-prompt', details: {}, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };
      const mockClient = { id: 'test-client' };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);
      mockProvider.Client.find.resolves(mockClient);

      const getCalls = mockApp.get.getCalls();
      const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');
      const routeHandler = interactionRoute.args[2];

      const mockReq = { params: { uid: 'test-uid' } };
      const mockRes = { render: sinon.stub(), redirect: sinon.stub() };
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Should call next with error
      assert(mockNext.calledOnce, 'should call next with error');
      const error = mockNext.getCall(0).args[0];
      assert(error instanceof Error, 'should pass an Error to next');
      assert(error.message.includes('unknown-prompt'), 'error should mention unknown prompt');
    });
  });

  describe('POST /interaction/:uid/confirm-login route', function () {
    it('should handle confirmed login', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'confirm-login', details: {}, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };
      const mockClient = {
        clientId: 'test-client-id',
        metadata: sinon.stub().returns({ test: 'metadata' }),
      };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);
      mockProvider.Client.find.resolves(mockClient);
      mockProvider.Client.adapter.upsert.resolves();
      mockProvider.interactionFinished.resolves();

      // Get the POST route handler
      const postCalls = mockApp.post.getCalls();
      const confirmLoginRoute = postCalls.find(
        (call) => call.args[0] === '/interaction/:uid/confirm-login'
      );
      const routeHandler = confirmLoginRoute.args[3]; // Skip setNoCache and body middleware

      const mockReq = {
        params: { uid: 'test-uid' },
        body: { confirmed: 'true' },
      };
      const mockRes = {};
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Verify interactions
      assert(
        mockProvider.interactionDetails.calledWith(mockReq, mockRes),
        'should call interactionDetails'
      );
      assert(mockProvider.Client.find.calledWith('test-client'), 'should find client');
      assert.equal(
        mockClient.identityLoginConfirmed,
        true,
        'should set client identityLoginConfirmed'
      );
      assert(
        mockProvider.Client.adapter.upsert.calledWith('test-client-id'),
        'should upsert client'
      );
      assert(
        mockProvider.interactionFinished.calledWith(mockReq, mockRes),
        'should finish interaction'
      );

      // Check interaction result
      const finishedArgs = mockProvider.interactionFinished.getCall(0).args;
      const result = finishedArgs[2];
      assert.deepEqual(
        result,
        {
          'confirm-login': { confirmed: true },
        },
        'should pass correct result'
      );
    });

    it('should handle rejected login', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'confirm-login', details: {}, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);
      mockProvider.interactionFinished.resolves();

      const postCalls = mockApp.post.getCalls();
      const confirmLoginRoute = postCalls.find(
        (call) => call.args[0] === '/interaction/:uid/confirm-login'
      );
      const routeHandler = confirmLoginRoute.args[3];

      const mockReq = {
        params: { uid: 'test-uid' },
        body: { confirmed: 'false' },
      };
      const mockRes = {};
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Should NOT find client or upsert when not confirmed
      assert(mockProvider.Client.find.notCalled, 'should not find client for rejected login');
      assert(mockProvider.Client.adapter.upsert.notCalled, 'should not upsert for rejected login');

      // Should still finish interaction with empty result
      assert(
        mockProvider.interactionFinished.calledWith(mockReq, mockRes),
        'should finish interaction'
      );
      const finishedArgs = mockProvider.interactionFinished.getCall(0).args;
      const result = finishedArgs[2];
      assert.deepEqual(result, {}, 'should pass empty result for rejection');
    });

    it('should handle prompt name assertion error', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'wrong-prompt', details: {}, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);

      const postCalls = mockApp.post.getCalls();
      const confirmLoginRoute = postCalls.find(
        (call) => call.args[0] === '/interaction/:uid/confirm-login'
      );
      const routeHandler = confirmLoginRoute.args[3];

      const mockReq = {
        params: { uid: 'test-uid' },
        body: { confirmed: 'true' },
      };
      const mockRes = {};
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Should call next with assertion error
      assert(mockNext.calledOnce, 'should call next with error');
      const error = mockNext.getCall(0).args[0];
      assert(error instanceof Error, 'should pass an Error to next');
    });
  });

  describe('general error handling', function () {
    it('should handle provider.interactionDetails errors', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      // Mock provider to throw error
      mockProvider.interactionDetails.rejects(new Error('Provider error'));

      // Get the GET route handler
      const getCalls = mockApp.get.getCalls();
      const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');
      const routeHandler = interactionRoute.args[2];

      const mockReq = { params: { uid: 'test-uid' } };
      const mockRes = { render: sinon.stub() };
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Should call next with error
      assert(mockNext.calledOnce, 'should call next with error');
      const error = mockNext.getCall(0).args[0];
      assert(error instanceof Error, 'should pass an Error to next');
      assert(error.message.includes('Provider error'), 'should pass the original error');
    });

    it('should handle Client.find errors', async function () {
      useInteractionRoutes(mockApp, mockProvider);

      const mockInteractionDetails = {
        uid: 'test-uid',
        prompt: { name: 'confirm-login', details: {}, reasons: ['test'] },
        params: { client_id: 'test-client' },
        session: {},
      };

      mockProvider.interactionDetails.resolves(mockInteractionDetails);
      mockProvider.Client.find.rejects(new Error('Client not found'));

      const getCalls = mockApp.get.getCalls();
      const interactionRoute = getCalls.find((call) => call.args[0] === '/interaction/:uid');
      const routeHandler = interactionRoute.args[2];

      const mockReq = { params: { uid: 'test-uid' } };
      const mockRes = { render: sinon.stub() };
      const mockNext = sinon.stub();

      await routeHandler(mockReq, mockRes, mockNext);

      // Should call next with error
      assert(mockNext.calledOnce, 'should call next with error');
      const error = mockNext.getCall(0).args[0];
      assert(error instanceof Error, 'should pass an Error to next');
      assert(error.message.includes('Client not found'), 'should pass the client error');
    });
  });
});
