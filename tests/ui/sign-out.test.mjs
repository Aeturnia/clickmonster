// Sign-out and session recovery (docs/sign-out-scope.md, section 6; docs/sign-out-report.md):
// SO-1 to SO-13 in the browser, on the fake backend. The invariant under test: this browser can
// always discard its own saved session and return to the sign-in form, whatever the server answers.
// The fake backend answers as GoTrue was measured to (tests/session-answers.mjs): an ended
// session's token gets 403 session_not_found, which supabase-js reports as AuthSessionMissingError.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, ACCOUNTS, axe, savedSession } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const AUTH_KEY = 'clickmonster.auth';
const SIGN_OUT_MS = 5000; // net.js SIGN_OUT_MS

async function open({ backend = new FakeBackend(), viewport = { width: 390, height: 844 }, mobile = viewport.width < 900, saved } = {}) {
  const ctx = await env.page({ backend, viewport, mobile });
  // Seeded once per tab, so a reload (the fallback) finds what the page itself left.
  if (saved) await ctx.page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [AUTH_KEY, JSON.stringify(saved)]);
  return ctx;
}
async function done(ctx, { pages = [ctx.page] } = {}) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  for (const p of pages) {
    assert.deepEqual(p.errors || [], [], 'no page errors');
    assert.deepEqual(p.nativeDialogs || [], [], 'no native dialogs');
  }
  await ctx.context.close();
}
const inGame = (page) => page.waitForSelector('#top .hud-row', { timeout: 15000 });
const theForm = (page, ms = 15000) => page.waitForSelector('#authform', { state: 'visible', timeout: ms });
const savedUser = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k))?.user?.id || null; } catch { return 'unreadable'; } }, AUTH_KEY);
const message = (page) => page.textContent('#auth-msg');
const gameCalls = (backend, action) => backend.calls.filter((c) => c.fn === 'game' && c.action === action).length;
const renewals = (backend) => backend.authCalls.filter((g) => g === 'refresh_token').length;
async function signOutInGame(page) {
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.click('#main [data-a="signout"]');
}
// A second page of the same browser: same storage, same BroadcastChannel and locks.
async function secondTab(ctx) {
  const p = await ctx.context.newPage();
  p.errors = []; p.nativeDialogs = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}

// ---------------------------------------------------------------- R1: this device only

test('SO-1 signing out in the game and in the admin console ends this device\'s session only (scope=local)', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  await signOutInGame(page);
  await theForm(page);
  assert.deepEqual(backend.logouts, ['local'], 'the game sends a local sign-out');
  assert.match(await message(page), /You have signed out/);
  await signIn(page, env.url, 'admin', '/admin.html');
  await page.waitForSelector('[data-a="signout"]', { timeout: 15000 });
  await page.click('[data-a="signout"]');
  await page.waitForFunction(() => !localStorage.getItem('clickmonster.auth'), null, { timeout: 15000 });
  assert.deepEqual(backend.logouts, ['local', 'local'], 'the admin console too');
  await done(ctx);
});

// ---------------------------------------------------------------- R2: an ended session returns to the form

test('SO-2 a saved session ended on the server: the form says so, the saved session is gone, and there is no Try again', async () => {
  const backend = new FakeBackend();
  const saved = savedSession(ACCOUNTS.player);
  backend.endSessions(ACCOUNTS.player); // after it was issued: this session has ended
  const ctx = await open({ backend, saved });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await theForm(page);
  assert.match(await message(page), /Your session has ended\. Please sign in again\./);
  assert.equal(await savedUser(page), null, 'the saved session is removed');
  assert.equal(await page.isVisible('#gate-retry'), false, 'no Try again for a session that cannot work');
  assert.equal(renewals(backend), 1, 'one renewal was tried, and refused');
  await done(ctx);
});

test('SO-2 an expired access token whose session still renews: renewed once, the request sent again, and the game starts', async () => {
  const backend = new FakeBackend();
  backend.staleTokens = 1;
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await inGame(page);
  assert.equal(renewals(backend), 1, 'one renewal');
  assert.equal(gameCalls(backend, 'state'), 2, 'the refused call, then the same call once more');
  assert.equal(await savedUser(page), ACCOUNTS.player.id, 'the session is kept');
  await done(ctx);
});

