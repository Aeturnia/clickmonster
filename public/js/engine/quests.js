// Quest board. A fresh batch of quests appears every hour and each lasts 3 hours.
// A quest asks for an elite variant of a creature in a level range in one zone.
// The first player to finish claims the reward; everyone else on it loses out.
import { ZONES } from '../data/zones.js';
import { VARIANTS, VARIANT_IDS } from '../data/variants.js';
import { GEM_TYPES, gemTierForLevel } from '../data/gems.js';
import { xpReward } from './battle.js';
import { gainXp } from './character.js';
import { inTown } from './world.js';
import { RACES } from '../data/races.js';

export const QUESTS_PER_HOUR = 6;
export const QUEST_LIFETIME_MS = 3 * 3600 * 1000;
export const QUEST_COOLDOWN_MS = 3600 * 1000;
export const QUEST_OVERLEVEL = 10; // can't take quests whose top level is this far below yours

export const hourBucket = (now = Date.now()) => Math.floor(now / 3600000);

// Small seeded RNG so every server instance generates the same batch for an hour.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = {
  xp: { label: 'Mostly experience', xp: 2, gold: 0.5, gem: 0 },
  gold: { label: 'Mostly gold', xp: 0.6, gold: 2.5, gem: 0 },
  gem: { label: 'A gem', xp: 0.6, gold: 0.6, gem: 1 },
};

export function questReward(level, kind, rng) {
  const k = KINDS[kind];
  const xp = Math.round(xpReward(level, level, false) * 6 * k.xp);
  const gold = Math.round((2 + level * 4.5) * 10 * k.gold);
  const gem = k.gem
    ? `${Object.keys(GEM_TYPES)[Math.floor(rng() * Object.keys(GEM_TYPES).length)]}:${Math.min(5, gemTierForLevel(level) + 1)}`
    : null;
  return { xp, gold, gem, kind };
}

// The quests for one hour. Deterministic for a given bucket.
export function generateQuests(bucket) {
  const rng = seeded(bucket * 7919 + 17);
  const zones = Object.values(ZONES).filter((z) => z.monsters.length && z.id !== 'overworld');
  const out = [];
  for (let slot = 0; slot < QUESTS_PER_HOUR; slot++) {
    // Favor starter zones; most players are there early on.
    const pool = rng() < 0.6 ? zones.filter((z) => z.starter) : zones;
    const zone = pool[Math.floor(rng() * pool.length)];
    const mon = zone.monsters[Math.floor(rng() * zone.monsters.length)];
    const variant = VARIANT_IDS[Math.floor(rng() * VARIANT_IDS.length)];
    const minLevel = Math.max(1, Math.floor(mon.level * 0.8));
    const maxLevel = Math.ceil(mon.level * 1.2) + 1;
    const kind = Object.keys(KINDS)[Math.floor(rng() * 3)];
    out.push({
      bucket, slot, zone: zone.id, variant, minLevel, maxLevel,
      reward: questReward(mon.level, kind, rng),
      expiresAt: (bucket * 3600000) + QUEST_LIFETIME_MS,
    });
  }
  return out;
}

export function questTitle(q) {
  const v = VARIANTS[q.variant].name;
  return `Slay ${/^[AEIOU]/.test(v) ? 'an' : 'a'} ${v} creature of level ${q.minLevel} to ${q.maxLevel} in ${ZONES[q.zone]?.name || 'a lost land'}`;
}

export const QUEST_UNDERLEVEL = 5; // can't take quests whose bottom level is this far above yours

// Level needed to reach a zone: your own starter zone is open; other starter zones and
// the wider world are past the level-20 road; adventure zones have their own gate.
export function zoneAccessLevel(char, zoneId) {
  const z = ZONES[zoneId];
  if (!z) return Infinity;
  if (z.starter) return zoneId === RACES[char.race]?.startZone ? 1 : 20;
  return z.minLevel || 20;
}

export function canAccept(char, q, now = Date.now()) {
  if (!inTown(char)) return { ok: false, reason: 'Quests are taken from the board in town.' };
  if (char.quest) return { ok: false, reason: 'You already have a quest. Finish or abandon it first.' };
  if ((char.questCooldownUntil || 0) > now) {
    const mins = Math.ceil((char.questCooldownUntil - now) / 60000);
    return { ok: false, reason: `You need to rest before another quest (${mins} min).` };
  }
  if (q.completedBy) return { ok: false, reason: 'Someone has already completed this quest.' };
  if (q.expiresAt <= now) return { ok: false, reason: 'This quest has expired.' };
  if (char.level > q.maxLevel + QUEST_OVERLEVEL) return { ok: false, reason: 'This quest is beneath you.' };
  const access = zoneAccessLevel(char, q.zone);
  if (char.level < access) return { ok: false, reason: `Requires level ${access} to reach ${ZONES[q.zone].name}.` };
  if (char.level < q.minLevel - QUEST_UNDERLEVEL) return { ok: false, reason: `Requires level ${q.minLevel - QUEST_UNDERLEVEL}.` };
  return { ok: true };
}

export function accept(char, q, now = Date.now()) {
  const check = canAccept(char, q, now);
  if (!check.ok) throw new Error(check.reason);
  char.quest = {
    id: q.id, zone: q.zone, variant: q.variant, minLevel: q.minLevel, maxLevel: q.maxLevel,
    reward: q.reward, expiresAt: q.expiresAt,
  };
}

// Does the battle the hero just won satisfy their quest?
export function questMatches(char, battle) {
  const q = char.quest;
  const r = battle?.rewards;
  return !!(q && battle?.over === 'victory' && r && r.variant === q.variant
    && char.loc.zone === q.zone && r.monsterLevel >= q.minLevel && r.monsterLevel <= q.maxLevel);
}

export function grantQuestReward(char, now = Date.now()) {
  const { reward } = char.quest;
  char.gold += reward.gold;
  if (reward.gem) char.gems[reward.gem] = (char.gems[reward.gem] || 0) + 1;
  const levels = gainXp(char, reward.xp);
  char.quest = null;
  char.questCooldownUntil = now + QUEST_COOLDOWN_MS;
  char.questsDone = (char.questsDone || 0) + 1;
  return { ...reward, levels };
}
