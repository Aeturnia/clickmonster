// Desktop layout, phase D-2 (docs/desktop-scope.md): the persistent, non-modal chat panel from
// 1280px, the drawer from 1200 to 1279px, moving between them, live messages that never move
// focus, chat before the minimap on short screens, and the side summary with real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, focusInfo, ACCOUNTS } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const CHAT = [
  { id: 1, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: ago(5) },
  { id: 2, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Near the town.', deleted_at: null, created_at: ago(3) },
];
const incoming = (id, text, channel = 'global') => ({
  id, channel, zone: channel === 'zone' ? 'bramblebrook' : null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null,
  recipient_id: null, recipient_name: null, text, deleted_at: null, created_at: new Date().toISOString(),
});

async function open(w, h, opts = {}) {
  const backend = new FakeBackend({ hero: opts.hero || makeHero(), chat: structuredClone(CHAT), worldEvents: opts.worldEvents, activeHunts: opts.activeHunts });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: !!opts.touch });
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"]', { timeout: 15000 });
  await settle(ctx.page);
  if (opts.panel !== false) await ctx.page.waitForSelector('#chatpanel #chat-input', { timeout: 10000 });
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
async function step(page, sel) { await page.waitForTimeout(270); await page.click(sel); await settle(page); }
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const chatState = (page) => page.evaluate(() => ({
  mode: document.getElementById('app').dataset.chat,
  drawerOpen: document.getElementById('chat').open,
  panel: !!document.getElementById('chatpanel').getClientRects().length,
  bar: !!document.getElementById('chatbar').getClientRects().length,
}));
const caretOf = (page) => page.evaluate(() => ({ id: document.activeElement.id, in: document.activeElement.closest('#chatpanel, #chat')?.id || null, value: document.activeElement.value, caret: [document.activeElement.selectionStart, document.activeElement.selectionEnd] }));
const inPanel = (page, text) => page.waitForFunction((t) => document.querySelector('#chatpanel #chat-list')?.textContent.includes(t), text);

// ---------------------------------------------------------------- the panel

test('D-2 panel from 1280px: chat beside the game, no chat line and no drawer; the side column is used', async () => {
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const ctx = await open(w, h);
    const { page } = ctx;
    assert.deepEqual(await chatState(page), { mode: 'panel', drawerOpen: false, panel: true, bar: false }, `${w}×${h}`);
    const p = await page.evaluate(() => {
      const panel = document.getElementById('chatpanel');
      const side = document.getElementById('side').getBoundingClientRect();
      const last = Math.max(...[...document.getElementById('side').children].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom));
      return {
        tag: panel.tagName, name: document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent,
        tabs: [...panel.querySelectorAll('.chat-tabs button')].map((b) => b.textContent.trim()),
        log: panel.querySelector('#chat-list').getAttribute('role'), messages: panel.querySelectorAll('.chat-line').length,
        empty: Math.round(Math.min(side.bottom, innerHeight) - last), inert: !!document.querySelector('#main[inert], #app[inert]'),
      };
    });
    assert.deepEqual({ ...p, empty: undefined }, { tag: 'ASIDE', name: 'Chat', tabs: ['Global', 'Zone', 'Whispers'], log: 'log', messages: 2, empty: undefined, inert: false });
    assert.ok(p.empty <= 120, `${w}×${h}: ${p.empty}px of the side column unused (before: 542–816)`);
    if (w === 1280) await noAxe(page, 'chat panel');
    await done(ctx);
  }
});

