// Sign-out and session recovery (docs/sign-out-scope.md): SO-1b and SO-1, on the LOCAL Supabase
// stack only (npx supabase start; then npm run test:db).
//   SO-1b records GoTrue's actual answers, as supabase-js 2.45.4 reports them (the version the
//   browser and the edge functions use): status, error type and error code, for each way a token
//   can stop working. These records (tests/session-answers.mjs) set the session classification
//   rule's list, and its Node test will use them as fixtures. This test checks the answers still
//   match them, so a GoTrue or supabase-js upgrade that changes them fails here.
//   SO-1 checks that signing out with scope=local leaves the account's other session working, and
//   that a late local sign-out with an old token can't end a newer session.
// It creates its own local test accounts and removes them. No token value is printed or stored:
// only statuses, error types and error codes. The local keys come from `supabase status` at run time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { GOTRUE_ANSWERS } from '../session-answers.mjs';

// The vendored browser build, byte-identical to the npm package the functions import
// (public/vendor/README.md), run as a browser would run it: a classic script that defines the
// global `supabase`. It expects a browser's `self`, and resolves its chunk address from a
// worker-style location when it loads. Node has fetch, so no chunk is ever loaded.
globalThis.self ??= globalThis;
globalThis.importScripts ??= () => {};
globalThis.location ??= new URL('http://127.0.0.1/');
vm.runInThisContext(readFileSync(new URL('../../public/vendor/supabase-js@2.45.4/supabase.js', import.meta.url), 'utf8'), { filename: 'supabase.js' });
const { createClient } = globalThis.supabase;

let API, ANON, SERVICE, JWT_SECRET;
const RUN = `t${Date.now()}`;
const PASSWORD = 'local-session-password-1';
const made = [];

const service = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
const anon = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function account(tag) {
  const email = `${RUN}-${tag}@example.test`;
  const u = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) })).json();
  assert.ok(u.id, `create a local test account: ${JSON.stringify(u).slice(0, 120)}`);
  made.push(u.id);
  return { id: u.id, email };
}
// A new session for the account (a new device): its access and refresh tokens, kept in memory only.
async function session(acct) {
  const { data, error } = await anon().auth.signInWithPassword({ email: acct.email, password: PASSWORD });
  assert.equal(error, null, `sign in: ${error?.message}`);
  return { access: data.session.access_token, refresh: data.session.refresh_token };
}
// What supabase-js reports for an error: its type, status and GoTrue error code. Never the token.
const shape = (error) => (error ? { name: error.name, status: error.status ?? null, code: error.code ?? null } : null);
const getUser = async (token) => shape((await anon().auth.getUser(token)).error);
const logout = async (token, scope) => shape((await anon().auth.admin.signOut(token, scope)).error);
const renew = async (refresh) => shape((await anon().auth.refreshSession({ refresh_token: refresh })).error);

// An expired copy of a real access token, signed as the local stack signs (HS256 with its JWT
// secret). Returns null if the stack signs some other way; that case is then reported as not measured.
function expired(token) {
  const [h, p] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  if (header.alg !== 'HS256' || !JWT_SECRET) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  claims.exp = Math.floor(Date.now() / 1000) - 3600;
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(`${h}.${body}`).digest('base64url');
  return `${h}.${body}.${sig}`;
}

before(() => {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY; JWT_SECRET = s.JWT_SECRET;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
});
after(async () => {
  for (const id of made) await service(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
});

test('SO-1b GoTrue\'s answers for each way a token stops working, as supabase-js reports them', async () => {
  const seen = {};
  // A session ended elsewhere: two devices, and the other signs out everywhere.
  const a = await account('ended');
  const device = await session(a);
  const other = await session(a);
  assert.equal(await getUser(device.access), null, 'the session works before');
  assert.equal(await logout(other.access, 'global'), null, 'the other device signs out everywhere');
  seen.endedGetUser = await getUser(device.access);
  seen.endedLogout = await logout(device.access, 'local');
  seen.endedRenew = await renew(device.refresh);

  // An expired token, a malformed one, and none.
  const b = await account('expired');
  const live = await session(b);
  const old = expired(live.access);
  seen.expiredGetUser = old ? await getUser(old) : 'not measured: the stack does not sign with HS256';
  seen.malformedGetUser = await getUser('not-a-jwt');
  seen.noTokenGetUser = await getUser('');

  // A deleted user's token.
  const c = await account('deleted');
  const gone = await session(c);
  await service(`/auth/v1/admin/users/${c.id}`, { method: 'DELETE' });
  made.splice(made.indexOf(c.id), 1);
  seen.deletedGetUser = await getUser(gone.access);

  console.log(`# SO-1b GoTrue answers (supabase-js 2.45.4): ${JSON.stringify(seen)}`);
  // The rule's fixtures must be these answers (tests/session-answers.mjs).
  for (const [k, v] of Object.entries(GOTRUE_ANSWERS)) assert.deepEqual(seen[k], v, `${k} changed: the classification rule must be reviewed`);
});

test('SO-1 signing out with scope=local leaves the account\'s other session working; a late local sign-out with an old token ends only its own', async () => {
  const a = await account('local');
  const phone = await session(a);
  const desktop = await session(a);
  assert.equal(await logout(phone.access, 'local'), null, 'the phone signs out, this device only');
  assert.equal(await getUser(desktop.access), null, 'the desktop is still signed in');
  assert.equal(await renew(desktop.refresh), null, 'and can still renew');
  assert.notEqual(await getUser(phone.access), null, 'the phone\'s session has ended');

  // A late sign-out: an old session's token used after a newer session of the account exists.
  const first = await session(a);
  const newer = await session(a);
  await logout(first.access, 'local');
  assert.equal(await getUser(newer.access), null, 'the newer session is unaffected');
  assert.equal(await renew(newer.refresh), null, 'and can still renew');
});
