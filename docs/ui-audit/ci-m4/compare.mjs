// M4: the TCP samples (M2) and harness counters (M1/M3) before the failure, against passing runs
// at the same point (aligned by the end of the test before the failing one in the same file).
// Run from the repository root:  node docs/ui-audit/ci-m4/compare.mjs
import fs from 'node:fs';
import path from 'node:path';
const S = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FILE = 'entrance.test';
const FAIL_TEST = 'the entrance has no axe violations at phone, landscape, tablet and desktop sizes, signing in and resuming';
const runs = [['44929807369', 'failed', 'FAIL'], ['44786839333', 'passed', 'pass'], ['44788881637', 'passed', 'pass'], ['44755355412', 'passed', 'pass']];
const read = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^﻿/, '')));
for (const [run, kind, label] of runs) {
  const d = path.join(S, `${run}-${kind}`);
  const tcp = read(path.join(d, 'tcp.jsonl'));
  const met = read(path.join(d, 'metrics', `${FILE}.jsonl`));
  const hdr = met[0];
  const tests = met.filter((x) => x.test);
  const i = tests.findIndex((t) => t.test === FAIL_TEST);
  const prev = tests[i - 1];
  const at = new Date(prev.endedAt); // the moment the failing test (or, in a passing run, the same test) starts
  const start = tcp.find((x) => x.kind === 'start');
  const samples = tcp.filter((x) => x.kind === 'sample');
  const sinceStart = (at - new Date(start.t)) / 60000;
  const window = samples.filter((s) => { const dt = (new Date(s.t) - at) / 1000; return dt >= -60 && dt <= 10; });
  const g = (s, k, st) => s?.[k]?.byState?.[st] ?? 0;
  const all = samples.map((s) => g(s, 'loopback', 'TimeWait'));
  // connections opened in the whole run before this point (all files' counters, by endedAt)
  let connsBefore = 0;
  for (const f of fs.readdirSync(path.join(d, 'metrics')).filter((f) => f.endsWith('.jsonl'))) {
    for (const x of read(path.join(d, 'metrics', f))) if (x.test && x.endedAt && new Date(x.endedAt) <= at) connsBefore += x.sockets?.opened || 0;
  }
  console.log(`\n${label} ${run} (image ${start.runner?.imageVersion}) dynamic ports ${start.dynamicPorts?.ipv4?.numberOfPorts}`);
  console.log(`  point: ${at.toISOString()} = ${sinceStart.toFixed(1)} min after the start snapshot; test ${i + 1} of ${tests.length} in ${FILE}; harness connections opened in the run before it: ${connsBefore}`);
  console.log(`  the test itself: passed=${tests[i]?.passed} opened=${tests[i]?.sockets?.opened} peak=${tests[i]?.sockets?.peakOpen}`);
  console.log(`  loopback TimeWait over the whole run: start ${g(start, 'loopback', 'TimeWait')}, max ${Math.max(...all)}`);
  console.log('  samples from 60 s before to 10 s after (s, loopback TimeWait/Established/CloseWait, machine TimeWait, machine total, sampleMs):');
  for (const s of window) console.log(`    ${((new Date(s.t) - at) / 1000).toFixed(0).padStart(4)}  ${g(s, 'loopback', 'TimeWait')}/${g(s, 'loopback', 'Established')}/${g(s, 'loopback', 'CloseWait')}  ${g(s, 'all', 'TimeWait')}  ${s.all?.total}  ${s.sampleMs}`);
}
