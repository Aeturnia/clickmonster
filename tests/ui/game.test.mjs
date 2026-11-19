// Game UI regression tests. Run with: npm run test:ui
// They use the fake backend in harness.mjs; any request to the live Supabase project,
// or any other unexpected host, fails the test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, focusInfo } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const OTHERS = [{ id: 'char-other', name: 'Musa', race: 'human', level: 9, zone: 'bramblebrook', x: 5, y: 4, updated_at: new Date().toISOString() }];
const CHAT = [
  { id: 1, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Hello from the meadows', deleted_at: null, created_at: new Date(Date.now() - 120000).toISOString() },
  { id: 2, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: new Date(Date.now() - 60000).toISOString() },
];

async function game(opts = {}) {
  const backend = opts.backend || new FakeBackend({ hero: makeHero(opts.hero), players: OTHERS, chat: structuredClone(CHAT) });
  const ctx = await env.page({ backend, viewport: opts.viewport, mobile: opts.mobile ?? true, reducedMotion: opts.reducedMotion });
  if (opts.textScale) {
    await ctx.page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s; }), opts.textScale);
  }
  await signIn(ctx.page, env.url, opts.who || 'player');
  if (opts.who !== 'fresh') {
    await ctx.page.waitForSelector('.pad, #log', { timeout: 15000 });
    await settle(ctx.page);
  }
  return ctx;
}

function noLiveAccess(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
}

const outside = (f) => f.tag !== 'BODY' && !f.inDialog;

