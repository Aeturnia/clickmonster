// Desktop layout, phase D-3 (docs/desktop-scope.md, section 7): keyboard shortcuts on desktop,
// on by default with an off setting; never while typing, composing, with Ctrl, Alt or Meta, or
// with a dialog open; a help list on "?"; and the arrow keys in the chat panel no longer moving
// the hero (a D-2 defect found here).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, focusInfo } from './harness.mjs';
import { maxHp } from '../../public/js/engine/character.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const CHAT = [1, 2, 3].map((i) => ({ id: i, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: `Message ${i}`, deleted_at: null, created_at: ago(10 - i) }));

async function open(w, h, { touch = false, hero, prefs, x, y } = {}) {
  const backend = new FakeBackend({ hero: hero || makeHero({ x, y }), chat: structuredClone(CHAT) });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: touch });
  if (prefs) await ctx.page.addInitScript((p) => { localStorage.setItem('clickmonster.prefs', p); }, JSON.stringify(prefs));
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"]', { timeout: 15000 });
  await settle(ctx.page);
  await ctx.page.evaluate(() => document.activeElement?.blur());
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const screen = (page) => page.getAttribute('#nav [aria-current="page"]', 'data-v');
const sent = (backend, action) => backend.calls.filter((c) => c.action === action).length;
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
async function press(page, key) { await page.waitForTimeout(270); await page.keyboard.press(key); await settle(page); }
// A hero who hits softly and lasts, so a fight lasts several turns.
// One step out of town, where monsters roam (gameplay polish F2).
function enduringHero() { const c = makeHero({ y: 4 }); c.stats.str = 1; c.stats.vit = 400; c.hp = maxHp(c); return c; }

// ---------------------------------------------------------------- the shortcuts

test('D-3 number keys switch screens, and the tabs announce their keys', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  const seen = [];
  for (const k of ['2', '3', '4', '1']) { await press(page, k); seen.push(await screen(page)); }
  assert.deepEqual(seen, ['hero', 'gear', 'map', 'explore']);
  const keys = await page.evaluate(() => [...document.querySelectorAll('#nav [data-a="tab"]')].map((b) => b.getAttribute('aria-keyshortcuts')));
  assert.deepEqual(keys, ['1', '2', '3', '4']);
  await done(ctx);
});

test('D-3 battle keys: M, C and F press Melee, Cast and Flee', async () => {
  const ctx = await open(1440, 900, { hero: enduringHero() });
  const { page, backend } = ctx;
  const strongest = await page.$eval('#mon-select', (s) => s.options[s.options.length - 1].value);
  await page.selectOption('#mon-select', strongest);
  await page.click('#main [data-a="fight"]');
  await settle(page);
  await page.evaluate(() => document.activeElement?.blur());
  const marks = await page.evaluate(() => ['melee', 'cast', 'flee'].map((a) => document.querySelector(`#dock [data-a="${a}"]`).getAttribute('aria-keyshortcuts')));
  assert.deepEqual(marks, ['M', 'C', 'F'], 'the battle buttons announce their keys');
  await noAxe(page, 'battle with shortcut keys');
  await press(page, 'm');
  await press(page, 'c');
  assert.deepEqual([sent(backend, 'melee'), sent(backend, 'cast')], [1, 1]);
  await press(page, 'f');
  assert.equal(sent(backend, 'flee'), 1);
  assert.equal(await page.isVisible('#dock [data-a="melee"]'), false, 'the fight is over');
  await done(ctx);
});

