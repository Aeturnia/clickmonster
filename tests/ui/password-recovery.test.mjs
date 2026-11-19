// Password recovery, R-1 (docs/password-recovery-scope.md): asking for a reset (off until it is
// released), arriving from a reset link, the recovery guard across reloads and tabs, saving the new
// password, signing out the other devices, expired links, and accessibility. Against the fake
// backend; the real flow is tested on the local Supabase stack (tests/db/password-recovery.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FakeBackend, ACCOUNTS, axe, savedSession, recoveryUrl, recoveryRequestsOn } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const AUTH_KEY = 'clickmonster.auth';
const RECOVERY_KEY = 'clickmonster.recovery';

function track(page, base) {
  const log = [];
  page.on('request', (r) => { if (r.url().startsWith(base)) log.push(new URL(r.url()).pathname); });
  return log;
}
async function open({ backend = new FakeBackend(), viewport = { width: 390, height: 844 }, mobile = true, requests = false, saved, marker, blockMarker = false } = {}) {
  const ctx = await env.page({ backend, viewport, mobile });
  if (requests) await recoveryRequestsOn(ctx.page);
  if (saved !== undefined || marker !== undefined) {
    await ctx.page.addInitScript(([ak, av, rk, rv]) => {
      if (sessionStorage.getItem('seeded')) return;
      if (av) localStorage.setItem(ak, av);
      if (rv) localStorage.setItem(rk, rv);
      sessionStorage.setItem('seeded', '1');
    }, [AUTH_KEY, saved ? JSON.stringify(saved) : null, RECOVERY_KEY, marker ?? null]);
  }
  // Storage that refuses the recovery marker (as a blocked or full store would): the guard can't persist.
  if (blockMarker) {
    await ctx.page.addInitScript((rk) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === rk) throw new Error('blocked'); return set.call(this, k, v); };
    }, RECOVERY_KEY);
  }
  ctx.log = track(ctx.page, env.url);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const stateCalls = (backend) => backend.calls.filter((c) => c.fn === 'game' && c.action === 'state').length;
const inGame = (page) => page.waitForSelector('#top .hud-row', { timeout: 15000 });
const heading = (page) => page.textContent('#gate-h');
const marker = (page) => page.evaluate((k) => localStorage.getItem(k), RECOVERY_KEY);
async function untilHeading(page, text) {
  await page.waitForFunction((t) => document.getElementById('gate-h').textContent === t && !document.getElementById('recover')?.hidden, text, { timeout: 15000 });
}
// Waits, from Node, until `pred` holds, or fails after `ms`.
async function until(pred, what, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
// No game: no state call, no game code, the game hidden.
async function noGame(ctx, label) {
  assert.equal(stateCalls(ctx.backend), 0, `${label}: no state call`);
  assert.deepEqual(ctx.log.filter((p) => p === '/js/main.js' || p === '/css/style.css'), [], `${label}: no game code or styles`);
  assert.equal(await ctx.page.isVisible('#app'), false, `${label}: the game is hidden`);
}
async function arrive(ctx, acct = ACCOUNTS.player) {
  await ctx.page.goto(recoveryUrl(env.url, acct));
  await untilHeading(ctx.page, 'Choose a new password');
}
async function savePassword(page, a, b = a) {
  await page.fill('#new-password', a);
  await page.fill('#new-password-2', b);
  await page.click('#recover-form [type=submit]');
}

// ---------------------------------------------------------------- the release switch (PR-1)

test('PR-1 off by default: no "Forgot your password?", and no recovery code on a plain visit', async () => {
  const ctx = await open();
  await ctx.page.goto(`${env.url}/`);
  await ctx.page.waitForSelector('#authform [type=submit]:not([disabled])');
  await ctx.page.focus('#email');
  await ctx.page.waitForTimeout(1600); // after the news has loaded
  assert.equal(await ctx.page.isVisible('#forgot'), false, 'the link is not offered');
  assert.deepEqual(ctx.log.filter((p) => p === '/js/entry-recover.js'), [], 'no recovery module');
  assert.equal(ctx.backend.recoverRequests.length, 0);
  await done(ctx);
});

test('PR-1 released: the link in sign-in mode only, after the password field, and no module until it is chosen', async () => {
  const ctx = await open({ requests: true });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#forgot', { state: 'visible' });
  assert.equal(await page.getAttribute('#forgot', 'type'), 'button');
  assert.equal((await page.textContent('#forgot')).trim(), 'Forgot your password?');
  await page.focus('#password');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'forgot', 'the next stop after the password');
  await page.click('#authmode');
  assert.equal(await page.isVisible('#forgot'), false, 'hidden when creating an account');
  await page.click('#authmode');
  assert.equal(await page.isVisible('#forgot'), true);
  assert.deepEqual(ctx.log.filter((p) => p === '/js/entry-recover.js'), [], 'not loaded yet');
  await done(ctx);
});

