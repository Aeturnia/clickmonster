// The Kingdom deployment and invariant checks (#83, K1-1; review finding K1-DB03), run against
// deliberate fixtures on the LOCAL Supabase stack only: npx supabase start, then npm run test:db.
//
// The checks in supabase/checks/ are read-only SELECTs meant for production. pgTAP can't read them
// (its container mounts only supabase/tests), so this file runs each check file exactly as it is,
// through `supabase db query`, and asserts what it reports:
//   - kingdom_verify.sql (I-1) reports each kind of inconsistency, and not a valid ownership;
//   - kingdoms_precheck.sql row 6 reports every zone row that would break the Kingdom portal, and
//     not a harmless one;
//   - kingdoms_deploy_verify.sql's rows are ok on the migrated local database.
// Every fixture is written directly as the database owner and removed afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUN = `t${Date.now()}`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let DB_URL;

// Runs one SQL statement, or a whole check file, on the local database and returns its rows. The
// SQL goes through a file, so no shell ever sees it (npx runs through the shell on Windows).
function query({ sql, file }) {
  const tmp = sql === undefined ? null : path.join(os.tmpdir(), `${RUN}-kingdom-checks.sql`);
  if (tmp) fs.writeFileSync(tmp, sql);
  try {
    const out = execFileSync(npx, ['--no-install', 'supabase', 'db', 'query', '--db-url', DB_URL,
      '--output-format', 'json', '--file', tmp || file],
      { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const result = jsonObjects(out).find((o) => Array.isArray(o.rows));
    // An insert, update or delete prints only its command tag ("INSERT 0 5"). A query, and every
    // check file, must print its rows.
    const wantsRows = file !== undefined || /^\s*select\b/i.test(sql);
    if (!result && wantsRows) throw new Error(`supabase db query printed no result rows:\n${out.slice(0, 2000)}`);
    return result ? result.rows : [];
  } finally { if (tmp) fs.rmSync(tmp, { force: true }); }
}

// Every top-level JSON object in the CLI's output. The CLI can print more than one (CI printed a
// second object after the result), so the output is scanned, not sliced from first { to last }.
function jsonObjects(text) {
  const found = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) {
      try { found.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not JSON: skip it */ }
    }
  }
  return found;
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const CHECKS = path.resolve('supabase/checks');

// Heroes for the I-1 fixtures, each in a state the check must (or mustn't) report.
const heroes = {
  valid: { id: randomUUID(), user: randomUUID() },
  kingdomWithoutPlot: { id: randomUUID(), user: randomUUID() },
  plotWithoutKingdom: { id: randomUUID(), user: randomUUID() },
  mismatch: { id: randomUUID(), user: randomUUID() },
  malformed: { id: randomUUID(), user: randomUUID() },
};
const kingdom = (x, y) => JSON.stringify({ gold: 10, kingdom: { plot: { x, y }, claimedAt: 1 } });

before(() => {
  const out = execFileSync(npx, ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  DB_URL = s.DB_URL;
  assert.match(DB_URL, /@127\.0\.0\.1:\d+\//, 'local database only');
});

after(() => {
  if (!DB_URL) return;
  const ids = Object.values(heroes);
  // Deleting the heroes cascades to their plots.
  query({ sql: `delete from public.characters where id in (${ids.map((h) => q(h.id)).join(', ')})` });
  query({ sql: `delete from auth.users where id in (${ids.map((h) => q(h.user)).join(', ')})` });
});

test('I-1: kingdom_verify.sql reports each inconsistency, and not a valid ownership', () => {
  const rows = (k, data) => `(${q(heroes[k].id)}, ${q(heroes[k].user)}, ${q(`${RUN} ${k}`)}, 'human', 5, 'kingdoms', 1, 1, ${q(data)}::jsonb)`;
  query({ sql: `insert into auth.users (id, email) values ${Object.entries(heroes).map(([k, h]) => `(${q(h.user)}, ${q(`${RUN}-${k}@example.test`)})`).join(', ')}` });
  query({ sql: `insert into public.characters (id, user_id, name, race, level, zone, x, y, data) values
    ${rows('valid', kingdom(91, 91))},
    ${rows('kingdomWithoutPlot', kingdom(95, 95))},
    ${rows('plotWithoutKingdom', JSON.stringify({ gold: 10 }))},
    ${rows('mismatch', kingdom(94, 94))},
    ${rows('malformed', JSON.stringify({ gold: 10, kingdom: 'yes' }))}` });
  query({ sql: `insert into public.kingdom_plots (x, y, status, character_id) values
    (91, 91, 'claimed', ${q(heroes.valid.id)}),
    (92, 92, 'claimed', ${q(heroes.plotWithoutKingdom.id)}),
    (93, 93, 'claimed', ${q(heroes.mismatch.id)})` });

  const mine = new Set(Object.values(heroes).map((h) => h.id));
  const found = query({ file: path.join(CHECKS, 'kingdom_verify.sql') }).filter((r) => mine.has(r.character_id));
  const byHero = Object.fromEntries(found.map((r) => [r.character_id, r.problem]));
  assert.equal(byHero[heroes.kingdomWithoutPlot.id], 'kingdom_without_plot');
  assert.equal(byHero[heroes.plotWithoutKingdom.id], 'plot_without_kingdom');
  assert.equal(byHero[heroes.mismatch.id], 'plot_mismatch');
  assert.equal(byHero[heroes.malformed.id], 'kingdom_malformed');
  assert.equal(byHero[heroes.valid.id], undefined, 'a valid ownership is not reported');
  assert.equal(found.length, 4, `exactly one row per inconsistent hero: ${JSON.stringify(found)}`);
  const mismatch = found.find((r) => r.problem === 'plot_mismatch');
  assert.deepEqual([mismatch.x, mismatch.y], [93, 93], 'the mismatch names the plot actually held');

  // Repaired, the same heroes are no longer reported.
  query({ sql: `delete from public.kingdom_plots where character_id in (${q(heroes.plotWithoutKingdom.id)}, ${q(heroes.mismatch.id)})` });
  query({ sql: `update public.characters set data = '{"gold": 10}' where id in (${q(heroes.kingdomWithoutPlot.id)}, ${q(heroes.mismatch.id)}, ${q(heroes.malformed.id)})` });
  const after = query({ file: path.join(CHECKS, 'kingdom_verify.sql') }).filter((r) => mine.has(r.character_id));
  assert.deepEqual(after, [], 'after the repair, nothing is reported');
});

test('the precheck reports every zone row that would break the Kingdom portal, and not a harmless one', (t) => {
  const existing = query({ sql: `select id from public.zones where id in ('kingdoms', 'overworld')` });
  if (existing.length) {
    t.skip(`the local zones table already has ${existing.map((r) => r.id).join(', ')}; the fixtures would overwrite them`);
    return;
  }
  const into = `${RUN}-into`, placed = `${RUN}-placed`, harmless = `${RUN}-harmless`;
  const zones = [
    ['kingdoms', {}],
    ['overworld', { town: { x: 4, y: 4 }, portals: [{ x: 4, y: 4, to: 'ashford', tx: 1, ty: 1 }] }],
    [into, { portals: [{ x: 1, y: 1, to: 'kingdoms', tx: 1, ty: 1 }] }],
    [placed, { overworld: [4, 4], entry: { x: 1, y: 1 } }],
    [harmless, { overworld: [1, 2], entry: { x: 1, y: 1 }, portals: [{ x: 2, y: 2, to: 'ashford', tx: 1, ty: 1 }] }],
  ];
  try {
    query({ sql: `insert into public.zones (id, data) values ${zones.map(([id, d]) => `(${q(id)}, ${q(JSON.stringify(d))}::jsonb)`).join(', ')}` });
    const row6 = query({ file: path.join(CHECKS, 'kingdoms_precheck.sql') }).find((r) => Number(r.n) === 6);
    assert.ok(row6, 'the precheck has a row 6');
    const v = row6.value;
    assert.match(v, /a zone with the id kingdoms/);
    assert.ok(v.includes(`a path into kingdoms in ${into}`), v);
    assert.match(v, /an Overworld path at its town cell/);
    assert.ok(v.includes(`a zone placed on the Overworld town cell: ${placed}`), v);
    assert.ok(!v.includes(harmless), `a harmless zone isn't reported: ${v}`);
  } finally {
    query({ sql: `delete from public.zones where id in (${zones.map(([id]) => q(id)).join(', ')})` });
  }
  const clean = query({ file: path.join(CHECKS, 'kingdoms_precheck.sql') }).find((r) => Number(r.n) === 6);
  assert.equal(clean.value, 'none', 'with the fixtures removed, row 6 is none again');
});

test('the precheck reports a zone placed on the built-in Overworld town cell when there is no Overworld row', (t) => {
  const existing = query({ sql: `select id from public.zones where id = 'overworld'` });
  if (existing.length) { t.skip('the local zones table has an Overworld row'); return; }
  const placed = `${RUN}-builtin`;
  try {
    query({ sql: `insert into public.zones (id, data) values (${q(placed)}, '{"overworld": [4, 4]}'::jsonb)` });
    const row6 = query({ file: path.join(CHECKS, 'kingdoms_precheck.sql') }).find((r) => Number(r.n) === 6);
    assert.ok(row6.value.includes(`a zone placed on the Overworld town cell: ${placed}`), row6.value);
  } finally {
    query({ sql: `delete from public.zones where id = ${q(placed)}` });
  }
});

test('kingdoms_deploy_verify.sql: every row is ok on the migrated local database', () => {
  const rows = query({ file: path.join(CHECKS, 'kingdoms_deploy_verify.sql') });
  assert.equal(rows.length, 17);
  // Row 16 compares save_hero_with_rewards() with production's LF definition. A local stack applies
  // the migration from this checkout, whose line endings can differ (docs/kingdoms-k1-report.md, 1.3),
  // so it is reported, not asserted, here.
  const notOk = rows.filter((r) => Number(r.n) !== 16 && r.ok !== true);
  assert.deepEqual(notOk, [], `rows not ok: ${JSON.stringify(notOk)}`);
});
