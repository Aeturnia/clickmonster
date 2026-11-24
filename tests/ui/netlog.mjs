// Chromium NetLog capture for the browser suite (docs/ci-windows-reliability-plan.md, section 9:
// the ERR_NO_BUFFER_SPACE investigation's NetLog experiment). Observation only.
//
// Off unless UI_NETLOG_DIR is set to an absolute directory (the CI browser job sets it). When off,
// the harness launches Chromium exactly as before: chromium.launch() with no options.
// When on, each browser launch (one per test file) gets:
//   - one added argument, --log-net-log=<UI_NETLOG_DIR>/<file>-<node pid>-<time>-<n>.netlog.json,
//     in Chromium's default capture mode (no --net-log-capture-mode): it strips cookies and
//     credentials and records no request or response bodies;
//   - Playwright's own browser log (`DEBUG=pw:browser`, added to DEBUG here, before Playwright loads:
//     the harness imports this module first). It prints the resolved launch command line, with every
//     switch, and the browser's PID to stderr, where they stay in the suite's output. This module
//     also copies those two lines into the metadata as they pass. Logging only;
//   - a <same name>.meta.json beside it, written at launch and updated at close: the test file, the
//     harness server's address and port, the times, the PID, the command line, the Playwright,
//     Chromium and Node versions, the runner image, and whether the NetLog was flushed (Chromium
//     closes the JSON on a normal shutdown) and parses as JSON.
// Nothing else changes: no other switch, no lifecycle, connection or timing change. A NetLog is
// never truncated; one Chromium didn't close normally is kept as it is and marked so.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = process.env.UI_NETLOG_DIR || '';
// Playwright's browser log on (before Playwright is loaded), and its launch lines noted as they pass
// through stderr, unchanged. Only when the NetLog is on.
let current = null;
if (DIR) {
  const prev = process.env.DEBUG || '';
  if (!prev.split(',').includes('pw:browser')) process.env.DEBUG = prev ? `${prev},pw:browser` : 'pw:browser';
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    try {
      const s = String(chunk);
      const launching = s.match(/<launching> (.*)/);
      if (launching && current) current.launchCommand = launching[1].trim();
      const pid = s.match(/<launched> pid=(\d+)/);
      if (pid && current) current.browserPid = Number(pid[1]);
    } catch { /* never interfere with the output */ }
    return write(chunk, ...rest);
  };
}
const FILE = path.basename(process.argv[1] || 'unknown', '.mjs');
const PLAYWRIGHT = createRequire(import.meta.url)('playwright/package.json').version;
let launches = 0;

export const NETLOG = Boolean(DIR);

// For one launch: the launch options to use, and hooks for after launch and after close. null when off.
export function netlogLaunch(server) {
  if (!DIR) return null;
  if (!path.isAbsolute(DIR)) throw new Error(`UI_NETLOG_DIR must be an absolute path: ${DIR}`);
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(DIR, `${FILE}-${process.pid}-${stamp}-${++launches}`);
  const netlogFile = `${base}.netlog.json`;
  const metaFile = `${base}.meta.json`;
  const addr = server.address();
  const meta = {
    testFile: FILE, nodePid: process.pid, launchInProcess: launches,
    netlogFile: path.basename(netlogFile), captureMode: 'default (no --net-log-capture-mode)',
    server: { address: addr?.address ?? null, port: addr?.port ?? null },
    launchRequestedAt: new Date().toISOString(), launchedAt: null, closeRequestedAt: null, closedAt: null,
    browserPid: null, launchCommand: null, chromiumVersion: null, playwrightVersion: PLAYWRIGHT, node: process.version,
    runner: { os: process.env.RUNNER_OS || null, image: process.env.ImageOS || null, imageVersion: process.env.ImageVersion || null },
    disconnectedUnexpectedly: false, disconnectedAt: null,
    flushed: null, validJson: null, sizeBytes: null, events: null,
  };
  const write = () => { try { fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`); } catch (err) { console.log(`[netlog] could not write ${metaFile}: ${err?.message || err}`); } };
  write();
  let closing = false;
  current = meta; // the launch lines on stderr belong to this launch
  return {
    options: { args: [`--log-net-log=${netlogFile}`] },
    launched(browser) {
      meta.launchedAt = new Date().toISOString();
      meta.chromiumVersion = browser.version();
      browser.on('disconnected', () => {
        if (closing) return;
        meta.disconnectedUnexpectedly = true;
        meta.disconnectedAt = new Date().toISOString();
        write();
      });
      write();
    },
    beforeClose() { closing = true; meta.closeRequestedAt = new Date().toISOString(); write(); },
    // After browser.close(): Chromium has written the NetLog's end. Checked, never changed.
    afterClose() {
      meta.closedAt = new Date().toISOString();
      try {
        const text = fs.readFileSync(netlogFile, 'utf8');
        meta.sizeBytes = Buffer.byteLength(text);
        meta.flushed = /\]\s*\}\s*$/.test(text);
        try { const j = JSON.parse(text); meta.validJson = true; meta.events = Array.isArray(j.events) ? j.events.length : null; } catch { meta.validJson = false; }
      } catch (err) {
        meta.flushed = false;
        meta.error = `could not read the NetLog: ${err?.message || err}`;
      }
      write();
    },
  };
}
