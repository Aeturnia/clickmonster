// World bosses ("hunts"): one shared health pool that every player chips away at.
// The boss strikes back at roughly your own level, so anyone can join in, and your
// damage to the shared pool is scaled by level so lower-level heroes still matter.
import { playerCombatant, maxHp, trainMastery, deathPenalty } from './character.js';
import { resolveAttack } from './combat.js';
import { respawnPoint } from './world.js';
import { SPELL_NAME } from '../data/elements.js';
import { clamp } from './util.js';
import { KINGDOM_ZONE_ID } from '../data/kingdoms.js';

export const HUNT_COUNTER_LEVEL_GAP = 5; // the boss fights back as if at most this far above you

export function huntCombatant(hunt, forLevel) {
  const level = Math.max(1, Math.min(hunt.level, forLevel + HUNT_COUNTER_LEVEL_GAP));
  const budget = (15 + level * 9) * 1.8;
  const w = { str: 0.32, dex: 0.18, int: 0.12, wis: 0.12, vit: 0.26 };
  const stats = {};
  for (const k of Object.keys(w)) stats[k] = Math.max(1, Math.round(budget * w[k]));
  const power = 1 + level * 1.4;
  return {
    name: hunt.name, level, stats, armor: Math.round(level * 1.2), element: null,
    melee: { power, mastery: 0, hitBonus: 0, crit: 0.08, pierce: 0 },
    spell: { power, mastery: 0, element: 'arcane', crit: 0.05 },
  };
}

// How much of a hero's raw damage counts against the shared health pool.
export function sharedDamage(raw, huntLevel, heroLevel) {
  return Math.round(raw * clamp(huntLevel / Math.max(1, heroLevel), 0.5, 4));
}

// Suggested health for a hunt: about 300 average hits from heroes at its level.
export function suggestedHuntHp(level) {
  return Math.round((level * 0.6 * 9 * 0.3 + 3 + level * 2) * 1.3 * 300);
}

export function startHuntBattle(char, hunt) {
  if (char.battle && !char.battle.over) throw new Error('You are already fighting!');
  if (char.hp <= 0) throw new Error('You are too weak to fight. Rest or visit a healer.');
  if (hunt.zone !== char.loc.zone) throw new Error('That hunt is not in this zone.');
  // No hunt runs in the Kingdom Lands (5.1.1): the admin console can't start one there, and a hunt
  // row placed there some other way still can't be joined (K1-ENG02).
  if (char.loc.zone === KINGDOM_ZONE_ID) throw new Error('No hunt can be fought in the Kingdom Lands.');
  char.battle = {
    hunt: hunt.id, name: hunt.name, level: hunt.level, hp: hunt.hp, maxHp: hunt.max_hp ?? hunt.maxHp,
    myDamage: 0, turn: 0, over: null, masteryUps: {},
    log: [{ kind: 'elite', text: `You join the hunt for ${hunt.name}!` }],
  };
  return char.battle;
}

// One exchange: you attack, then the boss strikes back. Returns the shared damage dealt.
export function huntExchange(char, hunt, mode, rng = Math.random) {
  const b = char.battle;
  if (!b || !b.hunt || b.over) throw new Error('You are not in a hunt.');
  b.turn += 1;
  const log = (kind, text) => b.log.push({ kind, text });
  if (mode === 'flee') {
    log('info', `You fall back from ${hunt.name}.`);
    b.over = 'fled';
    return 0;
  }
  const player = playerCombatant(char);
  const boss = huntCombatant(hunt, char.level);
  const r = resolveAttack(player, boss, mode, rng);
  let shared = 0;
  if (!r.hit) log('miss', mode === 'cast' ? 'Your spell fizzles!' : `You miss ${hunt.name}.`);
  else {
    shared = sharedDamage(r.damage, hunt.level, char.level);
    const verb = mode === 'cast' ? `Your ${SPELL_NAME[player.spell.element]} strikes` : 'You hit';
    log('player', `${r.crit ? 'Critical! ' : ''}${verb} ${hunt.name} for ${shared}!`);
    const m = mode === 'melee' ? player.melee.type : player.spell.element;
    const up = trainMastery(char, m, rng);
    if (up != null) b.masteryUps[m] = up;
  }
  b.myDamage += shared;

  const br = resolveAttack(boss, player, rng() < 0.7 ? 'melee' : 'cast', rng);
  if (!br.hit) log('miss', `${hunt.name} misses you.`);
  else log('monster', `${br.crit ? 'A crushing blow! ' : ''}${hunt.name} strikes you for ${br.damage}!`);
  char.hp = Math.max(0, char.hp - br.damage);
  if (char.hp <= 0) {
    const { goldLost } = deathPenalty(char);
    char.loc = respawnPoint(char);
    char.hp = Math.ceil(maxHp(char) * 0.3);
    log('bad', `${hunt.name} has defeated you…`);
    log('bad', `You wake up in town${goldLost ? `, having lost ${goldLost} gold` : ''}. Your damage still counts toward the hunt.`);
    b.over = 'defeat';
  }
  return shared;
}

// Split a hunt's reward pool by damage share. Everyone who landed a hit gets at least 2%.
export function huntShares(hits, reward) {
  const total = hits.reduce((a, h) => a + Number(h.damage), 0) || 1;
  return hits.filter((h) => Number(h.damage) > 0).map((h) => {
    const share = Math.max(0.02, Number(h.damage) / total);
    return {
      character_id: h.character_id, name: h.name, share,
      gold: Math.round((reward.gold || 0) * share),
      xp: Math.round((reward.xp || 0) * share),
    };
  });
}
