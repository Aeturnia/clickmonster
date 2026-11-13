// Landing L-3 (docs/landing-scope.md, LAC-13): the admin console's Public news section, on the fake
// backend. The real function and database are tested on the local stack (tests/db/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const day = 86400000;
const iso = (t) => new Date(t).toISOString();
const SEED = [
  { id: 7, slug: 'winter-update', kind: 'update', title: 'Winter update', summary: 'New zones and a frozen boss arrive.', body: 'Text.', status: 'published', published_at: iso(Date.now() - 3 * day), revised_at: null, maintenance_starts_at: null, maintenance_ends_at: null, created_at: iso(Date.now() - 4 * day), updated_at: iso(Date.now() - 3 * day) },
  { id: 8, slug: 'old-notes', kind: 'patch', title: 'Old notes', summary: 'Patch notes that were taken down.', body: 'Text.', status: 'unpublished', published_at: iso(Date.now() - 9 * day), revised_at: null, maintenance_starts_at: null, maintenance_ends_at: null, created_at: iso(Date.now() - 10 * day), updated_at: iso(Date.now() - 2 * day) },
];

async function console_({ who = 'admin', width = 1440, height = 900, news = [], hash = '#news' } = {}) {
  const backend = new FakeBackend({ hero: makeHero(), news });
  const ctx = await env.page({ backend, viewport: { width, height }, mobile: width < 900 });
  await signIn(ctx.page, env.url, who, `/admin.html${hash}`);
  await ctx.page.waitForSelector('.a-nav', { timeout: 15000 });
  await ctx.page.waitForTimeout(300);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const calls = (backend, a) => backend.calls.filter((c) => c.fn === 'admin' && c.action === a).length;
const newsLog = (backend) => backend.adminData().log.filter((l) => l.action.startsWith('news:')).map((l) => l.action).reverse();
const active = (page) => page.evaluate(() => ({ id: document.activeElement.id, text: document.activeElement.textContent.trim() }));
async function fill(page, { title, summary, body, slug }) {
  if (title != null) await page.fill('#nw-title', title);
  if (slug != null) await page.fill('#nw-slug', slug);
  if (summary != null) await page.fill('#nw-summary', summary);
  if (body != null) await page.fill('#nw-body', body);
}

test('only admins see Public news; a moderator is sent to the overview', async () => {
  const ctx = await console_({ who: 'mod' });
  const { page, backend } = ctx;
  assert.equal(await page.locator('[data-a="tab"][data-v="news"]').count(), 0, 'not in the navigation');
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'dashboard', '#news falls back to the overview');
  assert.equal(calls(backend, 'news'), 0, 'nothing asked for');
  await done(ctx);
});

test('a new article: inline validation, a derived address, saved as a draft and logged', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await page.waitForSelector('#news-new');
  assert.match(await page.textContent('#main, #admin'), /No news yet/);
  await noAxe(page, 'news list, empty');
  await page.click('#news-new');
  await page.waitForSelector('#news-form');
  assert.equal((await active(page)).id, 'news-edit-title', 'focus on the editor heading');
  // Sending it empty: inline errors, focus on the first, nothing sent.
  await page.click('#news-form button[type="submit"]');
  await page.waitForSelector('#nw-title-err');
  for (const f of ['nw-title', 'nw-summary', 'nw-body']) {
    assert.equal(await page.getAttribute(`#${f}`, 'aria-invalid'), 'true', f);
    assert.match(await page.getAttribute(`#${f}`, 'aria-describedby'), new RegExp(`${f}-err`), f);
  }
  assert.equal((await active(page)).id, 'nw-title');
  assert.equal(calls(backend, 'newsSave'), 0, 'nothing sent');
  await noAxe(page, 'news editor with errors');
  // Typing fixes an error; the address follows the title.
  await fill(page, { title: 'Patch notes 1.2' });
  assert.equal(await page.locator('#nw-title-err').count(), 0, 'the title error clears once valid');
  assert.match(await page.textContent('#nw-slug-hint'), /\/news\/patch-notes-1-2/);
  await fill(page, { summary: 'What changed in this release of the game.', body: 'Fixes and balance.\n\n- Faster bank\n- Fairer duels' });
  await page.click('#news-form button[type="submit"]');
  await page.waitForFunction(() => /Draft\. Not public\./.test(document.getElementById('news-form').textContent));
  await settle(page);
  assert.equal(calls(backend, 'newsSave'), 1);
  assert.equal(backend.news[0].slug, 'patch-notes-1-2');
  assert.equal(backend.news[0].status, 'draft');
  assert.match(await page.evaluate(() => location.hash), /^#news\/\d+$/, 'its own address');
  assert.deepEqual(newsLog(backend), ['news:create']);
  await done(ctx);
});

