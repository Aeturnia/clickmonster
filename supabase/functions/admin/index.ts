// ClickMonster admin API. Every request is checked against the `staff` table.
//   moderator: stats, search/view players, sanctions (up to 7 days), announcements, audit log
//   admin:     everything, plus hero editing, permanent bans, player emails and staff management,
//              and public news (draft, publish, unpublish, delete; landing L-3)
// Every write is recorded in admin_log.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { ensureCharacter, maxHp, addItem } from './js/engine/character.js';
import { ITEMS, QUALITY } from './js/data/items.js';
import { ZONES, DEFAULT_ZONES, loadZones } from './js/data/zones.js';
import { validateZone, deleteBlockers } from './js/engine/zone-validate.js';
import { STATS } from './js/data/stats.js';
import { MASTERIES, masteryCap } from './js/data/masteries.js';
import { parseGem } from './js/data/gems.js';
import { MULT_KEYS, MULT_MAX } from './js/engine/world-config.js';
import { suggestedHuntHp } from './js/engine/hunt.js';
import { checkNews, canDeleteNews } from './js/data/news.js';
import { setKingdomConfig, testConfigFrom, kingdomsOpen, KINGDOM_ZONE_ID, KINGDOM_GATE, KINGDOM_SIZE } from './js/data/kingdoms.js';
import { reloadZones } from './js/data/zones.js';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Kingdoms K-1: the same configuration rule as the `game` function (docs/kingdoms-k1-plan.md 2.2).
setKingdomConfig(testConfigFrom(Deno.env.get('KINGDOMS_TEST'), Deno.env.get('SUPABASE_URL')));
reloadZones();

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
  c.__wealthBefore = (c.gold || 0) + (c.bank || 0);
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
    // The Kingdom Zone (registered only while Kingdoms are open): its gate only (5.1.1).
    if (z.id === KINGDOM_ZONE_ID && (x !== KINGDOM_GATE.x || y !== KINGDOM_GATE.y)) {
      throw new AdminError(`In the Kingdom Lands a hero can only stand at the gate (${KINGDOM_GATE.x}, ${KINGDOM_GATE.y}).`);
    }
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
  const goldDelta = (c.gold + c.bank) - (row.data.__wealthBefore ?? 0);
  delete c.__wealthBefore;
  await saveCharacter(row, c);
  if (goldDelta) await db.rpc('ledger_add', { p_source: 'admin', p_amount: goldDelta });
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

// ---------------------------------------------------------------- world settings
async function getWorld() {
  const { data, error } = await db.from('world_config').select('data, updated_at').eq('id', 1).single();
  if (error) throw error;
  return data;
}

