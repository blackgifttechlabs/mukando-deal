// Stand-ins for the Firebase CDN modules. The database shim talks to the local emulator over REST,
// so the app's real pages run against the real database.rules.json.
export const databaseShim = `
const BASE = 'http://127.0.0.1:9019', NS = 'demo-mukando-e2e';
const part = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
function token() {
  const user = JSON.parse(sessionStorage.getItem('shim-user') || 'null');
  if (!user) return '';
  const now = Math.floor(Date.now() / 1000);
  return part({ alg: 'none', typ: 'JWT' }) + '.' + part({ sub: user.uid, user_id: user.uid, aud: NS, iss: 'https://securetoken.google.com/' + NS, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' } }) + '.';
}
async function rest(path, method = 'GET', body, extra = {}) {
  const params = new URLSearchParams({ ns: NS, ...extra }); const t = token(); if (t) params.set('auth', t);
  const response = await fetch(BASE + '/' + path + '.json?' + params, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) { const error = new Error('PERMISSION_DENIED: Permission denied'); error.code = 'PERMISSION_DENIED'; error.status = response.status; throw error; }
  return text ? JSON.parse(text) : null;
}
const snap = value => ({ val: () => value, exists: () => value !== null && value !== undefined });
export const ref = (database, path = '') => ({ path: path.replace(/^\\/+|\\/+$/g, '') });
export const orderByChild = child => ({ orderBy: JSON.stringify(child) });
export const equalTo = value => ({ equalTo: JSON.stringify(value) });
export const query = (reference, ...constraints) => ({ ...reference, extra: Object.assign({}, ...constraints) });
export async function get(reference) { return snap(await rest(reference.path, 'GET', undefined, reference.extra)); }
export async function set(reference, value) { await rest(reference.path, 'PUT', value); }
export async function update(reference, values) { await rest(reference.path, 'PATCH', values); }
export async function runTransaction(reference, compute) {
  const current = await rest(reference.path); const next = compute(current);
  if (next === undefined) return { committed: false, snapshot: snap(current) };
  await rest(reference.path, 'PUT', next); return { committed: true, snapshot: snap(next) };
}
export const getDatabase = () => ({});
`;
export const appShim = `
export const initializeApp = (config, name) => (name ? { name } : {}); export const deleteApp = async () => {};
`;
export const authShim = `
const accounts = () => window.__accounts || {};
const auth = { currentUser: JSON.parse(sessionStorage.getItem('shim-user') || 'null'), authStateReady: async () => {} };
export const getAuth = app => (app && app.name ? { currentUser: null, helper: true } : auth);
export const setPersistence = async () => {}; export const browserSessionPersistence = {};
const fail = code => Object.assign(new Error(code), { code });
export async function signInWithEmailAndPassword(a, email, password) {
  const account = accounts()[email.toLowerCase()];
  if (!account || account.password !== password) throw fail('auth/invalid-credential');
  auth.currentUser = { uid: account.uid, email }; sessionStorage.setItem('shim-user', JSON.stringify(auth.currentUser)); return { user: auth.currentUser };
}
export async function signOut(target = auth) { target.currentUser = null; if (!target.helper) sessionStorage.removeItem('shim-user'); }
export async function createUserWithEmailAndPassword(a, email, password) {
  const log = JSON.parse(localStorage.getItem('shim-created') || '[]'); const uid = 'new-' + (log.length + 1); log.push({ uid, email, password });
  localStorage.setItem('shim-created', JSON.stringify(log)); return { user: { uid, email } };
}
export async function sendPasswordResetEmail(a, email) { const log = JSON.parse(localStorage.getItem('shim-resets') || '[]'); log.push(email); localStorage.setItem('shim-resets', JSON.stringify(log)); }
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential(user, credential) { const account = accounts()[credential.email.toLowerCase()]; if (!account || account.password !== credential.password) throw fail('auth/invalid-credential'); }
export async function updatePassword(user, password) { const account = accounts()[user.email.toLowerCase()]; account.password = password; window.__passwordChanged = password; }
`;
