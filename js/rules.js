import { db, saveWithAudit } from './db.js';
import { preparePage, showError, showSuccess, finishLoading, failLoading } from './ui.js';
import { today, validateRules } from './utils.js';
const errorBox = document.querySelector('[data-error]');
try {
  const user = await preparePage(['admin', 'chairperson']);
  if (user) {
    const form = document.querySelector('[data-rules-form]');
    const button = document.querySelector('[data-save]');
    const [existing, cycles] = await Promise.all([db.get('rules', 'club'), db.list('cycles')]);
    form.elements.startDate.value = today();
    if (existing) {
      for (const field of ['clubName', 'amount', 'frequency', 'startDate', 'penaltyAmount', 'graceDays']) form.elements[field].value = existing[field];
      document.querySelector('[data-rule-state]').textContent = 'Rules saved';
    }
    if (cycles.length) {
      for (const field of ['amount', 'frequency', 'startDate', 'penaltyAmount', 'graceDays']) form.elements[field].disabled = true;
      document.querySelector('[data-terms-lock]').hidden = false;
    }
    button.disabled = false;
    finishLoading();
    form.addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true; document.querySelector('[data-success]').hidden = true;
      button.disabled = true; button.textContent = 'Saving…';
      try {
        // Read elements directly: disabled contribution fields are excluded by FormData.
        const values = validateRules(Object.fromEntries(['clubName', 'amount', 'frequency', 'startDate', 'penaltyAmount', 'graceDays'].map(field => [field, form.elements[field].value])));
        await saveWithAudit('rules', 'club', values, user, 'rules.updated', 'Club contribution rules saved.');
        document.querySelector('[data-rule-state]').textContent = 'Rules saved';
        showSuccess('Club rules saved successfully.');
      } catch (error) { showError(errorBox, error); }
      finally { button.disabled = false; button.textContent = 'Save rules'; }
    });
  }
} catch (error) { failLoading(error); }
