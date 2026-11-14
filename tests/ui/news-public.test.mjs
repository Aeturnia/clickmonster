// Landing L-4 (docs/landing-scope.md, LAC-15 to LAC-21): the entrance's news and maintenance line,
// and the public news pages, in the browser on the fake backend. The pages come from the real edge
// function handler, run by the harness (tests/news-pages.test.mjs tests the handler itself).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, FakeBackend, ACCOUNTS, axe, savedSession } from './harness.mjs';
import { SUPABASE_URL } from '../../public/js/config.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const H = 3600000;
const iso = (t) => new Date(t).toISOString();
const entry = (over) => ({ kind: 'update', body: 'Text.\n\n- One\n- Two', status: 'published', revised_at: null, maintenance_starts_at: null, maintenance_ends_at: null, created_at: iso(Date.now() - 900 * H), updated_at: iso(Date.now() - 1 * H), ...over });
const NEWS = [
  entry({ id: 1, slug: 'winter-update', title: 'Winter update', summary: 'New zones and a frozen boss arrive.', published_at: iso(Date.now() - 1 * H) }),
  entry({ id: 2, slug: 'patch-notes-1-2', kind: 'patch', title: 'Patch notes 1.2', summary: 'What changed in this release of the game.', published_at: iso(Date.now() - 30 * H) }),
  entry({ id: 3, slug: 'autumn-festival', title: 'Autumn festival', summary: 'A week of festival events in every town.', published_at: iso(Date.now() - 60 * H) }),
  entry({ id: 4, slug: 'the-first-news', title: 'The first news', summary: 'Our very first article, the oldest one here.', published_at: iso(Date.now() - 90 * H) }),
  entry({ id: 5, slug: 'secret-draft', title: 'Secret draft', summary: 'A draft that nobody may see yet.', status: 'draft', published_at: null }),
  entry({ id: 6, slug: 'tomorrow-news', title: 'Tomorrow news', summary: 'Published for a time still to come.', published_at: iso(Date.now() + 24 * H) }),
];
const MAINT = (startH, endH, over = {}) => entry({ id: 9, slug: 'server-maintenance', kind: 'maintenance', title: 'Server maintenance', summary: 'The realm is closed for two hours.', published_at: iso(Date.now() - 2 * H), maintenance_starts_at: startH == null ? null : iso(Date.now() + startH * H), maintenance_ends_at: endH == null ? null : iso(Date.now() + endH * H), ...over });

async function open({ news = NEWS, viewport = { width: 390, height: 844 }, mobile = true, saved, bypassCSP = false } = {}) {
  const backend = new FakeBackend({ news });
  const ctx = await env.page({ backend, viewport, mobile, bypassCSP });
  if (saved) await ctx.page.addInitScript((v) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('clickmonster.auth', v); sessionStorage.setItem('s', '1'); } }, JSON.stringify(saved));
  ctx.log = [];
  ctx.page.on('request', (r) => ctx.log.push(r.url()));
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const own = (ctx, base) => ctx.log.filter((u) => u.startsWith(base)).map((u) => new URL(u).pathname);
const newsReads = (ctx) => ctx.log.filter((u) => u.startsWith(`${SUPABASE_URL}/rest/v1/news`));

// ---------------------------------------------------------------- the entrance (LAC-15, Q10, Q5)

test('LAC-15 the entrance shows the latest three published articles after the form, and All news', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#news:not([hidden])', { timeout: 10000 });
  const items = await page.$$eval('#news-list li', (li) => li.map((l) => ({ title: l.querySelector('a').textContent, href: l.querySelector('a').getAttribute('href'), summary: l.querySelector('.e-news-summary').textContent })));
  assert.deepEqual(items.map((i) => i.title), ['Winter update', 'Patch notes 1.2', 'Autumn festival'], 'newest three, published only');
  assert.equal(items[0].href, '/news/winter-update');
  assert.equal(items[1].summary, 'What changed in this release of the game.');
  assert.equal(await page.getAttribute('#news .e-news-all a', 'href'), '/news');
  const order = await page.evaluate(() => [...document.querySelectorAll('#entry .e-wrap > *')].map((e) => e.id || e.className));
  assert.ok(order.indexOf('news') > order.findIndex((c) => String(c).includes('e-gate')), 'after the sign-in panel in reading order');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'email', 'sign-in is still the first stop');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await noAxe(page, 'entrance with news, phone');
  await ctx.context.close();
  const wide = await open({ viewport: { width: 1440, height: 900 }, mobile: false });
  await wide.page.goto(`${env.url}/`);
  await wide.page.waitForSelector('#news:not([hidden])', { timeout: 10000 });
  await noAxe(wide.page, 'entrance with news, desktop');
  await done(wide);
});

