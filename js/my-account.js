import { loadPayoutData, loadReminderData, confirmPayout, clearPasswordWarning, db } from './db.js';
import { changeOwnPassword, ownEmail } from './accounts.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell } from './ui.js';
import { formatDate, formatMoney, today } from './utils.js';
import { cents, paymentBalance } from './finance.js';
import { buildReminders } from './remind.js';
const errorBox = document.querySelector('[data-error]');
const $ = selector => document.querySelector(selector);
const methods = { cash: 'Cash', ecocash: 'EcoCash', bank: 'Bank' };
try {
  const user = await preparePage(['admin', 'chairperson', 'treasurer', 'member']);
  if (user) {
    $('[data-profile-name]').textContent = user.username; $('[data-profile-email]').textContent = ownEmail() || user.email || '—'; $('[data-profile-role]').textContent = user.role;
    let own = null;
    async function loadMemberArea() {
      const [member, payoutData, reminderData] = await Promise.all([db.get('members', user.memberId), loadPayoutData(user), loadReminderData(user)]);
      const cycles = [...reminderData.cycles].sort((a, b) => a.number - b.number);
      const payments = reminderData.payments, payouts = payoutData.payouts;
      const asOf = today();
      $('[data-profile-member]').textContent = member?.fullName ?? '—';
      // Balance by cycle: only cycles that have started count towards what the member owes.
      const body = $('[data-my-cycles]'); body.replaceChildren(); let owed = 0, paid = 0;
      for (const cycle of cycles.filter(item => item.status !== 'scheduled')) {
        const balance = paymentBalance(cycle, user.memberId, payments, asOf);
        paid += Math.round(balance.paid * 100);
        if (cycle.status === 'open') owed = balance.outstanding;
        const row = document.createElement('tr');
        row.append(tableCell(`Cycle ${cycle.number}`), tableCell(formatDate(cycle.dueDate)), ...['expected', 'paid', 'penalty', 'outstanding'].map(field => tableCell(formatMoney(balance[field]))));
        const status = tableCell(''); const badge = document.createElement('span'); badge.className = `member-status ${balance.status === 'Paid' ? 'is-active' : 'is-inactive'}`; badge.textContent = balance.status; status.append(badge); row.append(status); body.append(row);
      }
      const open = cycles.find(cycle => cycle.status === 'open');
      $('[data-my-outstanding]').textContent = formatMoney(owed);
      $('[data-my-outstanding-note]').textContent = open ? `Cycle ${open.number}, due ${formatDate(open.dueDate)}` : 'No open cycle';
      $('[data-my-paid]').textContent = formatMoney(paid / 100);
      const turn = cycles.find(cycle => cycle.isRecipient && cycle.status !== 'closed');
      $('[data-my-payout]').textContent = turn ? formatDate(turn.dueDate) : '—';
      $('[data-my-payout-note]').textContent = turn ? `Cycle ${turn.number}` : 'No turn coming up';
      $('[data-my-received]').textContent = formatMoney(payouts.reduce((total, payout) => total + cents(payout.amount), 0) / 100);
      const waiting = payouts.find(payout => !payout.confirmed);
      $('[data-confirm-panel]').hidden = !waiting;
      if (waiting) $('[data-confirm-text]').textContent = `The treasurer recorded a payout of ${formatMoney(waiting.amount)} to you on ${formatDate(waiting.date)}. Confirm once you have received it.`;
      own = waiting ?? null;
      const entries = [...payments].sort((a, b) => b.date.localeCompare(a.date));
      const history = $('[data-my-payments]'); history.replaceChildren();
      for (const entry of entries) {
        const number = cycles.find(cycle => cycle.id === entry.cycleId)?.number;
        const row = document.createElement('tr'); row.append(tableCell(formatDate(entry.date)), tableCell(number ? `Cycle ${number}` : '—'), tableCell(formatMoney(entry.amount)), tableCell(methods[entry.method] ?? entry.method), tableCell(entry.reference || '—')); history.append(row);
      }
      $('[data-my-payment-empty]').hidden = entries.length > 0;
      const mine = buildReminders({ user, cycles, payments, stored: reminderData.stored, settings: reminderData.settings, asOf }).filter(reminder => reminder.active);
      const list = $('[data-my-reminders]'); list.replaceChildren();
      for (const reminder of mine) { const item = document.createElement('li'); item.textContent = `${formatDate(reminder.date)} (${reminder.when}): ${reminder.message}`; list.append(item); }
      $('[data-my-reminder-empty]').hidden = mine.length > 0;
    }
    if (user.role === 'member' && user.memberId) { $('[data-member-area]').hidden = false; await loadMemberArea(); }
    else if (user.role === 'member') showError(errorBox, new Error('Your account is not linked to a member yet. Ask the administrator to link it.'));
    else if (user.memberId) $('[data-profile-member]').textContent = (await db.get('members', user.memberId))?.fullName ?? '—';
    $('[data-confirm-received]').addEventListener('click', async event => {
      errorBox.hidden = true; $('[data-success]').hidden = true; const button = event.currentTarget; button.disabled = true;
      try { await confirmPayout(own.cycleId, user); await loadMemberArea(); showSuccess('Thank you. Your payout is confirmed.'); }
      catch (error) { showError(errorBox, error); } finally { button.disabled = false; }
    });
    $('[data-password-form]').addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; $('[data-success]').hidden = true; const form = event.target.elements; const button = $('[data-save-password]');
      try {
        if (form.next.value !== form.repeat.value) throw new Error('The new passwords do not match.');
        if (form.next.value === form.current.value) throw new Error('Choose a password different from the current one.');
        button.disabled = true; button.textContent = 'Saving…';
        await changeOwnPassword(form.current.value, form.next.value);
        try { await clearPasswordWarning(user); } catch { /* The notice is a convenience; the password is already changed. */ }
        event.target.reset(); showSuccess('Password changed.');
      } catch (error) { showError(errorBox, error); } finally { button.disabled = false; button.textContent = 'Change password'; }
    });
    finishLoading();
  }
} catch (error) { failLoading(error); }
