// MR-B2, the homepage and navigation (docs/monstra-regna-scope.md, section 4): B2-1 to B2-7 in the
// browser, on the fake backend. The file checks (exact menu and footer markup, the static pages'
// files and headers) are tests/site-pages.test.mjs; B2-8 (nothing else changed) is the existing
// entrance, news, password recovery and layout suites, which run unchanged apart from the four
// assertions listed in docs/monstra-regna-b2-report.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, ACCOUNTS, axe, savedSession, recoveryUrl } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const H = 3600000;
const iso = (t) => new Date(t).toISOString();
const NEWS = [1, 2, 3].map((i) => ({
  id: i, slug: `news-${i}`, kind: 'update', title: `News ${i}`, summary: `Summary ${i}.`, body: 'Text.', status: 'published',
  published_at: iso(Date.now() - i * H), revised_at: null, maintenance_starts_at: null, maintenance_ends_at: null, created_at: iso(Date.now() - 900 * H), updated_at: iso(Date.now() - H),
}));
const WIDTHS = [[320, 640], [390, 844], [768, 1024], [1024, 768], [1440, 900]];

async function open({ viewport = { width: 390, height: 844 }, backend = new FakeBackend(), saved } = {}) {
  const ctx = await env.page({ backend, viewport, mobile: viewport.width < 900 });
  if (saved) await ctx.page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, ['clickmonster.auth', JSON.stringify(saved)]);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const rect = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) }; }, sel);

// ---------------------------------------------------------------- B2-1: the layout

for (const [w, h] of WIDTHS) {
  test(`B2-1 at ${w}x${h}: the title, the menu, the sign-in panel, the news and the footer, in that order; nothing removed comes back`, async () => {
    const ctx = await open({ viewport: { width: w, height: h }, backend: new FakeBackend({ news: NEWS }) });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#news:not([hidden])', { timeout: 15000 });
    const s = await page.evaluate(() => ({
      order: [...document.querySelectorAll('#entry .e-wrap > *')].filter((e) => e.checkVisibility()).map((e) => e.className || e.id),
      removed: ['.e-kicker', '.e-sub', '.e-about'].filter((q) => document.querySelector(q)),
      title: document.querySelector('#entry h1').textContent.trim(),
      idText: document.querySelector('#entry .e-id').textContent.trim(),
      sideways: document.documentElement.scrollWidth > innerWidth || document.getElementById('entry').scrollWidth > innerWidth,
    }));
    assert.deepEqual(s.order, ['e-id', 'site-nav', 'e-gate', 'e-news', 'site-foot'], 'reading order');
    assert.deepEqual(s.removed, [], 'the kicker, the subtitle and "The realm" are gone');
    assert.equal(s.title, 'Monstra Regna');
    assert.equal(s.idText, 'Monstra Regna', 'the title alone: no kicker or subtitle');
    assert.equal(s.sideways, false, 'no sideways scrolling');
    // The reserved status area adds no space: the gap above the panel is the ordinary one.
    const nav = await rect(page, '#entry .site-nav');
    const gate = await rect(page, '#entry .e-gate');
    const news = await rect(page, '#news');
    if (w < 832) { // phones and tablets: one column
      assert.ok(gate.top - nav.bottom <= 21, `${w}: no empty space for the status line (${gate.top - nav.bottom}px)`);
    } else { // desktop: the news takes the left column, under the menu, beside the panel
      assert.ok(news.right <= gate.left, `${w}: the news is beside the sign-in panel`);
      assert.ok(news.top - nav.bottom <= 29, `${w}: no empty space for the status line above the news (${news.top - nav.bottom}px)`);
    }
    await done(ctx);
  });
}

test('B2-1 at 320x640 the sign-in panel is above the fold: the email field and Sign in on screen; the menu is one line', async () => {
  const ctx = await open({ viewport: { width: 320, height: 640 } });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.ok((await rect(page, '#authform button[type=submit]')).bottom <= 640, 'Sign in is on screen');
  const lines = await page.evaluate(() => new Set([...document.querySelectorAll('#entry .site-nav li')].map((li) => Math.round(li.getBoundingClientRect().top))).size);
  assert.equal(lines, 1, 'the menu is one line');
  await done(ctx);
});

