// Core character/monster stats. Pure data — shared by client and (later) server.
export const STATS = ['str', 'dex', 'int', 'wis', 'vit'];

export const STAT_LABEL = {
  str: 'Strength',
  dex: 'Dexterity',
  int: 'Intelligence',
  wis: 'Wisdom',
  vit: 'Vitality',
};

export const STAT_SHORT = { str: 'STR', dex: 'DEX', int: 'INT', wis: 'WIS', vit: 'VIT' };

export const STAT_DESC = {
  str: 'How hard your melee attacks hit.',
  dex: 'Your chance to land melee hits and to dodge enemy attacks.',
  int: 'How hard your spells hit.',
  wis: 'Your chance to cast successfully and to resist enemy spells.',
  vit: 'Your health.',
};

// Points granted per level. Spend all on one stat, or spread evenly across all.
export const POINTS_PER_LEVEL = 10;
export const BASE_STAT = 5;
