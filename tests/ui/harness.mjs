// UI test harness: serves public/ locally and replaces Supabase with a deterministic fake
// built on the real game engine. Nothing reaches the live backend:
//   - every request is routed; Supabase hosts are answered by the fake
//   - the Realtime websocket is answered by a fake socket
//   - any other host fails the test. supabase-js is served from public/vendor/ like the rest of
//     the site (landing L-1). Only when measuring another checkout (UI_PUBLIC_DIR, which may be
//     older code that loads it from the CDN) is the pinned CDN module allowed, cached on disk
//     after the first download so later runs are offline.
import http from 'node:http';
import { track } from './diagnostics.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { SUPABASE_URL } from '../../public/js/config.js';
import { DEFAULT_ZONES, loadZones } from '../../public/js/data/zones.js';
import { createCharacter, ensureCharacter, applyRegen, spendLevel, addItem, maxHp } from '../../public/js/engine/character.js';
import { move, walkTo, usePortal, heal } from '../../public/js/engine/world.js';
import { startBattle, battleAction } from '../../public/js/engine/battle.js';
import { buy, buyAndEquip, sell, equip, unequip, socketGem, extractGem, deposit, withdraw } from '../../public/js/engine/inventory.js';
import { generateQuests, accept, hourBucket } from '../../public/js/engine/quests.js';
import { canSend } from '../../public/js/engine/chat.js';
import { duel } from '../../public/js/engine/pvp.js';
import { startHuntBattle } from '../../public/js/engine/hunt.js';
import { checkNews, canDeleteNews } from '../../public/js/data/news.js';
import { newsResponse } from '../../netlify/edge-functions/news.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.resolve(ROOT, process.env.UI_PUBLIC_DIR || 'public');
const CACHE = path.join(ROOT, 'tests/ui/.cache');
const SUPA = new URL(SUPABASE_URL);
const ALLOWED_CDN = process.env.UI_PUBLIC_DIR ? /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\// : null;

// ---------------------------------------------------------------- static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
export function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------- deterministic random
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function withRng(rng, fn) {
  const orig = Math.random;
  Math.random = rng;
  try { return fn(); } finally { Math.random = orig; }
}

// ---------------------------------------------------------------- fixtures
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
export const ACCOUNTS = {
  player: { email: 'player@example.test', password: 'pw-player', id: '00000000-0000-4000-8000-000000000001' },
  admin: { email: 'admin@example.test', password: 'pw-admin', id: '00000000-0000-4000-8000-000000000002', role: 'admin' },
  fresh: { email: 'fresh@example.test', password: 'pw-fresh', id: '00000000-0000-4000-8000-000000000003' },
  mod: { email: 'mod@example.test', password: 'pw-mod', id: '00000000-0000-4000-8000-000000000004', role: 'moderator' },
};

export function makeHero({ name = 'Bartholomew Thorne', race = 'halfling', level = 12, gold = 123456789, bank = 98765432, zone = 'bramblebrook', x = 5, y = 5, pendingLevels = 0 } = {}) {
  const c = createCharacter(name, race, NOW);
  c.level = level;
  c.gold = gold;
  c.bank = bank;
  c.pendingLevels = pendingLevels;
  for (let i = 1; i < level; i++) { c.stats.dex += 4; c.stats.str += 3; c.stats.vit += 3; }
  c.loc = { zone, x, y };
  c.gems = { 'ruby:2': 3, 'citrine:3': 1 };
  addItem(c, 'helm_1');
  addItem(c, 'boots_2', 'relic');
  c.hp = maxHp(c);
  c.lastTick = Date.now();
  return c;
}

// sid numbers every token issued, so a session can end on the server (FakeBackend.endSessions())
// while one issued after it keeps working, as GoTrue's sessions do.
let SID = 0;
function fakeJwt(sub, email, expiresIn = 3600) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp, sid: ++SID })}.signature`;
}
const claims = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()); } catch { return null; } };

// A session as supabase-js stores it (localStorage 'clickmonster.auth') and as the token endpoint
// returns it. expiresIn below zero gives an expired one, for session-restore tests.
export function savedSession(acct, expiresIn = 3600) {
  return {
    access_token: fakeJwt(acct.id, acct.email, expiresIn), token_type: 'bearer', expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn, refresh_token: `refresh-${acct.id}`,
    user: { id: acct.id, email: acct.email, aud: 'authenticated', role: 'authenticated' },
  };
}

// The address a password-reset email's link returns to (implicit flow): the recovery session in
// the fragment, as Supabase sends it (docs/password-recovery-scope.md). With `error`, the fragment of
// an expired or used link instead.
export function recoveryUrl(base, acct, { error = false } = {}) {
  if (error) return `${base}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
  const s = savedSession(acct);
  return `${base}/#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=recovery`;
}

// Turns on "Forgot your password?" for this page only, as releasing it will (entry.js
// RECOVERY_REQUESTS). Test-only: it rewrites the served entry.js, and fails if the switch is missing.
export async function recoveryRequestsOn(page) {
  await page.route('**/js/entry.js', async (route) => {
    const res = await route.fetch();
    const text = await res.text();
    const on = text.replace('const RECOVERY_REQUESTS = false;', 'const RECOVERY_REQUESTS = true;');
    if (on === text) throw new Error('entry.js has no RECOVERY_REQUESTS switch to turn on');
    await route.fulfill({ response: res, body: on });
  });
}

// ---------------------------------------------------------------- fake backend
export class FakeBackend {
  // worldEvents: timed events in world_config (e.g. { id, name, until, xp: 2 }); activeHunts:
  // world-boss hunts players can see ({ id, zone, name, level, hp, max_hp, ends_at }).
  // news: rows of the public news table (landing L-3), as the admin function returns them.
  constructor({ hero = makeHero(), players = [], chat = [], events = [], seed = 7, zones = [], quests = null, reports = null, worldEvents = [], activeHunts = [], news = [] } = {}) {
    this.news = structuredClone(news);
    this.newsSeq = Math.max(0, ...this.news.map((n) => n.id)) + 1;
    this.worldEvents = worldEvents;
    this.activeHunts = activeHunts;
    this.reportsSeed = reports; // admin chat reports: [{ message_id, reporter_name, reason }]
    this.zoneDefs = [...DEFAULT_ZONES, ...zones];
    loadZones(this.zoneDefs);
    this.rng = seeded(seed);
    this.heroes = { [ACCOUNTS.player.id]: hero };
    this.charIds = { [ACCOUNTS.player.id]: 'char-player' };
    this.players = players; // others in the world: { id, name, race, level, zone, x, y, updated_at }
    this.chat = chat;
    this.events = events;
    this.nextChatId = 1000;
    this.unexpected = [];
    this.calls = [];
    this.failures = []; // { action, status, message, once }
    this.holds = {}; // action -> promise: requests for it wait until released
    this.offline = false;
    this.sockets = [];
    this.revoked = new Set(); // refresh tokens the auth server refuses
    // Sign-out and session recovery (docs/sign-out-scope.md):
    this.endedBefore = {}; // account id -> sessions up to this sid have ended on the server (endSessions())
    this.staleTokens = 0; // the next n game calls answer 401, as for an expired access token that still renews
    this.logoutFail = null; // the next sign-out (local or global): a status, 'drop' or 'hang'
    this.authHold = null; // a promise the token endpoint waits for (a slow renewal)
    this.authCalls = []; // grant types requested from /auth/v1/token, in order
    // Password recovery: reset requests ({ email, redirectTo }), changed passwords by user id, password
    // updates and sign-out scopes, in order. recoverStatus = 429 refuses a reset request;
    // failUserUpdate = <status> refuses the update; failOthersLogout = n fails the next n "sign out
    // the other devices".
    this.recoverRequests = [];
    this.passwords = {};
    this.passwordUpdates = [];
    this.logouts = [];
    this.recoverStatus = 200;
    this.failUserUpdate = 0;
    this.failOthersLogout = 0;
    // The real board depends on the hour; tests that need a quest pass a fixed one (fixedQuest()).
    this.quests = quests || generateQuests(hourBucket()).map((q, i) => ({ ...q, id: `quest-${i}`, completedBy: null }));
  }

