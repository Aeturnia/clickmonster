// Public news pages (landing L-4, docs/landing-scope.md Q1, LAC-16, LAC-16a, LAC-17).
//   /news           the published articles, newest first
//   /news/<slug>    one article, as readable HTML with link-preview metadata
// A Netlify Edge Function: plain JS that Netlify bundles on deploy (no project build step).
// It reads only published articles through Supabase's public REST API with the publishable key,
// so row-level security decides what is visible. The pages carry no script and load no game code.
// Responses are never cached (Cache-Control: no-store), so unpublishing takes effect at once.
//   - Unknown and unpublished addresses get the same 404 (the public role can't tell them apart).
//   - An address that isn't a valid slug gets that 404 without any query.
//   - Supabase down, slow (4 s), refusing or answering nonsense: a 503 page.
// Everything from the database is escaped, in the body and in every attribute. The canonical
// address comes from SITE_ORIGIN, never from the request.
import { SUPABASE_URL, SUPABASE_KEY } from '../../public/js/config.js';
import { SLUG_RE, NEWS_KIND_LABEL, newsBodyHtml } from '../../public/js/data/news.js';
import { SITE_NAME, SITE_ORIGIN } from '../../public/js/site.js';

const COLS = 'slug,kind,title,summary,body,published_at,revised_at,maintenance_starts_at,maintenance_ends_at';
const LIST_COLS = 'slug,kind,title,summary,published_at,revised_at';
export const TIMEOUT_MS = 4000;
const LIST_LIMIT = 100;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (t) => new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const when = (t) => `${new Date(t).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`;
const iso = (t) => new Date(t).toISOString();

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  // No script on these pages, and nothing loads from anywhere else.
  'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

class Unavailable extends Error {}

// One read from the public API. Anything but a clean JSON array of rows is "unavailable".
async function read(query, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/news?${query}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Unavailable(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Unavailable('not a list');
    for (const r of rows) {
      if (!r || typeof r.slug !== 'string' || !SLUG_RE.test(r.slug) || typeof r.title !== 'string' || typeof r.summary !== 'string'
        || typeof r.published_at !== 'string' || Number.isNaN(Date.parse(r.published_at))) throw new Unavailable('unexpected row');
    }
    return rows;
  } catch (err) {
    throw err instanceof Unavailable ? err : new Unavailable(String(err?.message || err));
  } finally {
    clearTimeout(timer);
  }
}

