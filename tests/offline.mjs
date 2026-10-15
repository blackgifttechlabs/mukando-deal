// Offline-first behaviour: js/db.js + js/sync.js + js/localdb.js (real SQLite via sql.js) against the
// Realtime Database emulator (127.0.0.1:9019) with the real database.rules.json.
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
await owner('.settings/rules', 'PUT', JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url))));
await owner('', 'DELETE');
const people = { c: 'chairperson', t: 'treasurer', u1: 'member', u2: 'member' };
const users = Object.fromEntries(Object.entries(people).map(([id, role]) => [id, { id, username: id, role, active: true, ...(role === 'member' ? { memberId: 'm' + id.slice(1) } : {}) }]));
const members = Object.fromEntries(['m1', 'm2', 'm3'].map(id => [id, { id, fullName: 'Member ' + id, phone: '+263771234567', joinDate: '2026-01-01', status: 'active', notes: '' }]));
await owner('mukando', 'PUT', { users, members, rules: { club: { id: 'club', clubName: 'Test Club', amount: 20, frequency: 'monthly', startDate: '2026-01-31', penaltyAmount: 2, graceDays: 3 } } });

const local = await import('../js/localdb.js');
const modules = {};
// Each person has their own db.js/sync.js pair; switching person reopens that person's SQLite file.
async function as(uid) {
  modules[uid] ??= { db: await import('../js/db.js?u=' + uid), sync: await import('../js/sync.js?u=' + uid) };
  await modules[uid].sync.startSession(uid, true);
  return modules[uid];
}
const C = users.c, T = users.t;

console.log('##', 'First sync fills the device');
const chair = await as('c');
await chair.sync.syncNow();
assert.equal((await chair.db.db.list('members')).length, 3);
assert.equal(await local.local.get('members/m2/fullName'), 'Member m2');
assert.equal(await local.local.get('users/t'), null, 'staff do not download other login profiles');

console.log('##', 'Offline: reads come from SQLite, writes are queued');
chair.sync.setForcedOffline(true);
assert.equal(chair.sync.isOnline(), false);
assert.equal((await chair.db.db.list('members')).length, 3, 'members readable offline');
assert.equal((await chair.db.db.get('rules', 'club')).clubName, 'Test Club');
await chair.db.createRotation(['m1', 'm2', 'm3'], 'manual', C);
assert.equal((await chair.db.db.list('cycles')).length, 3, 'new rotation visible offline');
assert.equal(chair.sync.getStatus().pending, 1);
assert.equal(await owner('mukando/cycles'), null, 'nothing reached the server yet');
await chair.db.saveWithAudit('members', 'm1', { notes: 'edited offline' }, C, 'member.updated', 'm1');
assert.equal((await chair.db.db.get('members', 'm1')).notes, 'edited offline');
assert.equal(chair.sync.getStatus().pending, 2);

console.log('##', 'Queued changes survive closing the app');
await local.closeStore();
const again = await as('c');
again.sync.setForcedOffline(true);
assert.equal(await local.local.outboxSize(), 2, 'outbox reloaded from storage');
assert.equal((await again.db.db.list('cycles')).length, 3);

console.log('##', 'Back online: the queue is sent in order, then the server copy is pulled');
again.sync.setForcedOffline(false);
assert.equal(await again.sync.syncNow(), true, JSON.stringify(again.sync.getStatus()));
assert.equal(again.sync.getStatus().pending, 0);
assert.deepEqual(again.sync.getStatus().rejected, []);
assert.equal(Object.keys(await owner('mukando/cycles')).length, 3);
assert.equal((await owner('mukando/members/m1')).notes, 'edited offline');
assert.equal(Object.keys(await owner('mukando/auditLog')).length, 2, 'audit entries were sent with their changes');

console.log('##', 'Changes made elsewhere arrive on the next sync');
await owner('mukando/members/m3/fullName', 'PUT', 'Renamed elsewhere');
again.sync.setForcedOffline(true);
assert.equal((await again.db.db.get('members', 'm3')).fullName, 'Member m3', 'offline still shows the last synced copy');
again.sync.setForcedOffline(false);
await again.sync.syncNow();
assert.equal((await again.db.db.get('members', 'm3')).fullName, 'Renamed elsewhere');
assert.equal(again.sync.getStatus().changed, true, 'the page is told newer data arrived');