  failNext(action, status, message) { this.failures.push({ action, status, message }); } // status 'drop': the connection is dropped

  // The account's sessions so far end on the server, as when another device signs out everywhere:
  // their tokens are refused (game 401; /user and /logout 403 session_not_found, which supabase-js
  // reports as AuthSessionMissingError) and their renewal is refused. A later sign-in works.
  endSessions(acct) { this.endedBefore[acct.id] = SID; this.revoked.add(`refresh-${acct.id}`); }
  ended(token) { const c = claims(token); return !!c && (c.sid || 0) <= (this.endedBefore[c.sub] ?? -1); }
  // Hold the token endpoint (sign-in and renewal) until the returned function is called.
  holdAuth() { let release; this.authHold = new Promise((r) => { release = r; }); return () => { this.authHold = null; release(); }; }

  // Keep requests for an action waiting (a slow server) until the returned function is called.
  hold(action) {
    let release;
    this.holds[action] = new Promise((r) => { release = r; });
    return () => { delete this.holds[action]; release(); };
  }

  userFor(token) {
    try {
      const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
      if (payload.exp && payload.exp * 1000 < Date.now()) return null; // expired, as the real server refuses it
      if (this.ended(token)) return null; // its session has ended on the server
      return Object.values(ACCOUNTS).find((a) => a.id === payload.sub) || null;
    } catch { return null; }
  }

