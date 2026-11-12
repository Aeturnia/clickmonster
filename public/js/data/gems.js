// Gems drop from monsters and socket into gear for stat bonuses.
export const GEM_TYPES = {
  ruby: { name: 'Ruby', stat: 'str' },
  emerald: { name: 'Emerald', stat: 'dex' },
  sapphire: { name: 'Sapphire', stat: 'int' },
  amethyst: { name: 'Amethyst', stat: 'wis' },
  topaz: { name: 'Topaz', stat: 'vit' },
};

export const GEM_TIERS = [
  null,
  { name: 'Chipped', bonus: 2 },
  { name: 'Flawed', bonus: 5 },
  { name: 'Polished', bonus: 10 },
  { name: 'Flawless', bonus: 20 },
  { name: 'Perfect', bonus: 40 },
];

// Gem keys look like "ruby:2".
export function parseGem(key) {
  const [type, tierStr] = key.split(':');
  const tier = Number(tierStr);
  const t = GEM_TYPES[type];
  if (!t || !GEM_TIERS[tier]) return null;
  return { key, type, tier, stat: t.stat, bonus: GEM_TIERS[tier].bonus, name: `${GEM_TIERS[tier].name} ${t.name}` };
}

export function gemTierForLevel(level) {
  return Math.max(1, Math.min(5, 1 + Math.floor(level / 15)));
}

// Gold cost to pull a gem back out of an item (only in towns).
export function extractCost(tier) {
  return 40 * tier * tier;
}
