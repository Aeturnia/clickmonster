// Landing page, phase L-2 (docs/landing-scope.md): the interface choice. Automatic, Desktop or
// Mobile, on the entrance and in Hero, Settings; saved on the device; Desktop falls back when it
// doesn't fit without changing the saved choice; Automatic is exactly as before; the entrance's own
// layout never changes with it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, axe } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const PREFS = 'clickmonster.prefs';
async function open({ w = 390, h = 844, touch = w < 900, prefs } = {}) {
  const ctx = await env.page({ backend: new FakeBackend(), viewport: { width: w, height: h }, mobile: touch });
  if (prefs) await ctx.page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [PREFS, JSON.stringify(prefs)]);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
async function play(ctx) {
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('#top .hud-row', { timeout: 15000 });
  await settle(ctx.page);
}
const layoutOf = (page) => page.evaluate(() => document.getElementById('app').dataset.layout);
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), PREFS);
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
const checkedEntrance = (page) => page.evaluate(() => document.querySelector('#iface input:checked')?.value);
async function toHeroSettings(page) {
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.waitForSelector('#layout-auto');
}

// ---------------------------------------------------------------- LAC-11: the control

test('LAC-11 the entrance offers the choice: a labelled group of radio buttons, saved on the device', async () => {
  const ctx = await open({ prefs: { vibrate: false, keys: false } });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#iface');
  assert.equal((await page.textContent('#iface legend')).trim(), 'Interface');
  assert.deepEqual(await page.$$eval('#iface input[type="radio"]', (r) => r.map((x) => [x.value, x.labels[0].textContent.trim()])), [['auto', 'Automatic'], ['desktop', 'Desktop'], ['mobile', 'Mobile']]);
  assert.equal(await checkedEntrance(page), 'auto', 'Automatic by default');
  assert.equal(await page.getAttribute('#iface', 'aria-describedby'), 'iface-note');
  // Keyboard: Tab reaches the group after the form; the arrow keys choose.
  await page.focus('#authmode');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'iface');
  await page.keyboard.press('ArrowRight');
  assert.equal(await checkedEntrance(page), 'desktop');
  assert.deepEqual(await saved(page), { vibrate: false, keys: false, layout: 'desktop' }, 'saved alongside the other settings, which are kept');
  assert.match(await page.textContent('#iface-note'), /Desktop needs a wider window/, '390 wide: the note says Desktop will fall back');
  await page.keyboard.press('ArrowRight');
  assert.equal(await checkedEntrance(page), 'mobile');
  assert.match(await page.textContent('#iface-note'), /phone layout/);
  await noAxe(page, 'entrance with the choice');
  await done(ctx);
});

test('LAC-11 Hero, Settings offers the same choice; it applies at once, keeps focus and says what is in use', async () => {
  const ctx = await open({ w: 1440, h: 900 });
  const { page } = ctx;
  await play(ctx);
  assert.equal(await layoutOf(page), 'desktop');
  await toHeroSettings(page);
  assert.equal((await page.textContent('#main .iface legend')).trim(), 'Interface');
  assert.equal(await page.isChecked('#layout-auto'), true);
  assert.match(await page.textContent('#layout-note'), /Automatic chooses for this screen: the desktop layout now/);
  await noAxe(page, 'Hero settings with the choice, desktop');
  await page.focus('#layout-auto');
  await page.keyboard.press('ArrowRight'); // Desktop
  await page.keyboard.press('ArrowRight'); // Mobile
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'mobile');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layout-mobile', 'focus stays on the choice');
  assert.equal((await saved(page)).layout, 'mobile');
  assert.match(await page.textContent('#layout-note'), /Using the phone layout/);
  await page.waitForFunction(() => /phone layout/.test(document.getElementById('sr-status').textContent));
  assert.equal(await noSideScroll(page), true);
  await noAxe(page, 'Hero settings with the choice, forced Mobile at 1440');
  await done(ctx);
});

// ---------------------------------------------------------------- LAC-12: what the choices do

