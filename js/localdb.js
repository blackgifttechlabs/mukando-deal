// On-device SQLite copy of the club database (sql.js). One database per signed-in user, so one
// person's records are never readable by another account on a shared device.
// The tree below mirrors Realtime Database paths (without the "mukando/" prefix). Each record is one
// row, so a save to "members/m1/fullName" only rewrites the "members/m1" row.
// Pending changes made offline wait in the outbox until sync.js can send them.

// How many path keys make up one record (same shape as backupTables in db.js).
const depths = {
  users: 1, members: 1, rules: 1, rounds: 1, cycles: 1, roundRecipients: 2, memberCycles: 2, cycleLocks: 2,
  payments: 1, paymentReversals: 1, payouts: 1, cycleApprovals: 1, reminders: 1, settings: 1, auditLog: 1, restoreMode: 0
};
export const collections = Object.keys(depths);
const depthOf = collection => depths[collection] ?? 1;
const clone = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

// ---------- Persistence: the SQLite file is kept in IndexedDB (memory only where IndexedDB is missing) ----------
const memory = new Map();
let idbPromise;
function idb() {
  if (typeof indexedDB === 'undefined') return null;
  idbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('mukando-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return idbPromise;
}
async function kvGet(key) {
  const database = await idb();
  if (!database) return memory.get(key);
  return new Promise((resolve, reject) => {
    const request = database.transaction('kv').objectStore('kv').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function kvPut(key, value) {
  const database = await idb();
  if (!database) { memory.set(key, value); return; }
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('kv', 'readwrite');
    transaction.objectStore('kv').put(value, key);
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
  });
}
export async function kvDelete(key) {
  const database = await idb();
  if (!database) { memory.delete(key); return; }
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('kv', 'readwrite');
    transaction.objectStore('kv').delete(key);
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
  });
}
export { kvGet, kvPut };

// ---------- sql.js loader ----------
let sqlPromise;
function loadSql() {
  sqlPromise ??= (async () => {
    const folder = new URL('../vendor/', import.meta.url);
    if (typeof document === 'undefined') { // Node (tests)
      const { createRequire } = await import('node:module');
      const { fileURLToPath } = await import('node:url');
      return createRequire(import.meta.url)('../vendor/sql-wasm.js')({ locateFile: file => fileURLToPath(new URL(file, folder)) });
    }
    if (!globalThis.initSqlJs) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('sql-wasm.js', folder).href;
        script.onload = resolve; script.onerror = () => reject(new Error('The offline database could not be loaded.'));
        document.head.append(script);
      });
    }
    return globalThis.initSqlJs({ locateFile: file => new URL(file, folder).href });
  })();
  return sqlPromise;
}

// ---------- Opening a user's database ----------
let sqlite = null, owner = null, loadedStamp = null, saveTimer = null, dirty = false;
const schema = `
  CREATE TABLE IF NOT EXISTS records (coll TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (coll, key));
  CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, updates TEXT NOT NULL, created TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`;
export const storeOwner = () => owner;

export async function openStore(uid) {
  if (owner === uid && sqlite) return;
  await closeStore();
  const SQL = await loadSql();
  const saved = await kvGet('sqlite:' + uid);
  sqlite = saved ? new SQL.Database(saved) : new SQL.Database();
  sqlite.run(schema);
  owner = uid; loadedStamp = await kvGet('stamp:' + uid) ?? null; dirty = false;
}
export async function closeStore() {
  if (sqlite && dirty) await saveNow();
  sqlite?.close(); sqlite = null; owner = null;
}
// Another tab may have saved newer data since this page loaded it, so re-read before touching anything.
async function fresh() {
  if (!sqlite) throw new Error('The offline database is not open.');
  if (typeof indexedDB === 'undefined') return;
  const stamp = await kvGet('stamp:' + owner) ?? null;
  if (stamp === loadedStamp) return;
  const SQL = await loadSql(), saved = await kvGet('sqlite:' + owner);
  sqlite.close(); sqlite = saved ? new SQL.Database(saved) : new SQL.Database(); sqlite.run(schema);
  loadedStamp = stamp; dirty = false;
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!sqlite || !dirty) return;
  const stamp = crypto.randomUUID();
  await kvPut('sqlite:' + owner, sqlite.export());
  await kvPut('stamp:' + owner, stamp);
  loadedStamp = stamp; dirty = false;
}
export const persist = saveNow;
function touched(immediately = false) {
  dirty = true;
  if (immediately) return saveNow();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow().catch(() => {}), 300);
}
if (typeof addEventListener === 'function') addEventListener('pagehide', () => { saveNow().catch(() => {}); });