test('axe: no serious or critical violations on the main screens', async () => {
  const ctx = await game();
  const { page } = ctx;
  const check = async (label) => {
    const v = await axe(page, { minImpact: 'serious' });
    assert.deepEqual(v, [], `${label}: ${JSON.stringify(v, null, 1)}`);
  };
  await check('explore (town)');
  await page.click('[data-a="shop"]'); await settle(page); await check('shop dialog');
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-a="bank"]'); await settle(page); await check('bank dialog');
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-a="move"][data-v="n"]'); await settle(page); await check('explore (open ground)');
  await page.click('[data-a="fight"]'); await settle(page); await page.click('[data-a="melee"]'); await settle(page); await check('battle');
  for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await page.click('[data-a="melee"]'); await settle(page); }
  await check('battle result');
  await page.click('[data-a="done"]'); await settle(page);
  for (const tab of ['hero', 'gear', 'map']) { await page.click(`[data-a="tab"][data-v="${tab}"]`); await settle(page); await check(tab); }
  await page.click('[data-a="tab"][data-v="explore"]'); await settle(page);
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]'); await check('chat dialog');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('focus is always visible: a 2px solid ring on keyboard focus', async () => {
  const ctx = await game();
  await ctx.page.keyboard.press('Tab');
  const f = await focusInfo(ctx.page);
  assert.notEqual(f.tag, 'BODY');
  assert.equal(f.outlineStyle, 'solid');
  assert.ok(f.outlineWidth >= 2, `outline ${f.outlineWidth}px`);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('sheet dialog: initial focus, containment, Escape, restoration', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.focus('[data-a="shop"]');
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), true);
  const first = await focusInfo(page);
  assert.equal(first.inDialog, 'sheet', 'focus moves into the dialog');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    assert.equal(outside(await focusInfo(page)), false, 'Tab never reaches the page behind the dialog');
  }
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false);
  const back = await focusInfo(page);
  assert.equal(back.a, 'shop', 'focus returns to the Shop button');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('sheet dialog: backdrop tap closes and restores focus', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.focus('[data-a="bank"]');
  await page.keyboard.press('Enter'); await settle(page);
  await page.mouse.click(195, 20); // above the sheet panel = the backdrop
  await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false);
  assert.equal((await focusInfo(page)).a, 'bank');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('sheet dialog: when the trigger no longer exists, focus lands somewhere sensible', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('[data-a="tab"][data-v="gear"]'); await settle(page);
  const helmUid = await page.evaluate(() => window.clickmonster.char.inventory.find((i) => i.base === 'helm_1').uid);
  await page.focus(`[data-a="item"][data-v="${helmUid}"]`);
  await page.keyboard.press('Enter'); await settle(page);
  await page.click('[data-a="sell"]'); await settle(page); // selling removes the item row that opened the sheet
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false);
  const f = await focusInfo(page);
  assert.notEqual(f.tag, 'BODY', 'focus is not dropped to the page body');
  assert.equal(await page.$(`[data-a="item"][data-v="${helmUid}"]`), null, 'the trigger is gone');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('battle: focus survives re-renders and the log is reachable and announced', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('[data-a="move"][data-v="n"]'); await settle(page);
  await page.focus('[data-a="fight"]');
  await page.keyboard.press('Enter'); await settle(page);
  assert.equal((await focusInfo(page)).a, 'melee', 'starting a fight moves focus to Melee, not the page body');
  await page.waitForTimeout(300); // the game ignores a second battle tap within 250 ms (double-tap guard)
  await page.keyboard.press('Enter'); await settle(page);
  assert.equal((await focusInfo(page)).a, 'melee', 'focus stays on Melee after attacking');
  await page.waitForFunction(() => document.getElementById('sr-status').textContent.length > 0);
  const log = await page.evaluate(() => { const l = document.getElementById('log'); return { tab: l.tabIndex, role: l.getAttribute('role'), label: l.getAttribute('aria-label') }; });
  assert.deepEqual(log, { tab: 0, role: 'log', label: 'Battle log' });
  for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await page.waitForTimeout(260); await page.keyboard.press('Enter'); await settle(page); }
  const f = await focusInfo(page);
  assert.ok(['again', 'done'].includes(f.a), `after the fight focus is on a result action, got ${JSON.stringify(f)}`);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('battle log keeps recent and older lines distinct without failing contrast', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('[data-a="move"][data-v="n"]'); await settle(page);
  // A foe that lasts, so there are earlier rounds; they are collapsed (gameplay polish C), so open them.
  await page.selectOption('#mon-select', await page.evaluate(() => Object.values(window.clickmonster.MONSTERS).find((m) => m.name === 'Wisp Swarm').id));
  await page.click('[data-a="fight"]'); await settle(page);
  for (let i = 0; i < 3 && await page.$('[data-a="melee"]'); i++) { await page.waitForTimeout(270); await page.click('[data-a="melee"]'); await settle(page); }
  await page.click('#log-earlier');
  const styles = await page.evaluate(() => {
    const get = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { color: cs.color, weight: cs.fontWeight, border: cs.borderLeftColor }; };
    return { older: get('.log p.older'), latest: get('.log p.latest') };
  });
  assert.ok(styles.older && styles.latest);
  assert.notEqual(styles.older.weight, styles.latest.weight, 'latest line is heavier');
  const v = await axe(page, { minImpact: 'serious' });
  assert.deepEqual(v.filter((x) => x.id === 'color-contrast'), []);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('chat dialog: keyboard opening, message menu, Escape order, restoration', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.focus('.chatbar');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#chat[open]');
  assert.equal((await focusInfo(page)).id, 'chat-input', 'focus starts in the message box');
  // Reach the message list with Shift+Tab: it is one tab stop.
  let f;
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); f = await focusInfo(page); if (f.a === 'menu') break; }
  assert.equal(f.a, 'menu', 'a message is reachable by keyboard');
  const lastId = f.v;
  await page.keyboard.press('ArrowUp');
  const prev = await focusInfo(page);
  assert.equal(prev.a, 'menu');
  assert.notEqual(prev.v, lastId, 'arrow keys move between messages');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute(`.chat-line[data-v="${prev.v}"]`, 'aria-expanded'), 'true');
  await page.keyboard.press('Tab');
  assert.equal((await focusInfo(page)).a, 'whisper', 'menu actions are reachable');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('chat').open), true, 'first Escape only closes the menu');
  assert.equal((await focusInfo(page)).v, prev.v, 'focus returns to the message');
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById('chat').open), false);
  assert.equal((await focusInfo(page)).a, 'toggle', 'focus returns to the chat bar');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('chat: send errors stay visible inline until a message goes through', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');
  await page.fill('#chat-input', 'free gold at http://scam.example');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#chat-error');
  assert.equal(await page.getAttribute('#chat-error', 'role'), 'alert');
  assert.equal(await page.getAttribute('#chat-input', 'aria-invalid'), 'true');
  await page.waitForTimeout(3200);
  assert.ok(await page.$('#chat-error'), 'still visible after 3 seconds');
  await page.fill('#chat-input', 'Hello everyone');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('chat-error'));
  await page.waitForSelector('.chat-line:has-text("Hello everyone")');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('keyboard movement: arrows move the hero, but not while typing', async () => {
  const ctx = await game();
  const { page } = ctx;
  const y0 = await page.evaluate(() => window.clickmonster.char.loc.y);
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');
  await page.keyboard.type('hi');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.clickmonster.char.loc.y), y0, 'typing does not move the hero');
  assert.equal(await page.inputValue('#chat-input'), 'hi');
  await page.keyboard.press('Escape'); await settle(page);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowUp'); await settle(page);
  assert.equal(await page.evaluate(() => window.clickmonster.char.loc.y), y0 - 1);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('errors persist until dismissed, and connection errors clear when it recovers', async () => {
  const ctx = await game({ hero: { y: 4 } }); // out of town, where monsters roam (gameplay polish F2)
  const { page, backend } = ctx;
  backend.failNext('fight', 400, 'The beast slips away into the brambles.');
  await page.click('[data-a="fight"]'); await settle(page);
  await page.waitForSelector('#alerts .alert');
  assert.match(await page.textContent('#alerts'), /slips away/);
  await page.waitForTimeout(3500);
  assert.match(await page.textContent('#alerts'), /slips away/, 'still visible after 3.5 seconds');
  // A second, different error does not replace the first.
  backend.offline = true;
  await page.click('[data-a="move"][data-v="e"]'); await settle(page);
  assert.equal(await page.locator('#alerts .alert').count(), 2);
  assert.match(await page.textContent('#alerts'), /reach the game server/);
  // The connection recovers: the connection error clears, the unrelated one stays until dismissed.
  backend.offline = false;
  await page.click('[data-a="move"][data-v="e"]'); await settle(page);
  assert.equal(await page.locator('#alerts .alert').count(), 1);
  assert.match(await page.textContent('#alerts'), /slips away/);
  await page.click('#alerts [data-a="dismissError"]'); await settle(page);
  assert.equal(await page.locator('#alerts .alert').count(), 0);
  assert.notEqual((await focusInfo(page)).tag, 'BODY');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('inline validation: hero name problems show next to the field', async () => {
  const backend = new FakeBackend({ hero: makeHero() });
  delete backend.heroes['00000000-0000-4000-8000-000000000003'];
  const ctx = await game({ backend, who: 'fresh' });
  const { page } = ctx;
  await page.waitForSelector('#name');
  await page.fill('#name', 'x');
  await page.click('[data-a="create"]');
  await page.waitForSelector('#name-error');
  assert.equal(await page.getAttribute('#name', 'aria-invalid'), 'true');
  assert.equal(await page.getAttribute('#name', 'aria-describedby'), 'name-error');
  assert.equal((await focusInfo(page)).id, 'name');
  assert.equal(backend.calls.filter((c) => c.action === 'create').length, 0, 'nothing sent to the server');
  await page.fill('#name', 'Valid Name');
  await page.click('[data-a="create"]');
  await page.waitForSelector('.pad', { timeout: 15000 });
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('enlarged text: sizes scale and controls do not overlap', async () => {
  const ctx = await game({ textScale: '200%', viewport: { width: 390, height: 844 } });
  const { page } = ctx;
  const m = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#dock button')].map((b) => b.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
    }
    return { size: getComputedStyle(document.querySelector('.hud-name')).fontSize, overflow: document.documentElement.scrollWidth > innerWidth, overlaps };
  });
  assert.equal(m.size, '32px', 'text doubled');
  assert.equal(m.overflow, false, 'no horizontal scrolling');
  assert.equal(m.overlaps, 0, 'no overlapping controls in the dock');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('responsive: no horizontal overflow from 320px to 1440px', async () => {
  for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1440, 900]]) {
    const ctx = await game({ viewport: { width: w, height: h }, mobile: w < 800 });
    const { page } = ctx;
    const over = async () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(await over(), false, `${w}px explore`);
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
    await page.click('[data-a="fight"]'); await settle(page);
    assert.equal(await over(), false, `${w}px battle`);
    noLiveAccess(ctx);
    await ctx.context.close();
  }
});

