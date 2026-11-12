// Elite monster variants. Any fight has a small chance to be one of these,
// each with its own risk and reward. Quests ask for specific variants.
export const VARIANTS = {
  gilded: { name: 'Gilded', desc: 'Carries four times the gold.', chance: 0.012, gold: 4 },
  mighty: { name: 'Mighty', desc: 'Twice as strong, four times the experience.', chance: 0.01, stats: 2, hp: 2, xp: 4 },
  fortunate: { name: 'Fortunate', desc: 'Ten times the chance of a gem or rare gear.', chance: 0.01, drop: 10 },
  ancient: { name: 'Ancient', desc: 'Defeating it teaches you: +3 mastery.', chance: 0.01, stats: 1.3, xp: 1.5, mastery: 3 },
  swift: { name: 'Swift', desc: 'Hard to hit and quick to strike.', chance: 0.01, dex: 2, xp: 2, gold: 1.5 },
  savage: { name: 'Savage', desc: 'Hits far harder than it should.', chance: 0.01, str: 1.7, xp: 2.5, gold: 2 },
  ironhide: { name: 'Ironhide', desc: 'Thick armor and a lot of health.', chance: 0.01, armor: 3, hp: 1.6, xp: 2 },
  eldritch: { name: 'Eldritch', desc: 'Steeped in magic: casts and resists spells.', chance: 0.01, int: 1.8, wis: 2, xp: 2.5, caster: true },
  hoarding: { name: 'Hoarding', desc: 'Sitting on a pile of treasure.', chance: 0.008, stats: 1.3, gold: 8, drop: 2 },
  blessed: { name: 'Blessed', desc: 'Defeating it fully restores your health.', chance: 0.01, xp: 1.5, heal: true },
};

export const VARIANT_IDS = Object.keys(VARIANTS);

// Roll for a variant. Bosses are never variants. `boosted` (a quest target) is 3x as likely.
export function rollVariant(rng, isBoss = false, boosted = null, eliteMult = 1) {
  if (isBoss) return null;
  let r = rng();
  for (const id of VARIANT_IDS) {
    r -= VARIANTS[id].chance * eliteMult * (id === boosted ? 3 : 1);
    if (r < 0) return id;
  }
  return null;
}
