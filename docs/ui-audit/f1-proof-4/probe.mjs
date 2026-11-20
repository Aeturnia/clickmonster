// Probe (not part of the suite): F-1 proof 4's scenario, instrumented and scheduled.
// Records, per request to the game function and to the token endpoint: the tab, the access token it
// carried (a short tag: old or renewed), its order of arrival and the answer.
// Modes (MODE):
//   counter-race  the suite's fixture (backend.staleTokens = 2), with tab B's first call held until
//                 tab A has finished: the sequence the review proposed.
//   token-race    the same scheduling, but the refusal tied to the expired access token (as GoTrue's
//                 is): requests carrying the old token answer 401, others go on.
//   token-barrier the refusal tied to the old token, and both first calls held until both are in:
//                 the "two refusals at once" the test means.
//   nolock-barrier as token-barrier, with the cross-tab lock removed (navigator.locks undefined):
//                 does the setup still catch broken coordination?
// NEXT_SECOND=1 waits 1.2 s before the calls, so the renewal's access token is minted in a later
// second than the one it replaces: the fake's tokens are deterministic to the second, and without
// this a same-second renewal is byte-identical to the old token (docs/backlog.md, F-1 proof 4).
// It also records every write to clickmonster.auth in both tabs.
// Evidence for docs/backlog.md (F-1 proof 4), kept as it was run; not part of any suite. Run from the
// repository root, with the browser suite's Chromium installed:
//   HARNESS=file:///<repo>/tests/ui/harness.mjs MODE=counter-race NEXT_SECOND=1 node --test docs/ui-audit/f1-proof-4/probe.mjs
import { test, before, after } from 'node:test';
const { setup, signIn, FakeBackend, ACCOUNTS } = await import(process.env.HARNESS);
const MODE = process.env.MODE || 'counter-race';
let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

test(`probe F-1 proof 4: ${MODE}`, async () => {
  const backend = new FakeBackend();
  const ctx = await env.page({ backend, viewport: { width: 390, height: 844 }, mobile: true });
  const a = ctx.page;
  if (MODE.startsWith('nolock')) await ctx.context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { value: undefined }); } catch { /* */ } });
  await ctx.context.addInitScript(() => {
    window.__writes = [];
    const rt = (v) => { try { return JSON.parse(v)?.refresh_token; } catch { return '?'; } };
    const set = Storage.prototype.setItem, rm = Storage.prototype.removeItem;
    const where = () => (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 7).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '').slice(0, 90)).join(' < ');
    Storage.prototype.setItem = function (k, v) { if (k === 'clickmonster.auth') window.__writes.push({ t: Math.round(performance.timeOrigin + performance.now()), op: 'set', rt: rt(v), where: where() }); return set.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (k === 'clickmonster.auth') window.__writes.push({ t: Math.round(performance.timeOrigin + performance.now()), op: 'remove', where: where() }); return rm.call(this, k); };
  });
  await signIn(a, env.url, 'player');
  await a.waitForSelector('#top .hud-row', { timeout: 15000 });
  const b = await ctx.context.newPage();
  await b.goto(`${env.url}/`);
  await b.waitForSelector('#top .hud-row', { timeout: 15000 });
  const r0 = backend.authCalls.filter((g) => g === 'refresh_token').length;

  const log = [];
  const t0 = Date.now();
  const tags = new Map();
  const byReq = new Map();
  const tag = (auth) => { if (!tags.has(auth)) tags.set(auth, tags.size === 0 ? 'old' : `renewed${tags.size}`); return tags.get(auth); };
  const oldAuth = await a.evaluate(() => `Bearer ${JSON.parse(localStorage.getItem('clickmonster.auth')).access_token}`);
  tag(oldAuth);
  let release;
  const gate = new Promise((r) => { release = r; });
  let firstsIn = 0;
  for (const [name, p] of [['A', a], ['B', b]]) {
    await p.route('**/functions/v1/game', async (route) => {
      const auth = route.request().headers().authorization || '';
      const entry = { tab: name, token: tag(auth), arrived: Date.now() - t0 };
      log.push(entry);
      byReq.set(route.request(), entry);
      if (auth === oldAuth) {
        if (MODE.endsWith('race') && name === 'B') await gate; // B's first call held until A is done
        if (MODE.endsWith('barrier')) { firstsIn++; if (firstsIn === 2) release(); await gate; } // both in first
      }
      entry.sent = Date.now() - t0;
      if (MODE !== 'counter-race' && auth === oldAuth) { entry.status = 401; return route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'Please sign in again.' }) }); }
      await route.fallback();
    });
    p.on('response', (r) => { const e = byReq.get(r.request()); if (e) e.status = r.status(); });
    p.on('request', (r) => { if (r.url().includes('/auth/v1/token')) log.push({ tab: name, renewal: true, arrived: Date.now() - t0 }); });
  }
  const consA = [], consB = [], errA = [];
  a.on('console', (m) => consA.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
  b.on('console', (m) => consB.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
  a.on('pageerror', (e) => errA.push(e.message));
  if (process.env.NEXT_SECOND) await new Promise((r) => setTimeout(r, 1200)); // the renewal's token is minted in a later second
  if (MODE === 'counter-race') backend.staleTokens = 2;
  const go = (p) => p.evaluate(async () => { const { api } = await import(new URL('js/net.js', location.href)); return api('state').then(() => 'ok', (e) => `error ${e.status}${e.ended ? ' ended' : ''}`); });
  const pa = go(a);
  const pb = go(b); // both at once, as the test does
  if (MODE.endsWith('race')) { await pa; release(); } // B's first call waits until A has finished
  const results = await Promise.all([pa, pb]);
  const savedTag = async (p) => tag(`Bearer ${await p.evaluate(() => JSON.parse(localStorage.getItem('clickmonster.auth') || 'null')?.access_token)}`);
  const after = { A: await savedTag(a), B: await savedTag(b) };
  const writes = [...(await a.evaluate(() => window.__writes)).map((w) => ({ tab: 'A', ...w })), ...(await b.evaluate(() => window.__writes)).map((w) => ({ tab: 'B', ...w }))].filter((w) => w.t >= t0 - 5).sort((x, y) => x.t - y.t).map((w) => ({ ...w, t: w.t - t0 }));
  console.log(JSON.stringify({ WRITES: writes }));
  console.log(JSON.stringify({ MODE, after, consoleA: consA, consoleB: consB, errorsA: errA }));
  console.log(JSON.stringify({ MODE, results, renewals: backend.authCalls.filter((g) => g === 'refresh_token').length - r0, log }));
  await ctx.context.close();
});
