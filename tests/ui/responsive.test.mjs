// Phase 2 responsive acceptance criteria (see docs/ui-phase-2-report.md). Run with: npm run test:ui
// Deterministic fixtures only: the fake backend fails the test on any unexpected request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, bigZone, fakeKeyboard, setKeyboard, PAGE_METRICS, axe } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

async function open(w, h, { hero = {}, zones, keyboard = false, textScale, touch } = {}) {
  const backend = new FakeBackend({ hero: makeHero(hero), zones });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: touch ?? w < 900 });
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
  // Desktop layout (D-1): the screen is only as tall as its content, so the actions can sit
  // under the fight; the log's room is how far it can grow before it scrolls, with the actions
  // still on screen (owner decision, docs/desktop-scope.md).
  const m = document.getElementById('main');
  const logEl = document.getElementById('log');
  const after = [...m.children].filter((e) => e !== logEl && e.getBoundingClientRect().top >= log.bottom - 1).reduce((a, e) => a + e.getBoundingClientRect().height, 0);
  const growRoom = innerHeight - document.getElementById('dock').getBoundingClientRect().height - parseFloat(getComputedStyle(m).paddingBottom) - after - log.top;
  return {
    layout: document.getElementById('app').dataset.layout, logRoom: Math.round(Math.min(main.bottom, innerHeight) - log.top), logGrowRoom: Math.round(growRoom),
    melee: inView('[data-a="melee"]'), cast: inView('[data-a="cast"]'),
  };
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
  // Gameplay polish F2: no roaming monsters in town, so the town says so instead of listing them.
  assert.ok(town.calmVisible, 'town shows the town message');
  assert.ok(town.hudH <= 72, `HUD is ${town.hudH}px (before: 95)`);
  await step(page, '[data-a="move"][data-v="n"]');
  const openGround = await page.evaluate(PAGE_METRICS);
  sound(openGround, 'open ground');
  assert.ok(openGround.mainH >= 351, `open ground content ${openGround.mainH}px (before: 276)`);
  // Gameplay polish F1: the monster list is one drop-down and a Fight button, fully in view.
  assert.ok(openGround.pickVisible, 'open ground shows the monster drop-down and Fight');
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
    assert.ok(m.pickVisible, `${w}px: the monster drop-down and Fight are in view (gameplay polish F1; before: ${before[w][1]} rows)`);
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
  assert.ok(m.pickVisible, 'the monster drop-down and Fight are in view (gameplay polish F1)');
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
        meVisible: me.top >= box.top && me.bottom <= Math.min(box.bottom, document.getElementById('main').getBoundingClientRect().bottom) && me.left >= box.left && me.right <= Math.min(box.right, innerWidth),
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
  // 1440×900 with a mouse gets the desktop layout (D-1); with touch it keeps the two columns.
  for (const [w, h, touch] of [[1024, 768, false], [1440, 900, false], [1440, 900, true]]) {
    const ctx = await open(w, h, { touch });
    const { page } = ctx;
    await step(page, '[data-a="move"][data-v="n"]');
    const m = await page.evaluate(PAGE_METRICS);
    sound(m, `${w}px`);
    assert.ok(m.pickVisible, `${w}px: the monster drop-down and Fight are in view (gameplay polish F1)`);
    await step(page, '#main [data-a="fight"]');
    await step(page, '[data-a="melee"]');
    const b = await battleMetrics(page);
    if (b.layout === 'desktop') assert.ok(b.logGrowRoom >= 400, `${w}px desktop: the battle log can grow to ${b.logGrowRoom}px before it scrolls`);
    else assert.ok(b.logRoom >= 400, `${w}px${touch ? ' touch' : ''}: battle log has ${b.logRoom}px`);
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
  await step(page, '[data-a="move"][data-v="n"]'); // gameplay polish F2: the monsters are outside the town
  const reach = await page.evaluate(() => {
    const row = document.getElementById('mon-pick');
    row.scrollIntoView({ block: 'nearest' });
    const r = row.getBoundingClientRect(); const main = document.getElementById('main').getBoundingClientRect();
    return r.top >= main.top - 1 && r.bottom <= main.bottom + 1;
  });
  assert.ok(reach, 'the monster drop-down scrolls fully into view inside the screen area');
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

// ---------------------------------------------------------------- review corrections (PR #11)

test('P2-01 maps of every size scroll inside their own frame at 320px, never the screen', async () => {
  for (const size of [7, 10, 12, 40]) {
    // The hero stands in a corner, far from where the map starts scrolled.
    const ctx = await open(320, 640, { hero: { zone: 'test-expanse', x: size, y: size }, zones: [bigZone(size)] });
    const { page } = ctx;
    await step(page, '[data-a="tab"][data-v="map"]');
    const m = await page.evaluate(() => {
      const main = document.getElementById('main');
      const box = document.getElementById('map-scroll');
      const b = box.getBoundingClientRect();
      const cells = [...document.querySelectorAll('.map [data-a="walk"]')];
      const c = cells[0].getBoundingClientRect();
      const me = document.querySelector('.map [aria-current="location"]').getBoundingClientRect();
      return {
        mainSideways: main.scrollWidth > main.clientWidth + 1,
        pageSideways: document.documentElement.scrollWidth > innerWidth + 1,
        boxInside: b.left >= main.getBoundingClientRect().left - 1 && b.right <= main.getBoundingClientRect().right + 1,
        boxScrolls: box.scrollWidth > box.clientWidth + 1,
        cell: Math.round(Math.min(c.width, c.height)),
        meVisible: me.left >= b.left - 1 && me.right <= b.right + 1 && me.top >= b.top - 1 && me.bottom <= b.bottom + 1
          && me.top >= main.getBoundingClientRect().top - 1 && me.bottom <= main.getBoundingClientRect().bottom + 1,
        tabStops: cells.filter((x) => x.tabIndex >= 0).length,
      };
    });
    assert.equal(m.mainSideways, false, `${size}x${size}: the screen area does not scroll sideways`);
    assert.equal(m.pageSideways, false, `${size}x${size}: the page does not scroll sideways`);
    assert.ok(m.boxInside, `${size}x${size}: the map frame fits the screen area`);
    if (size >= 10) assert.ok(m.boxScrolls, `${size}x${size}: the map scrolls inside its frame`);
    assert.ok(m.cell >= 32, `${size}x${size}: squares ${m.cell}px`);
    assert.ok(m.meVisible, `${size}x${size}: hero square visible`);
    assert.equal(m.tabStops, 1, `${size}x${size}: one tab stop`);
    assert.deepEqual((await axe(page)).map((v) => v.id), [], `${size}x${size}: axe`);

    // Keyboard: walk the focus to the far corner; it scrolls into view inside the frame.
    await page.focus('.map [aria-current="location"]');
    for (let i = 0; i < size; i++) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); }
    const corner = await page.evaluate(() => {
      const el = document.activeElement; const r = el.getBoundingClientRect(); const b = document.getElementById('map-scroll').getBoundingClientRect();
      return { v: el.dataset.v, visible: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 };
    });
    assert.equal(corner.v, '1,1');
    assert.ok(corner.visible, `${size}x${size}: focused square scrolled into view`);
    // Walk one square; focus stays on it and the map recentres on the hero.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter'); await settle(page);
    const walked = await page.evaluate(() => {
      const me = document.querySelector('.map [aria-current="location"]').getBoundingClientRect(); const b = document.getElementById('map-scroll').getBoundingClientRect();
      const m = document.getElementById('main').getBoundingClientRect();
      return { at: [window.clickmonster.char.loc.x, window.clickmonster.char.loc.y], focus: document.activeElement.dataset.v, meVisible: me.left >= b.left - 1 && me.right <= b.right + 1 && me.top >= b.top - 1 && me.bottom <= b.bottom + 1 && me.top >= m.top - 1 && me.bottom <= m.bottom + 1 };
    });
    assert.deepEqual(walked.at, [2, 2]);
    assert.equal(walked.focus, '2,2', `${size}x${size}: focus restored to the square`);
    assert.ok(walked.meVisible, `${size}x${size}: hero visible after walking`);
    if (size >= 10) {
      // Manual panning survives re-renders.
      await page.evaluate(() => { const b = document.getElementById('map-scroll'); b.scrollLeft = b.scrollWidth; });
      const panned = await page.evaluate(() => document.getElementById('map-scroll').scrollLeft);
      await page.evaluate(() => { window.clickmonster.char.hp -= 1; });
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => document.getElementById('map-scroll').scrollLeft), panned, `${size}x${size}: pan kept`);
      assert.ok(await page.isVisible('[data-a="mapcenter"]'), `${size}x${size}: Center on me offered`);
    }
    await done(ctx);
  }
});

