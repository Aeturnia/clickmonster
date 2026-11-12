// Gems drop from monsters and socket into gear. Ten kinds, five grades.
// Stat gems give a percentage of your stat, so they keep mattering at any level.
export const GEM_TYPES = {
  ruby: { name: 'Ruby', effect: 'stat', stat: 'str', values: [3, 6, 10, 16, 25] },
  emerald: { name: 'Emerald', effect: 'stat', stat: 'dex', values: [3, 6, 10, 16, 25] },
  sapphire: { name: 'Sapphire', effect: 'stat', stat: 'int', values: [3, 6, 10, 16, 25] },
  amethyst: { name: 'Amethyst', effect: 'stat', stat: 'wis', values: [3, 6, 10, 16, 25] },
  topaz: { name: 'Topaz', effect: 'stat', stat: 'vit', values: [3, 6, 10, 16, 25] },
  citrine: { name: 'Citrine', effect: 'gold', values: [5, 10, 18, 30, 50] },
  opal: { name: 'Opal', effect: 'xp', values: [2, 4, 8, 13, 20] },
  garnet: { name: 'Garnet', effect: 'lifesteal', values: [2, 4, 7, 11, 16] },
  diamond: { name: 'Diamond', effect: 'crit', values: [1, 2, 3, 5, 8] },
  onyx: { name: 'Onyx', effect: 'armor', values: [5, 10, 18, 30, 45] },
};

export const GEM_TIERS = [null, 'Chipped', 'Flawed', 'Polished', 'Flawless', 'Perfect'];

const STAT_SHORT = { str: 'STR', dex: 'DEX', int: 'INT', wis: 'WIS', vit: 'VIT' };
const EFFECT_TEXT = {
  gold: (v) => `+${v}% gold`,
  xp: (v) => `+${v}% experience`,
  lifesteal: (v) => `heal ${v}% of damage dealt`,
  crit: (v) => `+${v}% critical chance`,
  armor: (v) => `+${v}% armor`,
};

// Gem keys look like "ruby:2".
export function parseGem(key) {
  const [type, tierStr] = String(key).split(':');
  const tier = Number(tierStr);
  const t = GEM_TYPES[type];
  if (!t || !GEM_TIERS[tier]) return null;
  const value = t.values[tier - 1];
  const text = t.effect === 'stat' ? `+${value}% ${STAT_SHORT[t.stat]}` : EFFECT_TEXT[t.effect](value);
  return { key, type, tier, effect: t.effect, stat: t.stat, value, text, name: `${GEM_TIERS[tier]} ${t.name}` };
}

export function gemTierForLevel(level) {
  return Math.max(1, Math.min(5, 1 + Math.floor(level / 15)));
}

// Gold cost to pull a gem back out of an item (only in towns).
export function extractCost(tier) {
  return 40 * tier * tier;
}
