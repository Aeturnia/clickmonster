// Failure diagnostics for the browser suite (CI-A review, CI-A-01).
//
// On when UI_DIAGNOSTICS=1 (the CI browser job sets it). Off by default, so local runs are as
// before. It changes no test, assertion, timeout or outcome: it only records.
//   - Before a page navigates, every test context starts a Playwright trace (DOM snapshots, network
//     and sources), through BrowserContext.tracing. The suite runs on node:test, not Playwright
//     Test, so Playwright Test's `trace: 'retain-on-failure'` option doesn't apply.
//   - The trace's own screenshots (its screencast) are off, to reduce recording overhead (CI-A
//     review, CI-A-02). The failure screenshot below is taken separately. UI_TRACE_SCREENSHOTS=1
//     turns the screencast back on, for comparison only.
//   - Resource measurements for every test, passing or failing (CI-A-02), one JSON line each in
//     tests/ui/artifacts/metrics/<file>.jsonl, with the runner's details as the file's first line:
//     the test's duration; the Node test process's event-loop delay (monitorEventLoopDelay, 20 ms
//     resolution) and CPU use; the whole machine's CPU use (os.cpus() times); and memory. They are
//     read at each test's start and end only, so they add almost no work. The Node test process is
//     the one that serves the page files (startServer) and answers the fake backend (attach).
//     Reading the event-loop figures: the histogram includes its own sampling interval, rounded up to
//     the OS timer. On Windows (15.6 ms ticks) an idle process reads about 31 ms at a 20 ms resolution,
//     so the delay is the reading minus about 31 ms; a 300 ms stall reads as a maximum of about 316.
//   - From the start, each page records console errors and warnings, page errors, failed requests,
//     responses of 400 and over, and which requests are still in flight.
//   - When a test fails (an afterEach hook sees `passed === false`), each of that test's contexts
//     still open is written to tests/ui/artifacts/failures/<file>/<test>/:
//       trace.zip       the Playwright trace (open with `npx playwright show-trace trace.zip`)
//       screenshot.png  the page as it was
//       dom.html        the page's DOM
//       diag.json       the URL, a probe of the page's state (below), the recorded errors and
//                       requests, the requests still in flight, and the fake backend's recent calls
//     A passing test's trace is discarded when its context closes; nothing is kept.
//   - The probe tells a stalled browser from a page that is running but stuck: it times a trivial
//     evaluate and a requestAnimationFrame, and records readyState, which key elements exist and
//     are visible, and which resources loaded.
//   - Every step has its own time limit and every error is caught, so the diagnostics can never
//     hang a run or change a test's result. The test's own failure is what fails the run.
// Collection stays inside the test environment: the pages only ever talk to the local server and
// the fake backend (attach() in harness.mjs blocks everything else).
import { beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export const DIAGNOSTICS = process.env.UI_DIAGNOSTICS === '1';
export const TRACE_SCREENSHOTS = process.env.UI_TRACE_SCREENSHOTS === '1';
const ROOT = new URL('./artifacts/failures/', import.meta.url);
const METRICS = new URL('./artifacts/metrics/', import.meta.url);
const FILE = path.basename(process.argv[1] || 'unknown', '.mjs');

// ---------------------------------------------------------------- resource measurements (CI-A-02)
const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const ms = (ns) => round(ns / 1e6);
const mb = (b) => Math.round(b / 1048576);
const eld = DIAGNOSTICS ? monitorEventLoopDelay({ resolution: 20 }) : null;
eld?.enable();
function machineCpu() {
  let busy = 0, total = 0;
  for (const { times: t } of os.cpus()) { const b = t.user + t.nice + t.sys + t.irq; busy += b; total += b + t.idle; }
  return { busy, total };
}
const mark = () => ({ wall: performance.now(), cpu: process.cpuUsage(), machine: machineCpu() });
// Since `from`: wall time, the Node process's CPU (user + system, all its threads, as a percentage of
// one core), the machine's CPU (all cores, as a percentage of all of them), event-loop delay, memory.
function measure(from) {
  const now = mark();
  const wallMs = now.wall - from.wall;
  const cpu = process.cpuUsage(from.cpu);
  const busy = now.machine.busy - from.machine.busy;
  const total = now.machine.total - from.machine.total;
  const mem = process.memoryUsage();
  return {
    durationMs: Math.round(wallMs),
    nodeCpuPct: round((100 * (cpu.user + cpu.system)) / 1000 / wallMs),
    machineCpuPct: total > 0 ? round((100 * busy) / total) : null,
    eventLoopDelayMs: eld ? { mean: ms(eld.mean), p99: ms(eld.percentile(99)), max: ms(eld.max) } : null,
    rssMB: mb(mem.rss), heapUsedMB: mb(mem.heapUsed), freeMemMB: mb(os.freemem()),
  };
}
let metricsFile = null;
function writeMetrics(line) {
  try {
    if (!metricsFile) {
      fs.mkdirSync(METRICS, { recursive: true });
      metricsFile = new URL(`${FILE}.jsonl`, METRICS);
      const cpus = os.cpus();
      fs.writeFileSync(metricsFile, `${JSON.stringify({
        runner: true, file: FILE, startedAt: new Date().toISOString(), traceScreenshots: TRACE_SCREENSHOTS,
        platform: os.platform(), release: os.release(), arch: os.arch(), cores: cpus.length, cpuModel: cpus[0]?.model,
        totalMemMB: mb(os.totalmem()), node: process.version,
        runnerOs: process.env.RUNNER_OS || null, image: process.env.ImageOS || null, imageVersion: process.env.ImageVersion || null,
      })}\n`);
    }
    fs.appendFileSync(metricsFile, `${JSON.stringify(line)}\n`);
  } catch (err) {
    console.log(`[diagnostics] could not write measurements: ${err?.message || err}`);
  }
}
let testStart = null;

let current = []; // the contexts opened by the test now running (tests in a file run one at a time)

const limit = (ms, promise) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`diagnostics step timed out after ${ms} ms`)), ms)),
]);
const safe = (s) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';

