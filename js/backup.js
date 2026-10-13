import { exportBackup, importBackup, summariseBackup, loadAuditTrail, endRestoreMode, backupTables } from './db.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell } from './ui.js';
const errorBox = document.querySelector('[data-error]');
const $ = selector => document.querySelector(selector);
const labels = { users: 'Sign-in profiles', members: 'Members', rules: 'Club rules', rounds: 'Rounds', cycles: 'Cycles', roundRecipients: 'Recipient slots', memberCycles: 'Member cycle views', cycleLocks: 'Cycle locks', payments: 'Payments', paymentReversals: 'Reversals', payouts: 'Payouts', cycleApprovals: 'Closing approvals', reminders: 'Reminders', settings: 'Settings', auditLog: 'Audit entries' };
try {
  const user = await preparePage(['admin']);
  if (user) {
    let trail = [], parsed = null;
    function renderTrail() {
      const needle = $('#audit-search').value.trim().toLowerCase();
      const rows = trail.filter(row => !needle || `${row.userName} ${row.action} ${row.details}`.toLowerCase().includes(needle));
      $('[data-audit-count]').textContent = `${rows.length} of ${trail.length} entries`;
      $('[data-audit-empty]').hidden = rows.length > 0;
      const body = $('[data-audit]'); body.replaceChildren();
      for (const entry of rows.slice(0, 300)) {
        const details = tableCell(entry.details); details.className = 'reminder-message';
        const row = document.createElement('tr');
        row.append(tableCell(new Date(entry.time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })), tableCell(entry.userName), tableCell(entry.action), details);
        body.append(row);
      }
    }
    $('#audit-search').addEventListener('input', renderTrail);
    $('[data-export]').addEventListener('click', async event => {
      errorBox.hidden = true; $('[data-success]').hidden = true; const button = event.currentTarget; button.disabled = true; button.textContent = 'Preparing…';
      try {
        const backup = await exportBackup(user);
        const stamp = backup.exportedAt.slice(0, 10);
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `mukando-backup-${stamp}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        $('[data-export-note]').textContent = `Last download: ${new Date().toLocaleTimeString('en-GB')}`; showSuccess('Backup downloaded. Keep it somewhere safe.');
      } catch (error) { showError(errorBox, error); } finally { button.disabled = false; button.textContent = 'Download backup'; }
    });
    const importButton = $('[data-import]'), confirmBox = $('[data-import-confirm]');
    const syncImport = () => { importButton.disabled = !(parsed && confirmBox.checked); };
    confirmBox.addEventListener('change', syncImport);
    $('#import-file').addEventListener('change', async event => {
      parsed = null; const summary = $('[data-import-summary]'); summary.hidden = true; summary.replaceChildren(); errorBox.hidden = true; $('[data-success]').hidden = true;
      const file = event.target.files[0];
      try {
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) throw new Error('This file is too large to be a club backup.');
        parsed = JSON.parse(await file.text());
        const counts = summariseBackup(parsed);
        for (const name of Object.keys(backupTables)) {
          const group = document.createElement('div'); const term = document.createElement('dt'); const description = document.createElement('dd');
          term.textContent = labels[name]; description.textContent = counts[name]; group.append(term, description); summary.append(group);
        }
        summary.hidden = false;
      } catch (error) { parsed = null; showError(errorBox, error instanceof SyntaxError ? new Error('This file is not valid JSON.') : error); }
      syncImport();
    });
    $('[data-import-form]').addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; $('[data-success]').hidden = true; importButton.disabled = true; importButton.textContent = 'Importing…';
      try {
        await importBackup(parsed, user); parsed = null; confirmBox.checked = false; event.target.reset(); $('[data-import-summary]').hidden = true;
        trail = await loadAuditTrail(user); renderTrail(); showSuccess('Backup imported. Open Members, Rotation and Payments to check your records.');
      } catch (error) { showError(errorBox, error); } finally { importButton.textContent = 'Import backup'; syncImport(); }
    });
    await endRestoreMode(user);
    trail = await loadAuditTrail(user); renderTrail(); finishLoading();
  }
} catch (error) { failLoading(error); }
