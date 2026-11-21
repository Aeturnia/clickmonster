// MR-B1 identity checks (docs/monstra-regna-scope.md, section 3):
//   B1-1: no "ClickMonster" is left in anything players see; the remaining uses are technical
//         identifiers only, and they are listed here.
//   B1-3: the storage keys are unchanged (D2), so a player signed in on an address stays signed in
//         there after the rename.
// B1-2 (the canonical address on the news pages) is checked in tests/news-pages.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Everything that reaches players: the published site (except the vendored library, which is
// Supabase's own code), the news pages' edge function, and the email templates.
const SHIPPED = ['public', 'netlify', 'supabase/templates'];
const SKIP = [path.join('public', 'vendor')];
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.md', '.xml', '.toml']);

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (SKIP.some((s) => rel === s || rel.startsWith(s + path.sep))) continue;
    if (e.isDirectory()) out.push(...files(rel));
    else if (TEXT_EXT.has(path.extname(e.name))) out.push(rel);
  }
  return out;
}

// The technical identifiers that keep the old name (D2: changing them would sign everyone out,
// or break the test hook). Nothing else may.
const ALLOWED = [
  /clickmonster\.(auth|prefs|recovery|seenAnnouncement|note|renew)\b/g, // browser storage keys, and the renewal lock (note and renew: the sign-out fix, docs/sign-out-report.md)
  /window\.clickmonster\b/g, // the read-only hook the browser tests use
];
// Allowed in one file only. The old Netlify host name is a routing identifier, never shown to
// players: the news edge function redirects requests that arrive on that host to the canonical
// domain (MR-B1 step 5, B1-4b; docs/monstra-regna-b1-report.md). Anywhere else, and any other
// spelling, still fails.
const ALLOWED_IN = {
  [path.join('netlify', 'edge-functions', 'news.js')]: [/(?<![\w.-])clickmonsters\.netlify\.app(?![\w.-])/g],
};

test('B1-1 no old name in anything players see; only the listed technical identifiers remain', () => {
  const found = [];
  const technical = new Set();
  for (const f of SHIPPED.flatMap(files)) {
    let s = text(f);
    for (const re of [...ALLOWED, ...(ALLOWED_IN[f] || [])]) s = s.replace(re, (m) => { technical.add(m); return ''; });
    for (const m of s.matchAll(/click[\s_-]*monsters?/gi)) found.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(found, [], 'old name outside the technical identifiers');
  // The list in the MR-B1 report; a new technical use has to be added here deliberately.
  assert.deepEqual([...technical].sort(), [
    'clickmonster.auth', 'clickmonster.note', 'clickmonster.prefs', 'clickmonster.recovery', 'clickmonster.renew', 'clickmonster.seenAnnouncement', 'clickmonsters.netlify.app', 'window.clickmonster',
  ]);
});

test('B1-1 the old Netlify host appears once, as the news function\'s redirect constant, and in nothing players see', () => {
  const news = text('netlify/edge-functions/news.js');
  assert.equal(news.match(/clickmonsters\.netlify\.app/g)?.length, 1, 'once only');
  assert.match(news, /^export const LEGACY_HOST = 'clickmonsters\.netlify\.app';$/m);
  // Not in any page or template a player reads.
  for (const f of SHIPPED.flatMap(files).filter((f) => f !== path.join('netlify', 'edge-functions', 'news.js'))) {
    assert.doesNotMatch(text(f), /clickmonsters\.netlify\.app/i, f);
  }
});

test('B1-1 the new name is where players see a name', () => {
  assert.match(text('public/index.html'), /<title>Monstra Regna<\/title>/);
  assert.match(text('public/index.html'), /<h1 class="e-title">Monstra Regna<\/h1>/);
  assert.match(text('public/admin.html'), /<title>Monstra Regna Admin<\/title>/);
  const manifest = JSON.parse(text('public/manifest.webmanifest'));
  assert.equal(manifest.name, 'Monstra Regna');
  assert.equal(manifest.short_name, 'Monstra Regna', 'QB-1: the full name, truncation accepted');
  assert.match(text('public/js/site.js'), /export const SITE_NAME = 'Monstra Regna';/);
  assert.equal(text('public/js/main.js').match(/<h1>Monstra Regna<\/h1>/g)?.length, 2, 'the intro and character creation');
  assert.equal(text('public/js/admin.js').match(/Monstra Regna Admin/g)?.length, 4, 'the console headings');
});

test('B1-3 the browser storage keys are unchanged', () => {
  const key = (file, re) => (text(file).match(re) || [])[1];
  assert.equal(key('public/js/net.js', /export const AUTH_STORAGE_KEY = '([^']+)'/), 'clickmonster.auth');
  assert.equal(key('public/js/entry.js', /const AUTH_KEY = '([^']+)'/), 'clickmonster.auth');
  assert.equal(key('public/js/entry.js', /const RECOVERY_KEY = '([^']+)'/), 'clickmonster.recovery');
  assert.equal(key('public/js/entry.js', /const PREFS_KEY = '([^']+)'/), 'clickmonster.prefs');
  assert.equal(key('public/js/main.js', /const PREFS_KEY = '([^']+)'/), 'clickmonster.prefs');
  assert.equal(key('public/js/main.js', /const SEEN_KEY = '([^']+)'/), 'clickmonster.seenAnnouncement');
  // The first-paint check for a saved session reads the same auth key.
  assert.match(text('public/index.html'), /localStorage\.getItem\('clickmonster\.auth'\)/);
});
