// The entrance: sign-in, and the hand-over to the game (docs/landing-scope.md, L-1).
//
// - An anonymous visitor downloads no game code. supabase-js (net.js) loads when they first use the
//   form; the game (main.js and its modules, css/style.css) only after sign-in.
// - A saved session starts loading supabase-js and the game at once, with an in-place status
//   instead of a loading screen. The client's own session restore decides whether it is usable.
// - This is the only auth listener on the game page. It starts and stops the game:
//     signed in as a new user           start the game
//     signed out, or the session ended  stop the game and show the entrance
//     a token refresh, a user update, or a repeated sign-in for the user already playing: nothing
//   Each start has a generation number; work for an older one is dropped when it returns.
// - Failures stay separate: if the library, Supabase or the game can't load, the entrance stays
//   usable and says what happened.
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const entry = $('entry');
const app = $('app');
const form = $('authform');
const email = $('email');
const password = $('password');
const submit = form.querySelector('[type=submit]');
const modeBtn = $('authmode');
const msg = $('auth-msg');
const gateH = $('gate-h');
const status = $('gate-status');
const problem = $('gate-problem');
const problemText = $('gate-problem-text');
const iface = $('iface');
const ifaceNote = $('iface-note');
const choices = [...iface.querySelectorAll('input[name="iface"]')];

const AUTH_KEY = 'clickmonster.auth'; // net.js AUTH_STORAGE_KEY (not imported: the entrance loads nothing else first)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let net = null; // net.js, once loaded
let netLoading = null;
let listening = false;
let game = null; // main.js, once loaded
let current = null; // { uid, session }: the account the game is started (or starting) for
let gen = 0; // bumped on every start and stop
let codeFailed = false; // the game's modules failed to load: the browser keeps that failure, so a reload is the retry
let mode = 'signin';
let interacted = false; // the visitor has used the entrance (focus may move into the game then)

// ---------------------------------------------------------------- messages
function say(text, kind = 'info') {
  msg.textContent = text;
  msg.className = `e-msg${kind === 'bad' ? ' e-bad' : kind === 'good' ? ' e-good' : ''}`;
  msg.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  msg.hidden = false;
  for (const input of [email, password]) {
    if (kind === 'bad') { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'auth-msg'); }
    else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  }
}
function clearMsg() {
  msg.hidden = true;
  msg.textContent = '';
  for (const input of [email, password]) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
}
function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  gateH.textContent = signup ? 'Create an account' : 'Enter the realm';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  modeBtn.textContent = signup ? 'I already have an account' : 'New here? Create an account';
  $('forgot-row').hidden = signup || !RECOVERY_REQUESTS;
}

function setPending(on) {
  submit.disabled = on;
  if (on) submit.setAttribute('aria-busy', 'true'); else submit.removeAttribute('aria-busy');
}

// ---------------------------------------------------------------- loading
// supabase-js, through net.js: the one client and this page's one auth listener.
function loadNet() {
  netLoading ||= (async () => {
    net ||= await import('./net.js');
    const sb = await net.client();
    if (!listening) {
      listening = true;
      // Supabase calls listeners inside its own lock: never call it back from here directly.
      sb.auth.onAuthStateChange((event, session) => setTimeout(() => transition(event, session), 0));
    }
    return sb;
  })().catch((err) => {
    netLoading = null;
    const e = new Error('The sign-in service could not be loaded. Check your connection, then try again.');
    e.unavailable = true;
    e.cause = err;
    throw e;
  });
  return netLoading;
}

// The game's stylesheet, needed before the game draws anything.
function loadGameStyles() {
  const have = document.getElementById('game-css');
  if (have) return have.loaded;
  const link = document.createElement('link');
  link.id = 'game-css';
  link.rel = 'stylesheet';
  link.href = 'css/style.css';
  link.loaded = new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = () => { link.remove(); reject(new Error('The game could not be loaded. Check your connection, then try again.')); };
  });
  document.head.append(link);
  return link.loaded;
}

// Fetch the game's code without running it (a saved session, before it is confirmed).
function preloadGame() {
  if (document.querySelector('link[rel="modulepreload"][href="js/main.js"]')) return;
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = 'js/main.js';
  document.head.append(link);
}