test('map squares describe what is there and can be used to walk', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('[data-a="tab"][data-v="map"]'); await settle(page);
  const here = await page.getAttribute('.map [aria-current="location"]', 'aria-label');
  assert.match(here, /You are here/);
  assert.match(here, /Town/);
  const lair = await page.getAttribute('.map button.lair', 'aria-label');
  assert.match(lair, /Boss lair/);
  await page.focus('.map [data-v="1,1"]');
  await page.keyboard.press('Enter'); await settle(page);
  assert.deepEqual(await page.evaluate(() => [window.clickmonster.char.loc.x, window.clickmonster.char.loc.y]), [1, 1]);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('reduced motion is respected', async () => {
  const ctx = await game({ reducedMotion: 'reduce' });
  const d = await ctx.page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'shake';
    document.body.appendChild(el);
    return parseFloat(getComputedStyle(el).animationDuration);
  });
  assert.ok(d <= 0.01, `shake lasts ${d}s`);
  noLiveAccess(ctx);
  await ctx.context.close();
});

// ---------------------------------------------------------------- review corrections (PR #10)

test('success message stays visible when the action closes its sheet', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('[data-a="shop"]'); await settle(page);
  await page.click('[data-a="shopslot"][data-v="helm"]'); await settle(page);
  await page.click('[data-a="buyequip"]'); // a successful transaction that closes the sheet
  await page.waitForFunction(() => !document.getElementById('sheet').open);
  await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'));
  const t = await page.evaluate(() => {
    const el = document.getElementById('toast');
    const r = el.getBoundingClientRect();
    return { text: el.textContent, inClosedDialog: !!el.closest('dialog:not([open])'), parent: el.parentElement.tagName, visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' };
  });
  assert.match(t.text, /Bought and equipped/);
  assert.equal(t.inClosedDialog, false, 'not left inside the closed dialog');
  assert.equal(t.parent, 'BODY');
  assert.equal(t.visible, true);
  assert.equal(await page.locator('#toast').isVisible(), true);
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('success message shown in chat stays visible after chat closes', async () => {
  const ctx = await game();
  const { page } = ctx;
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');
  await page.click('.chat-line[data-v="2"]');
  await page.click('.chat-menu [data-c="ignore"]');
  await page.click('#confirm [data-r="ok"]'); // the styled confirmation (Phase 3)
  await page.waitForFunction(() => /Ignoring/.test(document.getElementById('toast')?.textContent || ''));
  await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => document.getElementById('chat').open), false);
  assert.equal(await page.evaluate(() => document.getElementById('toast').parentElement.tagName), 'BODY');
  noLiveAccess(ctx);
  await ctx.context.close();
});