test('the preview shows paragraphs and bullet points, and escapes everything', async () => {
  const ctx = await console_();
  const { page } = ctx;
  await page.click('#news-new');
  await fill(page, { title: 'Hello <script>alert(1)</script>', summary: 'A "summary" with <b>tags</b> & symbols.', body: 'First <i>para</i>.\n\nSecond para\ncontinues.\n\n- One\n- Two <img src=x>' });
  await page.click('[data-a="newsPreview"]');
  await page.waitForSelector('#news-preview-title');
  assert.equal((await active(page)).id, 'news-preview-title');
  const p = await page.evaluate(() => {
    const a = document.querySelector('.news-article');
    return { title: a.querySelector('h4').textContent, paras: [...a.querySelectorAll('.news-body p')].map((x) => x.textContent), items: [...a.querySelectorAll('.news-body li')].map((x) => x.textContent), tags: a.querySelectorAll('script, b, i, img').length };
  });
  assert.equal(p.title, 'Hello <script>alert(1)</script>');
  assert.deepEqual(p.paras, ['First <i>para</i>.', 'Second para continues.']);
  assert.deepEqual(p.items, ['One', 'Two <img src=x>']);
  assert.equal(p.tags, 0, 'no markup from the text');
  await noAxe(page, 'news preview');
  await done(ctx);
});

