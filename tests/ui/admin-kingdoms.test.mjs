// Kingdoms K-1, stage K1-4: the admin console's Kingdoms section (#83; docs/kingdoms-k1-plan.md 2.4;
// the scope's 5.10 and 5.11). On the fake backend, whose admin function mirrors
// supabase/functions/admin/index.ts: the capability in meta (Q3), the role and open checks, the
// database functions' refusals, and an audit entry for each change. The real function and database
// are tested on the local stack (tests/db/kingdoms-api.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, adminTab, ACCOUNTS } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const PLAYER = ACCOUNTS.player.id;
const NAME = 'Bartholomew Thorne';

// A console with the player's hero holding plot 9, 3, and Alda holding 3, 2. meta: 'v8', 'closed'
// or 'open' (the admin function's Kingdoms capability).
async function console_({ who = 'admin', meta = 'open', width = 1440, height = 900, hash = '#kingdoms', plots = [] } = {}) {
  const hero = makeHero();
  hero.kingdom = { plot: { x: 9, y: 3 }, claimedAt: 1 };
  const backend = new FakeBackend({
    hero, adminKingdoms: meta,
    kingdoms: { plots: [{ x: 9, y: 3, status: 'claimed', character_id: 'char-player' }, { x: 3, y: 2, status: 'claimed', name: 'Alda' }, ...plots] },
  });
  const ctx = await env.page({ backend, viewport: { width, height }, mobile: width < 900 });
  await signIn(ctx.page, env.url, who, `/admin.html${hash}`);
  await ctx.page.waitForSelector('.a-nav', { timeout: 15000 });
  await ctx.page.waitForTimeout(300);
  await settle(ctx.page);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
  await ctx.context.close();
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);
const kCalls = (backend, action) => backend.adminKingdomCalls.filter((c) => !action || c.action === action);
const CHANGES = ['kingdomRevoke', 'kingdomReserve', 'kingdomUnreserve'];
const changeCalls = (backend) => backend.adminKingdomCalls.filter((c) => CHANGES.includes(c.action));
const kingdomLog = (backend) => backend.adminData().log.filter((l) => l.action.startsWith('kingdom:'));
// Requests as they arrive, before any hold (adminKingdomCalls is recorded when the function runs).
const arrived = (backend, action) => backend.calls.filter((c) => c.fn === 'admin' && c.action === action).length;
const has = async (page, sel) => !!(await page.$(sel));
async function showPlot(page, x, y) {
  await page.fill('#kp-x', String(x));
  await page.fill('#kp-y', String(y));
  await page.click('#kp-find button[type=submit]');
  await page.waitForFunction((t) => document.querySelector('#kp-title')?.textContent === t && !document.querySelector('[aria-busy="true"]'), `Plot ${x}, ${y}`);
  await settle(page);
}
async function until(cond, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ------------------------------------------------------------ Q3: the capability
test('K4-1 with the deployed function (admin v8, no kingdoms in meta): no Kingdoms section, and no Kingdom request', async () => {
  const ctx = await console_({ meta: 'v8', hash: '#kingdom/3,2' });
  const { page, backend } = ctx;
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'dashboard', 'a link to a plot falls back to the overview');
  assert.equal(await page.locator('[data-a="tab"][data-v="kingdoms"]').count(), 0, 'not in the navigation');
  assert.ok(backend.calls.some((c) => c.fn === 'admin' && c.action === 'meta'), 'meta was asked');
  assert.deepEqual(kCalls(backend), [], 'no Kingdom request');
  assert.equal(await page.textContent('#alerts'), '', 'and nothing said about it');
  // The hero's record carries their Kingdom, but without the capability it isn't shown.
  await adminTab(page, 'players'); await settle(page);
  await page.click('#admin [data-a="open"][data-v="char-player"]'); await page.waitForSelector('#player-title'); await settle(page);
  assert.ok(!(await page.textContent('#admin')).includes('Kingdom on plot'));
  assert.deepEqual(kCalls(backend), []);
  await done(ctx);
});

