import { signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth } from './firebase.js';
import { db, setLayoutUser } from './db.js';
import { startSession, endSession, startSync, syncNow } from './sync.js';
import { rememberCredential, checkCredential } from './localdb.js';
export const roles = ['admin', 'chairperson', 'treasurer', 'member'];
// Firebase manages passwords and sessions; passwords never enter the club database.
// An offline login has no Firebase session, so it is remembered for this tab only (like the online session).
const offlineKey = 'mukando-offline-session';
function offlineSession() {
  try { return JSON.parse(sessionStorage.getItem(offlineKey) ?? 'null'); } catch { return null; }
}
function setOfflineSession(session) {
  try { if (session) sessionStorage.setItem(offlineKey, JSON.stringify(session)); else sessionStorage.removeItem(offlineKey); } catch { /* Not remembered; the person logs in again. */ }
}
export async function currentUser() {
  let uid = null, cloud = false;
  try { await auth.authStateReady(); } catch { /* Firebase Authentication could not start, for example offline. */ }
  if (auth.currentUser) { uid = auth.currentUser.uid; cloud = true; }
  else if (offlineSession()) uid = offlineSession().uid;
  if (!uid) { setLayoutUser(null); endSession(); return null; }
  await startSession(uid, cloud);
  let user;
  try {
    user = await db.get('users', uid);
  } catch (error) {
    if (/permission[_ -]?denied/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
      await signOut(auth);
      throw new Error('Your login worked, but database rules blocked your club profile. Ask the administrator to publish the Mukando database rules.');
    }
    throw error;
  }
  if (!user?.active || !roles.includes(user.role)) {
    setLayoutUser(null); setOfflineSession(null); endSession();
    await signOut(auth);
    throw new Error('Your club account is missing or inactive. Ask the administrator to set it up.');
  }
  setLayoutUser(user);
  startSync();
  return user;
}
const isNetworkFailure = error => error?.code === 'auth/network-request-failed' || !navigator.onLine;
export async function login(email, password) {
  if (navigator.onLine) {
    try {
      await setPersistence(auth, browserSessionPersistence);
      const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
      setOfflineSession(null);
      // Remember a salted hash so the same person can log in later without internet.
      try { await rememberCredential(email, user.uid, password); } catch { /* Offline login just stays unavailable. */ }
      return await currentUser();
    } catch (error) {
      if (!isNetworkFailure(error)) { await signOut(auth); throw error; }
    }
  }
  const uid = await checkCredential(email, password);
  if (!uid) {
    throw Object.assign(new Error('You are offline. Offline login only works for accounts that have logged in on this device while online, and the email and password must match.'), { code: 'mukando/offline-login' });
  }
  setOfflineSession({ uid, email: email.trim().toLowerCase() });
  return await currentUser();
}
// After an offline login, the password is asked for once more when the connection returns, so changes can be sent.
export async function reconnect(password) {
  const session = offlineSession();
  if (!session) throw new Error('You are already connected.');
  await setPersistence(auth, browserSessionPersistence);
  const { user } = await signInWithEmailAndPassword(auth, session.email, password);
  if (user.uid !== session.uid) { await signOut(auth); throw new Error('That password belongs to a different account.'); }
  setOfflineSession(null);
  try { await rememberCredential(session.email, user.uid, password); } catch { /* Offline login keeps working with the earlier hash. */ }
  await startSession(user.uid, true);
  await syncNow();
}
export async function guard(allowedRoles = roles) {
  const user = await currentUser();
  if (!user) { location.replace('index.html'); return null; }
  if (!allowedRoles.includes(user.role)) { location.replace('dashboard.html'); return null; }
  return user;
}
export async function logout() {
  setOfflineSession(null); endSession();
  try { await signOut(auth); } catch { /* Signing out of this device still works offline. */ }
  setLayoutUser(null);
  location.replace('index.html');
}