test('publish, correct, unpublish and delete: confirmations, rules and the audit log', async () => {
  const ctx = await console_({ news: structuredClone(SEED) });
  const { page, backend } = ctx;
  // A new draft, then publish it (a normal confirmation).
  await page.click('#news-new');
  await fill(page, { title: 'Spring festival', summary: 'A week of festival events in every town.', body: 'Join in.' });
  await page.click('#news-form button[type="submit"]');
  await page.waitForSelector('[data-a="newsPublish"]');
  await page.click('[data-a="newsPublish"]');
  await page.waitForSelector('#confirm[open]');
  assert.match(await page.textContent('#confirm'), /Anyone can read it at \/news\/spring-festival/);
  assert.match(await page.textContent('#confirm'), /address can't change after this/);
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('[data-a="newsUnpublish"]');
  assert.equal(await page.getAttribute('#nw-slug', 'readonly'), '', 'the address is fixed once published');
  assert.match(await page.textContent('#news-form'), /Published/);
  // Unsaved changes block publishing actions until saved.
  await fill(page, { body: 'Join in. Prizes every day.' });
  await page.click('[data-a="newsUnpublish"]');
  await page.waitForSelector('#news-form-error');
  assert.match(await page.textContent('#news-form-error'), /Save your changes first/);
  assert.equal(await page.evaluate(() => document.getElementById('confirm')?.open ?? false), false, 'nothing asked');
  // Saving a correction to a public article marks it as updated.
  await page.click('#news-form button[type="submit"]');
  await page.waitForFunction(() => /updated/.test(document.getElementById('news-form').textContent));
  // Unpublish: a danger confirmation with focus on the safe choice.
  await page.click('[data-a="newsUnpublish"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal((await active(page)).text, 'Keep it published', 'focus on Cancel');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('[data-a="newsPublish"]');
  assert.equal((await page.textContent('[data-a="newsPublish"]')).trim(), 'Publish again');
  // Delete an unpublished article: type its title.
  await page.click('[data-a="newsDelete"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.isDisabled('#confirm [data-r="ok"]'), true, 'type the title first');
  await page.fill('#confirm-input', 'spring festival');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('#news-new');
  assert.equal((await active(page)).id, 'news-new', 'back to the list, focus on New article');
  assert.equal(backend.news.some((n) => n.slug === 'spring-festival'), false);
  assert.deepEqual(newsLog(backend), ['news:create', 'news:publish', 'news:edit', 'news:unpublish', 'news:delete']);
  // A published article from before has no Delete, only Unpublish.
  await page.click('[data-a="newsOpen"][data-v="7"]');
  await page.waitForSelector('[data-a="newsUnpublish"]');
  assert.equal(await page.locator('[data-a="newsDelete"]').count(), 0, 'a published article cannot be deleted');
  await noAxe(page, 'a published article in the editor');
  await done(ctx);
});

test('a draft is deleted with a simpler confirmation; maintenance has a checked window', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await page.click('#news-new');
  await page.selectOption('#nw-kind', 'maintenance');
  await page.waitForSelector('#nw-start');
  await fill(page, { title: 'Server maintenance', summary: 'The realm is closed for two hours.', body: 'Details.' });
  await page.fill('#nw-start', '2030-01-02T10:00');
  await page.fill('#nw-end', '2030-01-02T09:00');
  await page.click('#news-form button[type="submit"]');
  await page.waitForSelector('#nw-end-err');
  assert.match(await page.textContent('#nw-end-err'), /end must be after the start/);
  assert.equal(calls(backend, 'newsSave'), 0);
  await page.fill('#nw-end', '2030-01-02T12:00');
  await page.click('#news-form button[type="submit"]');
  await page.waitForSelector('[data-a="newsDelete"]');
  assert.ok(backend.news[0].maintenance_starts_at, 'the window is saved');
  await page.click('[data-a="newsDelete"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.locator('#confirm-input').count(), 0, 'no typing for a draft');
  assert.equal((await active(page)).text, 'Keep it', 'focus on Cancel');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('#news-new');
  assert.equal(backend.news.length, 0);
  await done(ctx);
});

test('one request at a time: a second press while publishing sends and asks nothing', async () => {
  const ctx = await console_({ news: [{ ...structuredClone(SEED[1]), id: 9, slug: 'held', title: 'Held article', status: 'draft', published_at: null }] });
  const { page, backend } = ctx;
  await page.click('[data-a="newsOpen"][data-v="9"]');
  await page.waitForSelector('[data-a="newsPublish"]');
  const release = backend.hold('newsPublish');
  await page.click('[data-a="newsPublish"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('[data-a="newsPublish"].pending[aria-busy="true"]');
  assert.equal(await page.isDisabled('#nw-title'), true, 'the draft is locked while it sends');
  await page.click('[data-a="newsPublish"]');
  assert.equal(await page.evaluate(() => document.getElementById('confirm').open), false, 'no second question');
  assert.match(await page.textContent('#toast'), /Still working/);
  release();
  await page.waitForSelector('[data-a="newsUnpublish"]');
  assert.equal(calls(backend, 'newsPublish'), 1, 'one request');
  assert.deepEqual(newsLog(backend), ['news:publish'], 'one audit entry');
  await done(ctx);
});

test('a server refusal stays in the form and keeps the draft', async () => {
  const ctx = await console_({ news: structuredClone(SEED) });
  const { page, backend } = ctx;
  await page.click('#news-new');
  await fill(page, { title: 'Winter update', summary: 'An article that reuses a taken address.', body: 'Text.' });
  await page.click('#news-form button[type="submit"]');
  await page.waitForSelector('#news-form-error');
  assert.match(await page.textContent('#news-form-error'), /already used/);
  assert.equal(await page.getAttribute('#news-form-error', 'role'), 'alert');
  assert.equal(await page.inputValue('#nw-summary'), 'An article that reuses a taken address.', 'the draft is kept');
  // Fixing the address saves it.
  await page.fill('#nw-slug', 'winter-update-2');
  await page.click('#news-form button[type="submit"]');
  await page.waitForFunction(() => /Draft\. Not public\./.test(document.getElementById('news-form').textContent));
  assert.equal(backend.news.filter((n) => n.title === 'Winter update').length, 2);
  await done(ctx);
});

test('an article opens from its address, and the list works on a phone', async () => {
  let ctx = await console_({ news: structuredClone(SEED), hash: '#news/8' });
  await ctx.page.waitForSelector('#news-form');
  assert.equal(await ctx.page.inputValue('#nw-title'), 'Old notes');
  await ctx.page.click('[data-a="newsBack"]');
  await ctx.page.waitForSelector('#news-new');
  assert.equal((await active(ctx.page)).text, 'Old notes', 'focus back on the article it came from');
  await done(ctx);

  ctx = await console_({ news: structuredClone(SEED), width: 390, height: 844 });
  await ctx.page.waitForSelector('[data-a="newsOpen"]');
  const scroll = await ctx.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(scroll, false, 'no sideways scrolling');
  await noAxe(ctx.page, 'news list on a phone');
  await ctx.page.click('[data-a="newsOpen"][data-v="7"]');
  await ctx.page.waitForSelector('#news-form');
  await noAxe(ctx.page, 'news editor on a phone');
  await done(ctx);
});

test("the audit log shows news changes readably", async () => {
  const ctx = await console_({ news: structuredClone(SEED) });
  const { page } = ctx;
  await page.click('[data-a="newsOpen"][data-v="8"]');
  await page.waitForSelector('[data-a="newsPublish"]');
  await page.click('[data-a="newsPublish"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('[data-a="newsUnpublish"]');
  await page.click('[data-a="tab"][data-v="log"]');
  await page.waitForSelector('#log-title');
  await page.waitForFunction(() => /news:publish/.test(document.getElementById('admin').textContent));
  const row = await page.evaluate(() => [...document.querySelectorAll('table.data tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.includes('news:publish')));
  assert.match(row, /Old notes/, 'the article title');
  assert.match(row, /\/news\/old-notes, published again/, 'its address and what happened');
  assert.doesNotMatch(row, /[{}"]/, 'no raw JSON');
  await done(ctx);
});

// The fake backend's public read is what L-4 will build on: it must answer like the local API
// (tests/db/news-rest.test.mjs), the same cases.
test('the fake public read answers like the real API', () => {
  const backend = new FakeBackend({ news: [
    ...structuredClone(SEED),
    { ...structuredClone(SEED[0]), id: 10, slug: 'tomorrow', status: 'published', published_at: iso(Date.now() + day) },
    { ...structuredClone(SEED[0]), id: 11, slug: 'a-draft', status: 'draft', published_at: null },
  ] });
  const read = (q) => backend.rest(null, 'news', new URLSearchParams(q), false);
  const cols = 'id,slug,kind,title,summary,body,published_at,revised_at,maintenance_starts_at,maintenance_ends_at';
  const list = read(`select=${cols}&order=published_at.desc`);
  assert.deepEqual(list.map((r) => r.slug), ['winter-update'], 'published and past only');
  assert.deepEqual(Object.keys(list[0]).sort(), cols.split(',').sort());
  for (const slug of ['old-notes', 'tomorrow', 'a-draft']) assert.deepEqual(read(`select=slug&slug=eq.${slug}`), [], slug);
  for (const q of ['select=*', '', 'select=slug,status', 'select=slug,created_by', 'select=slug&status=eq.draft', 'select=slug&order=updated_at.desc']) {
    const r = read(q);
    assert.equal(r.__status, 401, q || '(default select)');
    assert.equal(r.body.code, '42501', q || '(default select)');
  }
});

