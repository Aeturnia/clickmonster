// Pending rewards delivered exactly once (#102, stage 2; docs/pending-rewards-scope.md, section 6).
// The real `game` edge function on the LOCAL Supabase stack only: npx supabase start, then
// npm run test:db. It creates two local test accounts and heroes, and removes them afterwards.
//
// A failing save is made deterministic with a test-only trigger, installed and dropped by each test
// on the local database (never in a migration):
//   - "skip": a BEFORE UPDATE trigger that returns NULL for one hero, so the save updates no row,
//     exactly as when the version has changed (the ordinary save answers 409; the atomic save raises
//     MRVER, which the function maps to 409);
//   - "raise": the same trigger raising an error (a save that fails outright: 500);
//   - "skip claims": the same on pending_rewards, so the claim updates no row (MRREW, 409).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let API, ANON, SERVICE, DB_URL;
const RUN = `t${Date.now()}`;
const letters = (s) => String(s).replace(/\d/g, (d) => 'abcdefghij'[d]);
const users = {};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function game(who, action, args = {}, { wait = true } = {}) {
  if (wait) await pause(200); // the function refuses fast actions closer than 150 ms apart
  const res = await fetch(`${API}/functions/v1/game`, { method: 'POST', headers: headers(users[who].token), body: JSON.stringify({ action, args }) });
  return { status: res.status, body: await res.json() };
}

