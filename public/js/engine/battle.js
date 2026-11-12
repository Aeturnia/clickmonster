// Turn-based battles: player acts, then the monster answers.
import { MONSTERS } from '../data/zones.js';
import { SPELL_NAME } from '../data/elements.js';
import { GEM_TYPES, gemTierForLevel, parseGem } from '../data/gems.js';
import { VARIANTS, rollVariant } from '../data/variants.js';
import { MASTERY_LABEL } from '../data/masteries.js';
import { ITEMS, itemDef, tierForLevel, WEAPON_TYPES } from '../data/items.js';
import { ELEMENTS } from '../data/elements.js';
import { monsterCombatant, theName, aName } from './monster.js';
import { playerCombatant, gainXp, maxHp, gemEffects, trainMastery, deathPenalty, addItem } from './character.js';
import { resolveAttack } from './combat.js';
import { monstersHere, respawnPoint } from './world.js';
import { randInt, pick, clamp } from './util.js';
import { mult } from './world-config.js';

export const MAX_INVENTORY = 40;
const GEM_CHANCE = 0.05;
const RELIC_CHANCE = 1 / 350;

export function startBattle(char, monsterId, rng = Math.random) {
  if (char.battle && !char.battle.over) throw new Error('You are already fighting!');
  if (!monstersHere(char).some((m) => m.id === monsterId)) throw new Error('That monster isn’t here.');
  if (char.hp <= 0) throw new Error('You are too weak to fight. Rest or visit a healer.');
  const q = char.quest;
  const boosted = q && q.zone === char.loc.zone ? q.variant : null;
  const variant = rollVariant(rng, !!MONSTERS[monsterId].boss, boosted, mult('elite'));
  const mon = monsterCombatant(monsterId, variant);
  const log = [{ kind: variant ? 'elite' : 'info', text: `You face ${aName(mon.def)}!` }];
  if (variant) log.push({ kind: 'elite', text: VARIANTS[variant].desc });
  char.battle = { monsterId, variant, hp: mon.maxHp, maxHp: mon.maxHp, turn: 0, over: null, log, masteryUps: {} };
  return char.battle;
}

export function xpReward(monLevel, playerLevel, boss) {
  const diff = monLevel - playerLevel;
  const mult = diff >= 0 ? 1 + 0.1 * Math.min(diff, 10) : Math.max(0.05, 1 + diff * 0.15);
  return Math.max(1, Math.round((6 + 4 * Math.pow(monLevel, 1.5)) * mult * (boss ? 5 : 1)));
}

function randomGem(rng, level, bump = 0) {
  return `${pick(rng, Object.keys(GEM_TYPES))}:${Math.min(5, gemTierForLevel(level) + bump)}`;
}

export function randomRelic(rng, level) {
  const tier = tierForLevel(level);
  const kinds = [
    ...Object.keys(WEAPON_TYPES).map((t) => `${t}_${tier}`),
    ...ELEMENTS.map((e) => `focus_${e}_${tier}`),
    `helm_${tier}`, `body_${tier}`, `boots_${tier}`,
  ].filter((id) => ITEMS[id]);
  return pick(rng, kinds);
}

// Rolls drops in order; at most one bonus drop (gem or relic) per kill.
function rollLoot(def, variant, fx, rng) {
  const v = variant ? VARIANTS[variant] : {};
  const boss = !!def.boss;
  let gold = randInt(rng, 2 + def.level * 3, 4 + def.level * 6) * (boss ? 5 : 1) * (v.gold || 1);
  gold = Math.round(gold * (1 + fx.gold / 100) * mult('gold'));
  const drop = (v.drop || 1) * mult('drop');
  let gem = null;
  let relic = null;
  if (rng() < (boss ? 0.1 : RELIC_CHANCE) * drop) relic = randomRelic(rng, def.level);
  else if (boss || rng() < GEM_CHANCE * drop) gem = randomGem(rng, def.level, boss ? 1 : 0);
  return { gold, gem, relic };
}

const playerMastery = (player, mode) => (mode === 'melee' ? player.melee.type : player.spell.element);