test('LAC-15 news loads after the entrance has rendered, from its own module, without game code', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#news:not([hidden])', { timeout: 10000 });
  // When each resource started, against the first paint (the browser's own timings).
  const t = await page.evaluate(() => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    const loaded = performance.getEntriesByType('navigation')[0].loadEventStart;
    const res = performance.getEntriesByType('resource').map((r) => ({ name: new URL(r.name).pathname + (r.name.includes('/rest/v1/') ? '' : ''), host: new URL(r.name).host, start: r.startTime }));
    return { paint, loaded, res };
  });
  assert.ok(t.paint > 0, 'the entrance painted');
  const before = t.res.filter((r) => r.start < t.paint).map((r) => r.name).filter((p) => !p.startsWith('/icon'));
  assert.deepEqual(before.sort(), ['/css/entry.css', '/js/entry.js'], 'before the first paint: only the entrance');
  for (const r of t.res.filter((x) => x.name === '/js/entry-news.js' || x.name === '/js/config.js' || x.name.startsWith('/rest/v1/news'))) {
    assert.ok(r.start >= t.paint && r.start >= t.loaded, `${r.name} started after the entrance rendered and loaded`);
  }
  const after = own(ctx, env.url);
  assert.ok(after.includes('/js/entry-news.js') && after.includes('/css/entry-news.css'));
  assert.deepEqual(after.filter((p) => p.startsWith('/js/') && !['/js/entry.js', '/js/entry-news.js', '/js/config.js'].includes(p)), [], 'no game module');
  assert.equal(ctx.log.some((u) => u.includes('/vendor/')), false, 'no supabase-js');
  assert.equal(newsReads(ctx).length, 2, 'two public reads: the latest articles and maintenance');
  await done(ctx);
});

test('Q5 maintenance: one line near the form while upcoming or under way; gone once it has ended', async () => {
  for (const [label, m, shown, pattern] of [
    ['upcoming', MAINT(3, 5), true, /Scheduled maintenance: Server maintenance, .+ to .+\. Details/],
    ['under way', MAINT(-1, 2), true, /under way until/],
    ['no window', MAINT(null, null), true, /Scheduled maintenance: Server maintenance\. Details/],
    ['ended', MAINT(-5, -1), false],
    ['unpublished', MAINT(3, 5, { status: 'unpublished' }), false],
  ]) {
    const ctx = await open({ news: [...NEWS, m] });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#news:not([hidden])', { timeout: 10000 });
    assert.equal(await page.isVisible('#maint'), shown, label);
    if (shown) {
      assert.match((await page.textContent('#maint')).replace(/\s+/g, ' '), pattern, label);
      assert.equal(await page.getAttribute('#maint a', 'href'), '/news/server-maintenance');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'email', `${label}: the form is still first`);
      await noAxe(page, `maintenance line, ${label}`);
    }
    await done(ctx);
  }
});

// ---------------------------------------------------------------- L-4 review: L4-01
// The browser's clock is controlled, so time can pass while the entrance stays open.
const MIN = 60000;
const maintAt = (startMin, endMin, over = {}) => MAINT(null, null, {
  maintenance_starts_at: startMin == null ? null : iso(Date.now() + startMin * MIN),
  maintenance_ends_at: endMin == null ? null : iso(Date.now() + endMin * MIN), ...over,
});

