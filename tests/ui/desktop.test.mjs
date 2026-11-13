// Desktop layout, phase D-1 (docs/desktop-scope.md): the frame, battle actions next to the fight,
// the side column's summary and minimap, the width and type step, falling back when there isn't
// room, and leaving phones, phones on their side and tablets as they were.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, focusInfo, PAGE_METRICS } from './harness.mjs';
import { maxHp } from '../../public/js/engine/character.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

async function open(w, h, { touch = false, hero, fontPx, rootScale, signedIn = true, dsf } = {}) {
  const backend = new FakeBackend({ hero: hero || makeHero() });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: touch, ...(dsf ? { deviceScaleFactor: dsf } : {}) });
  if (fontPx) {
    // The browser's own text size (what "larger text" in the browser settings changes); em
    // media queries follow it, unlike a font size set by the page.
    const cdp = await ctx.context.newCDPSession(ctx.page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: fontPx, fixed: Math.round(fontPx * 0.8125) } });
  }
  if (rootScale) await ctx.page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s; }), rootScale);
  if (!signedIn) { await ctx.page.goto(`${env.url}/`); await ctx.page.waitForSelector('#main form, #main input', { timeout: 15000 }); return ctx; }
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"]', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
async function step(page, sel) { await page.waitForTimeout(270); await page.click(sel); await settle(page); }
const layoutOf = (page) => page.evaluate(() => document.getElementById('app').dataset.layout);
const order = (page) => page.evaluate(() => [...document.getElementById('app').children].map((e) => e.id));
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; }, sel);

// A hero who hits softly and lasts: fights run long enough for the battle log to fill.
function enduringHero() {
  const c = makeHero();
  c.stats.str = 1;
  c.stats.vit = 400;
  c.hp = maxHp(c);
  return c;
}

// ---------------------------------------------------------------- the frame

test('D-1 frame: hero bar, navigation, screen with its actions, then the side column (1440×900)', async () => {
  const ctx = await open(1440, 900, { hero: makeHero({ pendingLevels: 1 }) });
  const { page } = ctx;
  assert.equal(await layoutOf(page), 'desktop');
  assert.deepEqual(await order(page), ['top', 'nav', 'main', 'dock', 'side'], 'reading order: hero bar, navigation, screen, actions, side column');
  assert.equal(await page.evaluate(() => document.getElementById('chatbar').parentElement.id), 'side', 'the chat line is in the side column');
  const [app, top, nav, main, dock, side] = await Promise.all(['#app', '#top', '#nav', '#main', '#dock', '#side'].map((s) => box(page, s)));
  assert.equal(top.width, app.width, 'the hero bar spans the full width');
  assert.ok(nav.top >= top.bottom && main.top >= nav.bottom && dock.top >= main.bottom, 'navigation under the hero bar, the screen under it, its actions under that');
  assert.ok(side.left >= main.right - 1 && side.top >= top.bottom, 'the side column is to the right, under the hero bar');
  assert.ok(side.width >= 340 && side.width <= 400, `side column ${side.width}px (340–400)`);
  assert.ok(await page.isVisible('#summary') && await page.isVisible('#minimap .minimap'), 'summary and minimap shown');
  await noAxe(page, 'desktop explore');
  await done(ctx);
});

test('D-1 reading and tab order matches the visual order', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  // Start from the top of the page: a temporary button before everything else.
  await page.evaluate(() => { const b = document.createElement('button'); b.textContent = 'start'; document.body.prepend(b); b.focus(); b.addEventListener('blur', () => b.remove(), { once: true }); });
  const regions = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => ['top', 'nav', 'main', 'dock', 'side'].find((id) => document.getElementById(id).contains(document.activeElement)) || null);
    if (r && regions.at(-1) !== r) regions.push(r);
    if (regions.includes('side') && r !== 'side') break;
  }
  assert.deepEqual(regions.slice(0, 4), ['nav', 'main', 'dock', 'side'], `Tab goes through ${regions.join(', ')}`);
  await done(ctx);
});