// ---------------------------------------------------------------- B2-2: "Skip to sign in"

test('B2-2 "Skip to sign in" is the first Tab stop, is shown when focused, and leads to the email field', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform', { state: 'visible' });
  const hidden = await rect(page, '.e-skip');
  assert.ok(hidden.bottom <= 0, 'out of sight until focused');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'e-skip');
  const shown = await rect(page, '.e-skip');
  assert.ok(shown.top >= 0 && shown.height > 20, 'shown when focused');
  assert.equal((await page.textContent('.e-skip')).trim(), 'Skip to sign in');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'email');
  await done(ctx);
});

test('B2-2 while a saved session is restored, "Skip to sign in" leads to the panel\'s heading', async () => {
  const backend = new FakeBackend();
  const release = backend.hold('state');
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForFunction(() => document.documentElement.classList.contains('resuming'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-h', '"Returning to the realm": the heading');
  release();
  await page.waitForSelector('#top .hud-row', { timeout: 15000 });
  await done(ctx);
});

test('B2-2 during a password reset, "Skip to sign in" leads to the reset panel\'s first control', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(recoveryUrl(env.url, ACCOUNTS.player));
  await page.waitForSelector('#recover:not([hidden]) input, #recover:not([hidden]) button', { timeout: 15000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const at = await page.evaluate(() => ({ inPanel: !!document.activeElement.closest('#recover'), first: document.activeElement === [...document.querySelectorAll('#recover :is(input, button, a)')].find((c) => c.getClientRects().length && !c.disabled) }));
  assert.deepEqual(at, { inPanel: true, first: true });
  await ctx.context.close();
});

// ---------------------------------------------------------------- B2-3, B2-4, B2-5: the menu, the footer, the pages

test('B2-3 the menu: Home, Guide, Leaderboard and Contact, real links, Home current; each answers 200', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  const items = await page.evaluate(() => [...document.querySelectorAll('#entry nav[aria-label="Site"] a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]));
  assert.deepEqual(items, [['Home', '/', 'page'], ['Guide', '/guide', null], ['Leaderboard', '/leaderboard', null], ['Contact', '/contact', null]]);
  for (const [, href] of items) assert.equal((await page.request.get(`${env.url}${href}`)).status(), 200, `${href} answers`);
  await done(ctx);
});

for (const [path, heading] of [['/guide', 'Guide'], ['/leaderboard', 'Leaderboard'], ['/contact', 'Contact']]) {
  test(`B2-4 / B2-5 ${path}: the menu (this page current) and footer, no script, axe clean at 320, 390 and 1440`, async () => {
    for (const [w, h] of [[320, 640], [390, 844], [1440, 900]]) {
      const ctx = await open({ viewport: { width: w, height: h } });
      const { page } = ctx;
      const res = await page.goto(`${env.url}${path}`);
      assert.equal(res.status(), 200);
      const s = await page.evaluate(() => ({
        h1: document.querySelector('h1').textContent,
        current: document.querySelector('nav[aria-label="Site"] [aria-current="page"]')?.textContent,
        foot: document.querySelector('footer.site-foot p')?.textContent,
        scripts: document.scripts.length,
        sideways: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.deepEqual(s, { h1: heading, current: heading, foot: '© 2026 Aeturnis Development Labs, LLC', scripts: 0, sideways: false });
      if (path === '/contact') assert.equal(await page.getAttribute('main a[href^="mailto:"]', 'href'), 'mailto:support@monstraregna.com');
      await noAxe(page, `${path} at ${w}`);
      await done(ctx);
    }
  });
}

test('B2-4 the footer on the entrance and on the news pages; the same copyright in the game\'s Settings', async () => {
  const ctx = await open({ backend: new FakeBackend({ news: NEWS }) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  assert.equal(await page.textContent('#entry .site-foot p'), '© 2026 Aeturnis Development Labs, LLC');
  await page.goto(`${env.url}/news`);
  assert.equal(await page.textContent('footer.site-foot p'), '© 2026 Aeturnis Development Labs, LLC');
  assert.equal(await page.locator('nav[aria-label="Site"] a').count(), 4, 'the site menu on the news pages');
  await page.goto(`${env.url}/news/news-1`);
  assert.equal(await page.textContent('footer.site-foot p'), '© 2026 Aeturnis Development Labs, LLC');
  // The game: no footer, the copyright in Hero, Settings ("About").
  await signIn(page, env.url, 'player');
  await page.waitForSelector('#top .hud-row', { timeout: 15000 });
  assert.equal(await page.isVisible('#entry .site-foot'), false, 'no footer in the game');
  await page.click('[data-a="tab"][data-v="hero"]');
  await settle(page);
  assert.match(await page.textContent('#main'), /About\s*© 2026 Aeturnis Development Labs, LLC/);
  await done(ctx);
});

// ---------------------------------------------------------------- B2-6: the performance contract's hard checks

test('B2-6 at most 3 requests before the sign-in form shows (besides the icon and manifest); no game code, style.css or supabase-js for a visitor', async () => {
  const ctx = await open();
  const { page } = ctx;
  const seen = [];
  page.on('request', (r) => { const u = new URL(r.url()); seen.push(u.host === new URL(env.url).host ? u.pathname : u.host + u.pathname); });
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform', { state: 'visible' });
  // The form is in the HTML, so it shows at the first contentful paint: count, from the browser's own
  // timing, the document and what it started before then. (The news starts after the paint, on
  // purpose; counting up to Playwright noticing the form would race with it.)
  const beforePaint = await page.evaluate(() => {
    const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint').startTime;
    return ['/', ...performance.getEntriesByType('resource').filter((r) => r.startTime <= fcp).map((r) => new URL(r.name).pathname)];
  });
  const counted = beforePaint.filter((p) => !/\/(icon\.svg|manifest\.webmanifest)$/.test(p));
  assert.ok(counted.length <= 3, `requests before the form: ${counted.join(', ')}`);
  await page.waitForTimeout(1500); // the news and anything else after the paint
  const game = seen.filter((p) => /^\/js\//.test(p) && !['/js/entry.js', '/js/entry-news.js', '/js/config.js'].includes(p));
  assert.deepEqual(game, [], 'no game modules for a visitor who has not used the form');
  assert.equal(seen.some((p) => p === '/css/style.css' || p.includes('supabase-js')), false, 'no game stylesheet or sign-in library');
  await done(ctx);
});

// ---------------------------------------------------------------- B2-7: axe on the entrance's states

for (const [w, h] of [[320, 640], [390, 844], [1440, 900]]) {
  test(`B2-7 at ${w}x${h}: axe clean on the entrance with news, with "Skip to sign in" focused, restoring a session, and during a reset`, async () => {
    let ctx = await open({ viewport: { width: w, height: h }, backend: new FakeBackend({ news: NEWS }) });
    await ctx.page.goto(`${env.url}/`);
    await ctx.page.waitForSelector('#news:not([hidden])', { timeout: 15000 });
    await noAxe(ctx.page, 'with news');
    await ctx.page.keyboard.press('Tab');
    await noAxe(ctx.page, 'skip link focused');
    await done(ctx);

    const backend = new FakeBackend();
    const release = backend.hold('state');
    ctx = await open({ viewport: { width: w, height: h }, backend, saved: savedSession(ACCOUNTS.player) });
    await ctx.page.goto(`${env.url}/`);
    await ctx.page.waitForFunction(() => document.documentElement.classList.contains('resuming'));
    await noAxe(ctx.page, 'restoring a session');
    release();
    await ctx.context.close();

    ctx = await open({ viewport: { width: w, height: h } });
    await ctx.page.goto(recoveryUrl(env.url, ACCOUNTS.player));
    await ctx.page.waitForSelector('#recover:not([hidden]) input, #recover:not([hidden]) button', { timeout: 15000 });
    await noAxe(ctx.page, 'during a reset');
    await ctx.context.close();
  });
}
