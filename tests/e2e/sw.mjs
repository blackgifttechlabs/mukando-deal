// The service worker alone: a page opened once online must open again with no network at all.
// Uses the real Firebase CDN files (read-only, no login), so it needs internet for the first load.
import assert from 'node:assert/strict';
import { launch, SITE } from './run.mjs';
const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.goto(SITE + '/index.html');
await page.waitForFunction(() => !document.querySelector('form button').disabled, null, { timeout: 20000 });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(async () => (await (await caches.open('mukando-v1')).keys()).length > 40, null, { timeout: 30000 });
const cached = await page.evaluate(async () => (await (await caches.open('mukando-v1')).keys()).map(request => request.url));
for (const name of ['dashboard.html', 'js/sync.js', 'vendor/sql-wasm.wasm', 'firebasejs/12.19.0/firebase-database.js']) assert.ok(cached.some(url => url.includes(name)), name + ' is cached');
await context.setOffline(true);
for (const path of ['/index.html', '/', '/dashboard.html']) {
  await page.goto(SITE + path);
  assert.ok((await page.title()).includes('Mukando'), path + ' opens offline');
}
await page.goto(SITE + '/index.html');
await page.waitForFunction(() => !document.querySelector('form button').disabled, null, { timeout: 20000 });
assert.match(await page.textContent('.sync-pill'), /Offline/);
assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: service worker caches the app and Firebase SDK and opens pages with no network.');
