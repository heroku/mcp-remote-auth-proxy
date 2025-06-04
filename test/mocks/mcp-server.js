import express from 'express';

const app = express();
const port = process.env.PORT || 8080;

app.post('/mcp', (req, res) => {
  console.log('POST /mcp')
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Fake MCP Server listening on port ${port}`)
});
