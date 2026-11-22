// Read a Chromium NetLog (docs/ci-windows-reliability-plan.md, section 9) and follow requests to
// their sockets. Read-only; prints to stdout.
//
//   node tools/netlog-trace.mjs <file.netlog.json> --summary
//       counts: requests, connect attempts, reused sockets, and every event carrying an error
//   node tools/netlog-trace.mjs <file.netlog.json> --errors
//       every event with a net_error or os_error, with its time (UTC), source and parameters.
//       ERR_NO_BUFFER_SPACE (-176) and Winsock 10055 are marked.
//   node tools/netlog-trace.mjs <file.netlog.json> --url <part of a URL> [--near <ISO time>] [--all]
//       the URL requests whose URL contains it (the one nearest the time, or --all), and for each,
//       every source linked to it through source dependencies (stream jobs, connect jobs, sockets),
//       with their events in time order: which socket served the request, new or reused, and the
//       first failed operation (connect, read or write) with its net_error and os_error.
//
// An incomplete NetLog (Chromium didn't close it) is read as far as it parses, and said so. A missing
// event in such a log proves nothing.
import fs from 'node:fs';

const [file, ...args] = process.argv.slice(2);
if (!file || !args.length) { console.log('usage: node tools/netlog-trace.mjs <file.netlog.json> --summary | --errors | --url <part> [--near <ISO time>] [--all]'); process.exit(2); }
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

// ---------------------------------------------------------------- loading (complete or not)
let text = fs.readFileSync(file, 'utf8');
let complete = true;
let log;
try { log = JSON.parse(text); } catch {
  complete = false;
  // Chromium writes {"constants": {...}, "events": [ ... and closes "]}" on shutdown. Close it here,
  // in memory only, after the last complete event.
  const cut = text.lastIndexOf('},');
  log = JSON.parse(`${text.slice(0, cut + 1)}]}`);
}
const C = log.constants;
const name = (map, v) => Object.keys(map).find((k) => map[k] === v) ?? String(v);
const EV = Object.fromEntries(Object.entries(C.logEventTypes).map(([k, v]) => [v, k]));
const SRC = Object.fromEntries(Object.entries(C.logSourceType).map(([k, v]) => [v, k]));
const PH = Object.fromEntries(Object.entries(C.logEventPhase).map(([k, v]) => [v, k.replace('PHASE_', '')]));
const NETERR = Object.fromEntries(Object.entries(C.netError).map(([k, v]) => [v, k]));
const utc = (t) => new Date(Number(C.timeTickOffset) + Number(t)).toISOString();
const events = log.events;

const sources = new Map(); // id -> { type, events: [] }
const links = new Map(); // id -> Set(id), both directions
const link = (a, b) => { if (a === b) return; for (const [x, y] of [[a, b], [b, a]]) { if (!links.has(x)) links.set(x, new Set()); links.get(x).add(y); } };
for (const e of events) {
  const id = e.source.id;
  if (!sources.has(id)) sources.set(id, { type: SRC[e.source.type] ?? e.source.type, events: [] });
  sources.get(id).events.push(e);
  for (const [k, v] of Object.entries(e.params || {})) if (/source_dependency$/.test(k) && v && typeof v.id === 'number') link(id, v.id);
}

const KEY_PARAMS = ['url', 'method', 'address', 'source_address', 'net_error', 'os_error', 'idle_ms', 'reused', 'is_preconnect', 'group_id', 'group_name', 'host_port_pair', 'byte_count', 'status_code'];
function describe(e) {
  const p = e.params || {};
  const bits = [];
  for (const k of KEY_PARAMS) if (p[k] !== undefined) bits.push(k === 'net_error' ? `net_error=${p[k]} (${NETERR[p[k]] ?? '?'})` : `${k}=${JSON.stringify(p[k])}`);
  const mark = p.net_error === -176 || p.os_error === 10055 ? '   <-- ERR_NO_BUFFER_SPACE / WSAENOBUFS' : '';
  return `${utc(e.time)}  ${(PH[e.phase] ?? '').padEnd(5)} ${EV[e.type] ?? e.type}${bits.length ? `  ${bits.join(' ')}` : ''}${mark}`;
}
const hasError = (e) => { const p = e.params || {}; return (p.net_error !== undefined && p.net_error !== 0) || (p.os_error !== undefined && p.os_error !== 0); };
// Cache events report errors in every request here, because Playwright's routing turns the HTTP cache
// off (HTTP_CACHE_DOOM_ENTRY ERR_FAILED and the like). Listed, but never taken as a request's failure.
const isCache = (e) => /^HTTP_CACHE_/.test(EV[e.type] || '');