// ---------------------------------------------------------------- asking for a reset (PR-2)

test('PR-2 asking for a reset: one request back to this page, the same answer for any address', async () => {
  const ctx = await open({ requests: true });
  const { page, backend } = ctx;
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.click('#forgot');
  await untilHeading(page, 'Reset your password');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-h', 'focus on the heading');
  assert.equal(await page.inputValue('#recover-email'), ACCOUNTS.player.email, 'the address is carried over');
  assert.equal(await page.isVisible('#authform'), false);
  await page.click('#recover-form [type=submit]');
  await untilHeading(page, 'Check your email');
  const known = await page.textContent('#recover-msg');
  assert.match(known, /If an account uses that address, we've sent it a link/);
  assert.doesNotMatch(known, /hour|minute/, 'no promised lifetime');
  assert.deepEqual(backend.recoverRequests, [{ email: ACCOUNTS.player.email, redirectTo: `${env.url}/` }]);
  // An address with no account: the same answer.
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.click('#forgot');
  await page.fill('#recover-email', 'nobody@example.test');
  await page.click('#recover-form [type=submit]');
  await untilHeading(page, 'Check your email');
  assert.equal(await page.textContent('#recover-msg'), known, 'identical');
  assert.equal(backend.recoverRequests.length, 2);
  await done(ctx);
});

test('PR-2 a double press sends one request; a rate limit and no connection say so', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend, requests: true });
  const { page } = ctx;
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/auth/v1/recover*', async (r) => { await gate; await r.fallback(); });
  await page.goto(`${env.url}/`);
  await page.click('#forgot');
  await untilHeading(page, 'Reset your password');
  await page.fill('#recover-email', ACCOUNTS.player.email);
  await page.click('#recover-form [type=submit]');
  await page.waitForSelector('#recover-form [type=submit][aria-busy="true"]');
  await page.evaluate(() => document.getElementById('recover-form').requestSubmit());
  release();
  await untilHeading(page, 'Check your email');
  assert.equal(backend.recoverRequests.length, 1, 'one request');
  await page.unroute('**/auth/v1/recover*');
  // Rate limited.
  backend.recoverStatus = 429;
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.click('#forgot');
  await page.fill('#recover-email', ACCOUNTS.player.email);
  await page.click('#recover-form [type=submit]');
  await page.waitForFunction(() => /Too many reset requests/.test(document.getElementById('recover-msg')?.textContent || ''));
  assert.equal(await page.getAttribute('#recover-msg', 'role'), 'alert');
  // No connection.
  backend.recoverStatus = 200;
  backend.offline = true;
  await page.click('#recover-form [type=submit]');
  await page.waitForFunction(() => /Can't reach the sign-in service/.test(document.getElementById('recover-msg')?.textContent || ''));
  backend.offline = false;
  await done(ctx);
});

// ---------------------------------------------------------------- arriving from the link (PR-3)

