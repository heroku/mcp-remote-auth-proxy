import express from 'express';

const app = express();
app.use(express.json());
const port = process.env.PORT || 8080;

app.post('/mcp', (req, res) => {
  // Test modes support different mock responses and asserting received values.
  switch (req.body['test-mode']) {

    // Assert that the proxy bearer token has been swapped for the identity bearer token.
    case 'check-for-identity-token':
      if (req.header('authorization') == 'bearer test_identity_access_token') {
        res.json({
          'msg': 'Received correct test authorization.',
        })
      } else {
        res.status(500).json({
          'msg': `Received incorrect test authorization "${req.header('authorization')}". It does not match the expected identity bearer authorization.`,
        })
      }
      break;
  
    // Not a special case test response.
    default:
      console.log('POST /mcp default');
      res.json({
        'msg': 'Back at ya!',
      })
      break;
  }
})

app.listen(port, () => {
  console.log(`Fake MCP Server listening on port ${port}`)
});
