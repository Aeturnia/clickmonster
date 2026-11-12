// Buying, selling, equipping and socketing gems.
import { ITEMS, SELL_RATE, shopStock } from '../data/items.js';
import { parseGem, extractCost } from '../data/gems.js';
import { addItem, findItem, meetsRequirements, maxHp } from './character.js';
import { currentZone, inTown } from './world.js';

const MAX_INVENTORY = 40;

function requireTown(char) {
  if (!inTown(char)) throw new Error('You need to be in town.');
}

export function shopItems(char) {
  const zone = currentZone(char);
  return zone.shop ? shopStock(zone.shop) : [];
}

export function buy(char, baseId) {
  requireTown(char);
  if (!shopItems(char).includes(baseId)) throw new Error('This shop doesn’t sell that.');
  const base = ITEMS[baseId];
  if (char.gold < base.price) throw new Error('Not enough gold.');
  if (char.inventory.length >= MAX_INVENTORY) throw new Error('Your pack is full. Sell something first.');
  char.gold -= base.price;
  return addItem(char, baseId);
}

export function isEquipped(char, uid) {
  return Object.values(char.equipment).includes(uid);
}

export function sellPrice(item) {
  return Math.floor(ITEMS[item.base].price * SELL_RATE);
}

export function sell(char, uid) {
  requireTown(char);
  const item = findItem(char, uid);
  if (!item) throw new Error('No such item.');
  if (isEquipped(char, uid)) throw new Error('Unequip it first.');
  const price = sellPrice(item);
  char.gold += price;
  char.inventory = char.inventory.filter((i) => i.uid !== uid);
  return price;
}

function clampHp(char) {
  char.hp = Math.min(char.hp, maxHp(char));
}

function requireOutOfBattle(char) {
  if (char.battle && !char.battle.over) throw new Error('Not during a fight!');
}

export function equip(char, uid) {
  requireOutOfBattle(char);
  const item = findItem(char, uid);
  if (!item) throw new Error('No such item.');
  const base = ITEMS[item.base];
  const check = meetsRequirements(char, item.base);
  if (!check.ok) throw new Error('You don’t meet the requirements for that.');
  char.equipment[base.slot] = uid;
  clampHp(char);
}

export function unequip(char, slot) {
  requireOutOfBattle(char);
  char.equipment[slot] = null;
  clampHp(char);
}

export function socketGem(char, uid, gemKey) {
  requireOutOfBattle(char);
  const item = findItem(char, uid);
  if (!item) throw new Error('No such item.');
  const base = ITEMS[item.base];
  if (item.gems.length >= base.sockets) throw new Error('No empty sockets.');
  if (!parseGem(gemKey) || !char.gems[gemKey]) throw new Error('You don’t have that gem.');
  char.gems[gemKey] -= 1;
  if (!char.gems[gemKey]) delete char.gems[gemKey];
  item.gems.push(gemKey);
}

export function extractGem(char, uid, index) {
  requireTown(char);
  requireOutOfBattle(char);
  const item = findItem(char, uid);
  const key = item && item.gems[index];
  if (!key) throw new Error('No gem there.');
  const cost = extractCost(parseGem(key).tier);
  if (char.gold < cost) throw new Error(`The jeweler charges ${cost} gold.`);
  char.gold -= cost;
  item.gems.splice(index, 1);
  char.gems[key] = (char.gems[key] || 0) + 1;
  clampHp(char);
  return cost;
}

// One-tap purchase for gear you can use right away.
export function buyAndEquip(char, baseId) {
  if (!ITEMS[baseId]) throw new Error('No such item.');
  requireOutOfBattle(char);
  if (!meetsRequirements(char, baseId).ok) throw new Error('You don’t meet the requirements for that.');
  const item = buy(char, baseId);
  equip(char, item.uid);
  return item;
}
