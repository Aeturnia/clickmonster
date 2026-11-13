// Landing L-1 file checks (docs/landing-scope.md): the vendored supabase-js is byte-identical to
// what public/vendor/README.md records, its licence is kept, nothing on the entry path names a
// third-party host, the entrance's CSS never reads the gameplay layout, and its colour tokens
// stay in step with the game's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const text = (p) => read(p).toString('utf8');

test('vendored supabase-js matches the hashes in public/vendor/README.md', () => {
  const readme = text('public/vendor/README.md');
  const rows = [...readme.matchAll(/^\| `(supabase-js@[^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.deepEqual(rows.map((r) => r[1]).sort(), ['supabase-js@2.45.4/591.supabase.js', 'supabase-js@2.45.4/LICENSE', 'supabase-js@2.45.4/supabase.js']);
  for (const [, file, hash] of rows) {
    assert.equal(crypto.createHash('sha256').update(read(`public/vendor/${file}`)).digest('hex'), hash, file);
  }
  assert.match(text('public/vendor/supabase-js@2.45.4/LICENSE'), /^MIT License/);
});

test('the vendored build loads only its own chunk, from beside itself', () => {
  const lib = text('public/vendor/supabase-js@2.45.4/supabase.js');
  assert.equal(lib.includes('import('), false, 'no dynamic imports');
  assert.deepEqual([...new Set(lib.match(/\.e\(\d+\)/g))], ['.e(591)'], 'one lazily loaded chunk, which is vendored');
  const urls = [...new Set(lib.match(/https?:\/\/[^"'\s)]+/g))].sort();
  assert.deepEqual(urls, ['http://localhost:9999', 'https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request'], 'only an unused default and a documentation link');
});

test('the entry path names no third-party host', () => {
  for (const f of ['public/index.html', 'public/admin.html', 'public/js/entry.js', 'public/js/net.js', 'public/js/main.js', 'public/js/admin.js', 'public/css/entry.css']) {
    const hosts = [...text(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/supabase\.co$/.test(h) && h !== 'www.w3.org');
    assert.deepEqual(hosts, [], f);
  }
  assert.match(text('public/js/net.js'), /\.\.\/vendor\/supabase-js@2\.45\.4\/supabase\.js/);
  assert.match(text('netlify.toml'), /for = "\/vendor\/\*"[\s\S]*?immutable/);
  assert.match(text('.gitattributes'), /^public\/vendor\/\*\* -text$/m);
});

test("the entrance's CSS never reads the gameplay layout, and shares the game's colours", () => {
  const entry = text('public/css/entry.css');
  const rules = entry.replace(/\/\*[\s\S]*?\*\//g, ''); // comments may mention it
  assert.equal(/data-layout|data-chat/.test(rules), false, 'no data-layout or data-chat selectors');
  const tokens = (css) => Object.fromEntries([...css.slice(0, css.indexOf('}')).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const game = tokens(text('public/css/style.css'));
  for (const [name, value] of Object.entries(tokens(entry))) assert.equal(value, game[name], `${name} matches style.css`);
});

test("the entrance's Desktop note uses the same rule as layout.js (landing L-2)", () => {
  const layout = text('public/js/layout.js');
  const entry = text('public/js/entry.js');
  const num = (src, re) => Number(src.match(re)?.[1]);
  assert.equal(num(layout, /const DESKTOP_WIDTH = '\(min-width: (\d+)em\)'/), 75);
  assert.equal(num(entry, /const DESKTOP_MIN_EM = (\d+);/), num(layout, /const DESKTOP_WIDTH = '\(min-width: (\d+)em\)'/), 'em width');
  assert.equal(num(entry, /const DESKTOP_MIN_REM = (\d+);/), num(layout, /const DESKTOP_MIN_REM = (\d+);/), 'usable width in rem');
  assert.match(layout, /export const LAYOUT_CHOICES = \['auto', 'desktop', 'mobile'\];/);
  assert.match(entry, /const CHOICES = \['auto', 'desktop', 'mobile'\];/);
});

