import express from 'express';

const app = express();
const port = process.env.PORT || 8080;

app.post('/mcp', (req, res) => {
  console.log('POST /mcp')
  res.json({
    'msg': 'Back at ya!',
  })
})

app.listen(port, () => {
  console.log(`Fake MCP Server listening on port ${port}`)
});
