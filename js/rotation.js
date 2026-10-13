import { db, createRotation, reorderRotation } from './db.js';
import { preparePage, finishLoading, failLoading, showError, showSuccess, tableCell } from './ui.js';
import { formatDate, formatMoney } from './utils.js';
import { shuffled } from './finance.js';
const errorBox = document.querySelector('[data-error]');
try {
  const user = await preparePage(['admin', 'chairperson']);
  if (user) {
    let members, rules, cycles, payouts, order = [], pending = [];
    const button = document.querySelector('[data-save-rotation]');
    const mode = document.querySelector('#rotation-mode');
    const names = () => Object.fromEntries(members.map(member => [member.id, member.fullName]));
    function renderOrder() {
      const list = document.querySelector('[data-order]'); list.replaceChildren();
      const memberNames = names();
      order.forEach((id, index) => {
        const item = document.createElement('li');
        const name = document.createElement('span'); name.textContent = `${index + 1}. ${memberNames[id] ?? 'Member unavailable'}`;
        const controls = document.createElement('div'); controls.className = 'order-controls';
        for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
          const move = document.createElement('button'); move.type = 'button'; move.className = 'secondary order-button';
          move.textContent = label; move.disabled = index + delta < 0 || index + delta >= order.length;
          move.setAttribute('aria-label', `Move ${memberNames[id]} ${delta < 0 ? 'up' : 'down'}`);
          move.addEventListener('click', () => {
            [order[index], order[index + delta]] = [order[index + delta], order[index]];
            mode.value = 'manual'; renderOrder();
            const newPosition = index + delta;
            list.children[newPosition]?.querySelector(delta < 0 ? 'button:last-child' : 'button:first-child')?.focus();
          }); controls.append(move);
        }
        item.append(name, controls); list.append(item);
      });
      document.querySelector('[data-order-empty]').hidden = order.length > 0 && !!rules;
      button.disabled = !rules || !order.length;
      document.querySelector('[data-order-summary]').textContent = `${order.length} ${pending.length ? 'remaining recipients' : 'active members'}`;
    }
    async function load() {
      [members, rules, cycles, payouts] = await Promise.all([db.list('members'), db.get('rules', 'club'), db.list('cycles'), db.list('payouts')]);
      cycles.sort((a, b) => a.number - b.number);
      const round = Math.max(0, ...cycles.map(cycle => cycle.round ?? 1));
      pending = cycles.filter(cycle => (cycle.round ?? 1) === round && cycle.status !== 'closed' && !payouts.some(payout => payout.cycleId === cycle.id));
      order = pending.length ? pending.map(cycle => cycle.recipientMemberId) : members.filter(member => member.status === 'active').sort((a, b) => a.fullName.localeCompare(b.fullName)).map(member => member.id);
      document.querySelector('[data-order-heading]').textContent = pending.length ? 'Recipient order' : 'Create a round';
      document.querySelector('[data-order-note]').textContent = pending.length
        ? 'Reorder the remaining recipients. Completed payouts and cycle dates stay fixed.'
        : 'Every active member gets one turn. New members join the next round.';
      document.querySelector('[data-round-label]').textContent = round ? `Round ${round}` : 'No round yet';
      button.textContent = pending.length ? 'Save recipient order' : 'Create rotation';
      const policy = pending[0] ?? rules;
      document.querySelector('[data-rotation-amount]').textContent = policy ? formatMoney(policy.amount) : 'Not set';
      document.querySelector('[data-rotation-frequency]').textContent = rules?.frequency ?? 'Not set';
      document.querySelector('[data-rotation-count]').textContent = pending[0]?.memberCount ?? order.length;
      document.querySelector('[data-rotation-pool]').textContent = policy ? formatMoney((pending[0]?.expectedPoolCents ?? Math.round(policy.amount * 100) * order.length) / 100) : '—';
      document.querySelector('[data-rotation-start]').textContent = formatDate(pending[0]?.dueDate ?? rules?.startDate);
      const body = document.querySelector('[data-cycles]'); body.replaceChildren();
      for (const cycle of cycles) {
        const row = document.createElement('tr');
        row.append(tableCell(cycle.number), tableCell(cycle.round ?? 1), tableCell(formatDate(cycle.dueDate)), tableCell(names()[cycle.recipientMemberId] ?? 'Member unavailable'), tableCell(formatMoney((cycle.expectedPoolCents ?? 0) / 100)));
        const status = tableCell(''); const badge = document.createElement('span'); badge.className = `member-status ${cycle.status === 'open' ? 'is-active' : 'is-inactive'}`; badge.textContent = cycle.status; status.append(badge); row.append(status); body.append(row);
      }
      document.querySelector('[data-cycle-empty]').hidden = cycles.length > 0;
      mode.value = 'manual'; renderOrder();
    }
    await load(); finishLoading();
    const shuffle = () => { order = shuffled(order); mode.value = 'random'; renderOrder(); };
    document.querySelector('[data-shuffle]').addEventListener('click', shuffle);
    mode.addEventListener('change', () => { if (mode.value === 'random') shuffle(); });
    button.addEventListener('click', async () => {
      errorBox.hidden = true; document.querySelector('[data-success]').hidden = true;
      const wasReorder = pending.length > 0;
      button.disabled = true; button.textContent = 'Saving…';
      try {
        if (wasReorder) await reorderRotation(pending.map(cycle => cycle.id), order, user);
        else await createRotation(order, mode.value, user);
        await load(); showSuccess(wasReorder ? 'Recipient order saved and logged.' : 'Rotation created. The first cycle is open.');
      } catch (error) { showError(errorBox, error); }
      finally { button.disabled = !rules || !order.length; button.textContent = pending.length ? 'Save recipient order' : 'Create rotation'; }
    });
  }
} catch (error) { failLoading(error); }