// Called by the harness for each new context, before the page navigates.
export async function track(context, page, backend) {
  if (!DIAGNOSTICS) return;
  const diag = { console: [], requestFailed: [], badResponses: [], inFlight: new Map(), started: Date.now() };
  page.diag = diag;
  const t = () => Date.now() - diag.started;
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') diag.console.push({ at: t(), type: m.type(), text: m.text().slice(0, 500) }); });
  page.on('request', (r) => diag.inFlight.set(r, { at: t(), method: r.method(), url: r.url().slice(0, 300) }));
  page.on('requestfinished', (r) => diag.inFlight.delete(r));
  page.on('requestfailed', (r) => { diag.inFlight.delete(r); diag.requestFailed.push({ at: t(), method: r.method(), url: r.url().slice(0, 300), failure: r.failure()?.errorText }); });
  page.on('response', (r) => { if (r.status() >= 400) diag.badResponses.push({ at: t(), status: r.status(), url: r.url().slice(0, 300) }); });
  try {
    await context.tracing.start({ screenshots: TRACE_SCREENSHOTS, snapshots: true, sources: true });
  } catch (err) {
    diag.traceError = String(err?.message || err);
  }
  current.push({ context, page, backend });
}

// The page's state, from inside the page. Kept short and synchronous apart from one animation frame.
function probe() {
  const seen = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? 'visible' : 'present, not visible';
  };
  const t0 = performance.now();
  return new Promise((resolve) => {
    let frame = null;
    const done = () => resolve({
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      url: location.href,
      title: document.title,
      sincePageStartMs: Math.round(performance.now()),
      animationFrameMs: frame,
      elements: Object.fromEntries(['#login', '#authform', '#email', '#app', '#top', '#top .hud-row', '.a-nav', '#entry', '[aria-busy="true"]', '.pending'].map((s) => [s, seen(s)])),
      appDataset: { ...(document.getElementById('app')?.dataset || {}) },
      bodyClass: document.body?.className || '',
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      resources: performance.getEntriesByType('resource').map((e) => ({ name: e.name.replace(location.origin, ''), startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) })).slice(-60),
      navigation: performance.getEntriesByType('navigation').map((e) => ({ type: e.type, domContentLoadedMs: Math.round(e.domContentLoadedEventEnd), loadMs: Math.round(e.loadEventEnd) })),
    });
    requestAnimationFrame(() => { frame = Math.round(performance.now() - t0); done(); });
    setTimeout(() => { if (frame == null) { frame = 'no frame within 2000 ms'; done(); } }, 2000);
  });
}

