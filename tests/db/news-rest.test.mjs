// Public news over the REST API (landing L-3, LAC-14), on the LOCAL Supabase stack only.
//   npx supabase start        (Docker; see supabase/config.toml)
//   npm run test:db           (this file, the admin function tests and the pgTAP tests)
// It reads the local URL and keys from `supabase status`, refuses anything that isn't on
// 127.0.0.1, seeds rows with the local service key, checks what the anonymous key can and can't
// do, and removes what it created.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

let API, ANON, SERVICE;
const RUN = `t${Date.now()}`;
const slug = (s) => `${RUN}-${s}`;

before(() => {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL;
  ANON = s.ANON_KEY;
  SERVICE = s.SERVICE_ROLE_KEY;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
});

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
const rest = (path, { key = ANON, method = 'GET', body, prefer } = {}) => fetch(`${API}/rest/v1/${path}`, {
  method, headers: headers(key, prefer ? { Prefer: prefer } : {}), body: body == null ? undefined : JSON.stringify(body),
});
const PUBLIC_COLS = 'id,slug,kind,title,summary,body,published_at,revised_at,maintenance_starts_at,maintenance_ends_at';

const day = 86400000;
const rows = () => [
  { slug: slug('live'), kind: 'update', title: 'Live article', summary: 'Published and live for everyone.', body: 'Body', status: 'published', published_at: new Date(Date.now() - day).toISOString() },
  { slug: slug('future'), kind: 'update', title: 'Future article', summary: 'Published for a time still to come.', body: 'Body', status: 'published', published_at: new Date(Date.now() + day).toISOString() },
  { slug: slug('draft'), kind: 'update', title: 'Draft article', summary: 'A draft that was never published.', body: 'Body', status: 'draft', published_at: null },
  { slug: slug('pulled'), kind: 'update', title: 'Pulled article', summary: 'Published once and then unpublished.', body: 'Body', status: 'unpublished', published_at: new Date(Date.now() - 2 * day).toISOString() },
];

before(async () => {
  const res = await rest('news', { key: SERVICE, method: 'POST', body: rows(), prefer: 'return=minimal' });
  assert.equal(res.status, 201, `seeding: ${await res.text()}`);
});
after(async () => {
  if (!SERVICE) return;
  // Published rows can't be deleted (the trigger), so unpublish first, then delete everything from this run.
  await rest(`news?slug=like.${RUN}-*&status=eq.published`, { key: SERVICE, method: 'PATCH', body: { status: 'unpublished' }, prefer: 'return=minimal' });
  const res = await rest(`news?slug=like.${RUN}-*`, { key: SERVICE, method: 'DELETE', prefer: 'return=minimal' });
  assert.equal(res.status, 204, 'clean-up');
});

const mine = (list) => list.filter((r) => r.slug.startsWith(RUN)).map((r) => r.slug).sort();

test('anon reads only published rows whose time has passed, with the article columns', async () => {
  const res = await rest(`news?select=${PUBLIC_COLS}&order=published_at.desc`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(mine(list), [slug('live')], 'not the draft, the unpublished entry or the future one');
  const live = list.find((r) => r.slug === slug('live'));
  assert.deepEqual(Object.keys(live).sort(), PUBLIC_COLS.split(',').sort());
});

test('anon asking for a hidden row by its address gets nothing', async () => {
  for (const s of ['draft', 'pulled', 'future']) {
    const res = await rest(`news?select=slug,title&slug=eq.${slug(s)}`);
    assert.equal(res.status, 200, s);
    assert.deepEqual(await res.json(), [], `${s}: not found, the same as an unknown address`);
  }
});

test('anon cannot read the hidden columns, select *, or filter on them', async () => {
  for (const [what, path] of [
    ['select=*', 'news?select=*'],
    ['the default select (all columns)', 'news'],
    ['status', 'news?select=slug,status'],
    ['created_by', 'news?select=slug,created_by'],
    ['updated_by', 'news?select=slug,updated_by'],
    ['created_at', 'news?select=slug,created_at'],
    ['updated_at', 'news?select=slug,updated_at'],
    ['a filter on status', 'news?select=slug&status=eq.draft'],
    ['an order on updated_at', 'news?select=slug&order=updated_at.desc'],
  ]) {
    const res = await rest(path);
    const body = await res.json();
    assert.ok(res.status === 401 || res.status === 403, `${what}: refused (got ${res.status})`);
    assert.equal(body.code, '42501', `${what}: permission denied`);
  }
});

test('anon cannot write: insert, update, upsert and delete are all refused, and nothing changes', async () => {
  const probe = slug('rls-check');
  const attempts = [
    ['insert', rest('news', { method: 'POST', body: { slug: probe, title: 'Anonymous write', summary: 'An anonymous write attempt here.', body: 'x' } })],
    ['upsert', rest('news', { method: 'POST', body: { slug: slug('live'), title: 'Overwritten', summary: 'An anonymous upsert attempt here.', body: 'x' }, prefer: 'resolution=merge-duplicates' })],
    ['update', rest(`news?slug=eq.${slug('live')}`, { method: 'PATCH', body: { title: 'Changed by anon' } })],
    ['delete', rest(`news?slug=eq.${slug('live')}`, { method: 'DELETE' })],
  ];
  for (const [what, p] of attempts) {
    const res = await p;
    const body = await res.json().catch(() => ({}));
    assert.ok(res.status === 401 || res.status === 403, `${what}: refused (got ${res.status})`);
    assert.equal(body.code, '42501', `${what}: permission denied`);
  }
  const check = await (await rest(`news?select=slug,title,status&slug=like.${RUN}-*`, { key: SERVICE })).json();
  assert.equal(check.find((r) => r.slug === slug('live')).title, 'Live article', 'unchanged');
  assert.equal(check.some((r) => r.slug === probe), false, 'no row was created');
  assert.equal(check.length, 4);
});

test('a signed-in player has the same view as the public', async () => {
  const email = `${RUN}@example.test`;
  const password = 'local-test-password-1';
  const sign = await fetch(`${API}/auth/v1/signup`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) });
  const session = await sign.json();
  assert.ok(session.access_token, `local sign-up gives a session: ${JSON.stringify(session).slice(0, 120)}`);
  const asPlayer = (path, opts = {}) => fetch(`${API}/rest/v1/${path}`, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } });
  const list = await (await asPlayer(`news?select=${PUBLIC_COLS}`)).json();
  assert.deepEqual(mine(list), [slug('live')]);
  const star = await asPlayer('news?select=*');
  assert.equal((await star.json()).code, '42501');
  const write = await asPlayer('news', { method: 'POST', body: JSON.stringify({ slug: slug('player'), title: 'Player write', summary: 'A signed-in write attempt here.', body: 'x' }) });
  assert.equal((await write.json()).code, '42501');
  // Remove the local test user.
  const del = await fetch(`${API}/auth/v1/admin/users/${session.user.id}`, { method: 'DELETE', headers: headers(SERVICE) });
  assert.ok(del.ok, 'clean-up of the test user');
});
