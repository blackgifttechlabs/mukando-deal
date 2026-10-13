import { loadUsers, saveUserProfile } from './db.js';
import { createAuthAccount, sendResetEmail } from './accounts.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell, selectOptions } from './ui.js';
const errorBox = document.querySelector('[data-error]');
const $ = selector => document.querySelector(selector);
try {
  const admin = await preparePage(['admin']);
  if (admin) {
    let users, members;
    const form = $('[data-user-form]'), panel = $('[data-user-panel]'), dialog = $('[data-edit-dialog]');
    let editing = null;
    const memberName = id => members.find(member => member.id === id)?.fullName ?? '—';
    // Offer only members that do not yet have an account (plus the one being edited).
    function memberChoices(keep) {
      const taken = new Set(users.filter(account => account.memberId && account.id !== keep).map(account => account.memberId));
      return members.filter(member => !taken.has(member.id)).sort((a, b) => a.fullName.localeCompare(b.fullName)).map(member => [member.id, member.fullName]);
    }
    function renderForm() {
      selectOptions(form.elements.memberId, memberChoices(), 'Choose a member');
      $('[data-link-field]').hidden = form.elements.role.value !== 'member';
      form.elements.memberId.required = form.elements.role.value === 'member';
    }
    function renderUsers() {
      const body = $('[data-users]'); body.replaceChildren();
      $('[data-user-count]').textContent = `${users.length} ${users.length === 1 ? 'account' : 'accounts'}`;
      for (const account of [...users].sort((a, b) => a.username.localeCompare(b.username))) {
        const row = document.createElement('tr');
        row.append(tableCell(account.username), tableCell(account.email ?? '—'), tableCell(account.role), tableCell(account.memberId ? memberName(account.memberId) : '—'));
        const status = tableCell(''); const badge = document.createElement('span'); badge.className = `member-status ${account.active ? 'is-active' : 'is-inactive'}`; badge.textContent = account.active ? 'active' : 'inactive'; status.append(badge); row.append(status);
        const actions = tableCell(''); const controls = document.createElement('div'); controls.className = 'row-actions';
        const add = (label, handler, disabled = false) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.disabled = disabled; button.addEventListener('click', handler); controls.append(button); };
        const isSelf = account.id === admin.id;
        add('Edit', () => openEdit(account));
        add('Reset password', () => run(() => sendResetEmail(account.email), `Password reset email sent to ${account.email}.`), !account.email);
        add(account.active ? 'Deactivate' : 'Activate', () => run(async () => {
          await saveUserProfile({ id: account.id, active: !account.active }, admin, account.active ? 'user.deactivated' : 'user.activated', `${account.active ? 'Deactivated' : 'Activated'} account ${account.username}.`);
          await refresh();
        }, `Account ${account.active ? 'deactivated' : 'activated'}.`), isSelf);
        actions.append(controls); row.append(actions); body.append(row);
      }
    }
    async function refresh() { ({ users, members } = await loadUsers(admin)); renderForm(); renderUsers(); }
    async function run(work, success) {
      errorBox.hidden = true; $('[data-success]').hidden = true; $('[data-success]').hidden = true;
      try { await work(); showSuccess(success); } catch (error) { showError(errorBox, error); }
    }
    function openEdit(account) {
      editing = account; const edit = $('[data-edit-form]').elements;
      $('[data-edit-description]').textContent = `${account.username} (${account.email ?? 'no email saved'})`;
      edit.role.value = account.role; edit.role.disabled = account.id === admin.id;
      selectOptions(edit.memberId, memberChoices(account.id), 'No linked member'); edit.memberId.value = account.memberId ?? '';
      $('[data-edit-link]').hidden = edit.role.value !== 'member'; $('[data-edit-error]').hidden = true; dialog.showModal();
    }
    $('[data-edit-form]').elements.role.addEventListener('change', event => { $('[data-edit-link]').hidden = event.target.value !== 'member'; });
    $('[data-cancel-edit]').addEventListener('click', () => dialog.close());
    $('[data-edit-form]').addEventListener('submit', async event => {
      event.preventDefault(); const problem = $('[data-edit-error]'); problem.hidden = true; const edit = event.target.elements;
      try {
        const role = edit.role.value;
        if (role === 'member' && !edit.memberId.value) throw new Error('Choose the member this account belongs to.');
        const memberId = role === 'member' ? edit.memberId.value : null;
        await saveUserProfile({ id: editing.id, role, memberId }, admin, 'user.updated', `Set ${editing.username} to ${role}${memberId ? ', linked to member ' + memberId : ', no member link'}.`);
        await refresh(); dialog.close(); showSuccess('Account updated.');
      } catch (error) { showError(problem, error); }
    });
    form.elements.role.addEventListener('change', renderForm);
    $('[data-toggle-form]').addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) form.elements.email.focus(); });
    $('[data-cancel-form]').addEventListener('click', () => { panel.hidden = true; form.reset(); renderForm(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; $('[data-success]').hidden = true; const button = $('[data-save-user]'); button.disabled = true; button.textContent = 'Creating…';
      let uid = null; const values = Object.fromEntries(new FormData(form));
      try {
        const username = values.username.trim(); const email = values.email.trim();
        if (!username || username.length > 60) throw new Error('Enter a display name with 1 to 60 characters.');
        if (values.role === 'member' && !values.memberId) throw new Error('Choose the member this account belongs to.');
        if (users.some(account => account.email?.toLowerCase() === email.toLowerCase())) throw new Error('An account with this email already exists.');
        uid = await createAuthAccount(email, values.password);
        await saveUserProfile({ id: uid, username, email, role: values.role, active: true, memberId: values.role === 'member' ? values.memberId : undefined, mustChangePassword: true }, admin, 'user.created', `Created ${values.role} account ${username}.`, true);
        form.reset(); panel.hidden = true; await refresh(); showSuccess(`Account created for ${email}. Share the temporary password privately.`);
      } catch (error) {
        showError(errorBox, uid ? new Error(`The sign-in was created but the club profile could not be saved (${error.message}). Create a profile in the Firebase console for user ID ${uid}.`) : error);
      } finally { button.disabled = false; button.textContent = 'Create account'; }
    });
    await refresh(); finishLoading();
  }
} catch (error) { failLoading(error); }