test('K4-2 closed: the plots can be looked up, the changes are not offered, and nothing is changed', async () => {
  const ctx = await console_({ meta: 'closed' });
  const { page, backend } = ctx;
  await page.waitForSelector('#kp-list-title');
  assert.match(await page.textContent('#kp-state'), /Kingdoms are closed. You can look plots up/);
  assert.match(await page.textContent('#admin'), /Alda/, 'the recent plots');
  await showPlot(page, 3, 2);
  assert.match(await page.textContent('#admin'), /Claimed by Alda, level 10/);
  assert.equal(await has(page, '#kp-revoke'), false, 'no revoke');
  await showPlot(page, 20, 20);
  assert.match(await page.textContent('#admin'), /Free. No hero holds it/);
  assert.equal(await has(page, '#kp-reserve'), false, 'no reserve');
  await noAxe(page, 'closed, a free plot');
  // The hero's record: their Kingdom, and a way to its plot.
  await adminTab(page, 'players'); await settle(page);
  await page.click('#admin [data-a="open"][data-v="char-player"]'); await page.waitForSelector('#player-title'); await settle(page);
  assert.match(await page.textContent('#admin'), /Kingdom on plot 9, 3/);
  await page.click('#admin [data-a="kpOpen"][data-v="9,3"]');
  await page.waitForFunction(() => document.querySelector('#kp-title')?.textContent === 'Plot 9, 3' && !document.querySelector('[aria-busy="true"]'));
  assert.match(await page.textContent('#admin'), new RegExp(`Claimed by ${NAME}`));
  assert.equal(await page.evaluate(() => location.hash), '#kingdom/9,3');
  assert.deepEqual(changeCalls(backend), [], 'no change was asked for');
  await done(ctx);
});

test('K4-3 open, a moderator: reads only, with the reason; no change is offered or sent', async () => {
  const ctx = await console_({ who: 'mod' });
  const { page, backend } = ctx;
  await page.waitForSelector('#kp-list-title');
  assert.match(await page.textContent('#kp-state'), /Only admins can revoke, reserve or unreserve plots/);
  await showPlot(page, 9, 3);
  assert.equal(await has(page, '#kp-revoke'), false);
  await showPlot(page, 20, 20);
  assert.equal(await has(page, '#kp-reserve'), false);
  assert.deepEqual(changeCalls(backend), []);
  await done(ctx);
});

// ------------------------------------------------------------ the changes
test('K4-4 revoke: a reason first, then type the hero\'s name; the instance and the owner shown are sent; audited', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  const plotId = backend.plots.find((p) => p.character_id === 'char-player').id;
  await showPlot(page, 9, 3);
  assert.match(await page.textContent('#admin'), new RegExp(`Ownership ${plotId}`));
  await noAxe(page, 'a claimed plot, open, admin');
  await page.click('#kp-revoke button[type=submit]'); await settle(page);
  assert.match(await page.textContent('#kp-revoke'), /Give a reason/);
  assert.equal(await has(page, '#confirm[open]'), false, 'no question without a reason');
  await page.fill('#kp-revoke-reason', 'Abandoned test account');
  await page.click('#kp-revoke button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  assert.match(await page.textContent('#confirm'), new RegExp(`Revoke ${NAME}’s Kingdom`));
  assert.equal(await page.$eval('#confirm [data-r="ok"]', (b) => b.disabled), true, 'until the name is typed');
  await noAxe(page, 'the revoke question');
  await page.fill('#confirm-input', NAME);
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.deepEqual(kCalls(backend, 'kingdomRevoke').map((c) => c.args), [{ x: 9, y: 3, plotId, characterId: 'char-player', reason: 'Abandoned test account' }]);
  assert.equal(backend.heroes[PLAYER].kingdom, undefined, 'the hero\'s Kingdom is gone with the plot (I-1)');
  await page.waitForFunction(() => /Free. No hero holds it/.test(document.querySelector('#admin').textContent));
  assert.match(await page.textContent('body'), /Kingdom is revoked. Nothing was refunded/);
  const [entry] = kingdomLog(backend);
  assert.equal(entry.action, 'kingdom:revoke');
  assert.deepEqual({ ...entry.details, at_ms: 0 }, { x: 9, y: 3, plot_id: plotId, reason: 'Abandoned test account', refund: 0, at_ms: 0 });
  await adminTab(page, 'log'); await settle(page);
  assert.match(await page.textContent('#admin'), new RegExp(`plot 9, 3, instance ${plotId}, reason: Abandoned test account`));
  await done(ctx);
});

