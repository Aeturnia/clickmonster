// Kingdoms K-1, stage K1-2: the closed-state check through the REAL functions (review qualification
// Q2; docs/kingdoms-k1-plan.md 2.2, section 3). OPT-IN: it runs only with KINGDOMS_EXPECT_CLOSED=1,
// against a local stack started WITHOUT supabase/functions/.env, so the `game` and `admin`
// functions have the shipped configuration (Kingdoms closed). It is skipped otherwise, including
// in CI, whose functions run in the test configuration. The K-1 report records each run.
//
// Kingdoms are closed in the functions themselves, not only in the browser: a direct request for a
// claim, a release, a staff Kingdom change or a staff move into the Kingdom Zone is refused; the
// capability says closed; and a hero found in the Kingdom Zone is moved to the Crossroads and saved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { KINGDOM_ZONE_ID, KINGDOM_GATE } from '../../public/js/data/kingdoms.js';
import { DEFAULT_ZONES } from '../../public/js/data/zones.js';

const SKIP = process.env.KINGDOMS_EXPECT_CLOSED === '1' ? false : 'opt-in: set KINGDOMS_EXPECT_CLOSED=1, with the stack started without supabase/functions/.env';
let API, ANON, SERVICE;
const RUN = `t${Date.now()}`;
const letters = (s) => String(s).replace(/\d/g, (d) => 'abcdefghij'[d]);
const users = {};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (p, opts = {}) => fetch(`${API}${p}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });
async function call(fn, who, action, args = {}) {
  await pause(200);
  const res = await fetch(`${API}/functions/v1/${fn}`, { method: 'POST', headers: headers(users[who].token), body: JSON.stringify({ action, args }) });
  return { status: res.status, body: await res.json() };
}
async function heroRow(who) {
  return (await (await service(`/rest/v1/characters?id=eq.${users[who].charId}&select=id,version,data,zone,x,y`)).json())[0];
}
const CROSSROADS = DEFAULT_ZONES.find((z) => z.id === 'overworld').town;

before(async () => {
  if (SKIP) return;
  const out = execFileSync(npx, ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  assert.match(s.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY;
  for (const who of ['p', 'admin']) {
    const email = `${RUN}-closed-${who}@example.test`;
    const password = 'local-closed-password-1';
    const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json();
    const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) })).json();
    users[who] = { id: made.id, token: tok.access_token };
  }
  const st = await service('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ user_id: users.admin.id, role: 'admin' }), headers: { Prefer: 'return=minimal' } });
  assert.equal(st.status, 201);
  const created = await call('game', 'p', 'create', { name: `Closed p ${letters(String(Date.now()).slice(-6))}`, race: 'human' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  users.p.charId = (await (await service(`/rest/v1/characters?user_id=eq.${users.p.id}&select=id`)).json())[0].id;
});

after(async () => {
  if (SKIP || !SERVICE) return;
  if (users.p?.charId) await service(`/rest/v1/characters?id=eq.${users.p.charId}`, { method: 'DELETE' });
  for (const u of Object.values(users)) await service(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
});

test('Q2: a hero found in the Kingdom Zone is moved to the Crossroads, and the move is saved', { skip: SKIP }, async () => {
  const row = await heroRow('p');
  row.data.loc = { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y };
  row.data.gold = 1000;
  const put = await service(`/rest/v1/characters?id=eq.${row.id}&version=eq.${row.version}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ data: row.data, version: row.version + 1, zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y }),
  });
  assert.equal((await put.json()).length, 1);
  const state = await call('game', 'p', 'state');
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.char.loc, { zone: 'overworld', x: CROSSROADS.x, y: CROSSROADS.y });
  const saved = await heroRow('p');
  assert.deepEqual([saved.zone, saved.x, saved.y], ['overworld', CROSSROADS.x, CROSSROADS.y], 'saved, public columns included');
});

test('Q2: claim and release are refused by the game function', { skip: SKIP }, async () => {
  const claim = await call('game', 'p', 'kingdomClaim', { x: 50, y: 50 });
  assert.equal(claim.status, 400);
  assert.match(claim.body.error, /Kingdoms aren’t open yet/);
  const release = await call('game', 'p', 'kingdomRelease', { plotId: 1 });
  assert.equal(release.status, 400);
  assert.match(release.body.error, /Kingdoms aren’t open yet/);
  const rows = await (await service(`/rest/v1/kingdom_plots?character_id=eq.${users.p.charId}&select=id`)).json();
  assert.deepEqual(rows, []);
});

test('Q2: the admin function reports closed, and refuses every Kingdom change and a move into the Kingdom Zone', { skip: SKIP }, async () => {
  const meta = await call('admin', 'admin', 'meta');
  assert.deepEqual(meta.body.kingdoms, { version: 1, open: false });
  assert.ok(!meta.body.zones.some((z) => z.id === KINGDOM_ZONE_ID), 'the Kingdom Zone is not registered');
  for (const [action, args] of [
    ['kingdomReserve', { x: 50, y: 50, reason: 'closed check' }],
    ['kingdomUnreserve', { x: 50, y: 50, plotId: 1, reason: 'closed check' }],
    ['kingdomRevoke', { x: 50, y: 50, plotId: 1, characterId: users.p.charId, reason: 'closed check' }],
  ]) {
    const res = await call('admin', 'admin', action, args);
    assert.equal(res.status, 409, `${action}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /Kingdoms aren’t open yet/);
  }
  const move = await call('admin', 'admin', 'update', { id: users.p.charId, patch: { loc: { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y } } });
  assert.equal(move.status, 400);
  assert.match(move.body.error, /Invalid location/);
  const read = await call('admin', 'admin', 'kingdomSearch', { q: '' });
  assert.equal(read.status, 200, 'reads still work while closed');
  assert.ok(Array.isArray(read.body.plots));
  assert.equal((await heroRow('p')).zone, 'overworld', 'the hero was not moved');
});
