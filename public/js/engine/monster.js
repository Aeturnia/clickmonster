// Turns a compact monster definition into a full combatant with stats.
import { MONSTERS } from '../data/zones.js';

const ARCHETYPES = {
  brute: { str: 0.34, dex: 0.16, int: 0.02, wis: 0.1, vit: 0.38 },
  quick: { str: 0.26, dex: 0.34, int: 0.02, wis: 0.12, vit: 0.26 },
  tank: { str: 0.22, dex: 0.12, int: 0.02, wis: 0.1, vit: 0.54 },
  caster: { str: 0.04, dex: 0.14, int: 0.36, wis: 0.26, vit: 0.2 },
  balanced: { str: 0.26, dex: 0.2, int: 0.06, wis: 0.14, vit: 0.34 },
};

export function monsterCombatant(id) {
  const def = MONSTERS[id];
  if (!def) throw new Error(`Unknown monster ${id}`);
  const w = ARCHETYPES[def.arch];
  const budget = (15 + def.level * 9) * (def.boss ? 1.4 : 1);
  const stats = {};
  for (const k of Object.keys(w)) stats[k] = Math.max(1, Math.round(budget * w[k]));
  const power = 1 + def.level * 1.2;
  return {
    id,
    def,
    name: def.name,
    level: def.level,
    stats,
    maxHp: Math.round((10 + stats.vit * 4 + def.level * 3) * (def.boss ? 1.4 : 1)),
    armor: Math.round(def.level * (def.arch === 'tank' ? 1.5 : 0.8)),
    element: def.element || null,
    attackMode: def.arch === 'caster' ? 'cast' : 'melee',
    melee: { power, prof: false, hitBonus: 0, crit: 0.05, pierce: 0 },
    spell: { power, prof: false, element: def.element || 'arcane' },
  };
}

// "the Field Rat" vs. "Gorrath the Bandit King"
export function theName(def, capital = false) {
  if (def.proper) return def.name;
  return `${capital ? 'The' : 'the'} ${def.name}`;
}

export function aName(def) {
  if (def.proper) return def.name;
  return /^[aeiou]/i.test(def.name) ? `an ${def.name}` : `a ${def.name}`;
}
