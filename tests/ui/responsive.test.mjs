// Phase 2 responsive acceptance criteria (see docs/ui-phase-2-report.md). Run with: npm run test:ui
// Deterministic fixtures only: the fake backend fails the test on any unexpected request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, bigZone, fakeKeyboard, setKeyboard, PAGE_METRICS, axe } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

async function open(w, h, { hero = {}, zones, keyboard = false, textScale } = {}) {
  const backend = new FakeBackend({ hero: makeHero(hero), zones });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  if (keyboard) await fakeKeyboard(ctx.page);
  if (textScale) await ctx.page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s; }), textScale);
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"]', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  await ctx.context.close();
}
async function step(page, sel) { await page.waitForTimeout(270); await page.click(sel); await settle(page); }
const battleMetrics = (page) => page.evaluate(() => {
  const log = document.getElementById('log').getBoundingClientRect();
  const main = document.getElementById('main').getBoundingClientRect();
  const inView = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return !!b && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; };
  return { logRoom: Math.round(Math.min(main.bottom, innerHeight) - log.top), melee: inView('[data-a="melee"]'), cast: inView('[data-a="cast"]') };
});
function sound(m, label) {
  assert.equal(m.hOverflow, false, `${label}: no horizontal scrolling`);
  assert.equal(m.hudClipped, false, `${label}: HUD text not clipped`);
  assert.equal(m.dockOverlaps, 0, `${label}: dock buttons do not overlap`);
  assert.equal(m.dockOffscreen, 0, `${label}: dock buttons on screen`);
  assert.ok(m.dockMinTarget >= 44, `${label}: dock targets at least 44px (got ${m.dockMinTarget})`);
}

test('AC-1 320x640: compact HUD and dock leave room for the monster list', async () => {
  const ctx = await open(320, 640);
  const { page } = ctx;
  const town = await page.evaluate(PAGE_METRICS);
  sound(town, 'town');
  assert.ok(town.mainH >= 300, `town content ${town.mainH}px (before: 224)`);
  assert.ok(town.visibleRows >= 1, `town shows ${town.visibleRows} monster rows (before: 0)`);
  assert.ok(town.hudH <= 72, `HUD is ${town.hudH}px (before: 95)`);
  await step(page, '[data-a="move"][data-v="n"]');
  const openGround = await page.evaluate(PAGE_METRICS);
  sound(openGround, 'open ground');
  assert.ok(openGround.mainH >= 351, `open ground content ${openGround.mainH}px (before: 276)`);
  assert.ok(openGround.visibleRows >= 2, `open ground shows ${openGround.visibleRows} rows (before: 0)`);
  await done(ctx);
});

test('AC-1: shortened amounts still read out in full', async () => {
  const ctx = await open(320, 640, { hero: { gold: 123456789, bank: 98765432 } });
  const { page } = ctx;
  const hud = await page.evaluate(() => {
    const res = document.querySelector('#top .hud-res');
    const shown = [...res.querySelectorAll('b[aria-hidden="true"]')].map((b) => b.textContent);
    return { shown, full: res.querySelector('.sr-only').textContent, title: res.querySelector('b').title };
  });
  assert.equal(hud.shown[0], '123M');
  assert.equal(hud.full, '123,456,789');
  assert.equal(hud.title, '123,456,789 gold');
  const bank = await page.textContent('[data-a="bank"]');
  assert.match(bank, /98\.8M/);
  assert.match(bank, /98,765,432 gold saved/); // screen-reader text inside the button
  const name = await page.textContent('#top .hud-name');
  assert.match(name, /level 12 Halfling/, 'level and race stay in the accessible name');
  await done(ctx);
});

test('AC-2 375 to 430 wide: more content height than before, no fewer rows', async () => {
  const before = { 375: [506, 4], 390: [538, 5], 430: [626, 6] };
  for (const [w, h] of [[375, 812], [390, 844], [430, 932]]) {
    const ctx = await open(w, h);
    await step(ctx.page, '[data-a="move"][data-v="n"]');
    const m = await ctx.page.evaluate(PAGE_METRICS);
    sound(m, `${w}px`);
    assert.ok(m.mainH >= before[w][0] + 30, `${w}px: content ${m.mainH}px (before: ${before[w][0]})`);
    assert.ok(m.visibleRows >= before[w][1], `${w}px: ${m.visibleRows} rows (before: ${before[w][1]})`);
    await done(ctx);
  }
});