// A saved session that looks usable. Only a hint: the client's own restore decides.
function savedSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY));
    return s && typeof s === 'object' && typeof s.access_token === 'string' && typeof s.refresh_token === 'string';
  } catch { return false; }
}

// ---------------------------------------------------------------- password recovery
// js/entry-recover.js (docs/password-recovery-scope.md). A reset link, its error, or a reset left
// unfinished here (RECOVERY_KEY: the user, if the saved session is theirs) sets the guard: the
// game neither starts nor preloads until the new password is saved. Asking for a reset is off
// until it is released.
const RECOVERY_REQUESTS = false;
const RECOVERY_KEY = 'clickmonster.recovery';
const clearMarker = () => { try { localStorage.removeItem(RECOVERY_KEY); } catch { /* none kept */ } };
// A reset link or its error (error=, error_code=: R1-01); an invalid link is no reset (R1-02).
const RESET_LINK = /[#&](type=recovery|error(_code)?=)/;
const linkError = /[#&]error(_code)?=/.test(location.hash);
let recovering = RESET_LINK.test(location.hash) || (() => {
  try { const id = localStorage.getItem(RECOVERY_KEY); if (id && JSON.parse(localStorage.getItem(AUTH_KEY))?.user?.id === id) return true; } catch { /* no storage */ }
  clearMarker();
  return false;
})();
let recovery = null;
function recover(then) {
  recovery ||= import('./entry-recover.js').then((m) => m.start({
    loadNet, clearMarker, requests: RECOVERY_REQUESTS, signInHeading: () => setMode(mode),
    unguard() { recovering = false; clearMarker(); }, // the password is changed
    cancel: () => net?.signOut(),
    release(text) { if (current) enterGame(++gen); if (text) status.textContent = text; },
  }));
  recovery.then(then, () => { recovery = null; say('The password reset could not be loaded. Check your connection, then reload the page.', 'bad'); });
}

// ---------------------------------------------------------------- the interface choice (L-2)
// Saved with the game's other device settings; the game applies it (layout.js). The entrance's own
// layout never changes with it. The Desktop rule mirrors layout.js (75em wide and 75rem usable);
// tests/entrance-files.test.mjs checks the numbers match.
const PREFS_KEY = 'clickmonster.prefs';
const DESKTOP_MIN_EM = 75;
const DESKTOP_MIN_REM = 75;
const desktopWide = matchMedia(`(min-width: ${DESKTOP_MIN_EM}em)`);
const CHOICES = ['auto', 'desktop', 'mobile'];
function readPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}
const savedChoice = () => (CHOICES.includes(readPrefs().layout) ? readPrefs().layout : 'auto');
function desktopFits() {
  const rootPx = parseFloat(getComputedStyle(root).fontSize) || 16;
  return desktopWide.matches && innerWidth / rootPx >= DESKTOP_MIN_REM;
}
function noteFor(choice) {
  if (choice === 'desktop') {
    return desktopFits()
      ? 'The desktop layout: hero bar, navigation, and a side column with your quests, the map and chat.'
      : 'Desktop needs a wider window (about 1200 pixels at the standard text size). Until there is room the game uses Automatic; your choice is kept.';
  }
  if (choice === 'mobile') return 'The phone layout, in one column, at any screen size.';
  return 'Automatic chooses the layout for your screen: the desktop layout on a wide screen with a mouse or trackpad, the phone layout on phones.';
}
function syncChoice() {
  const c = savedChoice();
  for (const r of choices) r.checked = r.value === c;
  const text = noteFor(c);
  if (ifaceNote.textContent !== text) ifaceNote.textContent = text;
}
iface.addEventListener('change', (e) => {
  const c = e.target.value;
  if (!CHOICES.includes(c)) return;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), layout: c })); } catch { /* storage unavailable: the choice lasts for this page */ }
  ifaceNote.textContent = noteFor(c);
});
// The Desktop note depends on the window; keep it true as the window changes.
const refreshNote = () => { const c = choices.find((r) => r.checked)?.value || 'auto'; const t = noteFor(c); if (ifaceNote.textContent !== t) ifaceNote.textContent = t; };
desktopWide.addEventListener('change', refreshNote);
addEventListener('resize', refreshNote);

