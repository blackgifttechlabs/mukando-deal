import { signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth } from './firebase.js';
import { db, setLayoutUser } from './db.js';
export const roles = ['admin', 'chairperson', 'treasurer', 'member'];
// Firebase manages passwords and sessions; passwords never enter the club database.
export async function currentUser() {
  await auth.authStateReady();
  if (!auth.currentUser) { setLayoutUser(null); return null; }
  let user;
  try {
    user = await db.get('users', auth.currentUser.uid);
  } catch (error) {
    if (/permission[_ -]?denied/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
      await signOut(auth);
      throw new Error('Your login worked, but database rules blocked your club profile. Ask the administrator to publish the Mukando database rules.');
    }
    throw error;
  }
  if (!user?.active || !roles.includes(user.role)) {
    setLayoutUser(null);
    await signOut(auth);
    throw new Error('Your club account is missing or inactive. Ask the administrator to set it up.');
  }
  setLayoutUser(user);
  return user;
}
export async function login(email, password) {
  try {
    await setPersistence(auth, browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return await currentUser();
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}
export async function guard(allowedRoles = roles) {
  const user = await currentUser();
  if (!user) { location.replace('index.html'); return null; }
  if (!allowedRoles.includes(user.role)) { location.replace('dashboard.html'); return null; }
  return user;
}
export async function logout() {
  await signOut(auth);
  setLayoutUser(null);
  location.replace('index.html');
}
