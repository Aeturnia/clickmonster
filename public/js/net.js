// Talking to Supabase: auth, the `game` server function, and the players-here list.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'clickmonster.auth' },
});

// Send one game action to the server; returns { char }.
export async function api(action, args = {}) {
  const { data, error } = await sb.functions.invoke('game', { body: { action, args } });
  if (error) {
    let message = 'Connection problem — please try again.';
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* not a JSON error */ }
    const err = new Error(message);
    err.status = error.context?.status;
    throw err;
  }
  return data;
}

// Players seen in this exact cell during the last 10 minutes.
export const ONLINE_WINDOW_MS = 10 * 60 * 1000;
export async function playersAt(loc, myName) {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await sb.from('characters')
    .select('id, name, race, level, updated_at')
    .eq('zone', loc.zone).eq('x', loc.x).eq('y', loc.y)
    .gt('updated_at', since)
    .order('level', { ascending: false })
    .limit(50);
  if (error) throw new Error('Could not load players.');
  return data.filter((p) => p.name !== myName);
}

// Latest public announcements (quest wins, duels, rare finds).
export async function recentEvents(limit = 12) {
  const { data, error } = await sb.from('events').select('id, kind, text, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Could not load news.');
  return data;
}
