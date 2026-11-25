// Kingdoms K-1, stage K1-2: the shared engine's Kingdom rules (#83; docs/kingdoms-k1-plan.md 2.2).
// The test configuration's guard, the one open/closed predicate, the Kingdom Zone's registration
// and its one way in, the zone validation, the gate, and the claim and release rules. Every test
// restores the shipped (closed) configuration and the built-in zones.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINGDOMS_OPEN, CLAIM_MIN_LEVEL, CLAIM_COST, KINGDOM_ZONE_ID, KINGDOM_GATE, KINGDOM_SIZE, PLOT_WINDOW,
  SHIPPED_CONFIG, TEST_CONFIG, testConfigFrom, setKingdomConfig, kingdomConfig, kingdomsOpen,
} from '../public/js/data/kingdoms.js';
import { ZONES, ZONE_DEFS, DEFAULT_ZONES, OVERWORLD_ID, loadZones, reloadZones } from '../public/js/data/zones.js';
import { validateZone } from '../public/js/engine/zone-validate.js';
import { createCharacter, ensureCharacter } from '../public/js/engine/character.js';
import { move, walkTo, usePortal, monstersHere, featuresAt, KINGDOM_NO_WALKING } from '../public/js/engine/world.js';
import { claimKingdom, releaseKingdom, KINGDOMS_CLOSED, KINGDOM_ELSEWHERE } from '../public/js/engine/kingdom.js';
import { startBattle } from '../public/js/engine/battle.js';
import { startHuntBattle } from '../public/js/engine/hunt.js';
import { buy, deposit, withdraw } from '../public/js/engine/inventory.js';
import { spendLevel, applyRegen } from '../public/js/engine/character.js';

function open() { setKingdomConfig(TEST_CONFIG); reloadZones(); }
afterEach(() => { setKingdomConfig(null); loadZones(DEFAULT_ZONES); });

function hero(level = 5, gold = 500) {
  const c = createCharacter('Tester', 'human');
  c.level = level;
  c.gold = gold;
  return c;
}
const atGate = (c) => { c.loc = { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y }; return c; };
const crossroads = () => ZONES[OVERWORLD_ID].town;

// ------------------------------------------------------------ the shipped configuration
test('Kingdoms ship closed: the switch off and both claim values unset', () => {
  assert.equal(KINGDOMS_OPEN, false);
  assert.equal(CLAIM_MIN_LEVEL, null);
  assert.equal(CLAIM_COST, null);
  assert.deepEqual(kingdomConfig(), SHIPPED_CONFIG);
  assert.equal(kingdomsOpen(), false);
  assert.equal(KINGDOM_SIZE, 100);
  assert.equal(PLOT_WINDOW, 10, 'decision 9.4');
});

test('kingdomsOpen() needs the switch on AND both values set; unset never means unrestricted', () => {
  assert.equal(kingdomsOpen(TEST_CONFIG), true);
  assert.equal(kingdomsOpen({ open: true, minLevel: null, cost: 100 }), false, 'level unset: closed');
  assert.equal(kingdomsOpen({ open: true, minLevel: 1, cost: null }), false, 'cost unset: closed');
  assert.equal(kingdomsOpen({ open: false, minLevel: 1, cost: 100 }), false, 'switch off: closed');
  assert.equal(kingdomsOpen({ open: 'yes', minLevel: 1, cost: 100 }), false, 'only true opens');
  assert.equal(kingdomsOpen({ open: true, minLevel: 0, cost: 100 }), false, 'a level below 1 is not a level');
  assert.equal(kingdomsOpen({ open: true, minLevel: 1.5, cost: 100 }), false);
  assert.equal(kingdomsOpen({ open: true, minLevel: 1, cost: -1 }), false);
  assert.equal(kingdomsOpen(null), false);
});

