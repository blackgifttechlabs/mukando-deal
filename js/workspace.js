import "./mobile.js";
import { getLayoutUser } from './db.js';
// Paint static sidebar links immediately using the last verified role.
// Page guards and Firebase rules always re-check permissions independently.
export function renderWorkspaceIdentity(user) {
  for (const link of document.querySelectorAll('[data-nav] a[data-roles]')) {
    link.hidden = !user || !link.dataset.roles.split(' ').includes(user.role);
  }
  const page = document.body.dataset.page ?? 'dashboard';
  for (const link of document.querySelectorAll('[data-nav] a[data-page]')) {
    if (link.dataset.page === page || (page === 'member-form' && link.dataset.page === 'members')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (!user) return;
  for (const [selector, value] of [['[data-user-name]', user.username], ['[data-user-role]', user.role], ['[data-detail-role]', user.role], ['[data-user-initial]', user.username.slice(0, 1).toUpperCase()]]) {
    const element = document.querySelector(selector);
    if (element) { element.textContent = value; element.classList.remove('skeleton', 'skeleton-text'); }
  }
}
renderWorkspaceIdentity(getLayoutUser());
