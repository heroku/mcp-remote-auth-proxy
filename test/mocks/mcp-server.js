import express from 'express';

const app = express();
app.use(express.json());
const port = process.env.PORT || 8080;

app.post('/mcp', (req, res) => {
  console.log('POST /mcp');

  // Test modes support different mock responses and asserting received values.
  switch (req.body['test-mode']) {

    // Assert that the proxy bearer token has been swapped for the identity bearer token.
    case 'check-for-identity-token':
      if (req.header('authorization') == 'bearer test_identity_access_token') {
        res.json({
          'msg': 'Received correct test authorization.',
        });
      } else {
        res.status(500).json({
          'msg': `Received incorrect test authorization "${req.header('authorization')}". It does not match the expected identity bearer authorization.`,
        });
      }
      break;

    // Return the 401 unauthorized response as if the identity access token is no longer valid, and expect a refreshed token to succeed.
    case 'respond-unauthorized':
      if (req.header('authorization') != 'bearer refreshed_test_identity_access_token') {
        res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Invalid access token"');
        res.status(401).json({
          'msg': 'Mock unauthorized response to trigger token refresh.',
        });
      } else {
        res.json({
          'msg': 'Received refreshed test authorization',
        });
      }
      break;
  
    // Not a special case test response.
    default:
      res.json({
        'msg': 'Back at ya!',
      });
      break;
  }
})

app.listen(port, () => {
  console.log(`Fake MCP Server listening on port ${port}`)
});
