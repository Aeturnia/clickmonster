// Public-read security check for news (landing L-3, docs/landing-scope.md section 7 and 9).
// After the owner has authorized and applied the news migration, this checks the LIVE project's
// REST API with the publishable (anonymous) key only, as anyone on the internet could:
//   - a published article can be read, with the article columns only;
//   - hidden rows stay hidden (pass the address of a draft or unpublished entry);
//   - hidden columns, select *, and filtering or ordering on hidden columns are refused;
//   - writes are refused: insert, upsert, update and delete.
// Write probes use an identifiable payload and touch only that payload's address
// (rls-check-<time>), never a real article: Postgres checks the write privilege before it looks
// for rows, so a refused write is refused whether or not the row exists. If one gets through,
// the check fails and says exactly what to remove; this tool has no key that could remove it.
//
//   node tools/news-public-check.mjs --published <address> [--hidden <address>] [--out file.json]
//   node tools/news-public-check.mjs --local --published <address> ...   (the local stack, to try the tool)
// It never uses a secret or service key.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SUPABASE_URL, SUPABASE_KEY } from '../public/js/config.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const published = opt('published');
const hidden = opt('hidden');
const out = opt('out');
if (!published) { console.error('Give the address of a published article: --published <address>'); process.exit(2); }

let API = SUPABASE_URL;
let KEY = SUPABASE_KEY;
if (args.includes('--local')) {
  const s = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const st = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  API = st.API_URL;
  KEY = st.ANON_KEY;
}
if (/service_role|sb_secret_/.test(KEY)) { console.error('Refusing: that is not the public key.'); process.exit(2); }

const PUBLIC_COLS = 'id,slug,kind,title,summary,body,published_at,revised_at,maintenance_starts_at,maintenance_ends_at';
const probe = `rls-check-${Date.now()}`;
const results = [];
const record = (name, pass, detail) => { results.push({ check: name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const rest = async (path, { method = 'GET', body, prefer } = {}) => {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
};
const refused = (r) => (r.status === 401 || r.status === 403) && r.json?.code === '42501';
const slugParam = (s) => encodeURIComponent(s);

console.log(`News public-read check against ${new URL(API).host}, anonymous key only.`);

// 1. Published reads.
const pub = await rest(`news?select=${PUBLIC_COLS}&slug=eq.${slugParam(published)}`);
record('a published article can be read', pub.status === 200 && Array.isArray(pub.json) && pub.json.length === 1, `HTTP ${pub.status}`);
if (pub.json?.[0]) record('only the article columns come back', JSON.stringify(Object.keys(pub.json[0]).sort()) === JSON.stringify(PUBLIC_COLS.split(',').sort()));
const before = pub.json?.[0] || null;
const all = await rest(`news?select=slug,published_at&order=published_at.desc&limit=200`);
record('the public list loads', all.status === 200 && Array.isArray(all.json), `${Array.isArray(all.json) ? all.json.length : 0} published`);
if (Array.isArray(all.json)) record('every listed article has a publication time in the past', all.json.every((r) => r.published_at && new Date(r.published_at) <= new Date()));

// 2. Hidden rows.
if (hidden) {
  const h = await rest(`news?select=slug&slug=eq.${slugParam(hidden)}`);
  record(`the hidden entry "${hidden}" is not visible`, h.status === 200 && Array.isArray(h.json) && h.json.length === 0, `HTTP ${h.status}`);
} else {
  record('hidden entry check', true, 'skipped: no --hidden address given');
}

// 3. Column restrictions.
for (const [name, path] of [
  ['select * is refused', 'news?select=*'],
  ['the default select is refused', 'news'],
  ['status is not readable', 'news?select=slug,status'],
  ['created_by is not readable', 'news?select=slug,created_by'],
  ['updated_by is not readable', 'news?select=slug,updated_by'],
  ['created_at is not readable', 'news?select=slug,created_at'],
  ['updated_at is not readable', 'news?select=slug,updated_at'],
  ['filtering on status is refused', 'news?select=slug&status=eq.draft'],
  ['ordering on updated_at is refused', 'news?select=slug&order=updated_at.desc'],
]) {
  const r = await rest(path);
  record(name, refused(r), `HTTP ${r.status}${r.json?.code ? `, ${r.json.code}` : ''}`);
}

// 4. Writes, all aimed at the probe's own address. An inserted row is made "published" so that,
// if the insert got through, it would be visible and noticed here.
const leaks = [];
const row = (what) => ({ slug: probe, title: `RLS check: anonymous ${what}`, summary: 'This row must never exist. Remove it.', body: 'x', status: 'published', published_at: new Date(Date.now() - 60000).toISOString() });
const ins = await rest('news', { method: 'POST', body: row('insert') });
record('insert is refused', refused(ins), `HTTP ${ins.status}`);
const ups = await rest('news', { method: 'POST', prefer: 'resolution=merge-duplicates', body: row('upsert') });
record('upsert is refused', refused(ups), `HTTP ${ups.status}`);
const upd = await rest(`news?slug=eq.${slugParam(probe)}`, { method: 'PATCH', body: { title: `RLS check ${probe}` } });
record('update is refused', refused(upd), `HTTP ${upd.status}`);
const del = await rest(`news?slug=eq.${slugParam(probe)}`, { method: 'DELETE' });
record('delete is refused', refused(del), `HTTP ${del.status}`);

// 5. Nothing changed.
const after = await rest(`news?select=${PUBLIC_COLS}&slug=eq.${slugParam(published)}`);
const still = after.json?.[0];
record('the published article still exists', !!still);
record('the published article is unchanged', !!still && !!before && JSON.stringify(still) === JSON.stringify(before));
const created = await rest(`news?select=slug&slug=eq.${slugParam(probe)}`);
const createdRow = Array.isArray(created.json) && created.json.length > 0;
record(`no row "${probe}" was created`, !createdRow);
if (createdRow) leaks.push(`a news row with the address ${probe}`);
if (still && before && JSON.stringify(still) !== JSON.stringify(before)) leaks.push(`${published} changed while the check ran (it shouldn't: no probe targets it)`);
if (!still && before) leaks.push(`${published} disappeared while the check ran`);

const failed = results.filter((r) => !r.pass);
const summary = { target: new URL(API).host, at: new Date().toISOString(), probe, published, hidden, passed: results.length - failed.length, failed: failed.length, leaks, results };
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`\n${failed.length ? 'GATE FAILED' : 'All checks passed'}: ${summary.passed} of ${results.length}.`);
if (leaks.length) console.log(`A write got through. Record it in the L-3 report and remove it: ${leaks.join('; ')}. L-4 stays blocked until the policy is fixed and checked again.`);
process.exit(failed.length ? 1 : 0);