test('D-1 battle: the actions sit directly under the fight, at the start and once the log has filled', async () => {
  for (const [w, h] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    const ctx = await open(w, h, { hero: enduringHero() });
    const { page } = ctx;
    // The strongest monster here (the last in the list) fights back for many turns.
    const strongest = await page.evaluate(() => [...document.querySelectorAll('#main [data-a="fight"]')].at(-1).dataset.v);
    await step(page, `#main [data-a="fight"][data-v="${strongest}"]`);
    const gap = () => page.evaluate(() => {
      const log = document.getElementById('log').getBoundingClientRect();
      const act = document.querySelector('.dock-battle button').getBoundingClientRect();
      const acts = [...document.querySelectorAll('.dock-battle button')].map((b) => b.getBoundingClientRect());
      // The fight's content ends with the log, or with the result card once it is over.
      const end = Math.max(...[...document.getElementById('main').children].filter((e) => !e.classList.contains('sr-only') && e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom));
      return {
        // From the end of the fight to the top of the actions, and whether they sit in the
        // log's column. (tools/desktop-metrics.mjs also reports the centre-to-centre distance.)
        gap: Math.round(act.top - end),
        inColumn: acts.every((a) => a.left >= log.left - 1 && a.right <= log.right + 1),
        inView: act.top >= 0 && act.bottom <= innerHeight,
        logScrolls: document.getElementById('log').scrollHeight > document.getElementById('log').clientHeight + 1,
        pageScrolled: document.scrollingElement.scrollTop, mainScrolled: document.getElementById('main').scrollTop,
      };
    });
    const first = await gap();
    assert.ok(first.gap >= 0 && first.gap <= 24 && first.inColumn && first.inView, `${w}×${h} at the start: actions ${first.gap}px under the log, in its column: ${first.inColumn}`);
    // Fight on until the log has filled (or the fight ends).
    for (let i = 0; i < 40 && await page.isVisible('[data-a="melee"]'); i++) {
      if (await page.evaluate(() => { const l = document.getElementById('log'); return l.scrollHeight > l.clientHeight + 1; })) break;
      await step(page, '[data-a="melee"]');
    }
    const later = await gap();
    assert.ok(later.gap >= 0 && later.gap <= 24 && later.inColumn && later.inView, `${w}×${h} after a long fight: actions ${later.gap}px under the log, in its column: ${later.inColumn}`);
    assert.ok(later.logScrolls, `${w}×${h}: the log scrolls once it fills`);
    assert.deepEqual([later.pageScrolled, later.mainScrolled], [0, 0], 'the log scrolls, not the page or the screen');
    if (w === 1440) await noAxe(page, 'desktop battle');
    await done(ctx);
  }
});

test('D-1 width and type: at most about 1600px, centred; text steps up on large displays', async () => {
  for (const [w, h, font] of [[1440, 900, 16], [1920, 1080, 17], [2560, 1440, 18]]) {
    const ctx = await open(w, h);
    const { page } = ctx;
    const m = await page.evaluate(() => {
      const app = document.getElementById('app').getBoundingClientRect();
      return { width: Math.round(app.width), left: Math.round(app.left), right: Math.round(innerWidth - app.right), font: parseFloat(getComputedStyle(document.documentElement).fontSize),
        play: Math.round(document.querySelector('#main .place').getBoundingClientRect().width) };
    });
    assert.equal(m.width, Math.min(w, 1600), `${w}: app width`);
    assert.ok(Math.abs(m.left - m.right) <= 1, `${w}: centred (${m.left} / ${m.right})`);
    assert.equal(m.font, font, `${w}: root text ${m.font}px`);
    assert.ok(m.play <= 47.5 * font + 1, `${w}: reading width ${m.play}px stays at 47.5rem`);
    await done(ctx);
  }
});

// ---------------------------------------------------------------- side column

test('D-1 summary: only what the hero bar does not show; one line when there is nothing', async () => {
  const quiet = await open(1440, 900);
  const q = await quiet.page.evaluate(() => ({ text: document.getElementById('summary').textContent.replace(/\s+/g, ' ').trim(), lines: document.querySelectorAll('#summary li, #summary .side-none').length }));
  assert.equal(q.text, 'Quests and events No quest or events right now.');
  assert.equal(q.lines, 1);
  await done(quiet);

  const hero = makeHero({ pendingLevels: 2 });
  hero.quest = { variant: 'blessed', minLevel: 8, maxLevel: 14, zone: 'bramblebrook', expiresAt: Date.now() + 2 * 3600000 };
  const ctx = await open(1440, 900, { hero });
  const { page } = ctx;
  await step(page, '[data-a="later"]'); // the level-up sheet opens on sign-in when levels are waiting
  const s = await page.evaluate(() => document.getElementById('summary').textContent.replace(/\s+/g, ' '));
  assert.match(s, /2 levels to spend/);
  assert.match(s, /Quest: Slay a Blessed creature of level 8 to 14 in Bramblebrook Meadows\. \d+h \d+m left\./);
  for (const shown of ['Bartholomew Thorne', 'HP', '123', 'gold', 'gems', 'XP']) assert.ok(!s.includes(shown), `the summary does not repeat the hero bar ("${shown}")`);
  assert.equal(await page.isVisible('#main .notice.quest'), false, 'the quest is not shown twice on Explore');
  await page.click('#sum-levels');
  await settle(page);
  assert.equal(await page.getAttribute('[data-a="tab"][data-v="hero"]', 'aria-current'), 'page', 'levels to spend opens the Hero screen');
  await done(ctx);
});