test('SO-3 the session ends on the server during play: an action returns to the form, the saved session is gone, nothing global sent', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  backend.endSessions(ACCOUNTS.player);
  await page.click('[data-a="move"][data-v="n"]');
  await theForm(page);
  assert.match(await message(page), /Your session has ended/);
  assert.equal(await savedUser(page), null);
  assert.equal(backend.logouts.includes('global'), false, 'no sign-out of every device');
  await done(ctx);
});

test('SO-3 an expired but renewable token during play: renewed once, sent once more, and the move happens exactly once', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  const y0 = await page.evaluate(() => window.clickmonster.char.loc.y);
  backend.staleTokens = 1;
  await page.click('[data-a="move"][data-v="n"]');
  await settle(page);
  assert.equal(gameCalls(backend, 'move'), 2, 'the refused call (which changed nothing) and the one that moved');
  assert.equal(await page.evaluate(() => window.clickmonster.char.loc.y), y0 - 1, 'one step, not two');
  assert.equal(renewals(backend), 1);
  assert.equal(await page.isVisible('#authform'), false, 'still playing');
  await done(ctx);
});

test('SO-3 concurrent refusals share one renewal, and each request is sent once more', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  const before = renewals(backend);
  backend.staleTokens = 3;
  const out = await page.evaluate(async () => {
    const { api } = await import(new URL('js/net.js', location.href));
    const all = await Promise.allSettled([api('state'), api('state'), api('state')]);
    return all.map((r) => r.status);
  });
  assert.deepEqual(out, ['fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(renewals(backend) - before, 1, 'one renewal for the three refusals');
  await done(ctx);
});

test('SO-3 the sign-in changes while a renewal is on its way: nothing is sent again', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  backend.staleTokens = 1;
  const release = backend.holdAuth();
  await page.evaluate(() => {
    window.__current = true;
    window.__result = import(new URL('js/net.js', location.href)).then(({ api }) => api('move', { dir: 'n' }, () => window.__current))
      .then(() => 'sent', (e) => (e.stale ? 'stale' : `error ${e.status}`));
  });
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => { window.__current = false; }); // signed out, or another account, meanwhile
  release();
  assert.equal(await page.evaluate(() => window.__result), 'stale');
  assert.equal(gameCalls(backend, 'move'), 1, 'the refused move only: it is not sent again');
  await done(ctx);
});

// ---------------------------------------------------------------- an expired session, and signing in again

test('SO-4 an expired session whose renewal is refused: the form, and signing in again works without clearing anything', async () => {
  const backend = new FakeBackend();
  backend.revoked.add(`refresh-${ACCOUNTS.player.id}`);
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player, -60) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await theForm(page);
  assert.match(await message(page), /Your session has ended/);
  await signIn(page, env.url, 'player');
  await inGame(page);
  await done(ctx);
});

// ---------------------------------------------------------------- R3: Sign out always works

for (const fail of [500, 'drop', 'hang']) {
  test(`SO-5 Sign out in the game when the server's sign-out ${fail === 'hang' ? 'never answers' : fail === 'drop' ? 'drops the connection' : 'fails with 500'}: signed out on this device anyway`, async () => {
    const ctx = await open();
    const { page, backend } = ctx;
    await signIn(page, env.url, 'player');
    await inGame(page);
    backend.logoutFail = fail;
    const t0 = Date.now();
    await signOutInGame(page);
    await theForm(page, SIGN_OUT_MS + 10000);
    if (fail === 'hang') assert.ok(Date.now() - t0 < SIGN_OUT_MS + 5000, `within the time limit and a margin (${Date.now() - t0} ms)`);
    assert.match(await message(page), /You have signed out/);
    assert.equal(await savedUser(page), null, 'the saved session is removed');
    // Signing out again, with nothing saved, is harmless.
    await page.evaluate(async () => { const { signOut } = await import(new URL('js/net.js', location.href)); await signOut(); });
    await page.waitForTimeout(300);
    assert.ok(await page.isVisible('#authform'));
    await done(ctx);
  });
}

test('SO-5 the gate\'s Sign out when the server refuses it: the form', async () => {
  const backend = new FakeBackend();
  backend.failNext('state', 503, "Can't reach the sign-in service. Please try again.");
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#gate-signout', { state: 'visible', timeout: 15000 });
  backend.logoutFail = 500;
  await page.click('#gate-signout');
  await theForm(page);
  assert.equal(await savedUser(page), null);
  await done(ctx);
});

