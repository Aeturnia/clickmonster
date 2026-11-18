// Gameplay polish C, D and E (docs/gameplay-polish-scope.md): how the battle log is grouped, and
// which lines the outcome card takes over. The lines come from the engine itself, so a change to
// its wording fails here instead of showing a reward twice or hiding a line the card doesn't show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter, xpToNext } from '../public/js/engine/character.js';
import { startBattle, battleAction } from '../public/js/engine/battle.js';
import { startHuntBattle, huntExchange } from '../public/js/engine/hunt.js';
import { duel } from '../public/js/engine/pvp.js';
import { ZONES } from '../public/js/data/zones.js';
import { logGroups, cardLine, cardListsMastery } from '../public/js/log-view.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// A fight to the end against a zone monster, one step out of town.
function fight(seed, { level = 1, monster = 0, nearLevel = false, gold = 50 } = {}) {
  const rng = seeded(seed);
  const c = createCharacter('Tester', 'human');
  const z = ZONES.ashford;
  c.loc = { zone: 'ashford', x: z.town.x, y: z.town.y - 1 };
  c.level = level;
  for (let i = 1; i < level; i++) { c.stats.str += 4; c.stats.dex += 3; c.stats.vit += 3; }
  c.hp = 10 ** 6; // long enough to see every kind of reward
  c.gold = gold;
  if (nearLevel) c.xp = xpToNext(c.level) - 1;
  startBattle(c, z.monsters[monster].id, rng);
  for (let i = 0; i < 200 && !c.battle.over; i++) battleAction(c, 'melee', rng);
  return c.battle;
}

const VICTORY_CARD = [/ dropped \d+ gold\.$/, / mastery is now \d+\.$/, /^You gain \d+ experience\.$/, /^You found a /, /^A rare find: /, /^You reached level \d+!$/];

test('GP-D1 victory: the rewards move to the card; the narrative line and the rest stay', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const b = fight(seed, { nearLevel: seed % 2 === 0, level: 1 + (seed % 5), monster: seed % 3 });
    assert.equal(b.over, 'victory');
    for (const l of b.log) {
      const reward = VICTORY_CARD.some((re) => re.test(l.text));
      assert.equal(cardLine(b, l), reward, `${l.kind}: ${l.text}`);
      if (reward) seen.add(VICTORY_CARD.find((re) => re.test(l.text)).source);
      if (/^Victory! .* has been slain!$/.test(l.text)) assert.equal(cardLine(b, l), false, 'the narrative victory line stays');
    }
  }
  // Every kind of reward line was produced by the engine and recognized.
  for (const re of VICTORY_CARD.filter((r) => !/rare find/.test(r.source))) assert.ok(seen.has(re.source), `the engine produced ${re.source}`);
});

test('GP-D1 the lines no card shows stay: a variant heal, a full pack, a quest completion', () => {
  const b = { over: 'victory', log: [] };
  for (const l of [
    { kind: 'reward', text: 'A warm light restores your health.' },
    { kind: 'bad', text: 'Something rare glinted in the remains, but your pack is full.' },
    { kind: 'win', text: 'Quest complete! You earn 120 experience and 40 gold.' },
    { kind: 'win', text: 'Victory! The Field Rat has been slain!' },
  ]) assert.equal(cardLine(b, l), false, l.text);
});

test('GP-D2 defeat: the losses move to the card; "You have been defeated by" stays', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60 && checked < 5; seed++) {
    const rng = seeded(seed);
    const c = createCharacter('Tester', 'human');
    const z = ZONES.ashford;
    c.loc = { zone: 'ashford', x: z.boss ? z.features.find((f) => f.type === 'lair').x : 1, y: z.features.find((f) => f.type === 'lair').y };
    c.gold = 777; c.xp = 30;
    startBattle(c, z.boss.id, rng);
    for (let i = 0; i < 200 && !c.battle.over; i++) battleAction(c, 'melee', rng);
    const b = c.battle;
    if (b.over !== 'defeat') continue;
    checked++;
    for (const l of b.log) {
      const loss = /^You wake up in town/.test(l.text);
      assert.equal(cardLine(b, l), loss, l.text);
    }
    assert.ok(b.log.some((l) => /^You have been defeated by /.test(l.text) && !cardLine(b, l)));
  }
  assert.ok(checked > 0, 'a defeat was produced');
});

