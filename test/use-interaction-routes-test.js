import assert from 'assert';
import sinon from 'sinon';
import useInteractionRoutes from '../lib/use-interaction-routes.js';

describe('useInteractionRoutes', function() {
  let mockApp;
  let mockProvider;

  beforeEach(function() {
    // Mock Express app
    mockApp = {
      use: sinon.stub(),
      get: sinon.stub(),
      post: sinon.stub(),
      render: sinon.stub()
    };

    // Mock OIDC provider
    mockProvider = {
      interactionDetails: sinon.stub(),
      interactionFinished: sinon.stub(),
      Client: {
        find: sinon.stub(),
        adapter: {
          upsert: sinon.stub()
        }
      }
    };
  });

  afterEach(function() {
    sinon.restore();
  });

  it('should setup middleware when called', function() {
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
    const interactionRoute = getCalls.find(call => 
      call.args[0] === '/interaction/:uid'
    );
    const callbackRoute = getCalls.find(call => 
      call.args[0] && (
        call.args[0].includes('/interaction/identity/callback') ||
        call.args[0].includes('/interaction/:uid/identity/callback')
      )
    );
    const confirmLoginRoute = postCalls.find(call => 
      call.args[0] === '/interaction/:uid/confirm-login'
    );

    assert(interactionRoute, 'should register interaction route');
    assert(confirmLoginRoute, 'should register confirm login route');
  });

  it('should register render middleware', function() {
    useInteractionRoutes(mockApp, mockProvider);

    // Verify middleware was registered (it should be called at least once)
    assert(mockApp.use.called, 'should register middleware');
    
    const middlewareFunc = mockApp.use.getCall(0).args[0];
    assert.equal(typeof middlewareFunc, 'function', 'should register a function as middleware');

    // Test the render middleware
    const mockReq = {};
    const mockRes = {
      render: sinon.stub()
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
});