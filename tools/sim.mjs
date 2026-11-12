// Balance simulator: node tools/sim.mjs
// Builds characters of several build styles at various levels, gives them the best
// gear they qualify for, and fights every monster near their level.
import { createCharacter, spendLevel, addItem, meetsRequirements, maxHp, xpToNext } from '../public/js/engine/character.js';
import { MONSTERS } from '../public/js/data/zones.js';
import { ITEMS, TIER_LEVEL } from '../public/js/data/items.js';
import { masteryCap } from '../public/js/data/masteries.js';
import { monsterCombatant } from '../public/js/engine/monster.js';
import { battleAction, xpReward } from '../public/js/engine/battle.js';

const BUILDS = {
  'human all': { race: 'human', plan: () => 'all', mode: 'melee', weapon: 'sword' },
  'orc str/vit': { race: 'orc', plan: (l) => (l % 2 ? 'str' : 'vit'), mode: 'melee', weapon: 'mace' },
  'orc pure str': { race: 'orc', plan: () => 'str', mode: 'melee', weapon: 'mace' },
  'halfling dex/str/vit': { race: 'halfling', plan: (l) => ['dex', 'str', 'vit'][l % 3], mode: 'melee', weapon: 'dagger' },
  'elf int/wis/vit': { race: 'elf', plan: (l) => ['int', 'wis', 'vit'][l % 3], mode: 'cast', element: 'frost' },
  'gnome int/vit': { race: 'gnome', plan: (l) => (l % 2 ? 'int' : 'vit'), mode: 'cast', element: 'fire' },
};

function build(b, level) {
  const c = createCharacter('Sim', b.race);
  for (let l = 2; l <= level; l++) { c.level = l; c.pendingLevels = 1; spendLevel(c, b.plan(l)); }
  const slots = b.mode === 'melee' ? [['weapon', b.weapon]] : [['focus', `focus_${b.element}`]];
  for (const s of ['helm', 'body', 'boots']) slots.push([s, s]);
  for (const [slot, prefix] of slots) {
    for (let t = 10; t >= 1; t--) {
      const id = `${prefix}_${t}`;
      if (TIER_LEVEL[t] > level + 2) continue;
      if (!meetsRequirements(c, id).ok) continue;
      c.equipment[slot] = addItem(c, id).uid;
      break;
    }
  }
  // Typical mastery for this level: grows ~2 per level in the main skill, ~1.2 in armor.
  const main = b.mode === 'melee' ? b.weapon : b.element;
  c.masteries[main] = Math.min(masteryCap(b.race, main), c.masteries[main] + Math.round(level * 2));
  c.masteries.armor = Math.min(masteryCap(b.race, 'armor'), c.masteries.armor + Math.round(level * 1.2));
  c.hp = maxHp(c);
  return c;
}

function fight(b, level, monId, n = 300) {
  let wins = 0, turns = 0, hpLost = 0;
  for (let i = 0; i < n; i++) {
    const c = build(b, level);
    const mon = monsterCombatant(monId);
    c.battle = { monsterId: monId, hp: mon.maxHp, maxHp: mon.maxHp, turn: 0, over: null, log: [], masteryUps: {} };
    const start = c.hp;
    while (!c.battle.over && c.battle.turn < 60) battleAction(c, b.mode === 'melee' ? 'melee' : 'cast');
    if (c.battle.over === 'victory') { wins++; hpLost += (start - c.hp) / start; }
    turns += c.battle.turn;
  }
  return { win: wins / n, turns: turns / n, hpLost: wins ? hpLost / wins : 1 };
}

const levels = [1, 5, 10, 15, 20, 30, 45, 60];
const allMon = Object.values(MONSTERS).filter((m) => !m.boss);
for (const [name, b] of Object.entries(BUILDS)) {
  console.log(`\n== ${name}`);
  for (const L of levels) {
    const near = allMon.filter((m) => Math.abs(m.level - L) <= 1).slice(0, 4);
    const res = near.map((m) => ({ m, ...fight(b, L, m.id, 150) }));
    const avg = (k) => (res.reduce((a, r) => a + r[k], 0) / res.length);
    console.log(`L${String(L).padEnd(3)} win ${(avg('win') * 100).toFixed(0).padStart(3)}%  turns ${avg('turns').toFixed(1).padStart(4)}  hp lost/win ${(avg('hpLost') * 100).toFixed(0).padStart(3)}%   ` +
      res.map((r) => `${r.m.name}(${r.m.level}) ${(r.win * 100).toFixed(0)}%`).join(', '));
  }
}

console.log('\n== Bosses (fought at boss level)');
for (const [name, b] of Object.entries(BUILDS)) {
  const row = Object.values(MONSTERS).filter((m) => m.boss).slice(0, 7)
    .map((m) => `${m.name.split(' ')[0]}(${m.level}) ${(fight(b, m.level, m.id, 100).win * 100).toFixed(0)}%`);
  console.log(`${name.padEnd(22)} ${row.join('  ')}`);
}

console.log('\n== Kills of equal-level monsters per level');
console.log([1, 5, 10, 15, 19, 30, 50].map((L) => `L${L}: ${(xpToNext(L) / xpReward(L, L, false)).toFixed(1)}`).join('  '));