test('L4-01 a notice under way disappears when it ends, without a reload or another request', async () => {
  const ctx = await open({ news: [...NEWS, maintAt(-10, 2)] });
  const { page } = ctx;
  await page.clock.install({ time: new Date() });
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#maint:not([hidden])', { timeout: 10000 });
  assert.match(await page.textContent('#maint'), /under way until/);
  await page.evaluate(() => { window.__samePage = true; });
  const reads = newsReads(ctx).length;
  await page.clock.fastForward(3 * MIN);
  await page.waitForSelector('#maint', { state: 'hidden', timeout: 5000 });
  assert.equal(await page.textContent('#maint'), '', 'emptied');
  assert.equal(await page.evaluate(() => window.__samePage), true, 'no reload');
  assert.equal(newsReads(ctx).length, reads, 'no new request');
  assert.ok(await page.isVisible('#news'), 'the news list stays');
  await done(ctx);
});

test('L4-01 an upcoming notice turns into "under way" at its start, then disappears at its end', async () => {
  const ctx = await open({ news: [...NEWS, maintAt(1, 3)] });
  const { page } = ctx;
  await page.clock.install({ time: new Date() });
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#maint:not([hidden])', { timeout: 10000 });
  assert.match(await page.textContent('#maint'), / to /, 'upcoming: from and to');
  assert.doesNotMatch(await page.textContent('#maint'), /under way/);
  await page.clock.fastForward(1.5 * MIN);
  await page.waitForFunction(() => /under way until/.test(document.getElementById('maint').textContent), null, { timeout: 5000 });
  await page.clock.fastForward(2 * MIN);
  await page.waitForSelector('#maint', { state: 'hidden', timeout: 5000 });
  await done(ctx);
});