test('LAC-12 Desktop where it fits, with a touch screen too; falls back otherwise and keeps the choice', async () => {
  // A touch tablet held sideways: Automatic gives the two-column layout; Desktop gives desktop.
  let ctx = await open({ w: 1366, h: 1024, touch: true, prefs: { layout: 'desktop' } });
  await play(ctx);
  assert.equal(await layoutOf(ctx.page), 'desktop', 'touch tablet, Desktop chosen');
  assert.equal(await noSideScroll(ctx.page), true);
  await noAxe(ctx.page, 'forced Desktop on a touch tablet');
  await done(ctx);

  // A small laptop: Desktop doesn't fit, so Automatic (the two-column layout) is used and said.
  ctx = await open({ w: 1024, h: 768, touch: false, prefs: { layout: 'desktop' } });
  const { page } = ctx;
  await play(ctx);
  assert.equal(await layoutOf(page), 'wide');
  await toHeroSettings(page);
  assert.equal(await page.isChecked('#layout-desktop'), true, 'the choice is still Desktop');
  assert.match(await page.textContent('#layout-note'), /Desktop needs a wider window, so Automatic is in use for now \(the two-column layout\)/);
  assert.equal((await saved(page)).layout, 'desktop', 'and still saved as Desktop');
  // Widening the window brings Desktop back without choosing again; narrowing falls back again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'desktop');
  assert.match(await page.textContent('#layout-note'), /Using the desktop layout/);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'wide');
  assert.equal((await saved(page)).layout, 'desktop', 'never overwritten by the fallback');
  await done(ctx);
});

test('LAC-12 on a touch tablet only the Desktop choice gives desktop: narrowing falls back, widening restores it', async () => {
  // With a coarse pointer Automatic never gives desktop, so getting it back proves the choice was kept.
  const ctx = await open({ w: 1366, h: 1024, touch: true, prefs: { layout: 'desktop' } });
  const { page } = ctx;
  await play(ctx);
  assert.equal(await layoutOf(page), 'desktop');
  await page.setViewportSize({ width: 1100, height: 1024 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'wide');
  assert.equal((await saved(page)).layout, 'desktop', 'kept while falling back');
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'desktop');
  assert.equal((await saved(page)).layout, 'desktop');
  await done(ctx);
});

test('LAC-12 Desktop falls back under 200% text, browser text size or page text size, and keeps the choice', async () => {
  for (const [label, how] of [['browser text 32px', { fontPx: 32 }], ['page text 200%', { rootScale: '200%' }]]) {
    const ctx = await open({ w: 1920, h: 1080, touch: false, prefs: { layout: 'desktop' } });
    const { page } = ctx;
    if (how.fontPx) {
      const cdp = await ctx.context.newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: how.fontPx, fixed: Math.round(how.fontPx * 0.8125) } });
    }
    if (how.rootScale) await page.addInitScript((sc) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = sc; }), how.rootScale);
    if (how.fontPx) {
      // The entrance's own note, with Desktop chosen, says it won't fit.
      await page.goto(`${env.url}/`);
      await page.waitForSelector('#iface');
      assert.equal(await checkedEntrance(page), 'desktop');
      assert.match(await page.textContent('#iface-note'), /Desktop needs a wider window/, `${label}: the entrance says it won't fit`);
    }
    await play(ctx);
    assert.notEqual(await layoutOf(page), 'desktop', `${label}: no desktop layout`);
    await toHeroSettings(page);
    assert.equal(await page.isChecked('#layout-desktop'), true);
    assert.match(await page.textContent('#layout-note'), /Desktop needs a wider window/, `${label}: the fallback is stated`);
    assert.equal((await saved(page)).layout, 'desktop', `${label}: the choice is kept`);
    assert.equal(await noSideScroll(page), true, `${label}: no sideways scrolling`);
    await done(ctx);
  }
});

test('LAC-12 Desktop on a phone falls back to the phone layout', async () => {
  const ctx = await open({ prefs: { layout: 'desktop' } });
  await play(ctx);
  assert.equal(await layoutOf(ctx.page), 'mobile');
  assert.equal(await noSideScroll(ctx.page), true);
  await done(ctx);
});

test('LAC-12 Mobile gives the phone column at tablet and desktop sizes', async () => {
  for (const [w, h] of [[1024, 768], [1440, 900], [1920, 1080]]) {
    const ctx = await open({ w, h, touch: false, prefs: { layout: 'mobile' } });
    const { page } = ctx;
    await play(ctx);
    assert.equal(await layoutOf(page), 'mobile', `${w}x${h}`);
    const geo = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const app = r('app');
      return { width: Math.round(app.width), left: Math.round(app.left), right: Math.round(innerWidth - app.right), side: getComputedStyle(document.getElementById('side')).display, order: [...document.getElementById('app').children].map((e) => e.id), navBelow: r('nav').top > r('main').top, bodyFont: getComputedStyle(document.body).fontSize };
    });
    assert.ok(geo.width <= 560, `${w}: the phone column (${geo.width}px)`);
    assert.ok(Math.abs(geo.left - geo.right) <= 1, `${w}: centred`);
    assert.equal(geo.side, 'none', `${w}: no side column`);
    assert.deepEqual(geo.order, ['top', 'main', 'chatbar', 'dock', 'nav', 'side'], `${w}: the phone reading order`);
    assert.equal(geo.navBelow, true, `${w}: the tabs at the bottom`);
    assert.equal(geo.bodyFont, '16px', `${w}: no desktop type step`);
    assert.equal(await noSideScroll(page), true, `${w}: no sideways scrolling`);
    await noAxe(page, `forced Mobile ${w}x${h}`);
    await done(ctx);
  }
});

