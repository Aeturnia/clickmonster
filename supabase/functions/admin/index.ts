// ClickMonster admin API. Every request is checked against the `staff` table.
//   moderator: stats, search/view players, sanctions (up to 7 days), announcements, audit log
//   admin:     everything, plus hero editing, permanent bans, player emails and staff management
// Every write is recorded in admin_log.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { ensureCharacter, maxHp, addItem } from './js/engine/character.js';
import { ITEMS, QUALITY } from './js/data/items.js';
import { ZONES } from './js/data/zones.js';
import { STATS } from './js/data/stats.js';
import { MASTERIES, masteryCap } from './js/data/masteries.js';
import { parseGem } from './js/data/gems.js';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class AdminError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type Staff = { id: string; email: string; role: 'admin' | 'moderator' };
const MOD_MAX_DAYS = 7;
const DAY = 86400000;

const PUBLIC_COLS = 'id, name, race, level, zone, x, y, updated_at, created_at, banned_until, jailed_until, muted_until, sanction_reason, strikes';

async function log(staff: Staff, action: string, target: { id?: string; name?: string } | null, details: unknown = null) {
  const { error } = await db.from('admin_log').insert({
    actor: staff.id, actor_name: staff.email, action,
    target_id: target?.id || null, target_name: target?.name || null, details,
  });
  if (error) console.error('admin_log insert failed', error);
}

function requireAdmin(staff: Staff) {
  if (staff.role !== 'admin') throw new AdminError('Only admins can do that.', 403);
}