// ------------------------------------------------------------ the test configuration's guard (K1-B01)
test('the test configuration applies only with KINGDOMS_TEST=1 and the local gateway kong', () => {
  assert.equal(testConfigFrom('1', 'http://kong:8000'), TEST_CONFIG);
  assert.equal(testConfigFrom('1', 'http://kong'), TEST_CONFIG);
  for (const url of ['https://janiqspmhkbsyemkknpv.supabase.co', 'http://127.0.0.1:54321', 'http://localhost:54321',
    'http://kong.example.com', 'http://notkong:8000', 'https://kong.supabase.co', '', 'not a url', 'kong']) {
    assert.equal(testConfigFrom('1', url), null, `host of ${JSON.stringify(url)} is not the gateway`);
  }
  for (const flag of ['true', 'yes', '0', '', ' 1', '1 ', 'TRUE', undefined, null]) {
    assert.equal(testConfigFrom(flag, 'http://kong:8000'), null, `KINGDOMS_TEST=${JSON.stringify(flag)} is not 1`);
  }
  assert.equal(testConfigFrom('1', undefined), null, 'a missing SUPABASE_URL fails closed');
  assert.equal(testConfigFrom('1', 42), null);
  setKingdomConfig(testConfigFrom('1', 'https://janiqspmhkbsyemkknpv.supabase.co'));
  assert.equal(kingdomsOpen(), false, 'production values: closed');
});

// ------------------------------------------------------------ registration and the one way in
test('closed: the Kingdom Zone is not registered, and the Overworld has no path to it', () => {
  assert.equal(ZONES[KINGDOM_ZONE_ID], undefined);
  assert.ok(!ZONES[OVERWORLD_ID].features.some((f) => f.to === KINGDOM_ZONE_ID));
  assert.ok(!ZONE_DEFS.some((d) => d.id === KINGDOM_ZONE_ID));
});

test('open: the Kingdom Zone is registered last, with its one path in at the Crossroads, at the claim level', () => {
  open();
  const kz = ZONES[KINGDOM_ZONE_ID];
  assert.ok(kz, 'registered');
  assert.equal(Object.keys(ZONES).at(-1), KINGDOM_ZONE_ID, 'last, so no fallback picks it');
  assert.equal(kz.size, KINGDOM_SIZE);
  assert.equal(kz.pvp, false);
  assert.deepEqual(kz.monsters, []);
  assert.equal(kz.boss, null);
  assert.equal(kz.town, null);
  assert.ok(!ZONE_DEFS.some((d) => d.id === KINGDOM_ZONE_ID), 'the zone editor never sees it');
  const t = crossroads();
  const into = ZONES[OVERWORLD_ID].features.filter((f) => f.type === 'portal' && f.to === KINGDOM_ZONE_ID);
  assert.equal(into.length, 1, 'exactly one way in');
  assert.deepEqual([into[0].x, into[0].y], [t.x, t.y], 'at the Overworld town, the Crossroads');
  assert.equal(into[0].minLevel, TEST_CONFIG.minLevel, 'entry needs the claim level');
  const out = kz.features.filter((f) => f.type === 'portal');
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].x, out[0].y, out[0].to, out[0].tx, out[0].ty], [KINGDOM_GATE.x, KINGDOM_GATE.y, OVERWORLD_ID, t.x, t.y]);
  assert.equal(out[0].label, 'Leave the Kingdom Lands');
  for (const z of Object.values(ZONES)) {
    if (z.id === OVERWORLD_ID) continue;
    assert.ok(!z.features.some((f) => f.to === KINGDOM_ZONE_ID), `${z.id} has no path in`);
  }
});

test('a database zone with the reserved id, or a path into it, is ignored even unvalidated (K1-B03)', () => {
  open();
  const rogue = { ...DEFAULT_ZONES.find((d) => d.id === 'ashford'), portals: [{ x: 1, y: 1, to: KINGDOM_ZONE_ID, tx: 50, ty: 50, label: 'Sneak in' }] };
  const fake = { ...DEFAULT_ZONES.find((d) => d.id === 'ashford'), id: KINGDOM_ZONE_ID, name: 'Fake Kingdoms', size: 5 };
  loadZones([...DEFAULT_ZONES.filter((d) => d.id !== 'ashford'), rogue, fake]);
  assert.equal(ZONES[KINGDOM_ZONE_ID].name, 'The Kingdom Lands', 'the code definition, not the row');
  assert.equal(ZONES[KINGDOM_ZONE_ID].size, KINGDOM_SIZE);
  assert.ok(!ZONES.ashford.features.some((f) => f.to === KINGDOM_ZONE_ID), 'the rogue path is dropped');
  assert.ok(!ZONE_DEFS.some((d) => d.id === KINGDOM_ZONE_ID), 'the row is not kept');
});

