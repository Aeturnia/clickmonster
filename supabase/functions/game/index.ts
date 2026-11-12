// ClickMonster game server. Every game action goes through here so the server is the
// authority on all rolls, gold and stats. Rules are the shared engine in ./js
// (a symlink to public/js), the exact same code the browser uses for display.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createCharacter, applyRegen, spendLevel } from './js/engine/character.js';
import { move, walkTo, usePortal, heal } from './js/engine/world.js';
import { startBattle, battleAction } from './js/engine/battle.js';
import { buy, buyAndEquip, sell, equip, unequip, socketGem, extractGem } from './js/engine/inventory.js';
import { duel } from './js/engine/pvp.js';

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

type Row = { id: string; data: any; version: number };

async function loadRow(filter: { user_id?: string; id?: string }): Promise<Row | null> {
  let q = admin.from('characters').select('id, data, version');
  if (filter.user_id) q = q.eq('user_id', filter.user_id);
  if (filter.id) q = q.eq('id', filter.id);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
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
  dismiss: (c) => { c.notices = []; },
};

async function handle(userId: string, action: string, args: any) {
  const now = Date.now();

  if (action === 'state') {
    const row = await loadRow({ user_id: userId });
    if (!row) return { char: null };
    applyRegen(row.data, now);
    return { char: row.data };
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
    const { error } = await admin.from('characters').delete().eq('user_id', userId);
    if (error) throw error;
    return { char: null };
  }

  const row = await loadRow({ user_id: userId });
  if (!row) throw new GameError('Create a hero first.', 404);
  const char = row.data;

  if (FAST_ACTIONS.has(action)) {
    if (now - (char.lastActionAt || 0) < MIN_ACTION_MS) throw new GameError('Slow down!', 429);
    char.lastActionAt = now;
  }
  applyRegen(char, now);

  if (action === 'attack') {
    const target = await loadRow({ id: String(args.targetId) });
    if (!target || target.id === row.id) throw new GameError('They are no longer here.');
    applyRegen(target.data, now);
    duel(char, target.data);
    await saveRow(target, target.data);
    await saveRow(row, char);
    return { char };
  }

  const fn = ACTIONS[action];
  if (!fn) throw new GameError('Unknown action.');
  fn(char, args || {});
  await saveRow(row, char);
  return { char };
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