test('LAC-12 Automatic, chosen or unset or unreadable, gives the same layouts as before', async () => {
  for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [1024, 768, true], [1366, 1024, true], [1440, 900, false], [1920, 1080, false]]) {
    const got = [];
    for (const prefs of [undefined, { layout: 'auto' }, { layout: 'sideways' }]) {
      const ctx = await open({ w, h, touch, prefs });
      await play(ctx);
      got.push(await layoutOf(ctx.page));
      await done(ctx);
    }
    const expected = w >= 1200 && !touch ? 'desktop' : (w >= 900 || (w > h && h <= 540 && w >= 600)) ? 'wide' : 'mobile';
    assert.deepEqual(got, [expected, expected, expected], `${w}x${h}${touch ? ' touch' : ''}`);
  }
});

// ---------------------------------------------------------------- the two places agree

test('a choice made on the entrance applies on sign-in; one made in the game shows on the entrance after signing out', async () => {
  const ctx = await open({ w: 1440, h: 900 });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.check('#iface input[value="mobile"]');
  await play(ctx); // signIn reloads the page; the choice is saved
  assert.equal(await layoutOf(page), 'mobile', 'the entrance choice is used');
  await toHeroSettings(page);
  await page.check('#layout-desktop');
  await page.waitForFunction(() => document.getElementById('app').dataset.layout === 'desktop');
  await page.click('#main [data-a="signout"]');
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await checkedEntrance(page), 'desktop', "the entrance shows the game's change");
  // And a change on the entrance after signing out reaches the game already loaded in this page.
  await page.check('#iface input[value="mobile"]');
  await page.fill('#email', 'player@example.test');
  await page.fill('#password', 'pw-player');
  await page.click('#authform button[type=submit]');
  await page.waitForSelector('#top .hud-row', { timeout: 15000 });
  assert.equal(await layoutOf(page), 'mobile');
  await done(ctx);
});

// ---------------------------------------------------------------- LAC-9: the entrance never changes with it

test('LAC-9 the entrance looks the same under every choice and every game layout', async () => {
  const measure = (page) => page.evaluate(() => ['#entry .e-id', '#entry .site-nav', '#entry .e-gate', '#authform', '#iface', '#entry .site-foot'].map((s) => { // since MR-B2: the menu and footer, in place of the removed "The realm"
    const r = document.querySelector(s).getBoundingClientRect();
    return [s, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }));
  for (const [w, h, touch] of [[390, 844, true], [1440, 900, false]]) {
    const firstTwo = [];
    for (const layout of ['auto', 'desktop', 'mobile']) {
      const ctx = await open({ w, h, touch, prefs: { layout } });
      const { page } = ctx;
      await page.goto(`${env.url}/`);
      await page.waitForSelector('#authform', { state: 'visible' });
      const fresh = await measure(page);
      // Sign in and out, so the game has set its layout on #app, then measure the entrance again.
      await play(ctx);
      const gameLayout = await layoutOf(page);
      await page.click('[data-a="tab"][data-v="hero"]');
      await page.click('#main [data-a="signout"]');
      await page.waitForSelector('#authform', { state: 'visible' });
      await page.evaluate(() => document.getElementById('auth-msg').setAttribute('hidden', '')); // the sign-out message aside
      assert.deepEqual(await measure(page), fresh, `${w}: ${layout} chosen, the game in ${gameLayout}: the entrance is unchanged`);
      firstTwo.push(fresh.slice(0, 3)); // identity, gate top and form: above the choice's own note
      await done(ctx);
    }
    const tops = firstTwo.map((b) => b.map(([s, l, t, wd]) => [s, l, t, wd]));
    assert.deepEqual(tops[1], tops[0], `${w}: identity and form the same with Desktop chosen`);
    assert.deepEqual(tops[2], tops[0], `${w}: identity and form the same with Mobile chosen`);
  }
});
