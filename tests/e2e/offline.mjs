// Browser check of offline login, offline reads, offline saving and syncing when the connection returns.
// Needs the emulator on 9019 and `python3 -m http.server 8765` in the project folder (see README.md).
// "Offline" is simulated by dropping every request to the database and reporting navigator.onLine = false.
import assert from 'node:assert/strict';
import { launch, sessionFor, seed, owner, SITE } from './run.mjs';
await seed();
const browser = await launch();
const context = await sessionFor(browser, null);
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'onLine', { get: () => localStorage.getItem('test-offline') !== '1' });
});
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const goOffline = async () => { await page.evaluate(() => { localStorage.setItem('test-offline', '1'); dispatchEvent(new Event('offline')); }); await context.route('http://127.0.0.1:9019/**', route => route.abort('internetdisconnected')); };
const goOnline = async () => { await context.unroute('http://127.0.0.1:9019/**'); await page.evaluate(() => { localStorage.removeItem('test-offline'); dispatchEvent(new Event('online')); }); };
const badge = () => page.textContent('.sync-pill');
async function login(email, password) {
  await page.goto(SITE + '/index.html'); await page.waitForFunction(() => !document.querySelector('form button').disabled);
  await page.fill('#email', email); await page.fill('#password', password); await page.click('form button');
}
const loaded = () => page.waitForFunction(() => !document.querySelector('[data-content]')?.hidden || !document.querySelector('[data-error]')?.hidden, null, { timeout: 10000 });

console.log('## Online login remembers the account for this device');
await login('c@club.test', 'Passw0rd1'); await page.waitForURL('**/dashboard.html'); await loaded();
await page.goto(SITE + '/members.html'); await loaded();
assert.match(await page.textContent('main'), /Anesu Moyo/);
await page.click('[data-logout-button]'); await page.waitForURL('**/index.html');

console.log('## Offline: wrong password is refused, right password opens the app');
await goOffline();
await page.reload(); await page.waitForFunction(() => !document.querySelector('form button').disabled);
assert.match(await badge(), /Offline/);
await login('c@club.test', 'WrongPass9'); await page.waitForSelector('[data-error]:not([hidden])');
assert.match(await page.textContent('[data-error]'), /offline/i);
await login('nobody@club.test', 'Passw0rd1'); await page.waitForSelector('[data-error]:not([hidden])');
await login('C@club.test', 'Passw0rd1'); await page.waitForURL('**/dashboard.html'); await loaded();
assert.match(await page.textContent('[data-user-name]'), /Chair Charles/);

console.log('## Offline: club data comes from SQLite');
await page.goto(SITE + '/members.html'); await loaded();
const body = await page.textContent('main');
assert.ok(/Anesu Moyo/.test(body) && /Farai Sibanda/.test(body), 'members are listed without a connection');

console.log('## Offline: a save is kept on the device and sent when the connection returns');
await page.goto(SITE + '/rules.html'); await loaded();
await page.fill('[name="clubName"]', 'Saved Offline Club'); await page.click('[data-save]');
await page.waitForSelector('[data-success]:not([hidden])');
assert.equal((await owner('mukando/rules/club')).clubName, 'Agape Fushai Group', 'the server has not seen it yet');
assert.match(await badge(), /1 waiting/);
await page.reload(); await loaded();
assert.equal(await page.inputValue('[name="clubName"]'), 'Saved Offline Club', 'still shown after reload while offline');
await goOnline();
// An offline login has no server session, so the password is asked for once to send the changes.
await page.waitForFunction(() => /Log in to sync/.test(document.querySelector('.sync-pill').textContent));
await page.click('.sync-pill'); await page.fill('#sync-password', 'WrongPass9'); await page.click('[data-sync-login] button');
await page.waitForSelector('[data-sync-error]:not([hidden])');
await page.fill('#sync-password', 'Passw0rd1'); await page.click('[data-sync-login] button');
await page.waitForFunction(() => /Synced/.test(document.querySelector('.sync-pill').textContent), null, { timeout: 15000 });
assert.equal((await owner('mukando/rules/club')).clubName, 'Saved Offline Club');
const log = Object.values(await owner('mukando/auditLog')).filter(entry => entry.action === 'rules.updated');
assert.equal(log.length, 1); assert.equal(log[0].userId, 'c');

console.log('## Online again: changes made elsewhere reach this device');
await owner('mukando/members/m1/fullName', 'PUT', 'Renamed Elsewhere');
await page.click('[data-sync-now]');
await page.waitForSelector('[data-sync-refresh]:not([hidden])', { timeout: 15000 });
await page.goto(SITE + '/members.html'); await loaded();
assert.match(await page.textContent('main'), /Renamed Elsewhere/);

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('PASS: offline login, offline reads, offline save, sync on reconnect and pull of remote changes (emulator only).');
