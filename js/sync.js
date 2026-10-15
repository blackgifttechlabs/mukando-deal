// Keeps the on-device SQLite copy (localdb.js) and the Firebase Realtime Database in step.
//   Online : every write goes to Firebase first (its rules still decide), then into SQLite.
//            Every read comes from Firebase and refreshes SQLite.
//   Offline: reads come from SQLite; writes go into SQLite and a queue (the outbox).
//   Back online: the queue is sent in order, then the server's data replaces the local copy.
// Without a signed-in session (startSession not called) every call goes straight to Firebase.
import { local, openStore, collections } from './localdb.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
let realPromise;
const real = () => (realPromise ??= Promise.all([import(SDK), import('./firebase.js')]).then(([sdk, config]) => ({ ...sdk, database: config.database })));

const state = { uid: null, cloud: false, netDown: false, forcedOffline: false, busy: false, pending: 0, rejected: [], lastSync: null, changed: false };
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
export const isOnline = () => (state.uid === null || state.cloud) && !state.forcedOffline && !state.netDown && browserOnline();
const emit = () => globalThis.dispatchEvent?.(new CustomEvent('mukando:sync'));

// ---------- Error handling ----------
const text = error => `${error?.code ?? ''} ${error?.message ?? ''}`;
const isDenied = error => /permission[_ -]?denied/i.test(text(error));
const isNetwork = error => !isDenied(error) && (error?.code === 'mukando/timeout' || !browserOnline() || /unavailable|network|offline|disconnect|failed to fetch/i.test(text(error)));
function timed(promise, ms = 12000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('The server did not respond.'), { code: 'mukando/timeout' })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
let probeTimer;
function markDown() {
  state.netDown = true; emit();
  if (probeTimer) return;
  probeTimer = setTimeout(() => { probeTimer = null; state.netDown = false; syncNow().catch(() => {}); }, 15000);
}

// ---------- Paths ----------
// Local paths drop the "mukando/" prefix; anything outside it is not mirrored.
const toLocalPath = path => { const parts = String(path).split('/').filter(Boolean); return parts[0] === 'mukando' ? parts.slice(1).join('/') : null; };
const toLocalUpdates = updates => Object.fromEntries(Object.entries(updates).map(([path, value]) => [toLocalPath(path), value]).filter(([path]) => path !== null));
const snapshotOf = value => ({ val: () => value ?? null, exists: () => value !== null && value !== undefined });
const normalise = path => String(path ?? '').split('/').filter(Boolean).join('/');

// ---------- Session ----------
// cloud = signed in to Firebase right now. An offline-only login has no cloud session, so it cannot send changes until the person logs in again online.
export async function startSession(uid, cloud) {
  await openStore(uid);
  state.uid = uid; state.cloud = cloud;
  state.rejected = await local.meta('rejected') ?? [];
  state.lastSync = await local.meta('lastSync');
  state.pending = await local.outboxSize();
  emit();
}
export function endSession() { state.uid = null; state.cloud = false; state.pending = 0; state.rejected = []; emit(); }
export function setForcedOffline(value) { state.forcedOffline = Boolean(value); if (!value) state.netDown = false; emit(); }
export function requireOnline(what = 'This') {
  if (!isOnline()) throw new Error(`${what} needs an internet connection. Reconnect and try again.`);
}
export function getStatus() {
  const online = isOnline();
  return { signedIn: state.uid !== null, online, needsLogin: state.uid !== null && !state.cloud && browserOnline(), syncing: state.busy, pending: state.pending, rejected: [...state.rejected], lastSync: state.lastSync, changed: state.changed };
}
export async function dismissRejected() { state.rejected = []; await local.setMeta('rejected', []); emit(); }