async function capture(testName, { context, page, backend }, index, measured) {
  const dir = new URL(`${safe(FILE)}/${safe(testName)}${index ? `-${index + 1}` : ''}/`, ROOT);
  fs.mkdirSync(dir, { recursive: true });
  const diag = page.diag || {};
  const out = {
    test: testName, file: FILE, capturedAt: new Date().toISOString(), msSinceContextStart: Date.now() - (diag.started || Date.now()),
    url: null, evaluate: null, probe: null, pageErrors: page.errors || [], console: diag.console, requestFailed: diag.requestFailed,
    badResponses: diag.badResponses, inFlight: [...(diag.inFlight?.values() || [])],
    backend: { unexpected: backend?.unexpected || [], authCalls: (backend?.authCalls || []).slice(-20), recentCalls: (backend?.calls || []).slice(-30) },
    steps: {}, traceError: diag.traceError || null, traceScreenshots: TRACE_SCREENSHOTS,
    measuredToFailure: measured || null,
  };
  const step = async (name, ms, fn) => {
    const t0 = Date.now();
    try { const v = await limit(ms, fn()); out.steps[name] = { ok: true, ms: Date.now() - t0 }; return v; } catch (err) { out.steps[name] = { ok: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 300) }; return null; }
  };
  out.url = page.isClosed() ? '(page closed)' : page.url();
  // A trivial evaluate first: if even this doesn't answer, the page's renderer is stuck.
  out.evaluate = await step('evaluate', 5000, () => page.evaluate(() => 1 + 1));
  out.probe = await step('probe', 8000, () => page.evaluate(probe));
  await step('screenshot', 10000, () => page.screenshot({ path: fileURLToPath(new URL('screenshot.png', dir)), fullPage: false }));
  const dom = await step('dom', 5000, () => page.content());
  if (dom) fs.writeFileSync(new URL('dom.html', dir), dom);
  await step('trace', 30000, () => context.tracing.stop({ path: fileURLToPath(new URL('trace.zip', dir)) }));
  fs.writeFileSync(new URL('diag.json', dir), JSON.stringify(out, null, 2));
  console.log(`[diagnostics] ${testName}: saved to ${fileURLToPath(dir)}`);
}

if (DIAGNOSTICS) {
  beforeEach(() => { current = []; eld?.reset(); testStart = mark(); });
  afterEach(async (t) => {
    const mine = current;
    current = [];
    // Measured before any capture, so the capture's own work isn't counted.
    let measured = null;
    try { measured = testStart ? measure(testStart) : null; } catch { /* never let measuring fail a test */ }
    writeMetrics({ test: t.name, passed: t.passed, contexts: mine.length, ...(measured || {}) });
    if (t.passed) return;
    const open = mine.filter((c) => !c.page.isClosed());
    if (!open.length) { console.log(`[diagnostics] ${t.name}: failed with no open page to capture`); return; }
    for (const [i, c] of open.entries()) {
      try { await capture(t.name, c, i, measured); } catch (err) { console.log(`[diagnostics] ${t.name}: capture failed: ${err?.message || err}`); }
    }
  });
}
