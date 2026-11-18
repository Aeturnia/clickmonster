// Password recovery, R-1 (docs/password-recovery-scope.md, PR-9): the real flow on the LOCAL
// Supabase stack only (npx supabase start, with Mailpit; then npm run test:db). No external email.
//   - A reset request (/recover) sends the Monstra Regna draft email, captured by local Mailpit.
//   - Its link, followed, comes back to the allowed local address with a recovery session.
//   - The new password is saved through the API with that session; the old one stops working.
//   - Signing out the other sessions revokes their refresh tokens; the recovery session's own stays.
//   - A used link fails, and a redirect off the allow-list is not honoured.
// It creates its own local test account and removes it. The local keys come from `supabase status`
// at run time and are never written anywhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

let API, ANON, SERVICE, MAIL, SITE;
const RUN = `t${Date.now()}`;
const EMAIL = `${RUN}-recovery@example.test`;
const OLD = 'local-old-password-1';
const NEW = 'local-new-password-2';
let userId = null;

const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });
const signIn = (password) => fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email: EMAIL, password }) });
const refresh = (refreshToken) => fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ refresh_token: refreshToken }) });

// Asks for a reset as the entrance does (resetPasswordForEmail: POST /recover?redirect_to=...).
async function askForReset(redirectTo) {
  const res = await fetch(`${API}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email: EMAIL }) });
  assert.equal(res.status, 200, `recover: ${await res.text()}`);
}
// The newest captured email to EMAIL whose id isn't in `seen`, from local Mailpit.
async function newEmail(seen = new Set()) {
  for (let i = 0; i < 50; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}`)).json();
    const m = (list.messages || []).find((x) => !seen.has(x.ID));
    if (m) return (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`no email reached Mailpit for ${EMAIL}`);
}
const linkIn = (message) => {
  const href = String(message.HTML).match(/href="([^"]+)"/)?.[1];
  assert.ok(href, 'the email has a link');
  return href.replace(/&amp;/g, '&');
};
// Follows a link without following its redirect: where it sends the browser.
async function follow(link) {
  const res = await fetch(link, { redirect: 'manual' });
  assert.ok([302, 303].includes(res.status), `the link redirects (got ${res.status})`);
  return res.headers.get('location');
}
const fragment = (location) => new URLSearchParams(new URL(location).hash.slice(1));

before(async () => {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY; MAIL = s.MAILPIT_URL || s.INBUCKET_URL;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  assert.match(String(MAIL), /^http:\/\/127\.0\.0\.1:\d+$/, 'local Mailpit only (start the stack without -x mailpit)');
  SITE = 'http://127.0.0.1:3000/'; // supabase/config.toml site_url: a local address, never the production site
  const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: OLD, email_confirm: true }) })).json();
  assert.ok(made.id, `create the test account: ${JSON.stringify(made).slice(0, 120)}`);
  userId = made.id;
});
after(async () => {
  if (userId) await service(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
});

test('PR-9 the real reset: the draft email, its link, a recovery session, a new password, other sessions signed out', async () => {
  // Another device, signed in with the old password before the reset.
  const other = await (await signIn(OLD)).json();
  assert.ok(other.refresh_token, 'the other device has a session');

  const seen = new Set();
  await askForReset(SITE);
  const email = await newEmail(seen);
  seen.add(email.ID);
  assert.equal(email.Subject, 'Reset your Monstra Regna password', 'the Monstra Regna draft template');
  assert.match(email.HTML, /Choose a new password/);
  assert.doesNotMatch(email.HTML, /<img|https?:\/\/(?!127\.0\.0\.1)/i, 'no images or outside links in the draft');

  // The link comes back to the allowed local address, with a recovery session in the fragment.
  const link = linkIn(email);
  const where = await follow(link);
  assert.ok(where.startsWith(SITE), `back to the local site, not elsewhere: ${where.split('#')[0]}`);
  assert.doesNotMatch(where, /clickmonsters\.netlify\.app/, 'never the production site');
  const f = fragment(where);
  assert.equal(f.get('type'), 'recovery');
  const access = f.get('access_token');
  const ownRefresh = f.get('refresh_token');
  assert.ok(access && ownRefresh, 'a recovery session');

  // Saved with that session, as updateUser() does.
  const upd = await fetch(`${API}/auth/v1/user`, { method: 'PUT', headers: headers(access), body: JSON.stringify({ password: NEW }) });
  assert.equal(upd.status, 200, `update: ${await upd.text()}`);
  assert.equal((await signIn(OLD)).status, 400, 'the old password no longer signs in');
  assert.equal((await signIn(NEW)).status, 200, 'the new one does');

  // Every other session signed out, as signOut({ scope: 'others' }) does.
  const out = await fetch(`${API}/auth/v1/logout?scope=others`, { method: 'POST', headers: headers(access) });
  assert.equal(out.status, 204);
  const otherRefresh = await refresh(other.refresh_token);
  assert.ok([400, 401].includes(otherRefresh.status), `the other device's refresh token is refused (got ${otherRefresh.status})`);
  const ownRenew = await refresh(ownRefresh);
  assert.equal(ownRenew.status, 200, "this browser's own session still renews");

  // The link works once.
  const again = await follow(link);
  const e = fragment(again);
  assert.ok(e.get('error_code') || e.get('error'), `a used link comes back with an error: ${[...e.keys()].join(',')}`);
  assert.equal(e.get('access_token'), null, 'and no session');
});

test('PR-9 a reset asking to return somewhere off the allow-list is sent to the site address instead', async () => {
  const seen = new Set((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}`)).json()).messages?.map((m) => m.ID) || []);
  await new Promise((r) => setTimeout(r, 1100)); // the local per-address limit is one email a second
  await askForReset('https://attacker.example/steal');
  const email = await newEmail(seen);
  const where = await follow(linkIn(email));
  assert.equal(new URL(where).origin, new URL(SITE).origin, `the allow-list wins: ${where.split('#')[0]}`);
  assert.doesNotMatch(where, /attacker\.example/);
});

test('PR-9 an unknown address gets the same answer and no email', async () => {
  const res = await fetch(`${API}/auth/v1/recover?redirect_to=${encodeURIComponent(SITE)}`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email: `${RUN}-nobody@example.test` }) });
  assert.equal(res.status, 200, 'the same answer as for a real account');
  await new Promise((r) => setTimeout(r, 800));
  const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${RUN}-nobody@example.test"`)}`)).json();
  assert.equal((list.messages || []).length, 0, 'no email sent');
});