// ---------- Sending the outbox ----------
function describe(updates) {
  const log = Object.entries(updates).find(([path]) => path.startsWith('mukando/auditLog/'));
  return log?.[1]?.details ?? Object.keys(updates)[0] ?? 'A change';
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// A write that timed out may still have reached the server, so a retry can be "denied" because it already exists.
async function alreadyApplied(updates) {
  try {
    const { ref, get, database } = await real();
    for (const [path, value] of Object.entries(updates)) {
      if (!same((await timed(get(ref(database, path)))).val(), value)) return false;
    }
    return true;
  } catch { return false; }
}
async function reject(operation, error) {
  state.rejected = [...state.rejected, { time: new Date().toISOString(), change: describe(operation.updates), reason: error?.message ?? 'Rejected by the server.' }].slice(-20);
  await local.setMeta('rejected', state.rejected);
  await local.dequeue(operation.seq);
}
async function sendOutbox() {
  const operations = await local.outbox();
  if (!operations.length) return true;
  if (!isOnline()) return false;
  const { ref, update, database } = await real();
  let rejectedAny = false;
  for (const operation of operations) {
    try {
      await timed(update(ref(database), operation.updates));
      await local.dequeue(operation.seq);
    } catch (error) {
      if (isDenied(error)) {
        if (await alreadyApplied(operation.updates)) await local.dequeue(operation.seq);
        else { await reject(operation, error); rejectedAny = true; }
      } else {
        if (isNetwork(error)) markDown(); else await local.markAttempt(operation.seq);
        state.pending = await local.outboxSize(); emit();
        return false;
      }
    }
  }
  state.pending = await local.outboxSize();
  // A rejected change is rolled back by re-reading the server's version below.
  if (rejectedAny) state.changed = true;
  emit();
  return state.pending === 0;
}
let flushing = null;
export function flush() {
  if (!state.uid) return Promise.resolve(true);
  flushing ??= (async () => {
    const run = () => sendOutbox();
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request('mukando-flush-' + state.uid, run) : run();
  })().finally(() => { flushing = null; });
  return flushing;
}

// ---------- Refreshing the local copy from the server ----------
const staffRoles = ['admin', 'chairperson', 'treasurer'];
export async function pull() {
  if (!state.uid || !isOnline() || await local.outboxSize()) return false;
  const { ref, get, query, orderByChild, equalTo, database } = await real();
  const read = (path, ...constraints) => timed(get(constraints.length ? query(ref(database, path), ...constraints) : ref(database, path)), 20000).then(snapshot => snapshot.val());
  const before = await local.fingerprint(), hadSynced = Boolean(state.lastSync);
  try {
    const own = await read(`mukando/users/${state.uid}`);
    await local.replace(`users/${state.uid}`, own);
    if (own?.active && staffRoles.includes(own.role)) {
      for (const name of collections) {
        if (name === 'users' && own.role !== 'admin') continue;
        if (['auditLog', 'restoreMode'].includes(name) && own.role !== 'admin') continue;
        try { await local.replace(name, await read(`mukando/${name}`)); } catch (error) { if (!isDenied(error)) throw error; }
      }
    } else if (own?.active && own.role === 'member') {
      const id = own.memberId;
      for (const name of ['rules', 'settings']) await local.replace(name, await read(`mukando/${name}`));
      await local.replace('reminders', await read('mukando/reminders', orderByChild('type'), equalTo('meeting')));
      if (id) {
        await local.replace(`members/${id}`, await read(`mukando/members/${id}`));
        await local.replace(`memberCycles/${id}`, await read(`mukando/memberCycles/${id}`));
        await local.replace('payments', await read('mukando/payments', orderByChild('memberId'), equalTo(id)));
        await local.replace('payouts', await read('mukando/payouts', orderByChild('memberId'), equalTo(id)));
      }
    }
  } catch (error) {
    if (isNetwork(error)) markDown(); else throw error;
    return false;
  }
  state.lastSync = new Date().toISOString();
  await local.setMeta('lastSync', state.lastSync);
  // The first sync only fills the device; later differences mean someone else changed the club's data.
  if (hadSynced && before !== await local.fingerprint()) state.changed = true;
  return true;
}
export async function syncNow() {
  if (!state.uid || state.busy || !isOnline()) return false;
  state.busy = true; emit();
  try {
    if (!await flush()) return false;
    const ok = await pull();
    return ok;
  } catch (error) {
    if (isNetwork(error)) markDown();
    return false;
  } finally { state.busy = false; state.pending = await local.outboxSize().catch(() => 0); emit(); }
}
let started = false;
// Call once per page after the person is signed in: syncs now, when the connection returns, and regularly.
export function startSync() {
  if (started || !state.uid) return;
  started = true;
  globalThis.addEventListener?.('online', () => { state.netDown = false; syncNow(); });
  globalThis.addEventListener?.('offline', emit);
  globalThis.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') syncNow(); }, 60000);
  if (isOnline()) real().catch(() => {}); // Fetching the SDK lets the service worker keep a copy for offline use.
  syncNow();
}

// ---------- The database API that db.js uses ----------
function toReal(sdk, reference) {
  const base = sdk.ref(sdk.database, reference.path || undefined);
  const constraints = [];
  if (reference.orderBy !== undefined) constraints.push(sdk.orderByChild(reference.orderBy));
  if ('equalTo' in reference) constraints.push(sdk.equalTo(reference.equalTo));
  return constraints.length ? sdk.query(base, ...constraints) : base;
}
const fullUpdates = (reference, values) => Object.fromEntries(Object.entries(values).map(([path, value]) => [normalise(reference.path ? `${reference.path}/${path}` : path), value]));
// Write to the server when possible; otherwise keep the change on this device until it can be sent.
async function commit(updates) {
  if (isOnline() && await flush()) {
    try {
      const sdk = await real();
      await timed(sdk.update(sdk.ref(sdk.database), updates));
      await local.apply(toLocalUpdates(updates));
      return;
    } catch (error) {
      if (!isNetwork(error)) throw error; // Rules and validation errors reach the screen as before.
      markDown();
    }
  }
  await local.apply(toLocalUpdates(updates), { queue: updates });
  state.pending = await local.outboxSize(); emit();
}
const bridge = {
  database: { local: true },
  ref: (database, path = '') => ({ path: normalise(path) }),
  orderByChild: child => ({ orderBy: child }),
  equalTo: value => ({ equalTo: value }),
  query: (reference, ...constraints) => Object.assign({}, reference, ...constraints),
  async get(reference) {
    if (!state.uid) { const sdk = await real(); return sdk.get(toReal(sdk, reference)); }
    if (isOnline() && await flush()) {
      try {
        const sdk = await real();
        const snapshot = await timed(sdk.get(toReal(sdk, reference)), 15000);
        const path = toLocalPath(reference.path);
        if (path !== null) {
          if (reference.orderBy !== undefined) await local.merge(path, snapshot.val());
          else await local.replace(path, snapshot.val());
        }
        return snapshot;
      } catch (error) {
        if (!isNetwork(error)) throw error;
        markDown();
      }
    }
    const path = toLocalPath(reference.path);
    if (path === null) return snapshotOf(null);
    if (reference.orderBy !== undefined) {
      const rows = await local.where(path.split('/')[0], reference.orderBy, reference.equalTo);
      return snapshotOf(Object.keys(rows).length ? rows : null);
    }
    return snapshotOf(await local.get(path));
  },
  async update(reference, values) {
    if (!state.uid) { const sdk = await real(); return sdk.update(sdk.ref(sdk.database, reference.path || undefined), values); }
    await commit(fullUpdates(reference, values));
  },
  async set(reference, value) {
    if (!state.uid) { const sdk = await real(); return sdk.set(sdk.ref(sdk.database, reference.path || undefined), value); }
    await commit({ [reference.path]: value ?? null });
  },
  async runTransaction(reference, compute, options) {
    if (!state.uid) { const sdk = await real(); return sdk.runTransaction(toReal(sdk, reference), compute, options); }
    if (isOnline() && await flush()) {
      try {
        const sdk = await real();
        const result = await timed(sdk.runTransaction(toReal(sdk, reference), compute, options));
        const path = toLocalPath(reference.path);
        if (result.committed && path !== null) await local.replace(path, result.snapshot.val());
        return result;
      } catch (error) {
        if (!isNetwork(error)) throw error;
        markDown();
      }
    }
    const current = await local.get(toLocalPath(reference.path) ?? '');
    const next = compute(current);
    if (next === undefined) return { committed: false, snapshot: snapshotOf(current) };
    await commit({ [reference.path]: next });
    return { committed: true, snapshot: snapshotOf(next) };
  }
};
export const backend = () => bridge;
