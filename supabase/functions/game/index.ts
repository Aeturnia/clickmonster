// ClickMonster game server. Every game action goes through here so the server is the
// authority on all rolls, gold and stats. Rules are the shared engine in ./js
// (a symlink to public/js), the exact same code the browser uses for display.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createCharacter, ensureCharacter, applyRegen, spendLevel } from './js/engine/character.js';
import { move, walkTo, usePortal, heal } from './js/engine/world.js';
import { startBattle, battleAction } from './js/engine/battle.js';
import { buy, buyAndEquip, sell, equip, unequip, socketGem, extractGem, deposit, withdraw } from './js/engine/inventory.js';
import { duel } from './js/engine/pvp.js';
import { hourBucket, generateQuests, accept, questMatches, grantQuestReward, questTitle } from './js/engine/quests.js';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Row = {
  id: string; data: any; version: number;
  banned_until?: string | null; jailed_until?: string | null; muted_until?: string | null; sanction_reason?: string | null;
};

async function loadRow(filter: { user_id?: string; id?: string }): Promise<Row | null> {
  let q = admin.from('characters').select('id, data, version, banned_until, jailed_until, muted_until, sanction_reason');
  if (filter.user_id) q = q.eq('user_id', filter.user_id);
  if (filter.id) q = q.eq('id', filter.id);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) ensureCharacter((data as Row).data);
  return data as Row | null;
}

function publicColumns(char: any) {
  return { name: char.name, level: char.level, zone: char.loc.zone, x: char.loc.x, y: char.loc.y };
}

