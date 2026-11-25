// Checks a zone definition before it's saved. Returns a list of human-readable problems.
import { ELEMENTS } from '../data/elements.js';
import { WEAPON_TYPES, MAX_TIER } from '../data/items.js';
import { RACES } from '../data/races.js';
import { OVERWORLD_ID, slug } from '../data/zones.js';
import { KINGDOM_ZONE_ID } from '../data/kingdoms.js';

export const ARCHETYPES = ['brute', 'quick', 'tank', 'caster', 'balanced'];
export const ZONE_SIZE = [3, 40];
export const MAX_MONSTERS = 30;
export const MAX_LEVEL = 100000;

const isInt = (v) => Number.isInteger(v);

export function validateZone(def, allDefs) {
  const errors = [];
  const others = allDefs.filter((z) => z.id !== def.id);
  const byId = Object.fromEntries(allDefs.map((z) => [z.id, z]));
  byId[def.id] = def;

  if (!/^[a-z][a-z0-9-]{1,30}$/.test(def.id || '')) errors.push('Id must be 2 to 31 lowercase letters, numbers or dashes, starting with a letter.');
  // The Kingdom Zone is defined in code, and the Crossroads is its only way in (K1-B03).
  if (def.id === KINGDOM_ZONE_ID) errors.push(`The id "${KINGDOM_ZONE_ID}" is reserved for the Kingdom Lands.`);
  if (!String(def.name || '').trim()) errors.push('Give the zone a name.');
  if (!isInt(def.size) || def.size < ZONE_SIZE[0] || def.size > ZONE_SIZE[1]) errors.push(`Size must be ${ZONE_SIZE[0]} to ${ZONE_SIZE[1]}.`);
  const inBounds = (p) => p && isInt(p.x) && isInt(p.y) && p.x >= 1 && p.y >= 1 && p.x <= def.size && p.y <= def.size;
  for (const k of ['minLevel', 'exitLevel']) {
    if (!isInt(def[k] ?? 0) || (def[k] ?? 0) < 0) errors.push(`${k} must be a whole number of 0 or more.`);
  }

  if (def.town && !inBounds(def.town)) errors.push('The town is outside the zone.');
  if (def.town && !String(def.town.name || '').trim()) errors.push('Give the town a name.');
  if (!def.town && (def.starter || def.id === OVERWORLD_ID)) errors.push('Starter zones and the Overworld need a town.');
  if (!def.town && def.shop) errors.push('A shop needs a town.');
  if (def.shop) {
    const s = def.shop;
    if (!Array.isArray(s.tiers) || !s.tiers.length || s.tiers.some((t) => !isInt(t) || t < 1 || t > MAX_TIER)) errors.push(`Shop classes must be 1 to ${MAX_TIER}.`);
    if ((s.weapons || []).some((w) => !WEAPON_TYPES[w])) errors.push('Unknown weapon type in the shop.');
    if ((s.elements || []).some((e) => !ELEMENTS.includes(e))) errors.push('Unknown element in the shop.');
  }

  if (def.id !== OVERWORLD_ID) {
    if (def.overworld) {
      const ow = byId[OVERWORLD_ID];
      const [x, y] = def.overworld;
      if (!ow || !isInt(x) || !isInt(y) || x < 1 || y < 1 || x > ow.size || y > ow.size) errors.push('The Overworld position is outside the Overworld map.');
      const taken = others.find((z) => z.overworld && z.overworld[0] === x && z.overworld[1] === y);
      if (taken) errors.push(`${taken.name} already uses that Overworld position.`);
      if (ow?.town && ow.town.x === x && ow.town.y === y) errors.push('That Overworld position is the Overworld town.');
    }
    if (def.overworld && !inBounds(def.entry)) errors.push('The entry point must be inside the zone.');
  }
  if (def.entry && !inBounds(def.entry)) errors.push('The entry point must be inside the zone.');

  for (const l of def.lairs || []) if (!inBounds(l)) errors.push('A boss lair is outside the zone.');
  if ((def.lairs || []).length && !def.boss) errors.push('Boss lairs need a boss.');
  for (const p of def.portals || []) {
    if (!inBounds(p)) errors.push(`The path "${p.label || p.to}" is outside the zone.`);
    if (p.to === KINGDOM_ZONE_ID) { errors.push('Only the Crossroads leads to the Kingdom Lands.'); continue; }
    if (def.id === OVERWORLD_ID && def.town && p.x === def.town.x && p.y === def.town.y) {
      errors.push('The Overworld town is where the path to the Kingdom Lands goes. Put this path elsewhere.');
    }
    const target = byId[p.to];
    if (!target) errors.push(`A path leads to a zone that doesn't exist (${p.to}).`);
    else if (!isInt(p.tx) || !isInt(p.ty) || p.tx < 1 || p.ty < 1 || p.tx > target.size || p.ty > target.size) {
      errors.push(`The path "${p.label || p.to}" lands outside ${target.name}.`);
    }
  }

  const mons = def.monsters || [];
  if (mons.length > MAX_MONSTERS) errors.push(`At most ${MAX_MONSTERS} monsters per zone.`);
  const seen = new Set();
  for (const m of [...mons, ...(def.boss ? [def.boss] : [])]) {
    const label = m.name || '(unnamed)';
    if (!String(m.name || '').trim()) errors.push('Every monster needs a name.');
    const key = slug(m.name || '');
    if (seen.has(key)) errors.push(`Two monsters are named "${label}".`);
    seen.add(key);
    if (!isInt(m.level) || m.level < 1 || m.level > MAX_LEVEL) errors.push(`${label}: level must be 1 to ${MAX_LEVEL}.`);
    if (!ARCHETYPES.includes(m.arch)) errors.push(`${label}: pick a type.`);
    if (!String(m.verb || '').trim()) errors.push(`${label}: needs an attack verb, like "bites".`);
    if (m.element && !ELEMENTS.includes(m.element)) errors.push(`${label}: unknown element.`);
  }
  return errors;
}

// Zones that can't be deleted.
export function deleteBlockers(id, allDefs) {
  const out = [];
  if (id === OVERWORLD_ID) out.push('The Overworld can’t be deleted.');
  const race = Object.values(RACES).find((r) => r.startZone === id);
  if (race) out.push(`${race.name} heroes start here.`);
  const linked = allDefs.filter((z) => z.id !== id && (z.portals || []).some((p) => p.to === id));
  if (linked.length) out.push(`Paths lead here from ${linked.map((z) => z.name).join(', ')}.`);
  return out;
}

export function blankZone(id = 'new-zone') {
  return {
    id, name: 'New Zone', desc: '', size: 10, starter: false, pvp: false, minLevel: 20, exitLevel: 0,
    overworld: null, entry: { x: 5, y: 10 },
    town: { x: 5, y: 5, name: 'New Town' },
    shop: null, lairs: [], portals: [],
    monsters: [{ name: 'Wild Beast', level: 20, arch: 'brute', verb: 'mauls' }],
    boss: null,
  };
}
