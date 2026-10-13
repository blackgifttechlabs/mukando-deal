import { db, saveWithAudit } from './db.js';
import { preparePage, showError, showSuccess, finishLoading, failLoading } from './ui.js';
import { today, formatDate, formatMoney, validateMember, memberOutstanding } from './utils.js';
const errorBox = document.querySelector('[data-error]');
function clearMessages() {
  errorBox.hidden = true;
  document.querySelector('[data-success]').hidden = true;
}
function cell(text) {
  const element = document.createElement('td'); element.textContent = text; return element;
}
async function memberList(user) {
  let members = await db.list('members');
  const search = document.querySelector('#member-search');
  const filter = document.querySelector('#status-filter');
  const body = document.querySelector('[data-members]');
  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = members.filter(member =>
      (filter.value === 'all' || member.status === filter.value) &&
      `${member.fullName} ${member.phone}`.toLowerCase().includes(query)
    ).sort((a, b) => a.fullName.localeCompare(b.fullName));
    body.replaceChildren();
    document.querySelector('[data-summary]').textContent = `${visible.length} of ${members.length} members · ${members.filter(member => member.status === 'active').length} active`;
    const empty = document.querySelector('[data-empty]');
    empty.hidden = visible.length > 0;
    empty.querySelector('h2').textContent = members.length ? 'No matching members' : 'No members yet';
    empty.querySelector('p').textContent = members.length ? 'Try another search or status filter.' : 'Add your first member to get started.';
    for (const member of visible) {
      const row = document.createElement('tr');
      row.append(cell(member.fullName), cell(member.phone), cell(formatDate(member.joinDate)));
      const statusCell = cell(''); const badge = document.createElement('span');
      badge.className = `member-status ${member.status === 'active' ? 'is-active' : 'is-inactive'}`;
      badge.textContent = member.status; statusCell.append(badge); row.append(statusCell);
      const actions = cell(''); const group = document.createElement('div'); group.className = 'row-actions';
      const edit = document.createElement('a'); edit.href = `member-form.html?id=${encodeURIComponent(member.id)}`; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${member.fullName}`);
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'text-button';
      toggle.textContent = member.status === 'active' ? 'Deactivate' : 'Activate';
      toggle.setAttribute('aria-label', `${toggle.textContent} ${member.fullName}`);
      toggle.addEventListener('click', async () => {
        clearMessages(); toggle.disabled = true;
        try {
          // Reload records so status and outstanding amounts are not based on the old table.
          const current = await db.get('members', member.id);
          if (!current) throw new Error('This member was not found. Refresh the list.');
          const nextStatus = current.status === 'active' ? 'inactive' : 'active';
          if (nextStatus === 'inactive') {
            const cycles = await db.list('cycles');
            if (cycles.length) {
              const [payments, rules] = await Promise.all([db.list('payments'), db.get('rules', 'club')]);
              const outstanding = memberOutstanding(current, cycles, payments, rules);
              if (outstanding > 0) throw new Error(`${current.fullName} still owes ${formatMoney(outstanding)}. Record the missing contributions before deactivating this member.`);
              throw new Error('A rotation already exists. Member deactivation is paused until cycle membership can be reviewed.');
            }
          }
          if (!confirm(`${nextStatus === 'inactive' ? 'Deactivate' : 'Activate'} ${current.fullName}?`)) return;
          await saveWithAudit('members', current.id, { status: nextStatus }, user,
            'member.status', `${current.fullName}: ${current.status} → ${nextStatus}`);
          members = await db.list('members'); render();
          showSuccess(`${current.fullName} is now ${nextStatus}.`);
        } catch (error) { showError(errorBox, error); }
        finally { toggle.disabled = false; }
      });
      group.append(edit, toggle); actions.append(group); row.append(actions); body.append(row);
    }
  }
  search.addEventListener('input', render); filter.addEventListener('change', render); render();
}
async function memberForm(user) {
  const form = document.querySelector('[data-member-form]');
  const button = document.querySelector('[data-save]');
  const id = new URLSearchParams(location.search).get('id');
  let existing = null;
  form.elements.joinDate.value = today(); form.elements.joinDate.max = today();
  if (id) {
    existing = await db.get('members', id);
    if (!existing) throw new Error('Member not found. Return to Members and choose a member to edit.');
    document.querySelector('[data-form-title]').textContent = 'Edit member';
    document.title = 'Edit member | Mukando Manager';
    for (const field of ['fullName', 'phone', 'joinDate', 'notes']) form.elements[field].value = existing[field] ?? '';
    // Membership dates determine who owes contributions, so keep them fixed once cycles exist.
    if ((await db.list('cycles')).length) form.elements.joinDate.readOnly = true;
  }
  button.disabled = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); clearMessages(); button.disabled = true; button.textContent = 'Saving…';
    try {
      const values = validateMember(Object.fromEntries(new FormData(form)));
      const recordId = id ?? crypto.randomUUID();
      if (!id) values.status = 'active';
      await saveWithAudit('members', recordId, values, user, id ? 'member.updated' : 'member.created', values.fullName);
      location.assign('members.html?saved=' + (id ? 'updated' : 'added'));
    } catch (error) { showError(errorBox, error); }
    finally { button.disabled = false; button.textContent = 'Save member'; }
  });
}
try {
  const user = await preparePage(['admin', 'chairperson']);
  if (user) {
    if (document.body.dataset.page === 'member-form') await memberForm(user);
    else {
      await memberList(user);
      const saved = new URLSearchParams(location.search).get('saved');
      if (['added', 'updated'].includes(saved)) {
        showSuccess(`Member ${saved} successfully.`);
        history.replaceState(null, '', 'members.html');
      }
    }
    finishLoading();
  }
} catch (error) { failLoading(error); }