// ---------- Small SQL helpers ----------
function all(sql, params = []) {
  const statement = sqlite.prepare(sql); statement.bind(params);
  const rows = []; while (statement.step()) rows.push(statement.getAsObject());
  statement.free(); return rows;
}
const run = (sql, params = []) => sqlite.run(sql, params);

// ---------- Tree helpers ----------
function descend(value, segments) {
  for (const segment of segments) {
    if (value === null || typeof value !== 'object') return null;
    value = value[segment] ?? null;
  }
  return value ?? null;
}
// Set (or with null, delete) a nested value, dropping objects that become empty. Returns the new root or null.
function setIn(root, segments, value) {
  if (!segments.length) return value;
  const next = root !== null && typeof root === 'object' ? { ...root } : {};
  const child = setIn(next[segments[0]] ?? null, segments.slice(1), value);
  if (child === null || (typeof child === 'object' && !Object.keys(child).length)) delete next[segments[0]];
  else next[segments[0]] = child;
  return Object.keys(next).length ? next : null;
}
// Cut a nested value into [key, value] pairs "depth" levels down.
function* flatten(value, depth, prefix = []) {
  if (depth === 0) { if (value !== null) yield [prefix.join('/'), value]; return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) yield* flatten(child, depth - 1, [...prefix, key]);
}
const segmentsOf = path => String(path).split('/').filter(Boolean);

// ---------- Reading and writing the mirrored tree ----------
function readPath(segments) {
  if (!segments.length) {
    const root = {};
    for (const collection of Object.keys(depths)) { const value = readPath([collection]); if (value !== null) root[collection] = value; }
    return Object.keys(root).length ? root : null;
  }
  const [collection, ...rest] = segments, depth = depthOf(collection);
  if (rest.length >= depth) {
    const [row] = all('SELECT value FROM records WHERE coll = ? AND key = ?', [collection, rest.slice(0, depth).join('/')]);
    return row ? descend(JSON.parse(row.value), rest.slice(depth)) : null;
  }
  const prefix = rest.join('/');
  const rows = prefix ? all("SELECT key, value FROM records WHERE coll = ? AND key LIKE ? ESCAPE '\\'", [collection, prefix.replace(/[\\%_]/g, '\\$&') + '/%']) : all('SELECT key, value FROM records WHERE coll = ?', [collection]);
  let result = null;
  for (const row of rows) result = setIn(result, row.key.split('/').slice(rest.length), JSON.parse(row.value));
  return result;
}
function writePath(segments, value) {
  value = clone(value);
  if (!segments.length) { // Replace everything.
    run('DELETE FROM records');
    for (const [collection, content] of Object.entries(value ?? {})) writePath([collection], content);
    return;
  }
  const [collection, ...rest] = segments, depth = depthOf(collection);
  if (rest.length >= depth) {
    const key = rest.slice(0, depth).join('/');
    const [row] = all('SELECT value FROM records WHERE coll = ? AND key = ?', [collection, key]);
    const next = setIn(row ? JSON.parse(row.value) : null, rest.slice(depth), value);
    if (next === null) run('DELETE FROM records WHERE coll = ? AND key = ?', [collection, key]);
    else run('INSERT OR REPLACE INTO records (coll, key, value) VALUES (?, ?, ?)', [collection, key, JSON.stringify(next)]);
    return;
  }
  const prefix = rest.join('/');
  if (prefix) run("DELETE FROM records WHERE coll = ? AND key LIKE ? ESCAPE '\\'", [collection, prefix.replace(/[\\%_]/g, '\\$&') + '/%']);
  else run('DELETE FROM records WHERE coll = ?', [collection]);
  for (const [key, row] of flatten(value, depth - rest.length, rest)) run('INSERT OR REPLACE INTO records (coll, key, value) VALUES (?, ?, ?)', [collection, key, JSON.stringify(row)]);
}

