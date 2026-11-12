// Character creation, stats, leveling, masteries and derived values.
import { STATS, BASE_STAT, POINTS_PER_LEVEL } from '../data/stats.js';
import { RACES } from '../data/races.js';
import { ITEMS, WEAPON_TYPES, SLOTS, itemDef } from '../data/items.js';
import { ZONES } from '../data/zones.js';
import { parseGem } from '../data/gems.js';
import {
  MASTERIES, masteryStart, masteryCap, masteryArmor, masteryGainChance,
} from '../data/masteries.js';

export const SAVE_VERSION = 1;
export const NAME_RE = /^[A-Za-z][A-Za-z '-]{1,17}$/;

export function createCharacter(name, raceId, now = Date.now()) {
  const race = RACES[raceId];
  if (!race) throw new Error('Unknown race');
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(clean)) throw new Error('Name must be 2–18 letters (spaces, - and \' allowed).');

  const stats = {};
  for (const s of STATS) stats[s] = BASE_STAT + (race.bonus[s] || 0);

  const char = {
    v: SAVE_VERSION,
    name: clean,
    race: raceId,
    level: 1,
    xp: 0,
    gold: 25,
    bank: 0,
    stats,
    masteries: {},
    pendingLevels: 0,
    hp: 0,
    loc: { zone: race.startZone, x: ZONES[race.startZone].town.x, y: ZONES[race.startZone].town.y },
    equipment: Object.fromEntries(SLOTS.map((s) => [s, null])),
    inventory: [],
    gems: {},
    nextUid: 1,
    battle: null,
    quest: null,
    questCooldownUntil: 0,
    kills: 0,
    deaths: 0,
    lastTick: now,
    createdAt: now,
  };
  ensureCharacter(char);
  for (const id of race.gear) {
    const item = addItem(char, id);
    char.equipment[ITEMS[id].slot] = item.uid;
  }
  char.hp = maxHp(char);
  return char;
}

// Fill in fields added after a hero was created, so older saves keep working.
export function ensureCharacter(char) {
  if (char.bank == null) char.bank = 0;
  if (!char.masteries) char.masteries = {};
  for (const m of MASTERIES) {
    if (char.masteries[m] == null) char.masteries[m] = masteryStart(char.race, m);
  }
  if (char.quest === undefined) char.quest = null;
  if (char.questCooldownUntil == null) char.questCooldownUntil = 0;
  return char;
}

export function addItem(char, baseId, quality = null) {
  const item = { uid: char.nextUid++, base: baseId, gems: [] };
  if (quality) item.q = quality;
  char.inventory.push(item);
  return item;
}

export function findItem(char, uid) {
  return char.inventory.find((i) => i.uid === uid) || null;
}

export function equippedItem(char, slot) {
  const uid = char.equipment[slot];
  return uid == null ? null : findItem(char, uid);
}

function socketedGems(char, excludeSlot = null) {
  const out = [];
  for (const slot of SLOTS) {
    if (slot === excludeSlot) continue;
    const item = equippedItem(char, slot);
    if (!item) continue;
    for (const key of item.gems) {
      const g = parseGem(key);
      if (g) out.push(g);
    }
  }
  return out;
}

// Non-stat gem effects, as percentages: { gold, xp, lifesteal, crit, armor }.
export function gemEffects(char) {
  const fx = { gold: 0, xp: 0, lifesteal: 0, crit: 0, armor: 0 };
  for (const g of socketedGems(char)) if (g.effect !== 'stat') fx[g.effect] += g.value;
  return fx;
}

// Flat stat bonuses from stat gems (which are percentages of your base stat).
export function gemBonuses(char, excludeSlot = null) {
  const pct = Object.fromEntries(STATS.map((s) => [s, 0]));
  for (const g of socketedGems(char, excludeSlot)) if (g.effect === 'stat') pct[g.stat] += g.value;
  const bonus = {};
  for (const s of STATS) bonus[s] = Math.round(char.stats[s] * pct[s] / 100);
  return bonus;
}

export function totalStats(char, excludeSlot = null) {
  const bonus = gemBonuses(char, excludeSlot);
  const out = {};
  for (const s of STATS) out[s] = char.stats[s] + bonus[s];
  return out;
}

export function maxHp(char) {
  return 20 + totalStats(char).vit * 8 + char.level * 5;
}

export function totalArmor(char) {
  let armor = 0;
  for (const slot of ['helm', 'body', 'boots']) {
    const item = equippedItem(char, slot);
    if (item) armor += itemDef(item).armor;
  }
  const m = char.masteries?.armor || 0;
  return Math.round(armor * masteryArmor(m) * (1 + gemEffects(char).armor / 100));
}