test('GP-D2 duels: the gold line moves to the card either way; the narrative line stays', () => {
  const z = Object.values(ZONES).find((x) => x.pvp && x.town);
  const make = (name, level, gold) => {
    const c = createCharacter(name, 'human');
    c.level = level; c.gold = gold;
    if (name.startsWith('Strong')) c.stats = { str: 900, dex: 900, int: 900, wis: 900, vit: 900 };
    c.loc = { zone: z.id, x: z.town.x, y: z.town.y - 1 };
    return c;
  };
  const won = make('Strong', 40, 10); const lost = make('Weak', 30, 500);
  duel(won, lost, seeded(3));
  const bw = won.battle;
  assert.equal(bw.over, 'victory');
  assert.deepEqual(bw.log.filter((l) => cardLine(bw, l)).map((l) => l.text), ['You take 500 gold from Weak.']);
  assert.ok(bw.log.some((l) => /^Victory! Weak has been defeated!$/.test(l.text) && !cardLine(bw, l)));

  const weak = make('Weak', 30, 600); const strong = make('Strong', 40, 0);
  duel(weak, strong, seeded(3));
  const bl = weak.battle;
  assert.equal(bl.over, 'defeat');
  assert.deepEqual(bl.log.filter((l) => cardLine(bl, l)).map((l) => l.text), ['Strong takes 600 of your gold. You wake up in town.']);
  assert.ok(bl.log.some((l) => /^You have been defeated by Strong/.test(l.text) && !cardLine(bl, l)));
  const broke = make('Broke', 30, 0); const strong2 = make('Strong', 40, 0);
  duel(broke, strong2, seeded(3));
  assert.deepEqual(broke.battle.log.filter((l) => cardLine(broke.battle, l)).map((l) => l.text), ['You wake up in town.']);
});

test('GP-D2 world-boss hunts: nothing moves (a victory has no card; a defeat line says more than the card)', () => {
  const c = createCharacter('Tester', 'human');
  c.hp = 1; c.gold = 90;
  const hunt = { id: 'h1', zone: 'ashford', name: 'The Ash Wyrm', level: 60, hp: 10 ** 6, max_hp: 10 ** 6 };
  startHuntBattle(c, hunt);
  const rng = seeded(5);
  for (let i = 0; i < 50 && !c.battle.over; i++) huntExchange(c, hunt, 'melee', rng);
  const b = c.battle;
  assert.equal(b.over, 'defeat');
  assert.deepEqual(b.log.filter((l) => cardLine(b, l)), []);
  assert.ok(b.log.some((l) => /Your damage still counts toward the hunt/.test(l.text)));
  assert.equal(cardListsMastery(b), false);
});

test('GP-C groups: rounds as marked; the opening lines belong to the first round', () => {
  const log = ['You face a Field Rat!', 'You hit', 'It bites', 'You hit', 'It misses', 'You miss'].map((text) => ({ kind: 'info', text }));
  const turnLog = { restored: 0, marks: [{ start: 1, turn: 1 }, { start: 3, turn: 2 }, { start: 5, turn: 3 }] };
  assert.deepEqual(logGroups(log, turnLog).map((g) => [g.type, g.turn, g.start, g.end]), [['turn', 1, 0, 3], ['turn', 2, 3, 5], ['turn', 3, 5, 6]]);
  // Before the first action: the opening lines alone.
  assert.deepEqual(logGroups(log.slice(0, 1), { restored: 0, marks: [] }).map((g) => [g.type, g.start, g.end]), [['start', 0, 1]]);
});

test('GP-C4/GP-D5 after a reload: what was there is one ungrouped "before" group, never rounds', () => {
  const log = Array.from({ length: 7 }, (_, i) => ({ kind: 'info', text: `line ${i}` }));
  // No action seen on this page yet: everything is "before".
  assert.deepEqual(logGroups(log, null).map((g) => [g.type, g.start, g.end]), [['before', 0, 7]]);
  // Then two actions: marked rounds after the ungrouped lines, counted from the reload.
  const more = [...log, { kind: 'info', text: 'a' }, { kind: 'info', text: 'b' }, { kind: 'info', text: 'c' }];
  const turnLog = { restored: 7, marks: [{ start: 7, turn: 4 }, { start: 9, turn: 5 }] };
  assert.deepEqual(logGroups(more, turnLog).map((g) => [g.type, g.turn, g.start, g.end]), [['before', undefined, 0, 7], ['turn', 4, 7, 9], ['turn', 5, 9, 10]]);
});
