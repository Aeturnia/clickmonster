// World layout. Every cell in a zone shares the zone's monster list.
// Special cells ("features") hold towns, portals and boss lairs.
//
// Monster archetypes control how a monster's stat budget is spread:
//   brute (hits hard), quick (dodgy, accurate), tank (lots of HP),
//   caster (casts spells), balanced.
import { KINGDOM_ZONE_ID, KINGDOM_GATE, kingdomsOpen, kingdomConfig, kingdomZoneDef } from './kingdoms.js';

function m(name, level, arch, verb, opts = {}) {
  return { name, level, arch, verb, ...opts };
}

const ALL_WEAPONS = ['sword', 'axe', 'mace', 'dagger'];
export const STARTER_EXIT_LEVEL = 20;

// Zones are stored as plain definitions (see DEFAULT_ZONES below, and the `zones` table,
// which admins edit). compileZone() turns a definition into the shape the engine uses.
//
// Definition fields:
//   id, name, desc, size, starter, pvp
//   minLevel   level needed to enter from the Overworld
//   exitLevel  level needed to leave to the Overworld (starter zones: 20)
//   overworld  [x, y] position on the Overworld map, or null (not reachable from it)
//   entry      { x, y } where you arrive; the path back to the Overworld is placed here
//   town       { x, y, name } or null
//   shop       { tiers, weapons, elements, armor } or null (sold in the town)
//   lairs      [{ x, y }] cells where the boss can be fought
//   portals    [{ x, y, to, tx, ty, minLevel, label }] extra paths to other zones
//   monsters   [{ name, level, arch, verb, element?, proper? }]
//   boss       same shape as a monster, or null
function starterZone({ id, name, desc, elements, monsters, boss, overworld }) {
  return {
    id, name, desc, size: 10, starter: true, pvp: false, minLevel: 0, exitLevel: STARTER_EXIT_LEVEL,
    overworld, entry: { x: 5, y: 10 },
    town: { x: 5, y: 5, name: `${name} Village` },
    shop: { tiers: [1, 2, 3, 4], weapons: ALL_WEAPONS, elements, armor: true },
    lairs: [{ x: 9, y: 2 }], portals: [],
    monsters, boss,
  };
}

