// Kingdoms K-1, stage K1-2: claim, release and the staff actions through the REAL `game` and
// `admin` edge functions on the LOCAL Supabase stack only (#83; docs/kingdoms-k1-plan.md 2.2, 5).
//
// The functions must run in the local test configuration (decision 9.1): supabase/functions/.env
// holds KINGDOMS_TEST=1 when the stack starts (CI writes it; CLAUDE.md says how locally). With
// Kingdoms closed these tests fail loudly, unless KINGDOMS_EXPECT_CLOSED=1, which selects the
// closed-state check in kingdoms-closed.test.mjs instead.
//
// It creates local accounts (four players, an admin and a moderator), and removes them afterwards.
// A slow or failing save is made deterministic with test-only triggers, installed and dropped by
// the tests on the local database (never in a migration).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEST_CONFIG, KINGDOM_ZONE_ID, KINGDOM_GATE } from '../../public/js/data/kingdoms.js';

const SKIP = process.env.KINGDOMS_EXPECT_CLOSED === '1' ? 'KINGDOMS_EXPECT_CLOSED=1: the closed-state check runs instead' : false;
let API, ANON, SERVICE, DB_URL;
const RUN = `t${Date.now()}`;
const letters = (s) => String(s).replace(/\d/g, (d) => 'abcdefghij'[d]);
const users = {};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (p, opts = {}) => fetch(`${API}${p}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });

async function game(who, action, args = {}, { wait = true } = {}) {
  if (wait) await pause(200); // the function refuses fast actions closer than 150 ms apart
  const res = await fetch(`${API}/functions/v1/game`, { method: 'POST', headers: headers(users[who].token), body: JSON.stringify({ action, args }) });
  return { status: res.status, body: await res.json() };
}
async function staffCall(who, action, args = {}) {
  const res = await fetch(`${API}/functions/v1/admin`, { method: 'POST', headers: headers(users[who].token), body: JSON.stringify({ action, args }) });
  return { status: res.status, body: await res.json() };
}

// One SQL statement on the local database (asserted to be 127.0.0.1 in before()), through a file.
function sql(statement) {
  const file = path.join(os.tmpdir(), `${RUN}-kingdoms-test.sql`);
  fs.writeFileSync(file, statement);
  try {
    return execFileSync(npx, ['--no-install', 'supabase', 'db', 'query', '--db-url', DB_URL, '--file', file],
      { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { fs.rmSync(file, { force: true }); }
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
function dropTriggers() {
  sql(`do $do$ begin
    execute 'drop trigger if exists zz_test_skip_save on public.characters';
    execute 'drop trigger if exists zz_test_slow_claim on public.pending_rewards';
    execute 'drop function if exists public.zz_test_skip_save()';
    execute 'drop function if exists public.zz_test_slow_claim()';
  end $do$`);
}
// The hero's save updates no row: what a changed version produces (MRVER, 409).
function skipSaves(charId) {
  sql(`do $do$ begin
    execute 'create or replace function public.zz_test_skip_save() returns trigger language plpgsql as $f$ begin if new.id = ' || ${q(q(charId))} || '::uuid then return null; end if; return new; end $f$';
    execute 'create trigger zz_test_skip_save before update on public.characters for each row execute function public.zz_test_skip_save()';
  end $do$`);
}
// The reward claim, the first step of save_hero_with_rewards(), waits before it runs. The hero's
// row isn't locked yet, so another transaction can change the hero meanwhile.
function slowClaims(charId, seconds) {
  sql(`do $do$ begin
    execute 'create or replace function public.zz_test_slow_claim() returns trigger language plpgsql as $f$ begin if new.character_id = ' || ${q(q(charId))} || '::uuid then perform pg_sleep(${Number(seconds)}); end if; return new; end $f$';
    execute 'create trigger zz_test_slow_claim before update on public.pending_rewards for each row execute function public.zz_test_slow_claim()';
  end $do$`);
}

async function heroRow(who) {
  const res = await service(`/rest/v1/characters?id=eq.${users[who].charId}&select=id,version,data,zone,x,y,updated_at`);
  return (await res.json())[0];
}
// Change a hero's saved state directly (the test's setup), with a version bump like a real save.
async function setHero(who, mutate) {
  const row = await heroRow(who);
  mutate(row.data);
  const res = await service(`/rest/v1/characters?id=eq.${row.id}&version=eq.${row.version}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ data: row.data, version: row.version + 1, zone: row.data.loc.zone, x: row.data.loc.x, y: row.data.loc.y, level: row.data.level }),
  });
  assert.equal((await res.json()).length, 1, 'test setup saved the hero');
}
const toGate = (who, gold = 1000) => setHero(who, (c) => {
  c.loc = { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y };
  c.battle = null; c.gold = gold; c.lastActionAt = 0;
});
async function plotAt(x, y) {
  return (await (await service(`/rest/v1/kingdom_plots?x=eq.${x}&y=eq.${y}&select=id,x,y,status,character_id`)).json())[0] || null;
}
async function plotsOf(who) {
  return (await (await service(`/rest/v1/kingdom_plots?character_id=eq.${users[who].charId}&select=id,x,y,status`)).json());
}
async function addReward(who, fields) {
  const res = await service('/rest/v1/pending_rewards', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ character_id: users[who].charId, source: 'hunt', gold: 0, xp: 0, items: [], gems: {}, note: 'Kingdom test reward', ...fields }),
  });
  const rows = await res.json();
  assert.equal(rows.length, 1, `reward inserted: ${JSON.stringify(rows).slice(0, 120)}`);
  return rows[0].id;
}
const reward = async (id) => (await (await service(`/rest/v1/pending_rewards?id=eq.${id}&select=id,claimed_at`)).json())[0];
async function ledgerOf(source) {
  const rows = await (await service(`/rest/v1/ledger?source=eq.${encodeURIComponent(source)}&select=amount,count`)).json();
  return rows.reduce((a, r) => ({ amount: a.amount + Number(r.amount), count: a.count + Number(r.count) }), { amount: 0, count: 0 });
}
// This run's audit entries only: every reason this file sends starts with RUN.
async function auditCount(action, x, y) {
  const rows = await (await service(`/rest/v1/admin_log?action=eq.${encodeURIComponent(action)}&details->>x=eq.${x}&details->>y=eq.${y}&details->>reason=like.${RUN}*&select=id`)).json();
  return rows.length;
}
// Free one of this file's plots between tests, whatever holds it, as the table owner.
async function clearPlots(...coords) {
  for (const [x, y] of coords) await service(`/rest/v1/kingdom_plots?x=eq.${x}&y=eq.${y}`, { method: 'DELETE' });
}
// The plots this file uses: far from anything else, so nothing else is touched.
const P = (n) => [80 + (n % 10), 80 + Math.floor(n / 10)];

