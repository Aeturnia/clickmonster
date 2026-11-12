// World layout. Every cell in a zone shares the zone's monster list.
// Special cells ("features") hold towns, portals and boss lairs.
//
// Monster archetypes control how a monster's stat budget is spread:
//   brute (hits hard), quick (dodgy, accurate), tank (lots of HP),
//   caster (casts spells), balanced.

function m(name, level, arch, verb, opts = {}) {
  return { name, level, arch, verb, ...opts };
}

const ALL_WEAPONS = ['sword', 'axe', 'mace', 'dagger'];
export const STARTER_EXIT_LEVEL = 20;

function starterZone({ id, name, desc, elements, monsters, boss, overworld }) {
  return {
    id, name, desc, size: 10, starter: true, levelRange: [1, 20],
    town: { x: 5, y: 5, name: `${name} Village` },
    shop: { tiers: [1, 2, 3, 4], weapons: ALL_WEAPONS, elements, armor: true },
    features: [
      { type: 'portal', x: 5, y: 10, to: 'overworld', tx: overworld[0], ty: overworld[1],
        minLevel: STARTER_EXIT_LEVEL, label: 'Road to the Overworld' },
      { type: 'lair', x: 9, y: 2 },
    ],
    monsters, boss: { ...boss, boss: true },
    overworld,
  };
}

function adventureZone({ id, name, desc, minLevel, pvp, shop, monsters, boss, overworld }) {
  return {
    id, name, desc, size: 12, minLevel, pvp: !!pvp,
    levelRange: [monsters[0].level, boss.level],
    town: { x: 6, y: 6, name: shop.townName },
    shop,
    features: [
      { type: 'portal', x: 6, y: 12, to: 'overworld', tx: overworld[0], ty: overworld[1], minLevel: 0,
        label: 'Back to the Overworld' },
      { type: 'lair', x: 2, y: 2 },
    ],
    monsters, boss: { ...boss, boss: true },
    overworld,
  };
}

