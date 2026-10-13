// Phone behaviour shared by every signed-in page: a slide-in menu and labelled table cells.
const topbar = document.querySelector('.workspace-topbar');
const sidebar = document.querySelector('.workspace-sidebar');
if (topbar && sidebar) {
  const desktop = matchMedia('(min-width: 900px)');
  sidebar.id ||= 'workspace-sidebar';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'nav-toggle';
  button.setAttribute('aria-controls', sidebar.id); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'Open menu');
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  topbar.prepend(button);
  const backdrop = document.createElement('div');
  backdrop.className = 'nav-backdrop'; backdrop.hidden = true;
  sidebar.after(backdrop);
  function setOpen(open, returnFocus = true) {
    document.body.classList.toggle('nav-open', open);
    backdrop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) sidebar.querySelector('[data-nav] a:not([hidden])')?.focus();
    else if (returnFocus) button.focus();
  }
  button.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', event => { if (event.target.closest('[data-nav] a')) setOpen(false, false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('nav-open')) setOpen(false); });
  desktop.addEventListener('change', event => { if (event.matches) setOpen(false, false); });
}
// Tables become stacked cards on phones. Each cell shows its column heading from this label.
function labelTables() {
  for (const table of document.querySelectorAll('table.member-table')) {
    const headings = [...table.querySelectorAll('thead th')].map(heading => heading.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, index) => { if (cell.dataset.label === undefined) cell.dataset.label = headings[index] ?? ''; });
    }
  }
}
let queued = false;
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; labelTables(); }); } })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', labelTables);