// ---------------------------------------------------------------- the game
function transition(event, session) {
  const uid = session?.user?.id || null;
  if (event === 'PASSWORD_RECOVERY') recovering = true;
  if (!uid) {
    if (recovering) { recovering = false; clearMarker(); }
    recovery?.then((r) => r.signedOut());
    const wasPlaying = !!current;
    const resuming = root.classList.contains('resuming');
    const byPlayer = net?.takeUserSignOut();
    current = null;
    gen++;
    game?.stop();
    showEntrance(wasPlaying);
    if (byPlayer) say('You have signed out.');
    else if (wasPlaying || resuming) say('Your session has ended. Please sign in again.');
    return;
  }
  if (recovering) { // the reset form, not the game, until the new password is saved
    if (current?.uid !== uid) { game?.stop(); gen++; showEntrance(false); }
    current = { uid, session };
    const reset = event === 'PASSWORD_RECOVERY' || !linkError;
    if (reset) try { localStorage.setItem(RECOVERY_KEY, uid); } catch { /* the guard lasts for this page */ }
    recover((r) => r.session(uid, reset));
    return;
  }
  if (current?.uid === uid) { current.session = session; return; } // refresh, user update, repeated sign-in
  if (current) game?.stop(); // a different account
  current = { uid, session };
  enterGame(++gen);
}

async function enterGame(my) {
  const isCurrent = () => my === gen;
  root.classList.add('entering');
  problem.hidden = true;
  if (!root.classList.contains('resuming')) status.textContent = 'Entering the realm';
  try {
    await loadGameStyles();
    if (!isCurrent()) return;
    if (!game) {
      try { game = await import('./main.js'); } catch (err) {
        codeFailed = true;
        throw new Error('The game could not be loaded. Check your connection, then try again.', { cause: err });
      }
    }
    if (!isCurrent()) return;
    app.hidden = false; // laid out, but unseen and unreachable until it is ready
    app.inert = true;
    app.classList.add('veiled');
    const started = await game.start(current.session, isCurrent);
    if (!started || !isCurrent()) return;
    reveal();
  } catch (err) {
    if (!isCurrent()) return;
    game?.stop();
    hideApp();
    root.classList.remove('resuming', 'entering');
    status.textContent = '';
    if (err?.ended) return net.endSession(err.session); // the server ended it: the form, not Try again
    form.hidden = true;
    modeBtn.parentElement.hidden = true;
    iface.hidden = true;
    problem.hidden = false; // shown first, then filled, so the alert is announced
    problemText.textContent = `${err?.message || 'The game could not start.'}`;
  }
}

// The entrance gives way to the hero and the world, in place.
function reveal() {
  const focusInside = interacted && (entry.contains(document.activeElement) || document.activeElement === document.body);
  entry.hidden = true;
  document.body.classList.remove('realm');
  root.classList.remove('resuming', 'entering');
  status.textContent = '';
  password.value = '';
  clearMsg();
  app.inert = false;
  app.classList.remove('veiled');
  if (!reduceMotion.matches) {
    app.classList.add('arriving');
    app.addEventListener('animationend', () => app.classList.remove('arriving'), { once: true });
  }
  game.shown();
  if (focusInside) document.getElementById('screen-title')?.focus();
}

function hideApp() {
  app.hidden = true;
  app.inert = false;
  app.classList.remove('veiled', 'arriving');
}

function showEntrance(fromGame) {
  root.classList.remove('resuming', 'entering');
  status.textContent = '';
  problem.hidden = true;
  form.hidden = false;
  modeBtn.parentElement.hidden = false;
  iface.hidden = false;
  if (!entry.hidden && app.hidden) return; // already showing; leave what the visitor typed alone
  syncChoice(); // the game's Settings may have changed it
  hideApp();
  document.body.classList.add('realm');
  document.body.classList.remove('creating');
  entry.hidden = false;
  password.value = '';
  setPending(false);
  if (fromGame) gateH.focus();
}

