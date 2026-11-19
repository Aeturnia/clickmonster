// Phase 3 interaction feedback: confirmations, pending and refused actions, battle turns and
// outcomes, change cues and empty states. Run with: npm run test:ui
// Deterministic fixtures only: the fake backend fails any test that reaches anything else,
// and no test may see a native confirm()/prompt()/alert().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, fixedQuest, adminTab, watchCues } from './harness.mjs';
import { xpToNext } from '../../public/js/engine/character.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const MUSA = { id: 'char-other', name: 'Musa', race: 'human', level: 33, zone: 'duskhollow', x: 2, y: 2, updated_at: new Date().toISOString() };
const CHAT = [{ id: 7, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: new Date(Date.now() - 60000).toISOString() }];

async function game({ hero = {}, players = [], who = 'player', reducedMotion, viewport = { width: 390, height: 844 } } = {}) {
  const backend = new FakeBackend({ hero: makeHero(hero), players, chat: structuredClone(CHAT), quests: [fixedQuest()] });
  const ctx = await env.page({ backend, viewport, mobile: true, reducedMotion });
  await signIn(ctx.page, env.url, who, who === 'admin' ? '/admin.html' : '/');
  await ctx.page.waitForSelector(who === 'admin' ? '.tiles' : '[data-a="move"], #log', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native confirm/prompt/alert');
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  await ctx.context.close();
}
const calls = (backend, action) => backend.calls.filter((c) => c.action === action).length;
const tap = async (page, sel) => { await page.waitForTimeout(270); await page.click(sel); await settle(page); };
const dialogInfo = (page) => page.evaluate(() => {
  const d = document.getElementById('confirm');
  return d && {
    open: d.open, role: d.getAttribute('role'), title: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
    body: document.getElementById(d.getAttribute('aria-describedby'))?.textContent.replace(/\s+/g, ' ').trim(),
    focus: document.activeElement.dataset.r || document.activeElement.id, okDisabled: d.querySelector('[data-r="ok"]').disabled,
  };
});

// ---------------------------------------------------------------- confirmations

test('delete hero: styled confirmation, type the name, Escape cancels and restores focus', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await tap(page, '[data-a="tab"][data-v="hero"]');
  await page.focus('[data-a="delete"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirm[open]');
  let d = await dialogInfo(page);
  assert.equal(d.role, 'alertdialog');
  assert.equal(d.title, 'Delete Bartholomew Thorne?');
  assert.match(d.body, /gear, gems, gold \(carried and banked\)/);
  assert.match(d.body, /cannot be undone/);
  assert.equal(d.focus, 'confirm-input', 'focus starts in the name field');
  assert.equal(d.okDisabled, true, 'nothing to confirm until the name is typed');
  assert.deepEqual((await axe(page)).map((v) => v.id), [], 'axe on the dialog');
  await page.keyboard.type('Bartholomew');
  assert.equal((await dialogInfo(page)).okDisabled, true, 'a partial name does not unlock it');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('confirm').open), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.a), 'delete', 'focus back on Delete hero');
  assert.equal(calls(backend, 'delete'), 0, 'cancelled: nothing sent');
  // Again, typing the name (any case) and pressing Enter.
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirm[open]');
  await page.keyboard.type('bartholomew thorne');
  assert.equal((await dialogInfo(page)).okDisabled, false);
  await page.keyboard.press('Enter'); await settle(page);
  assert.equal(calls(backend, 'delete'), 1);
  await page.waitForSelector('#name', { timeout: 5000 }); // back to hero creation
  await done(ctx);
});