test('P2-02 bank sheet: amount, actions and Close stay usable above an overlay keyboard', async () => {
  for (const [w, h] of [[320, 640], [390, 844], [844, 390]]) {
    const ctx = await open(w, h, { keyboard: true });
    const { page } = ctx;
    await step(page, '[data-a="bank"]');
    await page.waitForSelector('#sheet[open] #amount');
    await page.focus('#amount');
    await setKeyboard(page, Math.round(h * 0.45));
    await page.waitForTimeout(250);
    const geo = await page.evaluate(() => {
      const vh = window.visualViewport.height;
      const dlg = document.getElementById('sheet').getBoundingClientRect();
      const panel = document.querySelector('#sheet .panel');
      const p = panel.getBoundingClientRect();
      return {
        vh, dlgTop: dlg.top, dlgBottom: dlg.bottom, panelTop: p.top, panelBottom: p.bottom,
        // Content the panel cannot show must be reachable by scrolling the panel itself.
        panelScrolls: getComputedStyle(panel).overflowY === 'auto',
        clipped: p.bottom > dlg.bottom + 1 || p.top < dlg.top - 1,
      };
    });
    assert.ok(geo.dlgTop >= 0 && geo.dlgBottom <= geo.vh + 1, `${w}x${h}: sheet ${geo.dlgTop}-${geo.dlgBottom} inside visible ${geo.vh}`);
    assert.equal(geo.clipped, false, `${w}x${h}: panel not clipped by the dialog`);
    assert.ok(geo.panelBottom <= geo.vh + 1, `${w}x${h}: panel above the keyboard`);
    assert.ok(geo.panelScrolls, 'panel scrolls');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'amount', 'focus stays in the amount field');
    // Without any scrolling by the player, the field and its Deposit and Withdraw buttons show.
    const shown = await page.evaluate(() => ['#amount', '[data-a="deposit"][data-v="amount"]', '[data-a="withdraw"][data-v="amount"]'].every((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.visualViewport.height + 1;
    }));
    assert.ok(shown, `${w}x${h}: amount field and its buttons in view above the keyboard`);
    // Each control can be brought into view and lies above the keyboard.
    for (const sel of ['#amount', '[data-a="deposit"][data-v="amount"]', '[data-a="withdraw"][data-v="amount"]', '#sheet [data-a="close"]']) {
      const ok = await page.evaluate((s) => {
        const el = document.querySelector(s); el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.visualViewport.height + 1 && r.height >= 24;
      }, sel);
      assert.ok(ok, `${w}x${h}: ${sel} reachable above the keyboard`);
    }
    // iOS may also pan the visible area up; the sheet follows it.
    await setKeyboard(page, Math.round(h * 0.45), 40);
    await page.waitForTimeout(250);
    const panned = await page.evaluate(() => {
      const vv = window.visualViewport; const d = document.getElementById('sheet').getBoundingClientRect();
      return { top: d.top, bottom: d.bottom, from: vv.offsetTop, to: vv.offsetTop + vv.height };
    });
    assert.ok(panned.top >= panned.from - 1 && panned.bottom <= panned.to + 1, `${w}x${h}: sheet ${panned.top}-${panned.bottom} within the panned visible area ${panned.from}-${panned.to}`);
    await setKeyboard(page, Math.round(h * 0.45));
    await page.waitForTimeout(250);
    // Type an amount and deposit with the keyboard still up.
    await page.fill('#amount', '1000');
    const bank = await page.evaluate(() => window.clickmonster.char.bank);
    await step(page, '[data-a="deposit"][data-v="amount"]');
    assert.equal(await page.evaluate(() => window.clickmonster.char.bank), bank + 1000, 'deposit went through');
    await page.keyboard.press('Escape'); await settle(page);
    assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false, 'Escape dismisses');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.a), 'bank', 'focus back on Bank');
    await done(ctx);
  }
});