test('PR-3 a reset link opens "Choose a new password", never the game, and leaves the address clean', async () => {
  const ctx = await open();
  await ctx.page.goto(recoveryUrl(env.url, ACCOUNTS.player));
  // What a visitor does next: use the page. Before R-1 that loaded the client, which took the link's
  // session and started the game without asking for a new password (the defect, scope 2.3).
  await ctx.page.evaluate(() => document.getElementById('email').focus());
  await ctx.page.waitForTimeout(1500); // anything that would start the game has had its chance
  await noGame(ctx, 'arrival');
  await untilHeading(ctx.page, 'Choose a new password');
  assert.equal(await ctx.page.evaluate(() => location.hash), '', 'the tokens are gone from the address');
  assert.equal(await marker(ctx.page), ACCOUNTS.player.id, 'the guard is kept for this user');
  assert.equal(await ctx.page.getAttribute('#new-password', 'autocomplete'), 'new-password');
  assert.equal(await ctx.page.getAttribute('#new-password-2', 'autocomplete'), 'new-password');
  await done(ctx);
});

// ---------------------------------------------------------------- saving the password (PR-4)

test('PR-4 checks first, then saves, signs out the other devices and enters the realm', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await arrive(ctx);
  await savePassword(page, 'short', 'short');
  await page.waitForFunction(() => /at least 6 characters/.test(document.getElementById('recover-msg')?.textContent || ''));
  assert.equal(await page.getAttribute('#new-password', 'aria-invalid'), 'true');
  await savePassword(page, 'new-secret-1', 'new-secret-2');
  await page.waitForFunction(() => /don't match/.test(document.getElementById('recover-msg')?.textContent || ''));
  assert.equal(backend.passwordUpdates.length, 0, 'nothing sent until it is valid');
  await noGame(ctx, 'before saving');
  await savePassword(page, 'new-secret-1');
  await inGame(page);
  assert.deepEqual(backend.passwordUpdates, [ACCOUNTS.player.id]);
  assert.equal(backend.passwords[ACCOUNTS.player.id], 'new-secret-1');
  assert.ok(backend.logouts.includes('others'), 'the other devices are signed out');
  assert.equal(await marker(page), null, 'the guard is released');
  await done(ctx);
});

test('PR-4 the new password signs in and the old one does not', async () => {
  const ctx = await open();
  const { page } = ctx;
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await inGame(page);
  await page.evaluate(async () => { const { signOut } = await import(new URL('js/net.js', location.href)); await signOut(); });
  await page.waitForSelector('#authform', { state: 'visible' });
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform [type=submit]');
  await page.waitForFunction(() => /Invalid login credentials/.test(document.getElementById('auth-msg').textContent));
  await page.fill('#password', 'new-secret-1');
  await page.click('#authform [type=submit]');
  await inGame(page);
  await done(ctx);
});

test('PR-4 a refused update keeps the form and the guard; the password is unchanged', async () => {
  const backend = new FakeBackend();
  backend.failUserUpdate = 500;
  const ctx = await open({ backend });
  const { page } = ctx;
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await page.waitForFunction(() => document.getElementById('recover-msg')?.getAttribute('role') === 'alert');
  assert.equal(await heading(page), 'Choose a new password');
  assert.equal(backend.passwords[ACCOUNTS.player.id], undefined);
  assert.equal(await marker(page), ACCOUNTS.player.id, 'the guard stays');
  assert.equal(backend.logouts.includes('others'), false, 'nothing else is signed out');
  await noGame(ctx, 'after a refusal');
  await done(ctx);
});

// ---------------------------------------------------------------- the recovery guard (PR-4a)

test('PR-4a a reload during an unfinished reset shows the form again, with no game start or preload', async () => {
  const ctx = await open();
  const { page } = ctx;
  await arrive(ctx);
  ctx.log.length = 0;
  await page.reload();
  await untilHeading(page, 'Choose a new password');
  await page.waitForTimeout(800);
  await noGame(ctx, 'after a reload');
  assert.deepEqual(ctx.log.filter((p) => p === '/js/main.js'), [], 'not even preloaded');
  await done(ctx);
});