test('attack: the confirmation states the real stakes and defaults to the safe choice', async () => {
  const ctx = await game({ hero: { level: 35, zone: 'duskhollow', x: 2, y: 2, gold: 4321 }, players: [MUSA] });
  const { page, backend } = ctx;
  await page.evaluate(() => { window.clickmonster.char.xp = 500; });
  await tap(page, '[data-a="list"][data-v="players"]');
  await page.waitForSelector('[data-a="attack"]');
  await page.click('[data-a="attack"]');
  await page.waitForSelector('#confirm[open]');
  const d = await dialogInfo(page);
  assert.equal(d.title, 'Attack Musa?');
  assert.match(d.body, /you drop all 4,321 gold you carry/, 'all carried gold, not 10%');
  assert.match(d.body, /lose \d[\d,]* experience/);
  assert.match(d.body, /bank is safe/);
  assert.equal(d.focus, 'cancel', 'a risky action starts on Cancel');
  // A tap outside the card cancels.
  await page.mouse.click(5, 5);
  assert.equal(await page.evaluate(() => document.getElementById('confirm').open), false);
  assert.equal(calls(backend, 'attack'), 0);
  await page.waitForTimeout(300);
  await page.click('[data-a="attack"]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.equal(calls(backend, 'attack'), 1);
  await page.waitForSelector('#log');
  await done(ctx);
});

test('abandon quest: names the quest and the reward given up; Keep quest keeps it', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await tap(page, '[data-a="quests"]');
  await page.waitForSelector('[data-a="accept"]');
  await tap(page, '[data-a="accept"]');
  if (!await page.$('#sheet[open] [data-a="abandon"]')) await tap(page, '[data-a="quests"]');
  await page.click('[data-a="abandon"]');
  await page.waitForSelector('#confirm[open]');
  const d = await dialogInfo(page);
  assert.equal(d.title, 'Abandon your quest?');
  assert.match(d.body, /You give up the reward: [\d,]+ XP, [\d,]+ gold/);
  await page.click('#confirm [data-r="cancel"]');
  assert.ok(await page.evaluate(() => !!window.clickmonster.char.quest), 'still on the quest');
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), true, 'the quest board stays open underneath');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.a), 'abandon', 'focus back on Abandon');
  await page.click('[data-a="abandon"]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.equal(calls(backend, 'abandon'), 1);
  assert.equal(await page.evaluate(() => window.clickmonster.char.quest), null);
  await done(ctx);
});

test('selling: only asks when it would destroy socketed gems; Escape closes just the question', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await tap(page, '[data-a="tab"][data-v="gear"]');
  // A plain item sells at the price on the button, without a question.
  await page.locator('[data-a="item"]', { hasText: 'Padded Helm' }).click();
  await page.waitForSelector('#sheet[open] [data-a="sell"]');
  await tap(page, '[data-a="sell"]');
  assert.equal(calls(backend, 'sell'), 1);
  assert.equal(await page.evaluate(() => !!document.getElementById('confirm')?.open), false);
  // With a gem socketed, it asks first.
  await page.locator('[data-a="item"]', { hasText: /\/\d sockets/ }).first().click();
  await page.waitForSelector('#sheet[open] [data-a="socket"]');
  await tap(page, '[data-a="socket"]');
  await page.click('[data-a="sell"]');
  await page.waitForSelector('#confirm[open]');
  const d = await dialogInfo(page);
  assert.match(d.title, /^Sell (Relic )?Leather Boots for [\d,]+ gold\?$/);
  assert.match(d.body, /The gem in it \(.+\) will be destroyed\.\s*To keep it, extract it at the jeweler/);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => [document.getElementById('confirm').open, document.getElementById('sheet').open]).then((x) => x.join()), 'false,true');
  assert.equal(calls(backend, 'sell'), 1, 'cancelled: not sold');
  await page.click('[data-a="sell"]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.equal(calls(backend, 'sell'), 2);
  await done(ctx);
});

test('chat report: a dialog with an optional reason replaces prompt(); the reason is sent', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');
  await page.click('.chat-line[data-v="7"]');
  await page.click('[data-c="report"]');
  await page.waitForSelector('#confirm[open]');
  let d = await dialogInfo(page);
  assert.equal(d.title, 'Report this message?');
  assert.match(d.body, /Musa: "Anyone hunting goblins\?"/);
  assert.equal(d.focus, 'confirm-input');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => [document.getElementById('confirm').open, document.getElementById('chat').open]).then((x) => x.join()), 'false,true', 'Escape closes the question, not the chat');
  assert.equal(calls(backend, 'report'), 0);
  await page.click('[data-c="report"]');
  await page.fill('#confirm-input', 'Spamming links');
  await page.keyboard.press('Enter'); await settle(page);
  const sent = backend.calls.filter((c) => c.action === 'report');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args.reason, 'Spamming links');
  assert.equal(String(sent[0].args.messageId), '7');
  await done(ctx);
});

