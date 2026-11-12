// Player-vs-player duels. Only allowed in PvP zones, outside towns.
// The defender doesn't need to be online: the duel resolves automatically, with each
// side using whichever attack (melee or cast) is expected to do more damage.
import { playerCombatant, maxHp } from './character.js';
import { resolveAttack, meleeChance, spellChance, meleeBase, spellBase } from './combat.js';
import { currentZone, inTown, respawnPoint } from './world.js';

export const PVP_LEVEL_GAP = 10; // can't attack players more than this many levels below you
const MAX_ROUNDS = 30;

export function canAttack(attacker, defender) {
  const zone = currentZone(attacker);
  if (!zone.pvp) return { ok: false, reason: 'This is not a PvP zone.' };
  if (inTown(attacker)) return { ok: false, reason: 'Towns are safe — no fighting here.' };
  const same = attacker.loc.zone === defender.loc.zone && attacker.loc.x === defender.loc.x && attacker.loc.y === defender.loc.y;
  if (!same) return { ok: false, reason: 'They are no longer here.' };
  if (attacker.battle && !attacker.battle.over) return { ok: false, reason: 'Finish your current fight first.' };
  if (attacker.hp <= 0) return { ok: false, reason: 'You are too weak to fight.' };
  if (defender.hp <= 0) return { ok: false, reason: 'They are already down.' };
  if (defender.level < attacker.level - PVP_LEVEL_GAP) return { ok: false, reason: `You can't attack players more than ${PVP_LEVEL_GAP} levels below you.` };
  return { ok: true };
}

function bestMode(att, def) {
  const melee = meleeChance(att, def) * meleeBase(att);
  const cast = spellChance(att, def) * spellBase(att);
  return cast > melee ? 'cast' : 'melee';
}

// Mutates both characters. Returns { winner: 'attacker'|'defender', log, goldTaken }.
export function duel(attacker, defender, rng = Math.random) {
  const check = canAttack(attacker, defender);
  if (!check.ok) throw new Error(check.reason);
  const a = playerCombatant(attacker);
  const d = playerCombatant(defender);
  const aMode = bestMode(a, d);
  const dMode = bestMode(d, a);
  const log = [{ kind: 'info', text: `You challenge ${defender.name} (Lv ${defender.level})!` }];
  let aHp = attacker.hp;
  let dHp = defender.hp;

  for (let round = 0; round < MAX_ROUNDS && aHp > 0 && dHp > 0; round++) {
    const r1 = resolveAttack(a, d, aMode, rng);
    dHp -= r1.damage;
    log.push(r1.hit
      ? { kind: 'player', text: `${r1.crit ? 'Critical! ' : ''}You ${aMode === 'cast' ? 'blast' : 'hit'} ${defender.name} for ${r1.damage}!` }
      : { kind: 'miss', text: aMode === 'cast' ? 'Your spell fizzles!' : `You miss ${defender.name}.` });
    if (dHp <= 0) break;
    const r2 = resolveAttack(d, a, dMode, rng);
    aHp -= r2.damage;
    log.push(r2.hit
      ? { kind: 'monster', text: `${r2.crit ? 'Critical! ' : ''}${defender.name} ${dMode === 'cast' ? 'blasts' : 'hits'} you for ${r2.damage}!` }
      : { kind: 'miss', text: `${defender.name} ${dMode === 'cast' ? 'fumbles a spell' : 'misses you'}.` });
  }

  // If time runs out, whoever has the larger share of their health left wins.
  let attackerWins;
  if (dHp <= 0) attackerWins = true;
  else if (aHp <= 0) attackerWins = false;
  else attackerWins = aHp / maxHp(attacker) >= dHp / maxHp(defender);

  const winner = attackerWins ? attacker : defender;
  const loser = attackerWins ? defender : attacker;
  winner.hp = Math.max(1, attackerWins ? aHp : dHp);
  const goldTaken = Math.floor(loser.gold * 0.1);
  loser.gold -= goldTaken;
  winner.gold += goldTaken;
  loser.hp = Math.ceil(maxHp(loser) * 0.3);
  loser.loc = respawnPoint(loser);
  loser.battle = null;
  loser.deaths += 1;
  winner.pvpWins = (winner.pvpWins || 0) + 1;

  log.push(attackerWins
    ? { kind: 'win', text: `Victory! ${defender.name} has been defeated!` }
    : { kind: 'bad', text: `You have been defeated by ${defender.name}…` });
  if (goldTaken) {
    log.push(attackerWins
      ? { kind: 'reward', text: `You take ${goldTaken} gold from ${defender.name}.` }
      : { kind: 'bad', text: `${defender.name} takes ${goldTaken} of your gold. You wake up in town.` });
  } else if (!attackerWins) {
    log.push({ kind: 'bad', text: 'You wake up in town.' });
  }

  // Show the duel to the attacker as a finished battle.
  attacker.battle = { pvp: true, opponent: defender.name, over: attackerWins ? 'victory' : 'defeat', log, turn: 0 };
  // Let the defender know what happened next time they look.
  defender.notices = [...(defender.notices || []).slice(-9), {
    at: Date.now(),
    text: attackerWins
      ? `${attacker.name} attacked and defeated you${goldTaken ? `, taking ${goldTaken} gold` : ''}.`
      : `${attacker.name} attacked you, and you won${goldTaken ? `, taking ${goldTaken} gold` : ''}!`,
  }];
  return { winner: attackerWins ? 'attacker' : 'defender', log, goldTaken };
}
