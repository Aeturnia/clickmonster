// Turns a compact monster definition into a full combatant with stats.
import { MONSTERS } from '../data/zones.js';
import { VARIANTS } from '../data/variants.js';

const ARCHETYPES = {
  brute: { str: 0.34, dex: 0.16, int: 0.02, wis: 0.1, vit: 0.38 },
  quick: { str: 0.26, dex: 0.34, int: 0.02, wis: 0.12, vit: 0.26 },
  tank: { str: 0.22, dex: 0.12, int: 0.02, wis: 0.1, vit: 0.54 },
  caster: { str: 0.04, dex: 0.14, int: 0.36, wis: 0.26, vit: 0.2 },
  balanced: { str: 0.26, dex: 0.2, int: 0.06, wis: 0.14, vit: 0.34 },
};

// variant: optional elite variant id (see data/variants.js).
export function monsterCombatant(id, variant = null) {
  const base = MONSTERS[id];
  if (!base) throw new Error(`Unknown monster ${id}`);
  const v = variant ? VARIANTS[variant] : null;
  const def = v ? { ...base, name: `${v.name} ${base.name}`, variant } : base;
  const w = ARCHETYPES[base.arch];
  const budget = (15 + base.level * 9) * (base.boss ? 1.6 : 1) * (v?.stats || 1);
  const stats = {};
  for (const k of Object.keys(w)) stats[k] = Math.max(1, Math.round(budget * w[k] * (v?.[k] || 1)));
  const power = 1 + base.level * 1.2;
  const caster = base.arch === 'caster' || !!v?.caster;
  return {
    id,
    def,
    variant,
    name: def.name,
    level: base.level,
    stats,
    maxHp: Math.round((10 + stats.vit * 4 + base.level * 3) * (base.boss ? 1.6 : 1) * (v?.hp || 1)),
    armor: Math.round(base.level * (base.arch === 'tank' ? 1.5 : 0.8) * (v?.armor || 1)),
    element: base.element || null,
    attackMode: caster ? 'cast' : 'melee',
    melee: { power, mastery: 0, hitBonus: 0, crit: 0.05, pierce: 0 },
    spell: { power, mastery: 0, element: base.element || 'arcane', crit: 0.05 },
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
