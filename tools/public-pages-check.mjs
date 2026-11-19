// Read-only check of the live public pages (MR-B2; docs/monstra-regna-b2-report.md, sections 7 and 7.5).
//   node tools/public-pages-check.mjs [base]          (default https://monstraregna.com)
// For each page it reads the FIRST response, never following a redirect by itself (that is what found
// the /guide -> /guide/ redirects after MR-B2's first deployment), and reports: the status, the
// Location if any, whether the news pages' no-script policy is sent, the canonical address, the
// site menu (and which item is current) and the footer. GET requests only; nothing is changed.
// The contract (owner's decision, 2026-11-19): /guide, /leaderboard and /contact answer 200 directly.
// Their slash forms answer exactly one 301 to that canonical address; the checker then reads that
// address, once, and it must answer 200 with the same checks. Any other redirect is a problem.
// Exits 1 if any page is not as expected.
import { menuHtml, footerHtml } from '../public/js/site.js';

const BASE = (process.argv[2] || 'https://monstraregna.com').replace(/\/$/, '');
const NEWS_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const CANON = 'https://monstraregna.com';

async function first(path) {
  const r = await fetch(BASE + path, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
  return { status: r.status, location: r.headers.get('location'), csp: r.headers.get('content-security-policy'), html: r.status === 200 ? await r.text() : '' };
}
const canonical = (html) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1] ?? null;

const problems = [];
const report = (path, r, want) => {
  const got = {
    status: r.status, location: r.location,
    csp: r.csp === NEWS_CSP ? 'no-script policy' : r.csp ? 'other' : 'none',
    canonical: canonical(r.html),
    menu: r.html.includes(menuHtml(want.current)), footer: r.html.includes(footerHtml()),
  };
  for (const [k, v] of Object.entries(want.expect)) if (got[k] !== v) problems.push(`${path}: ${k} is ${JSON.stringify(got[k])}, expected ${JSON.stringify(v)}`);
  console.log(path.padEnd(28), JSON.stringify(got));
};
// The location as a path on this site (Netlify sends a relative one; an absolute one must be this host).
const pathOf = (loc) => { try { const u = new URL(loc, BASE + '/'); return u.origin === new URL(BASE).origin ? u.pathname + u.search : null; } catch { return null; } };

report('/', await first('/'), { current: '/', expect: { status: 200, menu: true, footer: true } });
for (const p of ['/guide', '/leaderboard', '/contact']) {
  const page = { status: 200, location: null, csp: 'no-script policy', canonical: CANON + p, menu: true, footer: true };
  report(p, await first(p), { current: p, expect: page });
  const slash = await first(`${p}/`);
  if (slash.status !== 301 || pathOf(slash.location) !== p) {
    problems.push(`${p}/: expected one 301 to ${p}, got ${slash.status}${slash.location ? ` to ${slash.location}` : ''}`);
    console.log(`${p}/`.padEnd(28), JSON.stringify({ status: slash.status, location: slash.location }));
    continue;
  }
  console.log(`${p}/`.padEnd(28), JSON.stringify({ status: slash.status, location: slash.location }));
  report(`${p}/ -> ${p}`, await first(pathOf(slash.location)), { current: p, expect: page });
}
const list = await first('/news');
report('/news', list, { current: null, expect: { status: 200, csp: 'no-script policy', canonical: `${CANON}/news`, menu: true, footer: true } });
const slug = list.html.match(/href="\/news\/([a-z0-9-]+)"/)?.[1];
if (slug) report(`/news/${slug}`, await first(`/news/${slug}`), { current: null, expect: { status: 200, csp: 'no-script policy', menu: true, footer: true } });
else console.log('(no published article to check)');

if (problems.length) { console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('\nAll public pages as expected.');