test('D-2 the game stays usable while chatting, and live messages never move focus or the caret', async () => {
  const ctx = await open(1440, 900);
  const { page, backend } = ctx;
  // Typing in the panel: a message arrives; focus, text and caret stay.
  await page.click('#chatpanel #chat-input');
  await page.keyboard.type('Hello there');
  await page.evaluate(() => document.getElementById('chat-input').setSelectionRange(5, 5));
  backend.broadcast('chat_messages', 'INSERT', incoming(501, 'Live message one'));
  await inPanel(page, 'Live message one');
  assert.deepEqual(await caretOf(page), { id: 'chat-input', in: 'chatpanel', value: 'Hello there', caret: [5, 5] }, 'typing is not interrupted');
  // The game works with chat open: start a fight; the draft stays.
  await step(page, '#main [data-a="fight"]');
  assert.ok(await page.isVisible('[data-a="melee"]'), 'a fight started while chat was open');
  assert.equal(await page.inputValue('#chatpanel #chat-input'), 'Hello there');
  // Focus on a battle action: a message arrives; focus stays on Melee.
  await page.focus('[data-a="melee"]');
  backend.broadcast('chat_messages', 'INSERT', incoming(502, 'Live message two'));
  await inPanel(page, 'Live message two');
  assert.equal((await focusInfo(page)).a, 'melee', 'focus stays on Melee');
  await step(page, '[data-a="melee"]');
  // Focus on a gear row: a message arrives; focus stays.
  await step(page, '[data-a="tab"][data-v="gear"]');
  await page.focus('#main .row');
  const before = await page.evaluate(() => document.activeElement.textContent.trim());
  backend.broadcast('chat_messages', 'INSERT', incoming(503, 'Live message three'));
  await inPanel(page, 'Live message three');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), before, 'focus stays on the gear row');
  // Unread counts: the channel on show counts nothing; another channel does, quietly.
  backend.broadcast('chat_messages', 'INSERT', incoming(504, 'In the zone', 'zone'));
  await page.waitForFunction(() => /1/.test(document.querySelector('#chatpanel .chat-tabs [data-v="zone"]').textContent));
  assert.equal(await page.evaluate(() => document.querySelector('#chatpanel .chat-tabs [data-v="global"] .count')), null, 'Global, on show, has no unread count');
  assert.equal(await page.evaluate(() => document.querySelector('#chatpanel #chat-list').getAttribute('aria-live')), 'off', 'messages are not announced over the game');
  await done(ctx);
});

test('D-2 sending and message menus work in the panel; Escape closes a menu', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  await page.click('#chatpanel #chat-input');
  await page.keyboard.type('On my way');
  await page.keyboard.press('Enter');
  await inPanel(page, 'On my way');
  assert.deepEqual(await caretOf(page), { id: 'chat-input', in: 'chatpanel', value: '', caret: [0, 0] }, 'sent; the box is empty and keeps focus');
  // A message's menu: the same actions as in the drawer (no Remove for a player).
  await page.click('#chatpanel .chat-line[data-v="2"]');
  const actions = await page.evaluate(() => [...document.querySelectorAll('#chatpanel .chat-menu button')].map((b) => b.textContent.trim()));
  assert.deepEqual(actions, ['Whisper', 'Ignore', 'Report']);
  await page.click('#chatpanel .chat-menu [data-c="report"]');
  await page.waitForSelector('#confirm[open]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirm:not([open])', { state: 'attached' });
  assert.deepEqual([(await focusInfo(page)).a, (await focusInfo(page)).v], ['report', '2'], 'Cancel returns focus to Report, as in the drawer');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#chatpanel .chat-menu'), false, 'Escape closes the menu');
  assert.equal((await focusInfo(page)).v, '2', 'focus stays on the message');
  // Whisper from the menu: the panel switches to Whispers with the name filled in.
  await page.click('#chatpanel .chat-line[data-v="2"]');
  await page.click('#chatpanel .chat-menu [data-c="whisper"]');
  assert.equal(await page.inputValue('#chatpanel #chat-to'), 'Musa');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input');
  assert.deepEqual(await chatState(page), { mode: 'panel', drawerOpen: false, panel: true, bar: false }, 'no drawer opens');
  await done(ctx);
});

// ---------------------------------------------------------------- panel and drawer

test('D-2 from 1200 to 1279px: the desktop layout with the chat line and drawer', async () => {
  const ctx = await open(1240, 800, { panel: false });
  const { page } = ctx;
  assert.equal(await page.evaluate(() => document.getElementById('app').dataset.layout), 'desktop');
  assert.deepEqual(await chatState(page), { mode: 'drawer', drawerOpen: false, panel: false, bar: true });
  await page.click('.chatbar');
  await page.waitForSelector('#chat[open] #chat-input');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input', 'the drawer opens with focus in the message box');
  await noAxe(page, 'drawer at 1240');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#chat:not([open])', { state: 'attached' });
  await done(ctx);
});