  // Game edge function, using the real engine.
  game(user, action, args) {
    loadZones(this.zoneDefs); // other backends in the same process may have loaded different zones
    const now = Date.now();
    const id = user.id;
    if (action === 'state') {
      const c = this.heroes[id];
      if (!c) return { char: null };
      ensureCharacter(c);
      applyRegen(c, now);
      return { char: c, sanctions: { banned: null, jailed: null, muted: null, reason: null } };
    }
    if (action === 'create') {
      const c = createCharacter(args.name, args.race, now);
      this.heroes[id] = c;
      this.charIds[id] = `char-${id.slice(-4)}`;
      return { char: c };
    }
    if (action === 'quests') return { quests: this.quests };
    if (action === 'delete') { delete this.heroes[id]; return { char: null }; }
    const c = this.heroes[id];
    if (!c) throw Object.assign(new Error('Create a hero first.'), { status: 404 });
    const rng = this.rng;
    const actions = {
      move: () => move(c, args.dir), walk: () => walkTo(c, args.x, args.y),
      fight: () => startBattle(c, args.monsterId, () => 0.99),
      melee: () => battleAction(c, 'melee', rng), cast: () => battleAction(c, 'cast', rng), flee: () => battleAction(c, 'flee', rng),
      again: () => { const m = c.battle.monsterId; c.battle = null; startBattle(c, m, () => 0.99); },
      done: () => { if (c.battle?.over) c.battle = null; }, portal: () => usePortal(c), heal: () => heal(c),
      buy: () => buy(c, args.itemId), buyequip: () => buyAndEquip(c, args.itemId), sell: () => sell(c, Number(args.uid)),
      equip: () => equip(c, Number(args.uid)), unequip: () => unequip(c, args.slot),
      socket: () => socketGem(c, Number(args.uid), args.gem), extract: () => extractGem(c, Number(args.uid), Number(args.index)),
      level: () => spendLevel(c, args.stat), deposit: () => deposit(c, args.amount), withdraw: () => withdraw(c, args.amount),
      dismiss: () => { c.notices = []; }, abandon: () => { c.quest = null; },
      // A duel against another player, built as a full hero from their public row.
      attack: () => {
        const p = this.players.find((x) => x.id === args.targetId);
        if (!p) throw Object.assign(new Error('They are no longer here.'), { status: 400 });
        const t = createCharacter(p.name, p.race, now);
        t.level = p.level; t.loc = { zone: p.zone, x: p.x, y: p.y }; t.gold = p.gold ?? 500;
        if (p.stats) Object.assign(t.stats, p.stats); // a test can make the opponent stronger
        t.hp = maxHp(t);
        duel(c, t, rng);
      },
      // Joining a world-boss hunt (the game function's startHuntBattle; the shared damage is not modelled).
      hunt: () => {
        const h = this.activeHunts.find((x) => x.id === args.huntId);
        if (!h) throw Object.assign(new Error('That hunt is over.'), { status: 400 });
        startHuntBattle(c, h);
      },
      accept: () => accept(c, this.quests.find((q) => q.id === args.questId), now),
      chat: () => {
        const check = canSend(c.level, args.text, null, now);
        if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });
        const msg = {
          id: this.nextChatId++, channel: args.channel, zone: args.channel === 'zone' ? c.loc.zone : null,
          sender_id: this.charIds[id], sender_name: c.name, sender_role: user.role || null,
          recipient_id: args.channel === 'whisper' ? 'char-other' : null, recipient_name: args.channel === 'whisper' ? args.to : null,
          text: check.text, deleted_at: null, created_at: new Date().toISOString(),
        };
        this.chat.push(msg);
        this.broadcast('chat_messages', 'INSERT', msg);
        return { ok: true, id: msg.id };
      },
      report: () => ({ ok: true }), ignore: () => ({ ok: true, name: args.name }), unignore: () => ({ ok: true, name: args.name }),
      modDelete: () => ({ ok: true }),
    };
    const fn = actions[action];
    if (!fn) throw Object.assign(new Error('Unknown action.'), { status: 400 });
    const extra = withRng(rng, fn);
    if (extra && extra.ok) return extra;
    return { char: c, sanctions: { banned: null, jailed: null, muted: null, reason: null } };
  }

  // ------------------------------------------------------------ admin console (stateful)
  // Mirrors the admin edge function's permission rules: admin-only actions, and moderators
  // limited to sanctions of at most 7 days. Data is deterministic.
  adminData() {
    if (this._admin) return this._admin;
    const c = this.heroes[ACCOUNTS.player.id];
    const day = 86400000;
    const iso = (t) => new Date(t).toISOString();
    const NAMES = [['Musa', 'human', 9, 'bramblebrook'], ['Ilsabet Varn', 'elf', 31, 'duskhollow'], ['Grubnak', 'orc', 18, 'bloodrock'],
      ['Tamsin Reed', 'halfling', 4, 'bramblebrook'], ['Oswin of the Long Marsh', 'human', 27, 'marsh'], ['Kettle', 'gnome', 12, 'cogwhistle'],
      ['Brannoc', 'dwarf', 45, 'catacombs'], ['Yselde', 'elf', 2, 'silverleaf'], ['Hollis Crane', 'human', 22, 'ashford'], ['Mirabel Thistlewood-Ashcombe', 'halfling', 15, 'marsh']];
    const players = [
      { id: 'char-player', name: c.name, race: c.race, level: c.level, zone: c.loc.zone, x: c.loc.x, y: c.loc.y, strikes: 1, sanction_reason: 'Spamming the global channel', muted_until: null },
      ...NAMES.map(([name, race, level, zone], i) => ({ id: i === 0 ? 'char-other' : `char-${i}`, name, race, level, zone, x: 1 + (i % 5), y: 1 + (i % 4), strikes: i % 3 === 0 ? 2 : 0 })),
    ].map((p, i) => ({ banned_until: null, jailed_until: null, muted_until: null, sanction_reason: null, ...p, updated_at: iso(NOW - i * 3600000), created_at: iso(NOW - 30 * day + i * day) }));
    players.find((p) => p.name === 'Grubnak').banned_until = iso(Date.now() + 3 * day);
    players.find((p) => p.name === 'Kettle').muted_until = iso(Date.now() + day);
    const others = this.chat.filter((m) => m.sender_id && m.sender_id !== 'char-player');
    const reports = (this.reportsSeed || others.slice(0, 2).map((m, i) => ({ message_id: m.id, reporter_name: c.name, reason: i ? '' : 'Rude to new players' })))
      .map((r, i) => ({ id: 900 + i, created_at: iso(NOW - (i + 1) * 600000), resolved_at: null, ...r }));
    this._admin = {
      players, reports,
      history: { 'char-player': [{ kind: 'warn', reason: 'Spamming the global channel', until: null, by_name: 'mod@example.test', created_at: iso(NOW - 2 * day) }] },
      log: [
        { action: 'sanction:warn', target_id: 'char-player', target_name: c.name, details: { reason: 'Spamming the global channel' }, actor_name: 'mod@example.test', created_at: iso(NOW - 2 * day) },
        { action: 'zone:save', target_id: null, target_name: 'Bramblebrook Meadows', details: { id: 'bramblebrook' }, actor_name: 'admin@example.test', created_at: iso(NOW - 3 * day) },
      ],
      hunts: [
        { id: 'hunt-1', name: 'The Ashen Colossus', zone: 'ashford', level: 20, hp: 41000, max_hp: 60000, status: 'active', ends_at: iso(Date.now() + 5 * 3600000), hunters: 7, killed_by_name: null, top: [{ name: 'Brannoc', damage: 9100 }, { name: 'Musa', damage: 4200 }] },
        { id: 'hunt-0', name: 'Old Mother Bramble', zone: 'bramblebrook', level: 12, hp: 0, max_hp: 20000, status: 'defeated', ends_at: iso(NOW - day), hunters: 12, killed_by_name: 'Hollis Crane', top: [{ name: 'Hollis Crane', damage: 6000 }] },
      ],
      world: { base: { xp: 1, gold: 1, drop: 1, elite: 1, mastery: 1 }, events: [{ id: 'ev-1', name: 'Harvest Moon', xp: 1.5, gold: 2, until: iso(Date.now() + 2 * day) }] },
      economy: Array.from({ length: 6 }, (_, i) => iso(NOW - i * day).slice(0, 10)).flatMap((d, i) => [
        { day: d, source: 'monsters', amount: 52000 + i * 1300 }, { day: d, source: 'quests', amount: 9000 },
        { day: d, source: 'shop', amount: -21000 - i * 400 }, { day: d, source: 'healer', amount: -3100 }, { day: d, source: 'death', amount: -12000 }]),
      staff: [
        { user_id: ACCOUNTS.admin.id, role: 'admin', email: ACCOUNTS.admin.email, created_at: iso(NOW - 60 * day) },
        { user_id: ACCOUNTS.mod.id, role: 'moderator', email: ACCOUNTS.mod.email, created_at: iso(NOW - 20 * day) },
      ],
    };
    if (!this.events.length) {
      this.events = [{ id: 1, kind: 'announce', text: 'Welcome to the test realm!', created_at: iso(NOW - day) }, { id: 2, kind: 'pvp', text: 'Ilsabet Varn defeated Grubnak in a duel.', created_at: iso(NOW - 3600000) }];
    }
    return this._admin;
  }

  admin(user, action, a) {
    if (!user.role) throw Object.assign(new Error('This account is not staff.'), { status: 403 });
    const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
    const requireAdmin = () => { if (user.role !== 'admin') throw err('Only admins can do that.', 403); };
    const c = this.heroes[ACCOUNTS.player.id];
    const D = this.adminData();
    const find = (id) => D.players.find((p) => p.id === id);
    const log = (entry) => D.log.unshift({ actor_name: user.email, created_at: new Date().toISOString(), target_id: null, target_name: null, details: null, ...entry });
    const heroOf = (p) => {
      if (p.id === 'char-player') return c;
      const h = createCharacter(p.name, p.race, NOW);
      h.level = p.level; h.loc = { zone: p.zone, x: p.x, y: p.y };
      return h;
    };
    const zoneRows = () => (D.zoneRows ||= DEFAULT_ZONES.map((z, i) => ({ id: z.id, data: z, sort: i, players: z.id === 'bramblebrook' ? 1 : 0, builtin: true })));
    const withMessages = (r) => ({ ...r, message: this.chat.find((m) => m.id === r.message_id) || null });
    switch (action) {
      case 'whoami': return { role: user.role, email: user.email };
      case 'stats': {
        const pub = find('char-player');
        return { players: D.players.length, online15m: 4, active24h: 9, active7d: D.players.length, signups24h: 1, signups7d: 3, banned: D.players.filter((p) => p.banned_until && new Date(p.banned_until) > Date.now()).length, goldCarried: 123456789, goldBanked: 98765432, byRace: { halfling: 3, human: 4, elf: 2, orc: 1, gnome: 1, dwarf: 1 }, byZone: { bramblebrook: 3, marsh: 2, ashford: 1, duskhollow: 1 }, levels: { '1-9': 4, '10-19': 3, '20-29': 2, '30-49': 2, '50+': 0 }, events24h: this.events.length, top: [...D.players].sort((x, y) => y.level - x.level).slice(0, 5).map((p) => (p.id === 'char-player' ? pub : p)) };
      }
      case 'search': {
        const q = String(a.q || '').trim().toLowerCase();
        return { players: D.players.filter((p) => !q || p.name.toLowerCase().includes(q)) };
      }
      case 'player': {
        const p = find(String(a.id));
        if (!p) throw err('No such hero.', 404);
        return { player: { ...p, data: heroOf(p) }, history: D.history[p.id] || [], actions: D.log.filter((l) => l.target_id === p.id), email: p.id === 'char-player' ? ACCOUNTS.player.email : null };
      }
      case 'update': requireAdmin(); log({ action: 'edit', target_id: a.id, target_name: find(a.id)?.name, details: a.patch }); return { player: find(a.id) };
      case 'sanction': {
        const kind = String(a.kind);
        const text = String(a.reason || '').trim();
        if (!['mute', 'jail', 'ban', 'warn', 'lift'].includes(kind)) throw err('Unknown sanction.');
        if (!text) throw err('Give a reason.');
        const p = find(String(a.id));
        if (!p) throw err('No such hero.', 404);
        let until = null;
        if (['mute', 'jail', 'ban'].includes(kind)) {
          const permanent = a.days == null || Number(a.days) <= 0;
          if (permanent || Number(a.days) > 7) requireAdmin();
          until = permanent ? '9999-12-31T00:00:00.000Z' : new Date(Date.now() + Number(a.days) * 86400000).toISOString();
        }
        if (kind === 'lift') Object.assign(p, { muted_until: null, jailed_until: null, banned_until: null, sanction_reason: null });
        else { p[`${{ mute: 'muted', jail: 'jailed', ban: 'banned' }[kind] || 'x'}_until`] = until; p.sanction_reason = text; p.strikes = (p.strikes || 0) + 1; }
        (D.history[p.id] ||= []).unshift({ kind, reason: text, until, by_name: user.email, created_at: new Date().toISOString() });
        log({ action: `sanction:${kind}`, target_id: p.id, target_name: p.name, details: { days: a.days, reason: text, until } });
        return { ok: true };
      }
      case 'zones': return { zones: zoneRows() };
      case 'chatLog': {
        const q = String(a.q || '').toLowerCase();
        const sender = String(a.sender || '').toLowerCase();
        return { messages: this.chat.filter((m) => (!a.channel || m.channel === a.channel) && (!sender || m.sender_name.toLowerCase().includes(sender)) && (!q || (m.original_text || m.text).toLowerCase().includes(q))).slice().reverse() };
      }
      case 'chatReports': return { reports: D.reports.filter((r) => !r.resolved_at).map(withMessages) };
      case 'chatDelete': {
        const m = this.chat.find((x) => x.id === Number(a.id));
        if (!m) throw err('No such message.');
        if (m.deleted_at) throw err('Already removed.');
        Object.assign(m, { original_text: m.text, text: '', deleted_at: new Date().toISOString(), deleted_by: user.email });
        log({ action: 'chat:delete', target_id: m.sender_id, target_name: m.sender_name, details: { id: m.id, text: m.original_text } });
        return { ok: true };
      }
      case 'resolveReport': {
        // Like the server: an already-resolved report is still found, nothing changes, and the
        // resolution is logged again (so a duplicate request shows up as a duplicate audit entry).
        const r = D.reports.find((x) => x.id === Number(a.id));
        if (!r) throw err('No such report.');
        for (const x of D.reports) if (x.message_id === r.message_id && !x.resolved_at) Object.assign(x, { resolved_at: new Date().toISOString(), resolved_by: user.email });
        log({ action: 'chat:resolveReport', details: { message: r.message_id, note: a.note || null } });
        return { ok: true };
      }
      case 'world': return { data: D.world };
      case 'setBase': requireAdmin(); D.world.base = { ...D.world.base, ...a.base }; return { data: D.world };
      case 'startEvent': requireAdmin(); D.world.events.push({ id: `ev-${D.world.events.length + 1}`, name: a.name, ...a.mults, until: new Date(Date.now() + Number(a.hours) * 3600000).toISOString() }); return { data: D.world };
      case 'endEvent': {
        requireAdmin();
        const ev = D.world.events.find((e) => e.id === a.id);
        if (!ev) throw err('No such event.');
        D.world.events = D.world.events.filter((e) => e.id !== a.id);
        log({ action: 'world:endEvent', details: { name: ev.name } });
        return { data: D.world };
      }
      case 'hunts': return { hunts: D.hunts, suggest: {} };
      case 'startHunt': requireAdmin(); return { ok: true };
      case 'cancelHunt': {
        requireAdmin();
        const h = D.hunts.find((x) => x.id === a.id && x.status === 'active');
        if (!h) throw err('That hunt is not active.');
        h.status = 'cancelled';
        log({ action: 'hunt:cancel', target_name: h.name });
        return { ok: true };
      }
      case 'economy': return { rows: D.economy };
      case 'events': return { events: this.events };
      case 'announce': this.events.unshift({ id: this.events.length + 10, kind: 'announce', text: a.text, created_at: new Date().toISOString() }); return { ok: true };
      // Public news (landing L-3), as supabase/functions/admin/index.ts does it: admins only,
      // repeats refused, one audit entry per change. The real function and database are tested
      // on the local stack (tests/db/).
      case 'news': requireAdmin(); return { news: this.newsList() };
      case 'newsSave': {
        requireAdmin();
        const { value, errors } = checkNews(a.entry || {});
        const first = Object.values(errors)[0];
        if (first) throw err(first);
        const now = new Date().toISOString();
        const taken = (slug, id) => this.news.some((n) => n.slug === slug && n.id !== id);
        const fields = { slug: value.slug, kind: value.kind, title: value.title, summary: value.summary, body: value.body, maintenance_starts_at: value.startsAt, maintenance_ends_at: value.endsAt };
        if (a.id == null) {
          if (taken(value.slug, null)) throw err('That address is already used by another news entry.', 409);
          const entry = { id: this.newsSeq++, ...fields, status: 'draft', published_at: null, revised_at: null, created_at: now, updated_at: now };
          this.news.push(entry);
          log({ action: 'news:create', target_name: value.title, details: { id: entry.id, slug: value.slug, kind: value.kind } });
          return { entry: structuredClone(entry), news: this.newsList() };
        }
        const old = this.news.find((n) => n.id === Number(a.id));
        if (!old) throw err('That news entry no longer exists.', 404);
        if (old.published_at && value.slug !== old.slug) throw err("The address can't change once the entry has been published.", 409);
        if (taken(value.slug, old.id)) throw err('That address is already used by another news entry.', 409);
        const t = (x) => (x == null ? null : new Date(x).getTime());
        const textChanged = old.title !== value.title || old.summary !== value.summary || old.body !== value.body || old.kind !== value.kind
          || t(old.maintenance_starts_at) !== t(value.startsAt) || t(old.maintenance_ends_at) !== t(value.endsAt);
        if (!textChanged && old.slug === value.slug) throw err('Nothing has changed.');
        Object.assign(old, fields, { updated_at: now }, old.published_at && textChanged ? { revised_at: now } : {});
        log({ action: 'news:edit', target_name: value.title, details: { id: old.id, slug: value.slug, revised: !!(old.published_at && textChanged) } });
        return { entry: structuredClone(old), news: this.newsList() };
      }
      case 'newsPublish': case 'newsUnpublish': {
        requireAdmin();
        const old = this.news.find((n) => n.id === Number(a.id));
        if (!old) throw err('That news entry no longer exists.', 404);
        const to = action === 'newsPublish' ? 'published' : 'unpublished';
        if (to === 'published' && old.status === 'published') throw err('That entry is already published.', 409);
        if (to === 'unpublished' && old.status !== 'published') throw err('Only a published entry can be unpublished.', 409);
        const republished = to === 'published' && !!old.published_at;
        const now = new Date().toISOString();
        Object.assign(old, { status: to, updated_at: now }, to === 'published' && !old.published_at ? { published_at: now } : {});
        log({ action: to === 'published' ? 'news:publish' : 'news:unpublish', target_name: old.title, details: { id: old.id, slug: old.slug, republished } });
        return { entry: structuredClone(old), news: this.newsList() };
      }
      case 'newsDelete': {
        requireAdmin();
        const old = this.news.find((n) => n.id === Number(a.id));
        if (!old) throw err('That news entry no longer exists.', 404);
        if (!canDeleteNews(old.status)) throw err("A published entry can't be deleted. Unpublish it first.", 409);
        this.news = this.news.filter((n) => n !== old);
        log({ action: 'news:delete', target_name: old.title, details: { id: old.id, slug: old.slug, status: old.status } });
        return { news: this.newsList() };
      }
      case 'deleteEvent': requireAdmin(); this.events = this.events.filter((e) => String(e.id) !== String(a.id)); log({ action: 'deleteEvent', details: { id: a.id } }); return { ok: true };
      case 'log': return { log: D.log };
      case 'staff': return { staff: D.staff };
      case 'setStaff': {
        requireAdmin();
        const email = String(a.email || '');
        if (a.role == null) D.staff = D.staff.filter((s) => s.email !== email);
        else if (D.staff.some((s) => s.email === email)) D.staff = D.staff.map((s) => (s.email === email ? { ...s, role: a.role } : s));
        log({ action: a.role ? `staff:${a.role}` : 'staff:remove', target_name: email });
        return { staff: D.staff };
      }
      // Zones: like the server, every save, delete and restore changes the list and is logged;
      // deleting a zone that is already gone is refused.
      case 'saveZone': {
        requireAdmin();
        const rows = zoneRows();
        const i = rows.findIndex((r) => r.id === a.zone.id);
        if (i >= 0) rows[i] = { ...rows[i], data: a.zone }; else rows.push({ id: a.zone.id, data: a.zone, sort: rows.length, players: 0, builtin: false });
        log({ action: a.isNew ? 'zone:create' : 'zone:edit', target_name: a.zone.name, details: { id: a.zone.id } });
        return { zones: rows };
      }
      case 'deleteZone': {
        requireAdmin();
        const row = zoneRows().find((r) => r.id === a.id);
        if (!row) throw err('No such zone.');
        D.zoneRows = zoneRows().filter((r) => r.id !== a.id);
        log({ action: 'zone:delete', target_name: row.data.name, details: { id: a.id } });
        return { zones: D.zoneRows };
      }
      case 'resetZone': {
        requireAdmin();
        const def = DEFAULT_ZONES.find((z) => z.id === a.id);
        if (!def) throw err('That zone has no built-in version.');
        const rows = zoneRows();
        const i = rows.findIndex((r) => r.id === a.id);
        if (i >= 0) rows[i] = { ...rows[i], data: def }; else rows.push({ id: def.id, data: def, sort: rows.length, players: 0, builtin: true });
        log({ action: 'zone:reset', target_name: def.name, details: { id: a.id } });
        return { zones: rows };
      }
      default: return { ok: true };
    }
  }

  // PostgREST-style reads.
  rest(user, table, params, single) {
    const eq = (k) => (params.get(k) || '').replace(/^eq\./, '');
    const c = user ? this.heroes[user.id] : null;
    switch (table) {
      case 'zones': return this.zoneDefs.map((z, i) => ({ data: z, sort: i }));
      case 'world_config': return single ? { data: { base: { xp: 1, gold: 1, drop: 1, elite: 1, mastery: 1 }, events: this.worldEvents } } : [{ data: { base: {}, events: this.worldEvents } }];
      case 'hunts': return this.activeHunts;
      case 'events': return [...this.events].reverse();
      case 'characters': return this.players.filter((p) => p.zone === eq('zone') && String(p.x) === eq('x') && String(p.y) === eq('y'));
      case 'chat_messages': {
        const ch = eq('channel');
        return this.chat.filter((m) => m.channel === ch && (ch !== 'zone' || m.zone === c?.loc.zone)).slice().reverse();
      }
      case 'chat_ignores': return [];
      case 'staff': return single ? (user?.role ? { role: user.role } : null) : (user?.role ? [{ role: user.role }] : []);
      case 'news': return this.newsRead(params);
      default: return [];
    }
  }

  // Admin list: newest change first.
  newsList() { return structuredClone([...this.news].sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)) || y.id - x.id)); }

  // The public read of news, as the database allows it (checked on the local stack in tests/db/):
  // published rows whose time has passed, and only the article columns; anything else is the
  // same 401 / 42501 the API returns.
  newsRead(params) {
    const PUBLIC = ['id', 'slug', 'kind', 'title', 'summary', 'body', 'published_at', 'revised_at', 'maintenance_starts_at', 'maintenance_ends_at'];
    const denied = { __status: 401, body: { code: '42501', details: null, hint: null, message: 'permission denied for table news' } };
    const cols = (params.get('select') || '*').split(',').map((c) => c.trim());
    if (cols.some((c) => !PUBLIC.includes(c))) return denied;
    for (const k of params.keys()) if (!['select', 'order', 'limit', 'offset', 'or'].includes(k) && !PUBLIC.includes(k)) return denied;
    // or=(col.op.value,...), as the entrance's maintenance read uses it; public columns only.
    let anyOf = null;
    if (params.has('or')) {
      const parts = params.get('or').replace(/^\(|\)$/g, '').split(',').map((p) => p.match(/^(\w+)\.(is|gt|lt|eq)\.(.+)$/));
      if (parts.some((m) => !m || !PUBLIC.includes(m[1]))) return denied;
      anyOf = (n) => parts.some(([, col, op, v]) => (op === 'is' ? v === 'null' && n[col] == null
        : op === 'eq' ? String(n[col]) === v
          : n[col] != null && (op === 'gt' ? Date.parse(n[col]) > Date.parse(v) : Date.parse(n[col]) < Date.parse(v))));
    }
    const order = params.get('order');
    if (order && !PUBLIC.includes(order.split('.')[0])) return denied;
    let rows = this.news.filter((n) => n.status === 'published' && n.published_at && new Date(n.published_at).getTime() <= Date.now());
    for (const [k, v] of params) if (PUBLIC.includes(k)) rows = rows.filter((n) => String(n[k]) === v.replace(/^eq\./, ''));
    if (anyOf) rows = rows.filter(anyOf);
    rows.sort((x, y) => new Date(y.published_at) - new Date(x.published_at));
    if (order && order.endsWith('.asc')) rows.reverse();
    const from = Number(params.get('offset')) || 0;
    const limit = Number(params.get('limit')) || rows.length;
    return rows.slice(from, from + limit).map((n) => Object.fromEntries(cols.map((c) => [c, n[c] ?? null])));
  }

  broadcast(table, type, record) {
    for (const s of this.sockets) s.push(table, type, record);
  }
}