const incoming = (id, text, channel = 'global') => ({
  id, channel, zone: channel === 'zone' ? 'bramblebrook' : null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null,
  recipient_id: null, recipient_name: null, text, deleted_at: null, created_at: new Date().toISOString(),
});

test('realtime: a new message keeps focus on the chat bar', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await page.focus('.chatbar');
  backend.broadcast('chat_messages', 'INSERT', incoming(501, 'Live message one'));
  await page.waitForFunction(() => /Live message one/.test(document.querySelector('.chatbar')?.textContent || ''));
  assert.match(await page.getAttribute('.chatbar', 'aria-label'), /1 unread/);
  assert.equal((await focusInfo(page)).a, 'toggle', 'focus is still on the chat bar');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('realtime: focus survives on a channel tab, a message and a menu action', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await page.click('.chatbar'); await page.waitForSelector('#chat[open]');

  // A channel tab (not the current one) whose unread count changes.
  await page.focus('.chat-tabs [data-v="zone"]');
  backend.broadcast('chat_messages', 'INSERT', incoming(601, 'Zone news', 'zone'));
  await page.waitForFunction(() => !!document.querySelector('.chat-tabs [data-v="zone"] .count'));
  let f = await focusInfo(page);
  assert.deepEqual([f.a, f.v], ['tab', 'zone'], 'focus stays on the Zone tab');

  // A message line while new messages arrive in the open channel.
  await page.focus('.chat-line[data-v="1"]');
  backend.broadcast('chat_messages', 'INSERT', incoming(602, 'Another global line'));
  await page.waitForSelector('.chat-line:has-text("Another global line")');
  f = await focusInfo(page);
  assert.deepEqual([f.a, f.v], ['menu', '1'], 'focus stays on the same message');

  // A message-action button inside an open menu.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal((await focusInfo(page)).a, 'whisper');
  backend.broadcast('chat_messages', 'INSERT', incoming(603, 'Yet another line'));
  await page.waitForSelector('.chat-line:has-text("Yet another line")');
  f = await focusInfo(page);
  assert.equal(f.a, 'whisper', 'focus stays on the Whisper action');
  assert.equal(await page.getAttribute('.chat-line[data-v="1"]', 'tabindex'), '0', 'the roving tab stop follows the focused message');

  // Typing in the message box while messages arrive.
  await page.focus('#chat-input');
  await page.keyboard.type('half a sentence');
  backend.broadcast('chat_messages', 'INSERT', incoming(604, 'Interrupting line'));
  await page.waitForSelector('.chat-line:has-text("Interrupting line")');
  assert.equal((await focusInfo(page)).id, 'chat-input');
  await page.keyboard.type(' continues');
  assert.equal(await page.inputValue('#chat-input'), 'half a sentence continues');
  noLiveAccess(ctx);
  await ctx.context.close();
});