const STARTERS = [
  starterZone({
    id: 'ashford', name: 'Ashford Vale', overworld: [4, 7], elements: ['holy', 'storm'],
    desc: 'Rolling farmland and hedgerows, troubled lately by bandits.',
    monsters: [
      m('Field Rat', 1, 'quick', 'bites'),
      m('Barn Spider', 2, 'quick', 'bites'),
      m('Mangy Wolf', 4, 'quick', 'mauls'),
      m('Highway Bandit', 6, 'balanced', 'slashes'),
      m('Hedge Witch', 9, 'caster', 'curses', { element: 'shadow' }),
      m('Hill Boar', 12, 'brute', 'gores'),
      m('Bandit Captain', 15, 'balanced', 'slashes'),
      m('Mill Ghoul', 18, 'tank', 'claws', { element: 'shadow' }),
    ],
    boss: m('Gorrath the Bandit King', 20, 'brute', 'cleaves', { proper: true }),
  }),
  starterZone({
    id: 'silverleaf', name: 'Silverleaf Wood', overworld: [1, 4], elements: ['frost', 'storm'],
    desc: 'An ancient forest of pale trees, slowly being eaten by blight.',
    monsters: [
      m('Moth Sprite', 1, 'caster', 'zaps', { element: 'storm' }),
      m('Thornling', 2, 'tank', 'pricks'),
      m('Glade Fox', 4, 'quick', 'bites'),
      m('Moss Spider', 6, 'quick', 'bites'),
      m('Rotbark Treant', 9, 'tank', 'slams', { element: 'frost' }),
      m('Shadow Lynx', 12, 'quick', 'rakes', { element: 'shadow' }),
      m('Corrupted Dryad', 15, 'caster', 'lashes', { element: 'shadow' }),
      m('Blight Stag', 18, 'brute', 'gores'),
    ],
    boss: m('The Withered Heart', 20, 'caster', 'drains', { proper: true, element: 'shadow' }),
  }),
  starterZone({
    id: 'ironpeak', name: 'Ironpeak Halls', overworld: [6, 2], elements: ['fire', 'frost'],
    desc: 'Torchlit dwarven tunnels, where the deep mines have woken something.',
    monsters: [
      m('Cave Rat', 1, 'quick', 'bites'),
      m('Tunnel Beetle', 2, 'tank', 'pinches'),
      m('Kobold Digger', 4, 'balanced', 'stabs'),
      m('Rock Crawler', 6, 'tank', 'crushes'),
      m('Kobold Shaman', 9, 'caster', 'hexes', { element: 'fire' }),
      m('Cave Troll', 12, 'brute', 'pummels'),
      m('Magma Slug', 15, 'caster', 'spits', { element: 'fire' }),
      m('Deep Golem', 18, 'tank', 'pounds'),
    ],
    boss: m('Grimjaw the Forge Wyrm', 20, 'brute', 'scorches', { proper: true, element: 'fire' }),
  }),
  starterZone({
    id: 'bloodrock', name: 'Bloodrock Badlands', overworld: [6, 6], elements: ['fire', 'shadow'],
    desc: 'Red canyons and dust storms. Only the strong survive here.',
    monsters: [
      m('Dust Lizard', 1, 'quick', 'bites'),
      m('Scrap Vulture', 2, 'quick', 'pecks'),
      m('Cackling Hyena', 4, 'quick', 'bites'),
      m('Sand Scorpion', 6, 'quick', 'stings'),
      m('Raider Outcast', 9, 'balanced', 'hacks'),
      m('Bone Shaman', 12, 'caster', 'curses', { element: 'shadow' }),
      m('Rock Ogre', 15, 'brute', 'smashes'),
      m('Dune Wurm', 18, 'tank', 'crushes'),
    ],
    boss: m('Skarr the Sandreaver', 20, 'brute', 'rends', { proper: true }),
  }),
  starterZone({
    id: 'cogwhistle', name: 'Cogwhistle Hollow', overworld: [2, 6], elements: ['fire', 'storm'],
    desc: 'A gnomish valley of workshops, where inventions have a habit of escaping.',
    monsters: [
      m('Clockwork Mouse', 1, 'quick', 'nibbles'),
      m('Spark Wisp', 2, 'caster', 'zaps', { element: 'storm' }),
      m('Rogue Automaton', 4, 'tank', 'clanks into'),
      m('Copper Spider', 6, 'quick', 'bites'),
      m('Ember Imp', 9, 'caster', 'burns', { element: 'fire' }),
      m('Runaway Golem', 12, 'brute', 'slams'),
      m('Mad Alchemist', 15, 'caster', 'splashes', { element: 'storm' }),
      m('Steam Drake', 18, 'brute', 'scalds', { element: 'fire' }),
    ],
    boss: m('The Brass Colossus', 20, 'tank', 'stomps', { proper: true }),
  }),
  starterZone({
    id: 'bramblebrook', name: 'Bramblebrook Meadows', overworld: [1, 7], elements: ['shadow', 'holy'],
    desc: 'Sunny meadows and tangled thickets where goblins lurk in the brambles.',
    monsters: [
      m('Garden Snake', 1, 'quick', 'bites'),
      m('Giant Toad', 2, 'tank', 'slaps'),
      m('Burrow Badger', 4, 'brute', 'claws'),
      m('Thieving Goblin', 6, 'quick', 'stabs'),
      m('Bog Hag', 9, 'caster', 'hexes', { element: 'shadow' }),
      m('Brown Bear', 12, 'brute', 'mauls'),
      m('Goblin Warboss', 15, 'balanced', 'chops'),
      m('Wisp Swarm', 18, 'caster', 'sears', { element: 'holy' }),
    ],
    boss: m('Old Mother Bramble', 20, 'caster', 'entangles', { proper: true, element: 'shadow' }),
  }),
];