// The tab's saved recovery state: the session and the marker, both for `acct`. entry.js writes them
// only once the library has read the link, which is after the reset form shows (from the link alone).
async function untilSaved(page, acct = ACCOUNTS.player) {
  await page.waitForFunction(([ak, rk, id]) => {
    try { return JSON.parse(localStorage.getItem(ak))?.user?.id === id && localStorage.getItem(rk) === id; } catch { return false; }
  }, [AUTH_KEY, RECOVERY_KEY, acct.id], { timeout: 15000 });
}
const savedNow = (page) => page.evaluate(([ak, rk]) => ({ session: localStorage.getItem(ak) !== null, marker: localStorage.getItem(rk) }), [AUTH_KEY, RECOVERY_KEY]);
// Holds back this page's /auth/v1/user answer, which the library awaits before it saves the session
// from a link. Only this page: a tab opened later in the context is not delayed.
async function slowAuth(page, ms) {
  await page.route('**/auth/v1/user', async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.fallback(); });
}
// "A new tab with the saved session" (PR-4a): so the first tab must have saved it before the second
// opens. Opening it as soon as the heading shows raced the save, and the second tab, finding no
// session, rightly showed the sign-in form (docs/backlog.md: the PR-4a timeout, now explained).
async function secondTabShowsForm(ctx) {
  await untilSaved(ctx.page);
  const second = await ctx.context.newPage();
  const log = track(second, env.url);
  await second.goto(`${env.url}/`);
  await untilHeading(second, 'Choose a new password');
  await second.waitForTimeout(800);
  assert.equal(stateCalls(ctx.backend), 0, 'no state call from either tab');
  assert.deepEqual(log.filter((p) => p === '/js/main.js'), [], 'no game code in the second tab');
}

test('PR-4a a second tab with the saved session also shows the form', async () => {
  const ctx = await open();
  await arrive(ctx);
  await secondTabShowsForm(ctx);
  await done(ctx);
});

// The race, made certain: the first tab's save is held back well past its heading, so a second tab
// opened at the heading would find no session (as on CI run 44596307837). The test checks that the
// delay does hold the save back, then that the second tab, opened once the save is done, keeps the guard.
test('PR-4a a second tab opened after a late save also shows the form', async () => {
  const ctx = await open();
  await slowAuth(ctx.page, 2500);
  await arrive(ctx);
  assert.deepEqual(await savedNow(ctx.page), { session: false, marker: null }, 'nothing saved yet when the heading shows');
  await secondTabShowsForm(ctx);
  await done(ctx);
});

test('PR-4a Cancel signs out this session only, clears the guard and shows the sign-in form', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await arrive(ctx);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await page.isVisible('#recover'), false);
  assert.equal(await heading(page), 'Enter the realm');
  assert.deepEqual(backend.logouts, ['local'], 'only this session');
  assert.equal(await marker(page), null);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY), null, 'no session kept');
  await page.reload();
  await page.waitForSelector('#authform', { state: 'visible' });
  await noGame(ctx, 'after cancelling and reloading');
  await done(ctx);
});

test('PR-4a after the password is saved, a reload enters the game normally', async () => {
  const ctx = await open();
  const { page } = ctx;
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await inGame(page);
  await page.reload();
  await inGame(page);
  assert.equal(await page.isVisible('#recover'), false);
  await done(ctx);
});

