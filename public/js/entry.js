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
// What a failed sign-in says. Network failures get our own words; the server's are kept.
function authError(err) {
  if (err?.unavailable) return err.message;
  const text = String(err?.message || '');
  if (err?.status === 0 || err?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(text)) {
    return "Can't reach the sign-in service. Check your connection, then try again.";
  }
  return text || 'Could not sign in.';
}

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  gateH.textContent = signup ? 'Create an account' : 'Enter the realm';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  modeBtn.textContent = signup ? 'I already have an account' : 'New here? Create an account';
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

// ---------------------------------------------------------------- the game
function transition(event, session) {
  const uid = session?.user?.id || null;
  if (!uid) {
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
    form.hidden = true;
    modeBtn.parentElement.hidden = true;
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
  if (!entry.hidden && app.hidden) return; // already showing; leave what the visitor typed alone
  hideApp();
  document.body.classList.add('realm');
  document.body.classList.remove('creating');
  entry.hidden = false;
  password.value = '';
  setPending(false);
  if (fromGame) gateH.focus();
}

// ---------------------------------------------------------------- events
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
    say(authError(err), 'bad');
  } finally {
    setPending(false);
  }
});

modeBtn.addEventListener('click', () => {
  interacted = true;
  setMode(mode === 'signin' ? 'signup' : 'signin');
  clearMsg();
});

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
submit.disabled = false;
modeBtn.disabled = false;
if (root.classList.contains('resuming')) {
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