test('another path at the Overworld town cell is removed while open, so the Crossroads leads only to the Kingdom Lands', () => {
  const ow = DEFAULT_ZONES.find((d) => d.id === OVERWORLD_ID);
  const t = ow.town;
  const clash = { ...ow, portals: [{ x: t.x, y: t.y, to: 'ashford', tx: 1, ty: 1, label: 'Clash' }] };
  open();
  loadZones([...DEFAULT_ZONES.filter((d) => d.id !== OVERWORLD_ID), clash]);
  const here = featuresAt(ZONES[OVERWORLD_ID], t.x, t.y).filter((f) => f.type === 'portal');
  assert.equal(here.length, 1);
  assert.equal(here[0].to, KINGDOM_ZONE_ID);
});

test('the Overworld path to the Kingdom Lands follows the Overworld town if the Overworld row moves it', () => {
  const ow = DEFAULT_ZONES.find((d) => d.id === OVERWORLD_ID);
  const moved = { ...ow, town: { ...ow.town, x: 2, y: 3 } };
  open();
  loadZones([...DEFAULT_ZONES.filter((d) => d.id !== OVERWORLD_ID), moved]);
  const into = ZONES[OVERWORLD_ID].features.find((f) => f.to === KINGDOM_ZONE_ID);
  assert.deepEqual([into.x, into.y], [2, 3]);
  const out = ZONES[KINGDOM_ZONE_ID].features.find((f) => f.type === 'portal');
  assert.deepEqual([out.tx, out.ty], [2, 3]);
});

// ------------------------------------------------------------ validateZone (K1-B03)
test('validateZone refuses the reserved id, a path into the Kingdom Lands, and an Overworld path at its town', () => {
  const defs = DEFAULT_ZONES;
  const ashford = defs.find((d) => d.id === 'ashford');
  assert.ok(validateZone({ ...ashford, id: KINGDOM_ZONE_ID }, defs).some((e) => /reserved/.test(e)));
  assert.ok(validateZone({ ...ashford, portals: [{ x: 1, y: 1, to: KINGDOM_ZONE_ID, tx: 1, ty: 1 }] }, defs)
    .some((e) => /Only the Crossroads/.test(e)));
  const ow = defs.find((d) => d.id === OVERWORLD_ID);
  assert.ok(validateZone({ ...ow, portals: [{ x: ow.town.x, y: ow.town.y, to: 'ashford', tx: 1, ty: 1 }] }, defs)
    .some((e) => /Overworld town is where the path to the Kingdom Lands goes/.test(e)));
  assert.deepEqual(validateZone({ ...ow, portals: [{ x: 1, y: 2, to: 'ashford', tx: 1, ty: 1 }] }, defs), [],
    'an Overworld path elsewhere is fine');
  assert.ok(validateZone({ ...ashford, overworld: [ow.town.x, ow.town.y] }, defs).some((e) => /Overworld town/.test(e)),
    'a zone placed on the Overworld town was already refused');
  for (const d of defs) assert.deepEqual(validateZone(d, defs), [], `the built-in ${d.id} is still valid`);
});

test('validateZone refuses moving the Overworld town onto a cell where another zone is placed (K1-ENG01)', () => {
  const defs = DEFAULT_ZONES;
  const ow = defs.find((d) => d.id === OVERWORLD_ID);
  const ashford = defs.find((d) => d.id === 'ashford');
  const [ax, ay] = ashford.overworld;
  const moved = { ...ow, town: { ...ow.town, x: ax, y: ay } };
  const errors = validateZone(moved, defs);
  assert.ok(errors.some((e) => e.includes(`${ashford.name} is placed on that Overworld cell`)), JSON.stringify(errors));
  // A restore validates the built-in Overworld against the current rows: the same check applies.
  const rowsWithZoneOnTown = [...defs.filter((d) => d.id !== 'ashford'), { ...ashford, overworld: [ow.town.x, ow.town.y] }];
  assert.ok(validateZone(ow, rowsWithZoneOnTown).some((e) => /is placed on that Overworld cell/.test(e)),
    'restoring the Overworld over a zone placed on its town is refused');
  // A free cell is fine, and the original direction is still refused.
  const free = { ...ow, town: { ...ow.town, x: 3, y: 3 } };
  assert.ok(!defs.some((d) => Array.isArray(d.overworld) && d.overworld[0] === 3 && d.overworld[1] === 3), 'the fixture cell is free');
  assert.deepEqual(validateZone(free, defs).filter((e) => /placed on that Overworld cell/.test(e)), []);
  assert.ok(validateZone({ ...ashford, overworld: [ow.town.x, ow.town.y] }, defs).some((e) => /Overworld town/.test(e)));
});