test('K4-5 reserve a free plot, then unreserve it: normal questions, the reservation shown is named, both audited', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await showPlot(page, 20, 20);
  await page.fill('#kp-reserve-reason', 'Event plaza');
  await page.click('#kp-reserve button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  assert.match(await page.textContent('#confirm'), /Reserve plot 20, 20\?/);
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  const reserved = backend.plots.find((p) => p.x === 20 && p.y === 20);
  assert.equal(reserved?.status, 'reserved');
  await page.waitForSelector('#kp-unreserve');
  assert.match(await page.textContent('#admin'), new RegExp(`Reservation ${reserved.id}`));
  await page.fill('#kp-unreserve-reason', 'Event over');
  await page.click('#kp-unreserve button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.deepEqual(changeCalls(backend).map((c) => c.args), [
    { x: 20, y: 20, reason: 'Event plaza' },
    { x: 20, y: 20, plotId: reserved.id, reason: 'Event over' },
  ]);
  assert.equal(backend.plots.some((p) => p.x === 20 && p.y === 20), false);
  assert.deepEqual(kingdomLog(backend).map((l) => l.action).reverse(), ['kingdom:reserve', 'kingdom:unreserve']);
  await page.waitForSelector('#kp-reserve');
  await done(ctx);
});

test('K4-6 a stale revoke (the plot changed hands): one request with the instance shown, refused; the plot is read again; nothing is sent again', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  const oldId = backend.plots.find((p) => p.character_id === 'char-player').id;
  await showPlot(page, 9, 3);
  // Meanwhile the player released this Kingdom and claimed the same plot again: a new instance.
  const fresh = backend.reclaimFor(PLAYER, 9, 3);
  await page.fill('#kp-revoke-reason', 'Abandoned test account');
  await page.click('#kp-revoke button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  await page.fill('#confirm-input', NAME);
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.deepEqual(kCalls(backend, 'kingdomRevoke').map((c) => c.args.plotId), [oldId], 'one request, naming the instance shown');
  assert.match(await page.textContent('#alerts'), /That plot has changed since you looked/);
  await page.waitForFunction((id) => document.querySelector('#admin').textContent.includes(`Ownership ${id}`), fresh.id);
  assert.ok(backend.plots.some((p) => p.id === fresh.id), 'the new Kingdom is intact');
  assert.ok(backend.heroes[PLAYER].kingdom, 'and the hero keeps it');
  assert.deepEqual(kingdomLog(backend), [], 'nothing audited');
  await page.waitForTimeout(300);
  assert.equal(kCalls(backend, 'kingdomRevoke').length, 1, 'never sent again by itself');
  await done(ctx);
});

test('K4-7 a second press while a change is on its way sends nothing and asks nothing', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await showPlot(page, 20, 20);
  await page.fill('#kp-reserve-reason', 'Event plaza');
  const release = backend.hold('kingdomReserve');
  await page.click('#kp-reserve button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]');
  await until(() => arrived(backend, 'kingdomReserve') === 1, 'the reserve request');
  await page.click('#kp-reserve button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await has(page, '#confirm[open]'), false, 'no second question');
  assert.equal(arrived(backend, 'kingdomReserve'), 1, 'no second request');
  assert.match(await page.textContent('body'), /Still working on the last change to this plot/);
  release();
  await settle(page);
  assert.equal(kCalls(backend, 'kingdomReserve').length, 1);
  assert.equal(kingdomLog(backend).length, 1, 'one audit entry');
  await done(ctx);
});

test('K4-8 Kingdoms closed meanwhile: the change is refused, the section turns read-only, and nothing is sent again', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await showPlot(page, 20, 20);
  backend.adminKingdoms = 'closed';
  await page.fill('#kp-reserve-reason', 'Event plaza');
  await page.click('#kp-reserve button[type=submit]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.match(await page.textContent('#alerts'), /Kingdoms aren’t open yet/);
  await page.waitForSelector('#kp-state');
  assert.match(await page.textContent('#kp-state'), /Kingdoms are closed/);
  assert.equal(await has(page, '#kp-reserve'), false, 'the change is no longer offered');
  assert.equal(kCalls(backend, 'kingdomReserve').length, 1);
  assert.deepEqual(kingdomLog(backend), []);
  await done(ctx);
});