function layout({ title, description, canonical, meta = '', robots = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#16120f">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}${robots ? `<meta name="robots" content="${robots}">\n` : ''}${meta}<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/entry.css">
<link rel="stylesheet" href="/css/news.css">
</head>
<body class="realm">
<div class="n-page">
<header class="n-top">
<a class="n-brand" href="/">${esc(SITE_NAME)}</a>
<nav class="n-nav" aria-label="News"><a href="/news">All news</a><a href="/">Enter the realm</a></nav>
</header>
<main class="n-main">
${body}
</main>
</div>
</body>
</html>
`;
}

function html(status, page, method) {
  return new Response(method === 'HEAD' ? null : page, { status, headers: HEADERS });
}

function notFound(method) {
  return html(404, layout({
    title: `Not available · ${SITE_NAME}`, robots: 'noindex',
    body: `<section class="n-message" aria-labelledby="n-h">
<h1 id="n-h">This update isn't available</h1>
<p>It may have been taken down, or the address may be wrong.</p>
<p class="n-links"><a href="/news">All news</a><a href="/">Enter the realm</a></p>
</section>`,
  }), method);
}

function unavailable(method) {
  return html(503, layout({
    title: `News unavailable · ${SITE_NAME}`, robots: 'noindex',
    body: `<section class="n-message" aria-labelledby="n-h">
<h1 id="n-h">News is unavailable right now</h1>
<p>Please try again in a little while. The game itself may still be running.</p>
<p class="n-links"><a href="/">Enter the realm</a></p>
</section>`,
  }), method);
}

function article(a, method) {
  const canonical = `${SITE_ORIGIN}/news/${a.slug}`;
  const kind = NEWS_KIND_LABEL[a.kind] || 'News';
  const meta = [
    ['og:type', 'article'], ['og:site_name', SITE_NAME], ['og:title', a.title], ['og:description', a.summary], ['og:url', canonical],
    ['article:published_time', iso(a.published_at)], ...(a.revised_at ? [['article:modified_time', iso(a.revised_at)]] : []),
  ].map(([p, c]) => `<meta property="${p}" content="${esc(c)}">\n`).join('')
    + [['twitter:card', 'summary'], ['twitter:title', a.title], ['twitter:description', a.summary]]
      .map(([n, c]) => `<meta name="${n}" content="${esc(c)}">\n`).join('');
  const window_ = a.kind === 'maintenance' && (a.maintenance_starts_at || a.maintenance_ends_at)
    ? `<p class="n-window"><b>Maintenance:</b> ${a.maintenance_starts_at ? `from ${esc(when(a.maintenance_starts_at))}` : ''}${a.maintenance_starts_at && a.maintenance_ends_at ? ' ' : ''}${a.maintenance_ends_at ? `until ${esc(when(a.maintenance_ends_at))}` : ''}.</p>`
    : '';
  return html(200, layout({
    title: `${a.title} · ${SITE_NAME}`, description: a.summary, canonical, meta,
    body: `<article class="n-article" aria-labelledby="n-h">
<p class="n-kind">${esc(kind)}</p>
<h1 id="n-h">${esc(a.title)}</h1>
<p class="n-dates"><time datetime="${esc(iso(a.published_at))}">${esc(day(a.published_at))}</time>${a.revised_at ? ` <span class="n-revised">(updated <time datetime="${esc(iso(a.revised_at))}">${esc(day(a.revised_at))}</time>)</span>` : ''}</p>
<p class="n-summary">${esc(a.summary)}</p>
${window_}
<div class="n-body">
${newsBodyHtml(a.body || '', esc)}
</div>
</article>`,
  }), method);
}

function list(rows, method) {
  const items = rows.map((a) => `<li class="n-item">
<p class="n-kind">${esc(NEWS_KIND_LABEL[a.kind] || 'News')} · <time datetime="${esc(iso(a.published_at))}">${esc(day(a.published_at))}</time></p>
<h2><a href="/news/${esc(a.slug)}">${esc(a.title)}</a></h2>
<p>${esc(a.summary)}</p>
</li>`).join('\n');
  return html(200, layout({
    title: `News · ${SITE_NAME}`, description: `Development updates, patch notes, releases and maintenance for ${SITE_NAME}.`,
    canonical: `${SITE_ORIGIN}/news`,
    meta: [['og:type', 'website'], ['og:site_name', SITE_NAME], ['og:title', `News · ${SITE_NAME}`], ['og:url', `${SITE_ORIGIN}/news`]]
      .map(([p, c]) => `<meta property="${p}" content="${esc(c)}">\n`).join(''),
    body: `<section aria-labelledby="n-h">
<h1 id="n-h">News</h1>
${rows.length ? `<ul class="n-list">\n${items}\n</ul>` : '<p class="n-empty">No news yet.</p>'}
</section>`,
  }), method);
}

// The whole request, with the network passed in so tests can replace it.
export async function newsResponse(request, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  try {
    if (path === '/news') return list(await read(`select=${LIST_COLS}&order=published_at.desc&limit=${LIST_LIMIT}`, fetchImpl, timeoutMs), method);
    const m = path.match(/^\/news\/([^/]+)$/);
    const slug = m?.[1];
    if (!slug || !SLUG_RE.test(slug) || slug.length < 3 || slug.length > 80) return notFound(method);
    const rows = await read(`select=${COLS}&slug=eq.${slug}&limit=1`, fetchImpl, timeoutMs);
    return rows.length ? article(rows[0], method) : notFound(method);
  } catch (err) {
    if (err instanceof Unavailable) return unavailable(method);
    throw err;
  }
}

export default (request) => newsResponse(request);
export const config = { path: ['/news', '/news/*'] };
