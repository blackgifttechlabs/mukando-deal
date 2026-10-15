// Registers the offline service worker and shows connection and sync progress in a small badge.
import { getStatus, syncNow, dismissRejected } from './sync.js';
import { reconnect } from './auth.js';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* The app still works online. */ });

const badge = document.createElement('div');
badge.className = 'sync-badge';
badge.innerHTML = '<button type="button" class="sync-pill" aria-expanded="false"><span class="sync-dot" aria-hidden="true"></span><span data-sync-text></span></button><div class="sync-panel" hidden role="status" aria-live="polite"><p data-sync-detail></p><ul data-sync-rejected></ul><form data-sync-login hidden><label for="sync-password">Password</label><input id="sync-password" type="password" autocomplete="current-password" required><p class="error" data-sync-error hidden></p><button type="submit">Log in to sync</button></form><div class="sync-actions"><button type="button" class="secondary" data-sync-now>Sync now</button><button type="button" class="secondary" data-sync-refresh hidden>Refresh page</button><button type="button" class="secondary" data-sync-dismiss hidden>Dismiss</button></div></div>';
const $ = selector => badge.querySelector(selector);
const pill = $('.sync-pill'), panel = $('.sync-panel'), loginForm = $('[data-sync-login]');
function time(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null; }
function render() {
  const status = getStatus();
  loginForm.hidden = true;
  let label, tone, detail;
  if (!status.signedIn) {
    if (status.online || navigator.onLine) { badge.hidden = true; return; }
    label = 'Offline'; tone = 'offline'; detail = 'You are offline. You can log in with an account that has already logged in on this device.';
  } else if (status.needsLogin) {
    const connected = navigator.onLine;
    label = connected ? 'Log in to sync' : 'Offline login'; tone = connected ? 'busy' : 'offline';
    detail = connected ? 'You are back online. Enter your password once to send your changes and get the latest data.' : 'You logged in without internet. Changes stay on this device until you are online and enter your password.';
    loginForm.hidden = !connected;
  } else if (!status.online) {
    label = status.pending ? `Offline · ${status.pending} waiting` : 'Offline'; tone = 'offline';
    detail = status.pending ? `${status.pending} ${status.pending === 1 ? 'change is' : 'changes are'} saved on this device and will be sent when you are back online.` : 'You are offline. You can keep working; changes are saved on this device.';
  } else if (status.syncing) { label = 'Syncing…'; tone = 'busy'; detail = 'Sending and receiving changes.'; }
  else if (status.pending) { label = `${status.pending} waiting to sync`; tone = 'busy'; detail = 'Changes are waiting to be sent.'; }
  else { label = 'Synced'; tone = 'online'; detail = status.lastSync ? `Online. Last synced at ${time(status.lastSync)}.` : 'Online.'; }
  if (status.rejected.length) { label = `${status.rejected.length} not saved`; tone = 'error'; detail = 'The server refused changes made offline, so they were removed from this device:'; }
  badge.hidden = false;
  pill.dataset.tone = tone; $('[data-sync-text]').textContent = label; $('[data-sync-detail]').textContent = detail;
  const list = $('[data-sync-rejected]'); list.replaceChildren();
  for (const item of status.rejected) { const row = document.createElement('li'); row.textContent = `${item.change} — ${item.reason}`; list.append(row); }
  $('[data-sync-refresh]').hidden = !status.changed;
  $('[data-sync-dismiss]').hidden = !status.rejected.length;
  $('[data-sync-now]').disabled = !status.online || status.syncing;
}
pill.addEventListener('click', () => { panel.hidden = !panel.hidden; pill.setAttribute('aria-expanded', String(!panel.hidden)); });
loginForm.addEventListener('submit', async event => {
  event.preventDefault(); const message = $('[data-sync-error]'); message.hidden = true;
  try { await reconnect(loginForm.querySelector('input').value); loginForm.reset(); render(); }
  catch (error) { message.textContent = error.code === 'auth/invalid-credential' ? 'Password is incorrect.' : error.message; message.hidden = false; }
});
$('[data-sync-now]').addEventListener('click', () => syncNow());
$('[data-sync-refresh]').addEventListener('click', () => location.reload());
$('[data-sync-dismiss]').addEventListener('click', () => dismissRejected());
addEventListener('mukando:sync', render);
addEventListener('online', render); addEventListener('offline', render);
document.addEventListener('DOMContentLoaded', () => { document.body.append(badge); render(); }, { once: true });
if (document.readyState !== 'loading') { document.body.append(badge); render(); }
