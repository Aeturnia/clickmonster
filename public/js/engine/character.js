// Character creation, stats, leveling and derived values.
import { STATS, BASE_STAT, POINTS_PER_LEVEL } from '../data/stats.js';
import { RACES } from '../data/races.js';
import { ITEMS, WEAPON_TYPES, SLOTS } from '../data/items.js';
import { ZONES } from '../data/zones.js';
import { parseGem } from '../data/gems.js';

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
    stats,
    pendingLevels: 0,
    hp: 0,
    loc: { zone: race.startZone, ...ZONES[race.startZone].town },
    equipment: Object.fromEntries(SLOTS.map((s) => [s, null])),
    inventory: [],
    gems: {},
    nextUid: 1,
    battle: null,
    kills: 0,
    deaths: 0,
    lastTick: now,
    createdAt: now,
  };
  delete char.loc.name;
  for (const id of race.gear) {
    const item = addItem(char, id);
    char.equipment[ITEMS[id].slot] = item.uid;
  }
  char.hp = maxHp(char);
  return char;
}

export function addItem(char, baseId) {
  const item = { uid: char.nextUid++, base: baseId, gems: [] };
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

// Stat bonuses from gems socketed into equipped gear.
export function gemBonuses(char, excludeSlot = null) {
  const bonus = Object.fromEntries(STATS.map((s) => [s, 0]));
  for (const slot of SLOTS) {
    if (slot === excludeSlot) continue;
    const item = equippedItem(char, slot);
    if (!item) continue;
    for (const key of item.gems) {
      const g = parseGem(key);
      if (g) bonus[g.stat] += g.bonus;
    }
  }
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
    if (item) armor += ITEMS[item.base].armor;
  }
  const race = RACES[char.race];
  return Math.round(armor * (1 + (race.armorBonus || 0)));
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

export function meetsRequirements(char, baseId) {
  const item = ITEMS[baseId];
  const stats = totalStats(char, item.slot);
  const missing = [];
  for (const [s, need] of Object.entries(item.req)) {
    if (stats[s] < need) missing.push({ stat: s, need, have: stats[s] });
  }
  return { ok: missing.length === 0, missing };
}

export function playerCombatant(char) {
  const race = RACES[char.race];
  const stats = totalStats(char);
  const weapon = equippedItem(char, 'weapon');
  const focus = equippedItem(char, 'focus');

  let melee = { power: 1, prof: false, hitBonus: 0, crit: 0.05, pierce: 0, type: 'fists' };
  if (weapon) {
    const base = ITEMS[weapon.base];
    const wt = WEAPON_TYPES[base.type];
    melee = {
      power: base.power, type: base.type, hitBonus: wt.hitBonus, crit: wt.crit, pierce: wt.pierce,
      prof: race.affinity.kind === 'weapon' && race.affinity.type === base.type,
    };
  }

  let spell = { power: 2, prof: false, element: 'arcane' };
  if (focus) {
    const base = ITEMS[focus.base];
    spell = {
      power: base.power, element: base.element,
      prof: race.affinity.kind === 'element' && race.affinity.element === base.element,
    };
  }

  return {
    name: char.name, level: char.level, stats, armor: totalArmor(char), element: null,
    maxHp: maxHp(char), melee, spell,
  };
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