test('PR-4a a stale marker is ignored and cleared: a normal saved session still goes straight in', async () => {
  // A marker for another user.
  const ctx = await open({ saved: savedSession(ACCOUNTS.player), marker: ACCOUNTS.mod.id });
  await ctx.page.goto(`${env.url}/`);
  await inGame(ctx.page);
  assert.equal(await marker(ctx.page), null, 'cleared');
  await done(ctx);
  // A marker with no saved session.
  const ctx2 = await open({ marker: ACCOUNTS.player.id });
  await ctx2.page.goto(`${env.url}/`);
  await ctx2.page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await ctx2.page.isVisible('#recover'), false);
  assert.equal(await marker(ctx2.page), null, 'cleared');
  await done(ctx2);
});

test('PR-4a with storage refusing the marker, the guard holds for the page only (documented limit)', async () => {
  const ctx = await open({ blockMarker: true });
  const { page } = ctx;
  await arrive(ctx);
  await page.waitForTimeout(600);
  await noGame(ctx, 'on the page');
  assert.equal(await marker(page), null, 'nothing could be kept');
  await page.reload();
  await inGame(page); // the saved session resumes, as documented
  await done(ctx);
});

// ---------------------------------------------------------------- the other devices (PR-4b)

test('PR-4b if signing out the other devices fails, the page says so; Try again repeats only that', async () => {
  const backend = new FakeBackend();
  backend.failOthersLogout = 1;
  const ctx = await open({ backend });
  const { page } = ctx;
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await untilHeading(page, 'Password changed');
  const text = await page.textContent('#recover-msg');
  assert.match(text, /Your password is changed, but your other devices couldn't be signed out/);
  assert.doesNotMatch(text, /are signed out/, 'nothing claims success');
  assert.equal(backend.passwords[ACCOUNTS.player.id], 'new-secret-1', 'the password is changed');
  assert.equal(await marker(page), null, 'the guard is released with the password');
  await noGame(ctx, 'while the failure is shown');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await inGame(page);
  assert.deepEqual(backend.logouts, ['others', 'others'], 'the sign-out again, and nothing else');
  assert.deepEqual(backend.passwordUpdates, [ACCOUNTS.player.id], 'the password was not sent again');
  await done(ctx);
});

test('PR-4b after a failed sign-out, Continue to the realm enters without claiming success', async () => {
  const backend = new FakeBackend();
  backend.failOthersLogout = 1;
  const ctx = await open({ backend });
  const { page } = ctx;
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await untilHeading(page, 'Password changed');
  await page.getByRole('button', { name: 'Continue to the realm', exact: true }).click();
  await inGame(page);
  assert.deepEqual(backend.logouts, ['others'], 'not retried');
  await done(ctx);
});

// ---------------------------------------------------------------- expired links (PR-5)

test('PR-5 an expired or used link: a clear message, the address cleaned, nothing started', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(recoveryUrl(env.url, ACCOUNTS.player, { error: true }));
  await untilHeading(page, 'Reset link not valid');
  assert.match(await page.textContent('#recover-msg'), /expired or has already been used/);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.getByRole('button', { name: 'Send a new link' }).count(), 0, 'not offered while asking is off');
  await page.waitForTimeout(600);
  await noGame(ctx, 'expired link');
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.waitForSelector('#authform', { state: 'visible' });
  await done(ctx);
});

test('PR-5 once asking is released, an expired link offers a new one', async () => {
  const ctx = await open({ requests: true });
  const { page } = ctx;
  await page.goto(recoveryUrl(env.url, ACCOUNTS.player, { error: true }));
  await untilHeading(page, 'Reset link not valid');
  await page.getByRole('button', { name: 'Send a new link', exact: true }).click();
  await untilHeading(page, 'Reset your password');
  await done(ctx);
});

test('PR-5 a link whose session the server refuses is reported as not valid', async () => {
  const ctx = await open();
  const { page } = ctx;
  // A token that has already expired: the server refuses it.
  const s = savedSession(ACCOUNTS.player, -60);
  await page.goto(`${env.url}/#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&refresh_token=refresh-none&token_type=bearer&type=recovery`);
  await untilHeading(page, 'Reset link not valid');
  await page.waitForTimeout(400);
  await noGame(ctx, 'refused link');
  await done(ctx);
});

