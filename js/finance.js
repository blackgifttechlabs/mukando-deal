import { isValidDate, today, validateRules } from './utils.js';
export const cents = amount => Math.round(Number(amount) * 100);
// Anchor monthly dates to the original day: Jan 31 → Feb 28 → Mar 31.
export function cycleDate(startDate, frequency, offset) {
  if (!isValidDate(startDate) || !['weekly', 'monthly'].includes(frequency) || !Number.isInteger(offset) || offset < 0) throw new Error('The contribution schedule is invalid.');
  const date = new Date(startDate + 'T00:00:00Z');
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + offset * 7);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + offset);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}
export function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    // Rejection sampling avoids favouring particular positions.
    const limit = Math.floor(0x100000000 / (index + 1)) * (index + 1);
    let value; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
    const other = value % (index + 1); [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
export function exactOrder(order, ids) {
  if (order.length !== ids.length || new Set(order).size !== ids.length || ids.some(id => !order.includes(id))) throw new Error('Each member must appear exactly once in this round.');
}
export function buildRound(members, rules, existing, order, mode, auditId) {
  const policy = validateRules(rules);
  if (!['manual', 'random'].includes(mode)) throw new Error('Choose a rotation method.');
  const active = members.filter(member => member.status === 'active');
  if (!active.length) throw new Error('Add an active member before creating a rotation.');
  if (existing.some(cycle => cycle.status !== 'closed')) throw new Error('Finish the current round before creating another one.');
  exactOrder(order, active.map(member => member.id));
  const round = Math.max(0, ...existing.map(cycle => Number(cycle.round ?? 1))) + 1;
  const firstNumber = Math.max(0, ...existing.map(cycle => Number(cycle.number))) + 1;
  // Continue from the original schedule so monthly end-of-month dates remain stable.
  const firstDate = cycleDate(policy.startDate, policy.frequency, firstNumber - 1);
  if (active.some(member => member.joinDate > firstDate)) throw new Error('A member joined after the first due date. Update the start date before creating the first rotation.');
  const memberIds = Object.fromEntries(active.map(member => [member.id, true]));
  const participantIds = '|' + active.map(member => member.id).sort().join('|') + '|';
  return order.map((recipientMemberId, index) => ({
    id: `r${round}-c${firstNumber + index}`, number: firstNumber + index, round, roundKey: `r${round}`,
    dueDate: cycleDate(policy.startDate, policy.frequency, firstNumber + index - 1),
    recipientMemberId, status: index === 0 ? 'open' : 'scheduled', memberIds, participantIds,
    amount: policy.amount, amountCents: cents(policy.amount), memberCount: active.length,
    expectedPoolCents: cents(policy.amount) * active.length,
    penaltyAmount: policy.penaltyAmount, graceDays: policy.graceDays, auditId
  }));
}
export function cycleMembers(cycle, members) {
  if (cycle.participantIds) return members.filter(member => cycle.participantIds.includes('|' + member.id + '|'));
  if (!cycle.memberIds) return members; // Own-member projections contain no other member IDs.
  const ids = Array.isArray(cycle.memberIds) ? cycle.memberIds : Object.keys(cycle.memberIds);
  return members.filter(member => ids.includes(member.id));
}
// Last day a contribution counts as on time: due date plus grace days.
export function deadlineOf(cycle) {
  const deadline = new Date(cycle.dueDate + 'T00:00:00Z');
  deadline.setUTCDate(deadline.getUTCDate() + Number(cycle.graceDays ?? 0));
  return deadline.toISOString().slice(0, 10);
}
export function paymentBalance(cycle, memberId, payments, asOf = today()) {
  const expected = cents(cycle.amount);
  const entries = payments.filter(payment => payment.cycleId === cycle.id && payment.memberId === memberId);
  const paid = entries.reduce((total, payment) => total + cents(payment.amount), 0);
  const deadlineDate = deadlineOf(cycle);
  const effectiveDate = payment => payment.reversesPaymentId ? entries.find(original => original.id === payment.reversesPaymentId)?.date ?? payment.date : payment.date;
  const onTime = entries.filter(payment => effectiveDate(payment) <= deadlineDate).reduce((total, payment) => total + cents(payment.amount), 0);
  const penalty = asOf > deadlineDate && onTime < expected ? cents(cycle.penaltyAmount ?? 0) : 0;
  const outstanding = Math.max(0, expected + penalty - paid);
  return { expected: expected / 100, paid: paid / 100, penalty: penalty / 100, outstanding: outstanding / 100,
    status: outstanding === 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid' };
}
export function validatePayment(values, cycle, member) {
  if (!cycle || cycle.status !== 'open') throw new Error('Choose an open cycle.');
  if (!member || !cycleMembers(cycle, [member]).length) throw new Error('Choose a member included in this cycle.');
  if (!/^\d+(\.\d{1,2})?$/.test(String(values.amount)) || Number(values.amount) <= 0 || Number(values.amount) > 1000000) throw new Error('Enter an amount above zero, with at most two decimal places.');
  if (!['cash', 'ecocash', 'bank'].includes(values.method)) throw new Error('Choose cash, EcoCash or bank.');
  if (!isValidDate(values.date) || values.date > today() || values.date < member.joinDate) throw new Error('Payment date must be between the member’s join date and today.');
  const reference = values.reference.trim();
  if (reference.length > 250) throw new Error('Keep the reference under 250 characters.');
  return { cycleId: cycle.id, memberId: member.id, amount: Number(values.amount), amountCents: cents(values.amount), method: values.method, reference, date: values.date };
}
