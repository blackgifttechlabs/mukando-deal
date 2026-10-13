// Runs the real js/db.js code against the Firebase Realtime Database emulator (127.0.0.1:9019)
// with the real database.rules.json. Install once with `npm install` in this folder.
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
register('./hooks.mjs', import.meta.url);
const NS = 'demo-mukando-js', BASE = 'http://127.0.0.1:9019';
const owner = async (path, method = 'GET', data) => {
  const response = await fetch(`${BASE}/${path}.json?ns=${NS}`, { method, headers: { Authorization: 'Bearer owner' }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.json();
};
const token = uid => { const part = value => Buffer.from(JSON.stringify(value)).toString('base64url'); return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: uid, user_id: uid, aud: NS, iss: `https://securetoken.google.com/${NS}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: 'password' } })}.`; };
const putAs = async (uid, path, data) => (await fetch(`${BASE}/${path}.json?ns=${NS}&auth=${token(uid)}`, { method: 'PUT', body: JSON.stringify(data) })).status;
const sessions = {};
const as = async uid => sessions[uid] ??= await import('../js/db.js?u=' + uid);
const rejects = (promise, label) => assert.rejects(promise, undefined, label);

await owner('.settings/rules', 'PUT', JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url))));
await owner('', 'DELETE');
const people = { a: 'admin', c: 'chairperson', t: 'treasurer', u1: 'member', u2: 'member', u3: 'member' };
const users = Object.fromEntries(Object.entries(people).map(([id, role]) => [id, { id, username: id, role, active: true, ...(role === 'member' ? { memberId: 'm' + id.slice(1) } : {}) }]));
const members = Object.fromEntries(['m1', 'm2', 'm3'].map(id => [id, { id, fullName: 'Member ' + id, phone: '+263771234567', joinDate: '2026-01-01', status: 'active', notes: '' }]));
await owner('mukando', 'PUT', { users, members, rules: { club: { id: 'club', clubName: 'Test Club', amount: 20, frequency: 'monthly', startDate: '2026-01-31', penaltyAmount: 2, graceDays: 3 } } });
const A = users.a, C = users.c, T = users.t;

console.log("##", "Round creation and contributions (existing features keep working)");
const chair = await as('c'), treasurer = await as('t'), admin = await as('a');
await chair.createRotation(['m1', 'm2', 'm3'], 'manual', C);
const pay = (cycleId, memberId, amount, date) => treasurer.recordPayment({ cycleId, memberId, amount: String(amount), method: 'cash', reference: '', date }, T);
await pay('r1-c1', 'm1', 20, '2026-01-31'); await pay('r1-c1', 'm2', 20, '2026-01-31'); await pay('r1-c1', 'm3', 10, '2026-01-31');

