// Password recovery on the entrance (docs/password-recovery-scope.md, R-1).
//
// Loaded only when needed, never in the first paint: when "Forgot your password?" is chosen (only
// once asking for a reset is released, entry.js RECOVERY_REQUESTS), when the address carries a
// reset link or its error, or when a reset was left unfinished in this browser.
//
// entry.js stays the page's only auth listener. It holds the game back while a reset is under way
// (its recovery guard) and passes the session events here. This module draws the panel, asks
// Supabase for the reset email, saves the new password, signs out the player's other devices, and
// releases the guard.
//   - Asking for a reset always gives the same answer, whether or not the address has an account.
//   - The new password is saved with updateUser(); then every other session is signed out
//     (signOut, scope "others"). That revokes their refresh tokens; access tokens they already hold
//     last until they expire. This browser's session stays. If that second step fails, the page
//     says so: the password is changed, the other devices are not signed out yet.
//   - The guard is a UI guard: it decides what the entrance shows, not what the session may do on
//     the server.
const $ = (id) => document.getElementById(id);

let h = null; // hooks from entry.js
let panel = null;
let state = 'idle'; // idle | request | sent | checking | choose | partial | expired
let busy = false;
let cancelling = false;
let uid = null;

const MIN = 6; // the sign-in form's minlength, and the local stack's minimum_password_length

function el(tag, props = {}, kids = []) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}
function field(id, label, type, autocomplete) {
  return el('label', { className: 'e-field' }, [label, el('input', { id, className: 'e-input', type, autocomplete, required: true, ...(type === 'password' ? { minLength: MIN } : { inputMode: 'email' }) })]);
}
function button(text, quiet, onClick) {
  return el('button', { type: 'button', className: quiet ? 'e-btn e-quiet' : 'e-btn', textContent: text, onclick: onClick });
}

// What a failed request says: our own words for the network, Supabase's for everything else.
function problemText(err) {
  const text = String(err?.message || '');
  if (err?.unavailable) return text;
  if (err?.status === 0 || err?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(text)) return "Can't reach the sign-in service. Check your connection, then try again.";
  if (err?.status === 429 || /rate limit/i.test(text)) return 'Too many reset requests. Wait a few minutes, then try again.';
  return text || 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------- the panel
function show(next, heading, kids, msg) {
  state = next;
  if (!panel) {
    panel = el('div', { id: 'recover', className: 'e-recover' });
    $('authform').after(panel);
  }
  cover();
  $('gate-h').textContent = heading;
  panel.replaceChildren(...kids);
  panel.hidden = false;
  if (msg) say(msg.text, msg.kind);
  $('gate-h').focus();
}
// The sign-in form, its mode switch and the interface choice give way to the panel.
function cover() {
  for (const id of ['authform', 'iface']) $(id).hidden = true;
  $('authmode').parentElement.hidden = true;
}
// Leaving the panel always ends the guard: a reset still under way is never left behind it.
function hide() {
  h.unguard();
  state = 'idle';
  if (panel) { panel.hidden = true; panel.replaceChildren(); }
  for (const id of ['authform', 'iface']) $(id).hidden = false;
  $('authmode').parentElement.hidden = false;
  h.signInHeading();
}
// The panel's own message line: an alert for problems, a status otherwise.
function say(text, kind = 'info') {
  let m = $('recover-msg');
  if (!m) { m = el('p', { id: 'recover-msg', className: 'e-msg' }); panel.prepend(m); }
  m.className = `e-msg${kind === 'bad' ? ' e-bad' : kind === 'good' ? ' e-good' : ''}`;
  m.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  m.textContent = text;
  m.hidden = false;
}
function pending(btn, on) {
  busy = on;
  btn.disabled = on;
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

// ---------------------------------------------------------------- asking for a reset
export function request(prefill = '') {
  if (!h.requests) return; // released only by entry.js RECOVERY_REQUESTS; not a security boundary
  const send = el('button', { type: 'submit', className: 'e-btn', textContent: 'Send reset link' });
  const form = el('form', { id: 'recover-form', noValidate: false }, [
    el('p', { className: 'e-note', textContent: "Enter your account's email address. We'll send it a link to choose a new password." }),
    field('recover-email', 'Email', 'email', 'email'),
    send,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const address = $('recover-email').value.trim();
    pending(send, true);
    try {
      const sb = await h.loadNet();
      // Back to this page, wherever it is served: production, a local stack, or a test. The
      // project's redirect allow-list decides what Supabase accepts.
      const { error } = await sb.auth.resetPasswordForEmail(address, { redirectTo: `${location.origin}/` });
      if (error) throw error;
      // The same answer whether or not the address has an account.
      show('sent', 'Check your email', [el('div', { className: 'e-actions' }, [button('Back to sign in', true, hide)])],
        { text: "If an account uses that address, we've sent it a link to choose a new password.", kind: 'good' });
    } catch (err) {
      say(problemText(err), 'bad');
    } finally {
      pending(send, false);
    }
  });
  show('request', 'Reset your password', [form, el('div', { className: 'e-actions' }, [button('Back to sign in', true, hide)])]);
  if (prefill) $('recover-email').value = prefill;
}

// ---------------------------------------------------------------- arriving from a link
// The link's error (expired or already used): Supabase leaves it in the address, so it is read and
// cleared here.
// It also starts the client, which reads a link's session from the address; entry.js then passes
// the session on (session()), or its absence (signedOut()).
export async function arrived() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error') || hash.get('error_code')) {
    history.replaceState(history.state, '', location.pathname + location.search);
    expired();
  } else if (state === 'idle') {
    show('checking', 'Choose a new password', [el('p', { className: 'e-note', textContent: 'Checking your reset link.' })]);
  }
  try {
    await h.loadNet();
  } catch (err) {
    if (state === 'checking') {
      show('checking', 'Choose a new password', [el('div', { className: 'e-actions' }, [button('Reload', false, () => location.reload())])], { text: problemText(err), kind: 'bad' });
    }
  }
}
// An invalid link stays invalid: a session that turns up afterwards (one already saved in this
// browser) never turns it into a password form (R-1 review, R1-02). With such a session the way
// out is into the realm, as that session's own; without one, back to sign in.
let expiredText = '';
function expired(text = 'This reset link has expired or has already been used.') {
  expiredText = text;
  const actions = [];
  if (h.requests) actions.push(button('Send a new link', false, () => request()));
  actions.push(uid ? button('Continue to the realm', true, () => { hide(); h.release(); }) : button('Back to sign in', true, hide));
  show('expired', 'Reset link not valid', [el('div', { className: 'e-actions' }, actions)], { text, kind: 'bad' });
}

