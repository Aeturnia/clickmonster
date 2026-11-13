// UI layer. Game rules live in ./engine (the server runs the same code); this file
// renders the screen and sends actions. Text only by design: no icons or emoji.
import { RACES, affinityLabel } from './data/races.js';
import { STATS, STAT_LABEL, STAT_SHORT, STAT_DESC, POINTS_PER_LEVEL } from './data/stats.js';
import { ITEMS, SLOTS, SLOT_LABEL, WEAPON_TYPES, tierRoman, itemDef } from './data/items.js';
import { MASTERIES, MASTERY_LABEL, masteryCap, raceSpecialties } from './data/masteries.js';
import { VARIANTS } from './data/variants.js';
import { ELEMENT_LABEL } from './data/elements.js';
import { ZONES, MONSTERS, loadZones } from './data/zones.js';
import { parseGem, extractCost } from './data/gems.js';
import {
  maxHp, xpToNext, totalStats, gemBonuses, totalArmor, playerCombatant,
  applyRegen, healCost, findItem, equippedItem, meetsRequirements, NAME_RE, deathPenalty,
} from './engine/character.js';
import { ask, cancelAsk, onConfirmClose, setConfirmFallback } from './confirm.js';
import { currentZone, featuresAt, inTown, monstersHere, directionTo } from './engine/world.js';
import { monsterCombatant } from './engine/monster.js';
import { meleeChance, spellChance, meleeBase, spellBase } from './engine/combat.js';
import { shopItems, isEquipped, sellPrice } from './engine/inventory.js';
import { PVP_LEVEL_GAP } from './engine/pvp.js';
import { sb, api, playersAt, recentEvents, fetchZoneDefs, signOut } from './net.js';
import { setupChat } from './chat-ui.js';
import { questTitle, canAccept } from './engine/quests.js';
import { setWorld, activeEvents, MULT_LABEL, MULT_KEYS } from './engine/world-config.js';
import { huntCombatant } from './engine/hunt.js';
import { watchLayout } from './layout.js';

// The entrance (entry.js) imports this module only once net.js has created the Supabase client.
if (!sb) throw new Error('main.js is started by entry.js, after the Supabase client is ready.');

// ---------------------------------------------------------------- state
const PREFS_KEY = 'clickmonster.prefs';
const prefs = (() => {
  const defaults = { leftHanded: false, vibrate: true, keys: true }; // keys: desktop keyboard shortcuts (D-3)
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
})();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

let session = null;
let char = null; // the server's copy of our hero
let layout = 'mobile'; // set by watchLayout(): mobile, wide or desktop (layout.js)
// Per-account UI state. stop() replaces it with a fresh copy at every account boundary
// (landing L-1 review, L1-02). Device-level settings live in prefs, not here.
const freshUi = () => ({
  phase: 'idle', // idle (the entrance is showing) | game
  tab: 'explore',
  list: 'monsters',
  race: 'human',
  sheet: null, // { type: 'item', uid } | { type: 'shop' }
  shopSlot: 'weapon',
  usableOnly: false,
  busy: false,
  nextActionAt: 0,
  players: null,
  playersKey: null,
  levelSheetSnoozed: 0,
  lastMonster: null,
  sanctions: null,
  announcement: null,
  errors: [], // persistent problems: { id, text, scope, count }
  createError: null,
  bankError: null,
  hunts: [],
});
const ui = freshUi();

// The game session: one per start(), ended by stop(). Anything that awaits (an action, a read)
// notes the session it began in and drops its result if that session has ended, so a late
// answer for one account never reaches the next (landing L-1 review, L1-01 and L1-02).
let gameGen = 0;
const live = (g) => g === gameGen;

const SEEN_KEY = 'clickmonster.seenAnnouncement';
const seenAnnouncement = () => { try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; } };

const chat = setupChat({
  sb, api, getChar: () => char, toast: (m, k) => toast(m, k), esc: (s) => esc(s),
  zoneName: (id) => ZONES[id]?.name || 'this zone',
  onLeave: () => leaveChat(),
});

// ---------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => `${Math.round(n * 100)}%`;
const fmt = (n) => Math.round(n).toLocaleString();
// Short form for tight spaces: 98,765,432 becomes 98.8M. Exact below 100,000.
function short(n) {
  const v = Math.round(n);
  const a = Math.abs(v);
  if (a < 100000) return v.toLocaleString();
  const [d, s] = a < 1e6 ? [1e3, 'K'] : a < 1e9 ? [1e6, 'M'] : a < 1e12 ? [1e9, 'B'] : [1e12, 'T'];
  const x = v / d;
  return `${Math.abs(x) < 100 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)}${s}`;
}
// A shortened amount that still reads out (and shows on hover) in full.
// quiet: the unit is only read out, not shown.
const amount = (n, unit, quiet = false) => {
  const u = quiet ? `<span class="sr-only"> ${unit}</span>` : ` ${unit}`;
  return short(n) === fmt(n)
    ? `<b>${fmt(n)}</b>${u}`
    : `<b aria-hidden="true" title="${fmt(n)} ${unit}">${short(n)}</b><span class="sr-only">${fmt(n)}</span>${u}`;
};
const btn = (a, v, label, cls = '', disabled = false) =>
  `<button data-a="${a}"${v != null ? ` data-v="${esc(v)}"` : ''} class="btn ${cls}"${disabled ? ' disabled' : ''}>${label}</button>`;

function meter(label, cur, max, cls = '') {
  const w = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="meter ${cls}"><div class="meter-label"><span>${label}</span><b>${fmt(cur)} / ${fmt(max)}</b></div>
    <div class="meter-track"><i style="width:${w}%"></i></div></div>`;
}

// Standard empty and loading states: a short statement, then what to do about it.
function emptyState(title, hint = '', { loading = false } = {}) {
  return `<div class="empty${loading ? ' loading' : ''}"${loading ? ' aria-busy="true"' : ''}><p class="empty-title">${title}</p>${hint ? `<p class="empty-hint">${hint}</p>` : ''}</div>`;
}

const DIFFICULTY = [
  [-6, 'con-gray', 'Trivial'], [-3, 'con-green', 'Easy'], [1, 'con-white', 'Even'],
  [3, 'con-yellow', 'Tough'], [6, 'con-orange', 'Hard'], [Infinity, 'con-red', 'Deadly'],
];
function difficulty(level) {
  const d = level - char.level;
  const [, cls, word] = DIFFICULTY.find(([max]) => d <= max);
  return { cls, word };
}

// ---- Problems stay visible until dismissed or resolved; success messages are brief toasts.
let nextErrorId = 1;
function addError(text, scope = 'general') {
  const same = ui.errors.find((e) => e.text === text);
  if (same) { same.count += 1; same.scope = scope; ui.errors = [...ui.errors.filter((e) => e !== same), same]; }
  else ui.errors.push({ id: nextErrorId++, text, scope, count: 1 });
  renderAlerts();
}
// A successful action clears problems it caused, and any connection problem.
function resolveErrors(scope) {
  const before = ui.errors.length;
  ui.errors = ui.errors.filter((e) => e.scope !== scope && e.scope !== 'connection');
  if (ui.errors.length !== before) renderAlerts();
}
function ensureEl(id, attrs) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
  }
  return el;
}

// The toast and the problems area must sit inside an open modal dialog (or the backdrop
// hides them) and back on the page once it closes. One owner decides where they live;
// it runs when they're shown, after every render, and whenever any dialog closes.
function placeOverlays() {
  // The topmost open dialog (the last one opened sits last in the DOM), else the page.
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  for (const el of [document.getElementById('toast'), document.getElementById('alerts')]) {
    if (el && el.parentNode !== host) host.appendChild(el);
  }
  return host;
}
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', () => { placeOverlays(); positionToast(); });
onConfirmClose(() => { placeOverlays(); positionToast(); });
// After a confirmation whose control was re-rendered away: inside the sheet or chat still open
// underneath (its heading, else its first control), otherwise the screen's usual fallback.
setConfirmFallback(() => {
  const under = [...document.querySelectorAll('dialog[open]')].pop();
  if (under) return under.querySelector('#sheet-title, [tabindex="-1"], button:not([disabled]), input:not([disabled])');
  focusFallback();
  return null;
});

// The on-screen keyboard. iOS (and Android without resizes-content) shrink only the visual
// viewport, leaving bottom-anchored dialogs behind the keyboard. Expose the visible height and
// the covered strip as CSS variables so the chat drawer and sheets sit above it.
function syncViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  if (!vv) return;
  const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  root.setProperty('--vvh', `${Math.round(vv.height)}px`);
  root.setProperty('--kb', `${covered}px`);
  positionToast();
  // With the keyboard up over a sheet, keep the field being typed in and the buttons that act on
  // it (the next row of buttons, such as Deposit and Withdraw) in view.
  const field = document.activeElement;
  if (covered > 0 && field?.matches?.('dialog[open] input')) {
    let next = (field.closest('label') || field).nextElementSibling;
    while (next && !next.querySelector('button:not([disabled])')) next = next.nextElementSibling;
    requestAnimationFrame(() => {
      next?.scrollIntoView({ block: 'nearest' });
      field.scrollIntoView({ block: 'nearest' });
    });
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
  syncViewport();
}

function positionToast() {
  const el = document.getElementById('toast');
  if (!el) return;
  // Sit just above the bottom controls so it never covers the screen title.
  const anchor = el.parentNode === document.body && ($('#dock:not(:empty)') || $('#nav:not(:empty)'));
  el.style.top = 'auto';
  const r = anchor && anchor.getBoundingClientRect();
  el.style.bottom = r ? `${window.innerHeight - r.top + 10}px` : '24px';
  // Centred over the controls: the whole screen on phones, the side column in the wide layout.
  el.style.left = r ? `${r.left + r.width / 2}px` : '50%';
}

function renderAlerts() {
  const el = ensureEl('alerts', { 'aria-label': 'Problems' });
  const host = placeOverlays();
  const top = $('#top');
  el.style.top = host === document.body && top && top.offsetHeight ? `${Math.round(top.getBoundingClientRect().bottom) + 8}px` : 'calc(12px + env(safe-area-inset-top))';
  const last = ui.errors.length - 1;
  const html = ui.errors.map((e, i) => `<div class="alert"${i === last ? ' role="alert"' : ''}>
      <p>${esc(e.text)}${e.count > 1 ? ` <span class="alert-count">(${e.count} times)</span>` : ''}</p>
      <button type="button" class="textbtn" data-a="dismissError" data-v="${e.id}">Dismiss<span class="sr-only"> message: ${esc(e.text)}</span></button>
    </div>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}

let toastTimer;
function toast(msg, kind = '') {
  if (kind === 'bad') { addError(msg); return; }
  const el = ensureEl('toast', { role: 'status', 'aria-live': 'polite' });
  placeOverlays();
  positionToast();
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2400);
}

function itemSummary(base) {
  if (base.slot === 'weapon') return `${WEAPON_TYPES[base.type].label}, power ${base.power}`;
  if (base.slot === 'focus') return `${ELEMENT_LABEL[base.element]} focus, power ${base.power}`;
  return `Armor ${base.armor}`;
}

function reqHtml(itemOrId) {
  const base = typeof itemOrId === 'string' ? ITEMS[itemOrId] : itemDef(itemOrId);
  const entries = Object.entries(base.req);
  if (!entries.length) return 'No requirements';
  const stats = totalStats(char, base.slot);
  return 'Needs ' + entries.map(([s, n]) => `<span class="${stats[s] < n ? 'req-bad' : ''}">${STAT_SHORT[s]} ${n}</span>`).join(', ');
}

