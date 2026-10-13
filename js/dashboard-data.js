// Numbers behind the dashboard charts. Pure functions: no storage, no DOM, so they are easy to test.
import { cents, cycleMembers, paymentBalance } from './finance.js';
import { defaulters } from './report-data.js';
const dollars = value => value / 100;
const net = rows => rows.reduce((total, row) => total + cents(row.amount), 0);
// One entry per started cycle: money collected against what was expected. Members see only their own share.
export function cycleSeries({ cycles, payments, memberId = null }) {
  return [...cycles].filter(cycle => cycle.status !== 'scheduled').sort((a, b) => a.number - b.number).map(cycle => {
    const mine = payments.filter(payment => payment.cycleId === cycle.id && (!memberId || payment.memberId === memberId));
    const expected = memberId ? cents(cycle.amount) : cycle.expectedPoolCents;
    const collected = Math.min(net(mine), expected);          // anything above the expected amount is not shown as "collected"
    return { cycle, label: `C${cycle.number}`, collected: dollars(collected), toCollect: dollars(Math.max(0, expected - collected)), expected: dollars(expected), extra: dollars(Math.max(0, net(mine) - expected)) };
  });
}
// How many members are Paid / Partial / Unpaid on the open cycle.
export function statusBreakdown({ cycle, members, payments, asOf, memberId = null }) {
  const counts = { Paid: 0, Partial: 0, Unpaid: 0 };
  if (!cycle) return counts;
  const people = memberId ? [{ id: memberId }] : cycleMembers(cycle, members);
  for (const person of people) counts[paymentBalance(cycle, person.id, payments, asOf).status]++;
  return counts;
}
// Money by payment method (reversals count against their own method).
export function methodMix(payments, memberId = null) {
  const totals = { cash: 0, ecocash: 0, bank: 0 };
  for (const payment of payments) if (!memberId || payment.memberId === memberId) totals[payment.method] = (totals[payment.method] ?? 0) + cents(payment.amount);
  return Object.entries(totals).map(([method, value]) => ({ method, value: Math.max(0, dollars(value)) }));
}
// Cash in hand: everything collected, minus everything paid out.
export function cashInHand(payments, payouts) {
  const collected = net(payments), paidOut = payouts.reduce((total, payout) => total + cents(payout.amount), 0);
  return { collected: dollars(collected), paidOut: dollars(paidOut), inHand: dollars(collected - paidOut) };
}
export const attentionList = (data, asOf, limit = 5) => defaulters(data, asOf).slice(0, limit);
// The round as a row of steps: closed, the open one, and those still to come.
export function roundSteps({ cycles, members = [], user }) {
  return [...cycles].sort((a, b) => a.number - b.number).map(cycle => ({
    cycle, state: cycle.status, mine: user.role === 'member' ? Boolean(cycle.isRecipient) : false,
    recipient: members.find(member => member.id === cycle.recipientMemberId)?.fullName ?? null }));
}