// ------------------------------------------------------------ reads
test('K4-9 a slow plot read overtaken by a newer one never replaces it', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  const release = backend.holdOnce('kingdomPlot');
  await page.fill('#kp-x', '3'); await page.fill('#kp-y', '2');
  await page.click('#kp-find button[type=submit]');
  await until(() => arrived(backend, 'kingdomPlot') === 1, 'the first plot read');
  await showPlot(page, 9, 3);
  release(); // plot 3, 2's answer arrives last
  await page.waitForTimeout(400); await settle(page);
  assert.equal(await page.textContent('#kp-title'), 'Plot 9, 3', 'the newer plot stays');
  assert.ok(!(await page.textContent('#admin')).includes('Alda'.concat(', level')), 'nothing of plot 3, 2');
  assert.equal(await page.evaluate(() => location.hash), '#kingdom/9,3');
  await done(ctx);
});

test('K4-10 a plot read still on its way at sign-out shows nothing to the next staff member', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  const release = backend.holdOnce('kingdomPlot');
  await page.fill('#kp-x', '3'); await page.fill('#kp-y', '2');
  await page.click('#kp-find button[type=submit]');
  await until(() => arrived(backend, 'kingdomPlot') === 1, 'the plot read');
  await page.click('[data-a="signout"]');
  await page.waitForSelector('#login');
  await page.fill('#email', ACCOUNTS.mod.email);
  await page.fill('#password', ACCOUNTS.mod.password);
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.a-nav', { timeout: 15000 });
  await page.waitForSelector('#kp-list-title');
  // Straight away, before the old answer lands: nothing of the previous sign-in's plot.
  assert.equal(await has(page, '#kp-title'), false, 'no plot record, or its loading, carried over');
  await settle(page);
  release();
  await page.waitForTimeout(400);
  await adminTab(page, 'kingdoms'); await settle(page);
  assert.equal(await has(page, '#kp-title'), false, 'no plot record carried over');
  assert.equal(kCalls(backend).filter((c) => c.account === ACCOUNTS.mod.id && c.action === 'kingdomPlot').length, 0);
  await done(ctx);
});

test('K4-11 a link to a plot opens it, after the capability is known', async () => {
  const ctx = await console_({ hash: '#kingdom/3,2' });
  const { page } = ctx;
  await page.waitForFunction(() => document.querySelector('#kp-title')?.textContent === 'Plot 3, 2' && !document.querySelector('[aria-busy="true"]'));
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'kingdoms');
  assert.match(await page.textContent('#admin'), /Claimed by Alda/);
  await done(ctx);
});

test('K4-12 at 320 px: the section fits, with no sideways scrolling, and axe finds nothing', async () => {
  const ctx = await console_({ width: 320, height: 640 });
  const { page } = ctx;
  await page.waitForSelector('#kp-list-title');
  await showPlot(page, 9, 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await noAxe(page, '320 px, a claimed plot');
  await done(ctx);
});

test('K4-13 a slow owner search overtaken by a newer one never replaces its results', async () => {
  const ctx = await console_();
  const { page, backend } = ctx;
  await page.waitForSelector('#kp-list-title'); await settle(page);
  const release = backend.holdOnce('kingdomSearch');
  await page.fill('#kp-q', 'Alda');
  await page.click('#kp-search button[type=submit]');
  await until(() => arrived(backend, 'kingdomSearch') === 2, 'the slow search'); // the first was the section's own list
  await page.fill('#kp-q', 'Bart');
  await page.click('#kp-search button[type=submit]');
  await page.waitForFunction(() => /contains “Bart”/.test(document.querySelector('#admin').textContent));
  release(); // the search for "Alda" answers last
  await page.waitForTimeout(400); await settle(page);
  const text = await page.textContent('#admin');
  assert.match(text, /contains “Bart”/, 'the newer search stays');
  assert.match(text, new RegExp(NAME));
  assert.equal(await page.locator('#admin table [data-a="kpOpen"][data-v="3,2"]').count(), 0, 'nothing of the older search');
  await done(ctx);
});
