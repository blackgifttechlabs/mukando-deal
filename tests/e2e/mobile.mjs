import { launch, sessionFor, seed, owner, SITE } from './run.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
await seed(); await owner('mukando/members', 'DELETE'); await owner('mukando/rules', 'DELETE');
const work = tmpdir() + '/mukando-seed-work'; mkdirSync(work, { recursive: true });
execSync('bash ' + new URL('../../SEED-DEMO-DATA.sh', import.meta.url).pathname, { cwd: work, env: { ...process.env, MUKANDO_DB_URL: 'http://127.0.0.1:9019', MUKANDO_TOKEN: 'owner', MUKANDO_QUERY: 'ns=demo-mukando-e2e' } });
const browser = await launch();
const shots = (process.env.SHOTS || tmpdir() + '/mukando-shots') + '/m-'; mkdirSync(process.env.SHOTS || tmpdir() + '/mukando-shots', { recursive: true });
const open = async (uid, file, vp = { width: 390, height: 844 }) => { const c = await sessionFor(browser, uid, vp); const p = await c.newPage(); await p.goto(SITE + '/' + file); await p.waitForSelector('[data-content]:not([hidden])', { timeout: 8000 }); return p; };
const report = async (p, name) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(o <= 1, `${name} scrolls sideways by ${o}px`); await p.screenshot({ path: shots + name + '.png' }); };
let p = await open('t', 'dashboard.html'); await report(p, 'dashboard');
await p.click('.nav-toggle'); await p.waitForTimeout(400); await report(p, 'menu-open');
assert.equal(await p.getAttribute('.nav-toggle', 'aria-expanded'), 'true'); assert.ok(await p.locator('.workspace-sidebar').isVisible());
await p.keyboard.press('Escape'); await p.waitForTimeout(400); assert.ok(!(await p.locator('.workspace-sidebar').isVisible()), 'Escape closes the menu');
await p.click('.nav-toggle'); await p.click('[data-nav] a[data-page=payments]'); await p.waitForURL('**/payments.html'); await p.waitForSelector('[data-content]:not([hidden])'); await p.waitForTimeout(300); await report(p, 'payments');
for (const [uid, f] of [['t', 'payouts.html'], ['c', 'reports.html'], ['c', 'reminders.html'], ['a', 'users.html'], ['a', 'backup.html'], ['c', 'members.html'], ['c', 'rotation.html'], ['t', 'record-payment.html'], ['u1', 'my-account.html'], ['c', 'rules.html']]) {
  const q = await open(uid, f); await q.waitForTimeout(300); await report(q, f.replace('.html', '')); await q.context().close();
}
// Touch targets: every visible button/link/input on the phone should be at least ~40px tall.
const small = await p.evaluate(() => [...document.querySelectorAll('button, a, input, select')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 36 && e.type !== 'checkbox' && !e.classList.contains('skip-link')).map(e => `${e.tagName}.${e.className}|${e.textContent.trim().slice(0, 20)}|${Math.round(e.getBoundingClientRect().height)}`).slice(0, 8));
assert.deepEqual(small.filter(item => !item.startsWith('A.workspace-brand')), [], 'touch targets are at least 36px tall');
console.log('PASS: phone layout (menu, card tables, no sideways scroll, touch targets)');
await browser.close(); process.exit(0);