// ---------------------------------------------------------------- events
// "Skip to sign in" (MR-B2): to what the panel shows. The heading while a saved session is restored,
// else its first usable control: the email field, the reset panel's first, or Try again.
document.querySelector('.e-skip').addEventListener('click', (e) => {
  const to = root.classList.contains('resuming') ? gateH : [...document.querySelectorAll('.e-gate :is(input, button, a)')].find((c) => c.getClientRects().length && !c.disabled);
  if (to) { e.preventDefault(); to.focus(); }
});
function warm() {
  interacted = true;
  loadNet().catch(() => { /* reported when the form is sent */ });
}
form.addEventListener('focusin', warm, { once: true });
form.addEventListener('input', warm, { once: true });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  interacted = true;
  if (submit.getAttribute('aria-busy') === 'true') return;
  const address = email.value.trim();
  setPending(true);
  clearMsg();
  try {
    const sb = await loadNet();
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email: address, password: password.value });
      if (error) throw error;
      if (!data.session) {
        setMode('signin');
        say('Account created. Check your email to confirm it, then sign in here.', 'good');
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: address, password: password.value });
      if (error) throw error;
    }
  } catch (err) {
    say(err?.unavailable ? err.message : net.authMessage(err), 'bad'); // net.js has the wording
  } finally {
    setPending(false);
  }
});

modeBtn.addEventListener('click', () => {
  interacted = true;
  setMode(mode === 'signin' ? 'signup' : 'signin');
  clearMsg();
});

$('forgot').addEventListener('click', () => { if (RECOVERY_REQUESTS) { interacted = true; recover((r) => r.request(email.value.trim())); } });

$('gate-retry').addEventListener('click', () => {
  interacted = true;
  // A module that failed to load stays failed for this page, so the retry is a reload (the saved
  // session brings the player straight back). Anything else is retried in place.
  if (codeFailed) { location.reload(); return; }
  if (current) enterGame(++gen);
});
$('gate-signout').addEventListener('click', async () => {
  interacted = true;
  if (net?.sb) await net.signOut();
  else { current = null; gen++; showEntrance(false); }
});

// ---------------------------------------------------------------- start
// Public news (L-4): its own module, loaded after the entrance has rendered. Nothing waits for it,
// and a failure shows nothing (js/entry-news.js).
function loadNews() { import('./entry-news.js').then((m) => m.showNews()).catch(() => { /* no news shown */ }); }
// After the page has loaded and the browser reports its first paint (a fast load can finish before
// it). A tab opened in the background never paints, so it waits at most 1.5 s.
function afterPaint() {
  let started = false;
  const go = () => { if (!started) { started = true; setTimeout(loadNews, 0); } };
  try {
    if (performance.getEntriesByName('first-contentful-paint').length) { go(); return; }
    const watch = new PerformanceObserver(() => { watch.disconnect(); go(); });
    watch.observe({ type: 'paint', buffered: true });
  } catch { /* no paint timing: the fallback below */ }
  setTimeout(go, 1500);
}
if (document.readyState === 'complete') afterPaint();
else addEventListener('load', afterPaint, { once: true });

syncChoice();
setMode(mode);
submit.disabled = false;
modeBtn.disabled = false;
// A reset link opened over this page changes only the fragment: reload, so the client reads it.
addEventListener('hashchange', () => { if (RESET_LINK.test(location.hash)) location.reload(); });
// After a sign-out that had to clear the session itself and reload (net.js), its message.
try { const note = sessionStorage.getItem('clickmonster.note'); if (note) { sessionStorage.removeItem('clickmonster.note'); say(note); } } catch { /* none kept */ }
if (recovering) {
  root.classList.remove('resuming');
  recover((r) => r.arrived());
} else if (root.classList.contains('resuming')) {
  if (savedSession()) {
    preloadGame();
    loadGameStyles().catch(() => { /* reported if the game starts */ });
    loadNet().catch((err) => {
      root.classList.remove('resuming');
      say(err.message, 'bad');
    });
  } else {
    root.classList.remove('resuming'); // unreadable: treated as no session
  }
}
