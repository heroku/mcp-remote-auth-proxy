import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { registerBrowserOpen } from '@heroku/mcp-remote/dist/lib/node-oauth-client-provider.js';
import { runClient, parseCommandLineArgs } from '@heroku/mcp-remote/dist/lib/run-client.js';

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

const browser = await puppeteer.launch({
  browser: 'chrome',
  executablePath: CHROME_EXECUTABLE,
  headless: TEST_HEADLESS === 'true' || TEST_HEADLESS === true
});

let page = await browser.newPage();

registerBrowserOpen(async (url) => {
  await page.goto(url);
});

parseCommandLineArgs([
  TEST_SUBJECT_URL
  ],
  'Test usage <https://server-url> [callback-port] [--debug]')
    .then(({ serverUrl, callbackPort, headers, transportStrategy, host, staticOAuthClientMetadata, staticOAuthClientInfo }) => {
      return runClient(serverUrl, callbackPort, headers, transportStrategy, host, staticOAuthClientMetadata, staticOAuthClientInfo)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    });

await page.locator('input#confirmed').click();
await page.locator('button[type=submit]').click();

await page.waitForNavigation();
await page.locator('.heroku-link').wait();

await page.locator('input#email').fill(TEST_HEROKU_USERNAME);
await page.locator('input#password').fill(TEST_HEROKU_PASSWORD);
await page.locator('button[type=submit]').click();

await page.waitForNavigation();
await page.evaluate(el => {
  el.textContent.includes('Authorization successful!')
}, 'body');
