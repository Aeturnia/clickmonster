import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCharacter, spendLevel, gainXp, xpToNext, maxHp, totalStats, meetsRequirements,
} from '../public/js/engine/character.js';
import { move, usePortal, monstersHere, heal } from '../public/js/engine/world.js';
import { startBattle, battleAction } from '../public/js/engine/battle.js';
import { buy, equip, socketGem, sell, extractGem } from '../public/js/engine/inventory.js';
import { hitChance } from '../public/js/engine/combat.js';
import { ZONES, MONSTERS } from '../public/js/data/zones.js';
import { ITEMS } from '../public/js/data/items.js';
import { RACES } from '../public/js/data/races.js';

// Deterministic RNG for tests.
function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('every race can be created with valid starting gear and zone', () => {
  for (const id of Object.keys(RACES)) {
    const c = createCharacter('Tester', id);
    assert.equal(c.level, 1);
    assert.ok(ZONES[c.loc.zone].starter);
    assert.equal(c.hp, maxHp(c));
    for (const uid of Object.values(c.equipment).filter(Boolean)) {
      assert.ok(c.inventory.find((i) => i.uid === uid));
    }
  }
});

test('names are validated', () => {
  assert.throws(() => createCharacter('x', 'human'));
  assert.throws(() => createCharacter('<script>', 'human'));
  assert.equal(createCharacter('  Sir  Rat  ', 'human').name, 'Sir Rat');
});

test('level-up: 10 into one stat, or 2 into all', () => {
  const c = createCharacter('Tester', 'human');
  const before = { ...c.stats };
  gainXp(c, xpToNext(1) + xpToNext(2));
  assert.equal(c.level, 3);
  assert.equal(c.pendingLevels, 2);
  spendLevel(c, 'dex');
  assert.equal(c.stats.dex, before.dex + 10);
  spendLevel(c, 'all');
  for (const s of ['str', 'int', 'wis', 'vit']) assert.equal(c.stats[s], before[s] + 2);
  assert.equal(c.stats.dex, before.dex + 12);
  assert.throws(() => spendLevel(c, 'all'));
});

test('hit chance stays bounded with huge stats', () => {
  assert.ok(hitChance(1e6, 1) <= 0.95);
  assert.ok(hitChance(1, 1e6) >= 0.1);
  assert.ok(Math.abs(hitChance(50, 50) - 0.7) < 1e-9);
});

test('starter zone exit is level gated', () => {
  const c = createCharacter('Tester', 'orc');
  const zone = ZONES[c.loc.zone];
  const exit = zone.features.find((f) => f.type === 'portal');
  c.loc = { zone: zone.id, x: exit.x, y: exit.y };
  assert.throws(() => usePortal(c), /level 20/);
  c.level = 20;
  usePortal(c);
  assert.equal(c.loc.zone, 'overworld');
});

test('movement is bounded by zone size', () => {
  const c = createCharacter('Tester', 'elf');
  c.loc.y = 1;
  assert.throws(() => move(c, 'n'));
  move(c, 's');
  assert.equal(c.loc.y, 2);
});

test('every cell shares the zone monster list; boss only in lair', () => {
  const c = createCharacter('Tester', 'gnome');
  const zone = ZONES[c.loc.zone];
  assert.deepEqual(monstersHere(c).map((m) => m.id), zone.monsters.map((m) => m.id));
  const lair = zone.features.find((f) => f.type === 'lair');
  c.loc = { zone: zone.id, x: lair.x, y: lair.y };
  assert.ok(monstersHere(c).some((m) => m.boss));
});

test('a level 1 hero can beat a level 1 monster and earns gold + xp', () => {
  const rng = seeded(7);
  const c = createCharacter('Tester', 'human');
  const rat = ZONES.ashford.monsters[0];
  startBattle(c, rat.id);
  assert.match(c.battle.log[0].text, /You face a Field Rat!/);
  while (!c.battle.over) battleAction(c, 'melee', rng);
  assert.equal(c.battle.over, 'victory');
  assert.ok(c.gold > 25);
  assert.ok(c.xp > 0);
  assert.ok(c.battle.log.some((l) => /dropped \d+ gold/.test(l.text)));
});

test('defeat sends you to town and costs gold', () => {
  const rng = seeded(3);
  const c = createCharacter('Tester', 'human');
  c.gold = 1000;
  const boss = ZONES.ashford.boss;
  const lair = ZONES.ashford.features.find((f) => f.type === 'lair');
  c.loc = { zone: 'ashford', x: lair.x, y: lair.y };
  startBattle(c, boss.id);
  while (!c.battle.over) battleAction(c, 'melee', rng);
  assert.equal(c.battle.over, 'defeat');
  assert.equal(c.gold, 900);
  assert.deepEqual([c.loc.x, c.loc.y], [ZONES.ashford.town.x, ZONES.ashford.town.y]);
});

