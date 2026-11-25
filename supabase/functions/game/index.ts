// ClickMonster game server. Every game action goes through here so the server is the
// authority on all rolls, gold and stats. Rules are the shared engine in ./js
// (a symlink to public/js), the exact same code the browser uses for display.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createCharacter, ensureCharacter, applyRegen, spendLevel } from './js/engine/character.js';
import { move, walkTo, usePortal, heal } from './js/engine/world.js';
import { startBattle, battleAction, randomRelic, MAX_INVENTORY } from './js/engine/battle.js';
import { setWorld } from './js/engine/world-config.js';
import { loadZones } from './js/data/zones.js';
import { canSend, CHAT_CHANNELS } from './js/engine/chat.js';
import { startHuntBattle, huntExchange, huntShares } from './js/engine/hunt.js';
import { buy, buyAndEquip, sell, equip, unequip, socketGem, extractGem, deposit, withdraw } from './js/engine/inventory.js';
import { duel } from './js/engine/pvp.js';
import { hourBucket, generateQuests, accept, questMatches, grantQuestReward, questTitle } from './js/engine/quests.js';
import { sessionFailure } from './js/engine/session.js';
import { stagePending, settleWaiting } from './js/engine/rewards.js';
import { setKingdomConfig, testConfigFrom, kingdomConfig } from './js/data/kingdoms.js';
import { reloadZones } from './js/data/zones.js';
import { claimKingdom, releaseKingdom } from './js/engine/kingdom.js';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Kingdoms K-1 (docs/kingdoms-k1-plan.md 2.2; decision 9.1). The shipped configuration keeps
// Kingdoms closed. The local test configuration applies only with KINGDOMS_TEST=1 AND the local
// stack's gateway (`kong`) as SUPABASE_URL, which production can't have; never from a request.
// The zones are registered again under it: the import-time registry was built before it.
setKingdomConfig(testConfigFrom(Deno.env.get('KINGDOMS_TEST'), Deno.env.get('SUPABASE_URL')));
reloadZones();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class GameError extends Error {
  status: number;
  reason?: string; // a stable code for the client, where it must act on the kind of refusal
  constructor(message: string, status = 400, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Pending rewards staged in memory for this request (#102). Only the row that handle() stages for
// (the acting hero) ever has one: a duel's target never does, so its save never claims rewards.
type Staging = {
  ids: number[]; // staged reward ids, claimed only by this row's commit
  blocked: Array<{ id: number; slots: number }>; // the last pass's rewards that didn't fit
  recheck: boolean; // a second pass is needed before the commit: something was blocked, or rewards were created
  settled: boolean; // the last pass and the waiting list are done
};

type Row = {
  id: string; data: any; version: number;
  banned_until?: string | null; jailed_until?: string | null; muted_until?: string | null; sanction_reason?: string | null;
  staging?: Staging;
  pendingLedger?: Array<[string, number]>; // written only after this row's save commits
  locMoved?: boolean; // ensureCharacter() moved the hero on load: the correction must be saved (K1-B04)
};

async function loadRow(filter: { user_id?: string; id?: string }): Promise<Row | null> {
  let q = admin.from('characters').select('id, data, version, banned_until, jailed_until, muted_until, sanction_reason');
  if (filter.user_id) q = q.eq('user_id', filter.user_id);
  if (filter.id) q = q.eq('id', filter.id);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) {
    // Only the location is compared: ensureCharacter() also fills defaults into older heroes,
    // which mustn't make every read of them save.
    const row = data as Row;
    const before = JSON.stringify(row.data?.loc ?? null);
    ensureCharacter(row.data);
    row.locMoved = JSON.stringify(row.data.loc) !== before;
  }
  return data as Row | null;
}

function publicColumns(char: any) {
  return { name: char.name, level: char.level, zone: char.loc.zone, x: char.loc.x, y: char.loc.y };
}

// The answers to a refused commit. A reward conflict or a changed hero is the same answer as a busy
// hero (#102). The Kingdom codes are the database's error contract (docs/kingdoms-k1-report.md
// 1.1); `reason` lets the client act on the kind of refusal: on plot_changed it reloads the state
// and asks again, never retrying with another plot (the K1-1 review's carry-forward).
const COMMIT_REFUSALS: Record<string, [string, number, string?]> = {
  MRREW: ['Your hero was busy — try again.', 409],
  MRVER: ['Your hero was busy — try again.', 409],
  MRPLT: ['That plot was just taken.', 409, 'plot_taken'],
  MRHAS: ['You already have a Kingdom.', 409, 'has_kingdom'],
  MRNOP: ['You don’t have a Kingdom.', 409, 'no_plot'],
  MRSTL: ['Your Kingdom has changed since you looked. Check it and try again.', 409, 'plot_changed'],
};

// A Kingdom change commits through its own function, with the hero's save (5.3.1).
type KingdomCommit =
  | { fn: 'kingdom_claim'; plotX: number; plotY: number }
  | { fn: 'kingdom_release'; plotId: number };

// The one commit path (docs/kingdoms-k1-plan.md 2.2), used by every save: finish staging; commit
// through the right function; map its refusals; take the new version; and only then write the
// queued ledger entries. Optimistic locking throughout: the hero is saved only if nobody changed
// it since it was read. With staged rewards, the save and their claims commit together, or neither
// does (#102, R-1); a Kingdom claim or release passes the same staged ids to its own function.
async function commitRow(row: Row, char: any, kingdom?: KingdomCommit) {
  if (row.staging) await finishStaging(row, char, Date.now());
  const ids = row.staging?.ids || [];
  const pub = publicColumns(char);
  const hero = {
    p_char: row.id, p_version: row.version, p_data: char,
    p_name: pub.name, p_level: pub.level, p_zone: pub.zone, p_x: pub.x, p_y: pub.y,
  };
  let call: [string, Record<string, unknown>] | null = null;
  if (kingdom?.fn === 'kingdom_claim') call = ['kingdom_claim', { ...hero, p_plot_x: kingdom.plotX, p_plot_y: kingdom.plotY, p_reward_ids: ids }];
  else if (kingdom?.fn === 'kingdom_release') call = ['kingdom_release', { ...hero, p_plot_id: kingdom.plotId, p_reward_ids: ids }];
  else if (ids.length) call = ['save_hero_with_rewards', { ...hero, p_reward_ids: ids }];

  if (call) {
    const { data, error } = await admin.rpc(call[0], call[1]);
    if (error) {
      // Nothing was written, so staged rewards stay pending. Anything unmapped (MRARG) is a server error.
      const refusal = COMMIT_REFUSALS[String(error.code)];
      if (refusal) throw new GameError(refusal[0], refusal[1], refusal[2]);
      throw error;
    }
    row.version = Number(data);
    if (row.staging) row.staging.ids = [];
  } else {
    const { data, error } = await admin.from('characters')
      .update({ data: char, ...publicColumns(char), version: row.version + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('version', row.version).select('id');
    if (error) throw error;
    if (!data?.length) throw new GameError('Your hero was busy — try again.', 409);
    row.version += 1;
  }
  await flushLedger(row);
}

// Every ordinary save. Every other way of writing a hero's data must keep R-1
// (docs/pending-rewards-scope.md): here, through commitRow().
async function saveRow(row: Row, char: any) {
  await commitRow(row, char);
}

async function announce(kind: string, text: string) {
  const { error } = await admin.from('events').insert({ kind, text });
  if (error) console.error('announce failed', error);
}

// ---------------------------------------------------------------- world settings (cached briefly)
// Read on every request (one small row) so admin changes apply immediately.
let worldData: any = null;
async function loadWorld(now: number) {
  const { data } = await admin.from('world_config').select('data').eq('id', 1).maybeSingle();
  worldData = data?.data || null;
  setWorld(worldData, now);
}

// ---------------------------------------------------------------- zones (editable world, cached briefly)
// Zones reload whenever an admin bumps world_config.zonesVersion (and at least every 10 minutes).
let zonesLoaded = { version: null as any, at: 0 };
async function loadWorldZones(now: number) {
  const version = worldData?.zonesVersion ?? 0;
  if (zonesLoaded.version === version && now - zonesLoaded.at < 600000) return;
  const { data, error } = await admin.from('zones').select('data').order('sort');
  if (error) { console.error('zones load failed', error); return; }
  if (data?.length) loadZones(data.map((r: any) => r.data));
  zonesLoaded = { version, at: now };
}

// ---------------------------------------------------------------- economy ledger
async function ledger(source: string, amount: number) {
  if (!amount) return;
  const { error } = await admin.rpc('ledger_add', { p_source: source, p_amount: Math.round(amount) });
  if (error) console.error('ledger failed', error);
}
const wealth = (c: any) => (c.gold || 0) + (c.bank || 0);
const LEDGER_SOURCE: Record<string, string> = {
  melee: 'monsters', cast: 'monsters', buy: 'shop', buyequip: 'shop', sell: 'selling', heal: 'healer', extract: 'jeweler',
};

// Ledger entries that depend on a hero's save are queued on that row and written after it commits
// (#102, question 2), so a failed save never records gold the hero didn't receive. Best effort, as
// before: a ledger write that fails after the commit is logged and lost.
function queueLedger(row: Row, source: string, amount: number) {
  if (!amount) return;
  (row.pendingLedger ||= []).push([source, amount]);
}
async function flushLedger(row: Row) {
  const entries = row.pendingLedger || [];
  row.pendingLedger = [];
  for (const [source, amount] of entries) await ledger(source, amount);
}

// ---------------------------------------------------------------- pending rewards (hunts, gifts)
// #102 (docs/pending-rewards-scope.md, 5.1 to 5.6): rewards are staged in memory, never claimed
// here. saveRow() claims exactly the staged ids in the same transaction as the hero's save. A
// reward whose items don't fit in the pack stays pending, whole (engine/rewards.js).
// Every open reward of a hero, oldest first. PostgREST caps each answer (max_rows in config.toml),
// so this reads in pages by id (keyset) until a page comes back empty: a long run of blocked rewards
// can never hide a later eligible one (review of PR #108, B-01). A failed page throws, so a partial
// read is never taken as the whole waiting list: the request fails and nothing is committed.
const REWARD_PAGE = 500;
async function openRewards(charId: string): Promise<any[]> {
  const all: any[] = [];
  let after = 0;
  for (;;) {
    const { data, error } = await admin.from('pending_rewards').select('id, source, gold, xp, items, gems, note')
      .eq('character_id', charId).is('claimed_at', null).gt('id', after).order('id').limit(REWARD_PAGE);
    if (error) throw error;
    if (!data?.length) return all;
    all.push(...data);
    after = Number(data[data.length - 1].id);
  }
}

async function stageRewards(row: Row, char: any, now: number) {
  const st = (row.staging ||= { ids: [], blocked: [], recheck: false, settled: false });
  const open = await openRewards(row.id);
  const fresh = open.filter((r: any) => !st.ids.includes(Number(r.id)));
  const { staged, blocked } = stagePending(char, fresh, now, MAX_INVENTORY);
  for (const r of staged) {
    st.ids.push(Number(r.id));
    queueLedger(row, r.source || 'rewards', Number(r.gold || 0));
  }
  st.blocked = blocked;
  if (blocked.length) st.recheck = true;
}

// Once, just before the acting hero's commit: a second pass if something was blocked (space may
// have been freed by the action) or rewards were created (a killing blow), then the waiting list
// and its one-time notice. Returns whether the waiting list changed.
async function finishStaging(row: Row, char: any, now: number): Promise<boolean> {
  const st = row.staging;
  if (!st || st.settled) return false;
  if (st.recheck) await stageRewards(row, char, now);
  st.settled = true;
  return settleWaiting(char, st.blocked, now);
}

// ---------------------------------------------------------------- hunts (world bosses)
async function activeHunt(id: string) {
  const { data } = await admin.from('hunts').select('*').eq('id', id).maybeSingle();
  if (!data || data.status !== 'active' || new Date(data.ends_at).getTime() < Date.now()) return null;
  return data;
}

async function finishHunt(huntId: string) {
  const { data: hunt } = await admin.from('hunts').select('*').eq('id', huntId).single();
  const { data: hits } = await admin.from('hunt_hits').select('*').eq('hunt_id', huntId);
  const rows: any[] = huntShares(hits || [], hunt.reward).map((s: any) => ({
    character_id: s.character_id, source: 'hunt', gold: s.gold, xp: s.xp, items: [], gems: {},
    note: `Your ${Math.round(s.share * 100)}% share of the hunt for ${hunt.name}`,
  }));
  if (hunt.killed_by) {
    rows.push({
      character_id: hunt.killed_by, source: 'hunt', gold: Math.round((hunt.reward.gold || 0) * 0.25), xp: 0, gems: {},
      items: hunt.reward.relic === false ? [] : [{ base: randomRelic(Math.random, hunt.level), q: 'relic' }],
      note: `Killing blow on ${hunt.name}`,
    });
  }
  if (rows.length) {
    const { error } = await admin.from('pending_rewards').insert(rows);
    if (error) throw error;
  }
  await announce('hunt', `${hunt.killed_by_name} landed the killing blow on ${hunt.name}! ${rows.length - 1} hunters share the reward.`);
}

// Returns gold delivered as rewards during this action (so it isn't counted twice).
async function huntAction(row: Row, char: any, action: string): Promise<number> {
  const b = char.battle;
  const hunt = await activeHunt(b.hunt);
  if (!hunt) {
    b.over = 'ended';
    b.log.push({ kind: 'info', text: 'The hunt is over.' });
    return 0;
  }
  if (action === 'again') {
    char.battle = null;
    startHuntBattle(char, hunt);
    return 0;
  }
  const mode = action === 'flee' ? 'flee' : action;
  const dealt = huntExchange(char, hunt, mode);
  if (dealt > 0) {
    const { data, error } = await admin.rpc('hunt_hit', { p_hunt: hunt.id, p_char: row.id, p_name: char.name, p_damage: dealt });
    if (error) throw error;
    const r = data?.[0];
    if (r) { b.hp = Number(r.hp); b.maxHp = Number(r.max_hp); }
    if (r?.killed) {
      b.over = 'victory';
      b.log.push({ kind: 'win', text: `You landed the killing blow on ${hunt.name}!` });
      await finishHunt(hunt.id);
      // The hunt's rewards (this hero's share, and the killing blow's) are staged at the commit, in
      // saveRow()'s second pass, after this action's ledger delta is taken (#102, 5.5).
      (row.staging ||= { ids: [], blocked: [], recheck: false, settled: false }).recheck = true;
      return 0;
    } else if (r && r.status !== 'active') {
      if (!b.over) b.over = 'ended';
      b.log.push({ kind: 'info', text: r.status === 'defeated' ? `${hunt.name} has already fallen.` : 'The hunt is over.' });
    }
  }
  return 0;
}

// ---------------------------------------------------------------- chat
const untilWhen = (t: string) => (new Date(t).getFullYear() > 9000 ? 'permanently' : `until ${new Date(t).toUTCString().replace(':00 GMT', ' UTC')}`);

async function staffRole(userId: string) {
  const { data } = await admin.from('staff').select('role').eq('user_id', userId).maybeSingle();
  return data?.role || null;
}

async function findCharacterByName(name: string) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const { data } = await admin.from('characters').select('id, name').ilike('name', clean.replace(/[%_]/g, '')).limit(1);
  return data?.[0] || null;
}

async function chatAction(userId: string, row: Row, action: string, args: any) {
  const char = row.data;
  if (action === 'chat') {
    const s = sanctionsOf(row);
    if (s.muted) throw new GameError(`You are muted ${untilWhen(s.muted)}.${s.reason ? ` Reason: ${s.reason}` : ''}`, 403);
    const channel = String(args.channel || '');
    if (!CHAT_CHANNELS.includes(channel)) throw new GameError('Unknown channel.');
    const { data: last } = await admin.from('chat_messages').select('text, created_at')
      .eq('sender_id', row.id).order('created_at', { ascending: false }).limit(1);
    const check = canSend(char.level, args.text, last?.[0] || null);
    if (!check.ok) throw new GameError(check.reason, 400);
    const msg: any = {
      channel, sender_id: row.id, sender_name: char.name, sender_role: await staffRole(userId), text: check.text,
    };
    if (channel === 'zone') msg.zone = char.loc.zone;
    if (channel === 'whisper') {
      const to = await findCharacterByName(args.to);
      if (!to) throw new GameError('No hero by that name.');
      if (to.id === row.id) throw new GameError('You can’t whisper to yourself.');
      const { data: ignored } = await admin.from('chat_ignores').select('owner_id').eq('owner_id', to.id).eq('ignored_id', row.id).maybeSingle();
      if (ignored) throw new GameError(`${to.name} isn’t accepting your messages.`);
      msg.recipient_id = to.id;
      msg.recipient_name = to.name;
    }
    const { data, error } = await admin.from('chat_messages').insert(msg).select('id').single();
    if (error) throw error;
    // Now and then, clear out messages older than 14 days.
    if (Math.random() < 0.02) {
      await admin.from('chat_messages').delete().lt('created_at', new Date(Date.now() - 14 * 86400000).toISOString());
    }
    return { ok: true, id: data.id };
  }
  if (action === 'ignore' || action === 'unignore') {
    const target = await findCharacterByName(args.name);
    if (!target) throw new GameError('No hero by that name.');
    if (target.id === row.id) throw new GameError('You can’t ignore yourself.');
    if (action === 'ignore') {
      const { error } = await admin.from('chat_ignores').upsert({ owner_id: row.id, ignored_id: target.id, ignored_name: target.name });
      if (error) throw error;
    } else {
      await admin.from('chat_ignores').delete().eq('owner_id', row.id).eq('ignored_id', target.id);
    }
    return { ok: true, name: target.name };
  }
  if (action === 'report') {
    const id = Number(args.messageId);
    const { data: m } = await admin.from('chat_messages').select('id, sender_id').eq('id', id).maybeSingle();
    if (!m) throw new GameError('That message is gone.');
    if (m.sender_id === row.id) throw new GameError('You can’t report your own message.');
    const { error } = await admin.from('chat_reports').upsert(
      { message_id: id, reporter_id: row.id, reporter_name: char.name, reason: String(args.reason || '').slice(0, 200) || null },
      { onConflict: 'message_id,reporter_id', ignoreDuplicates: true },
    );
    if (error) throw error;
    return { ok: true };
  }
  if (action === 'modDelete') {
    const role = await staffRole(userId);
    if (!role) throw new GameError('Only staff can remove messages.', 403);
    const id = Number(args.messageId);
    const { data: m } = await admin.from('chat_messages').select('text, deleted_at, sender_name').eq('id', id).maybeSingle();
    if (!m || m.deleted_at) throw new GameError('That message is already gone.');
    const { error } = await admin.from('chat_messages').update({ original_text: m.text, text: '', deleted_at: new Date().toISOString(), deleted_by: char.name }).eq('id', id);
    if (error) throw error;
    await admin.from('admin_log').insert({ actor: userId, actor_name: char.name, action: 'chat:delete', target_name: m.sender_name, details: { id, text: m.text } });
    return { ok: true };
  }
  throw new GameError('Unknown action.');
}

const CHAT_ACTIONS = new Set(['chat', 'ignore', 'unignore', 'report', 'modDelete']);

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
  queueLedger(row, 'quests', r.gold);
  char.battle.log.push({ kind: 'win', text: `Quest complete! You earn ${r.xp} experience and ${r.gold} gold${r.gem ? ' and a gem' : ''}.` });
  await announce('quest', `${char.name} completed a quest: ${questTitle(q)}.`);
}

// ---------------------------------------------------------------- actions
const FAST_ACTIONS = new Set(['melee', 'cast', 'flee', 'fight', 'again', 'move', 'walk', 'hunt', 'kingdomClaim', 'kingdomRelease']);
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
  await loadWorld(now);
  await loadWorldZones(now);

  if (action === 'state') {
    const row = await loadRow({ user_id: userId });
    if (!row) return { char: null };
    if (sanctionsOf(row).banned) return { char: row.data, sanctions: sanctionsOf(row) };
    applyRegen(row.data, now);
    const notice = await checkQuestStillOpen(row.data, now);
    const before = JSON.stringify(row.data.notices || []);
    let changed = !!row.locMoved; // a location correction on load is saved (K1-B04)
    const hb = row.data.battle;
    if (hb?.hunt && !hb.over && !(await activeHunt(hb.hunt))) {
      hb.over = 'ended';
      hb.log.push({ kind: 'info', text: 'The hunt is over.' });
      changed = true;
    }
    if (notice) row.data.notices = [...(row.data.notices || []).slice(-9), { at: now, text: notice }];
    // Staged rewards are saved even if nothing else changed (#102, 5.4). A read whose commit
    // conflicts answers 409 like any save, and returns no rewards as delivered.
    await stageRewards(row, row.data, now);
    const waitingChanged = await finishStaging(row, row.data, now);
    const staged = row.staging!.ids.length > 0;
    if (changed || staged || waitingChanged || JSON.stringify(row.data.notices || []) !== before) await saveRow(row, row.data);
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
  if (CHAT_ACTIONS.has(action)) {
    if (sanctionsOf(row).banned) enforceSanctions(row, action);
    return await chatAction(userId, row, action, args || {});
  }
  enforceSanctions(row, action);
  const char = row.data;
  await stageRewards(row, char, now);

  if (FAST_ACTIONS.has(action)) {
    if (now - (char.lastActionAt || 0) < MIN_ACTION_MS) throw new GameError('Slow down!', 429);
    char.lastActionAt = now;
  }
  applyRegen(char, now);

  // Kingdoms K-1 (docs/kingdoms-k1-plan.md 2.2). Each commits through its own database function,
  // with the request's staged rewards (R-1), and is refused while Kingdoms are closed. They come
  // before the generic actions, so the claim's gold is ledgered once, under `kingdom`.
  if (action === 'kingdomClaim') {
    const spent = claimKingdom(char, args?.x, args?.y, now, kingdomConfig());
    queueLedger(row, 'kingdom', -spent);
    await commitRow(row, char, { fn: 'kingdom_claim', plotX: char.kingdom.plot.x, plotY: char.kingdom.plot.y });
    return { char, sanctions: sanctionsOf(row) };
  }
  if (action === 'kingdomRelease') {
    releaseKingdom(char, kingdomConfig());
    // The plot instance the player confirmed releasing, exactly as sent: never looked up, so a
    // stale confirmation can't release a newer Kingdom (K1-DB01). The database refuses a mismatch.
    const plotId = Number(args?.plotId);
    if (!Number.isSafeInteger(plotId) || plotId < 1) throw new GameError('Choose your Kingdom again.', 400);
    await commitRow(row, char, { fn: 'kingdom_release', plotId });
    return { char, sanctions: sanctionsOf(row) };
  }

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

  if (action === 'hunt') {
    const hunt = await activeHunt(String(args.huntId));
    if (!hunt) throw new GameError('That hunt is over.');
    startHuntBattle(char, hunt);
    await saveRow(row, char);
    return { char, sanctions: sanctionsOf(row) };
  }

  const wealthBefore = wealth(char);
  if (char.battle?.hunt && ['melee', 'cast', 'flee', 'again'].includes(action)) {
    if (action !== 'again' && char.battle.over) throw new GameError('This fight is over.');
    const delivered = await huntAction(row, char, action);
    const d = wealth(char) - wealthBefore - delivered;
    queueLedger(row, d < 0 ? 'death' : 'hunt', d);
    await saveRow(row, char);
    return { char, sanctions: sanctionsOf(row) };
  }

  const fn = ACTIONS[action];
  if (!fn) throw new GameError('Unknown action.');
  fn(char, args || {});
  const delta = wealth(char) - wealthBefore;
  if (delta) queueLedger(row, delta < 0 && (action === 'melee' || action === 'cast' || action === 'flee') ? 'death' : (LEDGER_SOURCE[action] || action), delta);

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

  // The sign-in check comes before anything else, so a refused request has changed nothing and the
  // client can renew and send it again (docs/sign-out-scope.md 5.2). 401 only when the sign-in
  // service has definitively refused the token; 503 when it couldn't be asked.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (!auth?.user) {
    return sessionFailure(token, authError) === 'ended'
      ? json({ error: 'Please sign in again.' }, 401)
      : json({ error: "Can't reach the sign-in service. Please try again." }, 503);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    return json(await handle(auth.user.id, String(body?.action || ''), body?.args || {}));
  } catch (err) {
    if (err instanceof GameError) return json(err.reason ? { error: err.message, reason: err.reason } : { error: err.message }, err.status);
    // Engine rule violations ("Not enough gold.") are plain Errors with player-safe messages.
    if (err instanceof Error && !('code' in err)) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: 'Server error — please try again.' }, 500);
  }
});
