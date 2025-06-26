import assert from 'assert';
import puppeteer from 'puppeteer-core';
import { registerBrowserOpen } from '@heroku/mcp-remote/dist/lib/node-oauth-client-provider.js';
import { connectClient, parseCommandLineArgs } from '@heroku/mcp-remote/dist/lib/run-client.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'

const {
  CHROME_EXECUTABLE,
  TEST_HEADLESS = 'true',
  TEST_SUBJECT_URL,
  TEST_HEROKU_USERNAME,
  TEST_HEROKU_PASSWORD
} = process.env;

if (!TEST_SUBJECT_URL) {
  throw new Error('Requires TEST_SUBJECT_URL env var');
}
if (!TEST_HEROKU_USERNAME) {
  throw new Error('Requires TEST_HEROKU_USERNAME env var');
}
if (!TEST_HEROKU_PASSWORD) {
  throw new Error('Requires TEST_HEROKU_PASSWORD env var');
}

let browser;

before(async function() {
  browser = await puppeteer.launch({
    browser: 'chrome',
    executablePath: CHROME_EXECUTABLE,
    headless: TEST_HEADLESS === 'true' || TEST_HEADLESS === true
  });
});

after(async function() {
  await browser.close();
});

it('Authorizes mcp-remote-client using OAuth', async function() {
  let page = await browser.newPage();

  registerBrowserOpen(async (url) => {
    await page.goto(url);
  });

  const runMcpRemoteClient = parseCommandLineArgs([
    TEST_SUBJECT_URL
    ],
    'Test usage <https://server-url> [callback-port] [--debug]')
      .then(({ serverUrl, callbackPort, headers, transportStrategy, host, staticOAuthClientMetadata, staticOAuthClientInfo }) => {
        return connectClient(serverUrl, callbackPort, headers, transportStrategy, host, staticOAuthClientMetadata, staticOAuthClientInfo)
      })
      .then(({server, transport, client}) => {
        // Create a Promise to ressolve when a streaming JSON RPC message is received, 
        // so that we can test the MCP Server response.
        let { promise, resolve, reject } = Promise.withResolvers();
        transport.onmessage = (message) => {
          // console.log('Received message:', JSON.stringify(message, null, 2));
          resolve(message);
        }
        transport.onerror = (error) => {
          reject(error);
        }
        transport.onclose = () => {
          reject(new Error('Connection closed'));
        }

        // This JSON RPC request seems to be stuck open, so we cannot await it
        // and it makes the test hang. Using Abort Controller to kill it.
        const abortRequest = new AbortController();
        client.request({ method: 'tools/list' }, ListToolsResultSchema, { signal: abortRequest.signal });

        // Attempt to close everything, but the tests still hang, so `mocha --exit` 
        // (see the package.json "testint" script) must be used to shutdown the test 
        // process after this resolves.
        return promise
          .then((result) => {
            client.close();
            transport.close();
            server.close();
            abortRequest.abort();
            return result;
          });
      })
      .catch((error) => {
        throw new Error(`mcp-remote-client failed: ${error}`);
      });

  await page.locator('input#confirmed').click();
  await page.locator('button[type=submit]').click();

  await page.waitForNavigation();
  await page.locator('.heroku-link').wait();

  await page.locator('input#email').fill(TEST_HEROKU_USERNAME);
  await page.locator('input#password').fill(TEST_HEROKU_PASSWORD);
  await page.locator('button[type=submit]').click();

  await page.waitForNavigation();

  const bodyHandle = await page.$('body');
  const innerText = await page.evaluate(body => body.innerText, bodyHandle);
  await bodyHandle.dispose();

  assert.match(innerText, /Authorization successful!/, 'the web browser OAuth flow should complete with authorization granted');
  
  const toolsListMessage = await runMcpRemoteClient;

  assert(toolsListMessage?.result?.tools, 'the mcp-remote-client should receive JSON RPC message containing results.tools');

}).timeout(30000);
