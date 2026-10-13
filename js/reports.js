import { loadPayoutData } from './db.js';
import { preparePage, finishLoading, failLoading, showError, tableCell, selectOptions } from './ui.js';
import { formatDate, formatMoney, today } from './utils.js';
import { memberStatement, cycleSummary, clubSummary, defaulters, toCsv } from './report-data.js';
const $ = selector => document.querySelector(selector);
const methods = { cash: 'Cash', ecocash: 'EcoCash', bank: 'Bank' };
try {
  const user = await preparePage(['admin', 'chairperson', 'treasurer']);
  if (user) {
    const data = await loadPayoutData(user);
    const asOf = today();
    const type = $('#report-type'), memberSelect = $('#report-member'), cycleSelect = $('#report-cycle');
    const cycles = [...data.cycles].sort((a, b) => a.number - b.number);
    const nameOf = id => data.members.find(member => member.id === id)?.fullName ?? 'Member unavailable';
    selectOptions(memberSelect, [...data.members].sort((a, b) => a.fullName.localeCompare(b.fullName)).map(member => [member.id, member.fullName]));
    selectOptions(cycleSelect, cycles.map(cycle => [cycle.id, `Cycle ${cycle.number} · ${formatDate(cycle.dueDate)}`]));
    cycleSelect.value = cycles.find(cycle => cycle.status === 'open')?.id ?? cycles.at(-1)?.id ?? '';
    // Each report is plain data: a title, a few key figures and one or more tables.
    // "money" lists the columns shown as currency. The same data feeds the screen, print and CSV.
    const section = (heading, head, rows, money = [], total = null) => ({ heading, head, rows, money, total });
    function build() {
      if (type.value === 'club') {
        const club = clubSummary(data, asOf), t = club.totals;
        return { title: 'Club summary', subtitle: `As at ${formatDate(asOf)}`, summary: [['Active members', t.active], ['Inactive members', t.inactive], ['Cycles closed / open / scheduled', `${t.closed} / ${t.open} / ${t.scheduled}`], ['Total collected', t.collected, true], ['Total paid out', t.paidOut, true], ['Outstanding (past deadline)', t.outstanding, true]],
          sections: [section('Cycles', ['Cycle', 'Due date', 'Recipient', 'Collected', 'Outstanding', 'Paid out', 'Status'],
            club.lines.map(line => [`Cycle ${line.cycle.number}`, formatDate(line.cycle.dueDate), line.recipient?.fullName ?? '—', line.collected, line.outstanding, line.payout?.amount ?? 0, line.cycle.status]), [3, 4, 5],
            ['Total', '', '', t.collected, t.outstanding, t.paidOut, ''])] };
      }
      if (type.value === 'cycle') {
        const cycle = cycles.find(item => item.id === cycleSelect.value);
        if (!cycle) return { title: 'Cycle summary', subtitle: 'No cycles yet.', summary: [], sections: [] };
        const detail = cycleSummary(cycle, data, asOf), t = detail.totals;
        return { title: `Cycle ${cycle.number} summary`, subtitle: `Due ${formatDate(cycle.dueDate)} · recipient ${nameOf(cycle.recipientMemberId)} · ${cycle.status}`,
          summary: [['Expected pool', t.pool, true], ['Collected', t.collected, true], ['Penalties charged', t.penalty, true], ['Outstanding', t.outstanding, true], ['Payout', detail.payout ? `${formatMoney(detail.payout.amount)} on ${formatDate(detail.payout.date)}${detail.payout.confirmed ? ' (received)' : ' (waiting for confirmation)'}` : 'Not recorded yet']],
          sections: [section('Members', ['Member', 'Expected', 'Paid', 'Penalty', 'Outstanding', 'Status'], detail.rows.map(row => [row.member.fullName, row.expected, row.paid, row.penalty, row.outstanding, row.status]), [1, 2, 3, 4], ['Total', t.expected, t.paid, t.penalty, t.outstanding, ''])] };
      }
      if (type.value === 'member') {
        const member = data.members.find(item => item.id === memberSelect.value);
        if (!member) return { title: 'Member statement', subtitle: 'Add a member first.', summary: [], sections: [] };
        const statement = memberStatement(member, data, asOf), t = statement.totals;
        return { title: `Statement: ${member.fullName}`, subtitle: `${member.phone} · joined ${formatDate(member.joinDate)} · as at ${formatDate(asOf)}`,
          summary: [['Expected', t.expected, true], ['Paid', t.paid, true], ['Penalties', t.penalty, true], ['Owed now', t.outstanding, true], ['Not yet due', t.notYetDue, true], ['Payouts received', t.received, true]],
          sections: [section('Cycles', ['Cycle', 'Due date', 'Expected', 'Paid', 'Penalty', 'Unpaid', 'Status'], statement.rows.map(row => [`Cycle ${row.cycle.number}`, formatDate(row.cycle.dueDate), row.expected, row.paid, row.penalty, row.outstanding, row.due ? row.status : `${row.status} (not yet due)`]), [2, 3, 4, 5], ['Total', '', t.expected, t.paid, t.penalty, t.outstanding + t.notYetDue, '']),
            section('Payments', ['Date', 'Cycle', 'Amount', 'Method', 'Reference'], statement.entries.map(entry => [formatDate(entry.date), `Cycle ${cycles.find(cycle => cycle.id === entry.cycleId)?.number ?? '?'}`, entry.amount, methods[entry.method] ?? entry.method, entry.reference || '—']), [2], ['Net paid', '', t.paid, '', ''])] };
      }
      const late = defaulters(data, asOf);
      return { title: 'Defaulters list', subtitle: `Members who owe money after the deadline · as at ${formatDate(asOf)}`,
        summary: [['Members in default', late.length], ['Total owed', late.reduce((sum, row) => sum + Math.round(row.outstanding * 100), 0) / 100, true]],
        sections: [section('Defaulters', ['Member', 'Phone', 'Cycles overdue', 'Outstanding'], late.map(row => [row.member.fullName, row.member.phone, row.cycles, row.outstanding]), [3])] };
    }
    let report;
    const show = (value, column, money) => money.includes(column) && typeof value === 'number' ? formatMoney(value) : String(value);
    function render() {
      $('[data-member-field]').hidden = type.value !== 'member'; $('[data-cycle-field]').hidden = type.value !== 'cycle';
      report = build();
      $('[data-report-title]').textContent = report.title; $('[data-report-subtitle]').textContent = report.subtitle;
      const body = $('[data-report-body]'); body.replaceChildren();
      if (report.summary.length) {
        const list = document.createElement('dl'); list.className = 'club-details no-caps report-summary';
        for (const [label, value, isMoney] of report.summary) {
          const group = document.createElement('div'); const term = document.createElement('dt'); const description = document.createElement('dd');
          term.textContent = label; description.textContent = isMoney ? formatMoney(value) : value; group.append(term, description); list.append(group);
        }
        body.append(list);
      }
      for (const part of report.sections) {
        const heading = document.createElement('h3'); heading.className = 'report-heading'; heading.textContent = part.heading; body.append(heading);
        const wrap = document.createElement('div'); wrap.className = 'table-scroll'; const table = document.createElement('table'); table.className = 'member-table';
        const head = document.createElement('tr');
        for (const label of part.head) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; head.append(cell); }
        const thead = document.createElement('thead'); thead.append(head); const tbody = document.createElement('tbody');
        for (const values of part.rows) { const row = document.createElement('tr'); values.forEach((value, column) => row.append(tableCell(show(value, column, part.money)))); tbody.append(row); }
        if (part.total && part.rows.length) { const row = document.createElement('tr'); row.className = 'total-row'; part.total.forEach((value, column) => row.append(tableCell(show(value, column, part.money)))); tbody.append(row); }
        table.append(thead, tbody); wrap.append(table); body.append(wrap);
        if (!part.rows.length) { const empty = document.createElement('p'); empty.className = 'field-hint report-empty'; empty.textContent = 'Nothing to show for this report yet.'; body.append(empty); }
      }
      $('[data-report-note]').textContent = `Figures are calculated from recorded payments, up to ${formatDate(asOf)}.`;
    }
    function exportCsv() {
      const lines = [[report.title], [report.subtitle], ...report.summary.map(([label, value, isMoney]) => [label, isMoney ? value.toFixed(2) : value])];
      for (const part of report.sections) {
        const raw = (values, total = false) => values.map((value, column) => part.money.includes(column) && typeof value === 'number' ? value.toFixed(2) : value);
        lines.push([], [part.heading], part.head, ...part.rows.map(row => raw(row)));
        if (part.total && part.rows.length) lines.push(raw(part.total));
      }
      const url = URL.createObjectURL(new Blob([toCsv(lines)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${type.value}-report-${asOf}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    for (const control of [type, memberSelect, cycleSelect]) control.addEventListener('change', () => { try { render(); } catch (error) { showError($('[data-error]'), error); } });
    $('[data-print-report]').addEventListener('click', () => window.print());
    $('[data-export-csv]').addEventListener('click', exportCsv);
    render(); finishLoading();
  }
} catch (error) { failLoading(error); }
