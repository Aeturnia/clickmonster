// What `tools/deploy-functions.mjs <slug>` would upload, and where, checked against a pinned git
// revision before any deploy (#102; docs/pending-rewards-report.md, section 3.4, B-04). READ-ONLY:
// it reads files and git, and never calls the Supabase API.
//
//   node tools/function-payload.mjs <slug> --rev <commit> [--root <checkout>]
//
// It selects files exactly as deploy-functions.mjs does (index.ts, then every .js file in
// public/js/engine and public/js/data, from the checkout it runs in), and for each one:
//   - prints its upload name, size and SHA-256;
//   - checks the bytes on disk equal `git show <rev>:<path>` exactly (line endings included);
// then checks that the revision has no other engine or data file, and prints the target project:
// SUPABASE_PROJECT_REF if set, else the production default. It exits 1 on any mismatch, or if the
// target isn't production.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PRODUCTION_REF = 'janiqspmhkbsyemkknpv'; // public/js/config.js; the default in deploy-functions.mjs
const args = process.argv.slice(2);
// --root: the checkout the deploy would run from (default: this one). The deploy script must be run
// from that same checkout, since it uploads the files next to itself.
const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = args[0];
const rev = args[args.indexOf('--rev') + 1];
if (!slug || slug.startsWith('-') || !args.includes('--rev') || !rev) {
  console.error('usage: node tools/function-payload.mjs <slug> --rev <commit> [--root <checkout>]');
  process.exit(2);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (a) => execFileSync('git', a, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
let ok = true;

const commit = git(['rev-parse', '--verify', `${rev}^{commit}`]).toString().trim();
const head = git(['rev-parse', 'HEAD']).toString().trim();
console.log(`checkout: ${root}`);
console.log(`HEAD:     ${head}`);
console.log(`pinned:   ${commit}${head === commit ? '' : '   (HEAD differs: only the bytes below decide)'}`);

const files = [['index.ts', `supabase/functions/${slug}/index.ts`]];
for (const dir of ['engine', 'data']) {
  for (const f of readdirSync(join(root, 'public/js', dir)).sort()) {
    if (f.endsWith('.js')) files.push([`js/${dir}/${f}`, `public/js/${dir}/${f}`]);
  }
}
console.log(`\n${files.length} files would be uploaded for "${slug}":`);
for (const [name, path] of files) {
  const disk = readFileSync(join(root, path));
  let pinned = null;
  try { pinned = git(['show', `${commit}:${path}`]); } catch { /* not in the revision */ }
  const same = pinned !== null && Buffer.compare(disk, pinned) === 0;
  if (!same) ok = false;
  const note = pinned === null ? 'NOT IN THE PINNED REVISION'
    : same ? 'matches' : `DIFFERS (pinned ${sha(pinned).slice(0, 12)}, ${pinned.includes(13) ? 'CRLF' : 'LF'} vs disk ${disk.includes(13) ? 'CRLF' : 'LF'})`;
  console.log(`  ${name.padEnd(28)} ${String(disk.length).padStart(7)}  ${sha(disk)}  ${note}`);
}

// A file in the pinned revision that the checkout lacks would also change the payload.
const listed = new Set(files.map(([, p]) => p));
for (const dir of ['engine', 'data']) {
  const inRev = git(['ls-tree', '--name-only', `${commit}:public/js/${dir}`]).toString().split('\n').filter((f) => f.endsWith('.js'));
  for (const f of inRev) {
    if (!listed.has(`public/js/${dir}/${f}`)) { ok = false; console.log(`  MISSING FROM THE CHECKOUT: public/js/${dir}/${f}`); }
  }
}

const target = process.env.SUPABASE_PROJECT_REF || PRODUCTION_REF;
const targetOk = target === PRODUCTION_REF;
console.log(`\ntarget project: ${target}${process.env.SUPABASE_PROJECT_REF ? ' (from SUPABASE_PROJECT_REF)' : ' (the default)'}${targetOk ? '' : '   NOT PRODUCTION'}`);
console.log(`payload: ${sha(Buffer.from(files.map(([n, p]) => `${n} ${sha(readFileSync(join(root, p)))}`).join('\n')))}  (SHA-256 of the name and hash list above)`);
if (!ok || !targetOk) {
  console.log('\nRESULT: STOP. The payload or the target is not the pinned one.');
  process.exit(1);
}
console.log('\nRESULT: every uploaded file is byte-identical to the pinned revision, and the target is production.');
