import { loadPayoutData, recordPayout, confirmPayout, approveClosing, closeCycle } from './db.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell } from './ui.js';
import { formatDate, formatMoney } from './utils.js';
import { cents, cycleMembers, paymentBalance } from './finance.js';
const errorBox = document.querySelector('[data-error]');
const $ = selector => document.querySelector(selector);
// The four steps of one cycle, in order. The current step is highlighted for the user.
const steps = ['collect', 'payout', 'confirm', 'close'];
try {
  const user = await preparePage(['admin', 'chairperson', 'treasurer']);
  if (user) {
    let data;
    const isTreasurer = user.role === 'treasurer';
    const canApprove = ['admin', 'chairperson'].includes(user.role);
    const nameOf = id => data.members.find(member => member.id === id)?.fullName ?? 'Member unavailable';
    const buttons = { record: $('[data-record-payout]'), confirm: $('[data-confirm-payout]'), close: $('[data-close-cycle]'), approve: $('[data-approve-closing]') };
    function renderCurrent() {
      const cycle = data.cycles.find(item => item.status === 'open');
      $('[data-current-panel]').hidden = !cycle; $('[data-no-cycle]').hidden = !!cycle;
      if (!cycle) {
        const none = !data.cycles.length;
        $('[data-no-cycle-title]').textContent = none ? 'No rotation yet' : 'Round complete';
        $('[data-no-cycle-text]').textContent = none ? 'A chairperson must create a rotation before payouts can start.' : 'Every cycle in this round is closed. A chairperson can create the next round.';
        $('[data-rotation-link]').hidden = !canApprove;
        return;
      }
      const payments = data.payments.filter(payment => payment.cycleId === cycle.id);
      const collected = payments.reduce((total, payment) => total + cents(payment.amount), 0);
      const payout = data.payouts.find(item => item.cycleId === cycle.id);
      const approval = data.approvals.find(item => item.cycleId === cycle.id);
      const unpaid = cycleMembers(cycle, data.members).map(member => ({ member, ...paymentBalance(cycle, member.id, payments) })).filter(row => row.outstanding > 0);
      $('[data-cycle-label]').textContent = `Cycle ${cycle.number} · due ${formatDate(cycle.dueDate)}`;
      $('[data-recipient]').textContent = nameOf(cycle.recipientMemberId);
      $('[data-collected]').textContent = formatMoney(collected / 100);
      $('[data-pool]').textContent = formatMoney(cycle.expectedPoolCents / 100);
      $('[data-unpaid-count]').textContent = unpaid.length;
      $('[data-payout-state]').textContent = !payout ? 'Not recorded' : payout.confirmed ? `${formatMoney(payout.amount)} · received` : `${formatMoney(payout.amount)} · waiting for confirmation`;
      const current = !payout ? (collected > 0 ? 'payout' : 'collect') : payout.confirmed ? 'close' : 'confirm';
      $('[data-step-label]').textContent = `Step ${steps.indexOf(current) + 1} of 4`;
      for (const item of document.querySelectorAll('[data-steps] li')) {
        const position = steps.indexOf(item.dataset.step);
        item.className = position < steps.indexOf(current) ? 'done' : position === steps.indexOf(current) ? 'current' : '';
        if (item.className === 'current') item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      }
      $('[data-unpaid]').hidden = unpaid.length === 0;
      const list = $('[data-unpaid-list]'); list.replaceChildren();
      for (const row of unpaid) { const item = document.createElement('li'); item.textContent = `${row.member.fullName}: owes ${formatMoney(row.outstanding)}`; list.append(item); }
      $('[data-approval-note]').textContent = approval ? `The chairperson approved closing: ${approval.reason}` : 'The cycle cannot close until these members pay, or the chairperson approves closing.';
      buttons.record.hidden = !(isTreasurer && !payout && collected > 0);
      buttons.confirm.hidden = !(isTreasurer && payout && !payout.confirmed);
      buttons.close.hidden = !(isTreasurer && payout?.confirmed);
      buttons.approve.hidden = !(canApprove && unpaid.length && !approval);
      buttons.close.disabled = unpaid.length > 0 && !approval;
      const hints = {
        collect: 'Waiting for contributions. The treasurer records them on the Record payment page.',
        payout: isTreasurer ? 'Record the payout when you have handed over the money. Payments for this cycle then stop.' : 'The treasurer records the payout.',
        confirm: isTreasurer ? 'Tick this when the recipient says they have the money. They can also confirm it in My account.' : 'Waiting for the recipient to confirm.',
        close: isTreasurer ? (unpaid.length && !approval ? 'Some members have not paid. Ask the chairperson to approve closing.' : 'Closing opens the next cycle.') : 'The treasurer closes the cycle.'
      };
      $('[data-action-hint]').textContent = hints[current];
    }
    function renderHistory() {
      const body = $('[data-payouts]'); body.replaceChildren();
      const rows = [...data.payouts].sort((a, b) => (data.cycles.find(c => c.id === b.cycleId)?.number ?? 0) - (data.cycles.find(c => c.id === a.cycleId)?.number ?? 0));
      for (const payout of rows) {
        const cycle = data.cycles.find(item => item.id === payout.cycleId);
        const row = document.createElement('tr');
        row.append(tableCell(cycle ? `Cycle ${cycle.number}` : payout.cycleId), tableCell(nameOf(payout.memberId)), tableCell(formatMoney(payout.amount)), tableCell(formatDate(payout.date)));
        for (const text of [payout.confirmed ? 'Yes' : 'Waiting', cycle?.status ?? '—']) {
          const cell = tableCell(''); const badge = document.createElement('span');
          badge.className = `member-status ${text === 'Yes' || text === 'closed' ? 'is-active' : 'is-inactive'}`; badge.textContent = text; cell.append(badge); row.append(cell);
        }
        body.append(row);
      }
      $('[data-history-empty]').hidden = rows.length > 0;
      $('[data-history-total]').textContent = `Paid out: ${formatMoney(rows.reduce((total, payout) => total + cents(payout.amount), 0) / 100)}`;
      const round = Math.max(0, ...data.cycles.map(cycle => cycle.round ?? 1));
      $('[data-round-label]').textContent = round ? `Round ${round}` : 'No round yet';
    }
    async function refresh() { data = await loadPayoutData(user); renderCurrent(); renderHistory(); }
    // Run one action, show its result, and put the buttons back afterwards.
    async function act(button, busyText, work, success) {
      errorBox.hidden = true; $('[data-success]').hidden = true;
      const label = button.textContent; button.disabled = true; button.textContent = busyText;
      try { const outcome = await work(); await refresh(); showSuccess(typeof success === 'function' ? success(outcome) : success); }
      catch (error) { showError(errorBox, error); }
      finally { button.textContent = label; button.disabled = false; renderCurrent(); }
    }
    const openCycle = () => data.cycles.find(item => item.status === 'open');
    buttons.record.addEventListener('click', () => act(buttons.record, 'Recording…', () => recordPayout(openCycle().id, user), 'Payout recorded. Contributions for this cycle are now closed.'));
    buttons.confirm.addEventListener('click', () => act(buttons.confirm, 'Saving…', () => confirmPayout(openCycle().id, user), 'Payout marked as received.'));
    buttons.close.addEventListener('click', () => act(buttons.close, 'Closing…', () => closeCycle(openCycle().id, user),
      outcome => outcome.next ? `Cycle closed. Cycle ${outcome.next.number} is now open.` : 'Cycle closed. This was the last cycle in the round.'));
    const dialog = $('[data-approve-dialog]');
    buttons.approve.addEventListener('click', () => {
      $('[data-approve-form]').reset(); $('[data-approve-error]').hidden = true;
      $('[data-approve-description]').textContent = `Allow cycle ${openCycle().number} to close even though some members have not paid in full? This is recorded in the audit trail.`;
      dialog.showModal();
    });
    $('[data-cancel-approve]').addEventListener('click', () => dialog.close());
    $('[data-approve-form]').addEventListener('submit', async event => {
      event.preventDefault(); const button = $('[data-confirm-approve]'); const problem = $('[data-approve-error]');
      problem.hidden = true; button.disabled = true;
      try { await approveClosing(openCycle().id, event.target.elements.reason.value, user); await refresh(); dialog.close(); showSuccess('Approval saved. The treasurer can now close the cycle.'); }
      catch (error) { showError(problem, error); }
      finally { button.disabled = false; }
    });
    await refresh(); finishLoading();
  }
} catch (error) { failLoading(error); }