// mode: 'melee' | 'cast' | 'flee'
export function battleAction(char, mode, rng = Math.random) {
  const b = char.battle;
  if (!b || b.over || b.pvp) throw new Error('You are not in a fight.');
  const mon = monsterCombatant(b.monsterId, b.variant);
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
    if (r.hit) {
      b.lastMastery = playerMastery(player, mode);
      const up = trainMastery(char, b.lastMastery, rng);
      if (up != null) b.masteryUps[b.lastMastery] = up;
      if (player.lifesteal > 0) {
        const heal = Math.min(maxHp(char) - char.hp, Math.round(r.damage * player.lifesteal));
        if (heal > 0) { char.hp += heal; log('info', `You drain ${heal} health.`); }
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
  if (mr.hit) {
    const up = trainMastery(char, 'armor', rng);
    if (up != null) b.masteryUps.armor = up;
  }
  char.hp = Math.max(0, char.hp - mr.damage);
  if (char.hp <= 0) return defeat(char, b, def);
  return b;
}

function victory(char, b, def, rng) {
  b.over = 'victory';
  const v = b.variant ? VARIANTS[b.variant] : {};
  const fx = gemEffects(char);
  b.log.push({ kind: 'win', text: `Victory! ${theName(def, true)} has been slain!` });
  const xp = Math.round(xpReward(def.level, char.level, def.boss) * (v.xp || 1) * (1 + fx.xp / 100) * mult('xp'));
  const loot = rollLoot(def, b.variant, fx, rng);
  char.gold += loot.gold;
  char.kills += 1;
  b.log.push({ kind: 'reward', text: `${theName(def, true)} dropped ${loot.gold} gold.` });

  if (loot.gem) {
    char.gems[loot.gem] = (char.gems[loot.gem] || 0) + 1;
    b.log.push({ kind: 'win', text: `You found a ${parseGem(loot.gem).name}!` });
  }
  let relicName = null;
  if (loot.relic) {
    if (char.inventory.length < MAX_INVENTORY) {
      const item = addItem(char, loot.relic, 'relic');
      relicName = itemDef(item).name;
      b.log.push({ kind: 'win', text: `A rare find: ${relicName}!` });
    } else {
      b.log.push({ kind: 'bad', text: 'Something rare glinted in the remains, but your pack is full.' });
    }
  }
  if (v.mastery && b.lastMastery) {
    const up = trainMastery(char, b.lastMastery, rng, v.mastery);
    if (up != null) b.masteryUps[b.lastMastery] = up;
  }
  if (v.heal) {
    char.hp = maxHp(char);
    b.log.push({ kind: 'reward', text: 'A warm light restores your health.' });
  }
  for (const [m, val] of Object.entries(b.masteryUps)) {
    b.log.push({ kind: 'reward', text: `${MASTERY_LABEL[m]} mastery is now ${val}.` });
  }

  b.log.push({ kind: 'reward', text: `You gain ${xp} experience.` });
  const levels = gainXp(char, xp);
  if (levels) b.log.push({ kind: 'win', text: `You reached level ${char.level}!` });
  b.rewards = { xp, gold: loot.gold, gem: loot.gem, relic: relicName, levels, variant: b.variant || null, monsterLevel: def.level };
  return b;
}

function defeat(char, b, def) {
  b.over = 'defeat';
  const { goldLost, xpLost } = deathPenalty(char);
  char.loc = respawnPoint(char);
  char.hp = Math.ceil(maxHp(char) * 0.3);
  b.log.push({ kind: 'bad', text: `You have been defeated by ${theName(def)}…` });
  const losses = [goldLost ? `${goldLost} gold` : null, xpLost ? `${xpLost} experience` : null].filter(Boolean);
  b.log.push({ kind: 'bad', text: `You wake up in town${losses.length ? `, having lost ${losses.join(' and ')}` : ''}. Gold in the bank is safe.` });
  return b;
}

export function battleMonster(char) {
  return char.battle ? MONSTERS[char.battle.monsterId] : null;
}