async function saveWorld(staff: Staff, data: any, action: string, details: unknown) {
  const { error } = await db.from('world_config').update({ data, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
  await log(staff, action, null, details);
  return await getWorld();
}

function cleanMults(input: any) {
  const out: Record<string, number> = {};
  for (const k of MULT_KEYS) {
    if (input?.[k] == null || input[k] === '') continue;
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < 0 || v > MULT_MAX) throw new AdminError(`${k} must be between 0 and ${MULT_MAX}.`);
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- hunts
async function listHunts() {
  const { data, error } = await db.from('hunts').select('*').order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  const ids = data.map((h: any) => h.id);
  const { data: hits } = ids.length ? await db.from('hunt_hits').select('*').in('hunt_id', ids) : { data: [] };
  return data.map((h: any) => ({
    ...h,
    top: (hits || []).filter((x: any) => x.hunt_id === h.id).sort((a: any, b: any) => b.damage - a.damage).slice(0, 5),
    hunters: (hits || []).filter((x: any) => x.hunt_id === h.id).length,
  }));
}

async function startHunt(staff: Staff, a: any) {
  const zone = ZONES[a.zone];
  if (!zone) throw new AdminError('Pick a zone.');
  if (zone.id === KINGDOM_ZONE_ID) throw new AdminError('Hunts can’t run in the Kingdom Lands.');
  const name = String(a.name || '').trim().slice(0, 60);
  if (!name) throw new AdminError('Name the boss.');
  const level = Math.max(1, Math.min(10000, Math.floor(Number(a.level) || 1)));
  const hp = Math.max(1000, Math.floor(Number(a.hp) || suggestedHuntHp(level)));
  const hours = Math.max(0.25, Math.min(24 * 14, Number(a.hours) || 24));
  const reward = {
    gold: Math.max(0, Math.floor(Number(a.gold) || 0)),
    xp: Math.max(0, Math.floor(Number(a.xp) || 0)),
    relic: a.relic !== false,
  };
  const { data, error } = await db.from('hunts').insert({
    zone: zone.id, name, level, max_hp: hp, hp, reward, ends_at: new Date(Date.now() + hours * 3600000).toISOString(),
  }).select('id').single();
  if (error) throw error;
  await db.from('events').insert({ kind: 'hunt', text: `A hunt begins! ${name} (level ${level}) has appeared in ${zone.name}.` });
  await log(staff, 'hunt:start', { name }, { zone: zone.id, level, hp, hours, reward });
  return { id: data.id };
}

async function cancelHunt(staff: Staff, id: string) {
  const { data, error } = await db.from('hunts').update({ status: 'cancelled' }).eq('id', id).eq('status', 'active').select('name');
  if (error) throw error;
  if (!data?.length) throw new AdminError('That hunt is not active.');
  await log(staff, 'hunt:cancel', { name: data[0].name }, null);
  return { ok: true };
}

// ---------------------------------------------------------------- economy
async function economy(days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await db.from('ledger').select('*').gte('day', since).order('day', { ascending: false });
  if (error) throw error;
  return { rows: data };
}

// ---------------------------------------------------------------- zones
async function zoneDefs() {
  const { data, error } = await db.from('zones').select('id, data, sort, updated_at, updated_by').order('sort');
  if (error) throw error;
  return data;
}

// Tell game servers to reload zones on their next request.
async function bumpZonesVersion() {
  const { data } = await db.from('world_config').select('data').eq('id', 1).single();
  const next = { ...(data?.data || {}), zonesVersion: Date.now() };
  await db.from('world_config').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1);
}

async function refreshZones() {
  const rows = await zoneDefs();
  if (rows.length) loadZones(rows.map((r: any) => r.data));
  return rows;
}

async function listZones() {
  const rows = await refreshZones();
  const { data: chars } = await db.from('characters').select('zone').limit(10000);
  const counts: Record<string, number> = {};
  for (const c of chars || []) counts[c.zone] = (counts[c.zone] || 0) + 1;
  return {
    zones: rows.map((r: any) => ({ ...r, players: counts[r.id] || 0, builtin: DEFAULT_ZONES.some((d: any) => d.id === r.id) })),
  };
}

// Normalize what the editor sends into a clean definition.
function cleanZone(z: any) {
  const int = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d);
  const pt = (p: any) => (p ? { x: int(p.x), y: int(p.y) } : null);
  const mon = (m: any) => {
    const out: any = { name: String(m.name || '').trim().slice(0, 40), level: int(m.level, 1), arch: String(m.arch || ''), verb: String(m.verb || '').trim().slice(0, 30) };
    if (m.element) out.element = String(m.element);
    if (m.proper) out.proper = true;
    return out;
  };
  return {
    id: String(z.id || '').trim().toLowerCase(),
    name: String(z.name || '').trim().slice(0, 50),
    desc: String(z.desc || '').trim().slice(0, 300),
    size: int(z.size, 10),
    starter: !!z.starter,
    pvp: !!z.pvp,
    minLevel: int(z.minLevel),
    exitLevel: int(z.exitLevel),
    overworld: Array.isArray(z.overworld) ? [int(z.overworld[0]), int(z.overworld[1])] : null,
    entry: pt(z.entry) || { x: 1, y: 1 },
    town: z.town ? { ...pt(z.town), name: String(z.town.name || '').trim().slice(0, 40) } : null,
    shop: z.shop ? {
      tiers: (z.shop.tiers || []).map((t: any) => int(t)),
      weapons: (z.shop.weapons || []).map(String),
      elements: (z.shop.elements || []).map(String),
      armor: !!z.shop.armor,
    } : null,
    lairs: (z.lairs || []).map(pt),
    portals: (z.portals || []).map((p: any) => ({
      x: int(p.x), y: int(p.y), to: String(p.to || ''), tx: int(p.tx), ty: int(p.ty), minLevel: int(p.minLevel),
      label: String(p.label || '').trim().slice(0, 50) || 'A path',
    })),
    monsters: (z.monsters || []).map(mon),
    boss: z.boss ? mon(z.boss) : null,
  };
}

async function saveZone(staff: Staff, input: any, isNew: boolean) {
  requireAdmin(staff);
  const def = cleanZone(input);
  const rows = await zoneDefs();
  const exists = rows.some((r: any) => r.id === def.id);
  if (isNew && exists) throw new AdminError('A zone with that id already exists.');
  if (!isNew && !exists) throw new AdminError('That zone no longer exists.');
  const all = [...rows.filter((r: any) => r.id !== def.id).map((r: any) => r.data), def];
  const errors = validateZone(def, all);
  if (errors.length) throw new AdminError(errors.join(' '));
  const sort = exists ? rows.find((r: any) => r.id === def.id).sort : Math.max(0, ...rows.map((r: any) => r.sort)) + 1;
  const { error } = await db.from('zones').upsert({ id: def.id, data: def, sort, updated_at: new Date().toISOString(), updated_by: staff.email });
  if (error) throw error;
  await bumpZonesVersion();
  await log(staff, isNew ? 'zone:create' : 'zone:edit', { name: def.name }, { id: def.id });
  return { zone: def, ...(await listZones()) };
}

async function deleteZone(staff: Staff, id: string) {
  requireAdmin(staff);
  const rows = await zoneDefs();
  const row = rows.find((r: any) => r.id === id);
  if (!row) throw new AdminError('No such zone.');
  const blockers = deleteBlockers(id, rows.map((r: any) => r.data));
  if (blockers.length) throw new AdminError(blockers.join(' '));
  const { error } = await db.from('zones').delete().eq('id', id);
  if (error) throw error;
  await db.from('hunts').update({ status: 'cancelled' }).eq('zone', id).eq('status', 'active');
  await bumpZonesVersion();
  await log(staff, 'zone:delete', { name: row.data.name }, { id, definition: row.data });
  return await listZones();
}

async function resetZone(staff: Staff, id: string) {
  requireAdmin(staff);
  const def = DEFAULT_ZONES.find((d: any) => d.id === id);
  if (!def) throw new AdminError('That zone has no built-in version.');
  const rows = await zoneDefs();
  const existing = rows.find((r: any) => r.id === id);
  const all = [...rows.filter((r: any) => r.id !== id).map((r: any) => r.data), def];
  const errors = validateZone(def, all);
  if (errors.length) throw new AdminError(`Can't restore: ${errors.join(' ')}`);
  const sort = existing ? existing.sort : DEFAULT_ZONES.indexOf(def);
  const { error } = await db.from('zones').upsert({ id, data: def, sort, updated_at: new Date().toISOString(), updated_by: staff.email });
  if (error) throw error;
  await bumpZonesVersion();
  await log(staff, 'zone:reset', { name: def.name }, { id, previous: existing?.data || null });
  return await listZones();
}

// ---------------------------------------------------------------- chat moderation
async function chatLog(a: any) {
  let q = db.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(200);
  if (a.channel) q = q.eq('channel', String(a.channel));
  if (a.sender) q = q.ilike('sender_name', `%${String(a.sender).replace(/[%_]/g, '')}%`);
  if (a.q) q = q.ilike('text', `%${String(a.q).replace(/[%_]/g, '')}%`);
  const { data, error } = await q;
  if (error) throw error;
  return { messages: data };
}

async function chatDelete(staff: Staff, id: number) {
  const { data: m } = await db.from('chat_messages').select('text, deleted_at, sender_id, sender_name').eq('id', id).maybeSingle();
  if (!m) throw new AdminError('No such message.');
  if (m.deleted_at) throw new AdminError('Already removed.');
  const { error } = await db.from('chat_messages').update({ original_text: m.text, text: '', deleted_at: new Date().toISOString(), deleted_by: staff.email }).eq('id', id);
  if (error) throw error;
  await log(staff, 'chat:delete', { id: m.sender_id, name: m.sender_name }, { id, text: m.text });
  return { ok: true };
}

async function chatReports() {
  const { data, error } = await db.from('chat_reports').select('*, message:chat_messages(*)')
    .is('resolved_at', null).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return { reports: data };
}

async function resolveReport(staff: Staff, id: number, note: string) {
  const { data: r } = await db.from('chat_reports').select('message_id').eq('id', id).maybeSingle();
  if (!r) throw new AdminError('No such report.');
  // Resolve every open report about the same message.
  const { error } = await db.from('chat_reports').update({ resolved_at: new Date().toISOString(), resolved_by: staff.email })
    .eq('message_id', r.message_id).is('resolved_at', null);
  if (error) throw error;
  await log(staff, 'chat:resolveReport', null, { message: r.message_id, note: note || null });
  return { ok: true };
}

// ---------------------------------------------------------------- public news (landing L-3)
// Admins only. Drafts are read here, never through the public API. The table's trigger enforces
// the publication rules too (supabase/migrations/20261115090000_news.sql); the checks below give
// the clear message first. A repeat (publishing what is already published, deleting what is gone)
// is refused, so a double press can't write a second audit entry.
const NEWS_COLS = 'id, slug, kind, title, summary, body, status, published_at, revised_at, maintenance_starts_at, maintenance_ends_at, created_at, updated_at';

async function listNews() {
  const { data, error } = await db.from('news').select(NEWS_COLS).order('updated_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}

async function loadNews(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new AdminError('No such news entry.', 404);
  const { data, error } = await db.from('news').select(NEWS_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AdminError('That news entry no longer exists.', 404);
  return data;
}

function newsWriteError(error: any): never {
  if (error?.code === '23505') throw new AdminError('That address is already used by another news entry.', 409);
  if (error?.code === '23514') throw new AdminError(String(error.message || 'That change is not allowed.'), 409);
  throw error;
}

async function saveNews(staff: Staff, id: number | null, entry: any) {
  const { value, errors } = checkNews(entry || {});
  const first = Object.values(errors)[0];
  if (first) throw new AdminError(String(first));
  const row: Record<string, unknown> = {
    slug: value.slug, kind: value.kind, title: value.title, summary: value.summary, body: value.body,
    maintenance_starts_at: value.startsAt, maintenance_ends_at: value.endsAt, updated_by: staff.id,
  };
  if (id == null) {
    const { data, error } = await db.from('news').insert({ ...row, created_by: staff.id }).select(NEWS_COLS).single();
    if (error) newsWriteError(error);
    await log(staff, 'news:create', { name: value.title }, { id: data.id, slug: value.slug, kind: value.kind });
    return { entry: data, news: await listNews() };
  }
  const old = await loadNews(id);
  if (old.published_at && value.slug !== old.slug) throw new AdminError("The address can't change once the entry has been published.", 409);
  const same = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && new Date(String(a)).getTime() === new Date(String(b)).getTime());
  const textChanged = old.title !== value.title || old.summary !== value.summary || old.body !== value.body || old.kind !== value.kind
    || !same(old.maintenance_starts_at, value.startsAt) || !same(old.maintenance_ends_at, value.endsAt);
  if (!textChanged && old.slug === value.slug) throw new AdminError('Nothing has changed.');
  if (old.published_at && textChanged) row.revised_at = new Date().toISOString();
  const { data, error } = await db.from('news').update(row).eq('id', id).select(NEWS_COLS).single();
  if (error) newsWriteError(error);
  await log(staff, 'news:edit', { name: value.title }, { id, slug: value.slug, revised: !!row.revised_at });
  return { entry: data, news: await listNews() };
}

async function setNewsStatus(staff: Staff, id: number, to: 'published' | 'unpublished') {
  const old = await loadNews(id);
  if (to === 'published' && old.status === 'published') throw new AdminError('That entry is already published.', 409);
  if (to === 'unpublished' && old.status !== 'published') throw new AdminError('Only a published entry can be unpublished.', 409);
  const patch: Record<string, unknown> = { status: to, updated_by: staff.id };
  if (to === 'published' && !old.published_at) patch.published_at = new Date().toISOString();
  const { data, error } = await db.from('news').update(patch).eq('id', id).eq('status', old.status).select(NEWS_COLS).maybeSingle();
  if (error) newsWriteError(error);
  if (!data) throw new AdminError('That entry just changed. Reload and try again.', 409);
  await log(staff, to === 'published' ? 'news:publish' : 'news:unpublish', { name: old.title }, { id, slug: old.slug, republished: to === 'published' && !!old.published_at });
  return { entry: data, news: await listNews() };
}

async function deleteNews(staff: Staff, id: number) {
  const old = await loadNews(id);
  if (!canDeleteNews(old.status)) throw new AdminError("A published entry can't be deleted. Unpublish it first.", 409);
  const { data, error } = await db.from('news').delete().eq('id', id).eq('status', old.status).select('id');
  if (error) newsWriteError(error);
  if (!data?.length) throw new AdminError('That entry just changed. Reload and try again.', 409);
  await log(staff, 'news:delete', { name: old.title }, { id, slug: old.slug, status: old.status });
  return { news: await listNews() };
}

// ---------------------------------------------------------------- dispatch
// ---------------------------------------------------------------- Kingdoms (K-1)
// docs/kingdoms-k1-plan.md 2.2 and section 3. Reads work for any staff member whether Kingdoms are
// open or not (while closed there's nothing to find). The three changes are admin-only, refused
// while Kingdoms are closed, and each runs through its database function, which writes its own
// audit entry in the same transaction (5.11: guaranteed). A destructive change names the exact
// ownership instance the staff member inspected (K1-DB01): it is taken from the request, never
// looked up, and a mismatch is refused by the database.
const PLOT_COLS = 'id, x, y, status, character_id, claimed_at';
const plotCoord = (v: any) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > KINGDOM_SIZE) throw new AdminError(`Plot coordinates are 1 to ${KINGDOM_SIZE}.`);
  return n;
};
const instanceId = (v: any) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new AdminError('Reload the plot and try again.');
  return n;
};
const reasonOf = (v: any) => {
  const text = String(v || '').trim().slice(0, 300);
  if (!text) throw new AdminError('Give a reason.');
  return text;
};
function requireKingdomsOpen() {
  if (!kingdomsOpen()) throw new AdminError('Kingdoms aren’t open yet.', 409);
}
// The database's error contract (docs/kingdoms-k1-report.md 1.1), for staff.
function kingdomRefusal(error: any, notFound: string): never {
  if (error?.code === 'MRSTL') throw new AdminError('That plot has changed since you looked. Reload it and check again.', 409);
  if (error?.code === 'MRNOP') throw new AdminError(notFound, 409);
  if (error?.code === 'MRPLT') throw new AdminError('That plot is already taken or reserved.', 409);
  if (error?.code === 'MRARG') throw new AdminError('That Kingdom’s stored data is malformed, so nothing was changed.', 400);
  throw error;
}