// ---------------------------------------------------------------- R4: an outage keeps the session

for (const fail of [503, 'drop']) {
  test(`SO-6 a ${fail === 'drop' ? 'dropped connection' : '503'} at start-up: the gate with Try again, the session kept, and Try again starts the game`, async () => {
    const backend = new FakeBackend();
    backend.failNext('state', fail, "Can't reach the sign-in service. Please try again.");
    const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#gate-retry', { state: 'visible', timeout: 15000 });
    assert.equal(await savedUser(page), ACCOUNTS.player.id, 'the session is kept');
    assert.equal(renewals(backend), 0, 'an outage is not treated as a refusal');
    await page.click('#gate-retry');
    await inGame(page);
    await done(ctx);
  });
}

// ---------------------------------------------------------------- R5: another account after recovering

test('SO-7 after recovering from an ended session, another account signs in and sees nothing of the first', async () => {
  const backend = new FakeBackend();
  const saved = savedSession(ACCOUNTS.player);
  backend.endSessions(ACCOUNTS.player); // after it was issued: this session has ended
  const ctx = await open({ backend, saved });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await theForm(page);
  await signIn(page, env.url, 'fresh');
  await page.waitForSelector('#name', { timeout: 15000 }); // a new account: hero creation
  assert.equal(await savedUser(page), ACCOUNTS.fresh.id);
  assert.equal(await page.evaluate(() => window.clickmonster.char), null, 'no hero carried over');
  assert.equal(await page.evaluate(() => document.getElementById('top').textContent.trim()), '', 'no hero bar of the first account');
  await done(ctx);
});

// ---------------------------------------------------------------- R6: tabs

for (const refused of [false, true]) {
  test(`SO-8 two tabs: signing out in one returns the other to the entrance${refused ? ', when the server refused the sign-out' : ''}`, async () => {
    const ctx = await open();
    const { page: a, backend } = ctx;
    await signIn(a, env.url, 'player');
    await inGame(a);
    const b = await secondTab(ctx);
    await b.goto(`${env.url}/`);
    await inGame(b);
    if (refused) backend.logoutFail = 500;
    await signOutInGame(a);
    await theForm(a);
    await theForm(b);
    assert.equal(await b.isVisible('#app'), false, 'the other tab left the game');
    assert.equal(await savedUser(b), null);
    await done(ctx, { pages: [a, b] });
  });
}

// ---------------------------------------------------------------- R7: never trapped

for (const [w, h] of [[390, 844], [844, 390], [1440, 900]]) {
  test(`SO-9 at ${w}x${h}, after an ended session the form is on screen, reachable by keyboard, with no axe violations`, async () => {
    const backend = new FakeBackend();
    const saved = savedSession(ACCOUNTS.player);
    backend.endSessions(ACCOUNTS.player); // after it was issued: this session has ended
    const ctx = await open({ backend, saved, viewport: { width: w, height: h } });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await theForm(page);
    const r = await page.evaluate(() => { const b = document.getElementById('email').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
    assert.ok(r.top >= 0 && r.bottom <= r.h, `the email field is on screen (${JSON.stringify(r)})`);
    await page.focus('#email');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'email');
    assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), []);
    await done(ctx);
  });
}

// ---------------------------------------------------------------- SO-13: a late finish can't clear a newer session

test('SO-13 this tab: a hung sign-out falls back, the player signs in again, and the late answer clears nothing', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  backend.logoutFail = 'hang';
  await signOutInGame(page);
  await theForm(page, SIGN_OUT_MS + 10000);
  await signIn(page, env.url, 'player');
  await inGame(page);
  await backend.hungLogout?.fulfill({ status: 204 }).catch(() => { /* its page is gone */ });
  await page.waitForTimeout(500);
  assert.equal(await savedUser(page), ACCOUNTS.player.id, 'the new session is still saved');
  await page.click('[data-a="move"][data-v="n"]');
  await settle(page);
  assert.equal(await page.isVisible('#authform'), false, 'and still works');
  await done(ctx);
});