test('shop, equip requirements, gems and selling', () => {
  const c = createCharacter('Tester', 'human');
  c.gold = 100000;
  const item = buy(c, 'sword_2');
  assert.equal(meetsRequirements(c, 'sword_2').ok, false);
  assert.throws(() => equip(c, item.uid));
  c.stats.str = 100; c.stats.dex = 100;
  equip(c, item.uid);
  assert.equal(c.equipment.weapon, item.uid);

  c.gems['ruby:2'] = 1;
  const before = totalStats(c).str;
  socketGem(c, item.uid, 'ruby:2');
  assert.equal(totalStats(c).str, before + 5);
  assert.throws(() => socketGem(c, item.uid, 'ruby:2'));
  extractGem(c, item.uid, 0);
  assert.equal(c.gems['ruby:2'], 1);

  const other = buy(c, 'helm_1');
  const gold = c.gold;
  sell(c, other.uid);
  assert.ok(c.gold > gold);
  assert.throws(() => sell(c, item.uid), /Unequip/);
});

test('healer only works in town and costs gold', () => {
  const c = createCharacter('Tester', 'dwarf');
  c.hp = 1;
  const g = c.gold;
  heal(c);
  assert.equal(c.hp, maxHp(c));
  assert.ok(c.gold < g);
  c.hp = 1;
  move(c, 'n');
  assert.throws(() => heal(c));
});

test('data integrity: monsters, shops and portals reference real things', () => {
  for (const z of Object.values(ZONES)) {
    for (const f of z.features) if (f.type === 'portal') assert.ok(ZONES[f.to], `${z.id} -> ${f.to}`);
    assert.ok(z.town.x >= 1 && z.town.x <= z.size);
  }
  for (const m of Object.values(MONSTERS)) assert.ok(m.level > 0 && m.verb);
  for (const r of Object.values(RACES)) for (const g of r.gear) assert.ok(ITEMS[g], g);
});

test('pvp: only in PvP zones, outside town, within level gap', async () => {
  const { duel, canAttack } = await import('../public/js/engine/pvp.js');
  const a = createCharacter('Attacker', 'orc');
  const d = createCharacter('Defender', 'elf');
  for (const c of [a, d]) { c.level = 30; c.loc = { zone: 'marsh', x: 3, y: 3 }; }
  assert.equal(canAttack(a, d).ok, false, 'marsh is not PvP');
  for (const c of [a, d]) c.loc = { zone: 'duskhollow', x: ZONES.duskhollow.town.x, y: ZONES.duskhollow.town.y };
  assert.match(canAttack(a, d).reason, /safe/);
  for (const c of [a, d]) c.loc = { zone: 'duskhollow', x: 3, y: 3 };
  d.level = 15;
  assert.match(canAttack(a, d).reason, /levels below/);
  d.level = 30;
  a.gold = 0; d.gold = 1000;
  a.stats.str = 500; a.stats.dex = 500; a.stats.vit = 500; a.hp = maxHp(a);
  const res = duel(a, d, seeded(5));
  assert.equal(res.winner, 'attacker');
  assert.equal(d.gold, 900);
  assert.equal(a.gold, 100);
  assert.deepEqual([d.loc.x, d.loc.y], [ZONES.duskhollow.town.x, ZONES.duskhollow.town.y]);
  assert.equal(d.notices.length, 1);
  assert.equal(a.battle.over, 'victory');
});

test('walkTo and buyAndEquip', async () => {
  const { walkTo } = await import('../public/js/engine/world.js');
  const { buyAndEquip } = await import('../public/js/engine/inventory.js');
  const c = createCharacter('Walker', 'human');
  walkTo(c, 2, 9);
  assert.deepEqual([c.loc.x, c.loc.y], [2, 9]);
  assert.throws(() => walkTo(c, 0, 3));
  assert.throws(() => walkTo(c, 11, 3));
  c.loc = { zone: 'ashford', ...{ x: ZONES.ashford.town.x, y: ZONES.ashford.town.y } };
  c.gold = 100000;
  const gold = c.gold;
  assert.throws(() => buyAndEquip(c, 'sword_3'), /requirements/);
  assert.equal(c.gold, gold, 'no gold spent on a failed buy & equip');
  const item = buyAndEquip(c, 'helm_1');
  assert.equal(c.equipment.helm, item.uid);
});
