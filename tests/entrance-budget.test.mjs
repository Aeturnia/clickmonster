// The entrance's first paint, under MR-B2's performance contract (docs/monstra-regna-scope.md, 4.5,
// D11), which replaced landing LAC-2's hard byte limit (32,000, then 34,000):
//   - a tripwire: at most 48,000 decoded bytes, failing CI;
//   - a review threshold: above 40,000 bytes, the milestone's report must explain the increase.
//     It is reported here, not failed;
//   - the figure is always reported.
// The rest of the contract is in the browser tests: at most 3 requests before the form, no game
// code for an anonymous visitor, and the news after the first paint (tests/ui/homepage.test.mjs,
// tests/ui/entrance.test.mjs). CI scope (docs/ci-scope.md), CI-4.
//   - What counts: the document, plus every stylesheet and script that index.html loads with a
//     <link rel="stylesheet"> or <script src>, read from index.html itself so that a new
//     render-blocking file is counted without editing this test. The icon and the manifest are
//     left out, as LAC-2 leaves them out. Everything else loads after the paint.
//   - Bytes as served: git stores these files with LF line endings and Netlify serves those bytes.
//     A Windows checkout turns LF into CRLF, so CRLF is counted as LF, and the total is the same
//     on Windows and Linux. (31,112 bytes at the L-4 merge, d754dad; 33,987 with password recovery;
//     33,960 after the sign-out fix.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TRIPWIRE = 48000;
const REVIEW = 40000;
const lf = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url)).toString('latin1').replace(/\r\n/g, '\n').length;

export function firstPaintFiles(html) {
  const tags = html.replace(/<!--[\s\S]*?-->/g, '').match(/<(link|script)\b[^>]*>/gi) || [];
  const files = [];
  for (const tag of tags) {
    const attr = (name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];
    if (/^<link/i.test(tag) && /(^|\s)stylesheet(\s|$)/i.test(attr('rel') || '') && attr('href')) files.push(attr('href'));
    if (/^<script/i.test(tag) && attr('src')) files.push(attr('src'));
  }
  return files.map((f) => f.replace(/^\//, ''));
}

test('B2-6 the first paint is at most 48,000 bytes, the tripwire (the document, its stylesheets and scripts, as LF); above 40,000 is reported', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const files = firstPaintFiles(html);
  assert.ok(files.length >= 2, `expected the entry CSS and JS, found ${files.join(', ')}`);
  for (const f of files) assert.doesNotMatch(f, /^(https?:)?\/\//, `${f}: the first paint loads nothing from another host`);
  const sizes = Object.fromEntries([['index.html', lf('index.html')], ...files.map((f) => [f, lf(f)])]);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`first paint: ${total} bytes (${Object.entries(sizes).map(([f, n]) => `${f} ${n}`).join(', ')}); tripwire ${TRIPWIRE}, review above ${REVIEW}${total > REVIEW ? ': OVER THE REVIEW THRESHOLD, explain it in the report' : ''}`);
  assert.ok(total <= TRIPWIRE, `the first paint is ${total} bytes, over the ${TRIPWIRE}-byte tripwire (MR-B2, 4.5)`);
});
