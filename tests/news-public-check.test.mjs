// tools/news-public-check.mjs refuses to run without both addresses (landing L-3 review, L3-01).
// Nothing here reaches any server: the tool runs with fetch replaced by a stub that records the
// first request and exits at once, so bad arguments must stop it before that point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../tools/news-public-check.mjs', import.meta.url));
const NO_NETWORK = `data:text/javascript,${encodeURIComponent("globalThis.fetch = () => { process.stdout.write('NETWORK\\n'); process.exit(9); };")}`;
const run = (...args) => {
  const r = spawnSync(process.execPath, ['--import', NO_NETWORK, TOOL, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
function refused(r, pattern, label) {
  assert.equal(r.code, 2, `${label}: stops with code 2 (got ${r.code}; ${r.err || r.out})`);
  assert.match(r.err, pattern, label);
  assert.doesNotMatch(r.out, /NETWORK/, `${label}: no request was made`);
  assert.doesNotMatch(r.out, /PASS|All checks passed/, `${label}: nothing reported as passing`);
}

test('both addresses are required; the hidden-row check is never skipped', () => {
  refused(run(), /--published/, 'no arguments');
  refused(run('--published', 'spring-festival'), /--hidden.*required.*never skipped/, 'no --hidden');
  refused(run('--hidden', 'a-draft'), /--published/, 'no --published');
  refused(run('--published', '--hidden', 'a-draft'), /--published/, '--published with no value');
  refused(run('--published', 'spring-festival', '--hidden'), /--hidden/, '--hidden with no value');
});

test('the two addresses must be different, well-formed news addresses', () => {
  refused(run('--published', 'spring-festival', '--hidden', 'spring-festival'), /two different entries/, 'identical');
  refused(run('--published', 'Spring Festival', '--hidden', 'a-draft'), /--published "Spring Festival" is not a news address/, 'malformed published');
  refused(run('--published', 'spring-festival', '--hidden', 'x'), /--hidden "x" is not a news address/, 'too short hidden');
  refused(run('--published', 'spring-festival', '--hidden', 'a-draft&select=*'), /is not a news address/, 'query injection in hidden');
});

test('with two valid addresses it goes on to its first request (stubbed here)', () => {
  const r = run('--published', 'spring-festival', '--hidden', 'a-draft');
  assert.equal(r.code, 9, `reached the network stage (got ${r.code}; ${r.err})`);
  assert.match(r.out, /NETWORK/);
});