// One SQL statement on the local database (asserted to be 127.0.0.1 in before()). It goes through
// a file, so no shell ever sees the SQL (npx runs through the shell on Windows).
function sql(statement) {
  const file = path.join(os.tmpdir(), `${RUN}-rewards-test.sql`);
  fs.writeFileSync(file, statement);
  try {
    return execFileSync(npx, ['--no-install', 'supabase', 'db', 'query', '--db-url', DB_URL, '--file', file],
      { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { fs.rmSync(file, { force: true }); }
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function skipSaves(charId) {
  sql(`do $do$ begin
    execute 'create or replace function public.zz_test_skip_save() returns trigger language plpgsql as $f$ begin if new.id = ' || ${q(q(charId))} || '::uuid then return null; end if; return new; end $f$';
    execute 'create trigger zz_test_skip_save before update on public.characters for each row execute function public.zz_test_skip_save()';
  end $do$`);
}
function raiseSaves(charId) {
  sql(`do $do$ begin
    execute 'create or replace function public.zz_test_raise_save() returns trigger language plpgsql as $f$ begin if new.id = ' || ${q(q(charId))} || '::uuid then raise exception ''test: save refused''; end if; return new; end $f$';
    execute 'create trigger zz_test_raise_save before update on public.characters for each row execute function public.zz_test_raise_save()';
  end $do$`);
}
function skipClaims(charId) {
  sql(`do $do$ begin
    execute 'create or replace function public.zz_test_skip_claim() returns trigger language plpgsql as $f$ begin if new.character_id = ' || ${q(q(charId))} || '::uuid then return null; end if; return new; end $f$';
    execute 'create trigger zz_test_skip_claim before update on public.pending_rewards for each row execute function public.zz_test_skip_claim()';
  end $do$`);
}
function dropTriggers() {
  sql(`do $do$ begin
    execute 'drop trigger if exists zz_test_skip_save on public.characters';
    execute 'drop trigger if exists zz_test_raise_save on public.characters';
    execute 'drop trigger if exists zz_test_skip_claim on public.pending_rewards';
    execute 'drop function if exists public.zz_test_skip_save()';
    execute 'drop function if exists public.zz_test_raise_save()';
    execute 'drop function if exists public.zz_test_skip_claim()';
  end $do$`);
}

async function heroRow(who) {
  const res = await service(`/rest/v1/characters?id=eq.${users[who].charId}&select=id,version,data`);
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
async function addReward(who, fields) {
  const res = await service('/rest/v1/pending_rewards', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ character_id: users[who].charId, source: 'hunt', gold: 0, xp: 0, items: [], gems: {}, note: 'Test reward', ...fields }),
  });
  const rows = await res.json();
  assert.equal(rows.length, 1, `reward inserted: ${JSON.stringify(rows).slice(0, 120)}`);
  return rows[0].id;
}
async function reward(id) {
  return (await (await service(`/rest/v1/pending_rewards?id=eq.${id}&select=id,claimed_at`)).json())[0];
}
async function clearOpenRewards(who) {
  await service(`/rest/v1/pending_rewards?character_id=eq.${users[who].charId}&claimed_at=is.null`, { method: 'DELETE' });
}
async function ledgerTotal(source) {
  const rows = await (await service(`/rest/v1/ledger?source=eq.${encodeURIComponent(source)}&select=amount`)).json();
  return rows.reduce((a, r) => a + Number(r.amount), 0);
}
const wealth = (c) => (c.gold || 0) + (c.bank || 0);

before(async () => {
  const out = execFileSync(npx, ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY; DB_URL = s.DB_URL;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  assert.match(DB_URL, /@127\.0\.0\.1:\d+\//, 'local database only');
  dropTriggers();
  for (const who of ['a', 'b']) {
    const email = `${RUN}-rewards-${who}@example.test`;
    const password = 'local-rewards-password-1';
    const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json();
    assert.ok(made.id, `create user: ${JSON.stringify(made).slice(0, 120)}`);
    const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) })).json();
    users[who] = { id: made.id, token: tok.access_token };
    const created = await game(who, 'create', { name: `Reward ${who} ${letters(String(Date.now()).slice(-6))}`, race: 'human' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const rows = await (await service(`/rest/v1/characters?user_id=eq.${made.id}&select=id`)).json();
    users[who].charId = rows[0].id;
  }
});

afterEach(() => dropTriggers());

after(async () => {
  if (!SERVICE) return;
  try { dropTriggers(); } catch { /* the stack may be gone */ }
  for (const u of Object.values(users)) {
    await service(`/rest/v1/characters?user_id=eq.${u.id}`, { method: 'DELETE' });
    await service(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }
});

// ------------------------------------------------------------ #102's cases (each fails on the old code)

test('PR-1 an action refused with 429 leaves the reward pending, then it is delivered once', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => { c.lastActionAt = Date.now() + 60000; }); // every fast action is refused for a minute
  const id = await addReward('a', { gold: 111, note: 'PR-1 reward' });
  const before = wealth((await heroRow('a')).data);
  const refused = await game('a', 'move', { dir: 'n' });
  assert.equal(refused.status, 429, JSON.stringify(refused.body));
  assert.equal((await reward(id)).claimed_at, null, 'the refused request claimed nothing');
  assert.equal(wealth((await heroRow('a')).data), before);
  await setHero('a', (c) => { c.lastActionAt = 0; });
  const state = await game('a', 'state');
  assert.equal(state.status, 200);
  assert.equal(wealth(state.body.char), before + 111, 'delivered on the next request');
  assert.ok((await reward(id)).claimed_at, 'and claimed with it');
  const again = await game('a', 'state');
  assert.equal(wealth(again.body.char), before + 111, 'and only once');
});

test('PR-2 an action refused by a rule violation leaves the reward pending', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => { c.hp = 999999; c.battle = null; }); // at full health (and more): healing is refused
  const id = await addReward('a', { gold: 122, note: 'PR-2 reward' });
  const refused = await game('a', 'heal');
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal((await reward(id)).claimed_at, null);
  const state = await game('a', 'state');
  assert.ok((await reward(id)).claimed_at, 'delivered on the next request');
  assert.ok(state.body.char.notices.some((n) => n.text.startsWith('PR-2 reward')));
});