test('D-2 moving between panel and drawer keeps the draft, channel, unread counts, focus and caret', async () => {
  const ctx = await open(1440, 900);
  const { page, backend } = ctx;
  await page.click('#chatpanel .chat-tabs [data-v="zone"]');
  await page.click('#chatpanel #chat-input');
  await page.keyboard.type('On my way');
  await page.evaluate(() => document.getElementById('chat-input').setSelectionRange(2, 2));
  backend.broadcast('chat_messages', 'INSERT', incoming(601, 'Over here', 'global'));
  await page.waitForFunction(() => document.querySelector('#chatpanel .chat-tabs [data-v="global"] .count')?.textContent === '1');
  // Narrower than 1280 while typing: the drawer opens with everything in place.
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.waitForSelector('#chat[open] #chat-input');
  const d = await page.evaluate(() => ({
    caret: [document.activeElement.selectionStart, document.activeElement.selectionEnd], id: document.activeElement.id, value: document.activeElement.value,
    tab: document.querySelector('#chat .chat-tabs [aria-pressed="true"]').dataset.v, globalUnread: document.querySelector('#chat .chat-tabs [data-v="global"] .count')?.textContent,
  }));
  assert.deepEqual(d, { caret: [2, 2], id: 'chat-input', value: 'On my way', tab: 'zone', globalUnread: '1' });
  // Back to 1280+: the drawer closes and the panel has it all again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('#chatpanel #chat-input');
  assert.deepEqual(await caretOf(page), { id: 'chat-input', in: 'chatpanel', value: 'On my way', caret: [2, 2] });
  assert.equal((await chatState(page)).drawerOpen, false);
  // Not using chat when the window narrows: the drawer stays closed, focus stays put.
  await page.focus('#main [data-a="fight"]');
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.waitForFunction(() => document.getElementById('app').dataset.chat === 'drawer');
  assert.equal((await chatState(page)).drawerOpen, false, 'the drawer does not open by itself');
  assert.equal((await focusInfo(page)).a, 'fight', 'focus stays on the monster row');
  await page.click('.chatbar');
  await page.waitForSelector('#chat[open] #chat-input');
  assert.equal(await page.inputValue('#chat #chat-input'), 'On my way', 'the draft is still there');
  await done(ctx);
});

// ---------------------------------------------------------------- short screens

test('D-2 short laptops: the message box is on screen with room for 6 lines; the minimap gives way', async () => {
  const busy = {
    worldEvents: [{ id: 'ev-1', name: 'Harvest Moon', until: new Date(Date.now() + 2 * 3600000).toISOString(), xp: 2, gold: 1.5 }, { id: 'ev-2', name: 'Elite Week', until: new Date(Date.now() + 26 * 3600000).toISOString(), elite: 2 }],
    activeHunts: [1, 2, 3].map((i) => ({ id: `h${i}`, zone: 'ashford', name: `Boss ${i}`, level: 20, hp: 40000, max_hp: 60000, ends_at: new Date(Date.now() + 5 * 3600000).toISOString() })),
  };
  for (const [w, h, opts, label] of [[1280, 720, {}, '1280×720'], [1366, 768, {}, '1366×768'], [1280, 720, busy, '1280×720 with 2 events and 3 hunts']]) {
    const ctx = await open(w, h, opts);
    const { page } = ctx;
    const m = await page.evaluate(() => {
      const input = document.querySelector('#chatpanel #chat-input').getBoundingClientRect();
      const list = document.querySelector('#chatpanel #chat-list');
      return {
        inView: input.top >= 0 && input.bottom <= innerHeight, lines: Math.floor(list.clientHeight / parseFloat(getComputedStyle(list).lineHeight)),
        grid: !!document.querySelector('#minimap .minimap')?.getClientRects().length,
        pageScroll: document.scrollingElement.scrollHeight > innerHeight + 1,
      };
    });
    assert.ok(m.inView, `${label}: message box on screen`);
    assert.ok(m.lines >= 6, `${label}: room for ${m.lines} lines`);
    assert.deepEqual([m.grid, m.pageScroll], [false, false], `${label}: minimap as text only; nothing to scroll on the page`);
    await page.click('#chatpanel #chat-input');
    await page.keyboard.type('Short screen hello');
    await page.keyboard.press('Enter');
    await inPanel(page, 'Short screen hello');
    if (opts === busy) await noAxe(page, 'busy side column at 1280×720');
    await done(ctx);
  }
});