before(async () => {
  if (SKIP) return;
  const out = execFileSync(npx, ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  assert.match(s.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  assert.match(s.DB_URL, /@127\.0\.0\.1:\d+\//, 'local database only');
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY; DB_URL = s.DB_URL;
  dropTriggers();
  for (const who of ['a', 'b', 'c', 'd', 'admin', 'mod']) {
    const email = `${RUN}-kingdom-${who}@example.test`;
    const password = 'local-kingdom-password-1';
    const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json();
    assert.ok(made.id, `create user: ${JSON.stringify(made).slice(0, 120)}`);
    const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) })).json();
    users[who] = { id: made.id, token: tok.access_token };
    if (who === 'admin' || who === 'mod') {
      const st = await service('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ user_id: made.id, role: who === 'admin' ? 'admin' : 'moderator' }), headers: { Prefer: 'return=minimal' } });
      assert.equal(st.status, 201, `staff row for ${who}`);
      continue;
    }
    const created = await game(who, 'create', { name: `Kingdom ${who} ${letters(String(Date.now()).slice(-6))}`, race: 'human' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const rows = await (await service(`/rest/v1/characters?user_id=eq.${made.id}&select=id`)).json();
    users[who].charId = rows[0].id;
  }
  // The functions must be in the local test configuration (decision 9.1), or nothing here applies.
  await toGate('a');
  const probe = await game('a', 'state');
  assert.equal(probe.status, 200);
  assert.equal(probe.body.char.loc.zone, KINGDOM_ZONE_ID,
    'Kingdoms are closed in the local functions: start the stack with supabase/functions/.env holding KINGDOMS_TEST=1 (CLAUDE.md)');
});

afterEach(() => { if (!SKIP) dropTriggers(); });

after(async () => {
  if (SKIP || !SERVICE) return;
  try { dropTriggers(); } catch { /* the stack may be gone */ }
  for (const u of Object.values(users)) {
    if (u.charId) await service(`/rest/v1/characters?id=eq.${u.charId}`, { method: 'DELETE' }); // cascades to plots
    await service(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }
  await clearPlots(...Array.from({ length: 30 }, (_, n) => P(n)));
});

// ------------------------------------------------------------ claim
test('K-1 a claim takes the plot, records the Kingdom, and ledgers the cost once, after the commit', { skip: SKIP }, async () => {
  const [x, y] = P(0);
  await clearPlots([x, y]);
  await toGate('a', 1000);
  const ledger = await ledgerOf('kingdom');
  const res = await game('a', 'kingdomClaim', { x, y });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.char.kingdom.plot, { x, y });
  assert.equal(res.body.char.gold, 1000 - TEST_CONFIG.cost);
  const plot = await plotAt(x, y);
  assert.equal(plot.character_id, users.a.charId);
  assert.equal(plot.status, 'claimed');
  const row = await heroRow('a');
  assert.deepEqual(row.data.kingdom.plot, { x, y }, 'saved with the plot (I-1)');
  const after = await ledgerOf('kingdom');
  assert.equal(after.amount - ledger.amount, -TEST_CONFIG.cost);
  assert.equal(after.count - ledger.count, 1);
  // A retried claim changes nothing more.
  const again = await game('a', 'kingdomClaim', { x, y });
  assert.notEqual(again.status, 200);
  assert.equal((await heroRow('a')).data.gold, 1000 - TEST_CONFIG.cost, 'charged once');
  assert.equal((await plotsOf('a')).length, 1);
});

test('K-2 two heroes claiming one plot at once: exactly one gets it', { skip: SKIP }, async () => {
  const [x, y] = P(1);
  await clearPlots([x, y]);
  await toGate('b', 1000);
  await toGate('c', 1000);
  await pause(200);
  const [rb, rc] = await Promise.all([
    game('b', 'kingdomClaim', { x, y }, { wait: false }),
    game('c', 'kingdomClaim', { x, y }, { wait: false }),
  ]);
  const won = [rb, rc].filter((r) => r.status === 200);
  const lost = [rb, rc].filter((r) => r.status !== 200);
  assert.equal(won.length, 1, `one winner: ${JSON.stringify([rb.body, rc.body]).slice(0, 300)}`);
  assert.equal(lost[0].status, 409);
  assert.equal(lost[0].body.reason, 'plot_taken');
  const loser = rb.status === 200 ? 'c' : 'b';
  const row = await heroRow(loser);
  assert.equal(row.data.kingdom, undefined, 'the loser has no Kingdom');
  assert.equal(row.data.gold, 1000, 'and paid nothing');
  assert.equal((await plotsOf(loser)).length, 0);
  // Free both for the next tests.
  for (const who of ['b', 'c']) await setHero(who, (c) => { delete c.kingdom; });
  await clearPlots([x, y]);
});

test('K-3 one hero claiming from two tabs at once: one plot, charged once', { skip: SKIP }, async () => {
  const [x1, y1] = P(2), [x2, y2] = P(3);
  await clearPlots([x1, y1], [x2, y2]);
  await toGate('b', 1000);
  await pause(200);
  const [r1, r2] = await Promise.all([
    game('b', 'kingdomClaim', { x: x1, y: y1 }, { wait: false }),
    game('b', 'kingdomClaim', { x: x2, y: y2 }, { wait: false }),
  ]);
  assert.equal([r1, r2].filter((r) => r.status === 200).length, 1, JSON.stringify([r1.body, r2.body]).slice(0, 300));
  assert.ok([r1, r2].some((r) => r.status === 409 || r.status === 429), 'the other is refused');
  assert.equal((await plotsOf('b')).length, 1, 'one plot');
  assert.equal((await heroRow('b')).data.gold, 1000 - TEST_CONFIG.cost, 'charged once');
  await setHero('b', (c) => { delete c.kingdom; });
  await clearPlots([x1, y1], [x2, y2]);
});

test('K-4 a claim whose save conflicts (stale version) leaves no plot and charges nothing', { skip: SKIP }, async () => {
  const [x, y] = P(4);
  await clearPlots([x, y]);
  await toGate('c', 1000);
  const ledger = await ledgerOf('kingdom');
  skipSaves(users.c.charId);
  const res = await game('c', 'kingdomClaim', { x, y });
  dropTriggers();
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(await plotAt(x, y), null, 'no plot claimed');
  const row = await heroRow('c');
  assert.equal(row.data.kingdom, undefined);
  assert.equal(row.data.gold, 1000);
  assert.deepEqual(await ledgerOf('kingdom'), ledger, 'a failed claim writes no ledger entry');
});

test('K-5 a claim with staged rewards claims them in the same transaction, delivered once (#102 case 7)', { skip: SKIP }, async () => {
  const [x, y] = P(5);
  await clearPlots([x, y]);
  await toGate('c', 1000);
  const id = await addReward('c', { gold: 77 });
  const res = await game('c', 'kingdomClaim', { x, y });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok((await reward(id)).claimed_at, 'claimed with the claim');
  const row = await heroRow('c');
  const wealth = (row.data.gold || 0) + (row.data.bank || 0);
  assert.equal(wealth, 1000 - TEST_CONFIG.cost + 77, 'the reward is delivered with the claim');
  const again = await game('c', 'state');
  assert.equal((again.body.char.gold || 0) + (again.body.char.bank || 0), wealth, 'and only once');
});

test('K-6 a claim refused by the database leaves staged rewards pending, delivered once later', { skip: SKIP }, async () => {
  // Hero c holds P(5) from K-5. Hero d tries to claim it.
  const [x, y] = P(5);
  await toGate('d', 1000);
  const id = await addReward('d', { gold: 55 });
  const res = await game('d', 'kingdomClaim', { x, y });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.reason, 'plot_taken');
  assert.equal((await reward(id)).claimed_at, null, 'the reward stays pending');
  const row = await heroRow('d');
  assert.equal(row.data.gold, 1000, 'nothing charged');
  const state = await game('d', 'state');
  assert.ok((await reward(id)).claimed_at, 'delivered by the next request');
  assert.equal((state.body.char.gold || 0) + (state.body.char.bank || 0), 1055);
});

test('K-7 claiming and releasing are refused outside the Kingdom Zone; walking in it is refused', { skip: SKIP }, async () => {
  await toGate('d', 1000);
  const walk = await game('d', 'walk', { x: 5, y: 5 });
  assert.equal(walk.status, 400);
  assert.match(walk.body.error, /plot map/);
  await setHero('d', (c) => { c.loc = { zone: 'overworld', x: 4, y: 4 }; c.lastActionAt = 0; });
  const [x, y] = P(6);
  const res = await game('d', 'kingdomClaim', { x, y });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Travel to the Kingdom Lands/);
  assert.equal(await plotAt(x, y), null);
});