test('admin: a permanent ban needs the name typed, a timed mute does not; cancelling sends nothing', async () => {
  const ctx = await game({ who: 'admin' });
  const { page, backend } = ctx;
  await adminTab(page, 'players'); await page.waitForTimeout(400);
  await page.click('[data-a="open"]'); await page.waitForSelector('#sanction');
  await page.selectOption('#s-kind', 'ban'); await page.fill('#s-days', ''); await page.fill('#s-reason', 'Botting');
  await page.click('#sanction [type="submit"]');
  await page.waitForSelector('#confirm[open]');
  let d = await dialogInfo(page);
  assert.equal(d.title, 'Ban Bartholomew Thorne permanently?');
  assert.match(d.body, /Reason shown to them: "Botting"/);
  assert.equal(d.okDisabled, true);
  await page.click('#confirm [data-r="cancel"]');
  assert.equal(calls(backend, 'sanction'), 0);
  await page.selectOption('#s-kind', 'mute'); await page.fill('#s-days', '2');
  await page.click('#sanction [type="submit"]');
  await page.waitForSelector('#confirm[open]');
  d = await dialogInfo(page);
  assert.equal(d.title, 'Mute Bartholomew Thorne for 2 days?');
  assert.equal(d.okDisabled, false, 'no typing for a timed sanction');
  assert.deepEqual((await axe(page)).map((v) => v.id), [], 'axe on the admin dialog');
  await page.click('#confirm [data-r="ok"]'); await page.waitForTimeout(400);
  const sent = backend.calls.filter((c) => c.action === 'sanction');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args.kind, 'mute');
  await done(ctx);
});

test('admin zones: a delete the server would refuse is explained, not asked; restore asks', async () => {
  const ctx = await game({ who: 'admin' });
  const { page, backend } = ctx;
  await adminTab(page, 'zones'); await page.waitForTimeout(400);
  await page.locator('button[data-a="zoneEdit"]', { hasText: 'Edit' }).nth(1).click(); await page.waitForTimeout(300);
  await page.click('[data-a="zoneDelete"]'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => !!document.getElementById('confirm')?.open), false, 'no question for a blocked delete');
  assert.match(await page.textContent('#alerts'), /can’t be deleted\. (.+ heroes start here|Paths lead here from)/);
  assert.equal(calls(backend, 'deleteZone'), 0);
  await page.click('[data-a="zoneReset"]');
  await page.waitForSelector('#confirm[open]');
  assert.match((await dialogInfo(page)).title, /^Restore the built-in /);
  await page.keyboard.press('Escape');
  assert.equal(calls(backend, 'resetZone'), 0);
  await done(ctx);
});

// ---------------------------------------------------------------- pending and refused actions

async function intoFight(page, foe = 'Bog Hag') {
  await tap(page, '[data-a="move"][data-v="n"]');
  // The monster drop-down (gameplay polish F1): choose, then Fight.
  await page.selectOption('#mon-select', await page.evaluate((n) => Object.values(window.clickmonster.MONSTERS).find((m) => m.name === n).id, foe));
  await page.click('#main [data-a="fight"]'); await settle(page);
  await page.waitForTimeout(270);
}

test('pending: the pressed action is busy (and stays so across re-renders); other taps are refused out loud', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await intoFight(page);
  await tap(page, '[data-a="melee"]'); // take some damage so health regenerates (re-renders every second)
  const release = backend.hold('melee');
  await page.waitForTimeout(270);
  await page.click('[data-a="melee"]');
  await page.waitForTimeout(1300);
  const st = await page.evaluate(() => ({
    busy: document.querySelector('[data-a="melee"]').getAttribute('aria-busy'),
    pending: document.querySelector('[data-a="melee"]').classList.contains('pending'),
    app: document.getElementById('app').hasAttribute('data-busy'),
    others: document.querySelectorAll('[aria-busy="true"]').length,
  }));
  assert.deepEqual(st, { busy: 'true', pending: true, app: true, others: 1 });
  assert.deepEqual((await axe(page)).map((v) => v.id), [], 'pending state passes axe (the old pulse failed contrast)');
  await page.click('[data-a="cast"]');
  await page.waitForFunction(() => /Still working on your last action/.test(document.getElementById('toast').textContent));
  assert.equal(await page.getAttribute('#toast', 'role'), 'status');
  assert.ok(await page.evaluate(() => document.querySelector('[data-a="cast"]').classList.contains('refused')), 'the refused control is nudged');
  assert.equal(calls(backend, 'cast'), 0, 'the refused tap sent nothing');
  release(); await settle(page);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.getElementById('app').hasAttribute('data-busy'));
  assert.equal(calls(backend, 'melee'), 2);
  await done(ctx);
});