// ---------------------------------------------------------------- side summary with real data

test('D-2 the side summary shows world events and world-boss hunts, and Explore does not repeat them', async () => {
  const ctx = await open(1440, 900, {
    panel: false, // this covers the D-1 summary; it doesn't need the chat panel
    worldEvents: [{ id: 'ev-1', name: 'Harvest Moon', until: new Date(Date.now() + 2 * 3600000 + 60000).toISOString(), xp: 2, gold: 1.5 }],
    activeHunts: [{ id: 'h1', zone: 'ashford', name: 'The Ashen Colossus', level: 20, hp: 41000, max_hp: 60000, ends_at: new Date(Date.now() + 5 * 3600000 + 60000).toISOString() }],
  });
  const { page } = ctx;
  await page.waitForFunction(() => /Ashen Colossus/.test(document.getElementById('summary').textContent));
  const items = await page.evaluate(() => [...document.querySelectorAll('#summary li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(items.length, 2, items.join(' | '));
  assert.match(items[0], /^Harvest Moon: Experience x2, Gold x1\.5\. 2h \d+m left\.$/);
  assert.match(items[1], /^World boss: The Ashen Colossus in Ashford Vale, 68% health\. 5h \d+m left\.$/);
  assert.equal(await page.isVisible('#main .notice.event'), false, 'Explore does not repeat the event on desktop');
  await noAxe(page, 'summary with events and hunts');
  await done(ctx);
  // On a phone the event still shows on Explore, as before.
  const phone = await open(390, 844, { touch: true, panel: false, worldEvents: [{ id: 'ev-1', name: 'Harvest Moon', until: new Date(Date.now() + 2 * 3600000).toISOString(), xp: 2 }] });
  await phone.page.waitForSelector('#main .notice.event');
  assert.match(await phone.page.textContent('#main .notice.event'), /Harvest Moon: Experience x2\./);
  await done(phone);
});

// ---------------------------------------------------------------- moderation

test('D-2 moderators remove messages from the panel, with the same confirmation', async () => {
  const backend = new FakeBackend({ hero: makeHero(), chat: structuredClone(CHAT) });
  backend.heroes[ACCOUNTS.mod.id] = makeHero({ name: 'Moderator Mia' });
  backend.charIds[ACCOUNTS.mod.id] = 'char-mod';
  const ctx = await env.page({ backend, viewport: { width: 1440, height: 900 }, mobile: false });
  const { page } = ctx;
  await signIn(page, env.url, 'mod');
  await page.waitForSelector('#chatpanel #chat-input', { timeout: 15000 });
  await settle(page);
  await page.click('#chatpanel .chat-line[data-v="2"]');
  const actions = await page.evaluate(() => [...document.querySelectorAll('#chatpanel .chat-menu button')].map((b) => b.textContent.trim()));
  assert.deepEqual(actions, ['Whisper', 'Ignore', 'Report', 'Remove'], 'staff also get Remove');
  const removes = () => backend.calls.filter((c) => c.action === 'modDelete').length;
  await page.click('#chatpanel .chat-menu [data-c="delete"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.textContent('#confirm-title'), 'Remove this message for everyone?');
  await page.click('#confirm [data-r="cancel"]');
  assert.equal(removes(), 0, 'Cancel sends nothing');
  await page.click('#chatpanel .chat-menu [data-c="delete"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForFunction(() => /Removed/.test(document.getElementById('toast').textContent));
  assert.equal(removes(), 1, 'confirming sends one removal');
  await done(ctx);
});