// ------------------------------------------------------------ release
test('K-8 release: the plot named is freed; a stale release naming an older Kingdom is refused (MRSTL)', { skip: SKIP }, async () => {
  const [x1, y1] = P(7), [x2, y2] = P(8);
  await clearPlots([x1, y1], [x2, y2]);
  await toGate('d', 1000);
  assert.equal((await game('d', 'kingdomClaim', { x: x1, y: y1 })).status, 200);
  const first = (await plotAt(x1, y1)).id;
  const rid = await addReward('d', { gold: 11 });
  const released = await game('d', 'kingdomRelease', { plotId: first });
  assert.equal(released.status, 200, JSON.stringify(released.body));
  assert.equal(released.body.char.kingdom, undefined);
  assert.equal(await plotAt(x1, y1), null, 'freed');
  assert.ok((await reward(rid)).claimed_at, 'the staged reward is claimed with the release');
  // Claim again, then send the release the player confirmed earlier, naming the first Kingdom.
  assert.equal((await game('d', 'kingdomClaim', { x: x2, y: y2 })).status, 200);
  const second = await plotAt(x2, y2);
  assert.notEqual(second.id, first);
  const stale = await game('d', 'kingdomRelease', { plotId: first });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.reason, 'plot_changed');
  assert.ok(await plotAt(x2, y2), 'the new Kingdom is intact');
  assert.deepEqual((await heroRow('d')).data.kingdom.plot, { x: x2, y: y2 });
  // A release without a valid plot id is refused, not looked up.
  for (const plotId of [undefined, null, 0, -1, 1.5, 'x', Number.MAX_SAFE_INTEGER + 2]) {
    const bad = await game('d', 'kingdomRelease', plotId === undefined ? {} : { plotId });
    assert.equal(bad.status, 400, `plotId ${plotId}`);
  }
  assert.ok(await plotAt(x2, y2), 'still intact');
});