// ---------------------------------------------------------------- browser wiring
async function cdnFetch(route) {
  const url = route.request().url();
  const key = Buffer.from(url).toString('base64url').slice(0, 120);
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
    return;
  }
  const res = await route.fetch();
  const body = await res.body();
  fs.mkdirSync(CACHE, { recursive: true });
  if (res.status() === 200) fs.writeFileSync(file, body);
  await route.fulfill({ response: res, body });
}

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
}

export async function attach(context, backend, baseUrl) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // The public news pages (landing L-4): the real edge function handler, run here, reading the
    // fake backend's public news. backend.newsPagesDown makes its reads fail (Supabase down).
    if (req.url().startsWith(baseUrl) && /^\/news(\/|$)/.test(url.pathname)) {
      const fakeFetch = async (u) => {
        if (backend.newsPagesDown) throw new Error('connection refused');
        const out = backend.rest(null, 'news', new URL(u).searchParams, false);
        return new Response(JSON.stringify(out?.__status ? out.body : out), { status: out?.__status || 200, headers: { 'content-type': 'application/json' } });
      };
      const res = await newsResponse(new Request(req.url(), { method: req.method() }), { fetchImpl: fakeFetch });
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
    }
    if (req.url().startsWith(baseUrl)) return route.continue();
    if (ALLOWED_CDN?.test(req.url())) return cdnFetch(route);
    if (url.host !== SUPA.host) {
      backend.unexpected.push(req.url());
      return route.abort('blockedbyclient');
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (backend.offline) return route.abort('internetdisconnected');
    const token = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
    const user = backend.userFor(token);
    const p = url.pathname;
    try {
      if (p === '/auth/v1/token') {
        if (backend.authHold) await backend.authHold;
        const body = JSON.parse(req.postData() || '{}');
        // Refresh tokens are refresh-<account id>; anything else (or a revoked one) is refused.
        const acct = url.searchParams.get('grant_type') === 'refresh_token'
          ? (backend.revoked.has(body.refresh_token) ? null : Object.values(ACCOUNTS).find((x) => body.refresh_token === `refresh-${x.id}`))
          : Object.values(ACCOUNTS).find((x) => x.email === body.email && (backend.passwords[x.id] ?? x.password) === body.password);
        backend.authCalls.push(url.searchParams.get('grant_type') || 'password');
        if (!acct && url.searchParams.get('grant_type') === 'refresh_token') return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found', msg: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found' });
        if (!acct) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        if (url.searchParams.get('grant_type') !== 'refresh_token') backend.revoked.delete(`refresh-${acct.id}`); // a new session, a new refresh token
        return json(route, 200, savedSession(acct));
      }
      // Password recovery (docs/password-recovery-scope.md). A changed password is kept per backend
      // (backend.passwords), never in the shared ACCOUNTS.
      if (p === '/auth/v1/user' && req.method() === 'PUT') {
        if (!user) return json(route, 401, { msg: 'no user' });
        const body = JSON.parse(req.postData() || '{}');
        if (backend.failUserUpdate) return json(route, backend.failUserUpdate, { msg: 'Could not update the user' });
        if (typeof body.password === 'string') {
          if (body.password.length < 6) return json(route, 422, { code: 'weak_password', msg: 'Password should be at least 6 characters.', weak_password: { reasons: ['length'] } });
          backend.passwords[user.id] = body.password;
          backend.passwordUpdates.push(user.id);
        }
        return json(route, 200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' });
      }
      const SESSION_GONE = { code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' };
      if (p === '/auth/v1/user' && backend.ended(token)) return json(route, 403, SESSION_GONE);
      if (p === '/auth/v1/user') return user ? json(route, 200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' }) : json(route, 401, { msg: 'no user' });
      if (p === '/auth/v1/logout') {
        const scope = url.searchParams.get('scope') || 'global';
        backend.logouts.push(scope);
        if (backend.ended(token)) return json(route, 403, SESSION_GONE); // as GoTrue answers (tests/session-answers.mjs)
        if (scope !== 'others' && backend.logoutFail) {
          const f = backend.logoutFail;
          backend.logoutFail = null;
          if (f === 'drop') return route.abort('connectionreset');
          if (f === 'hang') { backend.hungLogout = route; return; } // answered by the test, or never
          return json(route, f, { msg: 'Internal server error' });
        }
        if (scope === 'others' && backend.failOthersLogout > 0) { backend.failOthersLogout--; return json(route, 500, { msg: 'Internal server error' }); }
        return route.fulfill({ status: 204 });
      }
      if (p === '/auth/v1/recover') {
        const body = JSON.parse(req.postData() || '{}');
        backend.recoverRequests.push({ email: body.email, redirectTo: url.searchParams.get('redirect_to') });
        if (backend.recoverStatus === 429) return json(route, 429, { code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' });
        return json(route, 200, {}); // the same for every address, as the real server answers
      }
      // Sign-up with email confirmation on (as the live project): a user, no session yet.
      if (p === '/auth/v1/signup') {
        const body = JSON.parse(req.postData() || '{}');
        if (Object.values(ACCOUNTS).some((x) => x.email === body.email)) return json(route, 422, { code: 'user_already_exists', msg: 'User already registered' });
        return json(route, 200, { id: '00000000-0000-4000-8000-0000000000ff', email: body.email, aud: 'authenticated', role: '', confirmation_sent_at: new Date().toISOString() });
      }
      if (p.startsWith('/functions/v1/')) {
        const fnName = p.split('/').pop();
        const body = JSON.parse(req.postData() || '{}');
        backend.calls.push({ fn: fnName, action: body.action, args: body.args });
        if (backend.holds[body.action]) await backend.holds[body.action];
        const fail = backend.failures.findIndex((f) => f.action === body.action);
        if (fail >= 0) {
          const f = backend.failures.splice(fail, 1)[0];
          if (f.status === 'drop') return route.abort('connectionreset');
          return json(route, f.status, { error: f.message });
        }
        if (fnName === 'game' && backend.staleTokens > 0) { backend.staleTokens--; return json(route, 401, { error: 'Please sign in again.' }); }
        if (!user) return json(route, 401, { error: 'Please sign in again.' });
        try {
          const out = fnName === 'admin' ? backend.admin(user, body.action, body.args || {}) : backend.game(user, body.action, body.args || {});
          return json(route, 200, JSON.parse(JSON.stringify(out)));
        } catch (err) {
          return json(route, err.status || 400, { error: err.message });
        }
      }
      if (p.startsWith('/rest/v1/rpc/my_character')) return json(route, 200, user ? [{ id: backend.charIds[user.id], zone: backend.heroes[user.id]?.loc.zone }] : []);
      if (p.startsWith('/rest/v1/')) {
        const table = p.split('/').pop();
        const single = /vnd\.pgrst\.object/.test(req.headers().accept || '');
        const out = backend.rest(user, table, url.searchParams, single);
        if (out?.__status) return json(route, out.__status, out.body);
        if (single && out == null) return json(route, 406, { message: 'no rows' });
        return json(route, 200, out);
      }
      backend.unexpected.push(req.url());
      return route.abort('blockedbyclient');
    } catch (err) {
      backend.unexpected.push(`${req.url()} (harness error: ${err.message})`);
      return route.abort('failed');
    }
  });

  // Realtime: a fake Phoenix socket that accepts joins and lets the backend push changes.
  await context.routeWebSocket(/.*/, (ws) => {
    const wsUrl = ws.url();
    if (!wsUrl.includes(SUPA.host)) { backend.unexpected.push(wsUrl); ws.close(); return; }
    const bindings = [];
    let asArray = false; // the client's message format: Phoenix v2 arrays or v1 objects
    const frame = (joinRef, ref, topic, event, payload) => JSON.stringify(asArray
      ? [joinRef, ref, topic, event, payload]
      : { join_ref: joinRef, ref, topic, event, payload });
    const sock = {
      push(table, type, record) {
        for (const b of bindings) {
          if (b.table !== table || (b.event !== '*' && b.event !== type)) continue;
          // Like Supabase, updates and deletes also carry the old row (at least its key).
          const data = { type, table, schema: 'public', record, columns: [], commit_timestamp: new Date().toISOString(), errors: null };
          if (type !== 'INSERT') data.old_record = { id: record.id };
          const payload = { data, ids: [b.id] };
          ws.send(frame(b.joinRef, null, b.topic, 'postgres_changes', payload));
        }
      },
    };
    backend.sockets.push(sock);
    let nextId = 1;
    ws.onMessage((raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      asArray = Array.isArray(msg);
      const [joinRef, ref, topic, event, payload] = asArray ? msg : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
      const reply = (resp) => ws.send(frame(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: resp }));
      if (event === 'phx_join') {
        const pc = (payload?.config?.postgres_changes || []).map((b) => {
          const id = nextId++;
          bindings.push({ ...b, id, topic, joinRef });
          return { ...b, id };
        });
        reply({ postgres_changes: pc });
      } else if (event === 'heartbeat' || event === 'access_token' || event === 'phx_leave') {
        reply({});
      }
    });
  });
}