console.log("##", "Phase 5: payout, confirmation, approval, closing");
await rejects(chair.recordPayout('r1-c1', C), 'chairperson cannot record payouts');
await rejects(treasurer.recordPayout('r1-c2', T), 'only the open cycle can be paid');
const payout = await treasurer.recordPayout('r1-c1', T);
assert.equal(payout.amountCents, 5000); assert.equal(payout.memberId, 'm1'); assert.equal(payout.confirmed, false);
await rejects(treasurer.recordPayout('r1-c1', T), 'only one payout per cycle');
await rejects(pay('r1-c1', 'm3', 10, '2026-01-31'), 'payments are frozen after the payout');
await rejects(treasurer.closeCycle('r1-c1', T), 'cannot close before confirmation');
const u1 = await as('u1'), u2 = await as('u2');
await rejects(u2.confirmPayout('r1-c1', users.u2), 'only the recipient can confirm');
// The same rules hold when the app code is bypassed entirely.
assert.equal(await putAs('u2', 'mukando/payouts/r1-c1/confirmed', true), 401, 'another member cannot confirm');
assert.equal(await putAs('t', 'mukando/cycles/r1-c1/status', 'closed'), 401, 'no closing before the recipient confirms');
assert.equal(await putAs('u1', 'mukando/auditLog/forged', { id: 'forged', time: 't', userId: 'u1', action: 'cycle.closed', details: 'forged' }), 401, 'members may only log payout confirmations');
await u1.confirmPayout('r1-c1', users.u1);
assert.equal((await owner('mukando/payouts/r1-c1')).confirmedBy, 'u1');
await rejects(u1.confirmPayout('r1-c1', users.u1), 'cannot confirm twice');
await rejects(treasurer.closeCycle('r1-c1', T), 'unpaid member needs chairperson approval');
await rejects(treasurer.approveClosing('r1-c1', 'ok', T), 'treasurer cannot approve');
await rejects(chair.approveClosing('r1-c1', '  ', C), 'a reason is required');
await chair.approveClosing('r1-c1', 'Member 3 will pay next month', C);
await rejects(chair.approveClosing('r1-c1', 'again', C), 'approval is create-only');
const result = await treasurer.closeCycle('r1-c1', T);
assert.equal(result.unpaid, 1); assert.equal(result.next.id, 'r1-c2');
let cycles = await owner('mukando/cycles');
assert.deepEqual([cycles['r1-c1'].status, cycles['r1-c2'].status, cycles['r1-c3'].status], ['closed', 'open', 'scheduled']);
assert.equal(await putAs('t', 'mukando/cycles/r1-c3/status', 'open'), 401, 'a cycle cannot open before the one ahead of it is closed');
assert.equal(await putAs('t', 'mukando/cycles/r1-c2/status', 'closed'), 401, 'a cycle cannot close without its payout');
for (const m of ['m1', 'm2', 'm3']) { const own = await owner('mukando/memberCycles/' + m); assert.deepEqual([own['r1-c1'].status, own['r1-c2'].status], ['closed', 'open']); }
await rejects(treasurer.closeCycle('r1-c1', T), 'a closed cycle cannot be closed again');
// Direct tampering is blocked by the rules, not just by the screens.
await rejects(chair.db.update('cycles', 'r1-c3', { status: 'open' }), 'chairperson cannot open a cycle by hand');
await rejects(treasurer.db.update('cycles', 'r1-c3', { status: 'open' }), 'treasurer cannot skip ahead');
await rejects(treasurer.db.update('cycles', 'r1-c2', { recipientMemberId: 'm1' }), 'treasurer cannot change recipients');
await rejects(admin.db.update('payouts', 'r1-c1', { amount: 1 }), 'payouts are immutable');
// Members only get their own payouts.
const mine = await u1.loadPayoutData(users.u1); assert.deepEqual(mine.payouts.map(p => p.id), ['r1-c1']);
assert.deepEqual((await u2.loadPayoutData(users.u2)).payouts, []);
await rejects(u2.db.list('payouts'), 'members cannot list every payout');

console.log("##", "Finish the round: full payments, treasurer confirms, no approval needed");
await pay('r1-c2', 'm1', 20, '2026-02-28'); await pay('r1-c2', 'm2', 20, '2026-02-28'); await pay('r1-c2', 'm3', 20, '2026-02-28');
await treasurer.recordPayout('r1-c2', T); await treasurer.confirmPayout('r1-c2', T);
assert.equal((await treasurer.closeCycle('r1-c2', T)).next.id, 'r1-c3');
for (const m of ['m1', 'm2', 'm3']) await pay('r1-c3', m, 20, '2026-03-31');
await treasurer.recordPayout('r1-c3', T); await treasurer.confirmPayout('r1-c3', T);
assert.equal((await treasurer.closeCycle('r1-c3', T)).next, undefined);
cycles = await owner('mukando/cycles'); assert.ok(Object.values(cycles).every(cycle => cycle.status === 'closed'));
await chair.createRotation(['m3', 'm2', 'm1'], 'manual', C); // a new round may start once the old one is closed
assert.equal((await owner('mukando/cycles'))['r2-c4'].status, 'open');

console.log("##", "Phase 6: reminders");
assert.equal((await chair.getReminderSettings()).daysBefore, 2);
await rejects(treasurer.saveReminderSettings(5, T), 'treasurer cannot change reminder settings');
await rejects(chair.saveReminderSettings(99, C), 'days must be 0 to 30');
await chair.saveReminderSettings(5, C);
assert.equal((await u1.getReminderSettings()).daysBefore, 5);
const meeting = await chair.saveReminder({ type: 'meeting', message: 'Monthly meeting at the church hall', date: '2026-11-01' }, C);
await treasurer.saveReminder({ ...meeting, sent: true }, T);
assert.equal((await owner('mukando/reminders/' + meeting.id)).sent, true);
await rejects(u1.saveReminder({ type: 'meeting', message: 'x', date: '2026-11-01' }, users.u1), 'members cannot create reminders');
await rejects(chair.saveReminder({ type: 'meeting', message: '', date: '2026-11-01' }, C), 'message required');
const asMember = await u1.loadReminderData(users.u1); assert.equal(asMember.settings.daysBefore, 5); assert.equal(asMember.settings.clubName, 'Test Club');
assert.deepEqual(asMember.stored.map(row => row.id), [meeting.id], 'members see meeting notices');
await treasurer.saveReminder({ id: 'payment-r2-c4-m1', type: 'payment', message: 'Hello Member m1, you owe $20', date: '2026-11-01', sent: true }, T);
assert.deepEqual((await u1.loadReminderData(users.u1)).stored.map(row => row.id), [meeting.id], 'payment nudges stay private');
await rejects(u1.db.list('reminders'), 'members cannot list every reminder');

