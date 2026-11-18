// The entrance's startup budget (landing LAC-2): the first paint loads at most 34,000 decoded bytes.
// Revised from 32,000 by the owner on 2026-11-17 for the password-recovery guard, which has to be in
// the first paint (docs/password-recovery-scope.md). CI scope (docs/ci-scope.md), CI-4.
//   - What counts: the document, plus every stylesheet and script that index.html loads with a
//     <link rel="stylesheet"> or <script src>, read from index.html itself so that a new
//     render-blocking file is counted without editing this test. The icon and the manifest are
//     left out, as LAC-2 leaves them out. Everything else loads after the paint.
//   - Bytes as served: git stores these files with LF line endings and Netlify serves those bytes.
//     A Windows checkout turns LF into CRLF, so CRLF is counted as LF, and the total is the same
//     on Windows and Linux. (31,112 bytes at the L-4 merge, d754dad; 33,987 with password recovery.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BUDGET = 34000;
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

test('LAC-2 the first paint is at most 34,000 bytes (the document, its stylesheets and scripts, as LF)', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const files = firstPaintFiles(html);
  assert.ok(files.length >= 2, `expected the entry CSS and JS, found ${files.join(', ')}`);
  for (const f of files) assert.doesNotMatch(f, /^(https?:)?\/\//, `${f}: the first paint loads nothing from another host`);
  const sizes = Object.fromEntries([['index.html', lf('index.html')], ...files.map((f) => [f, lf(f)])]);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`first paint: ${total} bytes (${Object.entries(sizes).map(([f, n]) => `${f} ${n}`).join(', ')}); budget ${BUDGET}`);
  assert.ok(total <= BUDGET, `the first paint is ${total} bytes, over the ${BUDGET}-byte budget (LAC-2)`);
});
