import { loadPaymentData, recordPayment, reversePayment } from './db.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell, selectOptions } from './ui.js';
import { today, formatDate, formatMoney, isValidDate } from './utils.js';
import { cents, cycleMembers, paymentBalance } from './finance.js';
const errorBox = document.querySelector('[data-error]');
const methods = { cash: 'Cash', ecocash: 'EcoCash', bank: 'Bank' };
const labelCycle = cycle => `Cycle ${cycle.number} · ${formatDate(cycle.dueDate)}`;
function clearMessages() { errorBox.hidden = true; document.querySelector('[data-success]').hidden = true; }
function sortedCycles(cycles) { return [...cycles].sort((a, b) => a.number - b.number); }
async function paymentForm(user, data) {
  const form = document.querySelector('[data-payment-form]'); const button = document.querySelector('[data-save-payment]');
  const open = sortedCycles(data.cycles).filter(cycle => cycle.status === 'open');
  if (!open.length) {
    form.closest('.overview-grid').hidden = true;
    document.querySelector('[data-no-open-cycle]').hidden = false;
    return;
  }
  selectOptions(form.elements.cycleId, open.map(cycle => [cycle.id, labelCycle(cycle)]));
  form.elements.date.value = today(); form.elements.date.max = today();
  // A stable ID makes retries safe when a response is lost after the write commits.
  const submissionId = crypto.randomUUID();
  function renderBalance() {
    const cycle = open.find(item => item.id === form.elements.cycleId.value);
    const member = data.members.find(item => item.id === form.elements.memberId.value);
    const balance = member ? paymentBalance(cycle, member.id, data.payments) : null;
    for (const field of ['expected', 'paid', 'penalty', 'outstanding']) document.querySelector(`[data-balance-${field}]`).textContent = balance ? formatMoney(balance[field]) : '—';
    document.querySelector('[data-balance-status]').textContent = balance?.status ?? '—';
    form.elements.date.min = member?.joinDate ?? '';
  }
  function chooseCycle() {
    const cycle = open.find(item => item.id === form.elements.cycleId.value);
    selectOptions(form.elements.memberId, cycleMembers(cycle, data.members).map(member => [member.id, member.fullName]), 'Choose a member');
    renderBalance();
  }
  form.elements.cycleId.addEventListener('change', chooseCycle); form.elements.memberId.addEventListener('change', renderBalance); chooseCycle();
  form.addEventListener('submit', async event => {
    event.preventDefault(); clearMessages(); button.disabled = true; button.textContent = 'Recording…';
    try {
      const values = { ...Object.fromEntries(new FormData(form)), id: submissionId };
      const payment = await recordPayment(values, user);
      location.assign('payments.html?saved=' + encodeURIComponent(payment.id));
    } catch (error) { showError(errorBox, error); }
    finally { button.disabled = false; button.textContent = 'Record payment'; }
  });
}
async function paymentHistory(user, data) {
  const cycleFilter = document.querySelector('#cycle-filter'); const memberFilter = document.querySelector('#member-filter');
  const balanceCycle = document.querySelector('#balance-cycle'); const from = document.querySelector('#date-from'); const to = document.querySelector('#date-to');
  const receipt = document.querySelector('[data-receipt]'); const reverseDialog = document.querySelector('[data-reverse-dialog]');
  let reversingId = null;
  const memberName = id => data.members.find(member => member.id === id)?.fullName ?? 'Member unavailable';
  const cycleName = id => { const cycle = data.cycles.find(cycle => cycle.id === id); return cycle ? `Cycle ${cycle.number}` : 'Cycle unavailable'; };
  function printReceipt(payment) {
    document.querySelector('#receipt-heading').textContent = payment.amount < 0 ? 'Payment reversal' : 'Payment receipt';
    const details = document.querySelector('[data-receipt-details]'); details.replaceChildren();
    for (const [name, value] of [['Receipt ID', payment.id], ['Member', memberName(payment.memberId)], ['Cycle', cycleName(payment.cycleId)], ['Date', formatDate(payment.date)], ['Amount', formatMoney(payment.amount)], ['Method', methods[payment.method]], ['Reference', payment.reference || '—'], ...(payment.reversesPaymentId ? [['Original receipt', payment.reversesPaymentId]] : [])]) {
      const group = document.createElement('div'); const term = document.createElement('dt'); const description = document.createElement('dd'); term.textContent = name; description.textContent = value; group.append(term, description); details.append(group);
    }
    document.body.classList.add('receipt-open'); receipt.showModal();
  }
  receipt.addEventListener('close', () => document.body.classList.remove('receipt-open'));
  document.querySelector('[data-print-receipt]').addEventListener('click', () => window.print());
  document.querySelector('[data-cancel-reverse]').addEventListener('click', () => reverseDialog.close());
  document.querySelector('[data-reverse-form]').addEventListener('submit', async event => {
    event.preventDefault(); const button = document.querySelector('[data-confirm-reverse]'); const problem = document.querySelector('[data-reverse-error]');
    problem.hidden = true; button.disabled = true; button.textContent = 'Reversing…';
    try {
      await reversePayment(reversingId, event.target.elements.reason.value, user);
      data = await loadPaymentData(user); reverseDialog.close(); renderHistory(); renderBalances(); showSuccess('Reversing entry added. The original payment is kept.');
    } catch (error) { showError(problem, error); }
    finally { button.disabled = false; button.textContent = 'Reverse payment'; }
  });
  if (user.role === 'member') {
    document.querySelector('[data-member-filter]').hidden = true;
    document.querySelector('[data-payments-description]').textContent = 'Your own contribution history and balances.';
  }
  document.querySelector('[data-record-link]').hidden = user.role !== 'treasurer';
  selectOptions(cycleFilter, sortedCycles(data.cycles).map(cycle => [cycle.id, labelCycle(cycle)]), 'All cycles');
  selectOptions(memberFilter, data.members.map(member => [member.id, member.fullName]), 'All members');
  selectOptions(balanceCycle, sortedCycles(data.cycles).map(cycle => [cycle.id, labelCycle(cycle)]));
  balanceCycle.value = data.cycles.find(cycle => cycle.status === 'open')?.id ?? data.cycles[0]?.id ?? '';
  function renderHistory() {
    const invalidRange = from.value && to.value && from.value > to.value;
    if (invalidRange) showError(errorBox, new Error('From date must be on or before To date.'));
    else errorBox.hidden = true;
    const records = invalidRange ? [] : data.payments.filter(payment =>
      (!cycleFilter.value || payment.cycleId === cycleFilter.value) && (!memberFilter.value || payment.memberId === memberFilter.value) &&
      (!from.value || payment.date >= from.value) && (!to.value || payment.date <= to.value)
    ).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const reversed = new Set(data.payments.filter(payment => payment.reversesPaymentId).map(payment => payment.reversesPaymentId));
    document.querySelector('[data-payment-total]').textContent = `Net total: ${formatMoney(records.reduce((sum, payment) => sum + cents(payment.amount), 0) / 100)}`;
    document.querySelector('[data-payment-count]').textContent = `${records.length} ${records.length === 1 ? 'entry' : 'entries'} · includes reversing entries`;
    document.querySelector('[data-payment-empty]').hidden = records.length > 0;
    const body = document.querySelector('[data-payments]'); body.replaceChildren();
    for (const payment of records) {
      const row = document.createElement('tr'); if (payment.amount < 0) row.className = 'reversal-row';
      row.append(tableCell(formatDate(payment.date)), tableCell(memberName(payment.memberId)), tableCell(cycleName(payment.cycleId)), tableCell(formatMoney(payment.amount)), tableCell(methods[payment.method] ?? payment.method), tableCell(payment.reference || '—'));
      const actions = tableCell(''); const controls = document.createElement('div'); controls.className = 'row-actions';
      const print = document.createElement('button'); print.type = 'button'; print.className = 'text-button'; print.textContent = 'Receipt'; print.setAttribute('aria-label', `Receipt for ${memberName(payment.memberId)}, ${formatMoney(payment.amount)}`); print.addEventListener('click', () => printReceipt(payment)); controls.append(print);
      if (reversed.has(payment.id)) { const badge = document.createElement('span'); badge.className = 'subtle-badge'; badge.textContent = 'Reversed'; controls.append(badge); }
      else if (user.role === 'treasurer' && payment.amount > 0 && data.cycles.find(cycle => cycle.id === payment.cycleId)?.status === 'open') {
        const reverse = document.createElement('button'); reverse.type = 'button'; reverse.className = 'text-button'; reverse.textContent = 'Reverse';
        reverse.addEventListener('click', () => {
          reversingId = payment.id; document.querySelector('[data-reverse-form]').reset(); document.querySelector('[data-reverse-error]').hidden = true;
          document.querySelector('[data-reverse-description]').textContent = `Reverse ${formatMoney(payment.amount)} for ${memberName(payment.memberId)}? A negative entry will correct the total. The original stays in history.`; reverseDialog.showModal();
        }); controls.append(reverse);
      }
      actions.append(controls); row.append(actions); body.append(row);
    }
  }
  function renderBalances() {
    const cycle = data.cycles.find(cycle => cycle.id === balanceCycle.value); const body = document.querySelector('[data-balances]'); body.replaceChildren();
    document.querySelector('[data-balance-empty]').hidden = !!cycle;
    if (!cycle) return;
    for (const member of cycleMembers(cycle, data.members)) {
      const balance = paymentBalance(cycle, member.id, data.payments); const row = document.createElement('tr');
      row.append(tableCell(member.fullName), ...['expected', 'paid', 'penalty', 'outstanding'].map(field => tableCell(formatMoney(balance[field]))));
      const status = tableCell(''); const badge = document.createElement('span'); badge.className = `member-status ${balance.status === 'Paid' ? 'is-active' : 'is-inactive'}`; badge.textContent = balance.status; status.append(badge); row.append(status); body.append(row);
    }
  }
  for (const element of [cycleFilter, memberFilter, from, to]) element.addEventListener('change', renderHistory);
  balanceCycle.addEventListener('change', renderBalances); renderHistory(); renderBalances();
  const savedId = new URLSearchParams(location.search).get('saved');
  if (savedId) {
    const saved = data.payments.find(payment => payment.id === savedId);
    if (saved) { showSuccess('Payment recorded successfully.'); printReceipt(saved); }
    history.replaceState(null, '', 'payments.html');
  }
}
try {
  const isForm = document.body.dataset.page === 'record-payment';
  const user = await preparePage(isForm ? ['treasurer'] : ['admin', 'chairperson', 'treasurer', 'member']);
  if (user) {
    const data = await loadPaymentData(user);
    if (isForm) await paymentForm(user, data); else await paymentHistory(user, data);
    finishLoading();
  }
} catch (error) { failLoading(error); }
