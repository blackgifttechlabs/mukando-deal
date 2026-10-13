import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch, sessionFor, seed, owner, SITE } from './run.mjs';
import { tmpdir } from 'node:os';
const SHOTS = process.env.SHOTS || tmpdir() + '/mukando-shots';
import { mkdirSync } from 'node:fs'; mkdirSync(SHOTS, { recursive: true });
await seed();
const browser = await launch();
const problems = [];
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Harare' }).format(new Date());
async function open(uid, file, viewport) {
  const context = await sessionFor(browser, uid, viewport); const page = await context.newPage();
  page.on('console', m => m.type() === 'error' && !/favicon|ERR_FAILED|net::|status of 401/.test(m.text()) && problems.push(`${uid} ${file}: ${m.text()}`));
  page.on('pageerror', e => problems.push(`${uid} ${file}: PAGEERROR ${e.message}`));
  page.on('dialog', d => d.dismiss());
  await goto(page, file); return page;
}
async function goto(page, file) {
  await page.goto(`${SITE}/${file}`);
  await page.waitForFunction(() => !document.querySelector('[data-content]').hidden || !document.querySelector('[data-error]').hidden || location.pathname.endsWith('index.html'), null, { timeout: 8000 });
}
const text = (page, selector) => page.locator(selector).first().innerText();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const expectError = async (page, pattern) => { await page.waitForSelector('[data-error]:not([hidden])', { timeout: 5000 }); assert.match(await text(page, '[data-error]'), pattern); };
const expectSuccess = async (page, pattern) => { await page.waitForSelector('[data-success]:not([hidden])', { timeout: 5000 }); assert.match(await text(page, '[data-success]'), pattern); };

