// Gameplay polish F2 (docs/gameplay-polish-scope.md, GP-F4 and GP-F4b): roaming monsters can't be
// fought on a town tile. A lair boss on the same tile still can, world-boss hunts are unaffected,
// and duels in town are refused as before. The rule is in the shared engine, so the server
// enforces it once the functions are redeployed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../public/js/engine/character.js';
import { monstersHere, inTown, TOWN_NO_MONSTERS } from '../public/js/engine/world.js';
import { startBattle } from '../public/js/engine/battle.js';
import { startHuntBattle } from '../public/js/engine/hunt.js';
import { canAttack } from '../public/js/engine/pvp.js';
import { ZONES, DEFAULT_ZONES, loadZones } from '../public/js/data/zones.js';

after(() => loadZones(DEFAULT_ZONES));

// A zone whose boss lair is on its town tile. No built-in zone has one; an edited zone could.
const HAMLET = {
  id: 'test-hamlet', name: 'Test Hamlet', desc: 'A lair under the square.', size: 6, starter: false, pvp: true, minLevel: 0, exitLevel: 0,
  overworld: null, entry: { x: 3, y: 6 }, town: { x: 3, y: 3, name: 'Hamlet' }, shop: null,
  lairs: [{ x: 3, y: 3 }], portals: [],
  monsters: [{ name: 'Cellar Rat', level: 1, arch: 'quick', verb: 'bites' }, { name: 'Moth Swarm', level: 2, arch: 'caster', verb: 'stings', element: 'storm' }],
  boss: { name: 'The Undercroft King', level: 5, arch: 'tank', verb: 'crushes', proper: true },
};

function hero(zone, x, y) {
  const c = createCharacter('Tester', 'human');
  c.loc = { zone, x, y };
  return c;
}

test('GP-F4 on a town tile no roaming monster is offered or can be fought, with the town message', () => {
  for (const z of Object.values(ZONES)) {
    if (!z.town || !z.monsters.length) continue;
    const c = hero(z.id, z.town.x, z.town.y);
    assert.ok(inTown(c));
    assert.deepEqual(monstersHere(c), [], `${z.id}: nothing to fight in town`);
    assert.throws(() => startBattle(c, z.monsters[0].id), { message: TOWN_NO_MONSTERS }, z.id);
    assert.equal(c.battle, null, 'no fight started');
  }
});

test('GP-F4 one step out of town, the zone monsters are back and a fight starts', () => {
  const z = ZONES.ashford;
  const c = hero('ashford', z.town.x, z.town.y - 1);
  assert.deepEqual(monstersHere(c).map((m) => m.id), z.monsters.map((m) => m.id));
  startBattle(c, z.monsters[0].id, () => 0.99);
  assert.ok(c.battle && !c.battle.over);
});

test('GP-F4 a monster from another zone still gets the general refusal, not the town message', () => {
  const z = ZONES.ashford;
  const c = hero('ashford', z.town.x, z.town.y);
  assert.throws(() => startBattle(c, ZONES.bramblebrook.monsters[0].id), { message: 'That monster isn’t here.' });
});

test('GP-F4 the lair boss off town, world-boss hunts in town, and duels in town are unchanged', () => {
  const z = ZONES.ashford;
  const lair = z.features.find((f) => f.type === 'lair');
  const atLair = hero('ashford', lair.x, lair.y);
  assert.ok(monstersHere(atLair).some((m) => m.boss));
  startBattle(atLair, z.boss.id);
  assert.ok(atLair.battle);
  // A world-boss hunt is joined from anywhere in its zone, the town included.
  const inTownHero = hero('ashford', z.town.x, z.town.y);
  startHuntBattle(inTownHero, { id: 'hunt-1', zone: 'ashford', name: 'The Ash Wyrm', level: 10, hp: 5000, max_hp: 5000 });
  assert.ok(inTownHero.battle?.hunt, 'the hunt starts in town');
  // Duels: the existing town safety.
  const pvpZone = Object.values(ZONES).find((x) => x.pvp && x.town);
  const a = hero(pvpZone.id, pvpZone.town.x, pvpZone.town.y);
  const d = hero(pvpZone.id, pvpZone.town.x, pvpZone.town.y);
  assert.equal(canAttack(a, d).ok, false);
  assert.match(canAttack(a, d).reason, /Towns are safe/);
});

test('GP-F4b a lair on the town tile: only the boss is offered there, and only the boss can be fought', () => {
  loadZones([...DEFAULT_ZONES, HAMLET]);
  const z = ZONES['test-hamlet'];
  const c = hero('test-hamlet', 3, 3);
  assert.ok(inTown(c));
  assert.deepEqual(monstersHere(c).map((m) => m.id), [z.boss.id], 'the lair boss, and no roaming monsters');
  assert.throws(() => startBattle(c, z.monsters[0].id), { message: TOWN_NO_MONSTERS });
  startBattle(c, z.boss.id);
  assert.ok(c.battle && c.battle.monsterId === z.boss.id, 'the boss fight starts in town');
});