test('K-9 a retried release changes nothing more', { skip: SKIP }, async () => {
  const [x, y] = P(8); // hero d's Kingdom from K-8
  const id = (await plotAt(x, y)).id;
  assert.equal((await game('d', 'kingdomRelease', { plotId: id })).status, 200);
  const before = await heroRow('d');
  const again = await game('d', 'kingdomRelease', { plotId: id });
  assert.notEqual(again.status, 200);
  const after = await heroRow('d');
  assert.equal(after.version, before.version, 'nothing saved');
  assert.equal(await plotAt(x, y), null);
});

// ------------------------------------------------------------ a revoke between a read and a save
test('K-10 a revoke between a game read and its save: the save fails with 409, and the Kingdom is not written back', { skip: SKIP }, async () => {
  const [x, y] = P(9);
  await clearPlots([x, y]);
  await toGate('b', 1000);
  assert.equal((await game('b', 'kingdomClaim', { x, y })).status, 200);
  const plot = await plotAt(x, y);
  const rid = await addReward('b', { gold: 5 }); // so the save goes through save_hero_with_rewards()
  slowClaims(users.b.charId, 3);
  await pause(200);
  const pending = game('b', 'dismiss', {}, { wait: false }); // reads the hero, then waits in the save
  await pause(1200);
  const { error } = await (await service('/rest/v1/rpc/kingdom_revoke', {
    method: 'POST',
    body: JSON.stringify({ p_x: x, p_y: y, p_plot_id: plot.id, p_character_id: users.b.charId, p_staff: null, p_staff_name: 'test', p_reason: 'K-10' }),
  })).json().then((v) => ({ error: v?.code ? v : null }));
  assert.equal(error, null, 'the revoke committed while the game request waited');
  const res = await pending;
  assert.equal(res.status, 409, JSON.stringify(res.body));
  const row = await heroRow('b');
  assert.equal(row.data.kingdom, undefined, 'the Kingdom is not written back');
  assert.equal(await plotAt(x, y), null);
  assert.equal((await reward(rid)).claimed_at, null, 'and the staged reward stays pending');
});

