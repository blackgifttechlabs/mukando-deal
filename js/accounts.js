// Sign-in accounts live in Firebase Authentication. This file never stores a password in the club database.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, firebaseConfig } from './firebase.js';
export function checkPassword(password) {
  if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Use letters and at least one number in the password.');
}
// A second, temporary app signs the new person up, so the administrator stays signed in.
export async function createAuthAccount(email, password) {
  checkPassword(password);
  const helper = initializeApp(firebaseConfig, 'account-creator-' + Date.now());
  try {
    const helperAuth = getAuth(helper);
    const { user } = await createUserWithEmailAndPassword(helperAuth, email.trim(), password);
    await signOut(helperAuth);
    return user.uid;
  } finally { await deleteApp(helper); }
}
// Firebase e-mails the person a link to choose a new password.
export function sendResetEmail(email) { return sendPasswordResetEmail(auth, email.trim()); }
export async function changeOwnPassword(current, next) {
  checkPassword(next);
  if (!auth.currentUser?.email) throw new Error('Sign in again before changing your password.');
  await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, current));
  await updatePassword(auth.currentUser, next);
}
export const ownEmail = () => auth.currentUser?.email ?? '';