// Optimistic locking: only save if nobody else changed the row since we read it.
async function saveRow(row: Row, char: any) {
  const { data, error } = await admin.from('characters')
    .update({ data: char, ...publicColumns(char), version: row.version + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('version', row.version).select('id');
  if (error) throw error;
  if (!data?.length) throw new GameError('Your hero was busy — try again.', 409);
  row.version += 1;
}

async function announce(kind: string, text: string) {
  const { error } = await admin.from('events').insert({ kind, text });
  if (error) console.error('announce failed', error);
}

// ---------------------------------------------------------------- sanctions
const active = (t?: string | null) => !!t && new Date(t).getTime() > Date.now();
const untilText = (t: string) => (new Date(t).getFullYear() > 9000 ? 'permanently' : `until ${new Date(t).toUTCString().replace(':00 GMT', ' UTC')}`);

function sanctionsOf(row: Row) {
  return {
    banned: active(row.banned_until) ? row.banned_until : null,
    jailed: active(row.jailed_until) ? row.jailed_until : null,
    muted: active(row.muted_until) ? row.muted_until : null,
    reason: row.sanction_reason || null,
  };
}

// Jailed heroes can look around and spend level points, nothing else.
const JAIL_ALLOWED = new Set(['level', 'dismiss', 'done']);
function enforceSanctions(row: Row, action: string) {
  const s = sanctionsOf(row);
  const why = s.reason ? ` Reason: ${s.reason}` : '';
  if (s.banned) throw new GameError(`This hero is banned ${untilText(s.banned)}.${why}`, 403);
  if (s.jailed && !JAIL_ALLOWED.has(action)) throw new GameError(`You are in jail ${untilText(s.jailed)}.${why}`, 403);
}

// ---------------------------------------------------------------- quests
const toQuest = (r: any) => ({
  id: r.id, bucket: r.bucket, slot: r.slot, zone: r.zone, variant: r.variant,
  minLevel: r.min_level, maxLevel: r.max_level, reward: r.reward,
  expiresAt: new Date(r.expires_at).getTime(), completedBy: r.completed_by_name || null,
});

// Make sure this hour's batch exists (idempotent; unique on bucket+slot).
async function ensureQuests(now: number) {
  const bucket = hourBucket(now);
  const { count, error } = await admin.from('quests').select('id', { count: 'exact', head: true }).eq('bucket', bucket);
  if (error) throw error;
  if (count) return;
  const rows = generateQuests(bucket).map((q: any) => ({
    bucket: q.bucket, slot: q.slot, zone: q.zone, variant: q.variant,
    min_level: q.minLevel, max_level: q.maxLevel, reward: q.reward, expires_at: new Date(q.expiresAt).toISOString(),
  }));
  const { error: insErr } = await admin.from('quests').upsert(rows, { onConflict: 'bucket,slot', ignoreDuplicates: true });
  if (insErr) throw insErr;
}

async function questBoard(now: number) {
  await ensureQuests(now);
  const { data, error } = await admin.from('quests').select('*')
    .gt('expires_at', new Date(now - 30 * 60000).toISOString())
    .order('expires_at', { ascending: true }).limit(30);
  if (error) throw error;
  return data.map(toQuest);
}

// Drop the hero's quest if it expired or someone else finished it. Returns a notice or null.
async function checkQuestStillOpen(char: any, now: number) {
  if (!char.quest) return null;
  const { data } = await admin.from('quests').select('completed_by_name, expires_at').eq('id', char.quest.id).maybeSingle();
  if (!data) { char.quest = null; return 'Your quest is no longer on the board.'; }
  if (data.completed_by_name) { char.quest = null; return `${data.completed_by_name} finished your quest first.`; }
  if (new Date(data.expires_at).getTime() <= now) { char.quest = null; return 'Your quest expired.'; }
  return null;
}

// After a won fight: if it satisfies the hero's quest, try to claim it (first one wins).
async function tryCompleteQuest(row: Row, char: any, now: number) {
  if (!questMatches(char, char.battle)) return;
  const q = char.quest;
  const { data, error } = await admin.from('quests')
    .update({ completed_by: row.id, completed_by_name: char.name, completed_at: new Date(now).toISOString() })
    .eq('id', q.id).is('completed_by_name', null).gt('expires_at', new Date(now).toISOString())
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    char.quest = null;
    char.battle.log.push({ kind: 'bad', text: 'Someone else finished your quest first.' });
    return;
  }
  const r = grantQuestReward(char, now);
  char.battle.log.push({ kind: 'win', text: `Quest complete! You earn ${r.xp} experience and ${r.gold} gold${r.gem ? ' and a gem' : ''}.` });
  await announce('quest', `${char.name} completed a quest: ${questTitle(q)}.`);
}

// ---------------------------------------------------------------- actions
const FAST_ACTIONS = new Set(['melee', 'cast', 'flee', 'fight', 'again', 'move', 'walk']);
const MIN_ACTION_MS = 150;

const ACTIONS: Record<string, (c: any, a: any) => unknown> = {
  move: (c, a) => move(c, a.dir),
  walk: (c, a) => walkTo(c, a.x, a.y),
  fight: (c, a) => startBattle(c, a.monsterId),
  melee: (c) => battleAction(c, 'melee'),
  cast: (c) => battleAction(c, 'cast'),
  flee: (c) => battleAction(c, 'flee'),
  again: (c) => {
    const id = c.battle?.monsterId;
    if (!id || !c.battle.over) throw new GameError('Nothing to fight again.');
    c.battle = null;
    startBattle(c, id);
  },
  done: (c) => { if (c.battle?.over) c.battle = null; },
  portal: (c) => usePortal(c),
  heal: (c) => heal(c),
  buy: (c, a) => buy(c, String(a.itemId)),
  buyequip: (c, a) => buyAndEquip(c, String(a.itemId)),
  sell: (c, a) => sell(c, Number(a.uid)),
  equip: (c, a) => equip(c, Number(a.uid)),
  unequip: (c, a) => unequip(c, String(a.slot)),
  socket: (c, a) => socketGem(c, Number(a.uid), String(a.gem)),
  extract: (c, a) => extractGem(c, Number(a.uid), Number(a.index)),
  level: (c, a) => spendLevel(c, String(a.stat)),
  deposit: (c, a) => deposit(c, a.amount),
  withdraw: (c, a) => withdraw(c, a.amount),
  abandon: (c) => { c.quest = null; },
  dismiss: (c) => { c.notices = []; },
};

async function handle(userId: string, action: string, args: any) {
  const now = Date.now();

  if (action === 'state') {
    const row = await loadRow({ user_id: userId });
    if (!row) return { char: null };
    if (sanctionsOf(row).banned) return { char: row.data, sanctions: sanctionsOf(row) };
    applyRegen(row.data, now);
    const notice = await checkQuestStillOpen(row.data, now);
    if (notice) {
      row.data.notices = [...(row.data.notices || []).slice(-9), { at: now, text: notice }];
      await saveRow(row, row.data);
    }
    return { char: row.data, sanctions: sanctionsOf(row) };
  }

  if (action === 'create') {
    if (await loadRow({ user_id: userId })) throw new GameError('You already have a hero.', 409);
    const char = createCharacter(args.name, args.race, now);
    const { error } = await admin.from('characters')
      .insert({ user_id: userId, race: char.race, data: char, ...publicColumns(char) });
    if (error) {
      if (error.code === '23505') throw new GameError('That name is already taken.', 409);
      throw error;
    }
    return { char };
  }

  if (action === 'delete') {
    const existing = await loadRow({ user_id: userId });
    if (existing) enforceSanctions(existing, 'delete');
    const { error } = await admin.from('characters').delete().eq('user_id', userId);
    if (error) throw error;
    return { char: null };
  }

  if (action === 'quests') {
    return { quests: await questBoard(now) };
  }

  const row = await loadRow({ user_id: userId });
  if (!row) throw new GameError('Create a hero first.', 404);
  enforceSanctions(row, action);
  const char = row.data;

  if (FAST_ACTIONS.has(action)) {
    if (now - (char.lastActionAt || 0) < MIN_ACTION_MS) throw new GameError('Slow down!', 429);
    char.lastActionAt = now;
  }
  applyRegen(char, now);

  if (action === 'accept') {
    await ensureQuests(now);
    const { data, error } = await admin.from('quests').select('*').eq('id', String(args.questId)).maybeSingle();
    if (error) throw error;
    if (!data) throw new GameError('That quest is gone.');
    accept(char, toQuest(data), now);
    await saveRow(row, char);
    return { char, sanctions: sanctionsOf(row) };
  }

  if (action === 'attack') {
    const target = await loadRow({ id: String(args.targetId) });
    if (!target || target.id === row.id) throw new GameError('They are no longer here.');
    const ts = sanctionsOf(target);
    if (ts.banned || ts.jailed) throw new GameError('They are no longer here.');
    applyRegen(target.data, now);
    const res = duel(char, target.data);
    await saveRow(target, target.data);
    await saveRow(row, char);
    const [w, l] = res.winner === 'attacker' ? [char, target.data] : [target.data, char];
    await announce('pvp', `${w.name} defeated ${l.name} in a duel${res.goldTaken ? ` and took ${res.goldTaken} gold` : ''}.`);
    return { char };
  }

  const fn = ACTIONS[action];
  if (!fn) throw new GameError('Unknown action.');
  fn(char, args || {});

  const b = char.battle;
  if ((action === 'melee' || action === 'cast') && b?.over === 'victory') {
    if (char.quest) await tryCompleteQuest(row, char, now);
    if (b.rewards?.relic) await announce('relic', `${char.name} found a rare ${b.rewards.relic}.`);
  }
  await saveRow(row, char);
  return { char, sanctions: sanctionsOf(row) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    return json(await handle(auth.user.id, String(body?.action || ''), body?.args || {}));
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message }, err.status);
    // Engine rule violations ("Not enough gold.") are plain Errors with player-safe messages.
    if (err instanceof Error && !('code' in err)) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: 'Server error — please try again.' }, 500);
  }
});