test('D-3 Enter fights again, but a focused button keeps its own Enter', async () => {
  const ctx = await open(1440, 900, { y: 4 });
  const { page, backend } = ctx;
  await page.click('#main [data-a="fight"]'); // the Garden Snake: two hits
  await settle(page);
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 6 && await page.isVisible('#dock [data-a="melee"]'); i++) await press(page, 'm');
  await page.waitForSelector('#dock [data-a="again"]');
  assert.equal(await page.getAttribute('#dock [data-a="again"]', 'aria-keyshortcuts'), 'Enter');
  await page.evaluate(() => document.activeElement?.blur());
  await press(page, 'Enter');
  assert.equal(sent(backend, 'again'), 1, 'Enter with nothing selected fights again');
  for (let i = 0; i < 6 && await page.isVisible('#dock [data-a="melee"]'); i++) await press(page, 'm');
  await page.waitForSelector('#dock [data-a="done"]');
  await page.focus('#dock [data-a="done"]');
  await press(page, 'Enter');
  assert.equal(sent(backend, 'again'), 1, 'Enter on Continue does not fight again');
  assert.equal(sent(backend, 'done'), 1, 'it presses Continue');
  await done(ctx);
});

test('D-3 "/" goes to the chat box and Escape comes back, in the panel and in the drawer', async () => {
  for (const [w, mode] of [[1440, 'panel'], [1240, 'drawer']]) {
    const ctx = await open(w, 900, { y: 4 });
    const { page } = ctx;
    await page.focus('#main [data-a="fight"]');
    const from = (await focusInfo(page)).v;
    await page.keyboard.press('Slash');
    await page.waitForFunction(() => document.activeElement?.id === 'chat-input');
    const r = await page.evaluate(() => ({ host: document.activeElement.closest('#chatpanel, #chat').id, value: document.activeElement.value, drawer: document.getElementById('chat').open }));
    assert.deepEqual(r, mode === 'panel' ? { host: 'chatpanel', value: '', drawer: false } : { host: 'chat', value: '', drawer: true }, `${w}: the ${mode} message box, empty`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.activeElement?.closest('#chatpanel, #chat'));
    assert.deepEqual([(await focusInfo(page)).a, (await focusInfo(page)).v], ['fight', from], `${w}: Escape returns to the Fight button`);
    await done(ctx);
  }
});

test('D-3 "?" lists every shortcut; Settings has the switch and the list too', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  await page.keyboard.press('Shift+Slash');
  await page.waitForSelector('#sheet[open] table.keys');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#sheet table.keys tbody tr')].map((tr) => tr.querySelector('kbd').textContent));
  assert.deepEqual(rows, ['1', '2', '3', '4', 'M', 'C', 'F', 'Enter', '/', '?', 'Escape', 'Arrow keys']);
  assert.equal(await page.textContent('#sheet-title'), 'Keyboard shortcuts');
  await noAxe(page, 'keyboard shortcuts list');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('sheet').open);
  await press(page, '2');
  const settings = await page.evaluate(() => [...document.querySelectorAll('#main .settings .row .nm')].map((n) => n.firstChild.textContent.trim()));
  assert.deepEqual(settings, ['Left-handed controls', 'Vibration', 'Keyboard shortcuts', 'Show keyboard shortcuts']);
  await page.click('#main [data-a="keys"]');
  await page.waitForSelector('#sheet[open] table.keys');
  await done(ctx);
});

// ---------------------------------------------------------------- when they must not fire