test('double tap: the second tap is refused with a message, and only one action is sent', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await intoFight(page);
  // The first tap's answer comes back fast; a second tap straight after (within 250ms) is the
  // classic accidental double tap.
  await page.click('[data-a="melee"]');
  await page.waitForFunction(() => !document.getElementById('app').hasAttribute('data-busy'), null, { polling: 5 });
  await page.click('[data-a="melee"]');
  await page.waitForFunction(() => /Second tap ignored/.test(document.getElementById('toast').textContent));
  assert.equal(calls(backend, 'melee'), 1);
  await done(ctx);
});

// ---------------------------------------------------------------- battle turns, outcome, change cues

test('battle log: turns are grouped, the current turn stands out, the outcome lists rewards', async () => {
  const ctx = await game();
  const { page } = ctx;
  await intoFight(page);
  await watchCues(page);
  for (let i = 0; i < 2; i++) await tap(page, '[data-a="melee"]');
  let log = await page.evaluate(() => ({
    turns: [...document.querySelectorAll('#log .turn')].map((t) => t.querySelector('.turn-label').textContent),
    current: document.querySelectorAll('#log .turn.current').length,
    latestInCurrent: !!document.querySelector('#log .turn.current p.latest'),
    olderOutside: [...document.querySelectorAll('#log .turn:not(.current) p:not(.turn-label):not(.turn-gain)')].every((p) => p.classList.contains('older')),
  }));
  assert.deepEqual(log.turns, ['Turn 1', 'Turn 2']);
  assert.equal(log.current, 1);
  assert.ok(log.latestInCurrent && log.olderOutside);
  for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) await tap(page, '[data-a="melee"]');
  const out = await page.evaluate(() => {
    const b = window.clickmonster.char.battle;
    return {
      over: b.over, rewards: b.rewards,
      title: document.querySelector('.outcome .outcome-title')?.textContent,
      chips: [...document.querySelectorAll('.outcome .rewards li')].map((l) => l.textContent),
      afterLog: document.getElementById('log').nextElementSibling?.classList.contains('outcome'),
    };
  });
  assert.equal(out.over, 'victory');
  assert.equal(out.title, 'Victory');
  assert.ok(out.chips.includes(`+${out.rewards.xp} XP`) && out.chips.includes(`+${out.rewards.gold} gold`), out.chips.join(' | '));
  assert.ok(out.afterLog, 'the outcome follows the log, next to the actions');
  // The gold and XP cues float over the hero bar (gameplay polish amendment G1).
  await page.waitForTimeout(1900);
  const cues = await page.evaluate(() => window.__cues);
  assert.deepEqual(cues.map((c) => c.text).sort(), [`+${out.rewards.gold}`, `+${out.rewards.xp} XP`].sort());
  assert.ok(cues.every((c) => c.ariaHidden === 'true'), 'cues are decorative; the log and announcements carry the news');
  assert.equal(await page.$('#top .cue'), null, 'the cues go away');
  await done(ctx);
});

test('defeat: the outcome lists what was lost, formatted', async () => {
  const ctx = await game({ hero: { gold: 1234567 } });
  const { page } = ctx;
  await intoFight(page, 'Wisp Swarm');
  for (let i = 0; i < 40 && await page.$('[data-a="melee"]'); i++) await tap(page, '[data-a="melee"]');
  const out = await page.evaluate(() => ({
    over: window.clickmonster.char.battle?.over,
    title: document.querySelector('.outcome.loss .outcome-title')?.textContent,
    chips: [...document.querySelectorAll('.outcome .losses li')].map((l) => l.textContent),
  }));
  assert.equal(out.over, 'defeat');
  assert.equal(out.title, 'Defeated');
  assert.ok(out.chips.includes('Lost 1,234,567 gold'), out.chips.join(' | '));
  assert.ok(out.chips.includes('Back in town'));
  await done(ctx);
});

