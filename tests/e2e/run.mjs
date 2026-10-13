import { chromium } from 'playwright-core';
import { databaseShim, appShim, authShim } from './shims.mjs';
import { readFile, mkdir } from 'node:fs/promises';
export const BASE = 'http://127.0.0.1:9019', NS = 'demo-mukando-e2e', SITE = 'http://localhost:8765';
export const owner = async (path, method = 'GET', data) => {
  const response = await fetch(`${BASE}/${path}.json?ns=${NS}`, { method, headers: { Authorization: 'Bearer owner' }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.json();
};
export async function seed(extra = {}) {
  await owner('.settings/rules', 'PUT', JSON.parse(await readFile(new URL('../../database.rules.json', import.meta.url))));
  await owner('', 'DELETE');
  const people = { a: ['Admin Anna', 'admin'], c: ['Chair Charles', 'chairperson'], t: ['Treasurer Tendai', 'treasurer'], u1: ['Member Anesu', 'member'], u2: ['Member Bonolo', 'member'] };
  const users = Object.fromEntries(Object.entries(people).map(([id, [username, role]]) => [id, { id, username, role, active: true, email: `${id}@club.test`, ...(role === 'member' ? { memberId: 'm' + id.slice(1) } : {}) }]));
  const names = ['Anesu Moyo', 'Bonolo Ncube', 'Chipo Dube', 'Farai Sibanda'];
  const members = Object.fromEntries(names.map((fullName, i) => [`m${i + 1}`, { id: `m${i + 1}`, fullName, phone: `+26377123456${i}`, joinDate: '2026-01-01', status: 'active', notes: '' }]));
  await owner('mukando', 'PUT', { users, members, rules: { club: { id: 'club', clubName: 'Agape Fushai Group', amount: 20, frequency: 'monthly', startDate: '2026-09-15', penaltyAmount: 2, graceDays: 3 } }, ...extra });
}
export const accounts = { 'a@club.test': { uid: 'a', password: 'Passw0rd1' }, 'c@club.test': { uid: 'c', password: 'Passw0rd1' }, 't@club.test': { uid: 't', password: 'Passw0rd1' }, 'u1@club.test': { uid: 'u1', password: 'Passw0rd1' }, 'u2@club.test': { uid: 'u2', password: 'Passw0rd1' } };
export async function launch() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  return browser;
}
export async function sessionFor(browser, uid, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ uid, accounts }) => {
    window.__accounts = accounts;
    if (uid && !sessionStorage.getItem('shim-user')) sessionStorage.setItem('shim-user', JSON.stringify({ uid, email: uid + '@club.test' }));
  }, { uid, accounts });
  const serve = body => route => route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  await context.route('**/firebasejs/**/firebase-database.js', serve(databaseShim));
  await context.route('**/firebasejs/**/firebase-app.js', serve(appShim));
  await context.route('**/firebasejs/**/firebase-auth.js', serve(authShim));
  return context;
}
