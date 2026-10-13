import { guard } from './auth.js';
import { mountLayout, finishLoading, failLoading } from './ui.js';
import { loadReminderData, loadPayoutData } from './db.js';
import { formatDate, formatMoney, today } from './utils.js';
import { cents, cycleMembers, paymentBalance } from './finance.js';
import { buildReminders } from './remind.js';
import { cycleSeries, statusBreakdown, methodMix, cashInHand, attentionList, roundSteps } from './dashboard-data.js';
import { columnChart, donut, sparkline, countUp, money, compact, showTip, hideTip } from './charts.js';
const $ = selector => document.querySelector(selector);
const methodInfo = { cash: ['Cash', 'money-bill', 'var(--series-1)'], ecocash: ['EcoCash', 'mobile-screen', 'var(--series-2)'], bank: ['Bank', 'building-columns', 'var(--series-3)'] };
const quick = {
  admin: [['members.html', 'users', 'Members', 'tone-indigo'], ['reports.html', 'chart-column', 'Reports', 'tone-green'], ['users.html', 'user-gear', 'Users', 'tone-orange'], ['backup.html', 'database', 'Backup', 'tone-pink']],
  chairperson: [['rotation.html', 'rotate', 'Rotation', 'tone-indigo'], ['members.html', 'users', 'Members', 'tone-green'], ['reports.html', 'chart-column', 'Reports', 'tone-orange']],
  treasurer: [['record-payment.html', 'file-invoice-dollar', 'Record payment', 'tone-indigo'], ['payouts.html', 'hand-holding-dollar', 'Payouts', 'tone-green'], ['reports.html', 'chart-column', 'Reports', 'tone-orange']],
  member: [['my-account.html', 'user', 'My account', 'tone-indigo'], ['payments.html', 'money-bill-wave', 'My payments', 'tone-green']]
};
function metric(name, value, note, title) {
  const element = $(`[data-metric="${name}"]`); element.classList.toggle('is-text', typeof value === 'string' && value.length > 9);
  if (typeof value === 'number') countUp(element, value, name === 'members' ? number => String(Math.round(number)) : formatMoney); else element.textContent = value;
  if (note) $(`[data-note="${name}"]`).textContent = note; if (title) $(`[data-title="${name}"]`).textContent = title;
}
function feedItem(list, { icon, tone, title, detail, trailing }) {
  const item = document.createElement('li');
  const badge = document.createElement('span'); badge.className = `feed-icon ${tone}`; const glyph = document.createElement('i'); glyph.className = `fa-solid fa-${icon}`; glyph.setAttribute('aria-hidden', 'true'); badge.append(glyph);
  const text = document.createElement('div'); text.className = 'feed-text'; const strong = document.createElement('strong'); strong.textContent = title; const small = document.createElement('span'); small.textContent = detail; text.append(strong, small);
  item.append(badge, text);
  if (trailing) { const end = document.createElement('span'); end.className = 'feed-trailing'; end.textContent = trailing; item.append(end); }
  list.append(item);
}
function renderRound(container, steps, user) {
  container.replaceChildren();
  const closed = steps.filter(step => step.state === 'closed').length;
  const track = document.createElement('div'); track.className = 'round-track'; const bar = document.createElement('span'); bar.style.setProperty('--w', (steps.length ? closed / steps.length * 100 : 0) + '%'); track.append(bar);
  const row = document.createElement('ol'); row.className = 'round-steps';
  steps.forEach((step, index) => {
    const item = document.createElement('li'); item.className = `round-step is-${step.state}${step.mine ? ' is-mine' : ''}`; item.style.setProperty('--i', index); item.tabIndex = 0;
    item.textContent = step.state === 'closed' ? '' : String(step.cycle.number);
    if (step.state === 'closed') { const tick = document.createElement('i'); tick.className = 'fa-solid fa-check'; tick.setAttribute('aria-hidden', 'true'); item.append(tick); }
    const rows = [{ value: formatDate(step.cycle.dueDate), label: 'Due' }, { value: step.state === 'closed' ? 'Paid out' : step.state === 'open' ? 'Open now' : 'Coming up', label: 'Status' }];
    if (step.recipient) rows.splice(1, 0, { value: step.recipient, label: 'Recipient' }); else if (step.mine) rows.splice(1, 0, { value: 'You', label: 'Recipient' });
    const content = () => ({ title: `Cycle ${step.cycle.number}`, rows });
    item.setAttribute('aria-label', `Cycle ${step.cycle.number}, due ${formatDate(step.cycle.dueDate)}, ${step.state}`);
    item.addEventListener('pointermove', event => showTip(item, content(), event)); item.addEventListener('pointerleave', hideTip); item.addEventListener('focus', () => showTip(item, content())); item.addEventListener('blur', hideTip);
    row.append(item);
  });
  const legend = document.createElement('p'); legend.className = 'round-legend';
  legend.textContent = `${closed} of ${steps.length} cycles paid out`;
  container.append(track, row, legend);
  // Who is paid next. Members see only their own turn.
  const next = steps.filter(step => step.state !== 'closed' && (user.role !== 'member' || step.mine)).slice(0, 2);
  if (next.length) {
    const heading = document.createElement('h3'); heading.className = 'round-next-title'; heading.textContent = 'Up next'; const list = document.createElement('ul'); list.className = 'feed round-next';
    for (const step of next) feedItem(list, { icon: step.state === 'open' ? 'hand-holding-dollar' : 'calendar-day', tone: step.state === 'open' ? 'tone-green' : 'tone-indigo',
      title: `Cycle ${step.cycle.number} · ${step.recipient ?? 'You'}`, detail: `${formatDate(step.cycle.dueDate)} · ${step.state === 'open' ? 'collecting now' : 'coming up'}`, trailing: step.state === 'open' ? 'Open' : '' });
    container.append(heading, list);
  }
}
// On phones the lower panels fold away until their heading is tapped, so the page stays short.
function setupCollapsible() {
  const phone = matchMedia('(max-width: 699px)');
  for (const panel of document.querySelectorAll('[data-collapse]')) {
    const heading = panel.querySelector('.panel-heading'); if (!heading || heading.dataset.ready) continue;
    heading.dataset.ready = 'true'; heading.setAttribute('role', 'button'); heading.tabIndex = 0;
    const chevron = document.createElement('i'); chevron.className = 'fa-solid fa-chevron-down panel-chevron'; chevron.setAttribute('aria-hidden', 'true'); heading.append(chevron);
    const set = open => { panel.classList.toggle('is-collapsed', !open); heading.setAttribute('aria-expanded', String(open)); };
    set(panel.dataset.collapse === 'open');
    const toggle = () => { if (phone.matches) set(panel.classList.contains('is-collapsed')); };
    heading.addEventListener('click', event => { if (!event.target.closest('a')) toggle(); });
    heading.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('a')) { event.preventDefault(); toggle(); } });
    phone.addEventListener('change', event => { if (event.matches) set(panel.dataset.collapse === 'open'); else { panel.classList.remove('is-collapsed'); heading.removeAttribute('aria-expanded'); } });
    if (!phone.matches) { panel.classList.remove('is-collapsed'); heading.removeAttribute('aria-expanded'); }
  }
}
try {
  const user = await guard();
  if (user) {
    mountLayout(user);
    $('[data-password-warning]').hidden = !user.mustChangePassword;
    $('[data-welcome]').textContent = `Welcome back, ${user.username}. Here is how your club is doing.`;
    const links = $('[data-quick]');
    for (const [href, icon, label, tone] of quick[user.role] ?? []) {
      const link = document.createElement('a'); link.href = href; link.className = `quick-tile ${tone}`;
      const glyph = document.createElement('i'); glyph.className = `fa-solid fa-${icon}`; glyph.setAttribute('aria-hidden', 'true'); const text = document.createElement('span'); text.textContent = label; link.append(glyph, text); links.append(link);
    }
    try {
      const isMember = user.role === 'member', asOf = today();
      const [data, payoutData] = await Promise.all([loadReminderData(user), loadPayoutData(user).catch(() => ({ payouts: [] }))]);
      const cycles = [...data.cycles].sort((a, b) => a.number - b.number), open = cycles.find(cycle => cycle.status === 'open'), memberId = isMember ? user.memberId : null;
      const payments = data.payments, payouts = payoutData.payouts;
      if (data.rules) { $('[data-footer-club]').textContent = data.rules.clubName; }
      // ---- headline figures ----
      const series = cycleSeries({ cycles, payments, memberId });
      if (isMember) {
        const paid = payments.reduce((total, payment) => total + cents(payment.amount), 0) / 100, received = payouts.reduce((total, payout) => total + cents(payout.amount), 0) / 100;
        $('[data-hero-label]').textContent = 'You have paid so far'; countUp($('[data-hero-value]'), paid, formatMoney);
        $('[data-hero-sub]').textContent = `Payouts received: ${formatMoney(received)}`;
      } else {
        const cash = cashInHand(payments, payouts);
        $('[data-hero-label]').textContent = 'Cash in hand'; countUp($('[data-hero-value]'), cash.inHand, formatMoney);
        $('[data-hero-sub]').textContent = `Collected ${formatMoney(cash.collected)} · Paid out ${formatMoney(cash.paidOut)}`;
      }
      sparkline($('[data-hero-spark]'), series.slice(-8).map(item => item.collected), '#ffffff');
      if (open) {
        const people = isMember ? [{ id: user.memberId }] : cycleMembers(open, data.members);
        const balances = people.map(person => paymentBalance(open, person.id, payments, asOf));
        const sum = field => balances.reduce((total, balance) => total + cents(balance[field]), 0) / 100;
        metric('collected', sum('paid'), isMember ? 'Your contributions' : `of ${formatMoney(open.expectedPoolCents / 100)} expected`, isMember ? 'Paid this cycle' : null);
        metric('outstanding', sum('outstanding'), isMember ? 'Still due from you' : 'Contributions still due');
      } else { metric('collected', 0, 'No open cycle'); metric('outstanding', 0, 'Nothing due right now'); }
      if (isMember) {
        const turn = cycles.find(cycle => cycle.isRecipient && cycle.status !== 'closed');
        metric('members', open?.memberCount ?? '—', 'People in this round', 'Members in the club');
        metric('payout', turn ? formatDate(turn.dueDate) : '—', turn ? `Cycle ${turn.number}: your turn` : 'No turn coming up');
      } else {
        metric('members', data.members.filter(member => member.status === 'active').length, `${data.members.length} on record`);
        const recipient = data.members.find(member => member.id === open?.recipientMemberId);
        metric('payout', recipient ? recipient.fullName : '—', open ? `Cycle ${open.number}, ${formatDate(open.dueDate)}` : 'Create a rotation first');
      }
      // ---- collections chart ----
      $('[data-collections-title]').textContent = isMember ? 'My contributions by cycle' : 'Collections by cycle';
      if (series.length) {
        columnChart($('[data-chart-collections]'), { labels: series.map(item => item.label), details: series.map(item => `Cycle ${item.cycle.number} · ${formatDate(item.cycle.dueDate)}`),
          series: [{ name: 'Collected', color: 'var(--series-1)', values: series.map(item => item.collected) }, { name: 'Still to collect', color: 'var(--series-2)', values: series.map(item => item.toCollect) }],
          ariaLabel: 'Money collected and still to collect in each cycle', height: matchMedia('(min-width: 700px)').matches ? 168 : 190 });
        $('[data-collections-badge]').textContent = `${series.length} ${series.length === 1 ? 'cycle' : 'cycles'}`;
      } else { $('[data-chart-collections]').hidden = true; $('[data-collections-empty]').hidden = false; $('[data-collections-badge]').textContent = '—'; }
      // ---- this cycle: who has paid ----
      if (open) {
        const counts = statusBreakdown({ cycle: open, members: data.members, payments, asOf, memberId });
        const everyone = counts.Paid + counts.Partial + counts.Unpaid, pct = everyone ? Math.round(counts.Paid / everyone * 100) : 0;
        if (isMember) {
          const balance = paymentBalance(open, user.memberId, payments, asOf);
          donut($('[data-chart-status]'), { small: true, ariaLabel: 'Your payment for this cycle', centerValue: balance.status, centerLabel: `Cycle ${open.number}`,
            segments: [{ label: 'Paid', value: balance.paid, color: 'var(--good)', icon: 'circle-check', format: money }, { label: 'Still to pay', value: balance.outstanding, color: 'var(--critical)', icon: 'circle-xmark', format: money }] });
        } else {
          donut($('[data-chart-status]'), { small: true, ariaLabel: 'Members paid, part-paid and unpaid this cycle', centerValue: `${pct}%`, centerLabel: 'paid in full',
            segments: [{ label: 'Paid', value: counts.Paid, color: 'var(--good)', icon: 'circle-check' }, { label: 'Partial', value: counts.Partial, color: 'var(--warning)', icon: 'circle-half-stroke' }, { label: 'Unpaid', value: counts.Unpaid, color: 'var(--critical)', icon: 'circle-xmark' }] });
        }
        $('[data-status-badge]').textContent = `Cycle ${open.number}`;
      } else { $('[data-chart-status]').hidden = true; $('[data-status-empty]').hidden = false; $('[data-status-badge]').textContent = '—'; }
      // ---- round progress ----
      const steps = roundSteps({ cycles, members: data.members, user });
      if (steps.length) { renderRound($('[data-round]'), steps, user); $('[data-round-badge]').textContent = `Round ${Math.max(...cycles.map(cycle => cycle.round ?? 1))}`; }
      else { $('[data-round]').hidden = true; $('[data-round-empty]').hidden = false; }
      // ---- how members pay ----
      const mix = methodMix(payments, memberId), mixTotal = mix.reduce((total, row) => total + row.value, 0);
      if (mixTotal > 0) donut($('[data-chart-methods]'), { small: true, ariaLabel: 'Payments by method', centerValue: compact(mixTotal), centerLabel: 'collected',
        segments: mix.map(row => ({ label: methodInfo[row.method][0], value: row.value, color: methodInfo[row.method][2], icon: methodInfo[row.method][1], format: money })) });
      else { $('[data-chart-methods]').hidden = true; $('[data-methods-empty]').hidden = false; }
      // ---- feeds ----
      const attention = $('[data-attention]');
      $('[data-attention-panel]').hidden = isMember;
      if (!isMember) {
        const late = attentionList({ members: data.members, cycles, payments }, asOf, 3);
        for (const row of late) feedItem(attention, { icon: 'triangle-exclamation', tone: 'tone-orange', title: row.member.fullName, detail: `${row.cycles} ${row.cycles === 1 ? 'cycle' : 'cycles'} overdue`, trailing: formatMoney(row.outstanding) });
        $('[data-attention-empty]').hidden = late.length > 0 || !cycles.length;
      }
      const due = buildReminders({ user, cycles, members: data.members, payments, stored: data.stored, settings: data.settings, asOf }).filter(reminder => reminder.active && !reminder.sent);
      $('[data-reminder-text]').textContent = due.length ? `${due.length} ${due.length === 1 ? 'reminder' : 'reminders'} due` : 'No reminders due';
      $('[data-reminder-badge]').classList.toggle('has-reminders', due.length > 0);
      const feed = $('[data-reminders-feed]');
      for (const reminder of due.slice(0, 3)) feedItem(feed, { icon: reminder.type === 'meeting' ? 'calendar-day' : reminder.type === 'payout' ? 'gift' : 'bell', tone: reminder.state === 'overdue' ? 'tone-orange' : 'tone-indigo', title: reminder.message.length > 60 ? reminder.message.slice(0, 57) + '…' : reminder.message, detail: `${formatDate(reminder.date)} · ${reminder.when}` });
      $('[data-reminders-empty]').hidden = due.length > 0;
      const recent = [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 3);
      const activity = $('[data-activity]');
      for (const payment of recent) feedItem(activity, { icon: payment.amount < 0 ? 'rotate-left' : methodInfo[payment.method]?.[1] ?? 'money-bill', tone: payment.amount < 0 ? 'tone-orange' : 'tone-green',
        title: isMember ? 'You' : data.members.find(member => member.id === payment.memberId)?.fullName ?? 'A member', detail: `${formatDate(payment.date)} · ${methodInfo[payment.method]?.[0] ?? payment.method}`, trailing: (payment.amount < 0 ? '−' : '+') + formatMoney(Math.abs(payment.amount)) });
      $('[data-activity-empty]').hidden = recent.length > 0;
      // Members have no "needs attention" panel, so the other three share the row.
      if (isMember) for (const panel of document.querySelectorAll('[data-round-panel], [data-reminders-panel], [data-activity-panel]')) { panel.classList.remove('span-3'); panel.classList.add('span-4'); }
    } catch (error) {
      // The overview still loads when the numbers cannot, for example before the club has any rules.
      const box = $('[data-error]'); box.textContent = 'Some figures could not be loaded: ' + (error.message || 'please try again.'); box.hidden = false;
    }
    setupCollapsible();
    finishLoading();
  }
} catch (error) { failLoading(error); }
