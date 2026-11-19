// MR-B2 (docs/monstra-regna-scope.md, 4.2 to 4.4): the public pages' menu and footer, the static
// pages and their headers, checked from the files. The browser side is tests/ui/homepage.test.mjs.
//   - index.html and every static page carry exactly site.js's menu (with aria-current on their
//     own page) and footer; the news pages draw them from site.js.
//   - The static pages load no script and nothing from another host.
//   - netlify.toml serves each at /<name> with the news pages' no-script policy.
//   - No dead links: every menu and footer link is a page that exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MENU, CONTACT_EMAIL, COPYRIGHT_HTML, menuHtml, footerHtml } from '../public/js/site.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const STATIC = [['/guide', 'public/guide/index.html'], ['/leaderboard', 'public/leaderboard/index.html'], ['/contact', 'public/contact/index.html']];
const NEWS_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
  const pages = { '/': 'public/index.html', '/guide': 'public/guide/index.html', '/leaderboard': 'public/leaderboard/index.html', '/contact': 'public/contact/index.html' };
  const links = [...MENU.map(([, href]) => href), ...[...footerHtml().matchAll(/href="([^"]+)"/g)].map((m) => m[1])];
  for (const href of links) assert.ok(pages[href] && fs.existsSync(new URL(`../${pages[href]}`, import.meta.url)), `${href} is a page`);
  const all = menuHtml('/') + footerHtml();
  assert.doesNotMatch(all, /discord|privacy|terms/i, 'not until they exist (D7, D9)');
  assert.match(footerHtml(), new RegExp(COPYRIGHT_HTML.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(COPYRIGHT_HTML, /^&copy; 2026 Aeturnis Development Labs, LLC$/);
});

test('B2-5 the static pages: plain HTML, no script, only the site stylesheets, the contact address', () => {
  for (const [path, file] of STATIC) {
    const html = read(file);
    assert.doesNotMatch(html, /<script/i, `${file}: no script`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${file}: no inline handlers`);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ['/css/entry.css', '/css/news.css'], `${file}: the site stylesheets only`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\/(?!monstraregna\.com)/, `${file}: nothing from another host`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://monstraregna.com${path}">`));
  }
  assert.ok(read('public/contact/index.html').includes(`href="mailto:${CONTACT_EMAIL}"`), 'the contact page gives the address (D8)');
});

test('B2-5 netlify.toml serves each static page at its address, with the no-script policy', () => {
  const toml = read('netlify.toml');
  for (const [path] of STATIC) {
    assert.match(toml, new RegExp(`from = "${path}"\\n  to = "${path}/index.html"\\n  status = 200`), `${path}: rewritten, not redirected`);
    assert.ok(toml.includes(`for = "${path}*"\n  [headers.values]\n    Content-Security-Policy = "${NEWS_CSP}"`), `${path}: the news pages' policy`);
  }
});