export function xpToNext(level) {
  return Math.round(40 * Math.pow(level, 1.6) + 10);
}

// Adds XP, banking level-ups for the player to spend. Returns levels gained.
export function gainXp(char, amount) {
  char.xp += amount;
  let gained = 0;
  while (char.xp >= xpToNext(char.level)) {
    char.xp -= xpToNext(char.level);
    char.level += 1;
    char.pendingLevels += 1;
    gained += 1;
  }
  if (gained) char.hp = maxHp(char); // full heal on level up
  return gained;
}

// choice: a stat key (all points into it) or 'all' (split evenly).
export function spendLevel(char, choice) {
  if (char.pendingLevels <= 0) throw new Error('No level-up points to spend.');
  if (choice === 'all') {
    const each = POINTS_PER_LEVEL / STATS.length;
    for (const s of STATS) char.stats[s] += each;
  } else if (STATS.includes(choice)) {
    char.stats[choice] += POINTS_PER_LEVEL;
  } else {
    throw new Error('Invalid stat choice.');
  }
  char.pendingLevels -= 1;
  char.hp = maxHp(char);
}

// Accepts an item instance or a shop base id.
export function meetsRequirements(char, itemOrBaseId) {
  const def = typeof itemOrBaseId === 'string' ? ITEMS[itemOrBaseId] : itemDef(itemOrBaseId);
  const stats = totalStats(char, def.slot);
  const missing = [];
  for (const [s, need] of Object.entries(def.req)) {
    if (stats[s] < need) missing.push({ stat: s, need, have: stats[s] });
  }
  return { ok: missing.length === 0, missing };
}

export function playerCombatant(char) {
  const stats = totalStats(char);
  const weapon = equippedItem(char, 'weapon');
  const focus = equippedItem(char, 'focus');
  const ms = char.masteries || {};
  const fx = gemEffects(char);

  let melee = { power: 1, type: 'fists', mastery: 0, hitBonus: 0, crit: 0.05, pierce: 0 };
  if (weapon) {
    const def = itemDef(weapon);
    const wt = WEAPON_TYPES[def.type];
    melee = { power: def.power, type: def.type, mastery: ms[def.type] || 0, hitBonus: wt.hitBonus, crit: wt.crit, pierce: wt.pierce };
  }
  melee.crit += fx.crit / 100;

  let spell = { power: 2, element: 'arcane', mastery: 0, crit: 0.05 + fx.crit / 100 };
  if (focus) {
    const def = itemDef(focus);
    spell = { power: def.power, element: def.element, mastery: ms[def.element] || 0, crit: 0.05 + fx.crit / 100 };
  }

  return {
    name: char.name, level: char.level, stats, armor: totalArmor(char), element: null,
    maxHp: maxHp(char), melee, spell, lifesteal: fx.lifesteal / 100,
  };
}

// Try to raise a mastery after a successful hit (or after being hit, for armor).
// Returns the new value if it went up, otherwise null.
export function trainMastery(char, m, rng, bonus = 0) {
  if (!m || !char.masteries || char.masteries[m] == null) return null;
  const cap = masteryCap(char.race, m);
  const cur = char.masteries[m];
  if (cur >= cap) return null;
  let gain = bonus;
  if (rng() < masteryGainChance(cur)) gain += 1;
  if (!gain) return null;
  char.masteries[m] = Math.min(cap, cur + gain);
  return char.masteries[m];
}

// Out of combat you slowly recover: 1% of max HP every 3 seconds.
const REGEN_MS = 3000;
export function applyRegen(char, now = Date.now()) {
  const elapsed = now - (char.lastTick || now);
  const ticks = Math.floor(elapsed / REGEN_MS);
  if (ticks <= 0) return;
  char.lastTick += ticks * REGEN_MS;
  if (char.battle && !char.battle.over) return;
  const max = maxHp(char);
  char.hp = Math.min(max, char.hp + Math.ceil(max * 0.01) * ticks);
}

export function healCost(char) {
  return Math.ceil((maxHp(char) - char.hp) * 0.15);
}

// Dying: lose all carried gold (banked gold is safe) and 20% of a level's worth of
// experience. You can never lose a level.
export function deathPenalty(char) {
  const goldLost = char.gold;
  const xpLost = Math.min(char.xp, Math.floor(xpToNext(char.level) * 0.2));
  char.gold = 0;
  char.xp -= xpLost;
  char.deaths += 1;
  return { goldLost, xpLost };
}
