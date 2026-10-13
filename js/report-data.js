// Builds the numbers for every report. Pure functions so totals can be checked against the payments.
import { cents, cycleMembers, deadlineOf, paymentBalance } from './finance.js';
import { today } from './utils.js';
const money = value => Math.round(value * 100);
const sum = (rows, field) => rows.reduce((total, row) => total + money(row[field]), 0) / 100;
// One member's history: every cycle they take part in, then the payments and payouts behind it.
export function memberStatement(member, { cycles, payments, payouts }, asOf = today()) {
  const mine = [...cycles].filter(cycle => cycle.status !== 'scheduled' && cycleMembers(cycle, [member]).length).sort((a, b) => a.number - b.number);
  // A cycle whose due date is still ahead is shown, but what is unpaid on it is "not yet due", not owed.
  const rows = mine.map(cycle => ({ cycle, due: cycle.dueDate <= asOf, ...paymentBalance(cycle, member.id, payments, asOf) }));
  const owedRows = rows.filter(row => row.due);
  const received = payouts.filter(payout => payout.memberId === member.id);
  const entries = payments.filter(payment => payment.memberId === member.id).sort((a, b) => a.date.localeCompare(b.date));
  return { rows, entries, received, totals: {
    expected: sum(rows, 'expected'), paid: sum(rows, 'paid'), penalty: sum(rows, 'penalty'), outstanding: sum(owedRows, 'outstanding'),
    notYetDue: sum(rows.filter(row => !row.due), 'outstanding'), received: sum(received, 'amount') } };
}
export function cycleSummary(cycle, { members, payments, payouts }, asOf = today()) {
  const rows = cycleMembers(cycle, members).map(member => ({ member, ...paymentBalance(cycle, member.id, payments, asOf) }));
  const entries = payments.filter(payment => payment.cycleId === cycle.id);
  return { rows, payout: payouts.find(payout => payout.cycleId === cycle.id) ?? null, totals: {
    expected: sum(rows, 'expected'), paid: sum(rows, 'paid'), penalty: sum(rows, 'penalty'), outstanding: sum(rows, 'outstanding'),
    collected: sum(entries, 'amount'), pool: (cycle.expectedPoolCents ?? 0) / 100 } };
}
export function clubSummary({ members, cycles, payments, payouts }, asOf = today()) {
  const lines = [...cycles].sort((a, b) => a.number - b.number).map(cycle => {
    const detail = cycleSummary(cycle, { members, payments, payouts }, asOf);
    const due = cycle.status !== 'scheduled' && deadlineOf(cycle) < asOf;
    return { cycle, recipient: members.find(member => member.id === cycle.recipientMemberId), collected: detail.totals.collected,
      outstanding: due ? detail.totals.outstanding : 0, payout: detail.payout };
  });
  return { lines, totals: {
    active: members.filter(member => member.status === 'active').length, inactive: members.filter(member => member.status !== 'active').length,
    collected: sum(payments, 'amount'), paidOut: sum(payouts, 'amount'), outstanding: sum(lines, 'outstanding'),
    closed: cycles.filter(cycle => cycle.status === 'closed').length, open: cycles.filter(cycle => cycle.status === 'open').length,
    scheduled: cycles.filter(cycle => cycle.status === 'scheduled').length } };
}
// Defaulters owe money on a cycle whose deadline (due date + grace days) has passed.
export function defaulters({ members, cycles, payments }, asOf = today()) {
  const result = [];
  for (const member of members) {
    let owed = 0, count = 0;
    for (const cycle of cycles) {
      if (cycle.status === 'scheduled' || deadlineOf(cycle) >= asOf || !cycleMembers(cycle, [member]).length) continue;
      const balance = paymentBalance(cycle, member.id, payments, asOf);
      if (balance.outstanding > 0) { owed += money(balance.outstanding); count++; }
    }
    if (owed > 0) result.push({ member, cycles: count, outstanding: owed / 100 });
  }
  return result.sort((a, b) => b.outstanding - a.outstanding);
}
// CSV that opens cleanly in Excel. Cells that start with = + - @ are neutralised so they cannot run as formulas.
export function toCsv(rows) {
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export { cents };