// One browser per test file; a fresh context per test.
export async function setup() {
  const { server, url } = await startServer();
  const browser = await chromium.launch();
  return {
    url, browser,
    // bypassCSP: only so axe can be injected into the news pages, whose policy allows no script.
    async page({ backend = new FakeBackend(), viewport = { width: 390, height: 844 }, mobile = true, reducedMotion = 'no-preference', bypassCSP = false } = {}) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion, bypassCSP });
      await attach(context, backend, url);
      const page = await context.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      // Failure diagnostics (CI-A-01, diagnostics.mjs): only with UI_DIAGNOSTICS=1, before any navigation.
      await track(context, page, backend);
      // Native confirm()/prompt()/alert() are recorded (Phase 3 replaces them; tests assert none appear).
      page.nativeDialogs = [];
      page.on('dialog', (d) => { page.nativeDialogs.push({ type: d.type(), message: d.message() }); d.accept(); });
      return { page, context, backend };
    },
    async close() { await browser.close(); server.close(); },
  };
}

export async function signIn(page, url, who = 'player', path_ = '/') {
  const acct = ACCOUNTS[who];
  await page.goto(url + path_);
  const form = path_.includes('admin') ? '#login' : '#authform';
  await page.waitForSelector(form);
  await page.fill('#email', acct.email);
  await page.fill('#password', acct.password);
  await page.click(`${form} button[type=submit]`);
}