test('PR-3 an action whose save conflicts answers 409 and leaves the reward pending', async () => {
  await clearOpenRewards('a');
  const id = await addReward('a', { gold: 133, note: 'PR-3 reward' });
  const before = (await heroRow('a')).version;
  skipSaves(users.a.charId);
  const res = await game('a', 'dismiss');
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Your hero was busy — try again.');
  assert.equal(res.body.char, undefined, 'no hero state is returned');
  dropTriggers();
  assert.equal((await reward(id)).claimed_at, null);
  assert.equal((await heroRow('a')).version, before);
  await game('a', 'state');
  assert.ok((await reward(id)).claimed_at, 'delivered once the save can commit');
});

test('PR-4 a state read whose save conflicts answers 409 and leaves the reward pending', async () => {
  await clearOpenRewards('a');
  const id = await addReward('a', { gold: 144, note: 'PR-4 reward' });
  skipSaves(users.a.charId);
  const res = await game('a', 'state');
  assert.equal(res.status, 409, JSON.stringify(res.body));
  dropTriggers();
  assert.equal((await reward(id)).claimed_at, null);
  const ok = await game('a', 'state');
  assert.equal(ok.status, 200);
  assert.ok((await reward(id)).claimed_at);
});

test('PR-4b a state read whose save fails outright (500) leaves the reward pending', async () => {
  await clearOpenRewards('a');
  const id = await addReward('a', { gold: 145, note: 'PR-4b reward' });
  raiseSaves(users.a.charId);
  const res = await game('a', 'state');
  assert.equal(res.status, 500, JSON.stringify(res.body));
  dropTriggers();
  assert.equal((await reward(id)).claimed_at, null);
  await game('a', 'state');
  assert.ok((await reward(id)).claimed_at);
});

test('PR-6 the killing blow, then a failed save: the hunt\'s rewards stay pending, then are delivered once', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => { c.battle = null; c.hp = 999999; c.lastActionAt = 0; });
  const hero = (await heroRow('a')).data;
  const res = await service('/rest/v1/hunts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ zone: hero.loc.zone, name: `Test Boss ${RUN}`, level: 1, max_hp: 1, hp: 1, reward: { gold: 1000, xp: 10, relic: false }, ends_at: new Date(Date.now() + 3600000).toISOString() }),
  });
  const hunt = (await res.json())[0];
  const joined = await game('a', 'hunt', { huntId: hunt.id });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const before = wealth((await heroRow('a')).data);
  skipSaves(users.a.charId);
  let defeated = false;
  for (let i = 0; i < 30 && !defeated; i++) {
    const hit = await game('a', 'melee');
    assert.equal(hit.status, 409, `every save fails while the trigger is installed: ${JSON.stringify(hit.body)}`);
    defeated = (await (await service(`/rest/v1/hunts?id=eq.${hunt.id}&select=status`)).json())[0].status === 'defeated';
  }
  assert.ok(defeated, 'the hunt was defeated by a request whose save failed');
  dropTriggers();
  const mine = await (await service(`/rest/v1/pending_rewards?character_id=eq.${users.a.charId}&source=eq.hunt&claimed_at=is.null&select=id,gold`)).json();
  assert.equal(mine.length, 2, 'the share and the killing blow are both still pending');
  const state = await game('a', 'state');
  assert.equal(state.status, 200);
  assert.equal(wealth(state.body.char), before + 1000 + 250, 'the share (all of it) and the killing blow (25%) are delivered');
  const again = await game('a', 'state');
  assert.equal(wealth(again.body.char), before + 1250, 'once');
});

// ------------------------------------------------------------ the full pack (the owner's decision)