// ------------------------------------------------------------ the gate and the closed state (ensureCharacter)
test('closed: a hero found in the Kingdom Zone is moved to the Crossroads, not to their home', () => {
  const c = atGate(hero());
  c.loc.x = 40;
  ensureCharacter(c);
  const t = crossroads();
  assert.deepEqual(c.loc, { zone: OVERWORLD_ID, x: t.x, y: t.y });
});

test('open: a hero in the Kingdom Zone away from the gate is moved to the gate', () => {
  open();
  const c = atGate(hero());
  c.loc.x = 40; c.loc.y = 7;
  ensureCharacter(c);
  assert.deepEqual(c.loc, { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y });
  const before = JSON.stringify(c.loc);
  ensureCharacter(c);
  assert.equal(JSON.stringify(c.loc), before, 'a hero at the gate stays');
});

test('ensureCharacter never adds, removes or moves data.kingdom', () => {
  open();
  const c = atGate(hero());
  c.kingdom = { plot: { x: 4, y: 9 }, claimedAt: 1 };
  ensureCharacter(c);
  assert.deepEqual(c.kingdom, { plot: { x: 4, y: 9 }, claimedAt: 1 });
  setKingdomConfig(null); loadZones(DEFAULT_ZONES);
  ensureCharacter(c);
  assert.deepEqual(c.kingdom, { plot: { x: 4, y: 9 }, claimedAt: 1 }, 'also while closed');
});

// ------------------------------------------------------------ in the Kingdom Zone
test('in the Kingdom Zone: no walking, no monsters, and the gate leads back to the Crossroads', () => {
  open();
  const c = atGate(hero());
  assert.throws(() => move(c, 's'), new RegExp(KINGDOM_NO_WALKING));
  assert.throws(() => walkTo(c, 5, 5), new RegExp(KINGDOM_NO_WALKING));
  assert.deepEqual(c.loc, { zone: KINGDOM_ZONE_ID, x: 1, y: 1 });
  assert.deepEqual(monstersHere(c), []);
  assert.throws(() => startBattle(c, 'ashford:anything'));
  const hunt = { id: 'h1', name: 'Placed directly', level: 1, hp: 10, max_hp: 10, zone: KINGDOM_ZONE_ID };
  assert.throws(() => startHuntBattle(c, hunt), /No hunt can be fought in the Kingdom Lands/, 'even a hunt row placed there');
  assert.throws(() => startHuntBattle(c, { ...hunt, zone: 'ashford' }), /not in this zone/);
  assert.equal(c.battle, null);
  usePortal(c);
  const t = crossroads();
  assert.deepEqual(c.loc, { zone: OVERWORLD_ID, x: t.x, y: t.y });
});

test('the Crossroads portal needs the claim level', () => {
  open();
  const t = crossroads();
  const low = hero(1);
  low.loc = { zone: OVERWORLD_ID, x: t.x, y: t.y };
  setKingdomConfig({ open: true, minLevel: 3, cost: 100 }); reloadZones();
  assert.throws(() => usePortal(low), /level 3/);
  low.level = 3;
  usePortal(low);
  assert.deepEqual(low.loc, { zone: KINGDOM_ZONE_ID, x: KINGDOM_GATE.x, y: KINGDOM_GATE.y });
});

