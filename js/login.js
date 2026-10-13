import { currentUser, login } from './auth.js';
import { showError } from './ui.js';
const form = document.querySelector('form');
const button = form.querySelector('button');
const error = document.querySelector('[data-error]');
try {
  if (await currentUser()) location.replace('dashboard.html');
  else { button.disabled = false; button.textContent = 'Log in'; button.setAttribute('aria-busy', 'false'); }
} catch (problem) { showError(error, problem); button.disabled = false; button.textContent = 'Log in'; button.setAttribute('aria-busy', 'false'); }
form.addEventListener('submit', async event => {
  event.preventDefault(); error.hidden = true; button.disabled = true; button.textContent = 'Logging in…'; button.setAttribute('aria-busy', 'true');
  try {
    await login(form.elements.email.value, form.elements.password.value);
    location.replace('dashboard.html');
  } catch (problem) { showError(error, problem); }
  finally { button.disabled = false; button.textContent = 'Log in'; button.setAttribute('aria-busy', 'false'); }
});
