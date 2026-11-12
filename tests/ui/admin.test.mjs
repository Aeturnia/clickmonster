// Admin console UI regression tests (fake backend; no live access).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, FakeBackend, makeHero, axe, focusInfo } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

async function admin(viewport = { width: 1280, height: 900 }) {
  const backend = new FakeBackend({ hero: makeHero() });
  const ctx = await env.page({ backend, viewport, mobile: viewport.width < 800 });
  await signIn(ctx.page, env.url, 'admin', '/admin.html');
  await ctx.page.waitForSelector('.tiles', { timeout: 15000 });
  return ctx;
}
const tab = async (page, id) => { await page.click(`[data-a="tab"][data-v="${id}"]`); await page.waitForTimeout(300); };
function noLiveAccess(ctx) {
  assert.deepEqual(ctx.backend.unexpected, []);
  assert.deepEqual(ctx.page.errors, []);
}

test('admin axe: no serious or critical violations', async () => {
  const ctx = await admin();
  const { page } = ctx;
  const check = async (label) => assert.deepEqual(await axe(page, { minImpact: 'serious' }), [], label);
  await check('dashboard');
  await tab(page, 'players'); await check('players');
  await page.click('.row-link'); await page.waitForSelector('#sanction'); await check('player detail and editor');
  await tab(page, 'zones'); await check('zones list');
  await page.click('tr[data-v="ashford"] [data-a="zoneEdit"]'); await page.waitForSelector('#zone-form'); await check('zone editor');
  await tab(page, 'chat'); await check('chat moderation');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('admin: player rows can be opened with the keyboard', async () => {
  const ctx = await admin();
  const { page } = ctx;
  await tab(page, 'players');
  await page.evaluate(() => document.activeElement.blur());
  let f;
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); f = await focusInfo(page); if (f.a === 'open') break; }
  assert.equal(f.a, 'open', 'a player link is in the tab order');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sanction');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('admin: section tabs are all visible on a phone and mark the current one', async () => {
  const ctx = await admin({ width: 375, height: 812 });
  const { page } = ctx;
  const hidden = await page.evaluate(() => [...document.querySelectorAll('.a-tabs > *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth || r.left < 0; }).length);
  assert.equal(hidden, 0);
  assert.equal(await page.getAttribute('.a-tabs [aria-current="page"]', 'data-v'), 'dashboard');
  noLiveAccess(ctx);
  await ctx.context.close();
});

test('admin: errors stay until dismissed', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  backend.failNext('search', 500, 'Search is unavailable.');
  await tab(page, 'players');
  await page.waitForSelector('#alerts .alert');
  await page.waitForTimeout(3200);
  assert.match(await page.textContent('#alerts'), /Search is unavailable/);
  await page.click('#alerts [data-a="dismissProblem"]');
  assert.equal(await page.locator('#alerts .alert').count(), 0);
  noLiveAccess(ctx);
  await ctx.context.close();
});
