export const ELEMENTS = ['fire', 'frost', 'storm', 'holy', 'shadow'];

export const ELEMENT_LABEL = {
  fire: 'Fire',
  frost: 'Frost',
  storm: 'Storm',
  holy: 'Holy',
  shadow: 'Shadow',
  arcane: 'Arcane',
};

export const SPELL_NAME = {
  fire: 'fire bolt',
  frost: 'frost shard',
  storm: 'lightning bolt',
  holy: 'holy smite',
  shadow: 'shadow bolt',
  arcane: 'arcane spark',
};

// A creature of element X takes extra damage from OPPOSED[X] and half from X itself.
const OPPOSED = { fire: 'frost', frost: 'fire', holy: 'shadow', shadow: 'holy' };

export function elementMultiplier(spellElement, targetElement) {
  if (!spellElement || !targetElement) return 1;
  if (spellElement === targetElement) return 0.5;
  if (OPPOSED[targetElement] === spellElement) return 1.5;
  return 1;
}