const ADVENTURE = [
  adventureZone({
    id: 'marsh', name: 'Whispering Marsh', overworld: [2, 2], minLevel: 22,
    desc: 'Fog-choked wetlands where drowned things refuse to stay down.',
    shop: { townName: 'Stiltwater', tiers: [5, 6], weapons: ['dagger', 'sword'], elements: ['shadow', 'frost'], armor: true },
    monsters: [
      m('Marsh Leech', 22, 'tank', 'drains'),
      m('Bog Troll', 24, 'brute', 'pummels'),
      m('Swamp Hydra', 27, 'balanced', 'bites'),
      m('Drowned Knight', 29, 'tank', 'slashes', { element: 'shadow' }),
    ],
    boss: m('The Mire Queen', 32, 'caster', 'drowns', { proper: true, element: 'frost' }),
  }),
  adventureZone({
    id: 'duskhollow', name: 'Duskhollow Forest', overworld: [5, 2], minLevel: 30, pvp: true,
    desc: 'A forest of endless twilight. Lawless — adventurers may attack one another here.',
    shop: { townName: 'Gallows Rest', tiers: [6, 7], weapons: ['sword', 'axe', 'mace', 'dagger'], elements: ['shadow', 'holy'], armor: true },
    monsters: [
      m('Nightstalker', 30, 'quick', 'rakes', { element: 'shadow' }),
      m('Werewolf', 32, 'brute', 'mauls'),
      m('Hollow Shade', 34, 'caster', 'chills', { element: 'shadow' }),
      m('Dark Ranger', 37, 'quick', 'shoots'),
    ],
    boss: m('The Hollow King', 40, 'balanced', 'strikes', { proper: true, element: 'shadow' }),
  }),
  adventureZone({
    id: 'frostfang', name: 'Frostfang Peaks', overworld: [4, 1], minLevel: 40,
    desc: 'Howling, frozen mountains ruled by giants.',
    shop: { townName: 'Hearthhold', tiers: [7, 8], weapons: ['axe', 'mace'], elements: ['frost', 'storm', 'fire'], armor: true },
    monsters: [
      m('Frost Giant', 40, 'brute', 'smashes', { element: 'frost' }),
      m('Ice Wraith', 43, 'caster', 'freezes', { element: 'frost' }),
      m('Mountain Yeti', 45, 'tank', 'pounds', { element: 'frost' }),
      m('Frost Wyrm', 48, 'brute', 'bites', { element: 'frost' }),
    ],
    boss: m('Rimeclaw', 52, 'brute', 'shreds', { proper: true, element: 'frost' }),
  }),
  adventureZone({
    id: 'cinderspire', name: 'Cinderspire Caldera', overworld: [7, 4], minLevel: 50, pvp: true,
    desc: 'A volcano’s burning heart. Lawless — adventurers may attack one another here.',
    shop: { townName: 'Ashgate', tiers: [8, 9], weapons: ['sword', 'mace'], elements: ['fire', 'frost', 'storm'], armor: true },
    monsters: [
      m('Fire Elemental', 50, 'caster', 'burns', { element: 'fire' }),
      m('Salamander', 52, 'quick', 'bites', { element: 'fire' }),
      m('Ash Revenant', 55, 'balanced', 'slashes', { element: 'fire' }),
      m('Magma Titan', 58, 'tank', 'crushes', { element: 'fire' }),
    ],
    boss: m('Pyraxis the Undying Flame', 62, 'caster', 'incinerates', { proper: true, element: 'fire' }),
  }),
  adventureZone({
    id: 'catacombs', name: 'Sunken Catacombs', overworld: [1, 1], minLevel: 60,
    desc: 'Flooded tombs beneath a fallen kingdom. The dead walk here.',
    shop: { townName: 'The Last Candle', tiers: [9, 10], weapons: ['sword', 'axe', 'mace', 'dagger'], elements: ['fire', 'frost', 'storm', 'holy', 'shadow'], armor: true },
    monsters: [
      m('Crypt Horror', 60, 'brute', 'claws', { element: 'shadow' }),
      m('Bone Colossus', 63, 'tank', 'crushes', { element: 'shadow' }),
      m('Lich Acolyte', 66, 'caster', 'curses', { element: 'shadow' }),
      m('Death Knight', 69, 'balanced', 'cleaves', { element: 'shadow' }),
    ],
    boss: m('Archlich Vael', 75, 'caster', 'unmakes', { proper: true, element: 'shadow' }),
  }),
];

const OVERWORLD = {
  id: 'overworld', name: 'The Overworld', size: 7, levelRange: [20, 26],
  desc: 'The wide world beyond the starter lands. Each region leads to a new zone.',
  town: { x: 4, y: 4, name: 'Crossroads' },
  shop: { tiers: [4, 5], weapons: ALL_WEAPONS, elements: ['fire', 'frost', 'storm', 'holy', 'shadow'], armor: true },
  features: [
    ...STARTERS.map((z) => ({ type: 'portal', x: z.overworld[0], y: z.overworld[1], to: z.id, tx: 5, ty: 10, minLevel: 0, label: `Enter ${z.name}` })),
    ...ADVENTURE.map((z) => ({ type: 'portal', x: z.overworld[0], y: z.overworld[1], to: z.id, tx: 6, ty: 12, minLevel: z.minLevel, label: `Enter ${z.name}` })),
  ],
  monsters: [
    m('Roaming Ogre', 20, 'brute', 'clubs'),
    m('Dire Wolf', 21, 'quick', 'mauls'),
    m('Highland Griffon', 23, 'quick', 'rakes', { element: 'storm' }),
    m('Road Wraith', 25, 'caster', 'chills', { element: 'shadow' }),
    m('Hill Giant', 26, 'brute', 'stomps'),
  ],
};

export const ZONES = {};
for (const z of [...STARTERS, OVERWORLD, ...ADVENTURE]) {
  z.monsters = z.monsters.map((mon) => ({ ...mon, id: `${z.id}:${slug(mon.name)}` }));
  if (z.boss) z.boss = { ...z.boss, id: `${z.id}:${slug(z.boss.name)}` };
  ZONES[z.id] = z;
}

export const MONSTERS = {};
for (const z of Object.values(ZONES)) {
  for (const mon of z.monsters) MONSTERS[mon.id] = mon;
  if (z.boss) MONSTERS[z.boss.id] = z.boss;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