test('AC-3 phone landscape 844x390: exploring and fighting fit', async () => {
  const ctx = await open(844, 390);
  const { page } = ctx;
  await step(page, '[data-a="move"][data-v="n"]');
  const m = await page.evaluate(PAGE_METRICS);
  sound(m, 'landscape');
  assert.ok(m.mainH >= 250, `content ${m.mainH}px (before: 106)`);
  assert.ok(m.visibleRows >= 2, `${m.visibleRows} rows (before: 0)`);
  // Side column: the actions sit to the right of the screen, not below it.
  const side = await page.evaluate(() => [document.getElementById('dock').getBoundingClientRect().left, document.getElementById('main').getBoundingClientRect().right]);
  assert.ok(side[0] >= side[1] - 1, 'dock is in the side column');
  await step(page, '#main [data-a="fight"]');
  await step(page, '[data-a="melee"]');
  const b = await battleMetrics(page);
  assert.ok(b.logRoom >= 150, `battle log has ${b.logRoom}px (before: 14)`);
  assert.ok(b.melee && b.cast, 'Melee and Cast on screen');
  await done(ctx);
});

test('AC-4 chat: the message box stays above an overlay keyboard', async () => {
  for (const [w, h] of [[320, 640], [390, 844], [844, 390]]) {
    const ctx = await open(w, h, { keyboard: true });
    const { page } = ctx;
    await page.click('.chatbar'); await page.waitForSelector('#chat[open]'); await page.waitForTimeout(250);
    const measure = () => page.evaluate(() => {
      const i = document.getElementById('chat-input').getBoundingClientRect();
      const l = document.getElementById('chat-list').getBoundingClientRect();
      return { top: i.top, bottom: Math.round(i.bottom), vh: window.visualViewport.height, list: Math.round(l.height) };
    });
    const closed = await measure();
    assert.ok(closed.top >= 0 && closed.bottom <= closed.vh, `${w}x${h}: input on screen`);
    await setKeyboard(page, Math.round(h * 0.45));
    await page.waitForTimeout(250);
    const kb = await measure();
    assert.ok(kb.top >= 0 && kb.bottom <= kb.vh + 1, `${w}x${h}: input bottom ${kb.bottom} above keyboard at ${kb.vh}`);
    assert.ok(kb.list >= 60, `${w}x${h}: ${kb.list}px of messages still visible`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input', 'focus stays in the message box');
    await setKeyboard(page, 0);
    await page.waitForTimeout(250);
    const after = await measure();
    assert.ok(after.bottom >= kb.bottom, 'drawer returns to the bottom when the keyboard closes');
    await done(ctx);
  }
});

test('AC-5 map 40x40: comfortable squares, centred on the hero, one tab stop', async () => {
  for (const [w, h] of [[320, 640], [390, 844], [844, 390], [1440, 900]]) {
    const ctx = await open(w, h, { hero: { zone: 'test-expanse', x: 33, y: 30 }, zones: [bigZone(40)] });
    const { page } = ctx;
    await step(page, '[data-a="tab"][data-v="map"]');
    const m = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.map [data-a="walk"]')];
      const c = cells[0].getBoundingClientRect();
      const me = document.querySelector('.map [aria-current="location"]').getBoundingClientRect();
      const box = document.getElementById('map-scroll').getBoundingClientRect();
      return {
        cells: cells.length, cell: Math.round(Math.min(c.width, c.height)), tabStops: cells.filter((x) => x.tabIndex >= 0).length,
        meVisible: me.top >= box.top && me.bottom <= Math.min(box.bottom, innerHeight) && me.left >= box.left && me.right <= Math.min(box.right, innerWidth),
        hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert.equal(m.cells, 1600);
    assert.ok(m.cell >= 32, `${w}x${h}: squares ${m.cell}px (before: 20)`);
    assert.equal(m.tabStops, 1, `${w}x${h}: one tab stop (before: 1600)`);
    assert.ok(m.meVisible, `${w}x${h}: hero square visible`);
    assert.equal(m.hOverflow, false, `${w}x${h}: page does not scroll sideways`);
    await done(ctx);
  }
});

test('AC-5 map keyboard: arrows move between squares, Enter walks, Center on me returns', async () => {
  const ctx = await open(390, 844, { hero: { zone: 'test-expanse', x: 33, y: 30 }, zones: [bigZone(40)] });
  const { page } = ctx;
  await step(page, '[data-a="tab"][data-v="map"]');
  await page.focus('.map [aria-current="location"]');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '31,29');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.map [tabindex="0"]').length), 1);
  assert.equal(await page.evaluate(() => window.clickmonster.char.loc.x), 33, 'arrows only move the focus, not the hero');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '1,29');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); await settle(page);
  assert.deepEqual(await page.evaluate(() => [window.clickmonster.char.loc.x, window.clickmonster.char.loc.y]), [2, 29]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '2,29', 'focus stays on the square after walking');
  // Pan away; a re-render (HP regeneration ticks) keeps the pan; Center on me brings the hero back.
  await page.evaluate(() => { const b = document.getElementById('map-scroll'); b.scrollLeft = b.scrollWidth; b.scrollTop = b.scrollHeight; });
  await page.evaluate(() => { window.clickmonster.char.hp -= 1; });
  await page.waitForTimeout(1200);
  const kept = await page.evaluate(() => document.getElementById('map-scroll').scrollLeft);
  assert.ok(kept > 500, 'pan position kept across re-renders');
  await page.click('[data-a="mapcenter"]'); await page.waitForTimeout(200);
  const centred = await page.evaluate(() => {
    const me = document.querySelector('.map [aria-current="location"]').getBoundingClientRect();
    const box = document.getElementById('map-scroll').getBoundingClientRect();
    return { visible: me.left >= box.left && me.right <= box.right && me.top >= box.top && me.bottom <= box.bottom, focused: document.activeElement === document.querySelector('.map [aria-current="location"]') };
  });
  assert.ok(centred.visible, 'hero square back in view');
  assert.ok(centred.focused, 'focus on the hero square');
  // Places list walks too, without colliding with the map squares for focus.
  assert.ok(await page.$('.rows [data-a="walkto"]'), 'places list');
  await done(ctx);
});

