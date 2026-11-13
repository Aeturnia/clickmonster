// Talking to Supabase: the one client, the `game` server function, and the players-here list.
//
// This module is the only code that creates a Supabase client (docs/landing-scope.md, section 6).
// The library is our own copy of supabase-js (public/vendor/README.md), loaded only when it is
// first needed: the entrance asks for it when sign-in begins or a saved session is found, and the
// game and the admin console use the same instance. Importing this module loads nothing else.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const LIBRARY = new URL('../vendor/supabase-js@2.45.4/supabase.js', import.meta.url).href;
export const AUTH_STORAGE_KEY = 'clickmonster.auth';

// The client, once created (a live binding: importers see it as soon as client() has resolved).
export let sb = null;
let loading = null;

// Load the library with a classic script (it defines the global `supabase`). A failed attempt
// removes its script element, so the next attempt loads it again.
function loadLibrary() {
  if (globalThis.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = LIBRARY;
    el.async = true;
    el.onload = () => (globalThis.supabase?.createClient ? resolve() : reject(new Error('The sign-in service did not load.')));
    el.onerror = () => { el.remove(); reject(new Error('The sign-in service could not be loaded.')); };
    document.head.append(el);
  });
}

// The one client. Resolves to the same instance every time. If loading fails the promise rejects,
// nothing is kept, and calling again tries again; a client is created at most once.
export function client() {
  if (sb) return Promise.resolve(sb);
  loading ||= loadLibrary().then(() => {
    sb ||= globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
    });
    return sb;
  }).catch((err) => { loading = null; throw err; });
  return loading;
}

// Sign out because the player asked to. The entrance tells this apart from a session that ended.
let userSignOut = false;
export async function signOut() {
  userSignOut = true;
  try { await sb?.auth.signOut(); } catch { /* the session is cleared locally either way */ }
}
export function takeUserSignOut() { const was = userSignOut; userSignOut = false; return was; }

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

// The editable world. Falls back to the built-in zones if this fails.
export async function fetchZoneDefs() {
  const { data, error } = await sb.from('zones').select('data').order('sort');
  if (error || !data?.length) return null;
  return data.map((r) => r.data);
}

// Latest public announcements (quest wins, duels, rare finds).
export async function recentEvents(limit = 12) {
  const { data, error } = await sb.from('events').select('id, kind, text, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Could not load news.');
  return data;
}