test('D-3 shortcuts never fire while typing, composing, with Ctrl, Alt or Meta, or with a dialog open', async () => {
  const ctx = await open(1440, 900, { hero: enduringHero() });
  const { page, backend } = ctx;
  await page.click('#main [data-a="fight"]');
  await settle(page);
  // Typing in the chat box: the characters are typed, nothing else happens.
  await page.click('#chatpanel #chat-input');
  await page.keyboard.type('m2/?');
  assert.equal(await page.inputValue('#chatpanel #chat-input'), 'm2/?');
  assert.deepEqual([sent(backend, 'melee'), await screen(page)], [0, 'explore'], 'typing presses nothing');
  await page.fill('#chatpanel #chat-input', '');
  await page.evaluate(() => document.activeElement.blur());
  // Composing with an input method, held keys, and modifiers.
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', isComposing: true, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', keyCode: 229, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', repeat: true, bubbles: true, cancelable: true }));
  });
  for (const k of ['Control+2', 'Alt+2', 'Meta+2', 'Control+m', 'Alt+m', 'Shift+M']) await press(page, k);
  assert.deepEqual([sent(backend, 'melee'), await screen(page)], [0, 'explore'], 'composing, repeats and modifiers press nothing');
  // A dialog open: the level sheet is not up, so open the help list and try a key behind it.
  await page.keyboard.press('Shift+Slash');
  await page.waitForSelector('#sheet[open]');
  await page.keyboard.press('m');
  await page.keyboard.press('2');
  await page.waitForTimeout(300);
  assert.deepEqual([sent(backend, 'melee'), await screen(page)], [0, 'explore'], 'nothing behind an open dialog');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('sheet').open);
  // And with nothing in the way, M works.
  await press(page, 'm');
  assert.equal(sent(backend, 'melee'), 1);
  await done(ctx);
});

test('D-3 the off setting turns the shortcuts off, and is remembered; old saved settings keep them on', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  await press(page, '2');
  await page.click('#main [data-a="pref"][data-v="keys"]');
  await settle(page);
  assert.equal(await page.textContent('#main [data-a="pref"][data-v="keys"] .go'), 'Off');
  await press(page, '4');
  assert.equal(await screen(page), 'hero', 'off: 4 does nothing');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-keyshortcuts]').length), 0, 'off: no keys announced');
  await page.reload();
  await page.waitForSelector('#nav [data-a="tab"]', { timeout: 15000 });
  await settle(page);
  await page.evaluate(() => document.activeElement?.blur());
  await press(page, '4');
  assert.notEqual(await screen(page), 'map', 'still off after a reload');
  // The arrow keys are not shortcuts in this sense and still move the hero.
  await press(page, '1');
  await page.click('#nav [data-a="tab"][data-v="explore"]');
  await settle(page);
  await page.evaluate(() => document.activeElement?.blur());
  await press(page, 'ArrowUp');
  assert.equal(await page.textContent('#main .coords'), '5, 4', 'arrows still move');
  await done(ctx);
  // Settings saved before D-3 have no "keys" entry: shortcuts are on for those players.
  const old = await open(1440, 900, { prefs: { leftHanded: false, vibrate: true } });
  await press(old.page, '3');
  assert.equal(await screen(old.page), 'gear');
  await done(old);
});

test('D-3 phones, tablets and narrow windows: no shortcuts, no setting, no announced keys', async () => {
  for (const [label, w, h, touch] of [['phone 390×844', 390, 844, true], ['tablet 1024×768', 1024, 768, true], ['window 1150×800 (mouse)', 1150, 800, false]]) {
    const ctx = await open(w, h, { touch });
    const { page } = ctx;
    await page.keyboard.press('2');
    await page.keyboard.press('Shift+Slash');
    await page.waitForTimeout(300);
    assert.equal(await screen(page), 'explore', `${label}: 2 does nothing`);
    assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false, `${label}: no list`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-keyshortcuts]').length), 0, `${label}: no keys announced`);
    await page.click('#nav [data-a="tab"][data-v="hero"]');
    await settle(page);
    assert.equal(await page.$('#main [data-a="pref"][data-v="keys"]'), null, `${label}: no setting`);
    await done(ctx);
  }
});

// ---------------------------------------------------------------- found in D-3: a D-2 defect

test('D-3 arrow keys in the chat panel move between messages, not the hero', async () => {
  const ctx = await open(1440, 900);
  const { page, backend } = ctx;
  await page.focus('#chatpanel .chat-line[data-v="3"]');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '1', 'the chat list moved');
  assert.equal(sent(backend, 'move'), 0, 'the hero did not');
  assert.equal(await page.textContent('#main .coords'), '5, 5');
  await done(ctx);
});