test('AC-6 tablet and desktop: two columns, long lists and a tall battle log', async () => {
  for (const [w, h] of [[1024, 768], [1440, 900]]) {
    const ctx = await open(w, h);
    const { page } = ctx;
    await step(page, '[data-a="move"][data-v="n"]');
    const m = await page.evaluate(PAGE_METRICS);
    sound(m, `${w}px`);
    assert.ok(m.visibleRows >= 8, `${w}px: ${m.visibleRows} rows (before: ${w === 1024 ? 4 : 6})`);
    await step(page, '#main [data-a="fight"]');
    await step(page, '[data-a="melee"]');
    const b = await battleMetrics(page);
    assert.ok(b.logRoom >= 400, `${w}px: battle log has ${b.logRoom}px`);
    assert.ok(b.melee && b.cast, 'Melee and Cast on screen');
    await done(ctx);
  }
});

test('AC-7 200% text at 390px: nothing overlaps or scrolls sideways, and the list is reachable', async () => {
  const ctx = await open(390, 844, { textScale: '200%' });
  const { page } = ctx;
  const m = await page.evaluate(PAGE_METRICS);
  sound(m, '200% text');
  assert.ok(m.mainH >= 247, `content ${m.mainH}px (before: 138)`);
  const reach = await page.evaluate(() => {
    const row = document.querySelector('#main .row[data-a="fight"]');
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect(); const main = document.getElementById('main').getBoundingClientRect();
    return r.top >= main.top - 1 && r.bottom <= main.bottom + 1;
  });
  assert.ok(reach, 'the first monster scrolls fully into view inside the screen area');
  await done(ctx);
});

test('AC-8 axe: new layouts have no serious or critical violations', async () => {
  for (const [w, h] of [[320, 640], [844, 390], [1440, 900]]) {
    const ctx = await open(w, h, { hero: { zone: 'test-expanse', x: 33, y: 30 }, zones: [bigZone(40)] });
    const { page } = ctx;
    assert.deepEqual((await axe(page)).map((v) => v.id), [], `${w}x${h} explore`);
    await step(page, '[data-a="tab"][data-v="map"]');
    assert.deepEqual((await axe(page)).map((v) => v.id), [], `${w}x${h} map`);
    await done(ctx);
  }
});