export async function settle(page) {
  await page.waitForTimeout(80);
  await page.waitForFunction(() => !document.querySelector('.pending, [aria-busy="true"]'));
  await page.waitForTimeout(120);
}

// Records each floating gold or XP cue as it is added to the hero bar (gameplay polish amendment
// G1). A cue lives 1.6 s, so tests read this record instead of racing to find it. Each record has
// the cue's text, classes and computed style when added, the XP meter and gold line as they were
// then, how many times its animation started, and when it was added and removed
// (performance.now()). Read with page.evaluate(() => window.__cues).
export async function watchCues(page) {
  await page.evaluate(() => {
    window.__cues = [];
    const top = document.getElementById('top');
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || !n.classList.contains('cue')) continue;
          const cs = getComputedStyle(n);
          const xp = top.querySelector('#hud-xp .meter');
          const rec = {
            text: n.textContent, cls: n.className, ariaHidden: n.getAttribute('aria-hidden'),
            anim: cs.animationName, opacity: cs.opacity, color: cs.color, background: cs.backgroundColor,
            inMeter: !!n.closest('.meter'),
            xpLabel: xp?.querySelector('.meter-name').textContent,
            xpFit: xp ? ['compact', 'stack'].filter((c) => xp.classList.contains(c)) : null,
            goldWidth: top.querySelector('#hud-row .hud-res')?.getBoundingClientRect().width,
            added: performance.now(), removed: null, starts: 0,
          };
          n.addEventListener('animationstart', () => { rec.starts++; });
          n.__cue = rec;
          window.__cues.push(rec);
        }
        for (const n of m.removedNodes) if (n.__cue) n.__cue.removed = performance.now();
      }
    }).observe(top, { childList: true });
  });
}