test('D-1 minimap: a picture with a text version; text only on short screens; opens the map', async () => {
  const tall = await open(1440, 900);
  let m = await tall.page.evaluate(() => ({
    grid: !!document.querySelector('#minimap .minimap')?.getClientRects().length, hidden: document.querySelector('#minimap .minimap')?.getAttribute('aria-hidden'),
    cells: document.querySelectorAll('#minimap .minimap i').length, me: document.querySelectorAll('#minimap .minimap .me').length,
    text: document.querySelector('#minimap .mini-near').textContent, head: document.querySelector('#minimap .side-h').textContent.replace(/\s+/g, ' ').trim(),
  }));
  assert.deepEqual([m.grid, m.hidden, m.cells, m.me], [true, 'true', 100, 1], 'a 10×10 picture, hidden from screen readers, marking you once');
  assert.equal(m.head, 'Bramblebrook Meadows 5, 5');
  assert.match(m.text, /Boss lair 3N 4E/);
  await tall.page.click('#mini-open');
  await settle(tall.page);
  assert.equal(await tall.page.getAttribute('[data-a="tab"][data-v="map"]', 'aria-current'), 'page');
  await done(tall);

  const short = await open(1366, 768);
  m = await short.page.evaluate(() => ({ grid: !!document.querySelector('#minimap .minimap')?.getClientRects().length, text: document.querySelector('#minimap .mini-near').getClientRects().length > 0 }));
  assert.deepEqual(m, { grid: false, text: true }, 'short screens keep only the text');
  await noAxe(short.page, 'desktop 1366×768');
  await done(short);
});

// ---------------------------------------------------------------- space, not width

test('D-1 larger text and zoom: the layout falls back when there is no room for it', async () => {
  const cases = [
    ['1920×1080, browser text 32px', 1920, 1080, { fontPx: 32 }],
    ['1366×768, browser text 32px', 1366, 768, { fontPx: 32 }],
    ['1920×1080, page text 200%', 1920, 1080, { rootScale: '200%' }],
    ['1366×768 at 200% zoom', 683, 384, { dsf: 2 }],
  ];
  for (const [label, w, h, opts] of cases) {
    const ctx = await open(w, h, opts);
    const { page } = ctx;
    const layout = await layoutOf(page);
    assert.notEqual(layout, 'desktop', `${label}: not the desktop layout (got ${layout})`);
    const m = await page.evaluate(PAGE_METRICS);
    assert.equal(m.hOverflow, false, `${label}: no sideways scrolling`);
    assert.equal(m.dockOffscreen, 0, `${label}: actions on screen`);
    assert.deepEqual(await order(page), ['top', 'main', 'chatbar', 'dock', 'nav', 'side'], `${label}: the usual order`);
    await done(ctx);
  }
});

test('D-1 phones, tablets and narrow windows keep their layouts', async () => {
  const cases = [
    ['phone 390×844', 390, 844, true, 'mobile'],
    ['tablet 1024×768 (touch)', 1024, 768, true, 'wide'],
    ['tablet 1366×1024 (touch)', 1366, 1024, true, 'wide'],
    ['window 1150×800 (mouse)', 1150, 800, false, 'wide'],
  ];
  for (const [label, w, h, touch, want] of cases) {
    const ctx = await open(w, h, { touch });
    assert.equal(await layoutOf(ctx.page), want, label);
    assert.deepEqual(await order(ctx.page), ['top', 'main', 'chatbar', 'dock', 'nav', 'side'], `${label}: the usual order`);
    assert.equal(await ctx.page.isVisible('#side'), false, `${label}: no side column`);
    await done(ctx);
  }
});

test('D-1 resizing across 1200px keeps focus where it was', async () => {
  const ctx = await open(1440, 900);
  const { page } = ctx;
  await page.focus('[data-a="tab"][data-v="gear"]');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'wide');
  assert.deepEqual([(await focusInfo(page)).a, (await focusInfo(page)).v], ['tab', 'gear'], 'focus stays on the Gear tab');
  await page.focus('#main [data-a="fight"]');
  const fightV = (await focusInfo(page)).v;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'desktop');
  assert.deepEqual([(await focusInfo(page)).a, (await focusInfo(page)).v], ['fight', fightV], 'focus stays on the monster row');
  assert.deepEqual(await order(page), ['top', 'nav', 'main', 'dock', 'side']);
  await done(ctx);
});

// Landing L-1: sign-in moved out of #app into the entrance (index.html), which has its own layout
// (tests/ui/entrance.test.mjs). The screen without a game left inside #app is hero creation.
test('D-1 screens without a game use the full width', async () => {
  const ctx = await env.page({ backend: new FakeBackend(), viewport: { width: 1440, height: 900 }, mobile: false });
  const { page } = ctx;
  await signIn(page, env.url, 'fresh');
  await page.waitForSelector('#name', { timeout: 15000 });
  assert.equal(await layoutOf(page), 'desktop');
  const [app, main] = await Promise.all([box(page, '#app'), box(page, '#main')]);
  assert.equal(main.width, app.width, 'hero creation uses the full width');
  assert.equal(await page.isVisible('#side'), false, 'no empty side column');
  await noAxe(page, 'desktop hero creation');
  await done(ctx);
});
