// Entry measurements on the UI test harness (fake backend, never the live one).
//   node tools/entry-metrics.mjs [out.json] [screenshot-dir] [shot-prefix: before | after]
// Set UI_PUBLIC_DIR to measure another checkout's public/ folder (for "before" numbers).
//
// Definitions (390x844 phone, a fresh visitor and a returning player with a saved session):
//   requests / bytes   every request the page made, and the decoded body bytes, from navigation
//                      until the moment named (sign-in form visible; hero bar drawn)
//   byType             the same, split into document, css, own scripts (/js/), the supabase-js
//                      CDN module, and Supabase API calls
//   modules            own ES modules (/js/*.js) loaded by then
//   gameModules        of those, the game's (everything but entry.js, net.js and config.js)
//   library            whether supabase-js had been requested (the CDN module or public/vendor/)
//   staticDepth        the longest static import chain from the page's entry module (entry.js
//                      since landing L-1, main.js before), counted from the files; each level is
//                      one more round trip before the module can run
//   gameDepth          the same from main.js
//   visitor.beforePaint the resources the browser started before its first contentful paint (its
//                      own Resource Timing), with their decoded size: what the first paint waited
//                      on, unlike the counts above, which include anything finished up to 300 ms
//                      after the form appeared (since landing L-4, that can include the news,
//                      which is loaded after the first paint, on purpose)
//   visitor.idle10s    a visitor who reads the entrance for 10 s without touching it: what had
//                      been requested by then (landing LAC-5a)
//   visitor.afterFocus the same visitor, 1.5 s after focusing the email field
//   loadedBeforeForm   the kinds of request that had finished when the form appeared (not all of
//                      them block it: see docs/landing-scope.md)
//   formBlockedBy      separate runs with one dependency failing (supabase-js aborted, from the
//                      CDN or public/vendor/; the zones read answered with 500): does the sign-in
//                      form appear within 8s, and what does the screen say instead
//   throttled          time from navigation to the visible sign-in form with Chrome's network
//                      throttling (150ms latency, 1.6 Mbit/s down) and 4x CPU slowdown, median of
//                      3 runs. Only requests that really go over the network are throttled; the
//                      CDN module is answered from the harness cache, so it is an underestimate
//   shots              the sign-in screen at each size, with axe at all impacts
// Bytes are decoded sizes as served locally, not the compressed sizes Netlify and the CDN send.
// The counts include requests that finished up to 300ms after the form appeared.
// Not measured here: real network timing, CPU time on a real phone, or the live Supabase and
// Netlify. The harness serves files locally and answers Supabase itself.
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, FakeBackend, axe } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/entry-metrics.json';
const PUBLIC = path.resolve(process.env.UI_PUBLIC_DIR || 'public');

function kind(u, base) {
  if (u.startsWith(base)) {
    const p = new URL(u).pathname;
    if (p.endsWith('.css')) return 'css';
    if (p.startsWith('/js/')) return 'ownJs';
    return 'document';
  }
  if (u.includes('cdn.jsdelivr.net')) return 'cdnJs';
  return 'api';
}

function track(page, base) {
  const log = [];
  page.on('requestfinished', async (req) => {
    let bytes = 0;
    try { bytes = (await req.response())?.body ? (await (await req.response()).body()).length : 0; } catch { /* aborted */ }
    log.push({ url: req.url(), kind: kind(req.url(), base), bytes });
  });
  return log;
}

const ENTRY_PATH = /\/js\/(entry|net|config)\.js$/;
const isLibrary = (u) => /cdn\.jsdelivr\.net\/npm\/@supabase|\/vendor\/supabase-js/.test(u);
function sum(log) {
  const byType = {};
  for (const r of log) {
    byType[r.kind] ||= { requests: 0, bytes: 0 };
    byType[r.kind].requests++;
    byType[r.kind].bytes += r.bytes;
  }
  return {
    requests: log.length,
    bytes: log.reduce((n, r) => n + r.bytes, 0),
    byType,
    modules: log.filter((r) => r.kind === 'ownJs').length,
    gameModules: log.filter((r) => r.kind === 'ownJs' && !ENTRY_PATH.test(new URL(r.url).pathname)).length,
    library: log.some((r) => isLibrary(r.url)),
  };
}