// axe-core run; returns violations at or above the given impact.
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
// Floating combat numbers are excluded: they are decorative duplicates of the battle log,
// hidden from assistive technology, and fade out within a second (WCAG 1.4.3 "incidental"
// text). Measured mid-fade their partial opacity would otherwise be reported.
const ALWAYS_EXCLUDE = ['.float'];
export async function axe(page, { minImpact = 'serious', exclude = [] } = {}) {
  exclude = [...ALWAYS_EXCLUDE, ...exclude];
  await page.addScriptTag({ content: AXE });
  const order = ['minor', 'moderate', 'serious', 'critical'];
  const res = await page.evaluate(async (ex) => {
    const r = await window.axe.run({ exclude: ex.map((s) => [s]) }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
  }, exclude);
  return res.filter((v) => order.indexOf(v.impact) >= order.indexOf(minImpact));
}

export const focusInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: 'BODY' };
  const cs = getComputedStyle(a);
  return {
    tag: a.tagName, text: (a.getAttribute('aria-label') || a.textContent || a.value || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    a: a.dataset.a || a.dataset.c || null, v: a.dataset.v || null, id: a.id || null,
    inDialog: a.closest('dialog')?.id || null, outlineWidth: parseFloat(cs.outlineWidth) || 0, outlineStyle: cs.outlineStyle,
  };
});