test('reduced motion: cues and pending bars hold still, refusals use an outline instead of a shake', async () => {
  const ctx = await game({ reducedMotion: 'reduce' });
  const { page } = ctx;
  const st = await page.evaluate(() => {
    const mk = (cls, tag = 'span') => { const el = document.createElement(tag); el.className = cls; document.getElementById('main').appendChild(el); return el; };
    const delta = getComputedStyle(mk('cue up')).animationName;
    const bar = getComputedStyle(mk('btn pending', 'button'), '::after').animationName;
    const refused = mk('btn refused', 'button');
    const r = getComputedStyle(refused);
    return { delta, bar, refusedAnim: r.animationName, refusedOutline: r.outlineStyle };
  });
  assert.deepEqual(st, { delta: 'none', bar: 'none', refusedAnim: 'none', refusedOutline: 'dashed' });
  await done(ctx);
});

// ---------------------------------------------------------------- empty and loading states

test('empty and loading states follow one pattern: statement, then what to do', async () => {
  const ctx = await game();
  const { page } = ctx;
  await tap(page, '[data-a="move"][data-v="n"]');
  await page.click('[data-a="list"][data-v="players"]');
  const loading = await page.evaluate(() => {
    const e = document.querySelector('#main .empty');
    return e && { busy: e.getAttribute('aria-busy'), title: e.querySelector('.empty-title')?.textContent };
  });
  if (loading?.busy) assert.equal(loading.title, 'Looking around'); // only visible until the list arrives
  await page.waitForFunction(() => /No other adventurers/.test(document.querySelector('#main .empty-title')?.textContent || ''));
  const empty = await page.evaluate(() => {
    const e = document.querySelector('#main .empty');
    return { busy: e.getAttribute('aria-busy'), hint: e.querySelector('.empty-hint')?.textContent };
  });
  assert.equal(empty.busy, null);
  assert.match(empty.hint, /refreshes on its own/);
  await done(ctx);
});

// ---------------------------------------------------------------- review corrections (PR #12)

const live = (id, text, extra = {}) => ({
  id, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null,
  recipient_id: null, recipient_name: null, text, deleted_at: null, created_at: new Date().toISOString(), ...extra,
});

test('P3-01 focus returns to the replacement of a re-rendered trigger, or to a sensible fallback', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');
  await page.click('.chat-line[data-v="7"]');
  await page.focus('[data-c="report"][data-v="7"]');
  await page.evaluate(() => { document.querySelector('[data-c="report"][data-v="7"]').__original = true; });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirm[open]');
  // A Realtime message arrives while the question is open and re-renders the chat list.
  backend.broadcast('chat_messages', 'INSERT', live(801, 'Fresh news from the meadows'));
  await page.waitForFunction(() => /Fresh news/.test(document.getElementById('chat-list').textContent));
  assert.equal(await page.evaluate(() => document.querySelector('[data-c="report"][data-v="7"]').__original), undefined, 'the trigger was replaced');
  await page.keyboard.press('Escape');
  const back = await page.evaluate(() => ({ c: document.activeElement.dataset.c, v: document.activeElement.dataset.v, connected: document.activeElement.isConnected }));
  assert.deepEqual(back, { c: 'report', v: '7', connected: true }, 'focus on the replacement Report button');
  assert.equal(calls(backend, 'report'), 0, 'cancelled: nothing sent');

  // The trigger disappears entirely: a moderator removes the message meanwhile (no Report on it now).
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirm[open]');
  backend.broadcast('chat_messages', 'UPDATE', live(7, '', { deleted_at: new Date().toISOString(), created_at: CHAT[0].created_at }));
  await page.waitForFunction(() => !document.querySelector('[data-c="report"][data-v="7"]'));
  await page.keyboard.press('Escape');
  const fb = await page.evaluate(() => ({ c: document.activeElement.dataset.c, v: document.activeElement.dataset.v, inChat: !!document.activeElement.closest('#chat') }));
  assert.deepEqual(fb, { c: 'menu', v: '7', inChat: true }, "focus falls back to the message's line");
  assert.equal(await page.evaluate(() => document.getElementById('chat').open), true, 'the chat stays open');
  assert.equal(calls(backend, 'report'), 0);
  await done(ctx);
});