test('L4-01 newer, already-ended notices never crowd out one that is still to come', async () => {
  const ended = [1, 2, 3, 4, 5, 6].map((i) => maintAt(-300 - i * 10, -200 - i * 10, { id: 100 + i, slug: `old-maintenance-${i}`, title: `Old maintenance ${i}`, published_at: iso(Date.now() - i * 60000) }));
  const upcoming = maintAt(60, 120, { id: 200, slug: 'next-maintenance', title: 'Next maintenance', published_at: iso(Date.now() - 50 * H) });
  const ctx = await open({ news: [...NEWS, ...ended, upcoming] });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#maint:not([hidden])', { timeout: 10000 });
  assert.match(await page.textContent('#maint'), /Next maintenance/);
  const q = newsReads(ctx).map((u) => new URL(u).searchParams).find((p) => p.get('kind') === 'eq.maintenance');
  assert.match(q.get('or'), /^\(maintenance_ends_at\.is\.null,maintenance_ends_at\.gt\.\d{4}-/, 'only notices that have not ended are asked for');
  await done(ctx);
});

// ---------------------------------------------------------------- L-4 review: L4-03
test('L4-03 a notice under way with no end time comes before an upcoming one', async () => {
  // The upcoming notice is the newer one, so it comes first in the read; the open-ended one must still win.
  const active = maintAt(-10, null, { id: 300, slug: 'open-ended-maintenance', title: 'Open-ended maintenance', published_at: iso(Date.now() - 3 * H) });
  const upcoming = maintAt(30, 60, { id: 301, slug: 'later-maintenance', title: 'Later maintenance', published_at: iso(Date.now() - 1 * H) });
  const ctx = await open({ news: [...NEWS, active, upcoming] });
  const { page } = ctx;
  await page.clock.install({ time: new Date() });
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#maint:not([hidden])', { timeout: 10000 });
  const text = await page.textContent('#maint');
  assert.match(text, /Open-ended maintenance/, 'the notice under way is shown');
  assert.doesNotMatch(text, /Later maintenance/, 'not the upcoming one');
  assert.equal(await page.getAttribute('#maint a', 'href'), '/news/open-ended-maintenance');
  await done(ctx);
});

test('LAC-15 / LAC-21 news failing or never answering: nothing shows, sign-in and the game go ahead', async () => {
  // Failing: the reads are refused.
  let ctx = await open();
  await ctx.page.route(`${SUPABASE_URL}/rest/v1/news*`, (r) => r.abort('internetdisconnected'));
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('#top .hud-row', { timeout: 15000 });
  assert.equal(await ctx.page.evaluate(() => document.getElementById('news').hidden), true, 'no news box');
  assert.equal(await ctx.page.evaluate(() => document.getElementById('maint').hidden), true);
  await done(ctx);
  // Never answering, for a visitor and for a returning player.
  for (const saved of [undefined, savedSession(ACCOUNTS.player)]) {
    ctx = await open({ saved });
    await ctx.page.route(`${SUPABASE_URL}/rest/v1/news*`, () => { /* held forever */ });
    if (saved) await ctx.page.goto(`${env.url}/`);
    else await signIn(ctx.page, env.url, 'player');
    await ctx.page.waitForSelector('#top .hud-row', { timeout: 15000 });
    assert.ok(newsReads(ctx).length >= 1, 'news was asked for, and is still pending');
    await ctx.context.close();
  }
});

test('an error answer from the news API shows nothing broken on the entrance', async () => {
  const ctx = await open();
  await ctx.page.route(`${SUPABASE_URL}/rest/v1/news*`, (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"down"}' }));
  await ctx.page.goto(`${env.url}/`);
  await ctx.page.waitForSelector('#authform', { state: 'visible' });
  await ctx.page.waitForTimeout(800);
  assert.equal(await ctx.page.evaluate(() => document.getElementById('news').hidden), true);
  assert.equal(await ctx.page.evaluate(() => document.getElementById('entry-news-css')), null, 'its styles are not even loaded');
  await done(ctx);
});

// ---------------------------------------------------------------- the public pages (LAC-16, LAC-17)

test('LAC-16 / LAC-17 an article page: readable, in the entrance design, with no script or game code', async () => {
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const ctx = await open({ viewport: { width: w, height: h }, mobile, bypassCSP: true });
    const { page } = ctx;
    const res = await page.goto(`${env.url}/news/patch-notes-1-2`);
    assert.equal(res.status(), 200);
    assert.equal(res.headers()['cache-control'], 'no-store');
    assert.equal((await page.textContent('h1')).trim(), 'Patch notes 1.2');
    assert.deepEqual(await page.$$eval('.n-body li', (l) => l.map((x) => x.textContent)), ['One', 'Two']);
    assert.equal(await page.locator('script').count(), 0, 'no script');
    const paths = own(ctx, env.url).filter((p) => !p.startsWith('/icon') && !p.startsWith('/favicon'));
    assert.deepEqual(paths, ['/news/patch-notes-1-2', '/css/entry.css', '/css/news.css'], 'the page and two stylesheets, nothing else');
    assert.equal(ctx.log.some((u) => u.includes('/vendor/') || u.includes('/js/')), false, 'no supabase-js or game code');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
    await noAxe(page, `article ${w}`);
    await done(ctx);
  }
});

test('LAC-16 the list, the 404 page, and unpublishing taking effect on the next request', async () => {
  const ctx = await open({ bypassCSP: true });
  const { page, backend } = ctx;
  await page.goto(`${env.url}/news`);
  assert.deepEqual(await page.$$eval('.n-item h2 a', (a) => a.map((x) => x.textContent)), ['Winter update', 'Patch notes 1.2', 'Autumn festival', 'The first news'], 'every published article, newest first');
  await noAxe(page, 'news list');
  for (const slug of ['secret-draft', 'tomorrow-news', 'no-such-thing']) {
    const res = await page.goto(`${env.url}/news/${slug}`);
    assert.equal(res.status(), 404, slug);
    assert.match(await page.textContent('h1'), /This update isn't available/);
  }
  await noAxe(page, '404 page');
  // Unpublished in the admin console: gone from the next request.
  assert.equal((await page.goto(`${env.url}/news/winter-update`)).status(), 200);
  backend.news.find((n) => n.slug === 'winter-update').status = 'unpublished';
  assert.equal((await page.goto(`${env.url}/news/winter-update`)).status(), 404, 'no cached copy');
  await done(ctx);
});

test('LAC-16 Supabase down: the 503 page, in the same design', async () => {
  const ctx = await open({ bypassCSP: true });
  ctx.backend.newsPagesDown = true;
  const res = await ctx.page.goto(`${env.url}/news/patch-notes-1-2`);
  assert.equal(res.status(), 503);
  assert.match(await ctx.page.textContent('h1'), /News is unavailable right now/);
  assert.equal(await ctx.page.getAttribute('.n-links a', 'href'), '/');
  await noAxe(ctx.page, '503 page');
  await done(ctx);
});