export const local = {
  async get(path) { await fresh(); return readPath(segmentsOf(path)); },
  // Rows of a collection whose child field equals a value (what orderByChild + equalTo asks for).
  async where(collection, child, value) {
    await fresh();
    const rows = readPath([collection]) ?? {};
    return Object.fromEntries(Object.entries(rows).filter(([, row]) => row !== null && typeof row === 'object' && row[child] === value));
  },
  // Make this device match the server for one path.
  async replace(path, value) { await fresh(); writePath(segmentsOf(path), value); touched(); },
  // Add or overwrite rows without deleting others (used for filtered server queries).
  async merge(collection, rows) {
    await fresh();
    for (const [id, row] of Object.entries(rows ?? {})) writePath([collection, id], row);
    touched();
  },
  // Apply a multi-path update (null deletes), the same way the server would.
  // With queue, the original (server-path) updates are also stored in the outbox to be sent later.
  async apply(updates, { queue = null } = {}) {
    await fresh();
    run('BEGIN');
    try {
      for (const [path, value] of Object.entries(updates)) writePath(segmentsOf(path), value);
      if (queue) run('INSERT INTO outbox (updates, created) VALUES (?, ?)', [JSON.stringify(queue), new Date().toISOString()]);
      run('COMMIT');
    } catch (error) { run('ROLLBACK'); throw error; }
    // Queued changes must survive the tab closing, so they are written to disk straight away.
    await touched(Boolean(queue));
  },
  async outbox() { await fresh(); return all('SELECT seq, updates, created, attempts FROM outbox ORDER BY seq').map(row => ({ ...row, updates: JSON.parse(row.updates) })); },
  async outboxSize() { await fresh(); return all('SELECT COUNT(*) AS n FROM outbox')[0].n; },
  async dequeue(seq) { await fresh(); run('DELETE FROM outbox WHERE seq = ?', [seq]); await touched(true); },
  async markAttempt(seq) { await fresh(); run('UPDATE outbox SET attempts = attempts + 1 WHERE seq = ?', [seq]); await touched(true); },
  async meta(key) { await fresh(); const [row] = all('SELECT value FROM meta WHERE key = ?', [key]); return row ? JSON.parse(row.value) : null; },
  async setMeta(key, value) { await fresh(); run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]); await touched(true); },
  // Stable text of everything on this device, to tell whether a sync changed anything.
  async fingerprint() { await fresh(); return JSON.stringify(all('SELECT coll, key, value FROM records ORDER BY coll, key')); }
};

// ---------- Offline sign-in: a salted, slow hash of the password, never the password ----------
const iterations = 210000;
const toHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = text => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16));
async function derive(password, salt, count) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: count }, key, 256));
}
export async function rememberCredential(email, uid, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const all = await kvGet('credentials') ?? {};
  all[email.trim().toLowerCase()] = { uid, salt: toHex(salt), iterations, hash: await derive(password, salt, iterations) };
  await kvPut('credentials', all);
}
// Returns the user ID when the email and password match what was used for the last online login.
export async function checkCredential(email, password) {
  const entry = (await kvGet('credentials') ?? {})[email.trim().toLowerCase()];
  if (!entry) return null;
  const hash = await derive(password, fromHex(entry.salt), entry.iterations);
  let difference = hash.length ^ entry.hash.length;
  for (let index = 0; index < hash.length; index++) difference |= hash.charCodeAt(index) ^ (entry.hash.charCodeAt(index) || 0);
  return difference === 0 ? entry.uid : null;
}