console.log('##', 'Online writes still obey the rules, nothing is saved locally when refused');
await assert.rejects(again.db.saveWithAudit('members', 'm1', { phone: 'bad' }, C, 'member.updated', 'x'));
assert.equal((await again.db.db.get('members', 'm1')).phone, '+263771234567');

console.log('##', 'A change the server refuses is rolled back with a message');
const treasurer = await as('t');
await treasurer.sync.syncNow();
treasurer.sync.setForcedOffline(true);
await treasurer.db.recordPayment({ cycleId: 'r1-c1', memberId: 'm1', amount: '20', method: 'cash', reference: '', date: '2026-01-31' }, T);
assert.equal((await treasurer.db.db.list('payments')).length, 1);
// Meanwhile the payout is recorded on another device, which locks the cycle's payments.
await owner('mukando/payouts/r1-c1', 'PUT', { id: 'r1-c1', cycleId: 'r1-c1', memberId: 'm1', amount: 1, amountCents: 100, date: '2026-01-31', confirmed: false, recordedBy: 't', auditId: 'x' });
await owner('mukando/cycleLocks/r1-c1/hasPayout', 'PUT', true);
treasurer.sync.setForcedOffline(false);
await treasurer.sync.syncNow();
const status = treasurer.sync.getStatus();
assert.equal(status.pending, 0); assert.equal(status.rejected.length, 1);
assert.match(status.rejected[0].change, /Recorded 20.00/);
assert.equal((await treasurer.db.db.list('payments')).length, 0, 'the refused payment is gone from the device');
await treasurer.sync.dismissRejected();
assert.equal(treasurer.sync.getStatus().rejected.length, 0);

console.log('##', 'A member only keeps their own records on the device');
await owner('mukando/cycles/r1-c1/status', 'PUT', 'open');
await owner('mukando/payments/p1', 'PUT', { id: 'p1', cycleId: 'r1-c1', memberId: 'm1', amount: 20, amountCents: 2000, method: 'cash', reference: '', date: '2026-01-31', recordedBy: 't', auditId: 'z' });
await owner('mukando/payments/p2', 'PUT', { id: 'p2', cycleId: 'r1-c1', memberId: 'm2', amount: 20, amountCents: 2000, method: 'cash', reference: '', date: '2026-01-31', recordedBy: 't', auditId: 'z' });
const m1 = await as('u1');
await m1.sync.syncNow();
m1.sync.setForcedOffline(true);
const mine = await m1.db.loadPaymentData(users.u1);
assert.deepEqual(mine.payments.map(p => p.id), ['p1']);
assert.equal(await local.local.get('members/m2'), null, 'another member is not on this device');
assert.equal(await local.local.get('payments/p2'), null);
assert.equal(mine.cycles.length, 3);
await assert.rejects(m1.db.exportBackup(users.u1), /role/);
// One account never sees another account's offline copy.
const chairAgain = await as('c');
assert.equal(await local.local.get('payments/p2'), null);

console.log('##', 'Offline login checks a salted hash of the password');
await local.rememberCredential('Tendai@Club.test', 't', 'Passw0rd1');
assert.equal(await local.checkCredential('tendai@club.test', 'Passw0rd1'), 't');
assert.equal(await local.checkCredential('tendai@club.test', 'passw0rd1'), null);
assert.equal(await local.checkCredential('other@club.test', 'Passw0rd1'), null);
const stored = JSON.stringify(await local.kvGet('credentials'));
assert.ok(!stored.includes('Passw0rd1') && stored.includes('"hash"'));
await local.rememberCredential('tendai@club.test', 't', 'NewPass22');
assert.equal(await local.checkCredential('tendai@club.test', 'Passw0rd1'), null, 'a changed password replaces the old one');
assert.equal(await local.checkCredential('tendai@club.test', 'NewPass22'), 't');

console.log('PASS: SQLite mirror, offline reads and queued writes, ordered sync, pull of server changes, refused-change rollback, per-user isolation and offline login hashes (emulator only).');
process.exit(0);