console.log(`${file}\n${complete ? 'complete NetLog' : 'INCOMPLETE NetLog (not closed by Chromium): read up to its last complete event; missing events prove nothing'}; ${events.length} events, ${sources.size} sources; capture mode ${name(C.logCaptureMode || {}, C.logCaptureMode) || '(default)'}`);

if (args.includes('--summary') || args.includes('--errors')) {
  const count = (t) => events.filter((e) => EV[e.type] === t).length;
  const urlReqs = [...sources.values()].filter((s) => s.type === 'URL_REQUEST').length;
  console.log(`URL requests: ${urlReqs}; TCP_CONNECT_ATTEMPT events: ${count('TCP_CONNECT_ATTEMPT')}; TCP_CONNECT: ${count('TCP_CONNECT')}; reused sockets: ${count('SOCKET_POOL_REUSED_AN_EXISTING_SOCKET')}`);
  const errs = events.filter(hasError);
  const groups = {};
  for (const e of errs) { const k = `${EV[e.type]} net_error=${e.params.net_error ?? '-'} os_error=${e.params.os_error ?? '-'}`; groups[k] = (groups[k] || 0) + 1; }
  console.log(`events with an error: ${errs.length}`);
  for (const [k, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}${/-176|10055/.test(k) ? '   <--' : ''}`);
  if (args.includes('--errors')) for (const e of errs) console.log(`  source ${e.source.id} (${SRC[e.source.type]})  ${describe(e)}`);
}

if (opt('--url')) {
  const part = opt('--url');
  const near = opt('--near') ? Date.parse(opt('--near')) : null;
  let reqs = [...sources.entries()].filter(([, s]) => s.type === 'URL_REQUEST' && s.events.some((e) => (e.params?.url || '').includes(part)));
  if (!reqs.length) { console.log(`no URL request containing ${JSON.stringify(part)}`); process.exit(1); }
  const startOf = ([, s]) => Number(C.timeTickOffset) + Number(s.events[0].time);
  if (near !== null && !args.includes('--all')) reqs = [reqs.sort((a, b) => Math.abs(startOf(a) - near) - Math.abs(startOf(b) - near))[0]];
  else if (!args.includes('--all')) reqs = reqs.slice(-1);
  for (const [id] of reqs) {
    // Every source within three links of the request: its stream job, connect job and socket.
    const seen = new Map([[id, 0]]);
    const queue = [id];
    while (queue.length) { const s = queue.shift(); const d = seen.get(s); if (d >= 3) continue; for (const n of links.get(s) || []) if (!seen.has(n)) { seen.set(n, d + 1); queue.push(n); } }
    console.log(`\n=== URL request, source ${id}: linked sources ${seen.size}`);
    for (const [sid, depth] of [...seen].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const s = sources.get(sid);
      if (!s) continue;
      console.log(`\n-- source ${sid} ${s.type} (link distance ${depth})`);
      for (const e of s.events) console.log(`   ${describe(e)}`);
    }
    const all = [...seen.keys()].flatMap((sid) => sources.get(sid)?.events || []).sort((a, b) => Number(a.time) - Number(b.time));
    const first = all.find((e) => hasError(e) && !isCache(e));
    console.log(`\nfirst event with an error in this chain (cache events aside): ${first ? `source ${first.source.id} (${SRC[first.source.type]}) ${describe(first)}` : 'none'}`);
  }
}