console.log("##", "Phase 8: users and audit trail");
await rejects(chair.loadUsers(C), 'only the administrator manages users');
await admin.saveUserProfile({ id: 'u9', username: 'newbie', role: 'member', active: true, email: 'new@example.com', memberId: 'm3', mustChangePassword: true }, A, 'user.created', 'Created newbie', true);
assert.equal((await owner('mukando/users/u9')).memberId, 'm3');
await rejects(admin.saveUserProfile({ id: 'u8', username: 'bad', role: 'member', active: true, memberId: 'nobody' }, A, 'user.created', 'x', true), 'link must point at a real member');
await rejects(admin.saveUserProfile({ id: 'u8', username: 'bad', role: 'wizard', active: true }, A, 'user.created', 'x', true), 'role must be valid');
await admin.saveUserProfile({ id: 'u9', active: false }, A, 'user.deactivated', 'Deactivated newbie');
await admin.saveUserProfile({ id: 'u9', memberId: null }, A, 'user.unlinked', 'Unlinked newbie');
assert.equal((await owner('mukando/users/u9')).memberId, undefined);
await owner('mukando/users/u9/mustChangePassword', 'PUT', true);
await (await as('u9')).clearPasswordWarning({ id: 'u9' }); assert.equal((await owner('mukando/users/u9')).mustChangePassword, false);
await rejects((await as('u1')).clearPasswordWarning({ id: 'u2' }), 'cannot clear someone else’s warning');
const trail = await admin.loadAuditTrail(A);
for (const action of ['rotation.created', 'payment.recorded', 'payout.recorded', 'payout.confirmed', 'cycle.closing-approved', 'cycle.closed', 'user.created']) assert.ok(trail.some(row => row.action === action), action);
await rejects(treasurer.loadAuditTrail(T), 'audit trail is for the administrator');

console.log("##", "Phase 8: backup, clear, restore");
const backup = await admin.exportBackup(A);
const counts = admin.summariseBackup(backup);
assert.ok(counts.payments >= 9 && counts.cycles === 6 && counts.payouts === 3);
await rejects(treasurer.exportBackup(T), 'only the administrator may export');
await rejects(admin.importBackup(backup, A), 'restore refuses a club that already has data');
await rejects(admin.importBackup({ app: 'other' }, A), 'rejects foreign files');
// Restore mode cannot be switched on while the club has data, and only by the administrator.
assert.equal(await putAs('a', 'mukando/restoreMode', true), 401, 'restore mode needs an empty club');
assert.equal(await putAs('t', 'mukando/restoreMode', false), 401, 'only administrators touch restore mode');
const keep = await owner('mukando/users');
await owner('mukando', 'DELETE'); await owner('mukando/users', 'PUT', keep);
await admin.importBackup(JSON.parse(JSON.stringify(backup)), A);
assert.equal(await owner('mukando/restoreMode'), false);
const again = await admin.exportBackup(A);
assert.deepEqual(again.data, { ...backup.data, users: again.data.users }, 'everything returned after restore');
// After a restore the books still balance and the guards still hold.
await rejects(admin.importBackup(backup, A), 'cannot restore over restored data');
await rejects(admin.db.update('payments', Object.keys(backup.data.payments)[0], { amount: 1 }), 'payments stay append-only after restore');
// With restore mode on, only the administrator is relaxed; the treasurer is still bound by the normal rules.
await owner('mukando/restoreMode', 'PUT', true);
assert.notEqual(await putAs('t', 'mukando/payments/forged', { id: 'forged', cycleId: 'r1-c1', memberId: 'm1', amount: 5, amountCents: 500, method: 'cash', reference: '', date: '2026-02-01', recordedBy: 't', auditId: 'none' }), 200, 'treasurer cannot forge payments in restore mode');
await admin.endRestoreMode(A);
assert.equal(await owner('mukando/restoreMode'), false, 'an interrupted restore is switched off again');
console.log('PASS: payouts, confirmation, approval, atomic close/open next, tamper resistance, member privacy, reminders, user profiles, audit trail, backup and restore (js/db.js with the real rules, emulator only).');
process.exit(0);