test('SO-13 compare before removing: a session saved by another tab while this one\'s sign-out hangs is left alone', async () => {
  const ctx = await open();
  const { page, backend } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  backend.logoutFail = 'hang';
  await signOutInGame(page);
  // Meanwhile, another tab of the browser saves a different session (here written directly: in a
  // browser with shared locks it would wait for this tab, which the next test covers).
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_KEY, JSON.stringify(savedSession(ACCOUNTS.admin))]);
  await page.waitForTimeout(SIGN_OUT_MS + 1500); // the fallback has run and reloaded
  assert.equal(await savedUser(page), ACCOUNTS.admin.id, 'the newer session was not removed');
  await backend.hungLogout?.fulfill({ status: 204 }).catch(() => { /* its page is gone */ });
  await done(ctx);
});

test('SO-13 two tabs: tab A\'s sign-out hangs while tab B signs in as another account; B\'s session survives A\'s late answer', async () => {
  const ctx = await open();
  const { page: a, backend } = ctx;
  await signIn(a, env.url, 'player');
  await inGame(a);
  const b = await secondTab(ctx);
  await b.goto(`${env.url}/`);
  await inGame(b);
  backend.logoutFail = 'hang';
  await signOutInGame(a);
  // B signs in as another account; the library makes it wait for A's lock until A falls back.
  const signedIn = b.evaluate(async ([email, password]) => {
    const { client } = await import(new URL('js/net.js', location.href));
    const { error } = await (await client()).auth.signInWithPassword({ email, password });
    return error ? error.message : 'ok';
  }, [ACCOUNTS.fresh.email, ACCOUNTS.fresh.password]);
  // A falls back and reloads. B's sign-in then completes, before or after A's page starts again,
  // so A shows either the form or B's account (hero creation): either way, not the player's game.
  await a.waitForFunction(() => {
    const shown = (id) => { const el = document.getElementById(id); return !!el && el.checkVisibility(); };
    return shown('authform') || shown('name');
  }, null, { timeout: SIGN_OUT_MS + 10000 });
  assert.equal(await signedIn, 'ok');
  await b.waitForSelector('#name', { timeout: 15000 }); // B is now the other account, at hero creation
  await backend.hungLogout?.fulfill({ status: 204 }).catch(() => { /* its page is gone */ });
  await b.waitForTimeout(500);
  assert.equal(await savedUser(b), ACCOUNTS.fresh.id, 'B\'s session survives');
  await done(ctx, { pages: [a, b] });
});

// ---------------------------------------------------------------- F-1: the controlled renewal (review of 543cbde)
// The renewal after a 401 is net.js's own request; only refresh_token_not_found ends a session, and
// a new session is handed to the library through setSession() (docs/sign-out-report.md, section 18).

const stored = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, AUTH_KEY);
const sessionOf = (s) => s && JSON.parse(Buffer.from(s.access_token.split('.')[1], 'base64url')).session_id;
async function playing(backend) {
  const ctx = await open({ backend });
  await signIn(ctx.page, env.url, 'player');
  await inGame(ctx.page);
  return ctx;
}

test('F-1 proof 1: a renewal is installed with setSession(), with no second renewal, and the new session works', async () => {
  const backend = new FakeBackend();
  const ctx = await playing(backend);
  const { page } = ctx;
  const before = await stored(page);
  const r0 = renewals(backend);
  backend.staleTokens = 1;
  await page.click('[data-a="move"][data-v="n"]');
  await settle(page);
  const after = await stored(page);
  assert.equal(renewals(backend) - r0, 1, 'one renewal request');
  assert.notEqual(after.refresh_token, before.refresh_token, 'the renewed session is saved');
  assert.equal(sessionOf(after), sessionOf(before), 'the same session, renewed');
  await page.waitForTimeout(1500);
  assert.equal(renewals(backend) - r0, 1, 'setSession() started no renewal of its own');
  await page.click('[data-a="move"][data-v="s"]');
  await settle(page);
  assert.equal(renewals(backend) - r0, 1, 'the next request works with the new session, unrenewed');
  assert.equal(gameCalls(backend, 'move'), 3, 'the refused move, its resend, and the next');
  await done(ctx);
});

