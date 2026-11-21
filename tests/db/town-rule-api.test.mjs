// Gameplay polish F2 (docs/gameplay-polish-scope.md, GP-F6): the real `game` edge function refuses
// a fight with a roaming monster on a town tile, and allows it one step out. LOCAL Supabase stack
// only: npx supabase start, then npm run test:db. It creates one local test account and hero, and
// removes them afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ZONES } from '../../public/js/data/zones.js';
import { TOWN_NO_MONSTERS } from '../../public/js/engine/world.js';

let API, ANON, SERVICE;
const RUN = `t${Date.now()}`;
// Hero names are letters only: the run's digits, spelled as letters.
const NAME = `Towny ${String(Date.now()).slice(-8).replace(/\d/g, (d) => 'abcdefghij'[d])}`;
let user = null;

const headers = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const service = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { ...headers(SERVICE, SERVICE), ...(opts.headers || {}) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function game(action, args = {}) {
  await pause(200); // the function refuses fast actions closer than 150 ms apart
  const res = await fetch(`${API}/functions/v1/game`, { method: 'POST', headers: headers(user.token), body: JSON.stringify({ action, args }) });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  API = s.API_URL; ANON = s.ANON_KEY; SERVICE = s.SERVICE_ROLE_KEY;
  assert.match(API, /^http:\/\/127\.0\.0\.1:\d+$/, 'local stack only');
  const email = `${RUN}-town@example.test`;
  const password = 'local-town-password-1';
  const made = await (await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  assert.ok(made.id, `create user: ${JSON.stringify(made).slice(0, 120)}`);
  const tok = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(ANON), body: JSON.stringify({ email, password }) })).json();
  user = { id: made.id, token: tok.access_token };
});

after(async () => {
  if (!SERVICE || !user) return;
  await service(`/rest/v1/characters?user_id=eq.${user.id}`, { method: 'DELETE' });
  await service(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
});

test('GP-F6 the game function refuses a town fight with a roaming monster, and allows it one step out', async () => {
  const created = await game('create', { name: NAME, race: 'human' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const c = created.body.char;
  const zone = ZONES[c.loc.zone];
  assert.deepEqual([c.loc.x, c.loc.y], [zone.town.x, zone.town.y], 'a new hero starts in town');

  const refused = await game('fight', { monsterId: zone.monsters[0].id });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, TOWN_NO_MONSTERS);
  const state = await game('state');
  assert.equal(state.body.char.battle ?? null, null, 'no fight was started');

  const moved = await game('move', { dir: 'n' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const fight = await game('fight', { monsterId: zone.monsters[0].id });
  assert.equal(fight.status, 200, JSON.stringify(fight.body));
  assert.equal(fight.body.char.battle.monsterId, zone.monsters[0].id);
});