function adventureZone({ id, name, desc, minLevel, pvp, shop, monsters, boss, overworld }) {
  const { townName, ...stock } = shop;
  return {
    id, name, desc, size: 12, starter: false, pvp: !!pvp, minLevel, exitLevel: 0,
    overworld, entry: { x: 6, y: 12 },
    town: { x: 6, y: 6, name: townName },
    shop: stock,
    lairs: [{ x: 2, y: 2 }], portals: [],
    monsters, boss,
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
  id: 'overworld', name: 'The Overworld', size: 7, starter: false, pvp: false, minLevel: 0, exitLevel: 0,
  desc: 'The wide world beyond the starter lands. Each region leads to a new zone.',
  overworld: null, entry: { x: 4, y: 4 },
  town: { x: 4, y: 4, name: 'Crossroads' },
  shop: { tiers: [4, 5], weapons: ALL_WEAPONS, elements: ['fire', 'frost', 'storm', 'holy', 'shadow'], armor: true },
  lairs: [], portals: [],
  monsters: [
    m('Roaming Ogre', 20, 'brute', 'clubs'),
    m('Dire Wolf', 21, 'quick', 'mauls'),
    m('Highland Griffon', 23, 'quick', 'rakes', { element: 'storm' }),
    m('Road Wraith', 25, 'caster', 'chills', { element: 'shadow' }),
    m('Hill Giant', 26, 'brute', 'stomps'),
  ],
  boss: null,
};

// Built-in world, used to seed the database and as a fallback if it can't be loaded.
export const DEFAULT_ZONES = [...STARTERS, OVERWORLD, ...ADVENTURE];

export const OVERWORLD_ID = 'overworld';

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Definition -> engine shape (monster ids, features list, level range).
export function compileZone(def, all) {
  const z = JSON.parse(JSON.stringify(def));
  z.monsters = (z.monsters || []).map((mon) => ({ ...mon, id: `${z.id}:${slug(mon.name)}` }));
  z.boss = z.boss ? { ...z.boss, boss: true, id: `${z.id}:${slug(z.boss.name)}` } : null;
  const features = [];
  for (const l of z.lairs || []) if (z.boss) features.push({ type: 'lair', x: l.x, y: l.y });
  for (const p of z.portals || []) features.push({ type: 'portal', minLevel: 0, ...p });
  if (z.id === OVERWORLD_ID) {
    // Paths from the Overworld into every zone placed on it.
    for (const other of all) {
      if (!other.overworld || other.id === OVERWORLD_ID) continue;
      features.push({
        type: 'portal', x: other.overworld[0], y: other.overworld[1], to: other.id,
        tx: other.entry.x, ty: other.entry.y, minLevel: other.minLevel || 0, label: `Enter ${other.name}`,
      });
    }
  } else if (z.overworld && z.entry) {
    // Path back out to the Overworld at the zone's entry cell.
    features.push({
      type: 'portal', x: z.entry.x, y: z.entry.y, to: OVERWORLD_ID, tx: z.overworld[0], ty: z.overworld[1],
      minLevel: z.exitLevel || 0, label: z.starter ? 'Road to the Overworld' : 'Back to the Overworld',
    });
  }
  z.features = features;
  const levels = [...z.monsters.map((x) => x.level), ...(z.boss ? [z.boss.level] : [])];
  z.levelRange = levels.length ? [Math.min(...levels), Math.max(...levels)] : [1, 1];
  return z;
}

// Live registries. They are replaced in place so every module that imported them sees updates.
export const ZONES = {};
export const MONSTERS = {};
export let ZONE_DEFS = [];

export function loadZones(defs) {
  // The Kingdom Zone's id is reserved, and the only way into it is the Crossroads portal added
  // below (K1-B03). A database zone with that id, or a path into it, is ignored even if it got past
  // validateZone(). ZONE_DEFS never holds the Kingdom Zone: the zone editor never sees it.
  const list = (defs && defs.length ? defs : DEFAULT_ZONES)
    .filter((def) => def.id !== KINGDOM_ZONE_ID)
    .map((def) => ((def.portals || []).some((p) => p.to === KINGDOM_ZONE_ID)
      ? { ...def, portals: def.portals.filter((p) => p.to !== KINGDOM_ZONE_ID) }
      : def));
  for (const k of Object.keys(ZONES)) delete ZONES[k];
  for (const k of Object.keys(MONSTERS)) delete MONSTERS[k];
  ZONE_DEFS = list;
  for (const def of list) {
    const z = compileZone(def, list);
    ZONES[z.id] = z;
    for (const mon of z.monsters) MONSTERS[mon.id] = mon;
    if (z.boss) MONSTERS[z.boss.id] = z.boss;
  }
  registerKingdomZone(list);
}

// Kingdoms K-1 (docs/kingdoms-k1-plan.md 2.2, section 3). Only while Kingdoms are open: the
// Kingdom Zone is registered last (so no fallback ever picks it), and the Overworld gains its one
// path in, at the Overworld's town cell, needing the claim level. Nothing else may use that cell,
// so any other path there is removed. While closed, neither exists, and every reader of ZONES
// behaves as before.
function registerKingdomZone(list) {
  if (!kingdomsOpen()) return;
  const ow = ZONES[OVERWORLD_ID];
  if (!ow?.town) return;
  const z = compileZone(kingdomZoneDef(ow.town), list);
  ZONES[z.id] = z;
  ow.features = ow.features.filter((f) => !(f.type === 'portal' && f.x === ow.town.x && f.y === ow.town.y));
  ow.features.push({
    type: 'portal', x: ow.town.x, y: ow.town.y, to: KINGDOM_ZONE_ID, tx: KINGDOM_GATE.x, ty: KINGDOM_GATE.y,
    minLevel: kingdomConfig().minLevel, label: 'Enter the Kingdom Lands',
  });
}

// Register the zones again with the current Kingdom configuration. The edge functions call this
// once at start-up, after setKingdomConfig(): the import-time registry was built before it.
export function reloadZones() {
  loadZones(ZONE_DEFS);
}

loadZones(DEFAULT_ZONES);
