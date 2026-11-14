// The real `admin` edge function's news actions (landing L-3, LAC-13), on the LOCAL Supabase
// stack only: npx supabase start, then npm run test:db.
// It creates local test accounts (an admin, a moderator, a player), calls the function as each,
// checks the rows, the audit log and what the public can read, and removes what it created.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

let API, ANON, SERVICE;
const RUN = `t${Date.now()}`;
const users = {};

const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });

async function admin(who, action, args = {}) {
  const res = await fetch(`${API}/functions/v1/admin`, { method: 'POST', headers: headers(users[who].token), body: JSON.stringify({ action, args }) });
  const body = await res.json();
  return { status: res.status, body };
}
async function ok(who, action, args) {
  const r = await admin(who, action, args);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
  return r.body;
}
async function newsLog() {
  const res = await service(`/rest/v1/admin_log?select=action,actor,target_name,details&action=like.news:*&order=id.asc`);
  const all = await res.json();
  return all.filter((l) => String(l.details?.slug || '').startsWith(RUN));
}
const publicRead = async (slug) => (await (await fetch(`${API}/rest/v1/news?select=slug,title,published_at,revised_at&slug=eq.${slug}`, { headers: headers(ANON) })).json());

before(async () => {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  for (const [who, role] of [['admin', 'admin'], ['mod', 'moderator'], ['player', null]]) {
    const email = `${RUN}-${who}@example.test`;
    const password = `local-${who}-password-1`;
    const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json();
    assert.ok(made.id, `create ${who}: ${JSON.stringify(made).slice(0, 120)}`);
    if (role) {
      const st = await service('/rest/v1/staff', { method: 'POST', body: JSON.stringify({ user_id: made.id, role }), headers: { Prefer: 'return=minimal' } });
      assert.equal(st.status, 201, `staff row for ${who}`);
    }
    const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) })).json();
    users[who] = { id: made.id, token: tok.access_token };
  }
});

