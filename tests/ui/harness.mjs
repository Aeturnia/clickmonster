// UI test harness: serves public/ locally and replaces Supabase with a deterministic fake
// built on the real game engine. Nothing reaches the live backend:
//   - every request is routed; Supabase hosts are answered by the fake
//   - the Realtime websocket is answered by a fake socket
//   - any other host fails the test, except the pinned supabase-js module from the CDN,
//     which is cached on disk after the first download so later runs are offline.
import http from 'node:http';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.resolve(ROOT, process.env.UI_PUBLIC_DIR || 'public');
const CACHE = path.join(ROOT, 'tests/ui/.cache');
const SUPA = new URL(SUPABASE_URL);
const ALLOWED_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\//;

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

function fakeJwt(sub, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp })}.signature`;
}

// ---------------------------------------------------------------- fake backend
export class FakeBackend {
  constructor({ hero = makeHero(), players = [], chat = [], events = [], seed = 7, zones = [], quests = null, reports = null } = {}) {
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
    // The real board depends on the hour; tests that need a quest pass a fixed one (fixedQuest()).
    this.quests = quests || generateQuests(hourBucket()).map((q, i) => ({ ...q, id: `quest-${i}`, completedBy: null }));
  }

  failNext(action, status, message) { this.failures.push({ action, status, message }); }

  // Keep requests for an action waiting (a slow server) until the returned function is called.
  hold(action) {
    let release;
    this.holds[action] = new Promise((r) => { release = r; });
    return () => { delete this.holds[action]; release(); };
  }

  userFor(token) {
    try {
      const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
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
    players.find((p) => p.name === 'Grubnak').banned_until = iso(NOW + 3 * day);
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
      case 'world_config': return single ? { data: { base: { xp: 1, gold: 1, drop: 1, elite: 1, mastery: 1 }, events: [] } } : [{ data: { base: {}, events: [] } }];
      case 'hunts': return [];
      case 'events': return [...this.events].reverse();
      case 'characters': return this.players.filter((p) => p.zone === eq('zone') && String(p.x) === eq('x') && String(p.y) === eq('y'));
      case 'chat_messages': {
        const ch = eq('channel');
        return this.chat.filter((m) => m.channel === ch && (ch !== 'zone' || m.zone === c?.loc.zone)).slice().reverse();
      }
      case 'chat_ignores': return [];
      case 'staff': return single ? (user?.role ? { role: user.role } : null) : (user?.role ? [{ role: user.role }] : []);
      default: return [];
    }
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
    if (req.url().startsWith(baseUrl)) return route.continue();
    if (ALLOWED_CDN.test(req.url())) return cdnFetch(route);
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
        const body = JSON.parse(req.postData() || '{}');
        const acct = Object.values(ACCOUNTS).find((x) => x.email === body.email && x.password === body.password);
        if (!acct) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        const access = fakeJwt(acct.id, acct.email);
        return json(route, 200, { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user: { id: acct.id, email: acct.email, aud: 'authenticated', role: 'authenticated' } });
      }
      if (p === '/auth/v1/user') return user ? json(route, 200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' }) : json(route, 401, { msg: 'no user' });
      if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
      if (p.startsWith('/functions/v1/')) {
        const fnName = p.split('/').pop();
        const body = JSON.parse(req.postData() || '{}');
        backend.calls.push({ fn: fnName, action: body.action, args: body.args });
        if (backend.holds[body.action]) await backend.holds[body.action];
        const fail = backend.failures.findIndex((f) => f.action === body.action);
        if (fail >= 0) {
          const f = backend.failures.splice(fail, 1)[0];
          return json(route, f.status, { error: f.message });
        }
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
    async page({ backend = new FakeBackend(), viewport = { width: 390, height: 844 }, mobile = true, reducedMotion = 'no-preference' } = {}) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion });
      await attach(context, backend, url);
      const page = await context.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
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
    mainH: Math.round(m.height), visibleRows, firstRowTop: firstRow ? Math.round(firstRow.top - m.top) : null,
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