// ---- Role-based navigation
for (const [uid, links, hidden] of [['a', ['Users', 'Backup', 'Reports', 'Payouts'], ['Record payment']], ['t', ['Record payment', 'Payouts', 'Reports', 'Reminders', 'My account'], ['Users', 'Backup', 'Members']], ['u1', ['Dashboard', 'Payments', 'Reminders', 'My account'], ['Users', 'Backup', 'Reports', 'Payouts', 'Members']]]) {
  const page = await open(uid, 'dashboard.html');
  const visible = (await page.locator('[data-nav] a:visible').allInnerTexts());
  for (const link of links) assert.ok(visible.includes(link), `${uid} should see ${link}: ${visible}`);
  for (const link of hidden) assert.ok(!visible.includes(link), `${uid} should not see ${link}`);
  await page.context().close();
}
// ---- Wrong role is sent back to the dashboard
for (const [uid, file] of [['u1', 'payouts.html'], ['t', 'users.html'], ['c', 'backup.html'], ['u1', 'reports.html'], ['a', 'record-payment.html']]) {
  const page = await open(uid, file); await page.waitForURL('**/dashboard.html', { timeout: 5000 }); await page.context().close();
}
// ---- Chairperson creates the rotation
let page = await open('c', 'rotation.html');
await page.click('[data-save-rotation]'); await expectSuccess(page, /Rotation created/);
assert.equal(await page.locator('[data-cycles] tr').count(), 4);
await page.context().close();
let cycles = await owner('mukando/cycles'); assert.equal(cycles['r1-c1'].recipientMemberId, 'm1');
// ---- Treasurer records contributions
const treasurer = await sessionFor(browser, 't'); const tp = await treasurer.newPage();
tp.on('pageerror', e => problems.push('t pageerror ' + e.message)); tp.on('console', m => m.type() === 'error' && !/favicon|net::|status of 401/.test(m.text()) && problems.push('t: ' + m.text()));
async function pay(member, amount) {
  await goto(tp, 'record-payment.html');
  await tp.selectOption('#memberId', member); await tp.fill('#amount', String(amount)); await tp.fill('#date', '2026-09-15');
  await tp.click('[data-save-payment]'); await tp.waitForURL('**/payments.html*'); await tp.waitForSelector('[data-content]:not([hidden])');
}
await pay('m1', 20); await pay('m2', 20); await pay('m3', 10);
// ---- Payouts: step 1 → 4
await goto(tp, 'payouts.html');
assert.match(await text(tp, '[data-step-label]'), /Step 2 of 4/);
assert.match(await text(tp, '[data-collected]'), /\$50\.00/); assert.equal(await text(tp, '[data-unpaid-count]'), '2');
assert.ok(await tp.locator('[data-close-cycle]').isHidden(), 'cannot close before payout');
await shot(tp, 'payouts-step2');
await tp.click('[data-record-payout]'); await expectSuccess(tp, /Payout recorded/);
assert.match(await text(tp, '[data-step-label]'), /Step 3 of 4/); assert.match(await text(tp, '[data-payout-state]'), /\$50\.00 · waiting/);
assert.ok(await tp.locator('[data-record-payout]').isHidden());
// A payment after the payout is refused by the database.
await goto(tp, 'record-payment.html'); await tp.selectOption('#memberId', 'm3'); await tp.fill('#amount', '10'); await tp.fill('#date', '2026-09-15'); await tp.click('[data-save-payment]');
await expectError(tp, /denied|Permission/i);
// ---- Recipient confirms from My account
const ruth = await open('u1', 'my-account.html');
assert.ok(await ruth.locator('[data-confirm-panel]').isVisible()); assert.match(await text(ruth, '[data-confirm-text]'), /\$50\.00/);
assert.match(await text(ruth, '[data-my-outstanding]'), /\$0\.00/);
await shot(ruth, 'my-account-member');
await ruth.click('[data-confirm-received]'); await expectSuccess(ruth, /confirmed/);
assert.ok(await ruth.locator('[data-confirm-panel]').isHidden()); assert.match(await text(ruth, '[data-my-received]'), /\$50\.00/);
// ---- Closing is blocked until the chairperson approves
await goto(tp, 'payouts.html'); assert.match(await text(tp, '[data-step-label]'), /Step 4 of 4/);
assert.ok(await tp.locator('[data-close-cycle]').isDisabled(), 'close is disabled while members owe money');
assert.ok(await tp.locator('[data-approve-closing]').isHidden(), 'treasurer cannot approve');
assert.match(await text(tp, '[data-unpaid-list]'), /Chipo Dube: owes \$12\.00/); assert.match(await text(tp, '[data-unpaid-list]'), /Farai Sibanda: owes \$22\.00/);
const chair = await open('c', 'payouts.html');
await chair.click('[data-approve-closing]'); await chair.fill('#approve-reason', 'Both members pay at the next meeting'); await chair.click('[data-confirm-approve]');
await expectSuccess(chair, /Approval saved/); assert.ok(await chair.locator('[data-approve-closing]').isHidden());
await shot(chair, 'payouts-chair');
await goto(tp, 'payouts.html'); assert.ok(await tp.locator('[data-close-cycle]').isEnabled());
await tp.click('[data-close-cycle]'); await expectSuccess(tp, /Cycle 2 is now open/);
assert.match(await text(tp, '[data-cycle-label]'), /Cycle 2/); assert.match(await text(tp, '[data-recipient]'), /Bonolo/);
assert.equal(await tp.locator('[data-payouts] tr').count(), 1); assert.match(await text(tp, '[data-payouts]'), /Anesu Moyo.*\$50\.00.*Yes.*closed/is);
await shot(tp, 'payouts-after-close');
cycles = await owner('mukando/cycles'); assert.deepEqual([cycles['r1-c1'].status, cycles['r1-c2'].status], ['closed', 'open']);
// ---- Reminders
const rp = await open('t', 'reminders.html');
assert.ok(await rp.locator('[data-settings-panel]').isHidden(), 'treasurer cannot change reminder timing');
await shot(rp, 'reminders-treasurer');
const chairR = await open('c', 'reminders.html');
await chairR.fill('#days-before', '5'); await chairR.click('[data-save-settings]'); await expectSuccess(chairR, /saved/);
await chairR.fill('#meeting-date', '2026-10-14'); await chairR.fill('#meeting-message', 'Monthly meeting at the church hall'); await chairR.click('[data-save-meeting]'); await expectSuccess(chairR, /Meeting reminder added/);
assert.match(await text(chairR, '[data-reminders]'), /Monthly meeting/);
await shot(chairR, 'reminders-chair');
await chairR.selectOption('#reminder-filter', 'all');
const bonolo = await open('u2', 'reminders.html');
assert.match(await text(bonolo, '[data-reminders]'), /Monthly meeting/); assert.doesNotMatch(await text(bonolo, '[data-reminders]'), /Chipo|Farai/, 'a member never sees other members’ nudges');
assert.ok(await bonolo.locator('[data-staff-tools]').isHidden());
await shot(bonolo, 'reminders-member');
// ---- Dashboard numbers
const dash = await open('t', 'dashboard.html');
await dash.waitForFunction(() => document.querySelector('[data-metric="members"]').textContent === '4');   // the number counts up first
assert.equal(await text(dash, '[data-metric="members"]'), '4'); assert.match(await text(dash, '[data-metric="payout"]'), /Bonolo/);
assert.match(await text(dash, '[data-reminder-text]'), /reminder/); await shot(dash, 'dashboard-treasurer');
const dashMember = await open('u2', 'dashboard.html'); assert.match(await text(dashMember, '[data-title="collected"]'), /Paid this cycle/); await shot(dashMember, 'dashboard-member');
// ---- Reports
const rep = await open('c', 'reports.html');
assert.match(await text(rep, '[data-report-body]'), /Total collected\s*\$50\.00/); assert.match(await text(rep, '[data-report-body]'), /Total paid out\s*\$50\.00/);
await shot(rep, 'reports-club');
const [download] = await Promise.all([rep.waitForEvent('download'), rep.click('[data-export-csv]')]);
const csv = await readFile(await download.path(), 'utf8'); assert.match(csv, /Total collected,50\.00/); assert.match(csv, /Cycle 1,/);
await rep.selectOption('#report-type', 'member'); await rep.selectOption('#report-member', 'm3');
assert.match(await text(rep, '[data-report-title]'), /Chipo Dube/); assert.match(await text(rep, '[data-report-body]'), /Owed now\s*\$12\.00/);
await shot(rep, 'reports-member');
await rep.selectOption('#report-type', 'defaulters'); assert.match(await text(rep, '[data-report-body]'), /Farai Sibanda[\s\S]*Chipo Dube/);
await shot(rep, 'reports-defaulters');
await rep.selectOption('#report-type', 'cycle'); await rep.selectOption('#report-cycle', 'r1-c1'); assert.match(await text(rep, '[data-report-body]'), /Collected\s*\$50\.00/);
// ---- Users (admin)
const admin = await open('a', 'users.html');
await admin.click('[data-toggle-form]'); await admin.fill('#user-email', 'new.member@club.test'); await admin.fill('#user-name', 'New Treasurer'); await admin.fill('#user-password', 'Temp1234pw'); await admin.selectOption('#user-role', 'treasurer');
assert.ok(await admin.locator('[data-link-field]').isHidden()); await admin.click('[data-save-user]'); await expectSuccess(admin, /Account created/);
let profile = await owner('mukando/users/new-1'); assert.equal(profile.role, 'treasurer'); assert.equal(profile.mustChangePassword, true); assert.equal(profile.passwordHash, undefined);
await admin.click('[data-toggle-form]'); await admin.fill('#user-email', 'farai@club.test'); await admin.fill('#user-name', 'Farai'); await admin.fill('#user-password', 'Temp1234pw'); await admin.selectOption('#user-role', 'member'); await admin.selectOption('#user-member', 'm4'); await admin.click('[data-save-user]'); await expectSuccess(admin, /Account created/);
assert.equal((await owner('mukando/users/new-2')).memberId, 'm4');
await admin.click('[data-toggle-form]'); const options = await admin.locator('#user-member option').allInnerTexts(); assert.ok(!options.includes('Farai Sibanda') && !options.includes('Anesu Moyo'), 'linked members are not offered twice');
await admin.click('[data-cancel-form]');
await admin.locator('tr', { hasText: 'New Treasurer' }).getByText('Reset password').click(); await expectSuccess(admin, /reset email sent to new.member@club.test/);
await admin.locator('tr', { hasText: 'New Treasurer' }).getByText('Deactivate').click(); await admin.waitForSelector('tr:has-text("New Treasurer") .is-inactive'); assert.equal((await owner('mukando/users/new-1')).active, false);
assert.ok(await admin.locator('tr', { hasText: 'Admin Anna' }).getByText('Deactivate').isDisabled(), 'cannot deactivate yourself');
await admin.locator('tr', { hasText: 'Farai' }).getByText('Edit').click(); await admin.selectOption('#edit-role', 'chairperson'); await admin.click('[data-confirm-edit]'); await admin.waitForSelector('[data-success]:not([hidden])');
profile = await owner('mukando/users/new-2'); assert.equal(profile.role, 'chairperson'); assert.equal(profile.memberId, undefined);
await shot(admin, 'users');
// ---- Backup, wipe, restore
const bk = await open('a', 'backup.html');
assert.match(await text(bk, '[data-audit]'), /payout\.recorded/); await bk.fill('#audit-search', 'cycle.closed'); assert.equal(await bk.locator('[data-audit] tr').count(), 1); await bk.fill('#audit-search', '');
await shot(bk, 'backup');
const [file] = await Promise.all([bk.waitForEvent('download'), bk.click('[data-export]')]);
const backupPath = await file.path(); const backup = JSON.parse(await readFile(backupPath, 'utf8')); assert.equal(Object.keys(backup.data.payments).length, 3);
// Import is refused while records exist.
await bk.setInputFiles('#import-file', backupPath); await bk.check('[data-import-confirm]'); await bk.click('[data-import]'); await expectError(bk, /empty club/);
const before = await Promise.all(['payments', 'cycles', 'payouts', 'members', 'auditLog'].map(name => owner('mukando/' + name)));
const keepUsers = await owner('mukando/users'); await owner('mukando', 'DELETE'); await owner('mukando/users', 'PUT', keepUsers);
await bk.reload(); await bk.waitForSelector('[data-content]:not([hidden])');
await bk.setInputFiles('#import-file', backupPath); assert.ok(await bk.locator('[data-import-summary]').isVisible()); assert.ok(await bk.locator('[data-import]').isDisabled(), 'needs the confirmation tick');
await bk.check('[data-import-confirm]'); await bk.click('[data-import]'); await expectSuccess(bk, /Backup imported/);
const after = await Promise.all(['payments', 'cycles', 'payouts', 'members', 'auditLog'].map(name => owner('mukando/' + name)));
assert.deepEqual(after.map(x => Object.keys(x).length), before.map(x => Object.keys(x).length), 'everything came back'); assert.deepEqual(after[0], before[0]);
// The restored club works: the treasurer sees the same payouts and the open cycle.
await goto(tp, 'payouts.html'); assert.match(await text(tp, '[data-cycle-label]'), /Cycle 2/); assert.equal(await tp.locator('[data-payouts] tr').count(), 1);
// ---- Change password
const pw = await open('u2', 'my-account.html');
await pw.fill('#current-password', 'wrong-one-1'); await pw.fill('#new-password', 'NewPass123'); await pw.fill('#repeat-password', 'NewPass123'); await pw.click('[data-save-password]'); await expectError(pw, /incorrect/);
await pw.fill('#current-password', 'Passw0rd1'); await pw.fill('#new-password', 'short'); await pw.fill('#repeat-password', 'short');
assert.ok(await pw.evaluate(() => !document.querySelector('[data-password-form]').checkValidity()), 'browser enforces minimum length');
await pw.fill('#new-password', 'NewPass123'); await pw.fill('#repeat-password', 'NewPass124'); await pw.click('[data-save-password]'); await expectError(pw, /do not match/);
await pw.fill('#repeat-password', 'NewPass123'); await pw.click('[data-save-password]'); await expectSuccess(pw, /Password changed/);
assert.equal(await pw.evaluate(() => window.__passwordChanged), 'NewPass123');
// ---- Earlier pages still load after the navigation change
for (const [uid, file] of [['c', 'members.html'], ['c', 'rules.html'], ['c', 'member-form.html'], ['c', 'rotation.html'], ['c', 'payments.html'], ['u1', 'payments.html']]) { const earlier = await open(uid, file); assert.ok(await earlier.locator('[data-nav] a:visible').count() >= 4); await earlier.context().close(); }
// ---- Phone width
for (const file of ['payouts.html', 'reports.html', 'reminders.html', 'users.html', 'backup.html', 'my-account.html', 'dashboard.html']) {
  const uid = file === 'my-account.html' ? 'u1' : file === 'users.html' || file === 'backup.html' ? 'a' : 'c';
  const phone = await open(uid, file, { width: 375, height: 800 });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) { await shot(phone, 'overflow-' + file); console.log(await phone.evaluate(() => [...document.querySelectorAll('body, body *')].filter(e => e.scrollWidth > e.clientWidth + 1).slice(0, 8).map(e => `${e.tagName}.${e.className} sw=${e.scrollWidth} cw=${e.clientWidth}`))); }
  if (overflow > 1) console.log(await phone.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map(e => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)} :: ${e.textContent.trim().slice(0, 50)}`)));
  assert.ok(overflow <= 1, `${file} overflows the phone width by ${overflow}px`);
  await shot(phone, 'phone-' + file.replace('.html', '')); await phone.context().close();
}
await browser.close();
assert.deepEqual(problems, [], 'no browser errors');
console.log('PASS: end-to-end pages against the emulator');
process.exit(0);