// ------------------------------------------------------------ location corrections are saved (K1-B04)
test('K-11 a state read saves a location correction: away from the gate, and from a deleted zone', { skip: SKIP }, async () => {
  await setHero('a', (c) => { c.loc = { zone: KINGDOM_ZONE_ID, x: 40, y: 40 }; });
  const before = await heroRow('a');
  assert.deepEqual([before.zone, before.x, before.y], [KINGDOM_ZONE_ID, 40, 40]);
  const res = await game('a', 'state');
  assert.equal(res.status, 200);
  const after = await heroRow('a');
  assert.deepEqual([after.zone, after.x, after.y], [KINGDOM_ZONE_ID, KINGDOM_GATE.x, KINGDOM_GATE.y], 'the public columns');
  assert.deepEqual(after.data.loc, { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y });
  assert.equal(after.version, before.version + 1, 'one versioned save');
  // A zone that no longer exists: the hero goes home, and that is saved too.
  await setHero('a', (c) => { c.loc = { zone: 'no-such-zone', x: 3, y: 3 }; });
  const gone = await heroRow('a');
  await game('a', 'state');
  const home = await heroRow('a');
  assert.notEqual(home.zone, 'no-such-zone');
  assert.equal(home.version, gone.version + 1);
  // A read with nothing to correct doesn't save.
  await game('a', 'state');
  assert.equal((await heroRow('a')).version, home.version);
});

