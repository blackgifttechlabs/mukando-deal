import { getThemePreference, setThemePreference } from './db.js';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const button = document.querySelector('[data-theme-toggle]');
let preference = getThemePreference();
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#ffffff');
  if (button) {
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = button.getAttribute('aria-label');
    button.querySelector('[data-theme-label]').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }
}
applyTheme(preference ?? (systemTheme.matches ? 'dark' : 'light'));
button?.addEventListener('click', () => {
  preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setThemePreference(preference);
  applyTheme(preference);
});
// Follow the device setting until the user chooses a mode.
systemTheme.addEventListener('change', event => {
  if (!preference) applyTheme(event.matches ? 'dark' : 'light');
});
