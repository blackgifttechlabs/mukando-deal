import { logout, guard } from './auth.js';
import { renderWorkspaceIdentity } from './workspace.js';
// Build shared navigation using textContent so user names cannot insert HTML.
export function mountLayout(user) {
  renderWorkspaceIdentity(user);
  const button = document.querySelector('[data-logout-button]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await logout(); } catch (error) { showError(document.querySelector('[data-error]'), error); button.disabled = false; }
  });
}
export function showError(element, error) {
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Could not connect. Check your internet connection.',
    'auth/operation-not-allowed': 'Email login is not enabled in Firebase yet.',
    'auth/configuration-not-found': 'Enable Authentication in the Firebase console first.',
    'auth/email-already-in-use': 'That email already has an account. Link it in the Firebase console, or use another email.',
    'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
    'auth/requires-recent-login': 'Please log out and sign in again, then retry.',
    'auth/missing-password': 'Enter your current password.',
    'PERMISSION_DENIED': 'Database access was denied. Ask the administrator to check your profile and database rules.'
  };
  element.textContent = messages[error.code] || error.message || 'Something went wrong. Please try again.';
  element.hidden = false;
}

// Check access before exposing page content or requesting club records.
export async function preparePage(allowedRoles) {
  const user = await guard(allowedRoles);
  if (!user) return null;
  mountLayout(user);
  return user;
}
export function showSuccess(message) {
  const element = document.querySelector('[data-success]');
  element.textContent = message; element.hidden = false;
}

export function finishLoading() {
  document.querySelector('[data-loading]').hidden = true;
  document.querySelector('[data-content]').hidden = false;
  document.querySelector('.workspace-main').setAttribute('aria-busy', 'false');
}
export function failLoading(error) {
  document.querySelector('[data-loading]').hidden = true;
  document.querySelector('.workspace-main').setAttribute('aria-busy', 'false');
  showError(document.querySelector('[data-error]'), error);
}

export function tableCell(value) {
  const cell = document.createElement('td'); cell.textContent = value; return cell;
}
export function selectOptions(select, options, placeholder) {
  select.replaceChildren();
  if (placeholder !== undefined) {
    const option = document.createElement('option'); option.value = ''; option.textContent = placeholder; select.append(option);
  }
  for (const [value, label] of options) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
}