async function plotOwners(plots: any[]) {
  const ids = [...new Set(plots.map((p) => p.character_id).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await db.from('characters').select('id, name, level').in('id', ids);
  if (error) throw error;
  return Object.fromEntries((data || []).map((c: any) => [c.id, { id: c.id, name: c.name, level: c.level }]));
}

async function kingdomPlot(x: number, y: number) {
  const { data: plot, error } = await db.from('kingdom_plots').select(PLOT_COLS).eq('x', x).eq('y', y).maybeSingle();
  if (error) throw error;
  if (!plot) return { plot: null };
  let owner = null, kingdom = null;
  if (plot.character_id) {
    const { data: hero, error: e2 } = await db.from('characters').select('id, name, level, data').eq('id', plot.character_id).maybeSingle();
    if (e2) throw e2;
    if (hero) { owner = { id: hero.id, name: hero.name, level: hero.level }; kingdom = hero.data?.kingdom ?? null; }
  }
  return { plot, owner, kingdom };
}

async function kingdomSearch(q: string) {
  const term = String(q || '').trim().replace(/[%_]/g, '');
  let plots: any[];
  if (term) {
    const { data: heroes, error } = await db.from('characters').select('id').ilike('name', `%${term}%`).limit(50);
    if (error) throw error;
    const ids = (heroes || []).map((h: any) => h.id);
    if (!ids.length) return { plots: [] };
    const res = await db.from('kingdom_plots').select(PLOT_COLS).in('character_id', ids).limit(50);
    if (res.error) throw res.error;
    plots = res.data || [];
  } else {
    const res = await db.from('kingdom_plots').select(PLOT_COLS).order('claimed_at', { ascending: false }).limit(50);
    if (res.error) throw res.error;
    plots = res.data || [];
  }
  const owners = await plotOwners(plots);
  return { plots: plots.map((p) => ({ ...p, owner: owners[p.character_id] || null })) };
}

async function kingdomRevoke(staff: Staff, a: any) {
  requireAdmin(staff);
  requireKingdomsOpen();
  const x = plotCoord(a.x), y = plotCoord(a.y), plotId = instanceId(a.plotId);
  const characterId = String(a.characterId || '');
  if (!characterId) throw new AdminError('Reload the plot and try again.');
  const { data, error } = await db.rpc('kingdom_revoke', {
    p_x: x, p_y: y, p_plot_id: plotId, p_character_id: characterId,
    p_staff: staff.id, p_staff_name: staff.email, p_reason: reasonOf(a.reason),
  });
  if (error) kingdomRefusal(error, 'That plot isn’t claimed.');
  // The refund is exact (K1-DB02): a whole number of gold within JavaScript's exact range, as the
  // database guarantees. It is ledgered only after the revoke has committed, best effort (5.11).
  const refund = Number(data);
  if (!Number.isSafeInteger(refund) || refund < 0) throw new Error(`kingdom_revoke returned an unexpected refund: ${data}`);
  if (refund > 0) {
    const { error: e2 } = await db.rpc('ledger_add', { p_source: 'kingdom', p_amount: refund });
    if (e2) console.error('ledger failed', e2);
  }
  return { refund };
}

async function kingdomReserve(staff: Staff, a: any) {
  requireAdmin(staff);
  requireKingdomsOpen();
  const { data, error } = await db.rpc('kingdom_reserve', {
    p_x: plotCoord(a.x), p_y: plotCoord(a.y), p_staff: staff.id, p_staff_name: staff.email, p_reason: reasonOf(a.reason),
  });
  if (error) kingdomRefusal(error, 'That plot can’t be reserved.');
  return { plotId: Number(data) };
}

async function kingdomUnreserve(staff: Staff, a: any) {
  requireAdmin(staff);
  requireKingdomsOpen();
  const { error } = await db.rpc('kingdom_unreserve', {
    p_x: plotCoord(a.x), p_y: plotCoord(a.y), p_plot_id: instanceId(a.plotId),
    p_staff: staff.id, p_staff_name: staff.email, p_reason: reasonOf(a.reason),
  });
  if (error) kingdomRefusal(error, 'That plot isn’t reserved.');
  return { ok: true };
}

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
    case 'world': return await getWorld();
    case 'setBase': {
      requireAdmin(staff);
      const w = await getWorld();
      const base = { ...w.data.base, ...cleanMults(a.base) };
      return await saveWorld(staff, { ...w.data, base }, 'world:base', base);
    }
    case 'startEvent': {
      requireAdmin(staff);
      const name = String(a.name || '').trim().slice(0, 60);
      if (!name) throw new AdminError('Name the event.');
      const hours = Number(a.hours);
      if (!(hours > 0 && hours <= 24 * 30)) throw new AdminError('Duration must be between 0 and 720 hours.');
      const mults = cleanMults(a.mults);
      if (!Object.keys(mults).length) throw new AdminError('Set at least one multiplier.');
      const w = await getWorld();
      const now = Date.now();
      const ev = { id: crypto.randomUUID(), name, until: new Date(now + hours * 3600000).toISOString(), ...mults };
      const events = [...(w.data.events || []).filter((e: any) => new Date(e.until).getTime() > now), ev];
      const res = await saveWorld(staff, { ...w.data, events }, 'world:event', ev);
      await db.from('events').insert({ kind: 'announce', text: `Event started: ${name}! Ends in ${hours} hour${hours === 1 ? '' : 's'}.` });
      return res;
    }
    case 'endEvent': {
      requireAdmin(staff);
      const w = await getWorld();
      const ev = (w.data.events || []).find((e: any) => e.id === a.id);
      if (!ev) throw new AdminError('No such event.');
      const events = (w.data.events || []).filter((e: any) => e.id !== a.id);
      return await saveWorld(staff, { ...w.data, events }, 'world:endEvent', { name: ev.name });
    }
    case 'hunts': return { hunts: await listHunts(), suggest: Object.fromEntries([10, 20, 30, 40, 50, 60, 75].map((l) => [l, suggestedHuntHp(l)])) };
    case 'startHunt': requireAdmin(staff); return await startHunt(staff, a);
    case 'cancelHunt': requireAdmin(staff); return await cancelHunt(staff, String(a.id));
    case 'economy': return await economy(Number(a.days) || 14);
    case 'zones': return await listZones();
    case 'chatLog': return await chatLog(a);
    case 'chatDelete': return await chatDelete(staff, Number(a.id));
    case 'chatReports': return await chatReports();
    case 'resolveReport': return await resolveReport(staff, Number(a.id), String(a.note || ''));
    case 'saveZone': return await saveZone(staff, a.zone, !!a.isNew);
    case 'deleteZone': return await deleteZone(staff, String(a.id));
    case 'resetZone': return await resetZone(staff, String(a.id));
    case 'setStaff': return await setStaff(staff, a.email, a.role ?? null);
    case 'news': requireAdmin(staff); return { news: await listNews() };
    case 'newsSave': requireAdmin(staff); return await saveNews(staff, a.id == null ? null : Number(a.id), a.entry);
    case 'newsPublish': requireAdmin(staff); return await setNewsStatus(staff, Number(a.id), 'published');
    case 'newsUnpublish': requireAdmin(staff); return await setNewsStatus(staff, Number(a.id), 'unpublished');
    case 'newsDelete': requireAdmin(staff); return await deleteNews(staff, Number(a.id));
    case 'kingdomPlot': return await kingdomPlot(plotCoord(a.x), plotCoord(a.y));
    case 'kingdomSearch': return await kingdomSearch(a.q);
    case 'kingdomRevoke': return await kingdomRevoke(staff, a);
    case 'kingdomReserve': return await kingdomReserve(staff, a);
    case 'kingdomUnreserve': return await kingdomUnreserve(staff, a);
    case 'meta': return {
      zones: Object.values(ZONES).map((z: any) => ({ id: z.id, name: z.name, size: z.size })),
      items: Object.values(ITEMS).map((i: any) => ({ id: i.id, name: i.name, tier: i.tier, slot: i.slot })),
      // The Kingdoms capability (Q3): the console asks for Kingdom data only when this is present.
      // Older functions (admin v8) have no such key.
      kingdoms: { version: 1, open: kingdomsOpen() },
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
    await refreshZones();
    return json(await handle(staff, String(body?.action || ''), body?.args || {}));
  } catch (err) {
    if (err instanceof AdminError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: err instanceof Error && !('code' in err) ? err.message : 'Server error.' }, 500);
  }
});