// ------------------------------------------------------------ the admin function
test('K-12 admin: meta reports the Kingdoms capability; a moderator can read but not change', { skip: SKIP }, async () => {
  const meta = await staffCall('admin', 'meta');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.kingdoms, { version: 1, open: true });
  assert.ok(meta.body.zones.some((z) => z.id === KINGDOM_ZONE_ID), 'the Kingdom Zone is registered while open');
  const [x, y] = P(5); // hero c's plot
  const read = await staffCall('mod', 'kingdomPlot', { x, y });
  assert.equal(read.status, 200);
  assert.equal(read.body.plot.character_id, users.c.charId);
  const plot = read.body.plot;
  const refused = await staffCall('mod', 'kingdomRevoke', { x, y, plotId: plot.id, characterId: plot.character_id, reason: 'test' });
  assert.equal(refused.status, 403);
  assert.equal((await staffCall('mod', 'kingdomReserve', { x: 99, y: 99, reason: 'test' })).status, 403);
  assert.ok(await plotAt(x, y), 'unchanged');
  const found = await staffCall('mod', 'kingdomSearch', { q: 'Kingdom c' });
  assert.equal(found.status, 200);
  assert.ok(found.body.plots.some((p) => p.id === plot.id && p.owner?.id === users.c.charId));
});

test('K-13 the Kingdom functions are refused to players and anon through the REST API', { skip: SKIP }, async () => {
  for (const [token, key] of [[users.a.token, ANON], [ANON, ANON]]) {
    const res = await fetch(`${API}/rest/v1/rpc/kingdom_revoke`, {
      method: 'POST', headers: headers(token, key),
      body: JSON.stringify({ p_x: 1, p_y: 1, p_plot_id: 1, p_character_id: users.a.charId, p_staff: null, p_staff_name: 'x', p_reason: 'x' }),
    });
    const body = await res.json();
    assert.equal(body.code, '42501', JSON.stringify(body));
  }
});

test('K-14 admin reserve and unreserve: one audit entry each; an old unreserve after a re-reserve is refused', { skip: SKIP }, async () => {
  const [x, y] = P(10);
  await clearPlots([x, y]);
  const r1 = await staffCall('admin', 'kingdomReserve', { x, y, reason: `${RUN} keep back` });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal((await plotAt(x, y)).status, 'reserved');
  assert.equal(await auditCount('kingdom:reserve', x, y), 1);
  assert.equal((await staffCall('admin', 'kingdomUnreserve', { x, y, plotId: r1.body.plotId, reason: `${RUN} free` })).status, 200);
  assert.equal(await plotAt(x, y), null);
  assert.equal(await auditCount('kingdom:unreserve', x, y), 1);
  const r2 = await staffCall('admin', 'kingdomReserve', { x, y, reason: `${RUN} again` });
  const stale = await staffCall('admin', 'kingdomUnreserve', { x, y, plotId: r1.body.plotId, reason: `${RUN} old request` });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal((await plotAt(x, y)).id, r2.body.plotId, 'the new reservation stays');
  assert.equal(await auditCount('kingdom:unreserve', x, y), 1, 'no audit entry for the refusal');
  assert.equal((await staffCall('admin', 'kingdomUnreserve', { x, y, reason: `${RUN} no id` })).status, 400);
  await clearPlots([x, y]);
});

