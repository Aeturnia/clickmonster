// Kingdoms K-1: the rules for claiming and releasing a plot (#83; docs/kingdoms-scope.md 5.3 to
// 5.5; docs/kingdoms-k1-plan.md 2.2). Shared by the browser and the `game` function; the server
// is authoritative. The plot itself is held in the database (kingdom_plots), and each change that
// crosses the plot and the hero commits in one transaction (kingdom_claim(), kingdom_release()).
// These rules change only the hero's data, before that commit.
//
// The invariant I-1: char.kingdom exists if and only if the hero holds a claimed plot, and
// char.kingdom.plot is that plot. Only claimKingdom() and releaseKingdom() add or remove it.
import { KINGDOM_ZONE_ID, KINGDOM_SIZE, kingdomConfig, kingdomsOpen } from '../data/kingdoms.js';

export const KINGDOMS_CLOSED = 'Kingdoms aren’t open yet.';
export const KINGDOM_ELSEWHERE = 'Travel to the Kingdom Lands to manage your Kingdom.';

export function inKingdomZone(char) {
  return char?.loc?.zone === KINGDOM_ZONE_ID;
}

export function hasKingdom(char) {
  return !!char?.kingdom && typeof char.kingdom === 'object';
}

// Every Kingdom action needs Kingdoms open, the hero in the Kingdom Zone (K-D12), and no fight
// under way.
function ready(char, config) {
  if (!kingdomsOpen(config)) throw new Error(KINGDOMS_CLOSED);
  if (!inKingdomZone(char)) throw new Error(KINGDOM_ELSEWHERE);
  if (char.battle && !char.battle.over) throw new Error('You can’t do that in the middle of a fight!');
}

// Claim the plot at (x, y). The cost is paid from carried gold, as every other purchase is (the
// K-1 report records this choice). Returns the gold spent. Whether the plot is free is decided by
// the database, in the claim's own transaction: this only checks what the hero's data can tell.
export function claimKingdom(char, x, y, now, config = kingdomConfig()) {
  ready(char, config);
  const px = Number(x);
  const py = Number(y);
  if (!Number.isInteger(px) || !Number.isInteger(py) || px < 1 || py < 1 || px > KINGDOM_SIZE || py > KINGDOM_SIZE) {
    throw new Error('Choose a plot on the plot map.');
  }
  if (hasKingdom(char)) throw new Error('You already have a Kingdom.');
  if (char.level < config.minLevel) throw new Error(`You must be level ${config.minLevel} to claim a plot.`);
  if ((char.gold || 0) < config.cost) throw new Error(`Claiming a plot costs ${config.cost} gold.`);
  char.gold -= config.cost;
  char.kingdom = { plot: { x: px, y: py }, claimedAt: now };
  return config.cost;
}

// Release the hero's Kingdom: its plot, and everything on it, are lost (K-D5). There's no refund.
export function releaseKingdom(char, config = kingdomConfig()) {
  ready(char, config);
  if (!hasKingdom(char)) throw new Error('You don’t have a Kingdom.');
  delete char.kingdom;
}
