// Masteries grow slowly as you fight. Each weapon type and magic element has one,
// plus Armor (grows when you're hit). Races start ahead in some and have caps per mastery.
export const WEAPON_MASTERIES = ['sword', 'axe', 'mace', 'dagger'];
export const ELEMENT_MASTERIES = ['fire', 'frost', 'storm', 'holy', 'shadow'];
export const MASTERIES = [...WEAPON_MASTERIES, ...ELEMENT_MASTERIES, 'armor'];

export const MASTERY_LABEL = {
  sword: 'Sword', axe: 'Axe', mace: 'Mace', dagger: 'Dagger',
  fire: 'Fire', frost: 'Frost', storm: 'Storm', holy: 'Holy', shadow: 'Shadow',
  armor: 'Armor',
};

const DEFAULT_CAP = 75;

// Per race: starting value and cap overrides. Anything unlisted starts at 0 with DEFAULT_CAP.
export const RACE_MASTERY = {
  human: { start: { sword: 15 }, cap: { sword: 125, axe: 90, mace: 90, dagger: 90, holy: 100, storm: 90, armor: 100 } },
  elf: { start: { frost: 15 }, cap: { frost: 125, storm: 105, holy: 90, dagger: 90, sword: 70, axe: 55, mace: 55, armor: 70 } },
  dwarf: { start: { axe: 15, armor: 10 }, cap: { axe: 125, mace: 105, armor: 125, fire: 85, frost: 80, dagger: 55 } },
  orc: { start: { mace: 15 }, cap: { mace: 125, axe: 110, sword: 90, armor: 100, fire: 80, shadow: 85, frost: 55, holy: 55 } },
  gnome: { start: { fire: 15 }, cap: { fire: 125, storm: 110, frost: 90, mace: 55, axe: 50, sword: 60, armor: 65 } },
  halfling: { start: { dagger: 15 }, cap: { dagger: 125, sword: 95, shadow: 105, holy: 85, axe: 50, mace: 55 } },
};

export function masteryStart(race, m) {
  return RACE_MASTERY[race]?.start?.[m] || 0;
}

export function masteryCap(race, m) {
  return RACE_MASTERY[race]?.cap?.[m] ?? DEFAULT_CAP;
}

// What a point of mastery is worth in combat.
export const masteryDamage = (m) => 1 + m / 150; // 15 => +10%, 125 => +83%
export const masteryHit = (m) => m / 1000;       // 125 => +12.5% hit/cast
export const masteryCrit = (m) => m / 2000;      // 125 => +6% crit
export const masteryArmor = (m) => 1 + m / 100;  // armor mastery multiplies armor

// Chance that one successful hit raises a mastery by 1. Slows as it climbs.
export const masteryGainChance = (m) => 1 / (4 + m * 0.6);

// The race's best masteries, for display.
export function raceSpecialties(race) {
  const caps = RACE_MASTERY[race]?.cap || {};
  return Object.entries(caps).filter(([, c]) => c >= 105).sort((a, b) => b[1] - a[1]).map(([m]) => m);
}
