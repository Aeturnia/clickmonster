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

// ---------------------------------------------------------------- renewing after a refusal
// The renewal after a 401 is our own request, not the library's refreshSession(): supabase-js
// 2.45.4 removes the saved session itself on any renewal error but 502-504 and network failures,
// so a temporary 500 or 429 would sign the player out (docs/sign-out-report.md, section 17).
// Here only the measured refusal, refresh_token_not_found, ends a session; anything else keeps it.
// A new session is handed to the library through its public setSession(). The library's own
// background renewal is unchanged, with that limitation (report, section 18).
const TOKEN_URL = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
const RATE_LIMIT_MS = 30000; // after a 429 with no Retry-After, no renewal before this long
let renewAfter = 0;
let renewing = null;
const stored = () => { try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)); } catch { return null; } };
const sessionOf = (s) => {
  try { return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id ?? null; } catch { return null; }
};

// Renews the session the refused request was made with (`from`). 'renewed', 'ended' (refused:
// that refresh token is no longer usable), 'unavailable' (the session kept), or 'changed' (this
// browser's sign-in is no longer `from`: signed out, or another session, even of the same account).
// One renewal at a time in this tab, and across the browser's tabs with a lock; whoever goes second
// finds the session already renewed and sends nothing.
function renew(from) {
  const run = async () => {
    const now = stored();
    if (now?.refresh_token !== from.refresh_token) return now && sessionOf(now) === sessionOf(from) ? 'renewed' : 'changed';
    if (Date.now() < renewAfter) return 'unavailable';
    let res;
    let body = {};
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
        body: JSON.stringify({ refresh_token: from.refresh_token }),
      });
      body = await res.json().catch(() => ({}));
    } catch { return 'unavailable'; }
    if (res.ok && body.access_token && body.refresh_token) {
      // A late answer: only install it if this browser still holds the session it renewed.
      const still = stored();
      if (still?.refresh_token !== from.refresh_token) return still && sessionOf(still) === sessionOf(from) ? 'renewed' : 'changed';
      const { error } = await sb.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
      return error ? 'unavailable' : 'renewed';
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      renewAfter = Date.now() + (wait > 0 ? wait * 1000 : RATE_LIMIT_MS);
      return 'unavailable';
    }
    if (res.status === 400 && (body.code ?? body.error_code) === 'refresh_token_not_found') return 'ended';
    return 'unavailable';
  };
  renewing ||= (globalThis.navigator?.locks ? navigator.locks.request('clickmonster.renew', run) : run())
    .catch(() => 'unavailable')
    .finally(() => { renewing = null; });
  return renewing;
}
const stale = () => Object.assign(new Error('This request belongs to an earlier sign-in.'), { stale: true });

// Send one game action to the server; returns { char }. isCurrent says whether the sign-in that
// asked is still the page's (main.js: live(g)).
// A 401 means the server refused the token, before changing anything (the function checks it
// first), so after one renewal the request is sent once more (docs/sign-out-report.md, section 9):
//   - renewal refused, or a second 401 for the same session: err.ended, and the caller ends it;
//   - renewal couldn't be done (outage, rate limit, unknown answer): a 503, the session kept;
//   - this browser's sign-in changed meanwhile: err.stale, and nothing is sent again.
// Nothing else is retried: a timeout or a 5xx may have happened after the server acted.
export async function api(action, args = {}, isCurrent = () => true) {
  const from = stored();
  try {
    return await call(action, args);
  } catch (err) {
    if (err.status !== 401) throw err;
    if (!isCurrent() || !from?.refresh_token) throw stale();
    const renewal = await renew(from);
    if (!isCurrent() || renewal === 'changed') throw stale();
    if (renewal === 'unavailable') throw Object.assign(new Error("Can't reach the sign-in service. Please try again."), { status: 503 });
    if (renewal === 'ended') throw Object.assign(err, { ended: true });
    try {
      return await call(action, args);
    } catch (again) {
      if (again.status === 401) {
        if (!isCurrent() || sessionOf(stored() || {}) !== sessionOf(from)) throw stale();
        again.ended = true;
      }
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
