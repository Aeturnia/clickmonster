// Password recovery, end to end through the real entrance, on the LOCAL Supabase stack only
// (docs/password-recovery-scope.md, R-1). Not part of the test suites: run it by hand after
// `npx supabase start` (with Mailpit). It never contacts the production project or site.
//
//   node tools/recovery-local-check.mjs
//
// It serves public/ on http://127.0.0.1:3000 (the local stack's site_url), answering
// /js/config.js in memory with the local URL and key, and /js/entry.js with "Forgot your
// password?" turned on (as releasing it will). Then, in Chromium, as a player would:
//   ask for a reset -> read the email in local Mailpit -> open its link -> "Choose a new password"
//   -> save -> the game starts; and checks the old password fails and the new one works.
// It creates a local test account and removes it. The local keys are read from `supabase status`
// and are never printed or written.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
const S = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
const API = S.API_URL;
const MAIL = S.MAILPIT_URL || S.INBUCKET_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(String(MAIL))) throw new Error('local stack with Mailpit only');
const SITE = 'http://127.0.0.1:3000';
const RUN = `c${Date.now()}`;
const EMAIL = `${RUN}-player@example.test`;
const OLD = 'local-old-password-1';
const NEW = 'local-new-password-2';
const steps = [];
const step = (s) => { steps.push(s); console.log(`  ok  ${s}`); };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, SITE).pathname);
  if (p === '/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`export const SUPABASE_URL = ${JSON.stringify(API)};\nexport const SUPABASE_KEY = ${JSON.stringify(S.ANON_KEY)};\n`);
    return;
  }
  let file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  let body = fs.readFileSync(file);
  if (p === '/js/entry.js') body = body.toString().replace('const RECOVERY_REQUESTS = false;', 'const RECOVERY_REQUESTS = true;');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(3000, '127.0.0.1', r));

const admin = (p, opts = {}) => fetch(`${API}${p}`, { ...opts, headers: { apikey: S.SERVICE_ROLE_KEY, Authorization: `Bearer ${S.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
const signIn = (password) => fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: S.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }) });
const made = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: OLD, email_confirm: true }) })).json();
if (!made.id) throw new Error('could not create the local test account');

const browser = await chromium.launch();
let failed = null;
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { const u = new URL(r.url()); if (![new URL(SITE).host, new URL(API).host].includes(u.host)) errors.push(`left the local stack: ${u.host}`); });

  await page.goto(`${SITE}/`);
  await page.fill('#email', EMAIL);
  await page.click('#forgot');
  await page.waitForSelector('#recover-form');
  await page.click('#recover-form [type=submit]');
  await page.waitForFunction(() => document.getElementById('gate-h').textContent === 'Check your email');
  step('asked for a reset from the entrance');

  let msg = null;
  for (let i = 0; i < 50 && !msg; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}`)).json();
    if (list.messages?.length) msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
    else await new Promise((r) => setTimeout(r, 200));
  }
  if (!msg) throw new Error('no email in Mailpit');
  step(`email captured by local Mailpit: "${msg.Subject}"`);
  const link = String(msg.HTML).match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');

  await page.goto(link); // GoTrue verifies it and sends the browser back to 127.0.0.1:3000 with the session
  await page.waitForFunction(() => document.getElementById('gate-h').textContent === 'Choose a new password' && document.getElementById('new-password'), null, { timeout: 15000 });
  if (!page.url().startsWith(SITE)) throw new Error(`landed off the local site: ${new URL(page.url()).origin}`);
  if (new URL(page.url()).hash) throw new Error('the token fragment was left in the address');
  if (await page.isVisible('#app')) throw new Error('the game showed before the password was saved');
  step('the link opened "Choose a new password", with the address cleaned and no game');

  await page.reload();
  await page.waitForFunction(() => document.getElementById('gate-h').textContent === 'Choose a new password' && document.getElementById('new-password'), null, { timeout: 15000 });
  if (await page.isVisible('#app')) throw new Error('a reload let the game in');
  step('a reload kept the reset form (the guard)');

  await page.fill('#new-password', NEW);
  await page.fill('#new-password-2', NEW);
  await page.click('#recover-form [type=submit]');
  await page.waitForFunction(() => document.getElementById('entry').hidden || !document.getElementById('app').hidden, null, { timeout: 20000 });
  step('the new password was saved, and the game started');

  if ((await signIn(OLD)).status !== 400) throw new Error('the old password still signs in');
  if ((await signIn(NEW)).status !== 200) throw new Error('the new password does not sign in');
  step('the old password is refused; the new one signs in');
  if (await page.evaluate(() => localStorage.getItem('clickmonster.recovery')) !== null) throw new Error('the guard marker was left behind');
  step('the guard marker is cleared');
  if (errors.length) throw new Error(`page problems: ${errors.join('; ')}`);
  step('no page errors, and nothing left the local stack');
} catch (err) {
  failed = err;
} finally {
  await browser.close();
  server.close();
  await admin(`/auth/v1/admin/users/${made.id}`, { method: 'DELETE' });
}
if (failed) { console.error(`FAILED after ${steps.length} step(s): ${failed.message}`); process.exit(1); }
console.log(`all ${steps.length} steps passed`);
