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

// ---------------------------------------------------------------- signing out
// Sign-out and session recovery (docs/sign-out-scope.md). The invariant: this browser can always
// discard its own saved session and return to the sign-in form, whatever the server answers.
//
// Signing out ends this device's session only (R1). The library is asked first, with a time limit.
// If it refuses (an already-ended session comes back as an error, and the library then keeps the
// saved session), runs out of time (its lock or its request never resolving), or leaves a session
// behind, the fallback removes the saved session directly, only if it is still the one being ended,
// and reloads: the page then starts with no session and shows the form, with the message carried
// across the reload. The reload also drops the unfinished library call, so its late completion
// can't clear a session saved after it (scope 5.1, point 5).
export const SIGN_OUT_MS = 5000;
export const NOTE_KEY = 'clickmonster.note'; // sessionStorage: the message the entrance shows after the reload
const SIGNED_OUT = 'You have signed out.';
const ENDED = 'Your session has ended. Please sign in again.';
let userSignOut = false;
const saved = () => { try { return localStorage.getItem(AUTH_STORAGE_KEY); } catch { return null; } };

async function leave(byPlayer) {
  userSignOut = byPlayer;
  const ending = saved();
  let done = false;
  try {
    const timeUp = new Promise((resolve) => setTimeout(resolve, SIGN_OUT_MS, 'time'));
    const result = await Promise.race([sb ? sb.auth.signOut({ scope: 'local' }) : null, timeUp]);
    done = result !== 'time' && !result?.error;
  } catch { /* falls back */ }
  if (done && !saved()) return; // the library cleared it and told this tab and the others
  try { if (saved() === ending) localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* storage unavailable */ }
  try { sessionStorage.setItem(NOTE_KEY, byPlayer ? SIGNED_OUT : ENDED); } catch { /* the form shows without it */ }
  location.reload();
}
// The player's own sign-out, from the game, the admin console or the entrance.
export const signOut = () => leave(true);
// The server has ended the session: the same, said as "Your session has ended".
export const endSession = () => leave(false);
export function takeUserSignOut() { const was = userSignOut; userSignOut = false; return was; }

// Another tab removed the saved session (its own fallback): end this tab's too. The library finds
// nothing saved, sends nothing to the server, and tells this tab's listener (R6).
addEventListener('storage', (e) => {
  if (sb && (e.key === AUTH_STORAGE_KEY || e.key === null) && !saved()) sb.auth.signOut({ scope: 'local' }).catch(() => { /* nothing to end */ });
});

// What a failed sign-in says (moved from the entrance, to keep its first paint small). Network
// failures get our own words; the server's are kept.
export function authMessage(err) {
  const text = String(err?.message || '');
  if (err?.status === 0 || err?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(text)) {
    return "Can't reach the sign-in service. Check your connection, then try again.";
  }
  return text || 'Could not sign in.';
}

// ---------------------------------------------------------------- the game function
async function call(action, args) {
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

// One renewal at a time: concurrent refusals share it, so they don't race the refresh token's
// rotation. 'renewed', 'ended' (refused: the library has removed the session) or 'unavailable'.
let renewing = null;
function renew() {
  renewing ||= sb.auth.refreshSession()
    .then(({ data, error }) => (data?.session && !error ? 'renewed' : error?.name === 'AuthRetryableFetchError' ? 'unavailable' : 'ended'))
    .catch(() => 'unavailable')
    .finally(() => { renewing = null; });
  return renewing;
}
const userOf = async () => (await sb.auth.getSession()).data.session?.user?.id || null;
const stale = () => Object.assign(new Error('This request belongs to an earlier sign-in.'), { stale: true });

// Send one game action to the server; returns { char }. isCurrent says whether the sign-in that
// asked is still the page's (main.js: live(g)).
// A 401 means the server refused the token, before changing anything (the function checks it
// first), so after one renewal the request is sent once more (docs/sign-out-report.md, section 8):
//   - renewal refused, or a second 401: err.ended, and the caller ends the session (endSession());
//   - renewal couldn't reach the service: a 503, the session kept, the player can try again;
//   - the sign-in changed meanwhile (signed out, or another account): err.stale, nothing re-sent.
// Nothing else is retried: a timeout or a 5xx may have happened after the server acted.
export async function api(action, args = {}, isCurrent = () => true) {
  const who = await userOf();
  try {
    return await call(action, args);
  } catch (err) {
    if (err.status !== 401) throw err;
    if (!isCurrent()) throw stale();
    const renewal = await renew();
    if (!isCurrent()) throw stale();
    if (renewal === 'unavailable') throw Object.assign(new Error("Can't reach the sign-in service. Please try again."), { status: 503 });
    if (renewal === 'ended') throw Object.assign(err, { ended: true });
    if (await userOf() !== who) throw stale();
    try {
      return await call(action, args);
    } catch (again) {
      if (again.status === 401 && isCurrent() && await userOf() === who) again.ended = true;
      else if (again.status === 401) throw stale();
      throw again;
    }
  }
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
