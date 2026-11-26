// Kingdoms K-1, stage K1-3: the player's interface (#83; docs/kingdoms-k1-plan.md 2.3; scope 9).
// Run with: npm run test:ui. The fake backend mirrors the K1-2 game function, and kingdomsOn()
// opens Kingdoms in the browser with the same test values (level 1, cost 100).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, kingdomsOn, ACCOUNTS } from './harness.mjs';
import { KINGDOM_ZONE_ID } from '../../public/js/data/kingdoms.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const CROSSROADS = { zone: 'overworld', x: 4, y: 4 };
const GATE = { zone: KINGDOM_ZONE_ID, x: 1, y: 1 };

// A hero, a backend and a page. open: Kingdoms open in both the browser and the fake function.
// ownRow: false leaves out the plot row for the hero's Kingdom (the hero's record and the plots
// disagree, as when the page's copy of the hero is out of date).
async function game({ open = true, hero = {}, kingdom = null, ownRow = true, plots = [], viewport, mobile = true } = {}) {
  const h = makeHero({ ...GATE, ...hero });
  if (kingdom) h.kingdom = { plot: { x: kingdom.x, y: kingdom.y }, claimedAt: 1 };
  const seeded = kingdom && ownRow ? [{ x: kingdom.x, y: kingdom.y, status: 'claimed', character_id: 'char-player' }, ...plots] : plots;
  const backend = new FakeBackend({ hero: h, kingdoms: open ? { plots: seeded } : null });
  const ctx = await env.page({ backend, viewport, mobile });
  if (open) await kingdomsOn(ctx.page);
  await signIn(ctx.page, env.url);
  await ctx.page.waitForSelector('#main .place, #main .pad, #dock .pad, #log', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
const gameCalls = (backend, action) => backend.calls.filter((c) => c.fn === 'game' && (!action || c.action === action));
async function openMap(page) {
  await page.click('[data-a="tab"][data-v="map"]');
  await page.waitForSelector('.plots [data-a="kplot"]');
  await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
  await settle(page);
}
const cellLabel = (page, x, y) => page.getAttribute(`.plots [data-a="kplot"][data-v="${x},${y}"]`, 'aria-label');
function clean(ctx) {
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native dialogs');
}

// ------------------------------------------------------------ closed: nothing of Kingdoms, and no request
test('K3-1 closed (the shipped constants): no Kingdom request is sent, and nothing of Kingdoms is shown', async () => {
  const ctx = await game({ open: false, hero: CROSSROADS });
  const { page, backend } = ctx;
  assert.equal(await page.$('[data-a="portal"]'), null, 'no path to the Kingdom Lands at the Crossroads');
  assert.ok(!(await page.textContent('#main')).includes('Kingdom'), 'no Kingdom text on Explore');
  await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
  assert.ok(!(await page.textContent('#main')).includes('Kingdom'), 'no Kingdom section on the Hero tab');
  await page.click('[data-a="tab"][data-v="map"]'); await settle(page);
  assert.equal(await page.$('.plots'), null, 'the ordinary map, not a plot map');
  assert.ok(await page.$('#map'));
  assert.deepEqual(backend.kingdomCalls, [], 'no plot read, owner read, finder call or Kingdom action');
  assert.equal(gameCalls(backend).filter((c) => /^kingdom/.test(c.action)).length, 0);
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ entering, and the Kingdom Zone's screens
test('K3-2 the Crossroads leads to the Kingdom Lands; there, no monsters, no players, no arrow pad, and a way back', async () => {
  const ctx = await game({ hero: CROSSROADS });
  const { page, backend } = ctx;
  const travel = await page.textContent('[data-a="portal"]');
  assert.match(travel, /The Kingdom Lands/);
  await page.click('[data-a="portal"]'); await settle(page);
  assert.deepEqual(backend.heroes[Object.keys(backend.heroes)[0]].loc, GATE);
  const main = await page.textContent('#main');
  assert.match(main, /The Kingdom Lands/);
  assert.match(main, /Choose a free plot on the plot map/);
  assert.equal(await page.$('#mon-select'), null, 'no monsters');
  assert.equal(await page.$('[data-a="list"][data-v="players"]'), null, 'no players list');
  assert.equal(await page.$('#dock .pad'), null, 'no arrow pad');
  assert.match(await page.textContent('#dock [data-a="portal"]'), /Leave the Kingdom Lands/);
  const before = gameCalls(backend).length;
  await page.keyboard.press('ArrowDown'); await settle(page);
  assert.equal(gameCalls(backend).length, before, 'an arrow key sends no move');
  await page.click('#dock [data-a="portal"]'); await settle(page);
  assert.match(await page.textContent('#main'), /Overworld/);
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ the plot map
test('K3-3 the plot map shows a 10 x 10 window with each plot\'s status; moving it sends no game action', async () => {
  const ctx = await game({ plots: [{ x: 3, y: 2, status: 'claimed', name: 'Alda' }, { x: 5, y: 5, status: 'reserved' }] });
  const { page, backend } = ctx;
  await openMap(page);
  assert.equal(await page.$$eval('.plots [data-a="kplot"]', (b) => b.length), 100, 'exactly the window is drawn');
  assert.equal(await cellLabel(page, 3, 2), 'Plot 3, 2. Claimed by Alda');
  assert.equal(await cellLabel(page, 5, 5), 'Plot 5, 5. Reserved');
  assert.equal(await cellLabel(page, 1, 1), 'Plot 1, 1. Free');
  assert.match(await page.textContent('#plot-range'), /Plots 1 to 10 across, 1 to 10 down/);
  const calls = gameCalls(backend).length;
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
  assert.match(await page.textContent('#plot-range'), /Plots 11 to 20 across, 1 to 10 down/);
  assert.ok(await page.$('.plots [data-v="11,1"]'));
  await page.click('[data-a="kwin"][data-v="s"]'); await settle(page);
  await page.click('.plots [data-v="15,15"]'); await settle(page);
  assert.match(await page.textContent('.plot-sel'), /Plot 15, 15/);
  assert.equal(gameCalls(backend).length, calls, 'moving the view and selecting send nothing to the game');
  assert.deepEqual(backend.heroes[Object.keys(backend.heroes)[0]].loc, GATE, 'the hero stays at the gate');
  clean(ctx);
  await ctx.context.close();
});

test('K3-4 by keyboard: one tab stop, arrows move between plots, and past the edge move the view by one row', async () => {
  const ctx = await game();
  const { page } = ctx;
  await openMap(page);
  assert.equal(await page.$$eval('.plots [tabindex="0"]', (b) => b.length), 1, 'one plot in the tab order');
  await page.focus('.plots [data-v="1,1"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '2,1');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '2,10');
  await page.keyboard.press('ArrowDown'); // past the bottom edge
  await page.waitForFunction(() => document.activeElement?.dataset?.v === '2,11');
  assert.match(await page.textContent('#plot-range'), /2 to 11 down/, 'the view moved by one row');
  await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.v), '2,11', 'focus stays on the matching plot after the reload');
  await page.keyboard.press('Enter'); await settle(page);
  assert.match(await page.textContent('.plot-sel'), /Plot 2, 11/);
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ claiming
test('K3-5 claiming: tier 2 (focus on Cancel; Cancel sends nothing), then the claim, paid from carried gold', async () => {
  const ctx = await game({ hero: { gold: 500, bank: 0 } });
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="4,6"]'); await settle(page);
  assert.match(await page.textContent('[data-a="kclaim"]'), /Claim for 100 gold/);
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.textContent('#confirm-title'), 'Claim plot 4, 6?');
  const body = await page.textContent('#confirm-body');
  assert.match(body, /100 gold, from the gold you carry/);
  assert.match(body, /can’t be moved later/);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.r), 'cancel', 'focus starts on Cancel');
  await page.click('#confirm [data-r="cancel"]'); await settle(page);
  assert.equal(gameCalls(backend, 'kingdomClaim').length, 0, 'Cancel sends nothing');
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
  assert.deepEqual(gameCalls(backend, 'kingdomClaim').map((c) => c.args), [{ x: 4, y: 6 }]);
  assert.equal(await cellLabel(page, 4, 6), 'Plot 4, 6. Your Kingdom. Selected');
  const hero = backend.heroes[Object.keys(backend.heroes)[0]];
  assert.equal(hero.gold, 400);
  assert.deepEqual(hero.kingdom.plot, { x: 4, y: 6 });
  await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
  assert.match(await page.textContent('#main'), /Kingdom, on plot 4, 6/);
  clean(ctx);
  await ctx.context.close();
});

test('K3-6 a claim the hero can\'t pay for is offered disabled, with the reason; banked gold doesn\'t count', async () => {
  const ctx = await game({ hero: { gold: 99, bank: 100000 } });
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="2,2"]'); await settle(page);
  assert.equal(await page.$eval('[data-a="kclaim"]', (b) => b.disabled), true);
  assert.match(await page.textContent('.plot-sel'), /You carry 99\. Withdraw gold at a bank first/);
  assert.equal(gameCalls(backend, 'kingdomClaim').length, 0);
  clean(ctx);
  await ctx.context.close();
});

test('K3-7 a plot taken meanwhile: one claim is sent, refused (plot_taken), and the map is read again', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="7,7"]'); await settle(page);
  backend.plots.push({ id: 999, x: 7, y: 7, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  backend.ownerNames['char-rival'] = 'Rival';
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForFunction(() => /Claimed by Rival/.test(document.querySelector('.plots [data-v="7,7"]')?.getAttribute('aria-label') || ''));
  assert.equal(gameCalls(backend, 'kingdomClaim').length, 1, 'sent once, never again by itself');
  assert.match(await page.textContent('#alerts'), /That plot was just taken/);
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ releasing
test('K3-8 release: type the name; the plot instance on screen is sent; the Kingdom is gone', async () => {
  const ctx = await game({ kingdom: { x: 9, y: 3 } });
  const { page, backend } = ctx;
  const plotId = backend.plots.find((p) => p.character_id === 'char-player').id;
  await page.click('#dock [data-a="kmanage"]');
  await page.waitForSelector('#sheet [data-a="krelease"]');
  assert.match(await page.textContent('#sheet'), /Kingdom/);
  await page.click('#sheet [data-a="krelease"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.$eval('#confirm [data-r="ok"]', (b) => b.disabled), true, 'until the name is typed');
  await page.fill('#confirm-input', 'Bartholomew Thorne');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.deepEqual(gameCalls(backend, 'kingdomRelease').map((c) => c.args), [{ plotId }]);
  assert.equal(backend.heroes[Object.keys(backend.heroes)[0]].kingdom, undefined);
  assert.equal(await page.$('#sheet[open]'), null, 'the management view closed');
  assert.match(await page.textContent('#main'), /Choose a free plot/);
  clean(ctx);
  await ctx.context.close();
});

test('K3-9 a stale release (plot_changed): the old instance is sent once, the screen is read again, and the player must confirm again', async () => {
  const ctx = await game({ kingdom: { x: 9, y: 3 } });
  const { page, backend } = ctx;
  const oldId = backend.plots.find((p) => p.character_id === 'char-player').id;
  await page.click('#dock [data-a="kmanage"]');
  await page.waitForSelector('#sheet [data-a="krelease"]');
  // Another tab releases this Kingdom and claims another plot.
  const fresh = backend.reclaimFor(Object.keys(backend.heroes)[0], 12, 12);
  await page.click('#sheet [data-a="krelease"]');
  await page.waitForSelector('#confirm[open]');
  await page.fill('#confirm-input', 'Bartholomew Thorne');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForFunction(() => /plot 12, 12/.test(document.querySelector('#sheet')?.textContent || ''));
  assert.deepEqual(gameCalls(backend, 'kingdomRelease').map((c) => c.args), [{ plotId: oldId }], 'one release, naming the old instance');
  assert.match(await page.textContent('#alerts'), /Your Kingdom has changed since you looked/);
  assert.ok(backend.plots.some((p) => p.id === fresh.id), 'the new Kingdom is intact');
  assert.ok(gameCalls(backend, 'state').length >= 2, 'the hero was read again');
  await page.waitForSelector(`#sheet [data-a="krelease"][data-v="${fresh.id}"]`);
  assert.equal(gameCalls(backend, 'kingdomRelease').length, 1, 'nothing was sent again by itself');
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ the finders and jumping
test('K3-10 the finders are advisory and move only the view; a full map says so', async () => {
  const ctx = await game({ plots: [{ x: 5, y: 5, status: 'reserved' }, { x: 6, y: 5, status: 'reserved' }] });
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="5,5"]'); await settle(page);
  await page.click('[data-a="kfind"][data-v="near"]'); await settle(page);
  assert.match(await page.textContent('.plot-sel'), /Plot 4, 4/, 'nearest from 5, 5: ring 1, y then x');
  assert.ok(backend.kingdomCalls.some((c) => c.kind === 'finder' && c.args.p_random === false));
  await page.click('[data-a="kfind"][data-v="random"]'); await settle(page);
  assert.ok(backend.kingdomCalls.some((c) => c.kind === 'finder' && c.args.p_random === true));
  assert.equal(gameCalls(backend).filter((c) => c.action !== 'state').length, 0, 'no game action');
  // Every plot taken.
  backend.plots = [];
  for (let y = 1; y <= 100; y++) for (let x = 1; x <= 100; x++) backend.plots.push({ id: 10000 + y * 100 + x, x, y, status: 'reserved', character_id: null });
  await page.click('[data-a="kfind"][data-v="near"]'); await settle(page);
  assert.match(await page.textContent('#main'), /No free plots are left/);
  clean(ctx);
  await ctx.context.close();
});

test('K3-11 showing a plot by its coordinates; out-of-range input is refused with a message', async () => {
  const ctx = await game();
  const { page } = ctx;
  await openMap(page);
  await page.fill('#kjump-x', '57');
  await page.fill('#kjump-y', '83');
  await page.click('[data-a="kjump"]'); await settle(page);
  await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
  assert.ok(await page.$('.plots [data-v="57,83"]'));
  assert.match(await page.textContent('.plot-sel'), /Plot 57, 83/);
  await page.fill('#kjump-x', '0');
  await page.click('[data-a="kjump"]'); await settle(page);
  assert.match(await page.textContent('#main'), /Plots are numbered 1 to 100/);
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ the Hero tab, and deleting a hero
test('K3-12 the Hero tab: a summary outside the Kingdom Zone, Manage inside it, and the requirements without one', async () => {
  const away = await game({ hero: CROSSROADS, kingdom: { x: 20, y: 30 } });
  await away.page.click('[data-a="tab"][data-v="hero"]'); await settle(away.page);
  const t = await away.page.textContent('#main');
  assert.match(t, /Kingdom, on plot 20, 30/);
  assert.match(t, /Travel to the Kingdom Lands to manage it/);
  assert.equal(await away.page.$('#main [data-a="kmanage"]'), null);
  clean(away);
  await away.context.close();
  const none = await game({ hero: CROSSROADS });
  await none.page.click('[data-a="tab"][data-v="hero"]'); await settle(none.page);
  assert.match(await none.page.textContent('#main'), /Claiming needs level 1 and costs 100 gold, carried/);
  await none.context.close();
});

test('K3-13 deleting a hero with a Kingdom says the Kingdom is destroyed and its plot freed', async () => {
  const ctx = await game({ kingdom: { x: 9, y: 3 } });
  const { page, backend } = ctx;
  await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
  await page.click('[data-a="delete"]');
  await page.waitForSelector('#confirm[open]');
  assert.match(await page.textContent('#confirm-body'), /Kingdom, on plot 9, 3, is destroyed, and the plot is freed/);
  await page.click('#confirm [data-r="cancel"]'); await settle(page);
  assert.equal(gameCalls(backend, 'delete').length, 0);
  await ctx.context.close();
});

// ------------------------------------------------------------ account isolation
test('K3-14 the plot map\'s state belongs to the account: signing out and in again starts afresh', async () => {
  const ctx = await game();
  const { page } = ctx;
  await openMap(page);
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  await page.click('.plots [data-v="13,3"]'); await settle(page);
  await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
  await page.click('[data-a="signout"]');
  await page.waitForSelector('#authform');
  await signIn(page, env.url);
  await page.waitForSelector('#main .place', { timeout: 15000 });
  await settle(page);
  await openMap(page);
  assert.match(await page.textContent('#plot-range'), /Plots 1 to 10 across/, 'the view starts again');
  assert.equal(await page.$('.plot-sel'), null, 'no selection carried over');
  await ctx.context.close();
});

// ------------------------------------------------------------ widths, layouts and axe
test('K3-15 at 320 px the ten plots fit, each at least 24 px; in phone landscape too', async () => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 740, height: 360 }]) {
    const ctx = await game({ viewport });
    const { page } = ctx;
    await openMap(page);
    const m = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.plots button')].map((b) => b.getBoundingClientRect());
      const grid = document.querySelector('.plots').getBoundingClientRect();
      return { minW: Math.min(...cells.map((c) => c.width)), minH: Math.min(...cells.map((c) => c.height)), right: grid.right, vw: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    assert.ok(m.minW >= 24 && m.minH >= 24, `${viewport.width}: plots ${m.minW} x ${m.minH}`);
    assert.ok(m.right <= m.vw, `${viewport.width}: the grid fits (${m.right} <= ${m.vw})`);
    assert.ok(m.overflow <= 0, `${viewport.width}: no horizontal scrolling (${m.overflow})`);
    clean(ctx);
    await ctx.context.close();
  }
});

test('K3-16 desktop: the side column summarises the Kingdom Lands instead of drawing its squares', async () => {
  const ctx = await game({ viewport: { width: 1440, height: 900 }, mobile: false, kingdom: { x: 9, y: 3 } });
  const { page } = ctx;
  await page.waitForSelector('#minimap');
  assert.equal(await page.$$eval('#minimap .minimap i', (c) => c.length), 0, 'no squares drawn');
  assert.match(await page.textContent('#minimap'), /Your Kingdom is on plot 9, 3/);
  assert.ok((await page.$$eval('button', (b) => b.length)) < 400, 'the page never draws the 10,000 squares');
  clean(ctx);
  await ctx.context.close();
});

test('K3-17 axe: no violations of any impact on the Kingdom screens and dialogs', async () => {
  const ctx = await game({ plots: [{ x: 3, y: 2, status: 'claimed', name: 'Alda' }, { x: 5, y: 5, status: 'reserved' }] });
  const { page } = ctx;
  const check = async (label) => {
    const v = await axe(page, { minImpact: 'minor' });
    assert.deepEqual(v, [], `${label}: ${JSON.stringify(v, null, 1)}`);
  };
  await check('explore in the Kingdom Lands');
  await openMap(page);
  await check('plot map');
  await page.click('.plots [data-v="4,4"]'); await settle(page);
  await check('plot map, a plot selected');
  await page.click('[data-a="kclaim"]'); await page.waitForSelector('#confirm[open]');
  await check('claim dialog');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
  await check('hero tab, Kingdom section');
  await page.click('#main [data-a="kmanage"]'); await page.waitForSelector('#sheet [data-a="krelease"]');
  await check('management view');
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ review corrections (the K1-3 review)
const PLAYER = ACCOUNTS.player.id;
const NAME = 'Bartholomew Thorne';
// Wait, in the test, for something the fake backend records.
async function until(cond, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const bodyHas = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.body.textContent), re.source);
async function noViolations(page, label) {
  const v = await axe(page, { minImpact: 'minor' });
  assert.deepEqual(v, [], `${label}: ${JSON.stringify(v, null, 1)}`);
}
const claimOff = (page) => page.$eval('[data-a="kclaim"]', (b) => b.disabled || b.getAttribute('aria-disabled') === 'true');

// K1-UI01
test('K3-18 after a refusal the hero is read again before anything else can be sent, and Release waits for that answer', async () => {
  const ctx = await game({ kingdom: { x: 9, y: 3 } });
  const { page, backend } = ctx;
  const oldId = backend.plots.find((p) => p.character_id === 'char-player').id;
  await page.click('#dock [data-a="kmanage"]');
  await page.waitForSelector('#sheet [data-a="krelease"]');
  const fresh = backend.reclaimFor(PLAYER, 12, 12); // another tab released it and claimed again
  await page.click('#sheet [data-a="krelease"]');
  await page.waitForSelector('#confirm[open]');
  await page.fill('#confirm-input', NAME);
  const states = gameCalls(backend, 'state').length;
  const release = backend.hold('state'); // the hero's read after the refusal is slow
  await page.click('#confirm [data-r="ok"]');
  await until(() => gameCalls(backend, 'state').length > states, 'the hero to be read again');
  await page.waitForFunction(() => /Checking your hero/.test(document.querySelector('#sheet')?.textContent || ''));
  assert.equal(await page.$('#sheet [data-a="krelease"]'), null, 'no Release while the hero is read again');
  await page.click('#sheet [data-a="close"]');
  const sent = backend.calls.length;
  await page.click('#dock [data-a="portal"]'); // another action, while that read is on its way
  await page.waitForTimeout(300);
  assert.equal(backend.calls.length, sent, 'no other action was sent before the hero\'s answer');
  await bodyHas(page, /Still working on your last action/);
  release();
  await settle(page);
  assert.match(await page.textContent('#alerts'), /Your Kingdom has changed since you looked/, 'the refusal stays on screen');
  assert.match(await page.textContent('#main'), /Your Kingdom is on plot 12, 12/);
  await page.click('#dock [data-a="kmanage"]');
  await page.waitForSelector(`#sheet [data-a="krelease"][data-v="${fresh.id}"]`);
  assert.deepEqual(gameCalls(backend, 'kingdomRelease').map((c) => c.args), [{ plotId: oldId }], 'sent once, never again by itself');
  clean(ctx);
  await ctx.context.close();

  // A refused claim (plot_taken), by a hero without a Kingdom: here only the refusal's own read of
  // the hero holds other actions back.
  const two = await game();
  await openMap(two.page);
  await two.page.click('.plots [data-v="7,7"]'); await settle(two.page);
  two.backend.plots.push({ id: 999, x: 7, y: 7, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  two.backend.ownerNames['char-rival'] = 'Rival';
  await two.page.click('[data-a="kclaim"]');
  await two.page.waitForSelector('#confirm[open]');
  const states2 = gameCalls(two.backend, 'state').length;
  const release2 = two.backend.hold('state');
  await two.page.click('#confirm [data-r="ok"]');
  await until(() => gameCalls(two.backend, 'state').length > states2, 'the hero to be read again');
  await two.page.waitForFunction(() => /Checking your hero/.test(document.querySelector('#main')?.textContent || ''));
  await two.page.click('.plots [data-v="8,8"]'); // selecting sends nothing, and is allowed
  assert.equal(await claimOff(two.page), true, 'Claim waits for the hero\'s answer');
  const sent2 = two.backend.calls.length;
  await two.page.click('[data-a="tab"][data-v="explore"]'); // a view change, sent nowhere
  await two.page.click('#dock [data-a="portal"]');
  await two.page.waitForTimeout(300);
  assert.equal(two.backend.calls.length, sent2, 'no other action was sent before the hero\'s answer');
  await bodyHas(two.page, /Still working on your last action/);
  release2();
  await settle(two.page);
  await two.page.click('[data-a="tab"][data-v="map"]'); await settle(two.page);
  await two.page.click('.plots [data-v="8,8"]'); await settle(two.page);
  assert.equal(await claimOff(two.page), false, 'Claim is offered again once the hero and plots are read');
  assert.equal(gameCalls(two.backend, 'kingdomClaim').length, 1);
  clean(two);
  await two.context.close();
});

test('K3-19 if reading the hero again fails, Claim and Release wait, with Try again; nothing is sent again by itself', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="7,7"]'); await settle(page);
  backend.plots.push({ id: 999, x: 7, y: 7, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  backend.ownerNames['char-rival'] = 'Rival';
  backend.failNext('state', 500, 'Server error — please try again.');
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForSelector('#main [data-a="kresync"]');
  assert.match(await page.textContent('#main'), /Couldn’t check your hero/);
  assert.match(await page.textContent('#alerts'), /That plot was just taken/, 'the refusal stays on screen');
  await page.click('.plots [data-v="8,8"]'); await settle(page);
  assert.equal(await claimOff(page), true, 'Claim waits');
  assert.match(await page.textContent('.plot-sel'), /Your hero couldn’t be checked/);
  await noViolations(page, 'the hero not checked');
  await page.click('#main [data-a="kresync"]'); await settle(page);
  assert.equal(await page.$('#main [data-a="kresync"]'), null);
  assert.equal(await claimOff(page), false, 'Claim is offered again');
  assert.equal(gameCalls(backend, 'kingdomClaim').length, 1, 'the claim was sent once');
  clean(ctx);
  await ctx.context.close();
});

test('K3-20 a version conflict (409, no reason) on a claim or a release shows no success, and asks again', async () => {
  const msg = 'Your hero was busy — try again.';
  const one = await game();
  await openMap(one.page);
  await one.page.click('.plots [data-v="4,4"]'); await settle(one.page);
  one.backend.failNext('kingdomClaim', 409, msg);
  await one.page.click('[data-a="kclaim"]');
  await one.page.waitForSelector('#confirm[open]');
  await one.page.click('#confirm [data-r="ok"]'); await settle(one.page);
  assert.match(await one.page.textContent('#alerts'), /Your hero was busy/);
  assert.ok(!(await one.page.textContent('body')).includes('You claimed plot'), 'no success shown');
  assert.equal(one.backend.heroes[PLAYER].kingdom, undefined);
  assert.match(await cellLabel(one.page, 4, 4), /Free/);
  await one.page.click('[data-a="kclaim"]');
  await one.page.waitForSelector('#confirm[open]'); // a second claim asks again
  await one.page.click('#confirm [data-r="cancel"]'); await settle(one.page);
  assert.equal(gameCalls(one.backend, 'kingdomClaim').length, 1);
  clean(one);
  await one.context.close();

  const two = await game({ kingdom: { x: 9, y: 3 } });
  await two.page.click('#dock [data-a="kmanage"]');
  await two.page.waitForSelector('#sheet [data-a="krelease"]');
  two.backend.failNext('kingdomRelease', 409, msg);
  await two.page.click('#sheet [data-a="krelease"]');
  await two.page.waitForSelector('#confirm[open]');
  await two.page.fill('#confirm-input', NAME);
  await two.page.click('#confirm [data-r="ok"]'); await settle(two.page);
  assert.match(await two.page.textContent('#alerts'), /Your hero was busy/);
  assert.ok(!(await two.page.textContent('body')).includes('Your Kingdom is released'), 'no success shown');
  assert.ok(two.backend.heroes[PLAYER].kingdom, 'the Kingdom is kept');
  assert.match(await two.page.textContent('#main'), /Your Kingdom is on plot 9, 3/);
  assert.equal(gameCalls(two.backend, 'kingdomRelease').length, 1);
  clean(two);
  await two.context.close();
});

// K1-UI02
test('K3-21 another hero\'s plot at the coordinates the hero records is never shown as theirs, and Release isn\'t offered', async () => {
  // The page's hero records plot 9, 3, but the database says Rival holds it.
  const ctx = await game({ kingdom: { x: 9, y: 3 }, ownRow: false, plots: [{ x: 9, y: 3, status: 'claimed', name: 'Rival' }] });
  const { page, backend } = ctx;
  const rivalId = backend.plots.find((p) => p.x === 9 && p.y === 3).id;
  await page.waitForSelector('#main [data-a="kretry"]');
  assert.match(await page.textContent('#main'), /Plot 9, 3 couldn’t be confirmed as your Kingdom/);
  await page.waitForTimeout(1000);
  assert.equal(gameCalls(backend, 'state').length, 2, 'the hero was read again once, not over and over');
  await noViolations(page, 'the plot not confirmed');
  await page.click('#dock [data-a="kmanage"]'); await settle(page);
  assert.equal(await page.$('#sheet [data-a="krelease"]'), null, 'no Release');
  assert.equal(await page.$(`[data-a="krelease"][data-v="${rivalId}"]`), null, 'nothing carries Rival\'s instance id');
  assert.match(await page.textContent('#sheet'), /couldn’t be confirmed/);
  assert.ok(!(await page.textContent('#sheet')).includes('Loading your plot'));
  await page.click('#sheet [data-a="close"]'); await settle(page);
  await openMap(page);
  assert.match(await cellLabel(page, 9, 3), /Claimed by Rival/);
  await page.click('.plots [data-v="9,3"]'); await settle(page);
  assert.equal(await page.$('.plot-sel [data-a="kmanage"]'), null);
  // The hero's record catches up (another tab released it): Try again reads the hero again.
  delete backend.heroes[PLAYER].kingdom;
  await page.click('#main [data-a="kretry"]'); await settle(page);
  await page.click('[data-a="tab"][data-v="explore"]'); await settle(page);
  assert.match(await page.textContent('#main'), /Choose a free plot on the plot map/);
  assert.equal(gameCalls(backend, 'kingdomRelease').length, 0);
  clean(ctx);
  await ctx.context.close();
});

test('K3-22 a Kingdom with no plot row shows that it couldn\'t be confirmed, with Try again, not "Loading" for ever', async () => {
  const ctx = await game({ kingdom: { x: 9, y: 3 }, ownRow: false });
  const { page, backend } = ctx;
  await page.click('#dock [data-a="kmanage"]');
  await page.waitForSelector('#sheet [data-a="kretry"]');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Plot 9, 3 couldn’t be confirmed as your Kingdom/);
  assert.ok(!sheet.includes('Loading your plot'));
  assert.equal(await page.$('#sheet [data-a="krelease"]'), null);
  await page.waitForTimeout(1000);
  assert.equal(gameCalls(backend, 'state').length, 2, 'the hero was read again once');
  // Try again, still missing: one more read of the plot and the hero, and the same answer.
  await page.click('#sheet [data-a="kretry"]'); await settle(page);
  await page.waitForSelector('#sheet [data-a="kretry"]');
  assert.equal(gameCalls(backend, 'state').length, 3);
  assert.equal(gameCalls(backend, 'kingdomRelease').length, 0);
  clean(ctx);
  await ctx.context.close();
});

// K1-UI03
test('K3-23 a slow read of a window, overtaken after moving away and back, never replaces the newer plots', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  const release = backend.holdRead('window'); // the first read of plots 1-10 is slow
  await page.click('[data-a="tab"][data-v="map"]');
  await until(release.arrived, 'the first window read');
  backend.plots.push({ id: 990, x: 3, y: 3, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  backend.ownerNames['char-rival'] = 'Rival';
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  await page.click('[data-a="kwin"][data-v="w"]'); await settle(page);
  assert.match(await cellLabel(page, 3, 3), /Claimed by Rival/);
  release(); // the old answer, with 3, 3 free, arrives last
  await page.waitForTimeout(400); await settle(page);
  assert.match(await cellLabel(page, 3, 3), /Claimed by Rival/, 'the newer plots stay');
  assert.match(await page.textContent('#plot-range'), /Plots 1 to 10 across/);
  clean(ctx);
  await ctx.context.close();
});

test('K3-24 a plot read still on its way when the account changes sends nothing further, and shows nothing, for the next account', async () => {
  const ctx = await game({ plots: [{ x: 3, y: 2, status: 'claimed', name: 'Alda' }] });
  const { page, backend } = ctx;
  backend.heroes[ACCOUNTS.fresh.id] = makeHero({ ...GATE, name: 'Mira Vale' });
  backend.charIds[ACCOUNTS.fresh.id] = 'char-fresh';
  const release = backend.holdRead('window');
  await page.click('[data-a="tab"][data-v="map"]');
  await until(release.arrived, 'the window read');
  await page.click('[data-a="tab"][data-v="hero"]');
  await page.click('[data-a="signout"]');
  await page.waitForSelector('#authform');
  // Another account signs in on the same page, while the first account's read is still held.
  await page.fill('#email', ACCOUNTS.fresh.email);
  await page.fill('#password', ACCOUNTS.fresh.password);
  await page.click('#authform button[type=submit]');
  await page.waitForSelector('#main .place', { timeout: 15000 });
  await settle(page);
  assert.match(await page.textContent('#top'), /Mira Vale/);
  release();
  await page.waitForTimeout(500); await settle(page);
  assert.deepEqual(backend.kingdomCalls.filter((c) => c.kind === 'owners'), [], 'no owners read from the old answer');
  assert.equal(backend.kingdomCalls.filter((c) => c.account === ACCOUNTS.fresh.id).length, 0, 'nothing sent for the next account from the old read');
  assert.equal(await page.$('.plots'), null, 'the next account starts on Explore');
  clean(ctx);
  await ctx.context.close();
});

test('K3-25 a slow finder answer doesn\'t move a view the player has moved on from', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="5,5"]'); await settle(page);
  const release = backend.holdRead('finder');
  await page.click('[data-a="kfind"][data-v="near"]');
  await until(release.arrived, 'the finder');
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  release();
  await page.waitForFunction(() => !document.querySelector('[data-a="kfind"][disabled]'));
  await settle(page);
  assert.match(await page.textContent('#plot-range'), /Plots 11 to 20 across/, 'the view stays where the player moved it');
  assert.ok(!(await page.textContent('#main')).includes('was free just now'));
  // The finder works again from here.
  await page.click('[data-a="kfind"][data-v="near"]'); await settle(page);
  assert.match(await page.textContent('#main'), /was free just now/);
  clean(ctx);
  await ctx.context.close();
});

test('K3-26 a read on its way when the plots are refreshed is dropped: the refreshed plots are shown, not the old answer', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  const release = backend.holdRead('window'); // the next read of plots 1-10 is slow
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  await page.click('[data-a="kwin"][data-v="w"]');
  await until(release.arrived, 'the held window read');
  backend.plots.push({ id: 991, x: 3, y: 3, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  backend.ownerNames['char-rival'] = 'Rival';
  // Leaving the Kingdom Lands and coming back refreshes the plots, with that read still on its way.
  await page.click('[data-a="tab"][data-v="explore"]');
  await page.click('#dock [data-a="portal"]'); await settle(page);
  await page.click('[data-a="portal"]'); await settle(page);
  await page.click('[data-a="tab"][data-v="map"]');
  await page.waitForFunction(() => /Claimed by Rival/.test(document.querySelector('.plots [data-v="3,3"]')?.getAttribute('aria-label') || ''));
  release(); // the old answer, with 3, 3 free, arrives last
  await page.waitForTimeout(400); await settle(page);
  assert.match(await cellLabel(page, 3, 3), /Claimed by Rival/, 'the refreshed plots stay');
  clean(ctx);
  await ctx.context.close();
});

// ------------------------------------------------------------ re-review corrections (the K1-3 re-review)
// K1-UI01a
test('K3-27 a refused claim whose plot refresh fails: the cached plots stay, with Try again; Claim waits, and nothing is sent again', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="7,7"]'); await settle(page);
  backend.plots.push({ id: 999, x: 7, y: 7, status: 'claimed', character_id: 'char-rival', claimed_at: '' });
  backend.ownerNames['char-rival'] = 'Rival';
  backend.failRead('window'); // the plots' refresh after the refusal fails; the hero's read succeeds
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForSelector('#main [data-a="kretry"]');
  assert.match(await page.textContent('#main'), /Couldn’t check these plots again/);
  assert.equal(await page.$('#main [data-a="kresync"]'), null, 'the hero was read again');
  assert.match(await cellLabel(page, 7, 7), /Free/, 'the plots read before stay on screen');
  assert.match(await page.textContent('#alerts'), /That plot was just taken/, 'the refusal stays on screen');
  await page.click('.plots [data-v="8,8"]'); await settle(page);
  assert.equal(await claimOff(page), true, 'Claim waits for the plots');
  assert.match(await page.textContent('.plot-sel'), /The plots couldn’t be checked again/);
  await noViolations(page, 'the plots not checked again');
  await page.click('#main [data-a="kretry"]'); await settle(page);
  assert.equal(await page.$('#main [data-a="kretry"]'), null);
  assert.match(await cellLabel(page, 7, 7), /Claimed by Rival/);
  assert.equal(await claimOff(page), false, 'Claim is offered again');
  assert.equal(gameCalls(backend, 'kingdomClaim').length, 1, 'the claim was sent once');
  clean(ctx);
  await ctx.context.close();
});

// K1-UI03a
test('K3-28 a slow finder answer is dropped after the view moves away and comes back to where it was', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  await openMap(page);
  await page.click('.plots [data-v="5,5"]'); await settle(page);
  const release = backend.holdRead('finder');
  await page.click('[data-a="kfind"][data-v="near"]');
  await until(release.arrived, 'the finder');
  await page.click('[data-a="kwin"][data-v="e"]'); await settle(page);
  await page.click('[data-a="kwin"][data-v="w"]'); await settle(page);
  assert.match(await page.textContent('#plot-range'), /Plots 1 to 10 across/, 'back where it was');
  assert.equal(!!(await page.$('[data-a="kfind"][disabled]')), false, 'the finder buttons are back');
  release(); // the old answer (plot 4, 4) arrives now
  await page.waitForTimeout(400); await settle(page);
  assert.match(await page.textContent('.plot-sel'), /Plot 5, 5/, 'the selection is unchanged');
  assert.ok(!(await page.textContent('#main')).includes('was free just now'));
  // A refresh (here, after claiming plot 5, 5) drops a finder answer on its way, with no navigation.
  const again = backend.holdRead('finder');
  await page.click('[data-a="kfind"][data-v="near"]');
  await until(again.arrived, 'the second finder');
  await page.click('[data-a="kclaim"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  assert.equal(!!(await page.$('[data-a="kfind"][disabled]')), false, 'the finder buttons are back after the refresh');
  again();
  await page.waitForTimeout(400); await settle(page);
  assert.match(await page.textContent('.plot-sel'), /Plot 5, 5/, 'still the claimed plot');
  assert.ok(!(await page.textContent('#main')).includes('was free just now'));
  clean(ctx);
  await ctx.context.close();
});