// entry.js: a session is in place for this user, and the guard holds the game back. `reset` is
// false when it isn't a reset session (an invalid link with a session already saved here).
export function session(id, reset = true) {
  uid = id;
  if (state === 'expired' || !reset) { expired(expiredText || undefined); return; }
  if (state === 'choose' || state === 'partial') return;
  choose();
}
// entry.js: there is no session any more (the player cancelled, or the session ended).
export function signedOut() {
  uid = null;
  if (cancelling) { cancelling = false; hide(); return; }
  if (state === 'checking' || state === 'choose') expired('This reset link is no longer valid.');
  else if (state !== 'idle') cover(); // entry.js has just shown the sign-in form again
}

function choose() {
  const save = el('button', { type: 'submit', className: 'e-btn', textContent: 'Save password' });
  // Our own checks and messages, rather than the browser's bubbles.
  const form = el('form', { id: 'recover-form', noValidate: true }, [
    el('p', { className: 'e-note', textContent: `At least ${MIN} characters.` }),
    field('new-password', 'New password', 'password', 'new-password'),
    field('new-password-2', 'Confirm new password', 'password', 'new-password'),
    save,
  ]);
  form.addEventListener('submit', (e) => { e.preventDefault(); savePassword(save); });
  show('choose', 'Choose a new password', [form, el('div', { className: 'e-actions' }, [button('Cancel', true, cancel)])]);
}

async function savePassword(btn) {
  if (busy) return;
  const a = $('new-password');
  const b = $('new-password-2');
  for (const input of [a, b]) input.removeAttribute('aria-invalid');
  if (a.value.length < MIN) return invalid(a, `Use at least ${MIN} characters.`);
  if (a.value !== b.value) return invalid(b, "The two passwords don't match.");
  pending(btn, true);
  let changed = false;
  try {
    const sb = await h.loadNet();
    const { error } = await sb.auth.updateUser({ password: a.value });
    if (error) throw error;
    changed = true;
    h.unguard(); // the password is changed: no reset form any more, even on a reload
    await signOutOthers(sb);
  } catch (err) {
    if (!changed) say(problemText(err), 'bad');
  } finally {
    pending(btn, false);
  }
}
function invalid(input, text) {
  input.setAttribute('aria-invalid', 'true');
  say(text, 'bad');
  input.focus();
}

// Sign out every other session. Says truthfully what happened.
async function signOutOthers(sb) {
  const { error } = await sb.auth.signOut({ scope: 'others' });
  if (!error) {
    hide();
    h.release('Your password is changed, and your other devices are signed out.');
    return;
  }
  const retry = button('Try again', false, async () => {
    if (busy) return;
    pending(retry, true);
    try { await signOutOthers(sb); } catch (err) { say(problemText(err), 'bad'); } finally { if (state === 'partial') pending(retry, false); }
  });
  show('partial', 'Password changed', [el('div', { className: 'e-actions' }, [retry, button('Continue to the realm', true, () => { hide(); h.release(); })])],
    { text: "Your password is changed, but your other devices couldn't be signed out. Try again.", kind: 'bad' });
}

// Cancel: sign out this browser's recovery session only.
async function cancel() {
  if (busy) return;
  cancelling = true;
  h.clearMarker();
  await h.cancel();
}

// ---------------------------------------------------------------- start
export function start(hooks) {
  h = hooks;
  return { request, arrived, session, signedOut, get state() { return state; }, get uid() { return uid; } };
}
