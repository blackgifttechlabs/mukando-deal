// Shared formatting and validation. Store dates as YYYY-MM-DD, without timezones.
export function formatMoney(amount) {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(amount);
}
export function formatDate(date) {
  if (!isValidDate(date)) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(date + 'T00:00:00'));
}
export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Harare' }).format(new Date());
}
export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateMember(values) {
  const fullName = values.fullName.trim();
  const phone = values.phone.trim().replace(/[\s()-]/g, '');
  const notes = values.notes.trim();
  if (!fullName || fullName.length > 120) throw new Error('Enter a name with 1 to 120 characters.');
  if (!/^\+?\d{7,15}$/.test(phone)) throw new Error('Enter a phone number with 7 to 15 digits. You may start with +.');
  if (!isValidDate(values.joinDate)) throw new Error('Choose a valid join date.');
  if (values.joinDate > today()) throw new Error('Join date cannot be in the future.');
  if (notes.length > 2000) throw new Error('Keep notes under 2,000 characters.');
  return { fullName, phone, joinDate: values.joinDate, notes };
}
function moneyValue(value, label, allowZero = false) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error(`${label} must have no more than two decimal places.`);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > 1000000 || (allowZero ? amount < 0 : amount <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'zero or more' : 'more than zero'} and at most 1,000,000.`);
  }
  return amount;
}
export function validateRules(values) {
  const clubName = values.clubName.trim();
  if (!clubName || clubName.length > 120) throw new Error('Enter a club name with 1 to 120 characters.');
  if (!['weekly', 'monthly'].includes(values.frequency)) throw new Error('Choose weekly or monthly contributions.');
  if (!isValidDate(values.startDate)) throw new Error('Choose a valid start date.');
  if (!/^\d+$/.test(String(values.graceDays)) || Number(values.graceDays) > 365) throw new Error('Grace days must be a whole number from 0 to 365.');
  return {
    clubName, amount: moneyValue(values.amount, 'Contribution amount'), frequency: values.frequency,
    startDate: values.startDate, penaltyAmount: moneyValue(values.penaltyAmount, 'Late penalty', true),
    graceDays: Number(values.graceDays)
  };
}
// Use cents to avoid rounding errors when checking whether a member owes money.
// Future cycles do not count as debt. Later payment features will reuse this check.
export function memberOutstanding(member, cycles, payments, rules, asOf = today()) {
  let outstanding = 0;
  for (const cycle of cycles) {
    if (!isValidDate(cycle.dueDate) || cycle.dueDate > asOf || cycle.dueDate < member.joinDate) continue;
    if (cycle.participantIds && !cycle.participantIds.includes('|' + member.id + '|')) continue;
    if (Array.isArray(cycle.memberIds) && !cycle.memberIds.includes(member.id)) continue;
    if (cycle.memberIds && !Array.isArray(cycle.memberIds) && !cycle.memberIds[member.id]) continue;
    const amount = cycle.amount ?? rules?.amount;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Set the club contribution amount before checking this member’s balance.');
    const due = Math.round(Number(amount) * 100);
    const entries = payments.filter(payment => payment.memberId === member.id && payment.cycleId === cycle.id);
    const paid = entries.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
    if (!Number.isFinite(paid)) throw new Error('A payment amount is invalid. Review the member’s payments first.');
    const deadline = new Date(cycle.dueDate + 'T00:00:00Z');
    deadline.setUTCDate(deadline.getUTCDate() + Number(cycle.graceDays ?? rules?.graceDays ?? 0));
    const deadlineDate = deadline.toISOString().slice(0, 10);
    const effectiveDate = payment => payment.reversesPaymentId ? entries.find(original => original.id === payment.reversesPaymentId)?.date ?? payment.date : payment.date;
    const paidOnTime = entries.filter(payment => effectiveDate(payment) <= deadlineDate)
      .reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
    const late = asOf > deadlineDate && paidOnTime < due;
    const penalty = late ? Math.round(Number(cycle.penaltyAmount ?? rules?.penaltyAmount ?? 0) * 100) : 0;
    outstanding += Math.max(0, due + penalty - paid);
  }
  return outstanding / 100;
}
