// All gear is shared by every race. Items are generated from tiers ("Class I" .. "Class X").
// Higher class = more power, more sockets, higher stat requirements.
import { ELEMENTS, ELEMENT_LABEL } from './elements.js';

export const SLOTS = ['weapon', 'focus', 'helm', 'body', 'boots'];
export const SLOT_LABEL = { weapon: 'Weapon', focus: 'Focus', helm: 'Helm', body: 'Body', boots: 'Boots' };

// Approximate character level each tier is meant for.
export const TIER_LEVEL = [null, 1, 5, 10, 15, 22, 30, 38, 46, 55, 65];
export const MAX_TIER = 10;
const ROMAN = [null, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const tierRoman = (t) => ROMAN[t];

export const WEAPON_TYPES = {
  sword: { label: 'Sword', req: ['str', 'dex'], hitBonus: 0.03, crit: 0.06, pierce: 0, perk: 'Balanced: +3% hit' },
  axe: { label: 'Axe', req: ['str', 'vit'], hitBonus: 0, crit: 0.14, pierce: 0, perk: 'Brutal: 14% crit chance' },
  mace: { label: 'Mace', req: ['str', 'vit'], hitBonus: 0, crit: 0.05, pierce: 0.35, perk: 'Crushing: ignores 35% armor' },
  dagger: { label: 'Dagger', req: ['dex', 'str'], hitBonus: 0.05, crit: 0.08, pierce: 0, perk: 'Swift: +5% hit, 8% crit' },
};

const WEAPON_MAT = [null, 'Rusty', 'Iron', 'Steel', 'Tempered', 'Mithril', 'Runed', 'Adamant', 'Dragonbone', 'Celestial', 'Voidforged'];
const FOCUS_MAT = [null, 'Twig', 'Oak', 'Ashwood', 'Bone', 'Crystal', 'Runed', 'Starmetal', 'Dragonbone', 'Celestial', 'Void'];
const ARMOR_MAT = [null, 'Padded', 'Leather', 'Studded', 'Chain', 'Scale', 'Plate', 'Runed', 'Adamant', 'Dragonscale', 'Celestial'];
const ARMOR_NAME = { helm: 'Helm', body: 'Armor', boots: 'Boots' };
const ARMOR_REQ = { helm: ['vit', 'wis'], body: ['vit', 'str'], boots: ['vit', 'dex'] };
const ARMOR_SHARE = { helm: 0.3, body: 0.5, boots: 0.2 };

function socketsFor(tier) {
  if (tier <= 1) return 0;
  if (tier <= 3) return 1;
  if (tier <= 6) return 2;
  return 3;
}

function reqsFor(tier, [primary, secondary]) {
  if (tier <= 1) return {};
  const lvl = TIER_LEVEL[tier];
  return { [primary]: Math.round(lvl * 3), [secondary]: Math.round(lvl * 1.5) };
}

function priceFor(tier) {
  return Math.round(12 * Math.pow(TIER_LEVEL[tier] + 1, 1.6));
}

function scoreFor(power, sockets) {
  return Math.round(power * 10 + sockets * 25);
}

export const ITEMS = {};

for (let t = 1; t <= MAX_TIER; t++) {
  const lvl = TIER_LEVEL[t];
  const sockets = socketsFor(t);
  const price = priceFor(t);

  for (const [type, w] of Object.entries(WEAPON_TYPES)) {
    const power = Math.round(3 + lvl * 2);
    const id = `${type}_${t}`;
    ITEMS[id] = {
      id, tier: t, slot: 'weapon', type, name: `${WEAPON_MAT[t]} ${w.label}`,
      power, sockets, req: reqsFor(t, w.req), price, score: scoreFor(power, sockets),
    };
  }

  const focusKind = t <= 3 ? 'Wand' : t <= 6 ? 'Rod' : 'Staff';
  for (const el of ELEMENTS) {
    const power = Math.round(3 + lvl * 2);
    const id = `focus_${el}_${t}`;
    ITEMS[id] = {
      id, tier: t, slot: 'focus', element: el, name: `${FOCUS_MAT[t]} ${focusKind} of ${ELEMENT_LABEL[el]}`,
      power, sockets, req: reqsFor(t, ['int', 'wis']), price, score: scoreFor(power, sockets),
    };
  }

  for (const slot of ['helm', 'body', 'boots']) {
    const armor = Math.max(1, Math.round((4 + lvl * 3) * ARMOR_SHARE[slot]));
    const id = `${slot}_${t}`;
    ITEMS[id] = {
      id, tier: t, slot, name: `${ARMOR_MAT[t]} ${ARMOR_NAME[slot]}`,
      armor, sockets, req: reqsFor(t, ARMOR_REQ[slot]), price: Math.round(price * 0.8),
      score: scoreFor(armor * 2, sockets),
    };
  }
}

export const SELL_RATE = 0.4;

// Build a shop's stock list from a compact shop spec.
export function shopStock(shop) {
  const ids = [];
  for (const t of shop.tiers) {
    for (const w of shop.weapons) ids.push(`${w}_${t}`);
    for (const el of shop.elements) ids.push(`focus_${el}_${t}`);
    if (shop.armor) ids.push(`helm_${t}`, `body_${t}`, `boots_${t}`);
  }
  return ids.filter((id) => ITEMS[id]);
}

// ---- Rare drops ("relics"): stronger than shop gear, an extra socket, lower requirements.
export const QUALITY = {
  relic: { label: 'Relic', power: 1.2, req: 0.7, socket: 1, price: 4 },
};

// The real stats of an item instance ({ base, q }), including its quality.
export function itemDef(item) {
  const base = ITEMS[item.base];
  if (!base) return null;
  const q = item.q && QUALITY[item.q];
  if (!q) return base;
  const req = {};
  for (const [s, n] of Object.entries(base.req)) req[s] = Math.round(n * q.req);
  const def = {
    ...base,
    quality: item.q,
    name: `${q.label} ${base.name}`,
    sockets: Math.min(3, base.sockets + q.socket),
    req,
    price: base.price * q.price,
  };
  if (base.power != null) def.power = Math.round(base.power * q.power);
  if (base.armor != null) def.armor = Math.round(base.armor * q.power);
  def.score = Math.round(((def.power ?? def.armor * 2)) * 10 + def.sockets * 25);
  return def;
}

// Highest shop tier appropriate for a monster level (used for rare drops).
export function tierForLevel(level) {
  let t = 1;
  for (let i = 1; i <= MAX_TIER; i++) if (TIER_LEVEL[i] <= level + 2) t = i;
  return t;
}