after(async () => {
  if (!SERVICE) return;
  await service(`/rest/v1/news?slug=like.${RUN}*&status=eq.published`, { method: 'PATCH', body: JSON.stringify({ status: 'unpublished' }) });
  await service(`/rest/v1/news?slug=like.${RUN}*`, { method: 'DELETE' });
  await service(`/rest/v1/admin_log?details->>slug=like.${RUN}*`, { method: 'DELETE' });
  for (const u of Object.values(users)) await service(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
});

test('only admins can use news: a moderator and a player are refused', async () => {
  const mod = await admin('mod', 'news');
  assert.equal(mod.status, 403);
  assert.equal(mod.body.error, 'Only admins can do that.');
  const modSave = await admin('mod', 'newsSave', { entry: { title: 'Moderator draft', summary: 'A moderator trying to write.', body: 'x', slug: `${RUN}-mod` } });
  assert.equal(modSave.status, 403);
  const player = await admin('player', 'news');
  assert.equal(player.status, 403);
  assert.equal(player.body.error, 'This account is not staff.');
  assert.deepEqual(await newsLog(), [], 'nothing was written');
});

test('the publication lifecycle, through the real function and database', async () => {
  const slug = `${RUN}-patch-notes`;
  // A draft: saved, in the admin list, not public.
  const created = await ok('admin', 'newsSave', { entry: { kind: 'patch', title: 'Patch notes 1.2', slug, summary: 'What changed in this release of the game.', body: 'Fixes.\n\n- One\n- Two' } });
  const id = created.entry.id;
  assert.equal(created.entry.status, 'draft');
  assert.equal(created.entry.published_at, null);
  assert.ok(created.news.some((n) => n.id === id), 'in the admin list');
  assert.deepEqual(await publicRead(slug), [], 'a draft is not public');

  // Invalid input and a taken address are refused with a reason.
  const bad = await admin('admin', 'newsSave', { entry: { title: 'x', summary: 'short', body: '', slug: `${RUN}-bad` } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /title of 3 to 120 characters/);
  const dup = await admin('admin', 'newsSave', { entry: { title: 'Another article', slug, summary: 'Trying to reuse an address here.', body: 'x' } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already used/);

  // A draft's address can change.
  const renamed = await ok('admin', 'newsSave', { id, entry: { kind: 'patch', title: 'Patch notes 1.2', slug: `${slug}-v2`, summary: 'What changed in this release of the game.', body: 'Fixes.\n\n- One\n- Two' } });
  assert.equal(renamed.entry.slug, `${slug}-v2`);
  const s2 = `${slug}-v2`;

  // Publish: public, with a first publication time; a second press is refused, not logged twice.
  const pub = await ok('admin', 'newsPublish', { id });
  assert.equal(pub.entry.status, 'published');
  assert.ok(pub.entry.published_at);
  const firstPublished = pub.entry.published_at;
  assert.equal((await publicRead(s2)).length, 1, 'public once published');
  const again = await admin('admin', 'newsPublish', { id });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already published/);

  // A published entry: the text can be corrected (marked as revised), the address can't change,
  // and it can't be deleted.
  const fixed = await ok('admin', 'newsSave', { id, entry: { kind: 'patch', title: 'Patch notes 1.2 (corrected)', slug: s2, summary: 'What changed in this release of the game.', body: 'Fixes.\n\n- One\n- Two\n- Three' } });
  assert.ok(fixed.entry.revised_at, 'marked as revised');
  assert.equal((await publicRead(s2))[0].title, 'Patch notes 1.2 (corrected)', 'the public sees the correction');
  const move = await admin('admin', 'newsSave', { id, entry: { kind: 'patch', title: 'Patch notes 1.2 (corrected)', slug: `${slug}-v3`, summary: 'What changed in this release of the game.', body: 'Fixes.' } });
  assert.equal(move.status, 409);
  assert.match(move.body.error, /address can't change/);
  const del = await admin('admin', 'newsDelete', { id });
  assert.equal(del.status, 409);
  assert.match(del.body.error, /Unpublish it first/);

  // Unpublish: gone from the public; publish again keeps the first publication time.
  await ok('admin', 'newsUnpublish', { id });
  assert.deepEqual(await publicRead(s2), [], 'not public once unpublished');
  const unAgain = await admin('admin', 'newsUnpublish', { id });
  assert.equal(unAgain.status, 409);
  const repub = await ok('admin', 'newsPublish', { id });
  assert.equal(new Date(repub.entry.published_at).getTime(), new Date(firstPublished).getTime(), 'the first publication time is kept');
  await ok('admin', 'newsUnpublish', { id });

  // An unpublished entry can be deleted; deleting it again finds nothing.
  await ok('admin', 'newsDelete', { id });
  const gone = await admin('admin', 'newsDelete', { id });
  assert.equal(gone.status, 404);

  // A draft can be deleted too.
  const d2 = await ok('admin', 'newsSave', { entry: { title: 'Throwaway draft', slug: `${RUN}-throwaway`, summary: 'A draft that is deleted at once.', body: 'x' } });
  await ok('admin', 'newsDelete', { id: d2.entry.id });

  // The audit log: one entry per change, by the admin, none for the refused attempts.
  const log = await newsLog();
  assert.deepEqual(log.map((l) => l.action), [
    'news:create', 'news:edit', 'news:publish', 'news:edit', 'news:unpublish', 'news:publish', 'news:unpublish', 'news:delete', 'news:create', 'news:delete',
  ]);
  assert.ok(log.every((l) => l.actor === users.admin.id), 'recorded against the admin');
  assert.equal(log[3].details.revised, true, 'the correction is logged as a revision');
  assert.equal(log[5].details.republished, true);
});

test('a maintenance notice keeps its window; other kinds drop one', async () => {
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 90000000).toISOString();
  const m = await ok('admin', 'newsSave', { entry: { kind: 'maintenance', title: 'Planned maintenance', slug: `${RUN}-maint`, summary: 'The realm is closed for two hours.', body: 'Details.', startsAt: start, endsAt: end } });
  assert.equal(new Date(m.entry.maintenance_starts_at).toISOString(), start);
  const backwards = await admin('admin', 'newsSave', { id: m.entry.id, entry: { kind: 'maintenance', title: 'Planned maintenance', slug: `${RUN}-maint`, summary: 'The realm is closed for two hours.', body: 'Details.', startsAt: end, endsAt: start } });
  assert.equal(backwards.status, 400);
  assert.match(backwards.body.error, /end must be after the start/);
  const u = await ok('admin', 'newsSave', { entry: { kind: 'update', title: 'Not maintenance', slug: `${RUN}-plain`, summary: 'An update with a stray window.', body: 'x', startsAt: start, endsAt: end } });
  assert.equal(u.entry.maintenance_starts_at, null);
  await ok('admin', 'newsDelete', { id: m.entry.id });
  await ok('admin', 'newsDelete', { id: u.entry.id });
});