// The mastery that applies to a piece of gear, e.g. "Sword mastery 23".
function masteryNote(def) {
  const m = def.slot === 'weapon' ? def.type : def.slot === 'focus' ? def.element : null;
  if (!m) return '';
  return `${MASTERY_LABEL[m]} mastery ${char.masteries?.[m] ?? 0}`;
}

function gemText(key) {
  const g = parseGem(key);
  return g ? `<span class="gem-${g.type}">${esc(g.name)}</span> ${g.text}` : '';
}

const timeLeft = (ms) => {
  const m = Math.max(0, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

function rewardText(r) {
  return [`${fmt(r.xp)} XP`, `${fmt(r.gold)} gold`, r.gem ? parseGem(r.gem)?.name : null].filter(Boolean).join(', ');
}

const fighting = () => !!(char && char.battle && !char.battle.over);
const locKey = () => `${char.loc.zone}:${char.loc.x}:${char.loc.y}`;

// ---------------------------------------------------------------- HUD, tabs
// Gold and XP changes from the last action show briefly in the HUD (decorative: the toast, battle
// log and announcements already say it). DELTA_MS after the action they are gone.
const DELTA_MS = 2600;
function deltaChip(n, unit) {
  if (!n) return '';
  return `<span class="delta ${n > 0 ? 'up' : 'down'}" aria-hidden="true">${n > 0 ? '+' : '-'}${short(Math.abs(n))}${unit ? ` ${unit}` : ''}</span>`;
}

function viewTop() {
  if (!char) return '';
  const race = RACES[char.race];
  const gems = Object.values(char.gems).reduce((a, b) => a + b, 0);
  const d = ui.delta && Date.now() - ui.delta.at < DELTA_MS ? ui.delta : {};
  // One line for identity and wealth, one for the meters. Race and the full numbers stay
  // available to screen readers; the Hero and Gear tabs show them in full.
  return `<div class="hud-row">
      <span class="hud-name">${esc(char.name)}<span class="sr-only">, level ${char.level} ${esc(race.name)}</span></span>
      <span class="hud-res">${deltaChip(d.gold)}${amount(char.gold, 'gold')}<span class="gems"> ${amount(gems, 'gems')}</span></span>
    </div>
    <div class="hud-bars">${meter('HP', char.hp, maxHp(char))}${meter(`Lv ${char.level}${deltaChip(d.xp, 'XP')}`, char.xp, xpToNext(char.level), `xp${d.xp > 0 ? ' gain' : ''}`)}</div>`;
}

function viewNav() {
  if (!char) return '';
  const tabs = [['explore', fighting() ? 'Battle' : 'Explore'], ['hero', 'Hero'], ['gear', 'Gear'], ['map', 'Map']];
  return `<div class="tabs">${tabs.map(([id, label]) =>
    `<button data-a="tab" data-v="${id}" class="${ui.tab === id ? 'on' : ''}"${ui.tab === id ? ' aria-current="page"' : ''}>${label}${id === 'hero' && char.pendingLevels ? `<span class="count"><span class="sr-only">, </span>${char.pendingLevels}<span class="sr-only"> level${char.pendingLevels > 1 ? 's' : ''} to spend</span></span>` : ''}</button>`).join('')}</div>`;
}

// ---------------------------------------------------------------- desktop side column
// What the hero bar doesn't show, kept in view on every screen: levels to spend, the active
// quest, world events and world-boss hunts. One line when there is nothing to show.
function eventLine(e) {
  const bits = MULT_KEYS.filter((k) => e[k] && e[k] !== 1).map((k) => `${MULT_LABEL[k]} x${e[k]}`).join(', ');
  return `<b>${esc(e.name)}</b>: ${bits}. ${timeLeft(new Date(e.until).getTime() - Date.now())} left.`;
}
function viewSummary() {
  const items = [];
  const n = char.pendingLevels;
  if (n) items.push(`<li><button class="textbtn" id="sum-levels" data-a="tab" data-v="hero">${n} level${n > 1 ? 's' : ''} to spend</button></li>`);
  const q = char.quest;
  if (q) items.push(`<li><b>Quest:</b> ${esc(questTitle(q))}. ${timeLeft(q.expiresAt - Date.now())} left.</li>`);
  for (const e of activeEvents()) items.push(`<li class="event">${eventLine(e)}</li>`);
  for (const h of (ui.hunts || []).slice(0, 3)) {
    const pct = Math.max(1, Math.round((h.hp / h.max_hp) * 100));
    items.push(`<li><b>World boss:</b> ${esc(h.name)} in ${esc(ZONES[h.zone]?.name || h.zone)}, ${pct}% health. ${timeLeft(new Date(h.ends_at).getTime() - Date.now())} left.</li>`);
  }
  return `<h2 class="side-h">Quests and events</h2>
    ${items.length ? `<ul class="side-list">${items.join('')}</ul>` : '<p class="side-none">No quest or events right now.</p>'}`;
}

// The current zone at a glance, with a text version: where you are and what is near. The
// squares are a picture of the Map screen (hidden from screen readers; the text says it all).
// On short screens only the text shows, to leave room for chat.
function viewMinimap() {
  const zone = currentZone(char);
  const { x, y } = char.loc;
  const near = nearbyPlaces(zone);
  const letters = zone.size <= 16;
  const cells = [];
  for (let cy = 1; cy <= zone.size; cy++) {
    for (let cx = 1; cx <= zone.size; cx++) {
      let cls = '';
      let mark = '';
      for (const f of featuresAt(zone, cx, cy)) {
        if (f.type === 'town') { cls = 'town'; mark = 'T'; }
        if (f.type === 'portal') { const locked = char.level < f.minLevel; cls = locked ? 'locked' : 'portal'; mark = locked ? 'X' : 'P'; }
        if (f.type === 'lair') { cls = 'lair'; mark = 'B'; }
      }
      if (cx === x && cy === y) { cls = 'me'; mark = ''; }
      cells.push(`<i${cls ? ` class="${cls}"` : ''}>${letters ? mark : ''}</i>`);
    }
  }
  return `<h2 class="side-h">${esc(zone.name)} <span class="coords">${x}, ${y}</span></h2>
    <div class="minimap${zone.pvp ? ' pvp' : ''}" style="--n:${zone.size}" aria-hidden="true">${cells.join('')}</div>
    <p class="mini-near">${near.length ? near.map(([nm, nx, ny]) => `<b>${esc(nm)}</b> ${directionTo(char, nx, ny)}`).join(', ') : 'Nothing else marked in this zone.'}</p>
    <button class="textbtn" id="mini-open" data-a="tab" data-v="map">Open the map</button>`;
}

// ---------------------------------------------------------------- start screens
function viewBanned() {
  const s = ui.sanctions;
  const when = new Date(s.banned).getFullYear() > 9000 ? 'permanently' : `until ${new Date(s.banned).toLocaleString()}`;
  return `<div class="intro"><h1>ClickMonster</h1></div>
    <div class="notice bad"><p><b>${esc(char.name)} is banned ${when}.</b></p>${s.reason ? `<p class="small">Reason: ${esc(s.reason)}</p>` : ''}
    <p class="small muted" style="margin:0">If you think this is a mistake, contact the game staff.</p></div>
    ${btn('signout', null, 'Sign out', 'block')}`;
}

function viewCreate() {
  const r = RACES[ui.race];
  const bonuses = Object.entries(r.bonus).map(([s, n]) => `+${n} ${STAT_SHORT[s]}`).join(', ');
  return `
    <div class="realm-create">
    <div class="intro realm-head"><p class="realm-kicker">The last step into the realm</p><h1>ClickMonster</h1><p>Who are you?</p></div>
    <label class="field">Name<input id="name" type="text" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Your hero's name" value="${esc(ui.draftName || '')}"${ui.createError ? ' aria-invalid="true" aria-describedby="name-error"' : ''}></label>
    ${ui.createError ? `<p id="name-error" class="field-msg bad" role="alert">${esc(ui.createError)}</p>` : ''}
    <label class="field">Race</label>
    <div class="races">${Object.values(RACES).map((x) =>
      `<button data-a="race" data-v="${x.id}" class="btn ${x.id === ui.race ? 'on' : ''}">${x.name}<small>${affinityLabel(x)}</small></button>`).join('')}</div>
    <div class="race-info">
      <h2>${r.name}</h2>
      <p class="muted" style="margin-top:6px">${r.desc}</p>
      <dl class="kv small">
        <dt>Specialty</dt><dd>${affinityLabel(r)}</dd>
        <dt>Stat bonus</dt><dd>${bonuses}</dd>
        <dt>Starts in</dt><dd>${ZONES[r.startZone].name}</dd>
      </dl>
      <p class="small faint" style="margin:10px 0 0">Every weapon and element has a mastery that grows as you fight. Your race starts ahead in its specialty and can master it furthest. There are no classes: you decide where every point goes.</p>
    </div>
    ${btn('create', null, 'Begin your adventure', 'primary block')}
    </div>`;
}

// ---------------------------------------------------------------- explore
// The town, paths and boss lair of a zone, except where you stand: [name, x, y].
function nearbyPlaces(zone) {
  const { x, y } = char.loc;
  const near = [];
  if (zone.town && !(zone.town.x === x && zone.town.y === y)) near.push([zone.town.name, zone.town.x, zone.town.y]);
  for (const f of zone.features) {
    if (f.x === x && f.y === y) continue;
    if (f.type === 'portal' && zone.id !== 'overworld') near.push([f.label, f.x, f.y]);
    if (f.type === 'lair' && zone.boss) near.push(['Boss lair', f.x, f.y]);
  }
  return near;
}

function viewExplore() {
  const zone = currentZone(char);
  const { x, y } = char.loc;
  const here = featuresAt(zone, x, y);
  const lines = [];
  for (const f of here) {
    if (f.type === 'town') lines.push(`<b>${esc(f.name)}</b>. Safe from attack.`);
    if (f.type === 'portal') lines.push(char.level < f.minLevel
      ? `<b>${esc(f.label)}</b>. <span class="warn">Requires level ${f.minLevel}.</span>`
      : `<b>${esc(f.label)}</b> leads to ${esc(ZONES[f.to].name)}.`);
    if (f.type === 'lair' && zone.boss) lines.push(`A lair. <b>${esc(zone.boss.name)}</b> waits here.`);
  }
  if (!lines.length) lines.push(zone.pvp ? '<span class="warn">Lawless ground. Other players may attack you here.</span>' : 'Open ground.');

  const near = nearbyPlaces(zone);

  const notices = (char.notices || []).length ? `<div class="notice">
      ${char.notices.map((n) => `<p class="small">${esc(n.text)}</p>`).join('')}
      <button class="textbtn" data-a="dismiss">Dismiss</button></div>` : '';

  const playersCount = ui.playersKey === locKey() && ui.players ? ` (${ui.players.length})` : '';
  const q = char.quest;
  const questLine = q ? `<div class="notice quest"><p class="small" style="margin:0"><b>Quest:</b> ${esc(questTitle(q))}. ${timeLeft(q.expiresAt - Date.now())} left.</p></div>` : '';
  const s = ui.sanctions;
  const untilText = (t) => (new Date(t).getFullYear() > 9000 ? 'permanently' : `until ${new Date(t).toLocaleString()}`);
  const jail = s?.jailed ? `<div class="notice bad"><p class="small" style="margin:0"><b>You are in jail ${untilText(s.jailed)}.</b>${s.reason ? ` Reason: ${esc(s.reason)}.` : ''} You can look around but not act.</p></div>` : '';
  const mute = s?.muted ? `<div class="notice"><p class="small" style="margin:0">You are muted ${untilText(s.muted)}.${s.reason ? ` Reason: ${esc(s.reason)}` : ''}</p></div>` : '';
  const ann = ui.announcement && ui.announcement.id > seenAnnouncement() ? `<div class="notice announce">
      <p class="small" style="margin:0 0 4px"><b>Announcement</b></p><p class="small" style="margin:0">${esc(ui.announcement.text)}</p>
      <button class="textbtn" data-a="seenann">Dismiss</button></div>` : '';
  const events = activeEvents().map((e) => `<div class="notice event"><p class="small" style="margin:0">${eventLine(e)}</p></div>`).join('');
  const inSide = layout === 'desktop'; // the side column shows the quest and events instead
  return `
    ${jail}${mute}${ann}${inSide ? '' : events}
    ${notices}
    ${inSide ? '' : questLine}
    <div class="place">
      <div class="place-row"><h2>${esc(zone.name)}</h2><span class="coords">${x}, ${y}</span></div>
      <div class="tags"><span class="tag">Level ${zone.levelRange[0]} to ${zone.levelRange[1]}</span>${zone.pvp ? '<span class="tag pvp">PvP</span>' : ''}</div>
      <p class="here">${lines.join('<br>')}</p>
      ${near.length ? `<div class="nearby">${near.map(([n, nx, ny]) => `<span><b>${esc(n)}</b> ${directionTo(char, nx, ny)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="seg" role="group" aria-label="Show">
      <button data-a="list" data-v="monsters" class="${ui.list === 'monsters' ? 'on' : ''}" aria-pressed="${ui.list === 'monsters'}">Monsters</button>
      <button data-a="list" data-v="players" class="${ui.list === 'players' ? 'on' : ''}" aria-pressed="${ui.list === 'players'}">Players${playersCount}</button>
    </div>
    ${ui.list === 'monsters' ? monsterRows() : playerRows(zone)}`;
}

function huntRows() {
  return ui.hunts.filter((h) => h.zone === char.loc.zone).map((h) => {
    const pctLeft = Math.max(1, Math.round((h.hp / h.max_hp) * 100));
    return `<button class="row hunt" data-a="hunt" data-v="${h.id}">
      <span class="lv ${difficulty(h.level).cls}">Lv ${h.level}</span>
      <span class="nm">${esc(h.name)}<small>World boss, ${pctLeft}% health left, ${timeLeft(new Date(h.ends_at).getTime() - Date.now())} remaining</small></span>
      <span class="go">Join</span></button>`;
  }).join('');
}

function monsterRows() {
  const mons = monstersHere(char);
  const hunts = huntRows();
  if (!mons.length && !hunts) return emptyState('No monsters roam here.', 'Move on to find something to fight.');
  return `<div class="rows">${hunts}${mons.map((m) => {
    const d = difficulty(m.level);
    return `<button class="row ${m.boss ? 'boss' : ''}" data-a="fight" data-v="${m.id}">
      <span class="lv ${d.cls}">Lv ${m.level}</span>
      <span class="nm">${esc(m.name)}<small><span class="${d.cls}">${d.word}</span>${m.boss ? ', boss' : ''}${m.element ? `, ${ELEMENT_LABEL[m.element]}` : ''}</small></span>
      <span class="go">Fight</span>
    </button>`;
  }).join('')}</div>`;
}

function playerRows(zone) {
  const players = ui.playersKey === locKey() ? ui.players : null;
  if (!players) return emptyState('Looking around', '', { loading: true });
  if (!players.length) return emptyState('No other adventurers are here right now.', 'The list refreshes on its own every few seconds.');
  const safe = inTown(char);
  return `<div class="rows">${players.map((p) => {
    const d = difficulty(p.level);
    const canHit = zone.pvp && !safe && p.level >= char.level - PVP_LEVEL_GAP;
    return `<div class="row static">
      <span class="lv ${d.cls}">Lv ${p.level}</span>
      <span class="nm">${esc(p.name)}<small>${RACES[p.race]?.name || ''}</small></span>
      ${btn('whisper', p.name, 'Whisper', 'sm ghost')}
      ${canHit ? btn('attack', p.id, 'Attack', 'sm danger') : ''}
    </div>`;
  }).join('')}</div>`;
}

function dockExplore() {
  const zone = currentZone(char);
  const { x, y } = char.loc;
  const here = featuresAt(zone, x, y);
  const ctx = [];
  for (const f of here) {
    if (f.type === 'town') {
      const cost = healCost(char);
      ctx.push(`<div class="ctx-grid">
        ${btn('shop', null, 'Shop')}
        ${btn('heal', null, cost > 0 ? `Heal <small>${amount(cost, 'gold')}</small>` : 'Heal <small>Full health</small>', '', cost <= 0)}
        ${btn('bank', null, `Bank <small>${amount(char.bank, 'gold saved', true)}</small>`)}
        ${btn('quests', null, char.quest ? 'Quests <small>1 active</small>' : 'Quests')}
      </div>`);
    }
    if (f.type === 'portal') {
      const locked = char.level < f.minLevel;
      ctx.push(btn('portal', null, locked ? `Travel <small>Level ${f.minLevel} needed</small>` : `Travel <small>${esc(ZONES[f.to].name)}</small>`, locked ? '' : 'primary', locked));
    }
  }
  if (!ctx.length && ui.lastMonster && monstersHere(char).some((m) => m.id === ui.lastMonster)) {
    ctx.push(btn('fight', ui.lastMonster, `Fight <small>${esc(MONSTERS[ui.lastMonster].name)}</small>`, 'primary'));
  }
  if (!ctx.length) ctx.push(`<span class="ctx-label">${esc(zone.name)}</span><span class="small muted">Use the arrows or tap the map to travel.</span>`);
  return `<div class="dock-explore ${prefs.leftHanded ? 'left' : ''}">
    <div class="ctx">${ctx.join('')}</div>
    <div class="pad">
      ${btn('move', 'n', 'N', 'n', y <= 1)}
      ${btn('move', 'w', 'W', 'w', x <= 1)}
      ${btn('move', 's', 'S', 's', y >= zone.size)}
      ${btn('move', 'e', 'E', 'e', x >= zone.size)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- battle
// The log, grouped by turn: the lines each of your actions produced (tracked here, since the
// server's log has no turn markers). The current turn stands out; earlier turns step back.
// Without turn marks (after a reload) it falls back to "last few lines bright".
function logHtml(b) {
  const log = b.log;
  const marks = (ui.turnLog?.marks || []).filter((m) => m.start < log.length);
  const line = (l, i, cls) => `<p class="${l.kind} ${cls}${i === log.length - 1 ? ' latest' : ''}">${esc(l.text)}</p>`;
  if (!marks.length) {
    const firstFresh = Math.max(0, log.length - 4);
    return log.map((l, i) => line(l, i, i >= firstFresh ? 'fresh' : 'older')).join('');
  }
  const parts = [log.slice(0, marks[0].start).map((l, i) => line(l, i, 'older')).join('')];
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].start : log.length;
    const current = k === marks.length - 1;
    const gains = current && ui.delta?.mastery?.length && Date.now() - ui.delta.at < DELTA_MS
      ? `<p class="turn-gain">${ui.delta.mastery.map((g) => `${esc(MASTERY_LABEL[g.m])} mastery ${g.to}`).join(', ')}</p>` : '';
    parts.push(`<div class="turn${current ? ' current' : ''}"><p class="turn-label">${m.turn ? `Turn ${m.turn}` : 'This turn'}</p>
      ${log.slice(m.start, end).map((l, j) => line(l, m.start + j, current ? 'fresh' : 'older')).join('')}${gains}</div>`);
  });
  return parts.join('');
}

// How the fight ended, and what it earned or cost, next to the latest line and the next action.
function outcomeHtml(b) {
  if (!b.over) return '';
  const ups = Object.entries(b.masteryUps || {}).map(([m, v]) => `<li>${esc(MASTERY_LABEL[m])} mastery ${v}</li>`).join('');
  if (b.over === 'victory') {
    const r = b.rewards;
    const gem = r?.gem && parseGem(r.gem);
    const pvpGold = b.pvp && (b.log.find((l) => l.kind === 'reward' && /^You take/.test(l.text))?.text);
    const items = r ? [
      `<li class="xp">+${fmt(r.xp)} XP</li>`, `<li class="gold">+${fmt(r.gold)} gold</li>`,
      gem ? `<li>Found ${esc(gem.name)}</li>` : '', r.relic ? `<li class="relic">Found ${esc(r.relic)}</li>` : '',
      r.levels ? `<li class="level">Level ${char.level}!</li>` : '',
    ].join('') : pvpGold ? `<li class="gold">${esc(pvpGold)}</li>` : '';
    return `<div class="outcome win"><p class="outcome-title">Victory</p>${items || ups ? `<ul class="rewards" aria-label="Rewards">${items}${ups}</ul>` : ''}</div>`;
  }
  if (b.over === 'defeat') {
    // The losses: the measured change in the hero, recorded when the defeat happened here.
    // After a reload, what the closing log lines say ("having lost 120 gold and 40 experience";
    // a duel's log names only the gold).
    const tail = b.log.slice(-3).map((l) => l.text).join(' ');
    const seen = ui.losses && ui.losses.first === b.log[0]?.text && ui.losses.length === b.log.length ? ui.losses : null;
    const gold = seen ? seen.gold : Number((tail.match(/lost (\d+) gold|takes (\d+) of your gold/) || []).slice(1).find(Boolean) || 0);
    const xp = seen ? seen.xp : Number((tail.match(/(\d+) experience/) || [])[1] || 0);
    const losses = [gold ? `<li>Lost ${fmt(gold)} gold</li>` : '', xp ? `<li>Lost ${fmt(xp)} XP</li>` : '', /wake up in town/.test(tail) ? '<li>Back in town</li>' : ''].join('');
    return `<div class="outcome loss"><p class="outcome-title">Defeated</p>${losses ? `<ul class="rewards losses" aria-label="Losses">${losses}</ul>` : ''}<p class="outcome-text">Gold in the bank is safe.</p></div>`;
  }
  if (b.over === 'fled') return '<div class="outcome neutral"><p class="outcome-title">You got away</p></div>';
  return '';
}

function viewHuntBattle(b, you) {
  const ended = b.over && b.over !== 'defeat';
  return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
      <div class="side foe" id="fx-foe"><div class="side-name elite-name">${esc(b.name)}</div>
        <div class="side-sub">World boss, level ${b.level}</div>
        ${meter('Shared HP', b.hp, b.maxHp, 'foe big')}</div></div>
    <div class="summary"><span>Your damage: ${fmt(b.myDamage || 0)}</span>${ended ? '' : '<span class="faint">Every hunter shares the reward</span>'}</div>
    <div class="log" id="log" tabindex="0" role="log" aria-label="Battle log" aria-live="off">${logHtml(b)}</div>
    ${b.over === 'defeat' || b.over === 'fled' ? outcomeHtml(b) : ''}`;
}

function viewBattle() {
  const b = char.battle;
  const you = `<div class="side you" id="fx-you"><div class="side-name">${esc(char.name)}</div><div class="side-sub">Lv ${char.level}</div>${meter('HP', char.hp, maxHp(char), 'big')}</div>`;
  if (b.hunt) return viewHuntBattle(b, you);
  if (b.pvp) {
    return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
        <div class="side foe" id="fx-foe"><div class="side-name">${esc(b.opponent)}</div><div class="side-sub">${b.over === 'victory' ? 'Defeated' : 'Victorious'}</div></div></div>
      <div class="log" id="log" tabindex="0" role="log" aria-label="Battle log" aria-live="off">${logHtml(b)}</div>
      ${outcomeHtml(b)}`;
  }
  const mon = monsterCombatant(b.monsterId, b.variant);
  const d = difficulty(mon.level);
  return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
      <div class="side foe" id="fx-foe"><div class="side-name${b.variant ? ' elite-name' : ''}">${esc(mon.name)}</div>
        <div class="side-sub"><span class="${d.cls}">Lv ${mon.level} ${d.word}</span>${mon.element ? `, ${ELEMENT_LABEL[mon.element]}` : ''}</div>
        ${meter('HP', b.hp, b.maxHp, 'foe big')}</div></div>
    <div class="log" id="log" tabindex="0" role="log" aria-label="Battle log" aria-live="off">${logHtml(b)}</div>
    ${outcomeHtml(b)}`;
}

function dockBattle() {
  const b = char.battle;
  if (b.hunt) {
    if (b.over) {
      const live = ui.hunts.some((h) => h.id === b.hunt);
      return `<div class="dock-battle">${live && b.over !== 'victory' ? btn('again', null, 'Attack again', 'big primary wide') : ''}${btn('done', null, 'Continue', live && b.over !== 'victory' ? 'wide flee ghost' : 'big primary wide')}</div>`;
    }
    const boss = huntCombatant({ name: b.name, level: b.level }, char.level);
    const p = playerCombatant(char);
    const wName = p.melee.type === 'fists' ? 'Fists' : WEAPON_TYPES[p.melee.type].label;
    return `<div class="dock-battle">
      ${btn('melee', null, `Melee<small>${wName}, ${pct(meleeChance(p, boss))} hit</small>`, 'big primary')}
      ${btn('cast', null, `Cast<small>${ELEMENT_LABEL[p.spell.element]}, ${pct(spellChance(p, boss))} cast</small>`, 'big')}
      ${btn('flee', null, 'Fall back', 'wide flee ghost')}
    </div>`;
  }
  if (!b.over) {
    const mon = monsterCombatant(b.monsterId, b.variant);
    const p = playerCombatant(char);
    const wName = p.melee.type === 'fists' ? 'Fists' : WEAPON_TYPES[p.melee.type].label;
    return `<div class="dock-battle">
      ${btn('melee', null, `Melee<small>${wName}, ${pct(meleeChance(p, mon))} hit, about ${fmt(meleeBase(p))}</small>`, 'big primary')}
      ${btn('cast', null, `Cast<small>${ELEMENT_LABEL[p.spell.element]}, ${pct(spellChance(p, mon))} cast, about ${fmt(spellBase(p))}</small>`, 'big')}
      ${btn('flee', null, 'Flee', 'wide flee ghost')}
    </div>`;
  }
  if (b.over === 'victory' && !b.pvp) {
    const stillHere = monstersHere(char).some((m) => m.id === b.monsterId);
    return `<div class="dock-battle">
      ${btn('again', null, stillHere ? 'Fight again' : 'Fight again<small>None left here</small>', 'big primary wide', !stillHere)}
      ${btn('done', null, 'Continue', 'wide flee ghost')}
    </div>`;
  }
  return `<div class="dock-battle">${btn('done', null, 'Continue', 'big primary wide')}</div>`;
}

// ---------------------------------------------------------------- hero
function levelChooser() {
  return `<div class="choose">
    ${STATS.map((s) => btn('level', s, `+${POINTS_PER_LEVEL} ${STAT_SHORT[s]}<small>${char.stats[s]} to ${char.stats[s] + POINTS_PER_LEVEL}</small>`)).join('')}
    ${btn('level', 'all', `+${POINTS_PER_LEVEL / STATS.length} to every stat`, 'all')}
  </div>`;
}

function viewHero() {
  const race = RACES[char.race];
  const stats = totalStats(char);
  const bonus = gemBonuses(char);
  const p = playerCombatant(char);
  return `
    ${char.pendingLevels ? `<h3 style="margin-top:0">Level up: ${char.pendingLevels} to spend</h3>
      <p class="small muted">Put all ${POINTS_PER_LEVEL} points into one stat, or ${POINTS_PER_LEVEL / STATS.length} into every stat.</p>
      ${levelChooser()}` : ''}
    <h3${char.pendingLevels ? '' : ' style="margin-top:0"'}>${esc(char.name)}, level ${char.level} ${race.name}</h3>
    <div class="tags"><span class="tag prof">Specialty: ${affinityLabel(race)}</span></div>
    ${STATS.map((s) => `<div class="statrow"><span>${STAT_LABEL[s]}</span>
      <span class="v">${fmt(stats[s])}${bonus[s] ? ` <small>+${bonus[s]} gems</small>` : ''}</span>
      <span class="d">${STAT_DESC[s]}</span></div>`).join('')}
    <h3>Masteries</h3>
    <p class="small muted">Masteries grow as you land hits (armor grows as you take them) and raise your damage, accuracy and critical chance. Your race sets each cap.</p>
    <div class="masteries">${MASTERIES.map((m) => {
      const v = char.masteries?.[m] ?? 0;
      const cap = masteryCap(char.race, m);
      return `<div class="mastery"><div class="meter-label"><span>${MASTERY_LABEL[m]}</span><b>${v} / ${cap}</b></div>
        <div class="meter-track"><i style="width:${Math.min(100, (v / cap) * 100)}%"></i></div></div>`;
    }).join('')}</div>
    <h3>Combat</h3>
    <dl class="kv">
      <dt>Max health</dt><dd>${fmt(maxHp(char))}</dd>
      <dt>Armor</dt><dd>${fmt(totalArmor(char))}</dd>
      <dt>Melee damage</dt><dd>about ${fmt(meleeBase(p))}</dd>
      <dt>Spell damage</dt><dd>about ${fmt(spellBase(p))} ${ELEMENT_LABEL[p.spell.element]}</dd>
      <dt>Experience</dt><dd>${fmt(char.xp)} / ${fmt(xpToNext(char.level))}</dd>
      <dt>Gold carried</dt><dd>${fmt(char.gold)}</dd>
      <dt>Gold in bank</dt><dd>${fmt(char.bank || 0)}</dd>
      <dt>Quests completed</dt><dd>${fmt(char.questsDone || 0)}</dd>
      <dt>Monsters slain</dt><dd>${fmt(char.kills)}</dd>
      <dt>Duels won</dt><dd>${fmt(char.pvpWins || 0)}</dd>
      <dt>Defeats</dt><dd>${fmt(char.deaths)}</dd>
    </dl>
    <h3>Settings</h3>
    <div class="rows settings">
      <button class="row" data-a="pref" data-v="leftHanded"><span class="nm">Left-handed controls<small>Moves the arrow pad to the left side</small></span><span class="go">${prefs.leftHanded ? 'On' : 'Off'}</span></button>
      <button class="row" data-a="pref" data-v="vibrate"><span class="nm">Vibration<small>Buzz when you take a hit (Android)</small></span><span class="go">${prefs.vibrate ? 'On' : 'Off'}</span></button>${layout === 'desktop' ? `
      <button class="row" data-a="pref" data-v="keys"><span class="nm">Keyboard shortcuts<small>Number and letter keys for screens and battle actions</small></span><span class="go">${prefs.keys ? 'On' : 'Off'}</span></button>
      <button class="row" data-a="keys"><span class="nm">Show keyboard shortcuts<small>Or press ? while playing</small></span><span class="go">Show</span></button>` : ''}
    </div>
    <h3>Account</h3>
    <p class="small muted">Signed in as ${esc(session?.user?.email || '')}. Your hero is saved online.</p>
    <div class="choose" style="grid-template-columns:1fr 1fr">${btn('signout', null, 'Sign out')}${btn('delete', null, 'Delete hero', 'danger')}</div>`;
}

// ---------------------------------------------------------------- gear
function itemRow(item) {
  const base = itemDef(item);
  return `<button class="row item" data-a="item" data-v="${item.uid}">
    <span class="slot">${SLOT_LABEL[base.slot]}</span>
    <span class="nm${base.quality ? ' relic' : ''}">${esc(base.name)}<small>${itemSummary(base)}${base.sockets ? `, ${item.gems.length}/${base.sockets} sockets` : ''}</small></span>
    <span class="sc"><b>${base.score}</b>Class ${tierRoman(base.tier)}</span>
  </button>`;
}

function viewGear() {
  const equipped = SLOTS.map((slot) => {
    const item = equippedItem(char, slot);
    return item ? itemRow(item)
      : `<div class="row item static"><span class="slot">${SLOT_LABEL[slot]}</span><span class="nm faint">Empty</span></div>`;
  }).join('');
  const pack = char.inventory.filter((i) => !isEquipped(char, i.uid))
    .sort((a, b) => SLOTS.indexOf(itemDef(a).slot) - SLOTS.indexOf(itemDef(b).slot) || itemDef(b).score - itemDef(a).score);
  const gems = Object.entries(char.gems).filter(([, n]) => n > 0)
    .map(([k, n]) => ({ ...parseGem(k), n })).filter((g) => g.name)
    .sort((a, b) => b.tier - a.tier || a.type.localeCompare(b.type));
  return `
    <h3 style="margin-top:0">Equipped</h3>
    <div class="rows">${equipped}</div>
    <h3>Pack (${pack.length})</h3>
    ${pack.length ? `<div class="rows">${pack.map((i) => itemRow(i)).join('')}</div>` : emptyState('Your pack is empty.', 'Town shops sell gear, and monsters sometimes drop it.')}
    <h3>Gems</h3>
    ${gems.length ? `<div class="rows">${gems.map((g) => `<div class="row static"><span class="nm">${gemText(g.key)}</span><span class="go">x${g.n}</span></div>`).join('')}</div>`
      : emptyState('No gems yet.', 'Monsters sometimes drop gems, and bosses always do. Socket them into gear for stat bonuses.')}`;
}

// ---------------------------------------------------------------- map
function viewMap() {
  const zone = currentZone(char);
  // One square is in the tab order (roving focus): the last one focused, else where you stand.
  const [cx, cy] = (ui.mapCursor && ui.mapCursor.zone === zone.id ? [ui.mapCursor.x, ui.mapCursor.y] : [char.loc.x, char.loc.y]);
  const cells = [];
  for (let y = 1; y <= zone.size; y++) {
    for (let x = 1; x <= zone.size; x++) {
      let cls = '';
      let label = '';
      const says = [];
      for (const f of featuresAt(zone, x, y)) {
        if (f.type === 'town') { cls = 'town'; label = 'T'; says.push(`Town: ${f.name}`); }
        if (f.type === 'portal') {
          const locked = char.level < f.minLevel;
          cls = locked ? 'locked' : 'portal'; label = locked ? 'X' : 'P';
          says.push(`${f.label}${locked ? `, requires level ${f.minLevel}` : ''}`);
        }
        if (f.type === 'lair') { cls = 'lair'; label = 'B'; says.push(`Boss lair${zone.boss ? `: ${zone.boss.name}` : ''}`); }
      }
      const here = x === char.loc.x && y === char.loc.y;
      if (here) { cls += ' me'; label = 'You'; says.unshift('You are here'); }
      const name = `${says.length ? `${says.join('. ')}. ` : ''}Square ${x}, ${y}${here ? '' : '. Walk here'}`;
      const tab = x === cx && y === cy ? '0' : '-1';
      cells.push(`<button class="${cls}" data-a="walk" data-v="${x},${y}" tabindex="${tab}" aria-label="${esc(name)}"${here ? ' aria-current="location"' : ''}>${label}</button>`);
    }
  }
  // Places worth walking to, nearest first.
  const dist = (f) => Math.abs(f.x - char.loc.x) + Math.abs(f.y - char.loc.y);
  const places = [];
  if (zone.town) places.push({ x: zone.town.x, y: zone.town.y, name: zone.town.name, sub: 'Town: shop, healer, bank and quests' });
  for (const f of zone.features) {
    if (f.type === 'lair' && zone.boss) places.push({ x: f.x, y: f.y, name: 'Boss lair', sub: `${zone.boss.name}, level ${zone.boss.level}` });
    if (f.type === 'portal') {
      const z = ZONES[f.to];
      const locked = char.level < f.minLevel;
      places.push({ x: f.x, y: f.y, name: zone.id === 'overworld' ? z.name : f.label, sub: `Level ${z.levelRange[0]} to ${z.levelRange[1]}${z.pvp ? ', PvP' : ''}${locked ? `, requires level ${f.minLevel}` : ''}` });
    }
  }
  places.sort((a, b) => dist(a) - dist(b));
  const placeRows = places.map((p) => {
    const here = p.x === char.loc.x && p.y === char.loc.y;
    return `<button class="row${here ? ' static' : ''}" data-a="walkto" data-v="${p.x},${p.y}"${here ? ' aria-disabled="true"' : ''}>
      <span class="lv num">${p.x}, ${p.y}</span>
      <span class="nm">${esc(p.name)}<small>${esc(p.sub)}</small></span>
      <span class="go">${here ? 'Here' : esc(directionTo(char, p.x, p.y))}</span></button>`;
  });
  return `
    <div class="place-row"><h2>${esc(zone.name)}</h2><span class="coords">${char.loc.x}, ${char.loc.y}</span></div>
    <p class="small muted" style="margin-top:6px">${esc(zone.desc)}</p>
    <div class="map-tools" id="map-tools" hidden><span class="small muted">${zone.size} by ${zone.size}. Drag to look around.</span>${btn('mapcenter', null, 'Center on me', 'sm')}</div>
    <div class="map-scroll" id="map-scroll">
      <div class="map ${zone.pvp ? 'pvp' : ''}" id="map" role="group" aria-label="Map of ${esc(zone.name)}, ${zone.size} by ${zone.size} squares" aria-describedby="map-help" style="--n:${zone.size}">${cells.join('')}</div>
    </div>
    <div class="legend"><span><b>T</b> Town</span><span><b>P</b> Path</span><span><b>X</b> Locked path</span><span><b>B</b> Boss</span><span id="map-help">Tap a square to walk there. With a keyboard, arrow keys move between squares and Enter walks.</span></div>
    ${placeRows.length ? `<h3>Places</h3><div class="rows">${placeRows.join('')}</div>` : ''}`;
}

// Any map wider or taller than its space scrolls inside its own frame (whatever the zone size and
// screen); the frame and the Center on me button only appear when it does.
function syncMapFrame() {
  const box = $('#map-scroll');
  if (!box) return;
  const map = box.firstElementChild;
  const over = map.offsetWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
  box.classList.toggle('scrolls', over);
  const tools = $('#map-tools');
  if (tools) tools.hidden = !over;
}
window.addEventListener('resize', () => { if ($('#map-scroll')) { syncMapFrame(); if (char) centerMap(char.loc.x, char.loc.y); } });

// Scroll the map so a square sits in the middle of the visible area (the map scrolls on its own,
// the rest of the screen stays put).
function centerMap(x, y) {
  const box = $('#map-scroll');
  const cell = box && box.querySelector(`[data-a="walk"][data-v="${x},${y}"]`);
  if (!cell) return;
  const b = box.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  box.scrollLeft += c.left - b.left - (box.clientWidth - c.width) / 2;
  box.scrollTop += c.top - b.top - (box.clientHeight - c.height) / 2;
  // On short screens the frame can be taller than the visible part of the screen area:
  // scroll that too, just enough to show the square.
  const main = $('#main').getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  if (r.bottom > main.bottom - 8) $('#main').scrollTop += r.bottom - main.bottom + 8;
  else if (r.top < main.top + 8) $('#main').scrollTop -= main.top + 8 - r.top;
}

// ---------------------------------------------------------------- sheets
function sheetItem(uid) {
  const item = findItem(char, uid);
  if (!item) return '';
  const base = itemDef(item);
  const equipped = isEquipped(char, uid);
  const town = inTown(char);
  const req = meetsRequirements(char, item);
  const free = base.sockets - item.gems.length;
  const gemKeys = Object.keys(char.gems).filter((k) => char.gems[k] > 0 && parseGem(k));
  let trait = '';
  if (base.slot === 'weapon') trait = WEAPON_TYPES[base.type].perk;
  if (base.slot === 'focus') trait = `Casts ${ELEMENT_LABEL[base.element]} spells`;

  const sockets = [];
  for (let i = 0; i < base.sockets; i++) {
    const g = item.gems[i] && parseGem(item.gems[i]);
    sockets.push(`<div class="row static"><span class="nm">${g ? gemText(g.key) : '<span class="faint">Empty socket</span>'}</span>
      ${g && town ? btn('extract', i, `Extract, ${extractCost(g.tier)} gold`, 'sm', char.gold < extractCost(g.tier)) : ''}</div>`);
  }
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">${esc(base.name)}</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small muted">${SLOT_LABEL[base.slot]}, Class ${tierRoman(base.tier)}, score ${base.score}${base.quality ? ', <span class="gem-topaz">rare relic</span>' : ''}${masteryNote(base) ? `, ${masteryNote(base)}` : ''}</p>
    <dl class="kv">
      <dt>${base.armor != null ? 'Armor' : 'Power'}</dt><dd>${base.armor ?? base.power}</dd>
      ${trait ? `<dt>Trait</dt><dd>${trait}</dd>` : ''}
      <dt>Requirements</dt><dd>${reqHtml(item)}</dd>
    </dl>
    ${base.sockets ? `<h3>Sockets</h3><div class="rows">${sockets.join('')}</div>` : ''}
    ${free > 0 && gemKeys.length ? `<h3>Socket a gem</h3><div class="chips" style="flex-wrap:wrap">${gemKeys.map((k) =>
      `<button class="chip" data-a="socket" data-v="${k}">${gemText(k)} (x${char.gems[k]})</button>`).join('')}</div>
      <p class="small faint">A town jeweler can extract socketed gems later for a fee.</p>` : ''}
    <div class="choose" style="grid-template-columns:1fr 1fr;margin-top:16px">
      ${equipped ? btn('unequip', base.slot, 'Unequip') : btn('equip', uid, req.ok ? 'Equip' : 'Requirements not met', 'primary', !req.ok)}
      ${town ? btn('sell', uid, equipped ? 'Unequip to sell' : `Sell for ${fmt(sellPrice(item))} gold`, 'danger', equipped) : btn('noop', null, 'Sell in a town', '', true)}
    </div>
    ${item.gems.length && !equipped && town ? '<p class="small warn" style="margin-top:8px">Selling destroys socketed gems.</p>' : ''}
  </div>`;
}

function sheetShop() {
  if (!inTown(char)) return '';
  const zone = currentZone(char);
  const stock = shopItems(char);
  const slots = SLOTS.filter((s) => stock.some((id) => ITEMS[id].slot === s));
  if (!slots.includes(ui.shopSlot)) ui.shopSlot = slots[0];
  let items = stock.filter((id) => ITEMS[id].slot === ui.shopSlot);
  if (ui.usableOnly) items = items.filter((id) => meetsRequirements(char, id).ok);
  items.sort((a, b) => ITEMS[a].tier - ITEMS[b].tier || ITEMS[a].name.localeCompare(ITEMS[b].name));
  const current = equippedItem(char, ui.shopSlot);
  const curScore = current ? itemDef(current).score : 0;
  const wares = items.map((id) => {
    const base = ITEMS[id];
    const ok = meetsRequirements(char, id).ok;
    const diff = base.score - curScore;
    const cmp = diff > 0 ? `<span class="up">${diff} better</span>` : diff < 0 ? `<span class="down">${-diff} worse</span>` : 'same as equipped';
    const poor = char.gold < base.price;
    return `<div class="ware">
      <div class="ware-top"><b>${esc(base.name)}</b><span class="small muted">Class ${tierRoman(base.tier)}</span></div>
      <div class="meta">${itemSummary(base)}, ${base.sockets} sockets${masteryNote(base) ? `, ${masteryNote(base)}` : ''}<br>
        Score ${base.score}, ${cmp}. ${reqHtml(id)}</div>
      <div class="acts"><span class="price">${fmt(base.price)} gold</span>
        ${btn('buy', id, 'Buy', 'sm', poor)}
        ${ok ? btn('buyequip', id, 'Buy and equip', 'sm primary', poor) : ''}</div>
    </div>`;
  }).join('');
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">${esc(zone.town.name)} Shop</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small muted">You have <span class="gold">${fmt(char.gold)} gold</span>.</p>
    <div class="chips" role="group" aria-label="Item type">
      ${slots.map((s) => `<button class="chip ${s === ui.shopSlot ? 'on' : ''}" data-a="shopslot" data-v="${s}" aria-pressed="${s === ui.shopSlot}">${SLOT_LABEL[s]}</button>`).join('')}
      <button class="chip ${ui.usableOnly ? 'on' : ''}" data-a="usable" aria-pressed="${ui.usableOnly}">Usable only</button>
    </div>
    ${wares || emptyState('Nothing here you can use yet.', 'Try another slot, or turn off Usable only.')}
  </div>`;
}

function sheetLevel() {
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">Level ${char.level}!</h2>${btn('later', null, 'Later', 'sm ghost')}</div>
    <p class="muted">You have ${char.pendingLevels} level${char.pendingLevels > 1 ? 's' : ''} to spend. Put all ${POINTS_PER_LEVEL} points into one stat, or ${POINTS_PER_LEVEL / STATS.length} into every stat.</p>
    ${levelChooser()}
  </div>`;
}

function sheetBank() {
  if (!inTown(char)) return '';
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">Bank</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="muted small">Gold in the bank is safe. If you die or lose a duel, you lose everything you carry.</p>
    <dl class="kv" style="margin:12px 0">
      <dt>Carried</dt><dd class="gold">${fmt(char.gold)} gold</dd>
      <dt>In the bank</dt><dd>${fmt(char.bank || 0)} gold</dd>
    </dl>
    <div class="choose" style="grid-template-columns:1fr 1fr">
      ${btn('deposit', 'all', 'Deposit all', 'primary', char.gold <= 0)}
      ${btn('withdraw', 'all', 'Withdraw all', '', !(char.bank > 0))}
    </div>
    <label class="field">Amount<input id="amount" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Gold"${ui.bankError ? ' aria-invalid="true" aria-describedby="amount-error"' : ''}></label>
    ${ui.bankError ? `<p id="amount-error" class="field-msg bad" role="alert">${esc(ui.bankError)}</p>` : ''}
    <div class="choose" style="grid-template-columns:1fr 1fr;margin-top:8px">
      ${btn('deposit', 'amount', 'Deposit')}
      ${btn('withdraw', 'amount', 'Withdraw')}
    </div>
  </div>`;
}

function sheetQuests() {
  const now = Date.now();
  const q = char.quest;
  const active = q ? `<div class="notice quest">
      <p style="margin:0 0 4px"><b>Your quest</b></p>
      <p class="small" style="margin:0">${esc(questTitle(q))}.</p>
      <p class="small muted" style="margin:4px 0">Reward: ${rewardText(q.reward)}. ${timeLeft(q.expiresAt - now)} left.</p>
      <p class="small faint" style="margin:0 0 6px">${esc(VARIANTS[q.variant].name)} creatures appear more often for you in ${esc(ZONES[q.zone].name)} while you hold this quest.</p>
      <button class="textbtn" data-a="abandon">Abandon quest</button>
    </div>` : '';
  const cooldown = !q && (char.questCooldownUntil || 0) > now
    ? `<p class="small muted">You can take another quest in ${timeLeft(char.questCooldownUntil - now)}.</p>` : '';
  const board = ui.questBoard;
  const list = !board ? emptyState('Reading the board', '', { loading: true })
    : !board.length ? emptyState('The board is empty.', 'New quests are posted every hour.')
    : `<div class="rows">${[...board].sort((x, y) => (canAccept(char, y, now).ok - canAccept(char, x, now).ok) || (x.minLevel - y.minLevel)).map((b) => {
      const mine = q && q.id === b.id;
      const check = canAccept(char, b, now);
      const status = b.completedBy ? `<span class="small muted">Claimed by ${esc(b.completedBy)}</span>`
        : b.expiresAt <= now ? '<span class="small faint">Expired</span>'
        : mine ? '<span class="small good">Yours</span>'
        : check.ok ? btn('accept', b.id, 'Accept', 'sm primary') : '';
      return `<div class="row static quest-row">
        <span class="nm">${esc(questTitle(b))}<small>${rewardText(b.reward)}${b.expiresAt > now && !b.completedBy ? `. ${timeLeft(b.expiresAt - now)} left` : ''}${!check.ok && !b.completedBy && !mine && b.expiresAt > now ? `. ${esc(check.reason)}` : ''}</small></span>
        ${status}
      </div>`;
    }).join('')}</div>`;
  const news = ui.news?.length ? `<h3>News</h3><div class="news">${ui.news.map((e) =>
    `<p class="small"><span class="faint">${timeLeft(now - new Date(e.created_at).getTime())} ago</span> ${esc(e.text)}</p>`).join('')}</div>` : '';
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">Quest board</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small muted">New quests are posted every hour and last three hours. The first adventurer to finish one claims the reward.</p>
    ${active}${cooldown}${list}${news}
  </div>`;
}

async function loadBoard() {
  const g = gameGen;
  try {
    const [res, news] = await Promise.all([api('quests'), recentEvents().catch(() => [])]);
    if (!live(g)) return;
    ui.questBoard = res.quests;
    ui.news = news;
  } catch (err) {
    if (!live(g)) return;
    toast(err.message, 'bad');
  }
  render();
}

function viewSheet() {
  if (!char || ui.phase !== 'game') return '';
  if (ui.sheet?.type === 'item') return sheetItem(ui.sheet.uid);
  if (ui.sheet?.type === 'shop') return sheetShop();
  if (ui.sheet?.type === 'bank') return sheetBank();
  if (ui.sheet?.type === 'quests') return sheetQuests();
  if (ui.sheet?.type === 'keys') return sheetKeys();
  if (char.pendingLevels > ui.levelSheetSnoozed && !fighting() && ui.tab !== 'hero') return sheetLevel();
  return '';
}

// ---------------------------------------------------------------- render
// A stable selector for a control, so focus can move to its replacement after a re-render.
function focusKey(el) {
  if (!el || el === document.body || !el.closest) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const { a, c, v } = el.dataset;
  const vSel = v != null ? `[data-v="${CSS.escape(v)}"]` : ':not([data-v])';
  if (a) return `[data-a="${CSS.escape(a)}"]${vSel}`;
  if (c) return `[data-c="${CSS.escape(c)}"]${vSel}`;
  return null;
}

const isUsable = (el) => !!el && el.isConnected && !el.disabled && el.getClientRects().length > 0;

const painted = {};
let focusLost = false;
function paint(id, html) {
  if (painted[id] === html) return false;
  painted[id] = html;
  const root = document.getElementById(id);
  const active = document.activeElement;
  const hadFocus = active && active !== root && root.contains(active);
  const key = hadFocus ? focusKey(active) : null;
  const caret = hadFocus && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  root.innerHTML = html;
  if (hadFocus) {
    const next = key && root.querySelector(key);
    if (isUsable(next)) {
      next.focus({ preventScroll: true });
      if (caret && 'setSelectionRange' in next) { try { next.setSelectionRange(...caret); } catch { /* not a text field */ } }
    } else {
      focusLost = true;
    }
  }
  return true;
}

// Where focus goes when the control it was on no longer exists.
function focusFallback() {
  const target = (char?.battle && !char.battle.over && $('[data-a="melee"]'))
    || (char?.battle?.over && $('[data-a="again"]:not([disabled]), [data-a="done"]'))
    || $('#screen-title')
    || $('#main button, #main input');
  target?.focus({ preventScroll: true });
}

// ---- Bottom sheet: a native modal <dialog> (focus containment, Escape, inert background).
const sheetDlg = document.getElementById('sheet');
let sheetOpener = null;

function restoreFocus(opener) {
  if (opener && isUsable(opener.el)) { opener.el.focus({ preventScroll: true }); return; }
  const again = opener?.key && document.querySelector(opener.key);
  if (isUsable(again)) { again.focus({ preventScroll: true }); return; }
  focusFallback();
}

function syncSheet(html) {
  if (html && !sheetDlg.open) {
    const el = document.activeElement;
    sheetOpener = { el, key: focusKey(el) };
    paint('sheet-body', html);
    sheetDlg.showModal();
    (sheetDlg.querySelector('[data-autofocus]') || sheetDlg.querySelector('#sheet-title'))?.focus();
  } else if (html) {
    paint('sheet-body', html);
  } else if (sheetDlg.open) {
    sheetDlg.close();
    painted['sheet-body'] = '';
    document.getElementById('sheet-body').innerHTML = '';
    restoreFocus(sheetOpener);
    sheetOpener = null;
  }
}

function dismissSheet() {
  if (ui.sheet) ui.sheet = null;
  else if (char) ui.levelSheetSnoozed = char.pendingLevels;
}
sheetDlg.addEventListener('cancel', (e) => { e.preventDefault(); dismissSheet(); render(); });

function screenTitle() {
  if (char && ui.sanctions?.banned) return 'Banned';
  if (!char) return 'Create your hero';
  if (ui.tab === 'hero') return 'Hero';
  if (ui.tab === 'gear') return 'Gear';
  if (ui.tab === 'map') return `Map of ${currentZone(char)?.name || 'the world'}`;
  if (char.battle) return char.battle.hunt ? `Hunt: ${char.battle.name}` : 'Battle';
  return `Explore ${currentZone(char)?.name || ''}`;
}

let lastView = null;
function render() {
  let main;
  let dock = '';
  let fill = false;
  if (ui.phase !== 'game') main = '';
  else if (char && ui.sanctions?.banned) main = viewBanned();
  else if (!char) main = viewCreate();
  else if (ui.tab === 'hero') main = viewHero();
  else if (ui.tab === 'gear') main = viewGear();
  else if (ui.tab === 'map') main = viewMap();
  else if (char.battle) { main = viewBattle(); dock = dockBattle(); fill = true; }
  else { main = viewExplore(); dock = dockExplore(); }

  const mainEl = $('#main');
  mainEl.classList.toggle('fill', fill);
  const mapBox = $('#map-scroll');
  const mapScroll = mapBox && [mapBox.scrollLeft, mapBox.scrollTop];
  focusLost = false;
  const changed = paint('main', ui.phase === 'game' ? `<h1 class="sr-only" id="screen-title" tabindex="-1">${esc(screenTitle())}</h1>${main}` : '');
  document.body.classList.toggle('creating', ui.phase === 'game' && !char); // hero creation keeps the entrance's backdrop
  const inGame = ui.phase === 'game' && !!char && !ui.sanctions?.banned;
  paint('top', inGame ? viewTop() : '');
  paint('dock', inGame ? dock : '');
  paint('nav', inGame ? viewNav() : '');
  const side = inGame && layout === 'desktop';
  paint('summary', side ? viewSummary() : '');
  paint('minimap', side ? viewMinimap() : '');
  chat.setVisible(inGame);
  if (focusLost && !sheetDlg.open) focusFallback();
  syncSheet(viewSheet());
  renderAlerts(); // also re-homes the toast if a dialog just closed
  positionToast();
  markPending();
  markShortcuts();

  const viewKey = `${ui.phase}:${!!char}:${ui.tab}:${!!char?.battle}`;
  const viewChanged = viewKey !== lastView;
  if (viewChanged) { mainEl.scrollTop = 0; lastView = viewKey; }
  // The map keeps where you panned it, and recentres when you arrive or move.
  const box = $('#map-scroll');
  if (box) {
    syncMapFrame();
    const mapKey = locKey();
    if (viewChanged || mapKey !== ui.mapKey || !mapScroll) { ui.mapKey = mapKey; centerMap(char.loc.x, char.loc.y); }
    else if (box !== mapBox) [box.scrollLeft, box.scrollTop] = mapScroll;
  }
  const log = $('#log');
  if (log && changed) log.scrollTop = log.scrollHeight;
}

// After an action: turn boundaries for the battle log, and the gold, XP and mastery changes.
function trackChanges(action, before) {
  const b = char?.battle;
  if (!b || ['fight', 'again', 'hunt', 'attack'].includes(action)) ui.turnLog = { marks: [] };
  if (b && before && ['melee', 'cast', 'flee'].includes(action) && b.log.length > before.battleLog) {
    ui.turnLog ||= { marks: [] }; // e.g. a fight resumed after reloading the page
    ui.turnLog.marks.push({ start: before.battleLog, turn: b.turn });
  }
  if (!char || !before) return;
  // A defeat's real cost, from the hero before and after (a duel's log names the gold but not
  // the experience). Kept with the battle it belongs to.
  if (b?.over === 'defeat' && ['melee', 'cast', 'flee', 'attack'].includes(action)) {
    ui.losses = {
      first: b.log[0]?.text, length: b.log.length,
      gold: Math.max(0, before.gold - char.gold),
      xp: char.level === before.level ? Math.max(0, before.xp - char.xp) : 0,
    };
  }
  const gold = char.gold - before.gold;
  // XP gained: across a level-up the bar restarts, so take the reward when there is one.
  const xp = char.level > before.level ? (b?.rewards?.xp || 0) : char.xp - before.xp;
  const mastery = Object.keys(char.masteries || {}).filter((m) => (char.masteries[m] || 0) > (before.masteries[m] || 0)).map((m) => ({ m, to: char.masteries[m] }));
  if (!gold && !xp && !mastery.length) return;
  ui.delta = { gold, xp: Math.max(0, xp), mastery, at: Date.now() };
  clearTimeout(ui.deltaTimer);
  ui.deltaTimer = setTimeout(render, DELTA_MS + 50);
}

// ---------------------------------------------------------------- interaction states
// One pending pattern: the pressed control gets .pending and aria-busy, and #app gets data-busy.
function markPending() {
  for (const old of document.querySelectorAll('.pending[aria-busy]')) { old.classList.remove('pending'); old.removeAttribute('aria-busy'); }
  const app = document.getElementById('app');
  if (ui.busy) app.dataset.busy = ''; else delete app.dataset.busy;
  if (!ui.busy || !ui.pendingKey) return;
  const el = document.querySelector(ui.pendingKey);
  if (el) { el.classList.add('pending'); el.setAttribute('aria-busy', 'true'); }
}

// A tap that was not acted on: nudge the control and say why (politely, via the toast).
function refuse(el, why) {
  retrigger(el, 'refused');
  setTimeout(() => el.classList.remove('refused'), 400);
  buzz(15);
  toast(why, 'info');
}

// ---------------------------------------------------------------- battle feedback
function floatText(sideId, text, cls) {
  const side = document.getElementById(sideId);
  if (!side) return;
  const el = document.createElement('span');
  el.className = `float ${cls}`;
  el.setAttribute('aria-hidden', 'true'); // decorative: the battle log and announcements carry the same news
  el.textContent = text;
  side.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function retrigger(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
}

function buzz(pattern) {
  if (prefs.vibrate && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* not supported */ }
  }
}

// Turn new battle-log lines into floating numbers, shakes and buzzes.
// Polite announcements for screen readers (the visible battle log itself is not live,
// so lines are read once, as they happen).
function announce(text) {
  const el = document.getElementById('sr-status');
  if (!el || !text) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

function playEffects(entries) {
  announce(entries.map((e) => e.text).join(' '));
  let delay = 0;
  for (const e of entries) {
    const dmg = Number((e.text.match(/for (\d+)/) || [])[1] || 0);
    const crit = /^Critical|^A savage/.test(e.text);
    const fx = () => {
      if (e.kind === 'player') floatText('fx-foe', crit ? `${dmg}!` : `${dmg}`, crit ? 'crit' : 'dmg-foe');
      else if (e.kind === 'monster') {
        floatText('fx-you', `-${dmg}`, crit ? 'crit' : 'dmg-you');
        retrigger($('#versus'), 'shake');
        buzz(crit ? [40, 40, 60] : 30);
      } else if (e.kind === 'miss') {
        floatText(/^You|^Your/.test(e.text) ? 'fx-foe' : 'fx-you', 'Miss', 'miss');
      } else if (e.kind === 'win') {
        retrigger($('#versus'), 'flash');
      }
    };
    setTimeout(fx, delay);
    if (e.kind === 'player' || e.kind === 'monster' || e.kind === 'miss') delay += 260;
  }
}

// ---------------------------------------------------------------- actions
const BATTLE_ACTIONS = new Set(['melee', 'cast', 'flee', 'again', 'fight', 'attack', 'hunt']);

// Actions that only change what's on screen.
function handleLocal(a, v) {
  switch (a) {
    case 'race': ui.draftName = $('#name')?.value || ''; ui.race = v; return true;
    case 'tab': ui.tab = v; ui.sheet = null; if (v === 'explore') refreshPlayers(); return true;
    case 'list': ui.list = v; refreshPlayers(); return true;
    case 'mapcenter': {
      ui.mapCursor = null;
      requestAnimationFrame(() => { centerMap(char.loc.x, char.loc.y); $('.map [aria-current="location"]')?.focus({ preventScroll: true }); });
      return true;
    }
    case 'shop': ui.sheet = { type: 'shop' }; return true;
    case 'bank': ui.sheet = { type: 'bank' }; return true;
    case 'quests': ui.sheet = { type: 'quests' }; ui.questBoard = null; loadBoard(); return true;
    case 'shopslot': ui.shopSlot = v; return true;
    case 'usable': ui.usableOnly = !ui.usableOnly; return true;
    case 'item': ui.sheet = { type: 'item', uid: Number(v) }; return true;
    case 'close': ui.sheet = null; return true;
    case 'keys': ui.sheet = { type: 'keys' }; return true;
    case 'later': ui.levelSheetSnoozed = char.pendingLevels; return true;
    case 'pref': prefs[v] = !prefs[v]; savePrefs(); if (v === 'vibrate' && prefs.vibrate) buzz(30); return true;
    case 'noop': return true;
    case 'dismissError': {
      ui.errors = ui.errors.filter((e) => String(e.id) !== v);
      renderAlerts();
      const next = document.querySelector('#alerts [data-a="dismissError"]');
      if (next) next.focus(); else focusFallback();
      return true;
    }
    case 'whisper': chat.openWhisper(v); return true;
    case 'seenann': try { localStorage.setItem(SEEN_KEY, String(ui.announcement?.id || 0)); } catch { /* ignore */ } return true;
    default: return false;
  }
}

// Actions the server performs: [action, args, successMessage?], or null to cancel.
async function remoteCall(a, v) {
  switch (a) {
    case 'create': {
      const name = ($('#name')?.value || '').trim().replace(/\s+/g, ' ');
      ui.draftName = name;
      if (!NAME_RE.test(name)) { ui.createError = 'Names are 2 to 18 letters and can include spaces, hyphens and apostrophes.'; render(); $('#name')?.focus(); return null; }
      ui.createError = null;
      return ['create', { name, race: ui.race }];
    }
    case 'move': return ['move', { dir: v }];
    case 'walkto':
    case 'walk': { const [x, y] = v.split(',').map(Number); return x === char.loc.x && y === char.loc.y ? null : ['walk', { x, y }]; }
    case 'fight': ui.lastMonster = v; return ['fight', { monsterId: v }];
    case 'hunt': return ['hunt', { huntId: v }];
    case 'melee': case 'cast': case 'flee': case 'again': case 'done': case 'dismiss': case 'portal': return [a, {}];
    case 'heal': return ['heal', {}, `Healed for ${healCost(char)} gold.`];
    case 'buy': return ['buy', { itemId: v }, `Bought ${ITEMS[v].name}. It is in your pack.`];
    case 'buyequip': return ['buyequip', { itemId: v }, `Bought and equipped ${ITEMS[v].name}.`];
    case 'equip': return ['equip', { uid: Number(v) }, 'Equipped.'];
    case 'unequip': return ['unequip', { slot: v }];
    case 'socket': return ['socket', { uid: ui.sheet.uid, gem: v }, `Socketed ${parseGem(v).name}.`];
    case 'extract': return ['extract', { uid: ui.sheet.uid, index: Number(v) }, 'The jeweler extracts the gem.'];
    case 'sell': {
      const item = findItem(char, Number(v));
      const base = item && itemDef(item);
      // Selling is a trade at the price on the button; it only asks first when it also destroys gems.
      if (item?.gems?.length) {
        const ok = await ask({
          title: `Sell ${base.name} for ${fmt(sellPrice(item))} gold?`,
          points: [
            `The ${item.gems.length === 1 ? 'gem' : `${item.gems.length} gems`} in it (${item.gems.map((g) => parseGem(g)?.name || g).join(', ')}) will be destroyed.`,
            `To keep ${item.gems.length === 1 ? 'it, extract it' : 'them, extract them'} at the jeweler first (there is a fee).`,
          ],
          confirm: 'Sell and destroy gems', cancel: 'Keep it',
        });
        if (!ok) return null;
      }
      return ['sell', { uid: Number(v) }, 'Sold.'];
    }
    case 'deposit': case 'withdraw': {
      const amount = v === 'all' ? 'all' : ($('#amount')?.value || '').trim();
      if (v !== 'all' && !/^\d+$/.test(amount)) { ui.bankError = 'Enter an amount of gold as a whole number.'; render(); $('#amount')?.focus(); return null; }
      ui.bankError = null;
      return [a, { amount }, a === 'deposit' ? 'Deposited.' : 'Withdrawn.'];
    }
    case 'accept': return ['accept', { questId: v }, 'Quest accepted. Good hunting.'];
    case 'abandon': {
      const q = char.quest;
      const ok = q && await ask({
        title: 'Abandon your quest?',
        lead: questTitle(q),
        points: [`You give up the reward: ${rewardText(q.reward)}.`, 'You can take a quest again at the board in town.'],
        confirm: 'Abandon quest', cancel: 'Keep quest',
      });
      return ok ? ['abandon', {}, 'Quest abandoned.'] : null;
    }
    case 'level': return ['level', { stat: v }, v === 'all' ? 'Every stat increased.' : `${STAT_LABEL[v]} increased.`];
    case 'attack': {
      const target = (ui.players || []).find((p) => p.id === v);
      // What losing would cost, worked out by the same rule the server applies.
      const { goldLost, xpLost } = deathPenalty(structuredClone(char));
      const ok = await ask({
        title: `Attack ${target ? target.name : 'this player'}?`,
        lead: 'The duel is fought to the end in one go; you can\'t flee.',
        points: [
          `If you lose, you drop ${goldLost ? `all ${fmt(goldLost)} gold you carry` : 'any gold you carry'}${xpLost ? `, lose ${fmt(xpLost)} experience` : ''} and wake up in town.`,
          'If you win, you take the gold they carry.',
          'Gold in the bank is safe either way.',
        ],
        confirm: 'Attack', cancel: 'Not now',
      });
      return ok ? ['attack', { targetId: v }] : null;
    }
    case 'delete': {
      const ok = await ask({
        title: `Delete ${char.name}?`,
        points: [
          `${char.name}, with all their gear, gems, gold (carried and banked) and progress, is deleted.`,
          'This cannot be undone.',
        ],
        typeToConfirm: char.name, confirm: 'Delete forever', cancel: 'Keep my hero',
      });
      return ok ? ['delete', {}, 'Your hero is gone.'] : null;
    }
    default: return null;
  }
}

async function runRemote(a, v, el) {
  const g = gameGen;
  const call = await remoteCall(a, v); // may wait for a confirmation
  if (!call || !live(g)) return;
  const [action, args, msg] = call;
  const before = char && {
    loc: locKey(), zone: char.loc.zone, gold: char.gold, xp: char.xp, level: char.level, masteries: { ...char.masteries },
    battleLog: char.battle && !char.battle.pvp ? char.battle.log.length : 0,
    battleId: char.battle?.monsterId,
  };
  ui.busy = true;
  // Pending: remembered by key so it survives re-renders (regeneration ticks every second).
  ui.pendingKey = el ? focusKey(el) : null;
  markPending();
  let res;
  try {
    res = await api(action, args);
  } catch (err) {
    if (!live(g)) return; // the account changed while this was on its way: not ours to report
    ui.busy = false;
    ui.pendingKey = null;
    markPending();
    const message = err.message || 'Something went wrong.';
    if (action === 'create') ui.createError = message; // shown next to the name field
    else addError(err.status == null ? `Can't reach the game server. ${message}` : message, err.status == null ? 'connection' : action);
    render();
    if (err.status === 401) await sb.auth.signOut();
    return;
  }
  // The answer belongs to the session that asked. If that session has ended (signed out, or
  // another account signed in), it is dropped: no hero, feedback or pending state from it.
  if (!live(g)) return;
  ui.busy = false;
  ui.pendingKey = null;
  markPending();
  char = res.char;
  trackChanges(action, before);
  if ('sanctions' in res) ui.sanctions = res.sanctions;
  resolveErrors(action);
  if (action === 'create') ui.createError = null;
  if (action === 'deposit' || action === 'withdraw') ui.bankError = null;
  if (msg) toast(msg);
  if (action === 'create' && char) { ui.tab = 'explore'; toast(`Welcome to ${ZONES[char.loc.zone].name}, ${char.name}.`); chat.start(); }
  if (action === 'sell' || action === 'buyequip') ui.sheet = null;
  if (action === 'fight' || action === 'attack' || action === 'hunt') ui.tab = 'explore';
  if (char?.battle?.hunt && ['melee', 'cast'].includes(action)) {
    const h = ui.hunts.find((x) => x.id === char.battle.hunt);
    if (h) h.hp = char.battle.hp;
    if (char.battle.over === 'victory' || char.battle.over === 'ended') loadHunts();
  }
  if (char && before && char.loc.zone !== before.zone && char.battle?.over !== 'defeat') toast(`You travel to ${ZONES[char.loc.zone].name}.`);
  if (action === 'accept' || action === 'abandon') loadBoard();
  render();
  // Battle feedback for the new log lines.
  const b = char?.battle;
  if (b && ['melee', 'cast', 'flee', 'attack'].includes(action)) {
    const start = b.monsterId && b.monsterId === before?.battleId ? before.battleLog : 0;
    playEffects(b.log.slice(start));
  }
  if (char && before && locKey() !== before.loc) { ui.players = null; refreshPlayers(); chat.setZone(char.loc.zone); }
  if (action === 'attack' || action === 'done') refreshPlayers();
}

document.addEventListener('click', async (e) => {
  if (e.target === sheetDlg) { // a tap on the backdrop, outside the panel
    dismissSheet();
    render();
    return;
  }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if (a === 'signout') { await signOut(); return; }
  if (handleLocal(a, el.dataset.v)) { render(); return; }
  if (el.getAttribute('aria-disabled') === 'true') return;
  // Taps that are not acted on say so, instead of being silently dropped.
  if (ui.busy) { refuse(el, 'Still working on your last action.'); return; }
  if (BATTLE_ACTIONS.has(a)) {
    const now = Date.now();
    if (now < ui.nextActionAt) { refuse(el, 'Second tap ignored, so you only acted once.'); return; } // accidental double tap
    ui.nextActionAt = now + 250;
  }
  await runRemote(a, el.dataset.v, el);
});

// Keyboard support for desktop testing.
const KEY_DIRS = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e' };
// Map squares: one tab stop; arrows, Home and End move the focus, Enter or Space walks.
document.addEventListener('focusin', (e) => {
  const cell = e.target.closest?.('.map [data-a="walk"]');
  if (!cell || !char) return;
  const [x, y] = cell.dataset.v.split(',').map(Number);
  ui.mapCursor = { zone: char.loc.zone, x, y };
  for (const c of document.querySelectorAll('.map [data-a="walk"][tabindex="0"]')) if (c !== cell) c.tabIndex = -1;
  cell.tabIndex = 0;
});
function mapKeys(e) {
  const cell = e.target.closest?.('.map [data-a="walk"]');
  if (!cell) return false;
  const n = currentZone(char).size;
  let [x, y] = cell.dataset.v.split(',').map(Number);
  if (e.key === 'ArrowUp') y--; else if (e.key === 'ArrowDown') y++;
  else if (e.key === 'ArrowLeft') x--; else if (e.key === 'ArrowRight') x++;
  else if (e.key === 'Home') x = 1; else if (e.key === 'End') x = n;
  else if (e.key === 'PageUp') y -= 5; else if (e.key === 'PageDown') y += 5;
  else return false;
  e.preventDefault();
  x = Math.max(1, Math.min(n, x)); y = Math.max(1, Math.min(n, y));
  document.querySelector(`.map [data-a="walk"][data-v="${x},${y}"]`)?.focus();
  return true;
}
// ---------------------------------------------------------------- keyboard shortcuts (D-3)
// Desktop only, on by default, with an off setting (Hero, Settings). One table drives both the
// handler and the help sheet, so the list can't drift from what works. A shortcut presses the
// existing button (keeping its pending state, the double-tap guard and disabled states); when
// that button isn't there, the key does nothing. Character keys only; the arrow keys (moving on
// Explore) and Escape are not shortcuts in this sense and work as before, setting or not.
const SHORTCUTS = [
  { key: '1', show: '1', label: 'Explore (Battle during a fight)', target: '#nav [data-a="tab"][data-v="explore"]' },
  { key: '2', show: '2', label: 'Hero', target: '#nav [data-a="tab"][data-v="hero"]' },
  { key: '3', show: '3', label: 'Gear', target: '#nav [data-a="tab"][data-v="gear"]' },
  { key: '4', show: '4', label: 'Map', target: '#nav [data-a="tab"][data-v="map"]' },
  { key: 'm', show: 'M', label: 'Melee', when: 'In a fight', target: '#dock [data-a="melee"]' },
  { key: 'c', show: 'C', label: 'Cast', when: 'In a fight', target: '#dock [data-a="cast"]' },
  { key: 'f', show: 'F', label: 'Flee (fall back from a world boss)', when: 'In a fight', target: '#dock [data-a="flee"]' },
  { key: 'Enter', show: 'Enter', label: 'Fight again (attack a world boss again)', when: 'After a fight, when no other button is selected', target: '#dock [data-a="again"]', notOnControls: true },
  { key: '/', show: '/', label: 'Go to the chat message box', run: () => goToChat() },
  { key: '?', show: '?', label: 'Show this list', run: () => { ui.sheet = { type: 'keys' }; render(); } },
  { show: 'Escape', label: 'Leave the chat message box, or close a window like this one', always: true },
  { show: 'Arrow keys', label: 'Move, on Explore', always: true },
];

const shortcutsOn = () => layout === 'desktop' && prefs.keys && ui.phase === 'game' && !!char && !ui.sanctions?.banned;
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const CONTROLS = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"]';

function shortcut(e) {
  if (!shortcutsOn() || document.querySelector('dialog[open]')) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.getModifierState?.('AltGraph')) return false;
  if (e.isComposing || e.keyCode === 229 || e.repeat) return false;
  if (e.target.closest?.(TYPING)) return false;
  // Letters ignore Caps Lock but not Shift; other keys match what they type, so ? and / work
  // on keyboards where they need Shift.
  let key = e.key;
  if (/^[a-z]$/i.test(key)) {
    if (e.shiftKey) return false;
    key = key.toLowerCase();
  }
  const s = SHORTCUTS.find((x) => x.key === key);
  if (!s) return false;
  if (s.notOnControls && e.target.closest?.(CONTROLS)) return false; // Enter on a button presses that button
  if (s.run) { e.preventDefault(); s.run(); return true; }
  const el = $(s.target);
  if (!el || el.disabled || !el.getClientRects().length) return false;
  e.preventDefault();
  el.click();
  return true;
}

// "/" goes to chat; Escape there comes back to where you were (else the screen's heading).
let chatReturn = null;
function goToChat() {
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('#chatpanel, #chat')) chatReturn = active;
  chat.focusInput();
}
function leaveChat() {
  const back = chatReturn && chatReturn.isConnected && isUsable(chatReturn) ? chatReturn : $('#screen-title');
  chatReturn = null;
  back?.focus({ preventScroll: true });
}

// Shortcut keys are announced on their buttons (aria-keyshortcuts) while shortcuts are on.
function markShortcuts() {
  const on = shortcutsOn();
  for (const s of SHORTCUTS) {
    if (!s.target) continue;
    for (const el of document.querySelectorAll(s.target)) {
      if (on) el.setAttribute('aria-keyshortcuts', s.show);
      else el.removeAttribute('aria-keyshortcuts');
    }
  }
}

function sheetKeys() {
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">Keyboard shortcuts</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="muted small">${prefs.keys ? 'Shortcuts are on. You can turn them off in Hero, Settings.' : 'Shortcuts are off. You can turn them on in Hero, Settings.'}
      They don't work while you type, or while a window like this one is open.</p>
    <table class="keys">
      <caption class="sr-only">Keyboard shortcuts</caption>
      <thead><tr><th scope="col">Key</th><th scope="col">What it does</th></tr></thead>
      <tbody>${SHORTCUTS.map((s) => `<tr><td><kbd>${esc(s.show)}</kbd></td><td>${esc(s.label)}${s.when ? `<small>${esc(s.when)}</small>` : ''}${s.always ? '<small>Always on</small>' : ''}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

document.addEventListener('keydown', (e) => {
  // Already handled where it happened (chat's own arrow keys, Escape in chat). Before D-3 the
  // arrow keys in the chat panel also moved the hero.
  if (e.defaultPrevented) return;
  if (mapKeys(e)) return;
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'name') $('[data-a="create"]')?.click();
    return;
  }
  if (shortcut(e)) return;
  if (KEY_DIRS[e.key] && char && !char.battle && ui.tab === 'explore' && !document.querySelector('dialog[open]') && !e.target.closest?.('#chatpanel')) {
    e.preventDefault();
    $(`[data-a="move"][data-v="${KEY_DIRS[e.key]}"]`)?.click();
  }
});

// ---------------------------------------------------------------- timers and boot
async function refreshPlayers() {
  if (!char || ui.list !== 'players' || ui.tab !== 'explore' || char.battle) return;
  const key = locKey();
  const g = gameGen;
  try {
    const list = await playersAt(char.loc, char.name);
    if (!live(g) || !char || key !== locKey()) return;
    ui.players = list;
    ui.playersKey = key;
    render();
  } catch (err) {
    if (live(g)) toast(err.message, 'bad');
  }
}

// Regeneration shown locally between server updates (the server does the real math).
setInterval(() => {
  if (!char) return;
  const before = char.hp;
  applyRegen(char);
  if (char.hp !== before) render();
}, 1000);

setInterval(() => { if (document.visibilityState === 'visible') refreshPlayers(); }, 15000);
setInterval(() => {
  if (document.visibilityState !== 'visible' || !char) return;
  loadHunts();
  loadWorldConfig();
}, 30000);
// Pick up zone edits now and then (the server moves heroes out of removed areas).
setInterval(async () => {
  if (document.visibilityState !== 'visible' || !char) return;
  const g = gameGen;
  await loadZoneDefs();
  if (!live(g) || !char) return;
  if (!ZONES[char.loc.zone]) {
    try {
      const fresh = (await api('state')).char;
      if (live(g)) char = fresh;
    } catch { /* next action will sort it out */ }
  }
  if (live(g)) render();
}, 120000);

let zonesLoaded = null;
async function loadZoneDefs() {
  try {
    const defs = await fetchZoneDefs();
    if (defs) loadZones(defs);
  } catch { /* keep the built-in world */ }
}
function zonesReady() {
  if (!zonesLoaded) zonesLoaded = loadZoneDefs();
  return zonesLoaded;
}

async function loadWorldConfig() {
  const g = gameGen;
  try {
    const { data } = await sb.from('world_config').select('data').eq('id', 1).maybeSingle();
    if (!live(g)) return;
    setWorld(data?.data || null);
    render();
  } catch { /* keep defaults */ }
}

async function loadHunts() {
  const g = gameGen;
  try {
    const { data } = await sb.from('hunts').select('id, zone, name, level, hp, max_hp, ends_at')
      .eq('status', 'active').gt('ends_at', new Date().toISOString()).limit(20);
    if (!live(g)) return;
    ui.hunts = data || [];
    render();
  } catch { /* not important */ }
}

async function loadAnnouncement() {
  const g = gameGen;
  try {
    const { data } = await sb.from('events').select('id, text, created_at').eq('kind', 'announce')
      .gt('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
      .order('created_at', { ascending: false }).limit(1);
    if (!live(g)) return;
    ui.announcement = data?.[0] || null;
    render();
  } catch { /* not important */ }
}

// The entrance (entry.js) starts and stops the game; it owns the one auth listener. A start for
// an account that has since changed or signed out is abandoned when it returns (isCurrent).
// Resolves true when the hero (or hero creation) is drawn; throws if the hero can't be loaded.
export async function start(newSession, isCurrent = () => true) {
  const g = ++gameGen;
  const current = () => isCurrent() && live(g);
  session = newSession;
  ui.phase = 'idle';
  await zonesReady();
  if (!current()) return false;
  const res = await api('state');
  if (!current()) return false;
  char = res.char;
  ui.sanctions = res.sanctions || null;
  ui.phase = 'game';
  // Chat starts after the hero; by then the account may have changed or signed out.
  if (char) chat.start().then(() => { if (current() && char) chat.setZone(char.loc.zone); });
  loadAnnouncement();
  loadWorldConfig();
  loadHunts();
  render();
  refreshPlayers();
  return true;
}

// Signed out, the session ended, or another account is starting: drop everything that belongs to
// this account. The regions are emptied; the entrance takes over.
// Everything per-account is replaced, including a pending action's busy state, so the next
// account starts clean; requests still on their way are dropped when they return (live()).
export function stop() {
  gameGen++;
  cancelAsk(); // a question for this account (delete, attack…) closes, answered "no"
  chat.stop();
  clearTimeout(ui.deltaTimer);
  char = null;
  session = null;
  for (const k of Object.keys(ui)) delete ui[k];
  Object.assign(ui, freshUi());
  lastView = null;
  render();
}

// The game was drawn while hidden behind the entrance: recentre the map and the battle log now
// that it can be measured.
export function shown() {
  ui.mapKey = null;
  render();
  const log = $('#log');
  if (log) log.scrollTop = log.scrollHeight;
}

// The layout (mobile, wide or desktop) sets the region order; the desktop side column is drawn
// only in the desktop layout.
watchLayout((next, panel) => { layout = next; chat.setMode(panel ? 'panel' : 'drawer'); render(); });
render();

// Expose for debugging from the browser console.
window.clickmonster = { get char() { return char; }, MONSTERS };
