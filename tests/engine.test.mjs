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
  startBattle(c, rat.id, () => 0.99); // no elite variant
  assert.match(c.battle.log[0].text, /You face a Field Rat!/);
  while (!c.battle.over) battleAction(c, 'melee', rng);
  assert.equal(c.battle.over, 'victory');
  assert.ok(c.gold > 25);
  assert.ok(c.xp > 0);
  assert.ok(c.battle.log.some((l) => /dropped \d+ gold/.test(l.text)));
});

test('defeat: lose all carried gold and some xp, never a level; bank is safe', () => {
  const rng = seeded(3);
  const c = createCharacter('Tester', 'human');
  c.gold = 1000; c.bank = 500; c.xp = 30;
  const boss = ZONES.ashford.boss;
  const lair = ZONES.ashford.features.find((f) => f.type === 'lair');
  c.loc = { zone: 'ashford', x: lair.x, y: lair.y };
  startBattle(c, boss.id);
  while (!c.battle.over) battleAction(c, 'melee', rng);
  assert.equal(c.battle.over, 'defeat');
  assert.equal(c.gold, 0);
  assert.equal(c.bank, 500);
  assert.equal(c.level, 1);
  assert.equal(c.xp, 30 - Math.floor(xpToNext(1) * 0.2));
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
  assert.equal(totalStats(c).str, before + 6, 'Flawed Ruby is +6% STR');
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
  assert.equal(d.gold, 0, 'loser drops all carried gold');
  assert.equal(a.gold, 1000, 'winner takes it');
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

test('elite variants change stats, names and rewards', async () => {
  const { monsterCombatant } = await import('../public/js/engine/monster.js');
  const { rollVariant, VARIANTS } = await import('../public/js/data/variants.js');
  const id = ZONES.ashford.monsters[3].id;
  const plain = monsterCombatant(id);
  const mighty = monsterCombatant(id, 'mighty');
  assert.equal(mighty.name, 'Mighty Highway Bandit');
  assert.ok(mighty.maxHp > plain.maxHp * 2);
  assert.equal(rollVariant(() => 0.5), null);
  assert.equal(rollVariant(() => 0.0001), Object.keys(VARIANTS)[0]);
  assert.equal(rollVariant(() => 0.0001, true), null, 'bosses are never elite');
  // Over many rolls about 10% of fights are elite.
  let n = 0; const rng = seeded(11);
  for (let i = 0; i < 20000; i++) if (rollVariant(rng)) n++;
  assert.ok(n > 1600 && n < 2400, `elite rate ${n / 200}%`);
});

test('masteries start per race, grow on hits, and respect caps', async () => {
  const { trainMastery } = await import('../public/js/engine/character.js');
  const { masteryCap } = await import('../public/js/data/masteries.js');
  const h = createCharacter('Masterer', 'human');
  assert.equal(h.masteries.sword, 15);
  assert.equal(h.masteries.fire, 0);
  const always = () => 0;
  for (let i = 0; i < 500; i++) trainMastery(h, 'sword', always);
  assert.equal(h.masteries.sword, masteryCap('human', 'sword'));
  assert.equal(trainMastery(h, 'sword', always), null, 'capped');
  const o = createCharacter('Orcy', 'orc');
  assert.ok(masteryCap('orc', 'frost') < masteryCap('orc', 'mace'));
});

test('bank: deposit and withdraw only in town', async () => {
  const { deposit, withdraw } = await import('../public/js/engine/inventory.js');
  const { move } = await import('../public/js/engine/world.js');
  const c = createCharacter('Banker', 'dwarf');
  c.gold = 300;
  deposit(c, 200);
  assert.deepEqual([c.gold, c.bank], [100, 200]);
  deposit(c, 'all');
  assert.deepEqual([c.gold, c.bank], [0, 300]);
  assert.throws(() => withdraw(c, 999));
  withdraw(c, 50);
  assert.deepEqual([c.gold, c.bank], [50, 250]);
  move(c, 'n');
  assert.throws(() => deposit(c, 10), /town/);
});

test('relic gear: stronger, extra socket, lower requirements', async () => {
  const { itemDef } = await import('../public/js/data/items.js');
  const normal = itemDef({ base: 'axe_4' });
  const relic = itemDef({ base: 'axe_4', q: 'relic' });
  assert.ok(relic.power > normal.power);
  assert.equal(relic.sockets, normal.sockets + 1);
  assert.ok(relic.req.str < normal.req.str);
  assert.match(relic.name, /^Relic /);
});

test('quests: deterministic board, accept, match, reward and cooldown', async () => {
  const q = await import('../public/js/engine/quests.js');
  const a = q.generateQuests(500000);
  assert.deepEqual(a, q.generateQuests(500000), 'same hour, same quests');
  assert.equal(a.length, q.QUESTS_PER_HOUR);
  const quest = { ...a[0], id: 'q1' };
  const c = createCharacter('Quester', 'elf'); // starts in a town
  c.level = Math.max(quest.minLevel, q.zoneAccessLevel(c, quest.zone));
  const now = quest.expiresAt - 1000;
  q.accept(c, quest, now);
  assert.throws(() => q.accept(c, { ...a[1], id: 'q2' }, now), /already have a quest/);
  c.loc = { zone: quest.zone, x: 1, y: 1 };
  const battle = { over: 'victory', rewards: { variant: quest.variant, monsterLevel: quest.minLevel } };
  assert.equal(q.questMatches(c, battle), true);
  assert.equal(q.questMatches(c, { ...battle, rewards: { variant: 'nope', monsterLevel: quest.minLevel } }), false);
  const gold = c.gold;
  q.grantQuestReward(c, now);
  assert.equal(c.quest, null);
  assert.ok(c.gold >= gold + quest.reward.gold);
  c.loc = { zone: quest.zone, x: ZONES[quest.zone].town.x, y: ZONES[quest.zone].town.y };
  assert.match(q.canAccept(c, { ...a[1], id: 'q2' }, now).reason, /rest/);
});

test('quests: level and zone access gates', async () => {
  const q = await import('../public/js/engine/quests.js');
  const c = createCharacter('Lowbie', 'orc');
  const far = { id: 'x', zone: 'cinderspire', variant: 'mighty', minLevel: 44, maxLevel: 67, reward: {}, expiresAt: Date.now() + 1e6 };
  assert.match(q.canAccept(c, far).reason, /Requires level 50/);
  const otherStarter = { ...far, zone: 'ashford', minLevel: 1, maxLevel: 3 };
  assert.match(q.canAccept(c, otherStarter).reason, /Requires level 20/);
  const home = { ...far, zone: 'bloodrock', minLevel: 1, maxLevel: 3 };
  assert.equal(q.canAccept(c, home).ok, true);
  assert.equal(q.questTitle({ ...home, variant: 'ironhide' }).startsWith('Slay an Ironhide'), true);
});