for (const [label, fail] of [['500', 500], ['429', { status: 429, retryAfter: 60 }], ['an unknown 400 code', { status: 400, code: 'something_new' }], ['a dropped connection', 'drop']]) {
  test(`F-1 proof 2: a renewal answered with ${label} keeps the saved session, and the player can try again`, async () => {
    const backend = new FakeBackend();
    const ctx = await playing(backend);
    const { page } = ctx;
    const before = await stored(page);
    backend.staleTokens = 1;
    backend.refreshFail = fail;
    await page.click('[data-a="move"][data-v="n"]');
    await settle(page);
    assert.deepEqual(await stored(page), before, 'the saved session is untouched');
    assert.equal(await page.isVisible('#authform'), false, 'still in the game');
    assert.match(await page.textContent('body'), /Can't reach the sign-in service/, 'the player is told, and the session kept');
    if (label === '429') {
      // Rate limited: a further refusal doesn't renew again before Retry-After.
      const r = renewals(backend);
      backend.staleTokens = 1;
      await page.click('[data-a="move"][data-v="n"]');
      await settle(page);
      assert.equal(renewals(backend), r, 'no renewal request while rate limited');
    } else {
      await page.click('[data-a="move"][data-v="n"]');
      await settle(page);
      assert.equal(await page.isVisible('#authform'), false, 'trying again works');
    }
    await done(ctx);
  });
}

test('F-1 proof 2: only refresh_token_not_found ends the session', async () => {
  const backend = new FakeBackend();
  const ctx = await playing(backend);
  const { page } = ctx;
  backend.staleTokens = 1;
  backend.refreshFail = { status: 400, code: 'refresh_token_not_found' };
  await page.click('[data-a="move"][data-v="n"]');
  await theForm(page);
  assert.match(await message(page), /Your session has ended/);
  assert.equal(await savedUser(page), null);
  await done(ctx);
});

for (const change of ['a new session of the same account', 'a sign-out']) {
  test(`F-1 proof 5: a late renewal after ${change} installs nothing and sends nothing again`, async () => {
    const backend = new FakeBackend();
    const ctx = await playing(backend);
    const { page } = ctx;
    backend.staleTokens = 1;
    const release = backend.holdAuth();
    await page.evaluate(() => { window.__r = import(new URL('js/net.js', location.href)).then(({ api }) => api('move', { dir: 'n' })).then(() => 'sent', (e) => (e.stale ? 'stale' : `error ${e.status}`)); });
    await page.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 400)); // the renewal request is now held
    const replaced = change === 'a sign-out' ? null : JSON.stringify(savedSession(ACCOUNTS.player));
    await page.evaluate(([k, v]) => { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }, [AUTH_KEY, replaced]);
    release();
    assert.equal(await page.evaluate(() => window.__r), 'stale');
    assert.equal(JSON.stringify(await stored(page)), replaced ?? 'null', 'what the browser saved meanwhile stays');
    assert.equal(gameCalls(backend, 'move'), 1, 'the refused move only');
    await ctx.context.close();
  });
}

test('F-1 proof 6: the library\'s own renewal at the same moment leaves a working session of the same sign-in', async () => {
  const backend = new FakeBackend();
  const ctx = await playing(backend);
  const { page } = ctx;
  const before = await stored(page);
  backend.staleTokens = 1;
  const out = await page.evaluate(async () => {
    const { api, client } = await import(new URL('js/net.js', location.href));
    const sb = await client();
    const [lib, call] = await Promise.allSettled([sb.auth.refreshSession(), api('move', { dir: 'n' })]);
    return { lib: lib.status === 'fulfilled' && !lib.value.error, call: call.status };
  });
  assert.deepEqual(out, { lib: true, call: 'fulfilled' });
  const after = await stored(page);
  assert.equal(sessionOf(after), sessionOf(before), 'the same session');
  await page.click('[data-a="move"][data-v="s"]');
  await settle(page);
  assert.equal(await page.isVisible('#authform'), false, 'and it works');
  await done(ctx);
});

test('F-1 proof 4: refusals in two tabs at once share one renewal across the browser', async () => {
  const backend = new FakeBackend();
  const ctx = await playing(backend);
  const { page: a } = ctx;
  const b = await secondTab(ctx);
  await b.goto(`${env.url}/`);
  await inGame(b);
  const r0 = renewals(backend);
  backend.staleTokens = 2;
  const go = (p) => p.evaluate(async () => { const { api } = await import(new URL('js/net.js', location.href)); return api('state').then(() => 'ok', (e) => `error ${e.status}`); });
  assert.deepEqual(await Promise.all([go(a), go(b)]), ['ok', 'ok']);
  assert.equal(renewals(backend) - r0, 1, 'one renewal request for both tabs');
  await done(ctx, { pages: [a, b] });
});