test('PR-7 a full pack keeps the whole reward pending, with one notice; a later gold-only reward is delivered; selling delivers it', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => {
    c.battle = null; c.notices = [];
    while (c.inventory.length < 40) c.inventory.push({ uid: c.nextUid++, base: 'sword_1', gems: [] });
  });
  const start = (await heroRow('a')).data;
  const relicId = await addReward('a', { gold: 500, xp: 5, items: [{ base: 'sword_4', q: 'relic' }], note: 'PR-7 relic reward' });
  const first = await game('a', 'state');
  assert.equal(first.status, 200);
  assert.equal((await reward(relicId)).claimed_at, null, 'the reward stays pending');
  assert.equal(wealth(first.body.char), wealth(start), 'none of its gold was delivered');
  assert.equal(first.body.char.xp, start.xp, 'nor its experience');
  assert.equal(first.body.char.inventory.length, 40);
  assert.deepEqual(first.body.char.rewardsWaiting, [{ id: Number(relicId), slots: 1 }]);
  const waitingNotices = (c) => c.notices.filter((n) => n.text.startsWith('A reward is waiting')).length;
  assert.equal(waitingNotices(first.body.char), 1, 'one notice');

  const v = (await heroRow('a')).version;
  const second = await game('a', 'state');
  assert.equal(waitingNotices(second.body.char), 1, 'not repeated on the next read');
  assert.equal((await heroRow('a')).version, v, 'and a read with nothing new to deliver doesn\'t save');

  const goldId = await addReward('a', { gold: 9, note: 'PR-7 gold reward' });
  const third = await game('a', 'state');
  assert.ok((await reward(goldId)).claimed_at, 'the gold-only reward is delivered');
  assert.equal((await reward(relicId)).claimed_at, null, 'the relic reward still waits');
  assert.equal(wealth(third.body.char), wealth(start) + 9);

  const spare = third.body.char.inventory.find((i) => !Object.values(third.body.char.equipment).includes(i.uid));
  const sold = await game('a', 'sell', { uid: spare.uid });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.ok((await reward(relicId)).claimed_at, 'freeing a slot delivers the relic reward in the same request');
  assert.ok(sold.body.char.inventory.some((i) => i.q === 'relic'));
  assert.equal(sold.body.char.rewardsWaiting, undefined, 'nothing is waiting any more');
});

test('PR-8 a reward needing two free slots waits until both are free', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => {
    c.notices = []; c.rewardsWaiting = undefined;
    while (c.inventory.length < 39) c.inventory.push({ uid: c.nextUid++, base: 'sword_1', gems: [] });
    while (c.inventory.length > 39) { const i = c.inventory.findIndex((x) => !Object.values(c.equipment).includes(x.uid)); c.inventory.splice(i, 1); }
  });
  const id = await addReward('a', { gold: 1, items: [{ base: 'sword_4', q: 'relic' }, { base: 'sword_4', q: 'relic' }], note: 'PR-8 reward' });
  const first = await game('a', 'state');
  assert.equal((await reward(id)).claimed_at, null);
  assert.deepEqual(first.body.char.rewardsWaiting, [{ id: Number(id), slots: 1 }], 'one more slot is needed');
  const spare = first.body.char.inventory.find((i) => !Object.values(first.body.char.equipment).includes(i.uid) && i.q !== 'relic');
  const sold = await game('a', 'sell', { uid: spare.uid });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.ok((await reward(id)).claimed_at, 'two free slots: delivered');
  assert.equal(sold.body.char.inventory.length, 40);
});

// ------------------------------------------------------------ ledger timing (question 2)

test('PR-9 a failed save writes no ledger entry: pending rewards and an ordinary action', async () => {
  await clearOpenRewards('a');
  await setHero('a', (c) => { c.battle = null; c.rewardsWaiting = undefined; });
  const source = `${RUN}-ledger`;
  const id = await addReward('a', { gold: 77, source, note: 'PR-9 reward' });
  skipSaves(users.a.charId);
  assert.equal((await game('a', 'state')).status, 409);
  dropTriggers();
  assert.equal(await ledgerTotal(source), 0, 'the reward\'s gold isn\'t recorded when its save fails');
  assert.equal((await game('a', 'state')).status, 200);
  assert.ok((await reward(id)).claimed_at);
  assert.equal(await ledgerTotal(source), 77, 'and is recorded once it is delivered');

  const hero = (await heroRow('a')).data;
  const spare = hero.inventory.find((i) => !Object.values(hero.equipment).includes(i.uid));
  const selling = await ledgerTotal('selling');
  skipSaves(users.a.charId);
  assert.equal((await game('a', 'sell', { uid: spare.uid })).status, 409);
  dropTriggers();
  assert.equal(await ledgerTotal('selling'), selling, 'a sale whose save fails isn\'t recorded');
  const sold = await game('a', 'sell', { uid: spare.uid });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.ok(await ledgerTotal('selling') > selling, 'a sale that saves is recorded');
});