// ------------------------------------------------------------ claim and release
test('claim: refused while closed, even with explicit values unset', () => {
  const c = atGate(hero());
  assert.throws(() => claimKingdom(c, 5, 5, 1000), new RegExp(KINGDOMS_CLOSED));
  assert.throws(() => claimKingdom(c, 5, 5, 1000, { open: true, minLevel: null, cost: 100 }), new RegExp(KINGDOMS_CLOSED));
  assert.equal(c.kingdom, undefined);
  assert.equal(c.gold, 500);
});

test('claim: only in the Kingdom Zone (K-D12), outside a fight, on a plot within 1 to 100', () => {
  open();
  const away = hero();
  assert.throws(() => claimKingdom(away, 5, 5, 1000), new RegExp(KINGDOM_ELSEWHERE));
  const c = atGate(hero());
  c.battle = { over: null };
  assert.throws(() => claimKingdom(c, 5, 5, 1000), /middle of a fight/);
  c.battle = null;
  for (const [x, y] of [[0, 5], [5, 101], [1.5, 2], ['a', 1], [null, 1]]) {
    assert.throws(() => claimKingdom(c, x, y, 1000), /Choose a plot/, `(${x}, ${y})`);
  }
  assert.equal(c.kingdom, undefined);
});

test('claim: the level and the cost from carried gold; the Kingdom is recorded on the plot', () => {
  open();
  const low = atGate(hero(1, 500));
  setKingdomConfig({ open: true, minLevel: 3, cost: 100 }); reloadZones();
  atGate(low);
  assert.throws(() => claimKingdom(low, 5, 5, 1000), /level 3/);
  const poor = atGate(hero(5, 99));
  poor.bank = 10000;
  assert.throws(() => claimKingdom(poor, 5, 5, 1000), /costs 100 gold/, 'banked gold does not pay');
  const c = atGate(hero(5, 500));
  assert.equal(claimKingdom(c, '7', 9, 1234), 100, 'returns the gold spent');
  assert.equal(c.gold, 400);
  assert.deepEqual(c.kingdom, { plot: { x: 7, y: 9 }, claimedAt: 1234 });
  assert.throws(() => claimKingdom(c, 8, 8, 1300), /already have a Kingdom/);
  assert.equal(c.gold, 400);
});

test('release: removes the Kingdom, with no refund; refused while closed, elsewhere, or without one', () => {
  open();
  const c = atGate(hero());
  assert.throws(() => releaseKingdom(c), /don’t have a Kingdom/);
  claimKingdom(c, 3, 3, 1000);
  const gold = c.gold;
  releaseKingdom(c);
  assert.equal(c.kingdom, undefined);
  assert.equal(c.gold, gold);
  claimKingdom(c, 3, 3, 2000);
  c.loc = { zone: OVERWORLD_ID, x: 1, y: 1 };
  assert.throws(() => releaseKingdom(c), new RegExp(KINGDOM_ELSEWHERE));
  setKingdomConfig(null);
  atGate(c);
  assert.throws(() => releaseKingdom(c), new RegExp(KINGDOMS_CLOSED));
  assert.ok(c.kingdom, 'nothing removed while closed');
});

test('no ordinary action adds, removes or changes data.kingdom (I-1)', () => {
  open();
  const c = atGate(hero(10, 5000));
  claimKingdom(c, 12, 34, 1000);
  const k = JSON.stringify(c.kingdom);
  usePortal(c); // to the Crossroads
  const t = crossroads();
  assert.deepEqual([c.loc.x, c.loc.y], [t.x, t.y]);
  const steps = [
    () => move(c, 'n'), () => move(c, 's'), () => walkTo(c, 2, 2), () => walkTo(c, t.x, t.y),
    () => deposit(c, 100), () => withdraw(c, 50), () => applyRegen(c, Date.now() + 60000),
    () => buy(c, 'no-such-item'),
    () => { c.pendingLevels = 1; spendLevel(c, 'str'); },
    () => ensureCharacter(c),
  ];
  for (const s of steps) { try { s(); } catch { /* a refused step changes nothing either */ } assert.equal(JSON.stringify(c.kingdom), k); }
  const plain = hero();
  ensureCharacter(plain);
  assert.equal(plain.kingdom, undefined, 'and none appears on a hero without one');
});
