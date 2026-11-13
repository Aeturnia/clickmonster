// Landing page, phase L-1 (docs/landing-scope.md): the entrance in the HTML, no game code for
// anonymous visitors, one Supabase client and one auth listener, saved sessions, the in-place
// hand-over to the game, signing out, and each part failing on its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, ACCOUNTS, axe, savedSession, makeHero, fixedQuest } from './harness.mjs';
import { SUPABASE_URL } from '../../public/js/config.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const SUPA_HOST = new URL(SUPABASE_URL).host;
const AUTH_KEY = 'clickmonster.auth';

// Every request the page makes, in order, as paths (own site) or host + path (anything else).
function track(page, base) {
  const log = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    log.push(r.url().startsWith(base) ? u.pathname : `${u.host}${u.pathname}`);
  });
  return log;
}
const gameModules = (log) => log.filter((p) => p.startsWith('/js/') && p !== '/js/entry.js' && p !== '/js/net.js' && p !== '/js/config.js');
const library = (log) => log.filter((p) => p.startsWith('/vendor/'));

// Counts clients and auth listeners: wraps the library's createClient as the vendored script
// defines window.supabase.
const COUNT_CLIENTS = () => {
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
};

async function open({ backend = new FakeBackend(), viewport = { width: 390, height: 844 }, mobile = true, saved, reducedMotion, count = false } = {}) {
  const ctx = await env.page({ backend, viewport, mobile, reducedMotion });
  if (count) await ctx.page.addInitScript(COUNT_CLIENTS);
  if (saved !== undefined) await ctx.page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [AUTH_KEY, typeof saved === 'string' ? saved : JSON.stringify(saved)]);
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
const visible = (page, sel) => page.isVisible(sel);
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, sel);

// ---------------------------------------------------------------- first paint

