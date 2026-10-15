// Offline support. App files are cached on first use and refreshed whenever the network answers,
// so a page opened once online keeps opening without internet. Firebase data calls are never touched here;
// club data is kept in SQLite by js/localdb.js.
const VERSION = 'mukando-v1';
const APP_FILES = [
  "./",
  "assets/apple-touch-icon.png",
  "assets/favicon-192.png",
  "assets/favicon-32.png",
  "assets/favicon.ico",
  "assets/login-savings-hd.png",
  "assets/logo.png",
  "backup.html",
  "css/style.css",
  "dashboard.html",
  "index.html",
  "js/accounts.js",
  "js/assets.js",
  "js/auth.js",
  "js/backup.js",
  "js/charts.js",
  "js/dashboard-data.js",
  "js/dashboard.js",
  "js/db.js",
  "js/finance.js",
  "js/firebase.js",
  "js/localdb.js",
  "js/login.js",
  "js/members.js",
  "js/mobile.js",
  "js/my-account.js",
  "js/payments.js",
  "js/payouts.js",
  "js/pwa.js",
  "js/remind.js",
  "js/reminders.js",
  "js/report-data.js",
  "js/reports.js",
  "js/rotation.js",
  "js/rules.js",
  "js/sync.js",
  "js/theme.js",
  "js/ui.js",
  "js/users.js",
  "js/utils.js",
  "js/workspace.js",
  "member-form.html",
  "members.html",
  "my-account.html",
  "payments.html",
  "payouts.html",
  "record-payment.html",
  "reminders.html",
  "reports.html",
  "rotation.html",
  "rules.html",
  "users.html",
  "vendor/sql-wasm.js",
  "vendor/sql-wasm.wasm"
];
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const SDK_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-database.js'].map(name => SDK + name);
// Versioned library files never change, so a cached copy is always right.
const IMMUTABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One missing file must not stop the rest from being saved.
    await Promise.all([...APP_FILES, ...SDK_FILES].map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined) ?? Response.error();
  }
}
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (IMMUTABLE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
});
