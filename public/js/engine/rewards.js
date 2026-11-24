// Pending rewards (#102; docs/pending-rewards-scope.md, 5.1 and 5.6). Shared by the `game`
// function and the tests.
//
// A pending reward is indivisible: it is delivered whole (its gold, XP, gems and items) or not
// at all. stagePending() applies, in memory only, every open reward whose items fit in the pack,
// oldest first, and reports the rest as blocked; a blocked reward never holds back a later one.
// Nothing is claimed here: the caller claims exactly the staged ids in the same transaction that
// saves the hero (save_hero_with_rewards()), so a request that fails delivers nothing.
import { addItem, gainXp } from './character.js';
import { MAX_INVENTORY } from './battle.js';

const itemsOf = (r) => (Array.isArray(r.items) ? r.items : []);

function deliveryText(r) {
  const gold = Number(r.gold || 0);
  const xp = Number(r.xp || 0);
  const parts = [gold ? `${gold} gold (sent to your bank)` : '', xp ? `${xp} experience` : '', itemsOf(r).length ? 'a rare item' : ''].filter(Boolean);
  return `${r.note || 'Reward'}: ${parts.join(', ')}.`;
}

function addNotice(char, text, now) {
  char.notices = [...(char.notices || []).slice(-9), { at: now, text }];
}

// open: pending_rewards rows ({ id, gold, xp, items, gems, note }), any order. Returns
// { staged: [rows applied], blocked: [{ id, slots }] }, where slots is how many more free pack
// slots that reward needs. The staged rows' effects, and a delivery notice for each, are on `char`.
// A blocked reward's slots are counted against the pack as it is after every eligible reward of
// the pass has been applied (review of PR #108, B-02), since a later reward can take a free slot.
export function stagePending(char, open, now = Date.now(), maxInventory = MAX_INVENTORY) {
  const staged = [];
  const waiting = [];
  const rows = [...(open || [])].sort((a, b) => Number(a.id) - Number(b.id));
  for (const r of rows) {
    const items = itemsOf(r);
    if (char.inventory.length + items.length > maxInventory) {
      waiting.push(r);
      continue;
    }
    char.bank = (char.bank || 0) + Number(r.gold || 0);
    if (r.xp) gainXp(char, Number(r.xp));
    for (const it of items) addItem(char, it.base, it.q || null);
    for (const [k, n] of Object.entries(r.gems || {})) char.gems[k] = (char.gems[k] || 0) + Number(n);
    addNotice(char, deliveryText(r), now);
    staged.push(r);
  }
  const blocked = waiting.map((r) => ({ id: Number(r.id), slots: char.inventory.length + itemsOf(r).length - maxInventory }));
  return { staged, blocked };
}

const slotsText = (n) => `${n} inventory slot${n === 1 ? '' : 's'}`;

// The rewards still waiting after a request's last staging pass. Called once, with that pass's
// blocked list. A notice is added only for a reward that has just become blocked, so a reward that
// stays blocked is announced once, not on every request. Returns whether rewardsWaiting changed.
export function settleWaiting(char, blocked, now = Date.now()) {
  const before = JSON.stringify(char.rewardsWaiting || []);
  const known = new Set((char.rewardsWaiting || []).map((w) => Number(w.id)));
  const next = [...(blocked || [])].sort((a, b) => a.id - b.id).map((b) => ({ id: Number(b.id), slots: Number(b.slots) }));
  for (const b of next) {
    if (!known.has(b.id)) addNotice(char, `A reward is waiting: your pack is full. Free ${slotsText(b.slots)} to receive it.`, now);
  }
  if (next.length) char.rewardsWaiting = next;
  else delete char.rewardsWaiting;
  return JSON.stringify(char.rewardsWaiting || []) !== before;
}

// The Gear tab's lasting reminder (question 3), or null when nothing is waiting.
export function waitingReminder(char, maxInventory = MAX_INVENTORY) {
  const w = char.rewardsWaiting || [];
  if (!w.length) return null;
  const count = `${w.length} reward${w.length === 1 ? '' : 's'} waiting`;
  return {
    slots: `${char.inventory.length} / ${maxInventory} inventory slots`,
    text: `${count}. Free ${slotsText(w[0].slots)} to receive ${w.length === 1 ? 'it' : 'the next one'}.`,
  };
}
