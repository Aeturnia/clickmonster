// The pending-rewards staging rule (#102; docs/pending-rewards-scope.md, 5.1, 5.6 and section 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter, addItem } from '../public/js/engine/character.js';
import { MAX_INVENTORY } from '../public/js/engine/battle.js';
import { stagePending, settleWaiting, waitingReminder } from '../public/js/engine/rewards.js';

const NOW = Date.UTC(2026, 10, 23, 12);
const relic = { base: 'sword_4', q: 'relic' };

function hero(packSize) {
  const c = createCharacter('Stager', 'human', NOW);
  c.notices = [];
  while (c.inventory.length < packSize) addItem(c, 'sword_1');
  return c;
}
const reward = (id, extra = {}) => ({ id, source: 'hunt', gold: 100, xp: 0, items: [], gems: {}, note: `Reward ${id}`, ...extra });

test('a pack with one free slot: gold and one relic are delivered whole', () => {
  const c = hero(MAX_INVENTORY - 1);
  const bank = c.bank;
  const { staged, blocked } = stagePending(c, [reward(1, { items: [relic] })], NOW);
  assert.deepEqual(staged.map((r) => r.id), [1]);
  assert.deepEqual(blocked, []);
  assert.equal(c.bank, bank + 100);
  assert.equal(c.inventory.length, MAX_INVENTORY);
  assert.equal(c.inventory.at(-1).q, 'relic');
});

test('a full pack: the whole reward stays pending, gold and XP included', () => {
  const c = hero(MAX_INVENTORY);
  const before = JSON.stringify({ bank: c.bank, xp: c.xp, gems: c.gems, inv: c.inventory.length });
  const { staged, blocked } = stagePending(c, [reward(1, { xp: 50, gems: { 'ruby:1': 1 }, items: [relic] })], NOW);
  assert.deepEqual(staged, []);
  assert.deepEqual(blocked, [{ id: 1, slots: 1 }]);
  assert.equal(JSON.stringify({ bank: c.bank, xp: c.xp, gems: c.gems, inv: c.inventory.length }), before, 'nothing of it was applied');
});

test('a full pack: a reward without items is delivered normally', () => {
  const c = hero(MAX_INVENTORY);
  const { staged, blocked } = stagePending(c, [reward(1, { xp: 10 })], NOW);
  assert.deepEqual(staged.map((r) => r.id), [1]);
  assert.deepEqual(blocked, []);
});

test('a blocked relic reward does not hold back a later gold-only reward', () => {
  const c = hero(MAX_INVENTORY);
  const bank = c.bank;
  const { staged, blocked } = stagePending(c, [reward(1, { items: [relic] }), reward(2, { gold: 7 })], NOW);
  assert.deepEqual(staged.map((r) => r.id), [2]);
  assert.deepEqual(blocked, [{ id: 1, slots: 1 }]);
  assert.equal(c.bank, bank + 7);
});

test('a reward with two items needs two free slots', () => {
  const two = reward(1, { items: [relic, relic] });
  const one = hero(MAX_INVENTORY - 1);
  assert.deepEqual(stagePending(one, [two], NOW).blocked, [{ id: 1, slots: 1 }], 'one free slot: blocked, one more needed');
  assert.equal(one.inventory.length, MAX_INVENTORY - 1);
  const twoFree = hero(MAX_INVENTORY - 2);
  assert.deepEqual(stagePending(twoFree, [two], NOW).staged.map((r) => r.id), [1], 'two free slots: delivered');
  assert.equal(twoFree.inventory.length, MAX_INVENTORY);
});

test('rewards are staged oldest first, and an earlier reward\'s items count against a later one', () => {
  const c = hero(MAX_INVENTORY - 1);
  const { staged, blocked } = stagePending(c, [reward(9, { items: [relic] }), reward(3, { items: [relic] })], NOW);
  assert.deepEqual(staged.map((r) => r.id), [3], 'the older reward (id 3) takes the last slot');
  assert.deepEqual(blocked, [{ id: 9, slots: 1 }]);
});

test('more than 20 open rewards, blocked ones first: every eligible one is delivered', () => {
  const c = hero(MAX_INVENTORY);
  const open = [];
  for (let i = 1; i <= 25; i++) open.push(reward(i, { items: [relic] }));
  for (let i = 26; i <= 30; i++) open.push(reward(i, { gold: 1 }));
  const { staged, blocked } = stagePending(c, open, NOW);
  assert.deepEqual(staged.map((r) => r.id), [26, 27, 28, 29, 30]);
  assert.equal(blocked.length, 25);
});

test('each delivered reward adds its notice, with the same text as before', () => {
  const c = hero(0);
  stagePending(c, [reward(1, { gold: 40, xp: 5, note: 'Your 50% share of the hunt for Grak' })], NOW);
  assert.deepEqual(c.notices.at(-1), { at: NOW, text: 'Your 50% share of the hunt for Grak: 40 gold (sent to your bank), 5 experience.' });
});

test('settleWaiting: a newly blocked reward gets one notice; staying blocked adds none', () => {
  const c = hero(MAX_INVENTORY);
  assert.equal(settleWaiting(c, [{ id: 4, slots: 1 }], NOW), true, 'the waiting list changed');
  assert.deepEqual(c.rewardsWaiting, [{ id: 4, slots: 1 }]);
  assert.equal(c.notices.length, 1);
  assert.match(c.notices[0].text, /A reward is waiting: your pack is full\. Free 1 inventory slot to receive it\./);
  assert.equal(settleWaiting(c, [{ id: 4, slots: 1 }], NOW + 1000), false, 'the same blocked reward again: no change');
  assert.equal(c.notices.length, 1, 'and no repeated notice');
});

test('settleWaiting: a delivered reward leaves the list, which is removed when empty', () => {
  const c = hero(MAX_INVENTORY);
  settleWaiting(c, [{ id: 4, slots: 1 }, { id: 5, slots: 2 }], NOW);
  assert.equal(c.notices.length, 2);
  assert.equal(settleWaiting(c, [{ id: 5, slots: 2 }], NOW), true);
  assert.deepEqual(c.rewardsWaiting, [{ id: 5, slots: 2 }]);
  assert.equal(c.notices.length, 2, 'no notice for a reward that left the list');
  assert.equal(settleWaiting(c, [], NOW), true);
  assert.equal('rewardsWaiting' in c, false);
});

test('waitingReminder: the Gear tab text, and nothing when no reward waits', () => {
  const c = hero(MAX_INVENTORY);
  assert.equal(waitingReminder(c), null);
  c.rewardsWaiting = [{ id: 4, slots: 1 }];
  assert.deepEqual(waitingReminder(c), { slots: '40 / 40 inventory slots', text: '1 reward waiting. Free 1 inventory slot to receive it.' });
  c.rewardsWaiting = [{ id: 4, slots: 2 }, { id: 5, slots: 1 }];
  assert.equal(waitingReminder(c).text, '2 rewards waiting. Free 2 inventory slots to receive the next one.');
});