// ---------------------------------------------------------------- R-1 review: R1-01, R1-02
// An invalid link shows "Reset link not valid" and nothing else: no password form, no password
// update and no game while it is shown, even when this browser already holds another valid session.
async function invalidOnly(ctx, label) {
  const { page, backend } = ctx;
  await untilHeading(page, 'Reset link not valid');
  await page.waitForTimeout(1200); // the client has restored (or dropped) the saved session by now
  assert.equal(await heading(page), 'Reset link not valid', `${label}: still the invalid-link panel`);
  assert.match(await page.textContent('#recover-msg'), /expired or has already been used|no longer valid/, `${label}: an accurate message`);
  assert.equal(await page.locator('#new-password').count(), 0, `${label}: no password form`);
  assert.deepEqual(backend.passwordUpdates, [], `${label}: no password update`);
  assert.equal(await marker(page), null, `${label}: no recovery marker`);
  await noGame(ctx, label);
}

test('R1-01 a link error given only as error_code: the invalid-link panel, the address cleaned, no game', async () => {
  const ctx = await open();
  await ctx.page.goto(`${env.url}/#error_code=otp_expired`);
  await invalidOnly(ctx, 'error_code only');
  assert.equal(await ctx.page.evaluate(() => location.hash), '', 'the address is cleaned');
  await done(ctx);
});

test('R1-02 an expired link (error_code only) with another valid session saved: no form; Continue enters as that session', async () => {
  const ctx = await open({ saved: savedSession(ACCOUNTS.player) });
  const { page } = ctx;
  await page.goto(`${env.url}/#error_code=otp_expired`);
  await invalidOnly(ctx, 'saved session, error_code');
  // That session is the player's own: the way out is into the realm, as it.
  await page.getByRole('button', { name: 'Continue to the realm', exact: true }).click();
  await inGame(page);
  assert.deepEqual(ctx.backend.passwordUpdates, []);
  assert.equal(await marker(page), null);
  await done(ctx);
});

test('R1-02 an expired link (error and description) with another valid session saved: no form, no game', async () => {
  const ctx = await open({ saved: savedSession(ACCOUNTS.player) });
  await ctx.page.goto(recoveryUrl(env.url, ACCOUNTS.mod, { error: true }));
  await invalidOnly(ctx, 'saved session, full error');
  await done(ctx);
});

test('R1-02 a recovery token the server refuses, with another valid session saved: no form, no game', async () => {
  const ctx = await open({ saved: savedSession(ACCOUNTS.player) });
  const s = savedSession(ACCOUNTS.mod, -60); // already expired: the server refuses it
  await ctx.page.goto(`${env.url}/#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&refresh_token=refresh-none&token_type=bearer&type=recovery`);
  await invalidOnly(ctx, 'saved session, refused token');
  await done(ctx);
});

test('R1-02 after an invalid link, Back to sign in and an ordinary sign-in go straight into the game', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(recoveryUrl(env.url, ACCOUNTS.player, { error: true }));
  await untilHeading(page, 'Reset link not valid');
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.waitForSelector('#authform', { state: 'visible' });
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform [type=submit]');
  await inGame(page);
  assert.equal(await page.locator('#new-password').count(), 0, 'no password form for an ordinary sign-in');
  assert.deepEqual(ctx.backend.passwordUpdates, []);
  await done(ctx);
});

test('the release switch also guards the handler: a click on the hidden link does nothing', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform [type=submit]:not([disabled])');
  await page.evaluate(() => document.getElementById('forgot').click());
  await page.waitForTimeout(600);
  assert.deepEqual(ctx.log.filter((p) => p === '/js/entry-recover.js'), [], 'no recovery module');
  assert.equal(await page.locator('#recover').count(), 0, 'no panel');
  assert.equal(ctx.backend.recoverRequests.length, 0);
  await done(ctx);
});

// ---------------------------------------------------------------- isolation and independence (PR-6, PR-7)

