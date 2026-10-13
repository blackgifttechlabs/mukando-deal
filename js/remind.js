// Works out which reminders to show. Pure functions: no storage, so they are easy to test.
import { formatDate, formatMoney } from './utils.js';
import { cycleMembers, paymentBalance } from './finance.js';
// Whole days from one YYYY-MM-DD date to another (negative when the second date is earlier).
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
function describe(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? 'yesterday' : `${-days} days ago`;
}
// A reminder is "active" from `daysBefore` days ahead of its date until the date has passed.
// Overdue payment reminders stay active until the money arrives.
export function buildReminders({ user, cycles, members = [], payments = [], stored = [], settings, asOf }) {
  const daysBefore = settings?.daysBefore ?? 2;
  const clubName = settings?.clubName ?? 'our mukando club';
  const saved = new Map(stored.map(row => [row.id, row]));
  const result = [];
  const add = (reminder) => {
    const days = daysBetween(asOf, reminder.date);
    const row = saved.get(reminder.id);
    result.push({ ...reminder, sent: Boolean(row?.sent), days, when: describe(days),
      active: reminder.overdue ? days < 0 || days <= daysBefore : days >= 0 && days <= daysBefore,
      state: days < 0 ? 'overdue' : days <= daysBefore ? 'due soon' : 'upcoming' });
  };
  const live = [...cycles].filter(cycle => cycle.status !== 'closed').sort((a, b) => a.number - b.number);
  for (const cycle of live) {
    if (user.role === 'member') {
      const own = paymentBalance(cycle, user.memberId, payments, asOf);
      if (cycle.status === 'open' && own.outstanding > 0) {
        add({ id: `payment-${cycle.id}-${user.memberId}`, type: 'payment', date: cycle.dueDate, overdue: true,
          message: `Reminder: your contribution of ${formatMoney(own.outstanding)} for cycle ${cycle.number} is due on ${formatDate(cycle.dueDate)}.` });
      }
      if (cycle.isRecipient) add({ id: `payout-${cycle.id}`, type: 'payout', date: cycle.dueDate,
        message: `Good news: cycle ${cycle.number} pays out to you on ${formatDate(cycle.dueDate)}.` });
      continue;
    }
    add({ id: `payment-${cycle.id}`, type: 'payment', date: cycle.dueDate,
      message: `Hello ${clubName} members. Please remember the contribution of ${formatMoney(cycle.amount)} for cycle ${cycle.number}, due on ${formatDate(cycle.dueDate)}.` });
    const recipient = members.find(member => member.id === cycle.recipientMemberId);
    add({ id: `payout-${cycle.id}`, type: 'payout', date: cycle.dueDate,
      message: `Cycle ${cycle.number} payout of ${formatMoney(cycle.expectedPoolCents / 100)} goes to ${recipient?.fullName ?? 'the recipient'} on ${formatDate(cycle.dueDate)}.` });
    if (cycle.status === 'open') {
      for (const member of cycleMembers(cycle, members)) {
        const balance = paymentBalance(cycle, member.id, payments, asOf);
        if (balance.outstanding > 0 && cycle.dueDate <= asOf) {
          add({ id: `payment-${cycle.id}-${member.id}`, type: 'payment', date: cycle.dueDate, overdue: true, memberId: member.id, phone: member.phone,
            message: `Hello ${member.fullName}, you still owe ${formatMoney(balance.outstanding)} for cycle ${cycle.number} of ${clubName}. It was due on ${formatDate(cycle.dueDate)}. Please pay the treasurer. Thank you.` });
        }
      }
    }
  }
  for (const row of stored.filter(row => row.type === 'meeting')) {
    add({ id: row.id, type: 'meeting', date: row.date, message: row.message });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
}
// WhatsApp deep link: opens a chat with the member, or the share screen when no phone is known.
export function whatsappLink(reminder) {
  const text = encodeURIComponent(reminder.message);
  const phone = (reminder.phone ?? '').replace(/\D/g, '');
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}
