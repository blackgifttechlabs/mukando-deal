// All club data access lives here. The namespace avoids touching other project data.
// Reads and writes go through sync.js: Firebase while online, the on-device SQLite copy while offline.
import { backend as localFirst, requireOnline, isOnline } from './sync.js';
const backend = () => localFirst();
// Appearance is a device preference, separate from cloud club records.
export function getThemePreference() {
  try {
    const theme = localStorage.getItem('mukando-theme');
    return ['light', 'dark'].includes(theme) ? theme : null;
  } catch { return null; }
}
export function setThemePreference(theme) {
  if (!['light', 'dark'].includes(theme)) return;
  try { localStorage.setItem('mukando-theme', theme); } catch { /* Still switch for this page. */ }
}
// Last verified identity is only a visual cache, never an authorization source.
export function getLayoutUser() {
  try {
    const user = JSON.parse(localStorage.getItem('mukando-layout-user') ?? 'null');
    return user && ['admin', 'chairperson', 'treasurer', 'member'].includes(user.role) ? user : null;
  } catch { return null; }
}
export function setLayoutUser(user) {
  try {
    if (user) localStorage.setItem('mukando-layout-user', JSON.stringify({ username: user.username, role: user.role }));
    else localStorage.removeItem('mukando-layout-user');
  } catch { /* The sidebar can still render after authentication. */ }
}
export const tables = ['users', 'members', 'rules', 'cycles', 'payments', 'payouts', 'reminders', 'auditLog', 'cycleApprovals', 'settings'];
async function tableRef(table, id) {
  if (!tables.includes(table)) throw new Error('Unknown data table.');
  if (id !== undefined && (typeof id !== 'string' || !id || /[.#$\[\]\/]/.test(id))) {
    throw new Error('Invalid record ID.');
  }
  const { ref, database } = await backend();
  return ref(database, `mukando/${table}${id === undefined ? '' : '/' + id}`);
}
export const db = {
  async list(table) {
    const { get } = await backend();
    const snapshot = await get(await tableRef(table));
    return Object.entries(snapshot.val() ?? {}).map(([id, row]) => ({ ...row, id }));
  },
  async get(table, id) {
    const { get } = await backend();
    const snapshot = await get(await tableRef(table, id));
    return snapshot.exists() ? { ...snapshot.val(), id } : null;
  },
  async add(table, values) {
    const id = values.id ?? crypto.randomUUID();
    const row = { ...values, id };
    // Transactions prevent two clients from overwriting the same record.
    const { runTransaction } = await backend();
    const result = await runTransaction(await tableRef(table, id), current => {
      if (current !== null) return; // Abort if the ID already exists.
      return row;
    }, { applyLocally: false });
    if (!result.committed) throw new Error('This record already exists.');
    return { ...result.snapshot.val(), id };
  },
  async update(table, id, changes) {
    // Fetch first so an absent record can be reported clearly.
    if (!await this.get(table, id)) throw new Error('Record not found.');
    const { runTransaction } = await backend();
    const result = await runTransaction(await tableRef(table, id), current => {
      if (current === null) return null; // Retry against the server if the cache is empty.
      return { ...current, ...changes, id };
    }, { applyLocally: false });
    if (!result.committed || !result.snapshot.exists()) throw new Error('Record not found.');
    return { ...result.snapshot.val(), id };
  }
};

// Save a record and its audit event in a single atomic multi-location update.
// update() checks each destination's rules; it does not grant access to other tables.
export async function saveWithAudit(table, id, changes, user, action, details) {
  if (!['members', 'rules'].includes(table)) throw new Error('This record cannot be saved here.');
  await tableRef(table, id); // Validate the table and record ID.
  const { ref, update, database } = await backend();
  const updates = {};
  for (const [key, value] of Object.entries({ ...changes, id })) {
    if (/[.#$\[\]\/]/.test(key)) throw new Error('Invalid record field.');
    updates[`mukando/${table}/${id}/${key}`] = value;
  }
  const logId = crypto.randomUUID();
  updates[`mukando/auditLog/${logId}`] = {
    id: logId, time: new Date().toISOString(), userId: user.id, action, details
  };
  await update(ref(database), updates);
}

function auditEvent(user, action, details) {
  return { id: crypto.randomUUID(), time: new Date().toISOString(), userId: user.id, action, details };
}
async function atomicWrite(updates, event) {
  const { ref, update, database } = await backend();
  updates[`mukando/auditLog/${event.id}`] = event;
  await update(ref(database), updates);
}
function requireRole(user, allowed) {
  if (!user?.active || !allowed.includes(user.role)) throw new Error('Your role cannot make this change.');
}
function ownCycle(cycle, memberId) {
  // These projections never expose other members' identities or payments.
  return { id: cycle.id, cycleId: cycle.id, number: cycle.number, round: cycle.round,
    dueDate: cycle.dueDate, amount: cycle.amount, penaltyAmount: cycle.penaltyAmount,
    graceDays: cycle.graceDays, status: cycle.status, isRecipient: cycle.recipientMemberId === memberId };
}
export async function createRotation(order, mode, user) {
  requireRole(user, ['admin', 'chairperson']);
  const [{ buildRound }, members, rules, existing] = await Promise.all([
    import('./finance.js'), db.list('members'), db.get('rules', 'club'), db.list('cycles')
  ]);
  if (!rules) throw new Error('Save your club rules before creating a rotation.');
  const event = auditEvent(user, 'rotation.created', 'Created a ' + mode + ' rotation.');
  const cycles = buildRound(members, rules, existing, order, mode, event.id);
  const updates = {};
  for (const cycle of cycles) {
    updates[`mukando/cycles/${cycle.id}`] = cycle;
    updates[`mukando/roundRecipients/${cycle.roundKey}/${cycle.recipientMemberId}`] = cycle.id;
    for (const memberId of Object.keys(cycle.memberIds)) updates[`mukando/memberCycles/${memberId}/${cycle.id}`] = ownCycle(cycle, memberId);
  }
  updates[`mukando/rounds/${cycles[0].roundKey}`] = {
    id: cycles[0].roundKey, number: cycles[0].round, firstCycleId: cycles[0].id,
    memberCount: cycles.length, mode, createdAt: event.time, auditId: event.id
  };
  // Deterministic cycle IDs and create-only round rules stop duplicate concurrent rounds.
  await atomicWrite(updates, event);
}
export async function reorderRotation(cycleIds, recipients, user) {
  requireRole(user, ['admin', 'chairperson']);
  const [{ exactOrder }, cycles, payouts] = await Promise.all([import('./finance.js'), db.list('cycles'), db.list('payouts')]);
  const latestRound = Math.max(0, ...cycles.map(cycle => cycle.round ?? 1));
  const pending = cycles.filter(cycle => (cycle.round ?? 1) === latestRound && cycle.status !== 'closed' && !payouts.some(payout => payout.cycleId === cycle.id))
    .sort((a, b) => a.number - b.number);
  if (cycleIds.join() !== pending.map(cycle => cycle.id).join()) throw new Error('The schedule changed. Refresh before changing its order.');
  exactOrder(recipients, pending.map(cycle => cycle.recipientMemberId));
  if (recipients.every((id, index) => pending[index].recipientMemberId === id)) throw new Error('The recipient order has not changed.');
  const event = auditEvent(user, 'rotation.reordered', JSON.stringify({ before: pending.map(cycle => cycle.recipientMemberId), after: recipients, afterFirstPayout: payouts.length > 0 }));
  if (event.details.length > 2000) event.details = `Reordered ${pending.length} pending recipients. After first payout: ${payouts.length > 0}.`;
  const updates = {};
  for (const [index, cycle] of pending.entries()) {
    const recipientMemberId = recipients[index];
    updates[`mukando/cycles/${cycle.id}/recipientMemberId`] = recipientMemberId;
    updates[`mukando/cycles/${cycle.id}/auditId`] = event.id;
    updates[`mukando/roundRecipients/${cycle.roundKey}/${recipientMemberId}`] = cycle.id;
    for (const memberId of Object.keys(cycle.memberIds)) updates[`mukando/memberCycles/${memberId}/${cycle.id}/isRecipient`] = memberId === recipientMemberId;
  }
  await atomicWrite(updates, event);
}
export async function loadPaymentData(user) {
  if (user.role === 'member') {
    if (!user.memberId) throw new Error('Your account is not linked to a member. Ask the administrator to link it first.');
    const { ref, get, query, orderByChild, equalTo, database } = await backend();
    const [member, ownPayments, ownCycles] = await Promise.all([
      db.get('members', user.memberId),
      get(query(ref(database, 'mukando/payments'), orderByChild('memberId'), equalTo(user.memberId))),
      get(ref(database, `mukando/memberCycles/${user.memberId}`))
    ]);
    if (!member) throw new Error('Your linked member record was not found.');
    const rows = snapshot => Object.entries(snapshot.val() ?? {}).map(([id, row]) => ({ ...row, id }));
    return { members: [member], payments: rows(ownPayments), cycles: rows(ownCycles), reversals: {} };
  }
  const [members, payments, cycles] = await Promise.all([db.list('members'), db.list('payments'), db.list('cycles')]);
  return { members, payments, cycles, reversals: Object.fromEntries(payments.filter(payment => payment.reversesPaymentId).map(payment => [payment.reversesPaymentId, payment.id])) };
}
export async function recordPayment(values, user) {
  requireRole(user, ['treasurer']);
  const [{ validatePayment }, cycle, member] = await Promise.all([
    import('./finance.js'), db.get('cycles', values.cycleId), db.get('members', values.memberId)
  ]);
  const checked = validatePayment(values, cycle, member);
  const event = auditEvent(user, 'payment.recorded', `Recorded ${checked.amount.toFixed(2)} for member ${member.id}, cycle ${cycle.number}.`);
  const payment = { ...checked, id: values.id ?? crypto.randomUUID(), recordedBy: user.id, auditId: event.id };
  try {
    await atomicWrite({ [`mukando/payments/${payment.id}`]: payment, [`mukando/cycleLocks/${cycle.id}/hasPayments`]: true }, event);
    return payment;
  } catch (error) {
    // If the server committed but its response was lost, reuse the receipt instead of duplicating it.
    const saved = await db.get('payments', payment.id);
    if (saved && saved.recordedBy === user.id && Object.entries(checked).every(([field, value]) => saved[field] === value)) return saved;
    throw error;
  }
}
export async function reversePayment(paymentId, reason, user) {
  requireRole(user, ['treasurer']);
  const original = await db.get('payments', paymentId);
  if (!original || original.amount <= 0 || original.reversesPaymentId) throw new Error('Choose an original positive payment.');
  const cycle = await db.get('cycles', original.cycleId);
  if (!cycle || cycle.status !== 'open') throw new Error('Only payments in the open cycle can be reversed.');
  if (!reason.trim() || reason.trim().length > 200) throw new Error('Enter a reason with 1 to 200 characters.');
  const event = auditEvent(user, 'payment.reversed', `Reversed payment ${original.id}: ${reason.trim()}`);
  const payment = { id: crypto.randomUUID(), cycleId: original.cycleId, memberId: original.memberId,
    amount: -original.amount, amountCents: -Math.round(original.amount * 100), method: original.method,
    reference: reason.trim(), date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Harare' }).format(new Date()),
    recordedBy: user.id, reversesPaymentId: original.id, auditId: event.id };
  await atomicWrite({ [`mukando/payments/${payment.id}`]: payment, [`mukando/paymentReversals/${original.id}`]: payment.id }, event);
  return payment;
}

// ---------- Phase 5: payouts and closing a cycle ----------
const rowsOf = snapshot => Object.entries(snapshot.val() ?? {}).map(([id, row]) => ({ ...row, id }));
// Ask Firebase for only the rows that match, so a member never downloads other people's records.
async function rowsWhere(table, child, value) {
  const { ref, get, query, orderByChild, equalTo, database } = await backend();
  return rowsOf(await get(query(ref(database, `mukando/${table}`), orderByChild(child), equalTo(value))));
}
// Net money collected for one cycle: payments minus reversals, counted in cents.
export async function cycleCollectedCents(cycleId) {
  const { cents } = await import('./finance.js');
  return (await rowsWhere('payments', 'cycleId', cycleId)).reduce((total, payment) => total + cents(payment.amount), 0);
}
export async function loadPayoutData(user) {
  if (user.role === 'member') {
    if (!user.memberId) throw new Error('Your account is not linked to a member. Ask the administrator to link it first.');
    const { ref, get, database } = await backend();
    const [payouts, ownCycles] = await Promise.all([rowsWhere('payouts', 'memberId', user.memberId), get(ref(database, `mukando/memberCycles/${user.memberId}`))]);
    return { members: [], cycles: rowsOf(ownCycles), payouts, payments: [], approvals: [] };
  }
  const [members, cycles, payouts, payments, approvals] = await Promise.all([
    db.list('members'), db.list('cycles'), db.list('payouts'), db.list('payments'), db.list('cycleApprovals')
  ]);
  return { members, cycles, payouts, payments, approvals };
}
// The treasurer records money handed to the cycle's recipient. This freezes payments for the cycle.
export async function recordPayout(cycleId, user) {
  requireRole(user, ['treasurer']);
  const [cycle, existing, collected] = await Promise.all([db.get('cycles', cycleId), db.get('payouts', cycleId), cycleCollectedCents(cycleId)]);
  if (!cycle || cycle.status !== 'open') throw new Error('Only the open cycle can be paid out.');
  if (existing) throw new Error('A payout is already recorded for this cycle.');
  if (collected <= 0) throw new Error('Nothing has been collected for this cycle yet.');
  const recipient = await db.get('members', cycle.recipientMemberId);
  if (!recipient) throw new Error('The recipient’s member record was not found.');
  const event = auditEvent(user, 'payout.recorded', `Recorded payout of ${(collected / 100).toFixed(2)} to member ${recipient.id} for cycle ${cycle.number}.`);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Harare' }).format(new Date());
  const payout = { id: cycleId, cycleId, memberId: recipient.id, amount: collected / 100, amountCents: collected, date, confirmed: false, recordedBy: user.id, auditId: event.id };
  await atomicWrite({ [`mukando/payouts/${cycleId}`]: payout, [`mukando/cycleLocks/${cycleId}/hasPayout`]: true }, event);
  return payout;
}
// The recipient confirms receipt: the treasurer ticks it, or the member does in My account.
export async function confirmPayout(cycleId, user) {
  requireRole(user, ['treasurer', 'member']);
  // Members may only read payouts through a query on their own member ID.
  const payout = user.role === 'member' ? (await rowsWhere('payouts', 'memberId', user.memberId)).find(row => row.id === cycleId) : await db.get('payouts', cycleId);
  if (!payout) throw new Error('This payout was not found.');
  if (payout.confirmed) throw new Error('This payout is already confirmed.');
  if (user.role === 'member' && payout.memberId !== user.memberId) throw new Error('Only the recipient can confirm this payout.');
  const event = auditEvent(user, 'payout.confirmed', `Confirmed payout for cycle ${cycleId} (${user.role}).`);
  await atomicWrite({
    [`mukando/payouts/${cycleId}/confirmed`]: true, [`mukando/payouts/${cycleId}/confirmedBy`]: user.id,
    [`mukando/payouts/${cycleId}/confirmedAt`]: event.time, [`mukando/payouts/${cycleId}/confirmAuditId`]: event.id
  }, event);
}
// The chairperson may allow a cycle to close even though some members have not paid in full.
export async function approveClosing(cycleId, reason, user) {
  requireRole(user, ['admin', 'chairperson']);
  const cycle = await db.get('cycles', cycleId);
  if (!cycle || cycle.status !== 'open') throw new Error('Only the open cycle can be approved for closing.');
  const text = reason.trim();
  if (!text || text.length > 200) throw new Error('Enter a reason with 1 to 200 characters.');
  const event = auditEvent(user, 'cycle.closing-approved', `Approved closing cycle ${cycle.number} with unpaid members: ${text}`);
  await atomicWrite({ [`mukando/cycleApprovals/${cycleId}`]: { cycleId, approvedBy: user.id, time: event.time, reason: text, auditId: event.id } }, event);
}
// Close the cycle and open the next one in a single all-or-nothing write.
export async function closeCycle(cycleId, user) {
  requireRole(user, ['treasurer']);
  const [{ cycleMembers, paymentBalance }, cycle, payout, approval, members, payments, cycles] = await Promise.all([
    import('./finance.js'), db.get('cycles', cycleId), db.get('payouts', cycleId), db.get('cycleApprovals', cycleId),
    db.list('members'), rowsWhere('payments', 'cycleId', cycleId), db.list('cycles')
  ]);
  if (!cycle || cycle.status !== 'open') throw new Error('Only the open cycle can be closed.');
  if (!payout) throw new Error('Record the payout before closing this cycle.');
  if (!payout.confirmed) throw new Error('The recipient must confirm the payout before the cycle closes.');
  const unpaid = cycleMembers(cycle, members).filter(member => paymentBalance(cycle, member.id, payments).outstanding > 0);
  if (unpaid.length && !approval) throw new Error(`${unpaid.length} ${unpaid.length === 1 ? 'member has' : 'members have'} not paid in full. Ask the chairperson to approve closing first.`);
  const next = cycles.find(item => item.round === cycle.round && item.number === cycle.number + 1);
  const event = auditEvent(user, 'cycle.closed', `Closed cycle ${cycle.number}${unpaid.length ? ` with ${unpaid.length} unpaid (chairperson approved)` : ''}${next ? `; opened cycle ${next.number}` : '; round complete'}.`);
  const updates = { [`mukando/cycles/${cycle.id}/status`]: 'closed', [`mukando/cycles/${cycle.id}/auditId`]: event.id };
  for (const memberId of Object.keys(cycle.memberIds)) updates[`mukando/memberCycles/${memberId}/${cycle.id}/status`] = 'closed';
  if (next) {
    updates[`mukando/cycles/${next.id}/status`] = 'open'; updates[`mukando/cycles/${next.id}/auditId`] = event.id;
    for (const memberId of Object.keys(next.memberIds)) updates[`mukando/memberCycles/${memberId}/${next.id}/status`] = 'open';
  }
  await atomicWrite(updates, event);
  return { next, unpaid: unpaid.length };
}

// ---------- Phase 6: reminders ----------
export async function getReminderSettings() {
  return (await db.get('settings', 'reminders')) ?? { id: 'reminders', daysBefore: 2 };
}
export async function saveReminderSettings(daysBefore, user) {
  requireRole(user, ['admin', 'chairperson']);
  if (!/^\d+$/.test(String(daysBefore)) || Number(daysBefore) > 30) throw new Error('Enter a whole number of days from 0 to 30.');
  const event = auditEvent(user, 'settings.reminders', `Reminders now start ${Number(daysBefore)} days before the due date.`);
  await atomicWrite({ 'mukando/settings/reminders': { id: 'reminders', daysBefore: Number(daysBefore) } }, event);
}
export async function loadReminderData(user) {
  const [settings, rules] = await Promise.all([getReminderSettings(), db.get('rules', 'club')]);
  const withClub = { ...settings, clubName: rules?.clubName };
  const base = { rules };
  if (user.role === 'member') {
    // Members read only meeting notices; payment nudges stay between staff.
    const stored = await rowsWhere('reminders', 'type', 'meeting');
    if (!user.memberId) return { ...base, settings: withClub, cycles: [], payments: [], stored, members: [] };
    const data = await loadPaymentData(user);
    return { ...base, settings: withClub, cycles: data.cycles, payments: data.payments, stored, members: data.members };
  }
  const [members, cycles, payments, stored] = await Promise.all([db.list('members'), db.list('cycles'), db.list('payments'), db.list('reminders')]);
  return { ...base, settings: withClub, members, cycles, payments, stored };
}
// Create a meeting reminder, or remember that an automatic reminder was shared.
export async function saveReminder(values, user) {
  requireRole(user, ['admin', 'chairperson', 'treasurer']);
  const { isValidDate } = await import('./utils.js');
  const message = String(values.message ?? '').trim();
  if (!['payment', 'payout', 'meeting'].includes(values.type)) throw new Error('Choose a reminder type.');
  if (!message || message.length > 500) throw new Error('Enter a message with 1 to 500 characters.');
  if (!isValidDate(values.date)) throw new Error('Choose a valid date.');
  const id = values.id ?? crypto.randomUUID();
  const existing = await db.get('reminders', id);
  const row = { id, type: values.type, message, date: values.date, sent: Boolean(values.sent), createdBy: existing?.createdBy ?? user.id };
  const event = auditEvent(user, existing ? 'reminder.updated' : 'reminder.created', `${existing ? 'Updated' : 'Created'} ${row.type} reminder for ${row.date}.`);
  await atomicWrite({ [`mukando/reminders/${id}`]: row }, event);
  return row;
}

// ---------- Phase 8: users, audit trail and backups ----------
export async function loadUsers(user) {
  requireRole(user, ['admin']);
  const [users, members] = await Promise.all([db.list('users'), db.list('members')]);
  return { users, members };
}
// Save an account profile (never a password) together with its audit entry.
// A null value removes a field, for example to unlink a member.
export async function saveUserProfile(profile, user, action, details, isNew = false) {
  requireRole(user, ['admin']);
  const updates = {};
  if (isNew) {
    const row = {};
    for (const [key, value] of Object.entries(profile)) if (value !== undefined && value !== null && value !== '') row[key] = value;
    updates[`mukando/users/${profile.id}`] = row;
  } else {
    for (const [key, value] of Object.entries(profile)) if (value !== undefined && key !== 'id') updates[`mukando/users/${profile.id}/${key}`] = value === '' ? null : value;
  }
  await atomicWrite(updates, auditEvent(user, action, details));
}
// Clears the "change your password" notice. Firebase Authentication holds the password itself.
export async function clearPasswordWarning(user) {
  const { ref, update, database } = await backend();
  await update(ref(database), { [`mukando/users/${user.id}/mustChangePassword`]: false });
}
export async function loadAuditTrail(user) {
  requireRole(user, ['admin']);
  const [log, users] = await Promise.all([db.list('auditLog'), db.list('users')]);
  const names = Object.fromEntries(users.map(row => [row.id, row.username]));
  return log.map(row => ({ ...row, userName: names[row.userId] ?? row.userId })).sort((a, b) => b.time.localeCompare(a.time));
}
// Every top-level collection in the club database. Depth is how many keys make up one record's path.
export const backupTables = {
  users: 1, members: 1, rules: 1, rounds: 1, cycles: 1, roundRecipients: 2, memberCycles: 2, cycleLocks: 2,
  payments: 1, paymentReversals: 1, payouts: 1, cycleApprovals: 1, reminders: 1, settings: 1, auditLog: 1
};
export async function exportBackup(user) {
  requireRole(user, ['admin']);
  const { ref, get, database } = await backend();
  const data = {};
  for (const name of Object.keys(backupTables)) data[name] = (await get(ref(database, `mukando/${name}`))).val() ?? {};
  return { app: 'mukando-manager', version: 1, exportedAt: new Date().toISOString(), exportedBy: user.id, data };
}
// Restore mode must never stay switched on. Called when the Backup page opens, in case a restore was interrupted.
export async function endRestoreMode(user) {
  requireRole(user, ['admin']);
  if (!isOnline()) return; // Restore mode can only have been switched on while online.
  const { ref, get, set, database } = await backend();
  const restoreRef = ref(database, 'mukando/restoreMode');
  if ((await get(restoreRef)).val() === true) await set(restoreRef, false);
}
export function summariseBackup(file) {
  if (!file || file.app !== 'mukando-manager' || file.version !== 1 || typeof file.data !== 'object' || file.data === null) throw new Error('This is not a Mukando Manager backup file.');
  const counts = {};
  for (const name of Object.keys(backupTables)) counts[name] = Object.keys(file.data[name] ?? {}).length;
  return counts;
}
// Flatten a collection to one path per record so each record meets its own Firebase rule.
function flatten(value, depth, prefix, updates) {
  if (depth === 0) { updates[prefix] = value; return; }
  for (const [key, child] of Object.entries(value ?? {})) {
    if (/[.#$\[\]\/]/.test(key)) throw new Error('The backup contains an invalid record ID.');
    flatten(child, depth - 1, `${prefix}/${key}`, updates);
  }
}
// Rebuild an EMPTY club from a backup. The database only allows this while restore mode is on,
// and restore mode can only be switched on when there are no members, cycles, payments or payouts.
export async function importBackup(file, user) {
  requireRole(user, ['admin']);
  summariseBackup(file);
  requireOnline('Restoring a backup');
  const { ref, set, update, database } = await backend();
  const existing = await Promise.all(['members', 'cycles', 'payments', 'payouts'].map(name => db.list(name)));
  if (existing.some(rows => rows.length)) throw new Error('Restore needs an empty club. Clear the club data in the Firebase console first, then import.');
  const updates = {};
  for (const [name, depth] of Object.entries(backupTables)) {
    if (name === 'users') continue; // Login profiles stay as they are; restoring them could lock the administrator out.
    flatten(file.data[name], depth, `mukando/${name}`, updates);
  }
  const restoreRef = ref(database, 'mukando/restoreMode');
  await set(restoreRef, true);
  try { await update(ref(database), updates); }
  finally { await set(restoreRef, false); }
}
