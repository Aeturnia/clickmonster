// The public news pages' handler (netlify/edge-functions/news.js, landing L-4: LAC-16, LAC-16a,
// LAC-17), run in Node with the network replaced, so nothing reaches Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsResponse } from '../netlify/edge-functions/news.js';
import { SITE_ORIGIN } from '../public/js/site.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../public/js/config.js';

const ARTICLE = {
  slug: 'patch-notes-1-2', kind: 'patch', title: 'Patch notes 1.2', summary: 'What changed in this release of the game.',
  body: 'Fixes and balance.\n\n- Faster bank\n- Fairer duels', published_at: '2026-11-10T09:00:00.000Z', revised_at: '2026-11-12T10:00:00.000Z',
  maintenance_starts_at: null, maintenance_ends_at: null,
};
// A fake public API: answers with the given rows, and records what was asked.
function api(rows, { status = 200, raw } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(raw ?? JSON.stringify(typeof rows === 'function' ? rows(new URL(url)) : rows), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
const get = (path, opts, init = {}) => newsResponse(new Request(`https://evil.example${path}`, init), opts);
const page = async (res) => ({ status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() });
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];

test('an article: 200 HTML with its metadata, readable without script, never cached', async () => {
  const { fetchImpl, calls } = api([ARTICLE]);
  const p = await page(await get('/news/patch-notes-1-2', { fetchImpl }));
  assert.equal(p.status, 200);
  assert.equal(p.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(p.headers['cache-control'], 'no-store');
  assert.match(p.headers['content-security-policy'], /default-src 'none'/);
  assert.match(p.text, /<title>Patch notes 1\.2 · ClickMonster<\/title>/);
  assert.equal(meta(p.text, 'name', 'description'), ARTICLE.summary);
  assert.match(p.text, new RegExp(`<link rel="canonical" href="${SITE_ORIGIN}/news/patch-notes-1-2">`));
  assert.equal(meta(p.text, 'property', 'og:type'), 'article');
  assert.equal(meta(p.text, 'property', 'og:title'), ARTICLE.title);
  assert.equal(meta(p.text, 'property', 'og:description'), ARTICLE.summary);
  assert.equal(meta(p.text, 'property', 'og:url'), `${SITE_ORIGIN}/news/patch-notes-1-2`);
  assert.equal(meta(p.text, 'property', 'og:site_name'), 'ClickMonster');
  assert.equal(meta(p.text, 'property', 'article:published_time'), ARTICLE.published_at);
  assert.equal(meta(p.text, 'property', 'article:modified_time'), ARTICLE.revised_at);
  assert.equal(meta(p.text, 'name', 'twitter:card'), 'summary');
  assert.match(p.text, /<p>Fixes and balance\.<\/p>\n<ul><li>Faster bank<\/li><li>Fairer duels<\/li><\/ul>/);
  assert.match(p.text, /10 November 2026<\/time> <span class="n-revised">\(updated <time datetime="2026-11-12T10:00:00.000Z">12 November 2026/);
  assert.doesNotMatch(p.text, /<script/i, 'no script at all');
  assert.doesNotMatch(p.text, /\/js\//, 'no game code');
  // One read, of the article columns only, with the publishable key.
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, `${SUPABASE_URL}/rest/v1/news`);
  assert.equal(u.searchParams.get('slug'), 'eq.patch-notes-1-2');
  assert.deepEqual(u.searchParams.get('select').split(',').sort(), ['body', 'kind', 'maintenance_ends_at', 'maintenance_starts_at', 'published_at', 'revised_at', 'slug', 'summary', 'title']);
  assert.equal(calls[0].init.headers.apikey, SUPABASE_KEY);
  assert.ok(calls[0].init.signal, 'with a timeout');
});

test('everything from the database is escaped, in the body and in every attribute', async () => {
  const evil = '"><script>alert(1)</script></title>\'&<b>';
  const { fetchImpl } = api([{ ...ARTICLE, title: `T ${evil}`, summary: `S ${evil} and more text`, body: `B ${evil}\n\n- I ${evil}`, kind: 'maintenance', maintenance_starts_at: '2026-11-20T10:00:00Z', maintenance_ends_at: '2026-11-20T12:00:00Z' }]);
  const p = await page(await get('/news/patch-notes-1-2', { fetchImpl }));
  assert.equal(p.status, 200);
  assert.doesNotMatch(p.text, /<script/i);
  assert.equal(p.text.match(/<b>/g).length, 1, 'no markup from the text: the only <b> is the page own Maintenance label');
  const enc = '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/title&gt;&#39;&amp;&lt;b&gt;';
  assert.ok(p.text.includes(`<title>T ${enc} · ClickMonster</title>`), 'title');
  for (const [attr, name, prefix] of [['name', 'description', 'S'], ['property', 'og:title', 'T'], ['property', 'og:description', 'S'], ['name', 'twitter:title', 'T'], ['name', 'twitter:description', 'S']]) {
    assert.ok(p.text.includes(`<meta ${attr}="${name}" content="${prefix} ${enc}`), `${name} attribute escaped`);
  }
  assert.ok(p.text.includes(`<p>B ${enc}</p>`), 'body paragraph');
  assert.ok(p.text.includes(`<li>I ${enc}</li>`), 'body list');
  assert.match(p.text, /<b>Maintenance:<\/b> from 20 November 2026 at 10:00 UTC until 20 November 2026 at 12:00 UTC\./);
});

test('the canonical address comes from SITE_ORIGIN, never from the request', async () => {
  const { fetchImpl } = api([ARTICLE]);
  const res = await newsResponse(new Request('https://attacker.example/news/patch-notes-1-2', { headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example', forwarded: 'host=attacker.example' } }), { fetchImpl });
  const text = await res.text();
  assert.doesNotMatch(text, /attacker/);
  assert.equal(meta(text, 'property', 'og:url'), `${SITE_ORIGIN}/news/patch-notes-1-2`);
  assert.equal(SITE_ORIGIN, 'https://clickmonsters.netlify.app');
});

test('addresses that are not valid slugs get the 404 page without any query', async () => {
  for (const path of ['/news/Bad_Slug', '/news/ab', '/news/a--b', '/news/x%20y', '/news/a/b', '/news/..%2Fadmin', `/news/${'a'.repeat(81)}`, '/news/abc?slug=eq.draft']) {
    const { fetchImpl, calls } = api([ARTICLE]);
    const p = await page(await get(path, { fetchImpl }));
    if (path.startsWith('/news/abc?')) { assert.equal(p.status, 200, 'a query string is ignored; the slug is abc'); continue; }
    assert.equal(p.status, 404, path);
    assert.equal(calls.length, 0, `${path}: nothing asked`);
    assert.match(p.text, /This update isn't available/);
    assert.equal(p.headers['cache-control'], 'no-store');
    assert.match(p.text, /<meta name="robots" content="noindex">/);
  }
});

test('unknown and unpublished addresses get the same 404 (the public API returns nothing for both)', async () => {
  const { fetchImpl } = api([]);
  const p = await page(await get('/news/was-unpublished', { fetchImpl }));
  assert.equal(p.status, 404);
  assert.match(p.text, /This update isn't available/);
  assert.match(p.text, /<a href="\/news">All news<\/a><a href="\/">Enter the realm<\/a>/);
});

test('the news list: newest first, linked, and an empty state', async () => {
  const rows = [ARTICLE, { ...ARTICLE, slug: 'older-one', title: 'Older one', published_at: '2026-11-01T00:00:00Z' }];
  const { fetchImpl, calls } = api(rows);
  const p = await page(await get('/news', { fetchImpl }));
  assert.equal(p.status, 200);
  assert.match(p.text, new RegExp(`<link rel="canonical" href="${SITE_ORIGIN}/news">`));
  assert.ok(p.text.indexOf('/news/patch-notes-1-2') < p.text.indexOf('/news/older-one'));
  assert.equal(new URL(calls[0].url).searchParams.get('order'), 'published_at.desc');
  assert.doesNotMatch(new URL(calls[0].url).searchParams.get('select'), /body/, 'the list does not fetch bodies');
  const empty = await page(await get('/news/', api([])));
  assert.equal(empty.status, 200);
  assert.match(empty.text, /No news yet\./);
});

test('Supabase failing in any way gives the 503 page', async () => {
  const cases = [
    ['refused connection', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }],
    ['HTTP 500', api([], { status: 500 })],
    ['HTTP 401 (a permission problem)', api({ code: '42501' }, { status: 401 })],
    ['not JSON', api(null, { raw: '<html>gateway</html>' })],
    ['not a list', api({ rows: [] })],
    ['a malformed row', api([{ slug: 'Not A Slug', title: 1 }])],
    ['too slow', { fetchImpl: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), timeoutMs: 30 }],
  ];
  for (const [label, opts] of cases) {
    for (const path of ['/news/patch-notes-1-2', '/news']) {
      const p = await page(await get(path, opts));
      assert.equal(p.status, 503, `${label} ${path}`);
      assert.match(p.text, /News is unavailable right now/, label);
      assert.equal(p.headers['cache-control'], 'no-store');
      assert.equal(p.headers['content-type'], 'text/html; charset=utf-8');
    }
  }
});

test('HEAD is answered without a body; other methods are refused', async () => {
  const head = await get('/news/patch-notes-1-2', api([ARTICLE]), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await get('/news/patch-notes-1-2', api([ARTICLE]), { method: 'POST', body: 'x' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