// A large zone for map tests (no Overworld placement, so it needs no paths).
export function bigZone(size = 40, id = 'test-expanse') {
  const mid = Math.ceil(size / 2);
  return {
    id, name: 'The Test Expanse', desc: 'A very large test zone.', size, starter: false, pvp: false, minLevel: 0, exitLevel: 0,
    overworld: null, entry: { x: mid, y: size },
    town: { x: mid, y: mid, name: 'Midpoint' },
    shop: null, lairs: [{ x: 3, y: 3 }],
    portals: [{ x: size, y: 1, to: 'bramblebrook', tx: 5, ty: 5, minLevel: 0, label: 'Back to the meadows' }],
    monsters: [{ name: 'Dune Crawler', level: 12, arch: 'brute', verb: 'bites' }, { name: 'Sand Wisp', level: 14, arch: 'caster', verb: 'zaps', element: 'storm' }],
    boss: { name: 'The Expanse Titan', level: 20, arch: 'tank', verb: 'crushes', proper: true },
  };
}

// A zone whose boss lair is on its town tile (gameplay polish GP-F5b). No built-in zone has one;
// a zone edited in the console could. Pass it to FakeBackend({ zones: [townLairZone()] }).
export function townLairZone(id = 'test-hamlet') {
  return {
    id, name: 'Test Hamlet', desc: 'A lair under the square.', size: 6, starter: false, pvp: false, minLevel: 0, exitLevel: 0,
    overworld: null, entry: { x: 3, y: 6 }, town: { x: 3, y: 3, name: 'Hamlet' }, shop: null,
    lairs: [{ x: 3, y: 3 }], portals: [],
    monsters: [{ name: 'Cellar Rat', level: 1, arch: 'quick', verb: 'bites' }, { name: 'Moth Swarm', level: 2, arch: 'caster', verb: 'stings', element: 'storm' }],
    boss: { name: 'The Undercroft King', level: 5, arch: 'tank', verb: 'crushes', proper: true },
  };
}

// An on-screen keyboard as iOS Safari presents it: the layout viewport keeps its size and only
// the visual viewport shrinks, so anything anchored to the bottom ends up behind the keyboard.
// Call before navigation; then setKeyboard(page, px) opens (or, with 0, closes) it.
export async function fakeKeyboard(page) {
  await page.addInitScript(() => {
    const vv = new EventTarget();
    let covered = 0;
    let pan = 0;
    Object.defineProperties(vv, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - covered },
      offsetTop: { get: () => pan }, offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY }, pageLeft: { get: () => window.scrollX }, scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    // pan: iOS also scrolls the visible area up (offsetTop) to reveal a focused input.
    window.__setKeyboard = (px, p = 0) => { covered = px; pan = p; vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); };
  });
}
export const setKeyboard = (page, px, pan = 0) => page.evaluate(([v, p]) => window.__setKeyboard(v, p), [px, pan]);

// Layout measurements for the responsive acceptance criteria (run in the page).
export const PAGE_METRICS = () => {
  const main = document.getElementById('main');
  const m = main.getBoundingClientRect();
  const rowsIn = [...document.querySelectorAll('#main .row[data-a="fight"]')];
  const visibleRows = rowsIn.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= m.top - 1 && b.bottom <= m.bottom + 1 && b.bottom <= innerHeight; }).length;
  const firstRow = rowsIn[0]?.getBoundingClientRect();
  // Gameplay polish F1: the monsters are one drop-down and a Fight button; F2: in town, a message.
  const inMain = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.height > 0 && b.top >= m.top - 1 && b.bottom <= m.bottom + 1 && b.bottom <= innerHeight; };
  const pickVisible = inMain(document.querySelector('#mon-select')) && inMain(document.querySelector('#mon-pick [data-a="fight"]'));
  const calmVisible = inMain(document.querySelector('#main .town-calm'));
  const clip = (sel) => [...document.querySelectorAll(sel)].some((el) => el.scrollWidth > el.clientWidth + 1);
  const dockBtns = [...document.querySelectorAll('#dock button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width && b.height);
  let overlaps = 0;
  for (let i = 0; i < dockBtns.length; i++) for (let j = i + 1; j < dockBtns.length; j++) {
    const a = dockBtns[i]; const b = dockBtns[j];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
  }
  const minTarget = dockBtns.length ? Math.round(Math.min(...dockBtns.map((b) => Math.min(b.width, b.height)))) : null;
  const offscreen = dockBtns.filter((b) => b.bottom > innerHeight + 1 || b.right > innerWidth + 1).length;
  const dock = document.getElementById('dock').getBoundingClientRect();
  const top = document.getElementById('top').getBoundingClientRect();
  return {
    mainH: Math.round(m.height), visibleRows, pickVisible, calmVisible, firstRowTop: firstRow ? Math.round(firstRow.top - m.top) : null,
    hudH: Math.round(top.height), hudClipped: clip('#top .hud-name') || clip('#top .hud-res'),
    dockH: Math.round(dock.height), dockOverlaps: overlaps, dockMinTarget: minTarget, dockOffscreen: offscreen,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

// A quest the default test hero (level 12, in Bramblebrook) can always take, whatever the hour.
export function fixedQuest() {
  return {
    id: 'quest-fixed', bucket: hourBucket(), slot: 0, zone: 'bramblebrook', variant: 'blessed', minLevel: 8, maxLevel: 14,
    reward: { xp: 120, gold: 300, gem: null, kind: 'gold' }, expiresAt: Date.now() + 3600000, completedBy: null,
  };
}

// Admin console fixtures: chat with two open reports (one with a reason, one without).
const ago_ = (m) => new Date(Date.now() - m * 60000).toISOString();
export const ADMIN_CHAT = [
  { id: 11, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: ago_(50) },
  { id: 12, channel: 'global', zone: null, sender_id: 'char-2', sender_name: 'Grubnak', sender_role: null, recipient_id: null, recipient_name: null, text: 'Get lost, newbies. This meadow is mine.', deleted_at: null, created_at: ago_(40) },
  { id: 13, channel: 'zone', zone: 'bramblebrook', sender_id: 'char-player', sender_name: 'Bartholomew Thorne', sender_role: null, recipient_id: null, recipient_name: null, text: 'Selling a Padded Helm, cheap.', deleted_at: null, created_at: ago_(30) },
];
export const ADMIN_REPORTS = [{ message_id: 12, reporter_name: 'Tamsin Reed', reason: 'Rude to new players' }, { message_id: 11, reporter_name: 'Kettle', reason: '' }];


// Opens an admin console section the way a person would: on phones a section can sit in a
// collapsed navigation group (Phase 4), so its group is opened first. Works with older layouts too.
export async function adminTab(page, tab) {
  const sel = `[data-a="tab"][data-v="${tab}"]`;
  if (!(await page.isVisible(sel))) {
    const group = await page.getAttribute(sel, 'data-group');
    if (group) await page.click(`[data-a="navgroup"][data-v="${group}"]`);
  }
  await page.click(sel);
}