test('PR-6 a reset link opened over a running game for another account replaces it cleanly', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await inGame(page);
  const calls = stateCalls(backend);
  await page.evaluate((u) => { location.hash = u.slice(u.indexOf('#')); }, recoveryUrl(env.url, ACCOUNTS.mod));
  await untilHeading(page, 'Choose a new password');
  await page.waitForTimeout(600);
  assert.equal(await page.isVisible('#app'), false, 'the old game is gone');
  assert.equal(stateCalls(backend), calls, 'no start for the new account');
  assert.equal(await marker(page), ACCOUNTS.mod.id);
  await done(ctx);
});

test('PR-7 the library failing on arrival: the panel says so, and the game stays held', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.route('**/vendor/supabase-js@2.45.4/supabase.js', (r) => r.abort('internetdisconnected'));
  await page.goto(recoveryUrl(env.url, ACCOUNTS.player));
  await page.waitForFunction(() => /could not be loaded/.test(document.getElementById('recover-msg')?.textContent || ''));
  assert.equal(await page.getByRole('button', { name: 'Reload', exact: true }).isVisible(), true);
  await noGame(ctx, 'library down');
  await done(ctx);
});

test('PR-7 a normal sign-in is unchanged by any of this', async () => {
  const ctx = await open({ requests: true });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform [type=submit]');
  await inGame(page);
  assert.deepEqual(ctx.log.filter((p) => p === '/js/entry-recover.js'), [], 'no recovery code');
  assert.equal(ctx.backend.recoverRequests.length + ctx.backend.passwordUpdates.length, 0);
  await done(ctx);
});

// ---------------------------------------------------------------- accessibility (PR-8)

test('PR-8 every recovery state: focus on the heading, and no axe violations of any impact', async () => {
  for (const [w, h] of [[320, 640], [390, 844], [1440, 900]]) {
    const backend = new FakeBackend();
    backend.failOthersLogout = 1;
    const ctx = await open({ backend, viewport: { width: w, height: h }, mobile: w < 900, requests: true });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.click('#forgot');
    await untilHeading(page, 'Reset your password');
    await noAxe(page, `${w}: request`);
    await page.fill('#recover-email', ACCOUNTS.player.email);
    await page.click('#recover-form [type=submit]');
    await untilHeading(page, 'Check your email');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-h');
    await noAxe(page, `${w}: sent`);
    await page.goto(recoveryUrl(env.url, ACCOUNTS.player, { error: true }));
    await untilHeading(page, 'Reset link not valid');
    await noAxe(page, `${w}: expired`);
    await page.goto(recoveryUrl(env.url, ACCOUNTS.player));
    await untilHeading(page, 'Choose a new password');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-h');
    await noAxe(page, `${w}: choose`);
    await savePassword(page, 'x', 'x');
    await page.waitForFunction(() => document.getElementById('recover-msg')?.getAttribute('role') === 'alert');
    await noAxe(page, `${w}: choose, with an error`);
    await savePassword(page, 'new-secret-1');
    await untilHeading(page, 'Password changed');
    await noAxe(page, `${w}: partial`);
    await done(ctx);
  }
});

test('one client and one auth listener through a whole reset', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.addInitScript(() => {
    window.__clients = 0;
    window.__listeners = 0;
    let lib;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return lib; },
      set(v) {
        const create = v.createClient;
        v.createClient = (...args) => {
          window.__clients++;
          const c = create(...args);
          const on = c.auth.onAuthStateChange.bind(c.auth);
          c.auth.onAuthStateChange = (cb) => { window.__listeners++; return on(cb); };
          return c;
        };
        lib = v;
      },
    });
  });
  await arrive(ctx);
  await savePassword(page, 'new-secret-1');
  await inGame(page);
  assert.deepEqual(await page.evaluate(() => [window.__clients, window.__listeners]), [1, 1]);
  await done(ctx);
});
