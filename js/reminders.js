import { loadReminderData, saveReminder, saveReminderSettings } from './db.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell } from './ui.js';
import { today, formatDate } from './utils.js';
import { buildReminders, whatsappLink } from './remind.js';
const errorBox = document.querySelector('[data-error]');
const $ = selector => document.querySelector(selector);
const labels = { payment: 'Payment', payout: 'Payout', meeting: 'Meeting' };
try {
  const user = await preparePage(['admin', 'chairperson', 'treasurer', 'member']);
  if (user) {
    let data, reminders = [];
    const isStaff = user.role !== 'member';
    const canManage = ['admin', 'chairperson'].includes(user.role);
    $('[data-staff-tools]').hidden = !isStaff; $('[data-settings-panel]').hidden = !canManage;
    $('#meeting-date').min = today();
    async function refresh() {
      data = await loadReminderData(user);
      reminders = buildReminders({ user, cycles: data.cycles, members: data.members, payments: data.payments, stored: data.stored, settings: data.settings, asOf: today() });
      $('#days-before').value = data.settings.daysBefore;
      render();
    }
    function render() {
      const showAll = $('#reminder-filter').value === 'all';
      const rows = reminders.filter(reminder => showAll ? reminder.days >= 0 || reminder.active : reminder.active);
      const active = reminders.filter(reminder => reminder.active && !reminder.sent).length;
      $('[data-reminder-count]').textContent = `${active} ${active === 1 ? 'reminder' : 'reminders'} to act on`;
      $('[data-reminder-empty]').hidden = rows.length > 0;
      const body = $('[data-reminders]'); body.replaceChildren();
      for (const reminder of rows) {
        const row = document.createElement('tr');
        const message = tableCell(reminder.message); message.className = 'reminder-message';
        row.append(tableCell(`${formatDate(reminder.date)} · ${reminder.when}`), tableCell(labels[reminder.type]), message);
        const status = tableCell(''); const badge = document.createElement('span');
        badge.className = `member-status ${reminder.state === 'overdue' ? 'is-inactive' : 'is-active'}`; badge.textContent = reminder.sent ? 'shared' : reminder.state; status.append(badge); row.append(status);
        const actions = tableCell(''); const controls = document.createElement('div'); controls.className = 'row-actions';
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'text-button'; copy.textContent = 'Copy WhatsApp message';
        copy.addEventListener('click', async () => {
          errorBox.hidden = true; $('[data-success]').hidden = true;
          try {
            await navigator.clipboard.writeText(reminder.message); showSuccess('Message copied. Paste it into WhatsApp.');
          } catch { window.prompt('Copy this message:', reminder.message); }
          if (isStaff && !reminder.sent) {
            try { await saveReminder({ id: reminder.id, type: reminder.type, message: reminder.message, date: reminder.date, sent: true }, user); await refresh(); } catch (error) { showError(errorBox, error); }
          }
        });
        controls.append(copy);
        if (isStaff) { const open = document.createElement('a'); open.href = whatsappLink(reminder); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'Open WhatsApp'; controls.append(open); }
        actions.append(controls); row.append(actions); body.append(row);
      }
    }
    $('#reminder-filter').addEventListener('change', render);
    $('[data-settings-form]').addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; $('[data-success]').hidden = true; const button = $('[data-save-settings]'); button.disabled = true;
      try { await saveReminderSettings(event.target.elements.daysBefore.value, user); await refresh(); showSuccess('Reminder timing saved.'); }
      catch (error) { showError(errorBox, error); } finally { button.disabled = false; }
    });
    $('[data-meeting-form]').addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; $('[data-success]').hidden = true; const button = $('[data-save-meeting]'); button.disabled = true;
      try {
        const form = event.target.elements;
        await saveReminder({ type: 'meeting', message: form.message.value, date: form.date.value }, user);
        event.target.reset(); await refresh(); showSuccess('Meeting reminder added.');
      } catch (error) { showError(errorBox, error); } finally { button.disabled = false; }
    });
    await refresh(); finishLoading();
  }
} catch (error) { failLoading(error); }
