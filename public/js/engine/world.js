// Movement, zones, features and towns.
import { ZONES } from '../data/zones.js';
import { healCost, maxHp } from './character.js';

export const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function currentZone(char) {
  return ZONES[char.loc.zone];
}

export function featuresAt(zone, x, y) {
  const out = [];
  if (zone.town && zone.town.x === x && zone.town.y === y) out.push({ type: 'town', ...zone.town });
  for (const f of zone.features) if (f.x === x && f.y === y) out.push(f);
  return out;
}

export function inTown(char) {
  const z = currentZone(char);
  return !!z.town && z.town.x === char.loc.x && z.town.y === char.loc.y;
}

export function monstersHere(char) {
  const zone = currentZone(char);
  const list = [...zone.monsters];
  if (zone.boss && featuresAt(zone, char.loc.x, char.loc.y).some((f) => f.type === 'lair')) list.push(zone.boss);
  return list;
}

export function move(char, dir) {
  if (char.battle && !char.battle.over) throw new Error('You can’t leave in the middle of a fight!');
  const d = DIRS[dir];
  if (!d) throw new Error('Bad direction');
  const zone = currentZone(char);
  const x = char.loc.x + d[0];
  const y = char.loc.y + d[1];
  if (x < 1 || y < 1 || x > zone.size || y > zone.size) throw new Error('You can’t go that way.');
  char.loc.x = x;
  char.loc.y = y;
  char.battle = null;
}

export function usePortal(char) {
  if (char.battle && !char.battle.over) throw new Error('You can’t leave in the middle of a fight!');
  const zone = currentZone(char);
  const portal = featuresAt(zone, char.loc.x, char.loc.y).find((f) => f.type === 'portal');
  if (!portal) throw new Error('There is no path here.');
  if (char.level < portal.minLevel) throw new Error(`You must be level ${portal.minLevel} to travel this way.`);
  char.loc = { zone: portal.to, x: portal.tx, y: portal.ty };
  char.battle = null;
  return ZONES[portal.to];
}

export function heal(char) {
  if (!inTown(char)) throw new Error('The healer is in town.');
  const cost = healCost(char);
  if (cost <= 0) throw new Error('You are already at full health.');
  if (char.gold < cost) throw new Error(`Healing costs ${cost} gold.`);
  char.gold -= cost;
  char.hp = maxHp(char);
  return cost;
}

// Where you wake up after being defeated.
export function respawnPoint(char) {
  const zone = currentZone(char);
  return { zone: zone.id, x: zone.town.x, y: zone.town.y };
}

// Direction hint from the player to a cell, e.g. "2E 3S" or "here".
export function directionTo(char, x, y) {
  const dx = x - char.loc.x;
  const dy = y - char.loc.y;
  if (!dx && !dy) return 'here';
  const parts = [];
  if (dy) parts.push(`${Math.abs(dy)}${dy < 0 ? 'N' : 'S'}`);
  if (dx) parts.push(`${Math.abs(dx)}${dx < 0 ? 'W' : 'E'}`);
  return parts.join(' ');
}
