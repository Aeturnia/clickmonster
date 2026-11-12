// Turn-based battles: player acts, then the monster answers.
import { MONSTERS } from '../data/zones.js';
import { SPELL_NAME } from '../data/elements.js';
import { GEM_TYPES, gemTierForLevel } from '../data/gems.js';
import { monsterCombatant, theName, aName } from './monster.js';
import { playerCombatant, gainXp, maxHp } from './character.js';
import { resolveAttack } from './combat.js';
import { monstersHere, respawnPoint } from './world.js';
import { randInt, pick, clamp } from './util.js';

export function startBattle(char, monsterId) {
  if (char.battle && !char.battle.over) throw new Error('You are already fighting!');
  if (!monstersHere(char).some((m) => m.id === monsterId)) throw new Error('That monster isn’t here.');
  if (char.hp <= 0) throw new Error('You are too weak to fight. Rest or visit a healer.');
  const mon = monsterCombatant(monsterId);
  char.battle = {
    monsterId,
    hp: mon.maxHp,
    maxHp: mon.maxHp,
    turn: 0,
    over: null,
    log: [{ kind: 'info', text: `You face ${aName(mon.def)}!` }],
  };
  return char.battle;
}

export function xpReward(monLevel, playerLevel, boss) {
  const diff = monLevel - playerLevel;
  const mult = diff >= 0 ? 1 + 0.1 * Math.min(diff, 10) : Math.max(0.05, 1 + diff * 0.15);
  return Math.max(1, Math.round((6 + 4 * Math.pow(monLevel, 1.5)) * mult * (boss ? 5 : 1)));
}

function rollLoot(def, rng) {
  const boss = !!def.boss;
  const gold = randInt(rng, 2 + def.level * 3, 4 + def.level * 6) * (boss ? 5 : 1);
  let gem = null;
  if (rng() < (boss ? 1 : 0.05)) {
    gem = `${pick(rng, Object.keys(GEM_TYPES))}:${gemTierForLevel(def.level)}`;
  }
  return { gold, gem };
}

// mode: 'melee' | 'cast' | 'flee'
export function battleAction(char, mode, rng = Math.random) {
  const b = char.battle;
  if (!b || b.over) throw new Error('You are not in a fight.');
  const mon = monsterCombatant(b.monsterId);
  const def = mon.def;
  const player = playerCombatant(char);
  const log = (kind, text) => b.log.push({ kind, text });
  const The = theName(def, true);
  const the = theName(def);
  b.turn += 1;

  if (mode === 'flee') {
    const chance = clamp(player.stats.dex / (player.stats.dex + mon.stats.dex) + 0.2, 0.25, 0.9);
    if (rng() < chance) {
      log('info', `You escape from ${the}!`);
      b.over = 'fled';
      return b;
    }
    log('bad', 'You fail to escape!');
  } else if (mode === 'melee' || mode === 'cast') {
    const r = resolveAttack(player, mon, mode, rng);
    if (mode === 'melee') {
      if (!r.hit) log('miss', `You miss ${the}.`);
      else log('player', `${r.crit ? 'Critical hit! ' : ''}You hit ${the} for ${r.damage}!`);
    } else {
      const spell = SPELL_NAME[player.spell.element];
      if (!r.hit) log('miss', 'Your spell fizzles!');
      else {
        let text = `${r.crit ? 'Critical! ' : ''}Your ${spell} strikes ${the} for ${r.damage}!`;
        if (r.elementMult > 1) text += ' It’s vulnerable!';
        if (r.elementMult < 1) text += ' It resists.';
        log('player', text);
      }
    }
    b.hp = Math.max(0, b.hp - r.damage);
    if (b.hp <= 0) return victory(char, b, def, rng);
  } else {
    throw new Error('Unknown action.');
  }

  // Monster's turn.
  const mr = resolveAttack(mon, player, mon.attackMode, rng);
  if (mon.attackMode === 'cast') {
    const spell = SPELL_NAME[mon.spell.element];
    if (!mr.hit) log('miss', `${The} tries to cast, but the spell fizzles.`);
    else log('monster', `${The} hurls a ${spell} at you for ${mr.damage}!`);
  } else if (!mr.hit) {
    log('miss', `${The} misses you.`);
  } else {
    log('monster', `${mr.crit ? 'A savage blow! ' : ''}${The} ${def.verb} you for ${mr.damage}!`);
  }
  char.hp = Math.max(0, char.hp - mr.damage);
  if (char.hp <= 0) return defeat(char, b, def);
  return b;
}

function victory(char, b, def, rng) {
  b.over = 'victory';
  b.log.push({ kind: 'win', text: `Victory! ${theName(def, true)} has been slain!` });
  const xp = xpReward(def.level, char.level, def.boss);
  const loot = rollLoot(def, rng);
  char.gold += loot.gold;
  char.kills += 1;
  b.log.push({ kind: 'reward', text: `${theName(def, true)} dropped ${loot.gold} gold.` });
  if (loot.gem) {
    char.gems[loot.gem] = (char.gems[loot.gem] || 0) + 1;
    b.rewardGem = loot.gem;
  }
  b.log.push({ kind: 'reward', text: `You gain ${xp} experience.` });
  const levels = gainXp(char, xp);
  if (levels) b.log.push({ kind: 'win', text: `You reached level ${char.level}! Spend your points on the Hero tab.` });
  b.rewards = { xp, gold: loot.gold, gem: loot.gem, levels };
  return b;
}

function defeat(char, b, def) {
  b.over = 'defeat';
  const lost = Math.floor(char.gold * 0.1);
  char.gold -= lost;
  char.deaths += 1;
  char.loc = respawnPoint(char);
  char.hp = Math.ceil(maxHp(char) * 0.3);
  b.log.push({ kind: 'bad', text: `You have been defeated by ${theName(def)}…` });
  b.log.push({ kind: 'bad', text: `You wake up in town${lost ? `, ${lost} gold lighter` : ''}.` });
  return b;
}

export function battleMonster(char) {
  return char.battle ? MONSTERS[char.battle.monsterId] : null;
}