// The longest static import chain from a module, following relative imports only.
function depth(file, seen = new Map()) {
  if (seen.has(file)) return seen.get(file);
  seen.set(file, 1);
  const src = fs.readFileSync(file, 'utf8');
  let best = 0;
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    best = Math.max(best, depth(path.resolve(path.dirname(file), m[1]), seen));
  }
  const external = /^\s*import\s[^'"]*['"]https:/m.test(src) ? 1 : 0;
  const d = 1 + Math.max(best, external);
  seen.set(file, d);
  return d;
}

const h = await setup();
const entryModule = fs.existsSync(path.join(PUBLIC, 'js/entry.js')) ? 'js/entry.js' : 'js/main.js';
const result = { entryModule, staticDepth: depth(path.join(PUBLIC, entryModule)), gameDepth: depth(path.join(PUBLIC, 'js/main.js')) };

{ // A fresh visitor: no saved session.
  const { page, context } = await h.page();
  const log = track(page, h.url);
  await page.goto(h.url + '/');
  await page.waitForSelector('#authform', { state: 'visible' });
  await page.waitForTimeout(300); // let finished requests report their sizes
  result.visitor = sum(log);
  result.visitor.loadedBeforeForm = [...new Set(log.filter((r) => r.kind !== 'document').map((r) => r.kind))];
  result.visitor.beforePaint = await page.evaluate(() => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').filter((r) => paint != null && r.startTime < paint);
    return {
      firstContentfulPaintMs: paint == null ? null : Math.round(paint),
      requests: 1 + res.length,
      decodedBytes: (nav?.decodedBodySize || 0) + res.reduce((n, r) => n + (r.decodedBodySize || 0), 0),
      resources: res.map((r) => new URL(r.name).pathname),
    };
  });
  await page.waitForTimeout(10000 - 300);
  result.visitor.idle10s = sum(log);
  await page.focus('#email');
  await page.waitForTimeout(1500);
  result.visitor.afterFocus = sum(log);
  await context.close();
}

{ // A returning player: sign in once, then load the page again with the saved session.
  const { page, context } = await h.page({ backend: new FakeBackend() });
  await signIn(page, h.url);
  await page.waitForSelector('#top .hud-row', { state: 'visible' });
  const log = track(page, h.url);
  await page.goto(h.url + '/');
  await page.waitForSelector('#top .hud-row', { state: 'visible' });
  await page.waitForTimeout(300);
  result.returning = sum(log);
  await context.close();
}

// What blocks the form: one dependency failing at a time.
result.formBlockedBy = {};
for (const [name, pattern, how] of [
  ['libraryDown', /cdn\.jsdelivr\.net|\/vendor\//, (r) => r.abort('internetdisconnected')],
  ['zonesDown', /\/rest\/v1\/zones/, (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' })],
]) {
  const { page, context } = await h.page();
  await page.route(pattern, how);
  await page.goto(h.url + '/');
  const appeared = await page.waitForSelector('#authform', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
  result.formBlockedBy[name] = { formAppeared: appeared, screenText: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120) };
  await context.close();
}

// Throttled timing (see the caveat above).
{
  const times = [];
  for (let i = 0; i < 3; i++) {
    const { page, context } = await h.page();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto(h.url + '/');
    await page.waitForSelector('#authform', { state: 'visible' });
    times.push(Date.now() - t0);
    await context.close();
  }
  times.sort((a, b) => a - b);
  result.throttled = { msToForm: times[1], runs: times };
}

// The sign-in screen at each size, with axe.
const shotDir = process.argv[3];
if (shotDir) {
  fs.mkdirSync(shotDir, { recursive: true });
  result.shots = [];
  for (const [w, hh, mobile] of [[320, 640, true], [390, 844, true], [844, 390, true], [1024, 768, false], [1440, 900, false], [1920, 1080, false]]) {
    const { page, context } = await h.page({ viewport: { width: w, height: hh }, mobile });
    await page.goto(h.url + '/');
    await page.waitForSelector('#authform', { state: 'visible' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${shotDir}/${process.argv[4] || 'before'}-auth-${w}x${hh}.png` });
    const v = await axe(page, { minImpact: 'minor' });
    const form = await page.locator('#authform').boundingBox();
    result.shots.push({ size: `${w}x${hh}`, formTop: Math.round(form.y), formBottomInView: form.y + form.height <= hh, violations: v.map((x) => `${x.id}:${x.impact}`) });
    await context.close();
  }
}

await h.close();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