// ------------------------------------------------------------ the error mapping, concurrency, R-1, privileges

test('PR-10 a reward claim conflict (MRREW) reaches the player as 409, and nothing is written', async () => {
  await clearOpenRewards('a');
  const id = await addReward('a', { gold: 155, note: 'PR-10 reward' });
  const before = (await heroRow('a')).version;
  skipClaims(users.a.charId);
  const res = await game('a', 'state');
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Your hero was busy — try again.');
  dropTriggers();
  assert.equal((await reward(id)).claimed_at, null);
  assert.equal((await heroRow('a')).version, before, 'the hero\'s save rolled back with the claim');
});

test('PR-5 two requests at once deliver a reward exactly once (repeated)', async (t) => {
  const seen = { 200: 0, 409: 0 };
  for (let round = 0; round < 3; round++) {
    await clearOpenRewards('a');
    const id = await addReward('a', { gold: 1000 + round, note: `PR-5 reward ${round}` });
    const before = wealth((await heroRow('a')).data);
    const results = await Promise.all([1, 2, 3, 4].map(() => game('a', 'state', {}, { wait: false })));
    for (const r of results) assert.ok([200, 409].includes(r.status), `answered ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
    for (const r of results) seen[r.status] += 1;
    const after = (await heroRow('a')).data;
    assert.ok((await reward(id)).claimed_at, 'claimed');
    assert.equal(wealth(after), before + 1000 + round, `round ${round}: delivered exactly once`);
  }
  // The losers of a race answer 409 (question 1: no automatic retry); recorded, not asserted.
  t.diagnostic(`PR-5 answers over 3 rounds of 4 requests: ${seen[200]} x 200, ${seen[409]} x 409`);
});

test('PR-11 R-1: a duel\'s target save never claims or delivers the target\'s own pending rewards', async () => {
  await clearOpenRewards('a');
  await clearOpenRewards('b');
  for (const who of ['a', 'b']) {
    await setHero(who, (c) => { c.level = 30; c.loc = { zone: 'duskhollow', x: 3, y: 3 }; c.battle = null; c.hp = 999999; c.lastActionAt = 0; });
  }
  const mine = await addReward('a', { gold: 10, note: 'PR-11 attacker reward' });
  const theirs = await addReward('b', { gold: 20, note: 'PR-11 target reward' });
  const targetBank = (await heroRow('b')).data.bank;
  const res = await game('a', 'attack', { targetId: users.b.charId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok((await reward(mine)).claimed_at, 'the attacker\'s reward is delivered with the attacker\'s save');
  assert.equal((await reward(theirs)).claimed_at, null, 'the target\'s reward is not claimed by the attacker\'s request');
  assert.equal((await heroRow('b')).data.bank, targetBank, 'nor delivered (banked gold is untouched by a duel)');
  await game('b', 'state');
  assert.ok((await reward(theirs)).claimed_at, 'the target receives it on their own request');
});

test('PR-12 save_hero_with_rewards() is refused to players through the REST API (service role only)', async () => {
  const body = JSON.stringify({ p_char: users.a.charId, p_version: 0, p_data: {}, p_name: 'x', p_level: 1, p_zone: 'ashford', p_x: 1, p_y: 1, p_reward_ids: [1] });
  const anon = await fetch(`${API}/rest/v1/rpc/save_hero_with_rewards`, { method: 'POST', headers: headers(ANON), body });
  assert.equal((await anon.json()).code, '42501', 'the anon key is refused');
  const player = await fetch(`${API}/rest/v1/rpc/save_hero_with_rewards`, { method: 'POST', headers: headers(users.a.token), body });
  assert.equal((await player.json()).code, '42501', 'a signed-in player is refused');
});