async function loadCharacter(id: string) {
  const { data, error } = await db.from('characters').select(`${PUBLIC_COLS}, user_id, data, version`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AdminError('Player not found.', 404);
  ensureCharacter(data.data);
  return data;
}

async function saveCharacter(row: any, char: any) {
  const { data, error } = await db.from('characters').update({
    data: char, name: char.name, level: char.level, zone: char.loc.zone, x: char.loc.x, y: char.loc.y,
    version: row.version + 1, updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('version', row.version).select('id');
  if (error) throw error;
  if (!data?.length) throw new AdminError('The player just acted. Reload and try again.', 409);
}

// ---------------------------------------------------------------- stats
async function stats() {
  const now = Date.now();
  const { data: chars, error } = await db.from('characters')
    .select('level, race, zone, created_at, updated_at, banned_until, gold:data->gold, bank:data->bank').limit(10000);
  if (error) throw error;
  const since = (ms: number) => chars.filter((c: any) => now - new Date(c.updated_at).getTime() < ms).length;
  const created = (ms: number) => chars.filter((c: any) => now - new Date(c.created_at).getTime() < ms).length;
  const byRace: Record<string, number> = {};
  const byZone: Record<string, number> = {};
  const levels: Record<string, number> = { '1-9': 0, '10-19': 0, '20-29': 0, '30-49': 0, '50+': 0 };
  let gold = 0, bank = 0;
  for (const c of chars as any[]) {
    byRace[c.race] = (byRace[c.race] || 0) + 1;
    byZone[c.zone] = (byZone[c.zone] || 0) + 1;
    const l = c.level;
    levels[l < 10 ? '1-9' : l < 20 ? '10-19' : l < 30 ? '20-29' : l < 50 ? '30-49' : '50+'] += 1;
    gold += Number(c.gold) || 0;
    bank += Number(c.bank) || 0;
  }
  const { count: events24h } = await db.from('events').select('id', { count: 'exact', head: true })
    .gt('created_at', new Date(now - DAY).toISOString());
  const { data: top } = await db.from('characters').select('id, name, race, level').order('level', { ascending: false }).limit(10);
  return {
    players: chars.length,
    online15m: since(15 * 60000),
    active24h: since(DAY),
    active7d: since(7 * DAY),
    signups24h: created(DAY),
    signups7d: created(7 * DAY),
    banned: chars.filter((c: any) => c.banned_until && new Date(c.banned_until).getTime() > now).length,
    goldCarried: gold, goldBanked: bank,
    byRace, byZone, levels, events24h: events24h || 0, top,
  };
}

// ---------------------------------------------------------------- players
async function search(q: string) {
  let query = db.from('characters').select(PUBLIC_COLS).order('updated_at', { ascending: false }).limit(50);
  const term = String(q || '').trim();
  if (term) query = query.ilike('name', `%${term.replace(/[%_]/g, '')}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getPlayer(staff: Staff, id: string) {
  const row = await loadCharacter(id);
  const { data: history } = await db.from('sanctions').select('*').eq('character_id', id).order('created_at', { ascending: false }).limit(50);
  const { data: actions } = await db.from('admin_log').select('*').eq('target_id', id).order('created_at', { ascending: false }).limit(30);
  let email = null;
  if (staff.role === 'admin') {
    const { data } = await db.auth.admin.getUserById(row.user_id);
    email = data?.user?.email || null;
  }
  delete row.user_id;
  return { player: row, history, actions, email };
}

// Admin-only hero editor. Only known fields, validated.
async function updatePlayer(staff: Staff, id: string, patch: any) {
  requireAdmin(staff);
  const row = await loadCharacter(id);
  const c = row.data;
  const changes: Record<string, unknown> = {};
  const num = (v: any, min = 0) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < min) throw new AdminError(`Invalid number: ${v}`);
    return n;
  };
  for (const k of ['level', 'xp', 'gold', 'bank', 'pendingLevels']) {
    if (patch[k] != null) { changes[k] = [c[k], num(patch[k], k === 'level' ? 1 : 0)]; c[k] = num(patch[k], k === 'level' ? 1 : 0); }
  }
  if (patch.stats) for (const s of STATS) {
    if (patch.stats[s] != null) { changes[`stats.${s}`] = [c.stats[s], num(patch.stats[s], 1)]; c.stats[s] = num(patch.stats[s], 1); }
  }
  if (patch.masteries) for (const m of MASTERIES) {
    if (patch.masteries[m] != null) {
      const v = Math.min(masteryCap(c.race, m), num(patch.masteries[m]));
      changes[`mastery.${m}`] = [c.masteries[m], v];
      c.masteries[m] = v;
    }
  }
  if (patch.loc) {
    const z = ZONES[patch.loc.zone];
    const x = num(patch.loc.x, 1), y = num(patch.loc.y, 1);
    if (!z || x > z.size || y > z.size) throw new AdminError('Invalid location.');
    changes.loc = [c.loc, { zone: z.id, x, y }];
    c.loc = { zone: z.id, x, y };
    c.battle = null;
  }
  if (patch.addItem) {
    const { base, q } = patch.addItem;
    if (!ITEMS[base]) throw new AdminError('Unknown item.');
    if (q && !QUALITY[q]) throw new AdminError('Unknown quality.');
    const item = addItem(c, base, q || null);
    changes.addItem = { uid: item.uid, base, q: q || null };
  }
  if (patch.removeItem != null) {
    const uid = num(patch.removeItem, 1);
    if (!c.inventory.some((i: any) => i.uid === uid)) throw new AdminError('No such item.');
    for (const slot of Object.keys(c.equipment)) if (c.equipment[slot] === uid) c.equipment[slot] = null;
    c.inventory = c.inventory.filter((i: any) => i.uid !== uid);
    changes.removeItem = uid;
  }
  if (patch.addGem) {
    if (!parseGem(patch.addGem.key)) throw new AdminError('Unknown gem.');
    const n = num(patch.addGem.count ?? 1, 1);
    c.gems[patch.addGem.key] = (c.gems[patch.addGem.key] || 0) + n;
    changes.addGem = { key: patch.addGem.key, count: n };
  }
  if (patch.heal) { c.hp = maxHp(c); changes.heal = true; }
  if (patch.clearBattle) { c.battle = null; changes.clearBattle = true; }
  if (patch.clearQuest) { c.quest = null; c.questCooldownUntil = 0; changes.clearQuest = true; }
  // Keep only real changes in the audit trail.
  for (const [k, v] of Object.entries(changes)) {
    if (Array.isArray(v) && JSON.stringify(v[0]) === JSON.stringify(v[1])) delete changes[k];
  }
  if (!Object.keys(changes).length) throw new AdminError('Nothing changed.');
  c.hp = Math.min(c.hp, maxHp(c));
  await saveCharacter(row, c);
  await log(staff, 'edit', { id: row.id, name: row.name }, changes);
  return { player: (await loadCharacter(id)) };
}

// ---------------------------------------------------------------- sanctions
async function sanction(staff: Staff, id: string, kind: string, days: number | null, reason: string) {
  const text = String(reason || '').trim();
  if (!['mute', 'jail', 'ban', 'warn', 'lift'].includes(kind)) throw new AdminError('Unknown sanction.');
  if (!text) throw new AdminError('Give a reason.');
  const row = await loadCharacter(id);
  let until: string | null = null;
  if (kind === 'mute' || kind === 'jail' || kind === 'ban') {
    const permanent = days == null || Number(days) <= 0;
    if (permanent || Number(days) > MOD_MAX_DAYS) requireAdmin(staff);
    until = permanent ? new Date('9999-12-31T00:00:00Z').toISOString() : new Date(Date.now() + Number(days) * DAY).toISOString();
  }
  const update: Record<string, unknown> = { sanction_reason: kind === 'lift' ? null : text };
  if (kind === 'mute') update.muted_until = until;
  if (kind === 'jail') update.jailed_until = until;
  if (kind === 'ban') update.banned_until = until;
  if (kind === 'lift') Object.assign(update, { muted_until: null, jailed_until: null, banned_until: null });
  if (kind !== 'lift') update.strikes = (row.strikes || 0) + 1;
  const { error } = await db.from('characters').update(update).eq('id', id);
  if (error) throw error;
  await db.from('sanctions').insert({ character_id: id, kind, reason: text, until, by_user: staff.id, by_name: staff.email });
  await log(staff, `sanction:${kind}`, { id, name: row.name }, { days, reason: text, until });
  return { ok: true };
}

// ---------------------------------------------------------------- staff
async function findUserByEmail(email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x: any) => (x.email || '').toLowerCase() === target);
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

async function listStaff() {
  const { data, error } = await db.from('staff').select('user_id, role, created_at');
  if (error) throw error;
  const out = [];
  for (const s of data) {
    const { data: u } = await db.auth.admin.getUserById(s.user_id);
    out.push({ ...s, email: u?.user?.email || '(unknown)' });
  }
  return out;
}

async function setStaff(staff: Staff, email: string, role: string | null) {
  requireAdmin(staff);
  const user = await findUserByEmail(String(email || ''));
  if (!user) throw new AdminError('No account with that email. They need to sign up in the game first.');
  if (role === null) {
    if (user.id === staff.id) throw new AdminError('You can’t remove yourself.');
    await db.from('staff').delete().eq('user_id', user.id);
  } else {
    if (!['admin', 'moderator'].includes(role)) throw new AdminError('Unknown role.');
    const { error } = await db.from('staff').upsert({ user_id: user.id, role, added_by: staff.id });
    if (error) throw error;
  }
  await log(staff, role ? `staff:${role}` : 'staff:remove', { name: user.email }, null);
  return { staff: await listStaff() };
}

// ---------------------------------------------------------------- dispatch
async function handle(staff: Staff, action: string, a: any) {
  switch (action) {
    case 'whoami': return { role: staff.role, email: staff.email };
    case 'stats': return await stats();
    case 'search': return { players: await search(a.q) };
    case 'player': return await getPlayer(staff, String(a.id));
    case 'update': return await updatePlayer(staff, String(a.id), a.patch || {});
    case 'sanction': return await sanction(staff, String(a.id), String(a.kind), a.days == null ? null : Number(a.days), a.reason);
    case 'announce': {
      const text = String(a.text || '').trim().slice(0, 300);
      if (!text) throw new AdminError('Write a message.');
      const { error } = await db.from('events').insert({ kind: 'announce', text });
      if (error) throw error;
      await log(staff, 'announce', null, { text });
      return { ok: true };
    }
    case 'events': {
      const { data, error } = await db.from('events').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return { events: data };
    }
    case 'deleteEvent': {
      requireAdmin(staff);
      const { error } = await db.from('events').delete().eq('id', Number(a.id));
      if (error) throw error;
      await log(staff, 'deleteEvent', null, { id: a.id });
      return { ok: true };
    }
    case 'log': {
      const { data, error } = await db.from('admin_log').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return { log: data };
    }
    case 'staff': return { staff: await listStaff() };
    case 'setStaff': return await setStaff(staff, a.email, a.role ?? null);
    case 'meta': return {
      zones: Object.values(ZONES).map((z: any) => ({ id: z.id, name: z.name, size: z.size })),
      items: Object.values(ITEMS).map((i: any) => ({ id: i.id, name: i.name, tier: i.tier, slot: i.slot })),
    };
    default: throw new AdminError('Unknown action.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  if (!auth?.user) return json({ error: 'Please sign in.' }, 401);
  const { data: role } = await db.from('staff').select('role').eq('user_id', auth.user.id).maybeSingle();
  if (!role) return json({ error: 'This account is not staff.' }, 403);
  const staff: Staff = { id: auth.user.id, email: auth.user.email || '', role: role.role };

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  try {
    return json(await handle(staff, String(body?.action || ''), body?.args || {}));
  } catch (err) {
    if (err instanceof AdminError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: err instanceof Error && !('code' in err) ? err.message : 'Server error.' }, 500);
  }
});
