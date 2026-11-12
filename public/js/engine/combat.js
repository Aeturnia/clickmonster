// Combat math. Uses ratios against the defender rather than flat values,
// so it keeps working with uncapped stats.
//
// A "combatant" is: { name, level, stats, armor, element, melee, spell, lifesteal? }
//   melee: { power, mastery, hitBonus, crit, pierce }
//   spell: { power, mastery, element, crit }
import { clamp, randRange } from './util.js';
import { elementMultiplier } from '../data/elements.js';
import { masteryDamage, masteryHit, masteryCrit } from '../data/masteries.js';

// Equal stats => 70%. Far ahead => up to 95%. Far behind => down to ~45%.
function contest(att, def) {
  return 0.7 + 0.25 * (att - def) / (att + def);
}

export function hitChance(attackerDex, defenderDex, bonus = 0) {
  return clamp(contest(attackerDex, defenderDex) + bonus, 0.1, 0.95);
}

export function castChance(attackerWis, defenderWis, bonus = 0) {
  return clamp(contest(attackerWis, defenderWis) + bonus, 0.1, 0.95);
}

// Fraction of damage blocked by armor, relative to the attacker's level.
export function mitigation(armor, attackerLevel) {
  return Math.min(0.75, armor / (armor + attackerLevel * 5 + 25));
}

export function meleeChance(att, def) {
  return hitChance(att.stats.dex, def.stats.dex, att.melee.hitBonus + masteryHit(att.melee.mastery || 0));
}

export function spellChance(att, def) {
  return castChance(att.stats.wis, def.stats.wis, masteryHit(att.spell.mastery || 0));
}

export function meleeBase(att) {
  return (att.stats.str * 0.6 + att.melee.power) * masteryDamage(att.melee.mastery || 0);
}

export function spellBase(att) {
  return (att.stats.int * 0.65 + att.spell.power) * masteryDamage(att.spell.mastery || 0);
}

// Resolve one attack. Returns { hit, damage, crit, elementMult }.
export function resolveAttack(att, def, mode, rng) {
  if (mode === 'melee') {
    if (rng() > meleeChance(att, def)) return { hit: false, damage: 0 };
    let dmg = meleeBase(att) * randRange(rng, 0.85, 1.15);
    const crit = rng() < att.melee.crit + masteryCrit(att.melee.mastery || 0);
    if (crit) dmg *= 1.5;
    dmg *= 1 - mitigation(def.armor, att.level) * (1 - att.melee.pierce);
    return { hit: true, damage: Math.max(1, Math.round(dmg)), crit };
  }
  if (rng() > spellChance(att, def)) return { hit: false, damage: 0, fizzle: true };
  const elementMult = elementMultiplier(att.spell.element, def.element);
  let dmg = spellBase(att) * elementMult * randRange(rng, 0.85, 1.15);
  const crit = rng() < (att.spell.crit ?? 0.05) + masteryCrit(att.spell.mastery || 0);
  if (crit) dmg *= 1.5;
  // Magic is only half-stopped by armor.
  dmg *= 1 - mitigation(def.armor, att.level) * 0.5;
  return { hit: true, damage: Math.max(1, Math.round(dmg)), crit, elementMult };
}