test('P3-02 an error that arrives while a confirmation is open survives its closing', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await tap(page, '[data-a="quests"]');
  await page.waitForSelector('[data-a="accept"]');
  await tap(page, '[data-a="accept"]');
  await page.keyboard.press('Escape'); await settle(page);
  await page.evaluate(() => { document.getElementById('toast').__original = true; });
  // Reopen the board; its refresh is slow and then fails.
  const release = backend.hold('quests');
  backend.failNext('quests', 500, 'The quest board is unavailable right now.');
  await page.waitForTimeout(270);
  await page.click('[data-a="quests"]'); // the board shows "Reading the board" while it waits
  await page.waitForSelector('#sheet[open] [data-a="abandon"]');
  await page.click('#sheet [data-a="abandon"]');
  await page.waitForSelector('#confirm[open]');
  release();
  await page.waitForFunction(() => /quest board is unavailable/.test(document.getElementById('alerts')?.textContent || ''));
  const during = await page.evaluate(() => ({ host: document.getElementById('alerts').parentElement.id, visible: document.getElementById('alerts').getClientRects().length > 0 }));
  assert.deepEqual(during, { host: 'confirm', visible: true }, 'shown above the open confirmation');
  assert.deepEqual((await axe(page)).map((v) => v.id), [], 'axe: confirmation over a sheet, with an error');
  await page.evaluate(() => { document.getElementById('alerts').__original = true; });
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => {
    const a = document.getElementById('alerts');
    return {
      sameAlerts: a?.__original === true, sameToast: document.getElementById('toast')?.__original === true,
      text: a?.textContent.replace(/\s+/g, ' ').trim(), host: a?.parentElement.id, visible: !!a && a.getClientRects().length > 0,
      confirmChildren: [...document.getElementById('confirm').children].map((c) => c.id),
    };
  });
  assert.ok(after.sameAlerts && after.sameToast, 'the shared toast and problem list were not destroyed');
  assert.match(after.text, /The quest board is unavailable right now\./);
  assert.equal(after.host, 'sheet', 'moved to the sheet still open underneath');
  assert.ok(after.visible);
  assert.deepEqual(after.confirmChildren, ['confirm-content'], 'nothing shared left behind in the closed dialog');
  assert.equal(calls(backend, 'abandon'), 0, 'cancelled: nothing sent');
  assert.ok(await page.evaluate(() => !!window.clickmonster.char.quest), 'still on the quest');
  // Still dismissible.
  await page.click('#alerts [data-a="dismissError"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#alerts .alert').length), 0);
  await done(ctx);
});

test('P3-03 a lost duel shows the gold and the experience actually lost', async () => {
  const hero = makeHero({ level: 35, zone: 'duskhollow', x: 2, y: 2, gold: 4321 });
  hero.xp = 300;
  const champion = { ...MUSA, level: 40, stats: { str: 900, dex: 900, int: 900, wis: 900, vit: 900 } };
  const backend = new FakeBackend({ hero, players: [champion], chat: structuredClone(CHAT), quests: [fixedQuest()] });
  const ctx = await env.page({ backend, viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="move"]'); await settle(page);
  const before = await page.evaluate(() => ({ gold: window.clickmonster.char.gold, xp: window.clickmonster.char.xp, level: window.clickmonster.char.level }));
  await tap(page, '[data-a="list"][data-v="players"]');
  await page.waitForSelector('[data-a="attack"]');
  await page.click('[data-a="attack"]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForSelector('.outcome');
  const out = await page.evaluate(() => {
    const c = window.clickmonster.char;
    return {
      over: c.battle.over, pvp: c.battle.pvp, gold: c.gold, xp: c.xp, level: c.level,
      logMentionsXp: c.battle.log.some((l) => /experience/.test(l.text)),
      title: document.querySelector('.outcome .outcome-title')?.textContent,
      chips: [...document.querySelectorAll('.outcome .losses li')].map((l) => l.textContent),
    };
  });
  assert.equal(out.pvp, true);
  assert.equal(out.over, 'defeat');
  assert.equal(out.level, before.level);
  assert.equal(out.logMentionsXp, false, "the duel's log does not mention experience (why the state is used)");
  const goldLost = before.gold - out.gold;
  const xpLost = before.xp - out.xp;
  assert.equal(goldLost, 4321);
  assert.equal(xpLost, Math.min(300, Math.floor(xpToNext(35) * 0.2)));
  assert.ok(xpLost > 0);
  assert.equal(out.title, 'Defeated');
  assert.deepEqual(out.chips, [`Lost ${goldLost.toLocaleString('en-US')} gold`, `Lost ${xpLost} XP`, 'Back in town']);
  assert.deepEqual((await axe(page)).map((v) => v.id), [], 'axe: duel result');
  await done(ctx);
});