test('K-15 admin revoke: an exact refund above 2^31, ledgered once after the commit; stale and retried revokes change nothing', { skip: SKIP }, async () => {
  const [x, y] = P(5); // hero c's plot
  const plot = await plotAt(x, y);
  const finishAt = Date.now() + 3600000;
  await setHero('c', (c) => { c.kingdom.construction = { finishAt, paid: { gold: 3000000007 } }; });
  const gold = (await heroRow('c')).data.gold;
  const ledger = await ledgerOf('kingdom');
  // A stale revoke first: the right plot, an instance id that isn't this one.
  const stale = await staffCall('admin', 'kingdomRevoke', { x, y, plotId: plot.id + 100000, characterId: users.c.charId, reason: `${RUN} stale` });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.deepEqual(await ledgerOf('kingdom'), ledger, 'no ledger entry for a refused revoke');
  const res = await staffCall('admin', 'kingdomRevoke', { x, y, plotId: plot.id, characterId: users.c.charId, reason: `${RUN} test refund` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.refund, 3000000007, 'returned exactly');
  const row = await heroRow('c');
  assert.equal(row.data.kingdom, undefined);
  assert.equal(row.data.gold, gold + 3000000007, 'added exactly');
  const after = await ledgerOf('kingdom');
  assert.equal(after.amount - ledger.amount, 3000000007, 'ledgered exactly');
  assert.equal(after.count - ledger.count, 1, 'once');
  assert.equal(await auditCount('kingdom:revoke', x, y), 1);
  const retry = await staffCall('admin', 'kingdomRevoke', { x, y, plotId: plot.id, characterId: users.c.charId, reason: `${RUN} test refund` });
  assert.equal(retry.status, 409);
  assert.deepEqual(await ledgerOf('kingdom'), after, 'a retried revoke writes no ledger entry');
  assert.equal(await auditCount('kingdom:revoke', x, y), 1);
});

test('K-16 admin: the hero editor moves a hero into the Kingdom Lands only to the gate; hunts there are refused', { skip: SKIP }, async () => {
  const bad = await staffCall('admin', 'update', { id: users.d.charId, patch: { loc: { zone: KINGDOM_ZONE_ID, x: 5, y: 5 } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /only stand at the gate/);
  const good = await staffCall('admin', 'update', { id: users.d.charId, patch: { loc: { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y } } });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  const hunt = await staffCall('admin', 'startHunt', { zone: KINGDOM_ZONE_ID, name: 'Not here', level: 1, hp: 1000, hours: 1 });
  assert.equal(hunt.status, 400);
  assert.match(hunt.body.error, /Kingdom Lands/);
});

// ------------------------------------------------------------ the invariant, after everything above
test('K-17 the I-1 check finds no exception among this file\'s heroes', { skip: SKIP }, async () => {
  const out = execFileSync(npx, ['--no-install', 'supabase', 'db', 'query', '--db-url', DB_URL, '--output-format', 'json',
    '--file', path.resolve('supabase/checks/kingdom_verify.sql')], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const mine = new Set(Object.values(users).map((u) => u.charId).filter(Boolean));
  const start = Math.min(...['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0));
  const parsed = JSON.parse(out.slice(start, Math.max(out.lastIndexOf(']'), out.lastIndexOf('}')) + 1));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  assert.deepEqual(rows.filter((r) => mine.has(r.character_id)), []);
});