test('LAC-1 the entrance is in the HTML: name and form visible with scripts off, with a note', async () => {
  const context = await env.browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${env.url}/`);
  assert.equal((await page.textContent('#entry h1')).trim(), 'ClickMonster');
  assert.ok(await page.isVisible('#authform #email'), 'the form is visible');
  assert.ok(await page.isVisible('#authform #password'));
  assert.match(await page.textContent('#entry noscript'), /needs JavaScript/);
  assert.equal(await page.getAttribute('#authform', 'method'), 'post', 'never puts the email in the address if sent without scripts');
  assert.equal(await page.isDisabled('#authform button[type=submit]'), true, 'nothing to send without scripts');
  await context.close();
});

test('LAC-2 / LAC-5a an anonymous visitor downloads no game code; the form starts the library; sign-in starts the game', async () => {
  const ctx = await open();
  const { page, log } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'no autofocus');
  await page.waitForTimeout(10000); // a visitor reading the entrance
  assert.deepEqual(log.filter((p) => !p.startsWith('/icon') && !p.startsWith('/manifest') && !p.startsWith('/favicon')), ['/', '/css/entry.css', '/js/entry.js'], 'document, entrance styles and script only');
  assert.deepEqual(gameModules(log), [], 'no game module');
  assert.deepEqual(library(log), [], 'no supabase-js');
  await page.focus('#email'); // the visitor starts to sign in
  await page.waitForFunction(() => !!window.supabase, null, { timeout: 5000 });
  assert.deepEqual(library(log), ['/vendor/supabase-js@2.45.4/supabase.js'], 'the library, from our own site');
  assert.deepEqual(gameModules(log), [], 'still no game module');
  assert.ok(!log.includes('/css/style.css'), 'nor the game stylesheet');
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await inGame(page);
  assert.ok(gameModules(log).includes('/js/main.js'), 'the game after sign-in');
  assert.ok(log.includes('/css/style.css'));
  for (const p of log) assert.ok(p.startsWith('/') || p.startsWith(SUPA_HOST), `own site or Supabase only: ${p}`);
  await done(ctx);
});

test('LAC-7 sign-in first: the email field is the first stop, and the form is on screen', async () => {
  for (const [w, h, whole] of [[320, 640, true], [390, 844, true], [844, 390, false]]) {
    const ctx = await open({ viewport: { width: w, height: h } });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#authform', { state: 'visible' });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'email', `${w}x${h}: Tab goes to the email field first`);
    const email = await box(page, '#email');
    assert.ok(email.bottom <= h, `${w}x${h}: the email field is on screen`);
    if (whole) assert.ok((await box(page, '#authform button[type=submit]')).bottom <= h, `${w}x${h}: the Sign in button is on screen`);
    const scrollX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById('entry').scrollWidth > innerWidth);
    assert.equal(scrollX, false, `${w}x${h}: no sideways scrolling`);
    await done(ctx);
  }
});

// ---------------------------------------------------------------- the hand-over

test('LAC-6 sign-in turns into the game in place: a status, no loading screen, focus on the screen heading', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  const release = backend.hold('state');
  await page.press('#password', 'Enter');
  await page.waitForFunction(() => document.getElementById('gate-status').textContent.includes('Entering the realm'));
  await page.waitForFunction(() => document.getElementById('app').classList.contains('veiled'), null, { timeout: 15000 });
  assert.equal(await visible(page, '#entry'), true, 'the entrance stays');
  assert.equal(await visible(page, '#authform'), false, 'the form gives way to the status');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility), 'hidden', 'the game is not shown half-drawn');
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), true, 'nor reachable');
  assert.doesNotMatch(await page.textContent('body'), /\bLoading\b/, 'no loading screen');
  release();
  await inGame(page);
  assert.equal(await visible(page, '#entry'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'screen-title', 'focus on the new screen heading');
  assert.equal(await page.evaluate(() => document.body.classList.contains('realm')), false);
  await settle(page);
  await noAxe(page, 'the game after sign-in');
  await done(ctx);
});

test('LAC-6 with reduced motion the game appears without movement', async () => {
  const ctx = await open({ reducedMotion: 'reduce' });
  const { page } = ctx;
  await page.addInitScript(() => {
    window.__arriving = false;
    new MutationObserver(() => { if (document.getElementById('app')?.classList.contains('arriving')) window.__arriving = true; })
      .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await signIn(page, env.url, 'player');
  await inGame(page);
  assert.equal(await page.evaluate(() => window.__arriving), false);
  await done(ctx);
});

test('LAC-10a hero creation keeps its mechanics in the entrance style', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'fresh');
  await page.waitForSelector('#name', { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.body.classList.contains('creating')), true, "the entrance's backdrop");
  assert.ok(await page.isVisible('.realm-create .realm-head'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-a="race"]').length > 1), true, 'race choice');
  await noAxe(page, 'hero creation');
  await page.fill('#name', 'x');
  await page.click('[data-a="create"]');
  await page.waitForSelector('#name-error');
  assert.equal(backend.calls.filter((c) => c.action === 'create').length, 0, 'validated before sending');
  await page.fill('#name', 'Ada Stone');
  await page.click('[data-a="create"]');
  await inGame(page);
  assert.equal(backend.calls.filter((c) => c.action === 'create').length, 1);
  assert.equal(await page.evaluate(() => document.body.classList.contains('creating')), false);
  await done(ctx);
});

test('LAC-8 signing out returns to the entrance without a reload, focused and with a message', async () => {
  const ctx = await open();
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  await page.evaluate(() => { window.__samePage = true; });
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.click('#main [data-a="signout"]');
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await page.evaluate(() => window.__samePage), true, 'no reload');
  assert.equal(await visible(page, '#app'), false);
  assert.match(await page.textContent('#auth-msg'), /You have signed out/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-h', 'focus on the gate heading');
  assert.equal(await page.inputValue('#password'), '', 'the password is cleared');
  assert.equal(await page.evaluate(() => document.getElementById('main').textContent), '', 'nothing of the game left behind');
  await noAxe(page, 'entrance after signing out');
  await done(ctx);
});

test('LAC-8 a session that ends during play returns to the entrance and says so', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await inGame(page);
  backend.revoked.add(`refresh-${ACCOUNTS.player.id}`);
  await page.evaluate(async () => { const { sb } = await import(new URL('js/net.js', location.href)); await sb.auth.refreshSession(); });
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.match(await page.textContent('#auth-msg'), /Your session has ended/);
  assert.equal(await visible(page, '#app'), false);
  await done(ctx);
});

test('LAC-5b an account change while the game is starting leaves nothing of the first start behind', async () => {
  // Signed out during start-up: the held start returns to nothing.
  const backend = new FakeBackend();
  const ctx = await open({ backend });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  let release = backend.hold('state');
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => document.getElementById('app').classList.contains('veiled'), null, { timeout: 15000 });
  await page.evaluate(async () => { const { sb } = await import(new URL('js/net.js', location.href)); await sb.auth.signOut(); });
  await page.waitForSelector('#authform', { state: 'visible' });
  release();
  await page.waitForTimeout(600);
  assert.equal(await visible(page, '#app'), false, 'the stale start never shows the game');
  assert.equal(await visible(page, '#authform'), true);
  assert.equal(stateCalls(backend), 1);

  // Switched account during start-up: only the second account's hero appears.
  backend.heroes[ACCOUNTS.mod.id] = makeHero({ name: 'Moderator Mia' });
  backend.charIds[ACCOUNTS.mod.id] = 'char-mod';
  release = backend.hold('state');
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => document.getElementById('app').classList.contains('veiled'), null, { timeout: 15000 });
  await page.evaluate(async (acct) => {
    const { sb } = await import(new URL('js/net.js', location.href));
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: acct.email, password: acct.password });
  }, ACCOUNTS.mod);
  await page.waitForFunction(() => document.getElementById('app').classList.contains('veiled'), null, { timeout: 15000 });
  release();
  await page.waitForFunction(() => document.querySelector('#top .hud-name')?.textContent.includes('Moderator Mia'), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  assert.match(await page.textContent('#top .hud-name'), /Moderator Mia/);
  assert.equal(stateCalls(backend), 3, 'one start per sign-in');
  await done(ctx);
});

test('LAC-5b signing out after the hero loads but before chat has started leaves no error behind', async () => {
  const ctx = await open();
  const { page } = ctx;
  let open_ = null;
  const gate = new Promise((r) => { open_ = r; });
  await page.route('**/rest/v1/rpc/my_character*', async (r) => { await gate; await r.fallback(); });
  await signIn(page, env.url, 'player');
  await inGame(page); // the hero is drawn; chat is still waiting
  await page.evaluate(async () => { const { sb } = await import(new URL('js/net.js', location.href)); await sb.auth.signOut(); });
  await page.waitForSelector('#authform', { state: 'visible' });
  open_();
  await page.waitForTimeout(800);
  assert.equal(await visible(page, '#app'), false);
  await done(ctx); // no page errors from the chat start-up that finished late
});

// ---------------------------------------------------------------- one client, saved sessions

test('LAC-5 / LAC-5b a saved session goes straight in: no form at any frame, one client, one listener', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player), count: true });
  const { page, log } = ctx;
  await page.addInitScript(() => {
    window.__formSeen = false;
    const look = () => {
      const f = document.getElementById('authform');
      if (f && f.getClientRects().length && getComputedStyle(f).display !== 'none' && !document.getElementById('entry').hidden) window.__formSeen = true;
      if (!document.querySelector('#top .hud-row')) requestAnimationFrame(look);
    };
    document.addEventListener('DOMContentLoaded', look);
  });
  await page.goto(`${env.url}/`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('resuming') || !!document.querySelector('#top .hud-row')), true);
  await inGame(page);
  assert.equal(await page.evaluate(() => window.__formSeen), false, 'the form never showed');
  assert.ok(log.indexOf('/js/main.js') >= 0 && log.indexOf('/js/main.js') < log.indexOf('/vendor/supabase-js@2.45.4/supabase.js'), 'the game started loading before the session was even checked');
  assert.equal(stateCalls(backend), 1);
  assert.deepEqual(await page.evaluate(() => [window.__clients, window.__listeners]), [1, 1], 'one client, one auth listener');
  // A token refresh and a repeated sign-in for the same user change nothing.
  await page.evaluate(async (acct) => {
    const { sb } = await import(new URL('js/net.js', location.href));
    await sb.auth.refreshSession();
    await sb.auth.signInWithPassword({ email: acct.email, password: acct.password });
  }, ACCOUNTS.player);
  await page.waitForTimeout(400);
  assert.equal(stateCalls(backend), 1, 'no second start');
  assert.equal(await visible(page, '#entry'), false);
  // An account switch stops and starts once.
  backend.heroes[ACCOUNTS.mod.id] = makeHero({ name: 'Moderator Mia' });
  backend.charIds[ACCOUNTS.mod.id] = 'char-mod';
  await page.evaluate(async (acct) => {
    const { sb } = await import(new URL('js/net.js', location.href));
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: acct.email, password: acct.password });
  }, ACCOUNTS.mod);
  await page.waitForFunction(() => document.querySelector('#top .hud-name')?.textContent.includes('Moderator Mia'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  assert.equal(stateCalls(backend), 2, 'one start for the new account');
  assert.deepEqual(await page.evaluate(() => [window.__clients, window.__listeners]), [1, 1], 'still one client and one listener');
  await done(ctx);
});

test('LAC-5b an expired session with a working refresh token is refreshed, then the game starts', async () => {
  const backend = new FakeBackend();
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player, -60) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await inGame(page);
  assert.ok(backend.authCalls.includes('refresh_token'), 'refreshed');
  assert.equal(stateCalls(backend), 1);
  await done(ctx);
});

test('LAC-5b an expired session the server refuses: the form, a message, and no game start', async () => {
  const backend = new FakeBackend();
  backend.revoked.add(`refresh-${ACCOUNTS.player.id}`);
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player, -60) });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.waitForSelector('#authform', { state: 'visible', timeout: 15000 });
  assert.match(await page.textContent('#auth-msg'), /Your session has ended/);
  assert.equal(stateCalls(backend), 0, 'the game was not started');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('resuming')), false, 'the status resolved');
  await done(ctx);
});

test('LAC-5b a malformed saved session counts as none: the entrance works and sign-in succeeds', async () => {
  for (const bad of ['not json', '{"access_token": 5}']) {
    const ctx = await open({ saved: bad });
    const { page, log } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#authform', { state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('resuming')), false, `${bad}: no status`);
    assert.equal(await visible(page, '#auth-msg'), false, `${bad}: no message`);
    await page.waitForTimeout(300);
    assert.deepEqual(library(log), [], `${bad}: nothing loaded`);
    await page.fill('#email', ACCOUNTS.player.email);
    await page.fill('#password', ACCOUNTS.player.password);
    await page.click('#authform button[type=submit]');
    await inGame(page);
    await done(ctx);
  }
});

test('LAC-5b a library that fails once and is retried still gives one client', async () => {
  const ctx = await open({ count: true });
  const { page } = ctx;
  let fail = 2; // the first attempt (on focus) and the first send
  await page.route('**/vendor/supabase-js@2.45.4/supabase.js', (r) => (fail-- > 0 ? r.abort('internetdisconnected') : r.continue()));
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => /could not be loaded/.test(document.getElementById('auth-msg').textContent));
  assert.equal(await page.getAttribute('#auth-msg', 'role'), 'alert');
  await page.click('#authform button[type=submit]');
  await inGame(page);
  assert.deepEqual(await page.evaluate(() => [window.__clients, window.__listeners]), [1, 1]);
  await done(ctx);
});

// ---------------------------------------------------------------- each part fails on its own (LAC-21)

test('LAC-21 the library unavailable: the entrance stays usable and sign-in says so', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.route('**/vendor/**', (r) => r.abort('internetdisconnected'));
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('auth-msg').hidden);
  assert.match(await page.textContent('#auth-msg'), /could not be loaded.*try again/i);
  assert.equal(await page.getAttribute('#email', 'aria-invalid'), 'true');
  assert.equal(await page.getAttribute('#email', 'aria-describedby'), 'auth-msg');
  assert.equal(await page.isEnabled('#authform button[type=submit]'), true, 'the form can be sent again');
  await noAxe(page, 'entrance with the library unavailable');
  await done(ctx);
});

test('LAC-21 Supabase unreachable: sign-in says so, and a saved session gets Try again and Sign out', async () => {
  const backend = new FakeBackend();
  backend.offline = true;
  const ctx = await open({ backend });
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('auth-msg').hidden, null, { timeout: 15000 });
  assert.match(await page.textContent('#auth-msg'), /Can't reach the sign-in service/);
  await ctx.context.close();

  // A saved session that is still valid needs no network to restore; starting the game does.
  const b2 = new FakeBackend();
  b2.offline = true;
  const c2 = await open({ backend: b2, saved: savedSession(ACCOUNTS.player) });
  await c2.page.goto(`${env.url}/`);
  await c2.page.waitForSelector('#gate-problem', { state: 'visible', timeout: 15000 });
  assert.ok(await c2.page.isVisible('#gate-retry'));
  assert.ok(await c2.page.isVisible('#gate-signout'));
  assert.equal(await visible(c2.page, '#app'), false, 'no half-drawn game');
  await noAxe(c2.page, 'entrance: the game could not start');
  b2.offline = false;
  await c2.page.click('#gate-retry');
  await inGame(c2.page);
  await done(c2);
});

test('LAC-21 the first state call fails: Try again starts the game; Sign out returns to the form', async () => {
  const backend = new FakeBackend();
  backend.failNext('state', 500, 'The realm is resting. Try again in a moment.');
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('#gate-problem', { state: 'visible', timeout: 15000 });
  assert.match(await page.textContent('#gate-problem-text'), /The realm is resting/);
  await page.click('#gate-retry');
  await inGame(page);
  // And Sign out from the same place.
  backend.failNext('state', 500, 'Down again.');
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.click('#main [data-a="signout"]');
  await page.waitForSelector('#authform', { state: 'visible' });
  await page.fill('#email', ACCOUNTS.player.email);
  await page.fill('#password', ACCOUNTS.player.password);
  await page.click('#authform button[type=submit]');
  await page.waitForSelector('#gate-problem', { state: 'visible', timeout: 15000 });
  await page.click('#gate-signout');
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await visible(page, '#gate-problem'), false);
  await done(ctx);
});

test('LAC-21 the game code fails to load: the entrance stays, and Try again recovers', async () => {
  const ctx = await open();
  const { page } = ctx;
  let fail = true;
  await page.route('**/js/main.js', (r) => (fail ? r.abort('internetdisconnected') : r.continue()));
  await signIn(page, env.url, 'player');
  await page.waitForSelector('#gate-problem', { state: 'visible', timeout: 15000 });
  assert.equal(await visible(page, '#app'), false);
  fail = false;
  await page.click('#gate-retry');
  await inGame(page);
  await done(ctx);
});

// ---------------------------------------------------------------- the entrance's own states

test('the entrance: create-account mode and its confirmation message, without leaving the page', async () => {
  const ctx = await open();
  const { page } = ctx;
  await page.goto(`${env.url}/`);
  await page.click('#authmode');
  assert.equal((await page.textContent('#gate-h')).trim(), 'Create an account');
  assert.equal(await page.getAttribute('#password', 'autocomplete'), 'new-password');
  await page.fill('#email', 'new.hero@example.test');
  await page.fill('#password', 'a-long-password');
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => /Account created/.test(document.getElementById('auth-msg').textContent));
  assert.equal(await page.getAttribute('#auth-msg', 'role'), 'status');
  assert.equal((await page.textContent('#authform button[type=submit]')).trim(), 'Sign in', 'back to signing in');
  assert.equal(await page.inputValue('#email'), 'new.hero@example.test', 'the address is kept');
  await noAxe(page, 'entrance after creating an account');
  await page.fill('#password', 'wrong-password');
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => /Invalid login credentials/.test(document.getElementById('auth-msg').textContent));
  assert.equal(await page.getAttribute('#password', 'aria-invalid'), 'true');
  await done(ctx);
});

test('the entrance has no axe violations at phone, landscape, tablet and desktop sizes, signing in and resuming', async () => {
  for (const [w, h, mobile] of [[320, 640, true], [390, 844, true], [844, 390, true], [1024, 768, false], [1440, 900, false], [1920, 1080, false]]) {
    const ctx = await open({ viewport: { width: w, height: h }, mobile });
    const { page } = ctx;
    await page.goto(`${env.url}/`);
    await page.waitForSelector('#authform', { state: 'visible' });
    await noAxe(page, `entrance ${w}x${h}`);
    const scrollX = await page.evaluate(() => document.getElementById('entry').scrollWidth > innerWidth);
    assert.equal(scrollX, false, `${w}x${h}: no sideways scrolling`);
    await done(ctx);
  }
  const backend = new FakeBackend();
  const release = backend.hold('state');
  const ctx = await open({ backend, saved: savedSession(ACCOUNTS.player) });
  await ctx.page.goto(`${env.url}/`);
  await ctx.page.waitForFunction(() => document.getElementById('app').classList.contains('veiled'), null, { timeout: 15000 });
  assert.match(await ctx.page.textContent('#gate-status'), /Returning to the realm/);
  await noAxe(ctx.page, 'entrance while returning');
  release();
  await inGame(ctx.page);
  await done(ctx);
});

// ---------------------------------------------------------------- L-1 review: L1-01 and L1-02
// Requests still on their way when one account signs out and another signs in, in the same page.

// Two accounts with heroes in the same village (so the same buttons), told apart by name.
function twoHeroes(opts = {}) {
  const backend = new FakeBackend(opts);
  backend.heroes[ACCOUNTS.mod.id] = makeHero({ name: 'Moderator Mia' });
  backend.charIds[ACCOUNTS.mod.id] = 'char-mod';
  return backend;
}
// The same sign-out and sign-in the buttons take, through the page's own client.
async function switchTo(page, acct, name) {
  await page.evaluate(async (a) => {
    const { sb } = await import(new URL('js/net.js', location.href));
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: a.email, password: a.password });
  }, acct);
  await page.waitForFunction((n) => document.querySelector('#top .hud-name')?.textContent.includes(n), name, { timeout: 15000 });
  await settle(page);
}
const heroNow = (page) => page.evaluate(() => { const c = window.clickmonster.char; return c && { name: c.name, loc: { ...c.loc }, battle: !!c.battle }; });

test('L1-01 a late action answer for the previous account never reaches the next, and does not block it', async () => {
  const backend = twoHeroes();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="fight"]', { timeout: 15000 });
  await settle(page);
  // Account A starts a fight; the server's answer is held.
  const release = backend.hold('fight');
  await page.click('[data-a="fight"]');
  await page.waitForSelector('[data-a="fight"].pending[aria-busy="true"]');
  // A signs out and B signs in while it is still on its way.
  await switchTo(page, ACCOUNTS.mod, 'Moderator Mia');
  assert.equal(await page.locator('.pending, [aria-busy="true"]').count(), 0, "no pending state carried over from A");
  // B acts at once, and is not told the game is still busy with A's request.
  const start = await heroNow(page);
  await page.click('[data-a="move"]:not([aria-disabled="true"])');
  await settle(page);
  assert.doesNotMatch(await page.textContent('#toast'), /Still working/);
  const moved = await heroNow(page);
  assert.notDeepEqual(moved.loc, start.loc, "B's move went through");
  assert.equal(backend.calls.filter((c) => c.action === 'move').length, 1);
  // A's answer arrives now: it is dropped.
  release();
  await page.waitForTimeout(700);
  assert.deepEqual(await heroNow(page), { name: 'Moderator Mia', loc: moved.loc, battle: false }, "B's hero, unchanged");
  assert.match(await page.textContent('#top .hud-name'), /Moderator Mia/);
  assert.equal(await page.locator('#log').count(), 0, "A's fight never appears");
  assert.equal(await page.locator('.pending, [aria-busy="true"]').count(), 0);
  assert.equal(await page.textContent('#alerts'), '', 'nothing reported for A');
  // The same session keeps working normally.
  await page.waitForTimeout(270);
  await page.click('[data-a="move"]:not([aria-disabled="true"])');
  await settle(page);
  assert.equal(backend.calls.filter((c) => c.action === 'move').length, 2);
  await done(ctx);
});

test("L1-02 a delayed quest board for the previous account never fills the next account's board", async () => {
  const backend = twoHeroes({ quests: [fixedQuest()] });
  const ctx = await open({ backend });
  const { page } = ctx;
  // A's board request is held, then answered with an empty board (B's own is the real one).
  let openA;
  const gateA = new Promise((r) => { openA = r; });
  let first = true;
  await page.route('**/functions/v1/game', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action === 'quests' && first) {
      first = false;
      await gateA;
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ quests: [] }) });
    }
    return r.fallback();
  });
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="quests"]', { timeout: 15000 });
  await page.click('[data-a="quests"]');
  await page.waitForSelector('#sheet[open]');
  await switchTo(page, ACCOUNTS.mod, 'Moderator Mia');
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), false, "A's sheet is not left open");
  await page.click('[data-a="quests"]');
  await page.waitForSelector('#sheet .quest-row', { timeout: 15000 });
  openA(); // A's empty board arrives late
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#sheet .quest-row').count(), 1, "B's board, not A's");
  assert.doesNotMatch(await page.textContent('#sheet'), /The board is empty/);
  await done(ctx);
});

test('L1-02 a delayed player list for the previous account never appears for the next', async () => {
  const backend = twoHeroes();
  const ctx = await open({ backend });
  const { page } = ctx;
  let openA;
  const gateA = new Promise((r) => { openA = r; });
  let first = true;
  await page.route('**/rest/v1/characters*', async (r) => {
    if (first && r.request().url().includes('updated_at=gt')) {
      first = false;
      await gateA;
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ id: 'ghost', name: 'Ghost Of Account A', race: 'human', level: 12, updated_at: new Date().toISOString() }]) });
    }
    return r.fallback();
  });
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="list"][data-v="players"]', { timeout: 15000 });
  await page.click('[data-a="list"][data-v="players"]');
  await switchTo(page, ACCOUNTS.mod, 'Moderator Mia');
  await page.click('[data-a="list"][data-v="players"]');
  await settle(page);
  openA();
  await page.waitForTimeout(700);
  assert.doesNotMatch(await page.textContent('#main'), /Ghost Of Account A/, "A's list never shows for B");
  await done(ctx);
});

test("L1-01 the late answer would have replaced the next account's hero: it is dropped", async () => {
  const backend = twoHeroes();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="fight"]', { timeout: 15000 });
  await settle(page);
  const release = backend.hold('fight');
  await page.click('[data-a="fight"]');
  await page.evaluate(async (a) => {
    const { sb } = await import(new URL('js/net.js', location.href));
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: a.email, password: a.password });
  }, ACCOUNTS.mod);
  await page.waitForFunction(() => document.querySelector('#top .hud-name')?.textContent.includes('Moderator Mia'), null, { timeout: 15000 });
  const mia = await heroNow(page);
  release(); // A's fight answer, for A's hero, arrives in B's session
  await page.waitForTimeout(800);
  assert.deepEqual(await heroNow(page), { name: 'Moderator Mia', loc: mia.loc, battle: false });
  assert.match(await page.textContent('#top .hud-name'), /Moderator Mia/);
  await done(ctx);
});

test("L1-02 an older operation never clears the next account's pending indicator", async () => {
  const backend = twoHeroes();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="fight"]', { timeout: 15000 });
  await settle(page);
  const releaseA = backend.hold('fight');
  await page.click('[data-a="fight"]');
  await page.waitForSelector('[data-a="fight"].pending');
  await switchTo(page, ACCOUNTS.mod, 'Moderator Mia');
  const releaseB = backend.hold('move');
  await page.click('[data-a="move"]:not([aria-disabled="true"])');
  await page.waitForSelector('[data-a="move"].pending[aria-busy="true"]');
  releaseA(); // A's answer finishes while B's move is still pending
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-a="move"].pending[aria-busy="true"]').count(), 1, "B's move is still shown as pending");
  releaseB();
  await settle(page);
  assert.equal(await page.locator('.pending, [aria-busy="true"]').count(), 0);
  assert.equal(backend.calls.filter((c) => c.action === 'move').length, 1, "B's move completed");
  await done(ctx);
});

test('L1-02 a confirmation open when the session ends is closed, and confirms nothing', async () => {
  const backend = twoHeroes();
  const ctx = await open({ backend });
  const { page } = ctx;
  await signIn(page, env.url, 'player');
  await page.waitForSelector('[data-a="tab"][data-v="hero"]', { timeout: 15000 });
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.click('[data-a="delete"]');
  await page.waitForSelector('#confirm[open]');
  await page.evaluate(async () => { const { sb } = await import(new URL('js/net.js', location.href)); await sb.auth.signOut({ scope: 'local' }); });
  await page.waitForSelector('#authform', { state: 'visible' });
  assert.equal(await page.evaluate(() => document.getElementById('confirm')?.open ?? false), false, "A's question is gone");
  await page.fill('#email', ACCOUNTS.mod.email);
  await page.fill('#password', ACCOUNTS.mod.password);
  await page.click('#authform button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#top .hud-name')?.textContent.includes('Moderator Mia'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById('confirm')?.open ?? false), false);
  assert.equal(backend.calls.filter((c) => c.action === 'delete').length, 0, 'nothing deleted');
  await done(ctx);
});

