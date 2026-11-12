// Playable races. Each has a specialty (a weapon type or a magic element) where it starts
// with some mastery and can reach the highest cap (see data/masteries.js), plus stat leanings.
export const RACES = {
  human: {
    id: 'human',
    name: 'Human',
    desc: 'Adaptable and determined. Humans train with the sword from childhood.',
    affinity: { kind: 'weapon', type: 'sword' },
    bonus: { str: 2, dex: 2, int: 2, wis: 2, vit: 2 },
    startZone: 'ashford',
    gear: ['sword_1', 'body_1'],
  },
  elf: {
    id: 'elf',
    name: 'Elf',
    desc: 'Ancient forest-dwellers attuned to winter’s stillness. Elves bend frost to their will.',
    affinity: { kind: 'element', element: 'frost' },
    bonus: { int: 4, wis: 4, dex: 2 },
    startZone: 'silverleaf',
    gear: ['focus_frost_1', 'body_1'],
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    desc: 'Stout miners of the deep halls. Masters of the axe who wear armor like a second skin.',
    affinity: { kind: 'weapon', type: 'axe' },
    bonus: { str: 3, vit: 5, dex: 2 },
    startZone: 'ironpeak',
    gear: ['axe_1', 'body_1', 'helm_1'],
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    desc: 'Fierce warriors of the badlands who crush their foes with heavy maces.',
    affinity: { kind: 'weapon', type: 'mace' },
    bonus: { str: 6, vit: 4 },
    startZone: 'bloodrock',
    gear: ['mace_1', 'body_1'],
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    desc: 'Clever tinkerers whose endless curiosity led them to master fire.',
    affinity: { kind: 'element', element: 'fire' },
    bonus: { int: 6, wis: 4 },
    startZone: 'cogwhistle',
    gear: ['focus_fire_1', 'body_1'],
  },
  halfling: {
    id: 'halfling',
    name: 'Halfling',
    desc: 'Quick and quiet. Halflings strike from the tall grass with daggers.',
    affinity: { kind: 'weapon', type: 'dagger' },
    bonus: { dex: 6, wis: 2, vit: 2 },
    startZone: 'bramblebrook',
    gear: ['dagger_1', 'body_1', 'boots_1'],
  },
};

export function affinityLabel(race) {
  const a = race.affinity;
  const main = a.kind === 'weapon'
    ? `${a.type[0].toUpperCase()}${a.type.slice(1)}s`
    : `${a.element[0].toUpperCase()}${a.element.slice(1)} magic`;
  return race.id === 'dwarf' ? `${main} and armor` : main;
}
