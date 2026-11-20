// MR-B2 (docs/monstra-regna-scope.md, 4.2 to 4.4): the public pages' menu and footer, the static
// pages and their headers, checked from the files. The browser side is tests/ui/homepage.test.mjs.
//   - index.html and every static page carry exactly site.js's menu (with aria-current on their
//     own page) and footer; the news pages draw them from site.js.
//   - The static pages load no script and nothing from another host.
//   - netlify.toml serves each at /<name> with a 200 rewrite to public/<name>.html, with the news
//     pages' no-script policy, and has no rule for /<name>/, which answers one 301 to /<name> from
//     Netlify itself (report sections 7.5 and 7.6).
//   - No public page is a directory index (the routing correction, report section 7).
//   - No dead links: every menu and footer link is a page that exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MENU, CONTACT_EMAIL, COPYRIGHT_HTML, menuHtml, footerHtml } from '../public/js/site.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const STATIC = [['/guide', 'public/guide.html'], ['/leaderboard', 'public/leaderboard.html'], ['/contact', 'public/contact.html']];
const NEWS_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const rewrite = (from, to) => `[[redirects]]\n  from = "${from}"\n  to = "${to}"\n  status = 200\n`;

test('B2-3 / B2-4 the entrance and every static page carry exactly the site menu and footer', () => {
  const pages = [['/', 'public/index.html'], ...STATIC];
  for (const [path, file] of pages) {
    const html = read(file);
    assert.ok(html.includes(menuHtml(path)), `${file}: the site menu, with aria-current on ${path}`);
    assert.ok(html.includes(footerHtml()), `${file}: the site footer`);
    assert.equal(html.match(/aria-current="page"/g)?.length, 1, `${file}: one current page`);
  }
});

test('B2-3 / B2-4 the news pages draw the menu and footer from site.js', () => {
  const src = read('netlify/edge-functions/news.js');
  assert.match(src, /\$\{menuHtml\(null\)\}/);
  assert.match(src, /\$\{footerHtml\(\)\}/);
});

test('B2-3 / B2-4 no dead links: the menu and footer link only to pages that exist; no Discord, Privacy or Terms yet', () => {
  const pages = Object.fromEntries([['/', 'public/index.html'], ...STATIC]);
  const links = [...MENU.map(([, href]) => href), ...[...footerHtml().matchAll(/href="([^"]+)"/g)].map((m) => m[1])];
  for (const href of links) assert.ok(pages[href] && fs.existsSync(new URL(`../${pages[href]}`, import.meta.url)), `${href} is a page`);
  const all = menuHtml('/') + footerHtml();
  assert.doesNotMatch(all, /discord|privacy|terms/i, 'not until they exist (D7, D9)');
  assert.ok(footerHtml().includes(COPYRIGHT_HTML));
  assert.match(COPYRIGHT_HTML, /^&copy; 2026 Aeturnis Development Labs, LLC$/);
});

test('B2-5 the static pages: plain HTML, no script, only the site stylesheets, slashless canonical addresses, the contact address', () => {
  for (const [path, file] of STATIC) {
    const html = read(file);
    assert.doesNotMatch(html, /<script/i, `${file}: no script`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${file}: no inline handlers`);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ['/css/entry.css', '/css/news.css'], `${file}: the site stylesheets only`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\/(?!monstraregna\.com)/, `${file}: nothing from another host`);
    assert.ok(html.includes(`<link rel="canonical" href="https://monstraregna.com${path}">`), `${file}: canonical ${path}, with no trailing slash`);
  }
  assert.ok(read('public/contact.html').includes(`href="mailto:${CONTACT_EMAIL}"`), 'the contact page gives the address (D8)');
});

// The slash forms have no rule: Netlify answers /<name>/ with a 301 to /<name> before any rewrite
// applies, so one would never be reached (report sections 7.5 and 7.6).
test('B2-5 netlify.toml serves each static page at its canonical address by a 200 rewrite, with the no-script policy, and has no rule for its slash form', () => {
  const toml = read('netlify.toml');
  for (const [path] of STATIC) {
    assert.ok(toml.includes(rewrite(path, `${path}.html`)), `${path}: rewritten to ${path}.html, not redirected`);
    assert.ok(!toml.includes(`from = "${path}/"`), `${path}/: no rule (Netlify redirects it first)`);
    assert.ok(toml.includes(`for = "${path}*"\n  [headers.values]\n    Content-Security-Policy = "${NEWS_CSP}"`), `${path}: the news pages' policy`);
  }
});

// The routing correction (docs/monstra-regna-b2-report.md, section 7): Netlify answers a directory's
// address without its trailing slash with a 301, before any rewrite. So no public page may be a
// directory with an index.html; each is a single file, served by a 200 rewrite. This also covers the
// pages still to come (Privacy, Terms).
test('B2-5 no public page is a directory index: each is a single file with a 200 rewrite', () => {
  const pub = new URL('../public/', import.meta.url);
  const dirs = fs.readdirSync(pub, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const indexed = dirs.filter((d) => fs.existsSync(new URL(`${d}/index.html`, pub)));
  assert.deepEqual(indexed, [], 'directories with an index.html would be redirected to their slash form');
  const toml = read('netlify.toml');
  for (const [, href] of MENU.filter(([, h]) => h !== '/')) {
    assert.ok(fs.existsSync(new URL(`${href.slice(1)}.html`, pub)), `${href}: public${href}.html`);
    assert.ok(toml.includes(rewrite(href, `${href}.html`)), `${href}: a 200 rewrite to its file`);
  }
});
