// Admin and moderator console. All checks happen on the server (`admin` edge function);
// this page only renders what the server allows, and never relies on hiding a control for safety.
import { client, fetchZoneDefs } from './net.js';
import { setupZones } from './admin-zones.js';
import { loadZones } from './data/zones.js';
import { STATS, STAT_SHORT } from './data/stats.js';
import { MASTERIES, MASTERY_LABEL, masteryCap } from './data/masteries.js';
import { GEM_TYPES, GEM_TIERS } from './data/gems.js';
import { ITEMS, itemDef, SLOT_LABEL } from './data/items.js';
import { ZONES } from './data/zones.js';
import { RACES } from './data/races.js';
import { MULT_KEYS, MULT_LABEL, MULT_MAX } from './engine/world-config.js';
import { ask, setConfirmFallback } from './confirm.js';
// The one Supabase client (net.js), from our own copy of supabase-js. If it can't load, say so.
let sb;
try { sb = await client(); } catch (err) {
  document.getElementById('admin').innerHTML = '<p class="field-msg bad" role="alert" style="padding:16px">The sign-in service could not be loaded. Check your connection, then reload the page.</p>';
  throw err;
}
// After a confirmation whose button was re-rendered away: the record or section heading.
setConfirmFallback(() => document.getElementById('player-title') || document.getElementById('section-title') || document.querySelector('.a-tabs [aria-current]'));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
const when = (t) => (t ? new Date(t).toLocaleString() : '');
const ago = (t) => {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const active = (t) => t && new Date(t).getTime() > Date.now();
const shortName = (email) => String(email || '').split('@')[0];
const MOD_MAX_DAYS = 7; // the server's limit for moderators (it enforces it; this only explains it)
function detailsText(action, d) {
  if (!d) return '';
  if (action === 'edit') {
    return Object.entries(d).map(([k, v]) => (Array.isArray(v) ? `${k} ${JSON.stringify(v[0])} to ${JSON.stringify(v[1])}` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(', ');
  }
  if (action.startsWith('sanction:')) return `${d.reason || ''}${d.days ? ` (${d.days} days)` : d.until ? ' (permanent)' : ''}`;
  if (action === 'announce') return d.text;
  return JSON.stringify(d);
}
const untilText = (t) => (new Date(t).getFullYear() > 9000 ? 'permanently' : `until ${when(t)}`);

const st = {
  phase: 'loading', me: null, tab: 'dashboard', navGroup: null, q: '', players: null, player: null, stats: null, log: null, events: null, staff: null,
  world: null, hunts: null, economy: null, zones: null, zoneEdit: null, chat: null, reports: null, chatQ: {}, focusNext: null, returnFocus: null,
  reviews: {}, // report id -> { open, player, loading, done }
  formErrors: {}, // form id -> server error shown inside the form
  // Requests in flight, one flag each: form ids, button actions (`action:target`, see actionKey)
  // and zone changes (`zone:<id>:<op>`). A key is stable across re-renders.
  pendingForms: new Set(),
  clearForms: new Set(), // forms to show fresh (not restored) on the next render, after a success
};

// Problems stay until dismissed (or until the connection recovers); successes are brief.
const problems = [];
let nextProblem = 1;
function renderProblems() {
  const el = $('#alerts');
  const last = problems.length - 1;
  el.innerHTML = problems.map((p, i) => `<div class="alert"${i === last ? ' role="alert"' : ''}><p>${esc(p.text)}${p.count > 1 ? ` <span class="alert-count">(${p.count} times)</span>` : ''}</p>
    <button type="button" class="textbtn" data-a="dismissProblem" data-v="${p.id}">Dismiss<span class="sr-only"> message: ${esc(p.text)}</span></button></div>`).join('');
}
function addProblem(text, kind = /^Can't reach the server/.test(text) ? 'connection' : 'action') {
  const same = problems.find((p) => p.text === text);
  if (same) same.count += 1; else problems.push({ id: nextProblem++, text, kind, count: 1 });
  renderProblems();
}

let toastTimer;
function toast(msg, bad = false) {
  if (bad) { addProblem(msg); return; }
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show';
  el.style.top = 'auto';
  el.style.bottom = '24px';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

async function call(action, args = {}) {
  const { data, error } = await sb.functions.invoke('admin', { body: { action, args } });
  if (error) {
    let msg = 'Request failed.';
    const status = error.context?.status;
    try { msg = (await error.context.json()).error || msg; } catch { /* not json */ }
    if (status == null) throw new Error(`Can't reach the server. ${msg}`);
    throw new Error(msg);
  }
  // A successful request clears connection problems.
  const before = problems.length;
  for (let i = problems.length - 1; i >= 0; i--) if (problems[i].kind === 'connection') problems.splice(i, 1);
  if (problems.length !== before) renderProblems();
  return data;
}

function sanctionPills(p) {
  return [
    active(p.banned_until) ? '<span class="pill ban">Banned</span>' : '',
    active(p.jailed_until) ? '<span class="pill jail">Jailed</span>' : '',
    active(p.muted_until) ? '<span class="pill mute">Muted</span>' : '',
  ].join('');
}

const isAdmin = () => st.me?.role === 'admin';

// ---------------------------------------------------------------- building blocks
// A data table with real headers. On narrow screens it becomes labelled cards (each cell keeps
// its column name), so nothing is hidden or squeezed; wider content scrolls inside the box.
// cols: [{ label, num, lead, act, sr }]; rows: arrays of cell HTML.
function dataTable({ label, cols, rows, empty = 'Nothing here yet.', cards = true }) {
  if (!rows.length) return `<p class="note">${esc(empty)}</p>`;
  const cls = (c) => [c.num ? 'num' : '', c.lead ? 'lead' : '', c.act ? 'act' : ''].filter(Boolean).join(' ');
  return `<div class="table-scroll"><table class="data${cards ? ' cards' : ''}">
    <caption class="sr-only">${esc(label)}</caption>
    <thead><tr>${cols.map((c) => `<th scope="col" class="${cls(c)}">${c.sr ? `<span class="sr-only">${esc(c.label)}</span>` : esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => `<td class="${cls(cols[i])}" data-label="${esc(cols[i].label)}">${cell === '' || cell == null ? '' : `<div class="cv">${cell}</div>`}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// A labelled field. Hints and inline errors are tied to the control with aria-describedby.
// control(attrs) receives the id and describedby attributes to splice into the element.
function field({ id, label, hint = '', wide = false, control }) {
  const err = st.fieldErrors?.[id];
  const describedby = [hint ? `${id}-hint` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ');
  const attrs = `id="${id}"${describedby ? ` aria-describedby="${describedby}"` : ''}${err ? ' aria-invalid="true"' : ''}`;
  return `<div class="f${wide ? ' wide' : ''}"><label for="${id}">${esc(label)}</label>${control(attrs)}
    ${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}${err ? `<p class="field-msg bad" id="${id}-err">${esc(err)}</p>` : ''}</div>`;
}
const input = (extra = '') => (attrs) => `<input ${attrs} ${extra}>`;
const select = (options, extra = '') => (attrs) => `<select ${attrs} ${extra}>${options}</select>`;
const textarea = (value, extra = '') => (attrs) => `<textarea ${attrs} ${extra}>${esc(value)}</textarea>`;
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;

// The bottom of a form: its submit button (pending while the request runs) and its error.
function formFoot(id, label, extra = '') {
  const busy = st.pendingForms.has(id);
  const err = st.formErrors[id];
  return `<div class="form-foot"><button class="btn primary${busy ? ' pending' : ''}" type="submit"${busy ? ' aria-busy="true"' : ''}>${esc(label)}</button>${extra}</div>
    ${err ? `<p class="form-error" id="${id}-error" role="alert">${esc(err)}</p>` : ''}`;
}

// ---------------------------------------------------------------- navigation
const GROUPS = [
  { id: 'people', label: 'Players and moderation', short: 'Players', items: [['players', 'Players'], ['chat', 'Reports and chat'], ['log', 'Audit log']] },
  { id: 'world', label: 'World', short: 'World', items: [['dashboard', 'Overview'], ['world', 'Events and rates'], ['hunts', 'Hunts'], ['economy', 'Economy']] },
  { id: 'content', label: 'Content', short: 'Content', items: [['zones', 'Zones'], ['announce', 'Announcements']] },
  { id: 'staff', label: 'Staff', short: 'Staff', items: [['staff', 'Staff']], admin: true },
];
const SECTION_LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.items));
const groupsFor = () => GROUPS.filter((g) => !g.admin || isAdmin());
const groupOf = (tab) => GROUPS.find((g) => g.items.some(([id]) => id === tab))?.id || 'world';

function viewLogin() {
  return `<div class="intro"><h1>ClickMonster Admin</h1><p>Staff sign in with their game account.</p></div>
    <form id="login" class="box narrow" novalidate>
      <div class="form-grid">
        ${field({ id: 'email', label: 'Email', wide: true, control: input('type="email" autocomplete="email" required') })}
        ${field({ id: 'password', label: 'Password', wide: true, control: input('type="password" autocomplete="current-password" required') })}
      </div>
      ${st.loginMsg ? `<p class="form-error" role="alert">${esc(st.loginMsg)}</p>` : ''}
      <button class="btn primary block gap-top" type="submit">Sign in</button>
    </form>`;
}

function viewDenied() {
  return `<div class="intro"><h1>ClickMonster Admin</h1></div>
    <div class="box narrow"><p>This account is not on the staff list.</p>
    <p class="note">Signed in as ${esc(st.email)}. An admin can add you from the Staff section.</p>
    <button class="btn" data-a="signout">Sign out</button></div>`;
}

function header() {
  return `<header class="a-head"><h1>ClickMonster Admin <span class="pill ${st.me.role}">${st.me.role}</span></h1>
      <span class="who"><span class="email" title="${esc(st.me.email)}">${esc(st.me.email)}</span>
      <a class="textbtn" href="./">Open game</a>
      <button class="textbtn" data-a="signout">Sign out</button></span></header>`;
}

function nav() {
  const groups = groupsFor();
  const open = st.navGroup || groupOf(st.tab);
  const badge = (id) => (id === 'chat' && st.reports?.length ? `<span class="count">${st.reports.length}<span class="sr-only"> open reports</span></span>` : '');
  return `<nav class="a-nav" aria-label="Admin sections">
      <div class="a-groups" style="--groups:${groups.length}">${groups.map((g) =>
        `<button type="button" data-a="navgroup" data-v="${g.id}" aria-expanded="${g.id === open}" aria-controls="g-${g.id}">${esc(g.short)}</button>`).join('')}</div>
      <div class="a-nav-groups">${groups.map((g) => `<div class="a-group${g.id === open ? ' open' : ''}" id="g-${g.id}" role="group" aria-labelledby="gl-${g.id}">
        <p class="a-group-label" id="gl-${g.id}">${esc(g.label)}</p>
        <ul class="a-tabs">${g.items.map(([id, l]) => `<li><button class="chip ${st.tab === id ? 'on' : ''}" data-a="tab" data-v="${id}" data-group="${g.id}"${st.tab === id ? ' aria-current="page"' : ''}>${esc(l)}${badge(id)}</button></li>`).join('')}</ul>
      </div>`).join('')}</div>
    </nav>`;
}

function barList(obj, label = (k) => k) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => `<div class="bar-row"><span>${esc(label(k))}</span><i style="--w:${Math.round((v / max) * 100)}%" aria-hidden="true"></i><span class="num">${v}</span></div>`).join('') || '<p class="note">None yet.</p>';
}
const playerLink = (id, name) => `<button type="button" class="row-link" data-a="open" data-v="${esc(id)}">${esc(name)}</button>`;

// ---------------------------------------------------------------- sections
function viewDashboard() {
  const s = st.stats;
  if (!s) return '<p class="note">Loading statistics.</p>';
  const tile = (v, l) => `<div class="tile"><b>${typeof v === 'number' ? fmt(v) : v}</b><span>${l}</span></div>`;
  return `<div class="tiles">
      ${tile(s.players, 'Heroes')}${tile(s.online15m, 'Online (15 min)')}${tile(s.active24h, 'Active 24h')}${tile(s.active7d, 'Active 7 days')}
      ${tile(s.signups24h, 'New 24h')}${tile(s.signups7d, 'New 7 days')}${tile(s.banned, 'Banned')}${tile(s.events24h, 'News items 24h')}
      ${tile(s.goldCarried, 'Gold carried')}${tile(s.goldBanked, 'Gold banked')}
    </div>
    <div class="cols">
      <div class="box"><h2>Levels</h2>${barList(s.levels)}</div>
      <div class="box"><h2>Races</h2>${barList(s.byRace, (k) => RACES[k]?.name || k)}</div>
      <div class="box"><h2>Where players are</h2>${barList(s.byZone, (k) => ZONES[k]?.name || k)}</div>
      <div class="box"><h2>Top heroes</h2>${dataTable({
        label: 'Top heroes', cols: [{ label: 'Hero', lead: true }, { label: 'Race' }, { label: 'Level', num: true }],
        rows: (s.top || []).map((p) => [playerLink(p.id, p.name), esc(RACES[p.race]?.name || ''), p.level]),
      })}</div>
    </div>
    <button class="btn sm" data-a="refresh">Refresh</button>`;
}

function viewPlayers() {
  if (st.player) return viewPlayer();
  const list = st.players;
  return `<form id="search" class="box" role="search" novalidate>
      <div class="form-grid">${field({ id: 'q', label: 'Find a hero', wide: true, hint: 'Part of a name is enough. Leave empty to list everyone.', control: input(`type="search" value="${esc(st.q)}" autocomplete="off"`) })}</div>
      <div class="form-foot"><button class="btn primary" type="submit">Search</button></div>
    </form>
    <div class="box">${!list ? '<p class="note">Loading.</p>' : dataTable({
      label: 'Heroes', empty: 'No heroes found.',
      cols: [{ label: 'Hero', lead: true }, { label: 'Race' }, { label: 'Level', num: true }, { label: 'Where' }, { label: 'Status' }, { label: 'Last seen' }],
      rows: list.map((p) => [
        playerLink(p.id, p.name), esc(RACES[p.race]?.name || p.race), p.level,
        `${esc(ZONES[p.zone]?.name || p.zone)} <span class="sub">${p.x}, ${p.y}</span>`,
        `${sanctionPills(p) || '<span class="note">Clear</span>'}${p.strikes ? `<span class="sub">${p.strikes} ${p.strikes === 1 ? 'strike' : 'strikes'}</span>` : ''}`,
        ago(p.updated_at),
      ]),
    })}</div>`;
}

// The sanction form, used on a player's record and inside a report review.
function sanctionForm(p, id, { reason = '' } = {}) {
  const ids = id === 'sanction' ? { kind: 's-kind', days: 's-days', reason: 's-reason' } : { kind: `${id}-kind`, days: `${id}-days`, reason: `${id}-reason` };
  const daysHint = isAdmin()
    ? 'For mute, jail and ban. Blank or 0 means permanent. Ignored for warnings and lifting.'
    : `For mute, jail and ban: up to ${MOD_MAX_DAYS} days for moderators (longer or permanent needs an admin). Ignored for warnings and lifting.`;
  return `<form id="${id}" class="sanction-form" data-player="${esc(p.id)}" data-name="${esc(p.name)}" novalidate>
      <div class="form-grid">
        ${field({ id: ids.kind, label: 'Action', hint: 'Warn: a strike on their record (players are not shown warnings). Mute: no chat. Jail: they can look around but not act. Ban: no play.',
          control: select([opt('warn', 'Warn'), opt('mute', 'Mute'), opt('jail', 'Jail'), opt('ban', 'Ban'), opt('lift', 'Lift all sanctions')].join('')) })}
        ${field({ id: ids.days, label: 'Days', hint: daysHint, control: input('type="number" min="0" step="0.5" value="1" inputmode="decimal"') })}
        ${field({ id: ids.reason, label: 'Reason', wide: true, hint: 'Required. Shown to them with a mute, jail or ban, and kept on their record.', control: input(`value="${esc(reason)}" maxlength="300" required`) })}
      </div>
      ${formFoot(id, 'Apply')}
    </form>`;
}

function sanctionSummary(p) {
  const current = [
    active(p.banned_until) ? `Banned ${untilText(p.banned_until)}` : '',
    active(p.jailed_until) ? `Jailed ${untilText(p.jailed_until)}` : '',
    active(p.muted_until) ? `Muted ${untilText(p.muted_until)}` : '',
  ].filter(Boolean);
  return `${current.length ? current.join('. ') + '.' : 'No active sanctions.'} Strikes: ${p.strikes || 0}.${p.sanction_reason ? ` Last reason: ${esc(p.sanction_reason)}` : ''}`;
}

function editBox(p) {
  const c = p.data;
  const zoneOpts = Object.values(ZONES).map((z) => opt(z.id, z.name, c.loc.zone)).join('');
  const itemOpts = Object.values(ITEMS).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)).map((i) => opt(i.id, `Class ${i.tier}: ${i.name}`)).join('');
  const gemOpts = Object.keys(GEM_TYPES).flatMap((t) => [1, 2, 3, 4, 5].map((n) => opt(`${t}:${n}`, `${GEM_TIERS[n]} ${GEM_TYPES[t].name}`))).join('');
  const equipped = new Set(Object.values(c.equipment));
  const LABEL = { level: 'Level', xp: 'Experience', gold: 'Gold carried', bank: 'Gold banked', pendingLevels: 'Unspent levels' };
  const n = (name, label, value, extra = 'min="0"', hint = '') => field({ id: `e-${name.replace('.', '-')}`, label, hint, control: input(`name="${name}" type="number" ${extra} value="${value}"`) });
  return `<section class="box" aria-labelledby="edit-title"><h2 id="edit-title">Edit hero</h2>
    <form id="edit" novalidate>
      <fieldset class="f-set"><legend>Progress and gold</legend><div class="form-grid">
        ${['level', 'xp', 'gold', 'bank', 'pendingLevels'].map((k) => n(k, LABEL[k], c[k] ?? 0, k === 'level' ? 'min="1"' : 'min="0"')).join('')}</div></fieldset>
      <fieldset class="f-set gap-top"><legend>Stats</legend><div class="form-grid">
        ${STATS.map((s) => n(`stat.${s}`, STAT_SHORT[s], c.stats[s], 'min="1"')).join('')}</div></fieldset>
      <fieldset class="f-set gap-top"><legend>Masteries</legend><div class="form-grid">
        ${MASTERIES.map((m) => n(`mastery.${m}`, MASTERY_LABEL[m], c.masteries?.[m] ?? 0, `min="0" max="${masteryCap(c.race, m)}"`, `Up to ${masteryCap(c.race, m)}`)).join('')}</div></fieldset>
      <fieldset class="f-set gap-top"><legend>Location</legend><div class="form-grid">
        ${field({ id: 'e-zone', label: 'Zone', control: select(zoneOpts, 'name="zone"') })}
        ${n('x', 'X', c.loc.x, 'min="1"')}${n('y', 'Y', c.loc.y, 'min="1"')}</div></fieldset>
      ${formFoot('edit', 'Save changes')}
    </form>
    <h3>Quick fixes</h3>
    <div class="acts flush">
      <button class="btn sm" data-a="quick" data-v="heal">Full heal</button>
      <button class="btn sm" data-a="quick" data-v="clearBattle">End battle</button>
      <button class="btn sm" data-a="quick" data-v="clearQuest">Clear quest and cooldown</button>
    </div>
    <h3>Give item</h3>
    <form id="give-item" novalidate><div class="form-grid">
      ${field({ id: 'gi-base', label: 'Item', control: select(itemOpts) })}
      ${field({ id: 'gi-q', label: 'Quality', control: select(opt('', 'Normal') + opt('relic', 'Relic')) })}
    </div>${formFoot('give-item', 'Give item')}</form>
    <h3>Give gems</h3>
    <form id="give-gem" novalidate><div class="form-grid">
      ${field({ id: 'gg-key', label: 'Gem', control: select(gemOpts) })}
      ${field({ id: 'gg-n', label: 'How many', control: input('type="number" min="1" max="99" value="1"') })}
    </div>${formFoot('give-gem', 'Give gems')}</form>
    <h3>Inventory (${c.inventory.length})</h3>
    ${dataTable({
      label: 'Inventory', empty: 'The pack is empty.',
      cols: [{ label: 'Item', lead: true }, { label: 'Slot' }, { label: 'Gems' }, { label: 'Actions', act: true, sr: true }],
      rows: c.inventory.map((i) => {
        const d = itemDef(i);
        return [`${esc(d?.name || i.base)}${equipped.has(i.uid) ? ' <span class="pill moderator">equipped</span>' : ''}`, esc(SLOT_LABEL[d?.slot] || ''), esc(i.gems.join(', ') || 'None'),
          `<button class="btn sm danger" data-a="removeItem" data-v="${i.uid}">Remove<span class="sr-only"> ${esc(d?.name || i.base)}</span></button>`];
      }),
    })}
    <h3>Gems</h3><p class="small">${Object.entries(c.gems).map(([k, cnt]) => `${esc(k)} x${cnt}`).join(', ') || 'None'}</p>
  </section>`;
}

function viewPlayer() {
  const { player: p, history, actions, email } = st.player;
  const c = p.data;
  return `<div class="acts flush"><button class="btn sm" data-a="back">Back to search</button></div>
    <section class="box gap-top" aria-labelledby="player-title"><h2 id="player-title" tabindex="-1">${esc(p.name)} ${sanctionPills(p)}</h2>
      <p class="note">Level ${c.level} ${RACES[c.race]?.name || ''}, in ${esc(ZONES[c.loc.zone]?.name || c.loc.zone)} at ${c.loc.x}, ${c.loc.y}. Last seen ${ago(p.updated_at)}. Created ${when(p.created_at)}.${email ? ` Email: ${esc(email)}.` : ''}</p>
      <p class="small">Gold ${fmt(c.gold)} carried, ${fmt(c.bank)} banked. Kills ${fmt(c.kills)}, deaths ${fmt(c.deaths)}, quests ${fmt(c.questsDone || 0)}, duels won ${fmt(c.pvpWins || 0)}.</p>
    </section>
    <section class="box" aria-labelledby="mod-title"><h2 id="mod-title">Moderation</h2>
      <p class="small">${sanctionSummary(p)}</p>
      ${sanctionForm(p, 'sanction')}
    </section>
    ${isAdmin() ? editBox(p) : ''}
    <div class="cols">
      <section class="box" aria-labelledby="hist-title"><h2 id="hist-title">Sanction history</h2>${dataTable({
        label: 'Sanction history', empty: 'None.',
        cols: [{ label: 'Action', lead: true }, { label: 'Reason' }, { label: 'By' }, { label: 'When' }],
        rows: (history || []).map((h) => [`<b>${esc(h.kind)}</b>${h.until ? ` <span class="sub">${untilText(h.until)}</span>` : ''}`, esc(h.reason), esc(shortName(h.by_name)), ago(h.created_at)]),
      })}</section>
      <section class="box" aria-labelledby="acts-title"><h2 id="acts-title">Staff actions</h2>${dataTable({
        label: 'Staff actions on this hero', empty: 'None.',
        cols: [{ label: 'Action', lead: true }, { label: 'Details' }, { label: 'By' }, { label: 'When' }],
        rows: (actions || []).map((a) => [`<b>${esc(a.action)}</b>`, esc(detailsText(a.action, a.details)), esc(shortName(a.actor_name)), ago(a.created_at)]),
      })}</section>
    </div>`;
}

function viewAnnounce() {
  const ev = st.events;
  return `<form id="announce" class="box" novalidate>
      <h2>Post an announcement</h2>
      <div class="form-grid">${field({ id: 'ann-text', label: 'Message', wide: true, hint: 'Shown at the top of every player\'s Explore screen for three days, and in the quest board news. Up to 300 characters.', control: textarea('', 'maxlength="300" required') })}</div>
      ${formFoot('announce', 'Post')}
    </form>
    <section class="box" aria-labelledby="news-title"><h2 id="news-title">Recent news</h2>${!ev ? '<p class="note">Loading.</p>' : dataTable({
      label: 'Recent news', empty: 'No news yet.',
      cols: [{ label: 'News', lead: true }, { label: 'Kind' }, { label: 'When' }, ...(isAdmin() ? [{ label: 'Actions', act: true, sr: true }] : [])],
      rows: ev.map((e) => [esc(e.text), esc(e.kind), ago(e.created_at), ...(isAdmin() ? [`<button class="btn sm danger" data-a="deleteEvent" data-v="${e.id}">Delete<span class="sr-only"> news item</span></button>`] : [])]),
    })}</section>`;
}

function viewLog() {
  const log = st.log;
  return `<section class="box" aria-labelledby="log-title"><h2 id="log-title">Staff audit log</h2>${!log ? '<p class="note">Loading.</p>' : dataTable({
    label: 'Staff audit log', empty: 'No staff actions yet.',
    cols: [{ label: 'Action', lead: true }, { label: 'Target' }, { label: 'Details' }, { label: 'By' }, { label: 'When' }],
    rows: log.map((l) => [`<b>${esc(l.action)}</b>`, l.target_id ? playerLink(l.target_id, l.target_name || 'player') : esc(l.target_name || ''),
      esc(detailsText(l.action, l.details)), esc(shortName(l.actor_name)), ago(l.created_at)]),
  })}</section>`;
}

function viewStaff() {
  const list = st.staff;
  return `<section class="box" aria-labelledby="staff-title"><h2 id="staff-title">Staff</h2>${!list ? '<p class="note">Loading.</p>' : dataTable({
      label: 'Staff', cols: [{ label: 'Email', lead: true }, { label: 'Role' }, { label: 'Since' }, { label: 'Actions', act: true, sr: true }],
      rows: list.map((s) => [esc(s.email), `<span class="pill ${s.role}">${s.role}</span>`, when(s.created_at),
        s.email !== st.me.email ? `<button class="btn sm danger" data-a="removeStaff" data-v="${esc(s.email)}">Remove<span class="sr-only"> ${esc(s.email)}</span></button>` : '<span class="note">You</span>']),
    })}</section>
    <form id="addstaff" class="box" novalidate><h2>Add staff</h2>
      <div class="form-grid">
        ${field({ id: 'st-email', label: 'Email', hint: 'They must have signed up in the game first.', control: input('type="email" required autocomplete="off"') })}
        ${field({ id: 'st-role', label: 'Role', hint: 'Moderators handle players and chat; admins can also change the world and staff.', control: select(opt('moderator', 'Moderator') + opt('admin', 'Admin')) })}
      </div>
      ${formFoot('addstaff', 'Add')}
    </form>`;
}

function multInputs(prefix, values = {}, placeholder = '1') {
  return MULT_KEYS.map((k) => field({ id: `${prefix}-${k}`, label: MULT_LABEL[k], control: input(`name="${prefix}.${k}" type="number" step="0.1" min="0" max="${MULT_MAX}" value="${values[k] ?? ''}" placeholder="${placeholder}"`) })).join('');
}

function viewWorld() {
  const w = st.world;
  if (!w) return '<p class="note">Loading.</p>';
  const now = Date.now();
  const events = (w.data.events || []).filter((e) => new Date(e.until).getTime() > now);
  const admin = isAdmin();
  return `<section class="box" aria-labelledby="ev-title"><h2 id="ev-title">Active events</h2>${dataTable({
      label: 'Active events', empty: 'No events running.',
      cols: [{ label: 'Event', lead: true }, { label: 'Bonuses' }, { label: 'Ends' }, ...(admin ? [{ label: 'Actions', act: true, sr: true }] : [])],
      rows: events.map((e) => [`<b>${esc(e.name)}</b>`, MULT_KEYS.filter((k) => e[k] != null).map((k) => `${MULT_LABEL[k]} x${e[k]}`).join(', '), when(e.until),
        ...(admin ? [`<button class="btn sm danger" data-a="endEvent" data-v="${e.id}">End now<span class="sr-only"> ${esc(e.name)}</span></button>`] : [])]),
    })}</section>
    ${admin ? `<form id="event" class="box" novalidate><h2>Start an event</h2>
      <p class="note">Multipliers stack on top of the base settings. Leave a box empty to leave it alone. Players see a banner and an announcement.</p>
      <div class="form-grid">
        ${field({ id: 'ev-name', label: 'Name', wide: true, control: input('name="name" required maxlength="60" placeholder="Double XP weekend"') })}
        ${field({ id: 'ev-hours', label: 'Hours', hint: 'From 0.25 (15 minutes).', control: input('name="hours" type="number" min="0.25" step="0.25" value="24" required') })}
        ${multInputs('m', {}, 'unchanged')}
      </div>${formFoot('event', 'Start event')}</form>
    <form id="base" class="box" novalidate><h2>Base settings</h2>
      <p class="note">Always in effect. 1 is normal, 2 is double, 0.5 is half. Maximum ${MULT_MAX}.</p>
      <div class="form-grid">${multInputs('b', w.data.base)}</div>${formFoot('base', 'Save')}</form>`
    : `<section class="box"><h2>Base settings</h2><p class="small">${MULT_KEYS.map((k) => `${MULT_LABEL[k]} x${w.data.base?.[k] ?? 1}`).join(', ')}</p><p class="note">Only admins can change world settings.</p></section>`}`;
}

function viewHunts() {
  const h = st.hunts;
  if (!h) return '<p class="note">Loading.</p>';
  const now = Date.now();
  const status = (x) => (x.status === 'active' && new Date(x.ends_at).getTime() < now ? 'expired' : x.status);
  const zoneOpts = Object.values(ZONES).map((z) => opt(z.id, `${z.name} (level ${z.levelRange[0]} to ${z.levelRange[1]})`)).join('');
  const admin = isAdmin();
  return `${admin ? `<form id="hunt" class="box" novalidate><h2>Start a hunt</h2>
      <p class="note">A world boss with one shared health pool. Everyone who hits it shares the gold and XP by damage done (2% minimum); the killing blow also earns a relic and 25% extra gold. Rewards arrive in players' banks.</p>
      <div class="form-grid">
        ${field({ id: 'h-name', label: 'Boss name', wide: true, control: input('name="name" required maxlength="60" placeholder="The Ashen Colossus"') })}
        ${field({ id: 'h-zone', label: 'Zone', wide: true, control: select(zoneOpts, 'name="zone"') })}
        ${field({ id: 'h-level', label: 'Level', control: input('name="level" type="number" min="1" value="20" required') })}
        ${field({ id: 'h-hp', label: 'Health', hint: 'Blank for a suggested value (about 300 hits from heroes at its level).', control: input('name="hp" type="number" min="1000" placeholder="suggested"') })}
        ${field({ id: 'h-hours', label: 'Hours', control: input('name="hours" type="number" min="0.25" step="0.25" value="24" required') })}
        ${field({ id: 'h-gold', label: 'Gold pool', control: input('name="gold" type="number" min="0" value="20000"') })}
        ${field({ id: 'h-xp', label: 'XP pool', control: input('name="xp" type="number" min="0" value="20000"') })}
        ${field({ id: 'h-relic', label: 'Relic for the killer', control: select(opt('yes', 'Yes') + opt('no', 'No'), 'name="relic"') })}
      </div>${formFoot('hunt', 'Start hunt')}</form>` : ''}
    <section class="box" aria-labelledby="hunts-title"><h2 id="hunts-title">Hunts</h2>${dataTable({
      label: 'Hunts', empty: 'No hunts yet.',
      cols: [{ label: 'Boss', lead: true }, { label: 'Status' }, { label: 'Zone' }, { label: 'Health', num: true }, { label: 'Hunters', num: true }, { label: 'Top damage' }, ...(admin ? [{ label: 'Actions', act: true, sr: true }] : [])],
      rows: h.map((x) => [`<b>${esc(x.name)}</b><span class="sub">Level ${x.level}</span>`,
        `${status(x)}<span class="sub">${x.status === 'active' ? `Ends ${when(x.ends_at)}` : x.killed_by_name ? `Killed by ${esc(x.killed_by_name)}` : ''}</span>`,
        esc(ZONES[x.zone]?.name || x.zone), `${fmt(x.hp)} / ${fmt(x.max_hp)}`, x.hunters,
        x.top.map((t) => `${esc(t.name)} ${fmt(t.damage)}`).join(', ') || '',
        ...(admin ? [status(x) === 'active' ? `<button class="btn sm danger" data-a="cancelHunt" data-v="${x.id}">Cancel<span class="sr-only"> ${esc(x.name)}</span></button>` : ''] : [])]),
    })}</section>`;
}

const LEDGER_LABEL = {
  monsters: 'Monster loot', quests: 'Quest rewards', hunt: 'Hunt rewards', selling: 'Selling to shops', admin: 'Admin edits',
  shop: 'Shop purchases', healer: 'Healer', jeweler: 'Jeweler', death: 'Lost on death',
};

function viewEconomy() {
  const e = st.economy;
  if (!e) return '<p class="note">Loading.</p>';
  const days = [...new Set(e.rows.map((r) => r.day))].sort().reverse();
  const sources = [...new Set(e.rows.map((r) => r.source))];
  const total = (src) => e.rows.filter((r) => r.source === src).reduce((a, r) => a + Number(r.amount), 0);
  const inflow = sources.filter((s) => total(s) > 0).sort((a, b) => total(b) - total(a));
  const outflow = sources.filter((s) => total(s) < 0).sort((a, b) => total(a) - total(b));
  const sum = (list) => list.reduce((a, s) => a + total(s), 0);
  const net = sum(inflow) + sum(outflow);
  const flowTable = (label, list) => dataTable({ label, empty: 'Nothing yet.', cols: [{ label: 'Source', lead: true }, { label: 'Gold', num: true }], rows: list.map((s) => [esc(LEDGER_LABEL[s] || s), fmt(Math.abs(total(s)))]) });
  return `<div class="tiles">
      <div class="tile"><b class="good">${fmt(sum(inflow))}</b><span>Gold created (14 days)</span></div>
      <div class="tile"><b class="bad">${fmt(-sum(outflow))}</b><span>Gold removed (14 days)</span></div>
      <div class="tile"><b>${net >= 0 ? '+' : ''}${fmt(net)}</b><span>Net change</span></div>
      ${st.stats ? `<div class="tile"><b>${fmt(st.stats.goldCarried + st.stats.goldBanked)}</b><span>Gold in the world now</span></div>` : ''}
    </div>
    <div class="cols">
      <section class="box"><h2>Where gold comes from</h2>${flowTable('Where gold comes from', inflow)}</section>
      <section class="box"><h2>Where gold goes</h2>${flowTable('Where gold goes', outflow)}
        <p class="note">Gold moved between players (duels) and to or from the bank isn't counted.</p></section>
    </div>
    <section class="box"><h2>By day</h2>${dataTable({
      label: 'Gold by day', empty: 'No activity recorded yet.',
      cols: [{ label: 'Day', lead: true }, { label: 'In', num: true }, { label: 'Out', num: true }, { label: 'Net', num: true }],
      rows: days.map((d) => {
        const rows = e.rows.filter((r) => r.day === d);
        const inn = rows.filter((r) => r.amount > 0).reduce((a, r) => a + Number(r.amount), 0);
        const out = rows.filter((r) => r.amount < 0).reduce((a, r) => a + Number(r.amount), 0);
        return [d, `<span class="good">${fmt(inn)}</span>`, `<span class="bad">${fmt(-out)}</span>`, fmt(inn + out)];
      }),
    })}</section>`;
}

// ---- Chat moderation: reports first, each with an inline review of the sender, so a moderator
// can go from a report to a sanction without leaving it. Every step stays an explicit choice.
const channelText = (m) => (m.channel === 'zone' ? `zone ${esc(ZONES[m.zone]?.name || m.zone)}` : m.channel === 'whisper' ? `whisper to ${esc(m.recipient_name)}` : 'global');
function messageText(m) {
  return m.deleted_at ? `<span class="faint">[removed by ${esc(shortName(m.deleted_by))}]</span> <span class="small faint">${esc(m.original_text || '')}</span>` : esc(m.text);
}

function reviewPanel(r) {
  const rv = st.reviews[r.id];
  const m = r.message;
  if (!rv?.open) return '';
  if (rv.loading || !rv.player) return `<div class="review" id="review-${r.id}" aria-busy="true"><p class="note">Loading ${esc(m.sender_name)}'s record.</p></div>`;
  const p = rv.player.player;
  const recent = (rv.player.history || []).slice(0, 3);
  const prefill = `Chat (${channelText(m).replace(/<[^>]+>/g, '')}): "${(m.original_text || m.text || '').slice(0, 120)}"${r.reason ? ` - reported: ${r.reason}` : ''}`;
  return `<div class="review" id="review-${r.id}">
      <h3 id="review-${r.id}-title" tabindex="-1">Review ${esc(p.name)}</h3>
      <p class="review-sum"><span>Level ${p.level} ${esc(RACES[p.race]?.name || '')}</span><span>${sanctionPills(p) || 'No active sanctions'}</span><span>${p.strikes || 0} ${p.strikes === 1 ? 'strike' : 'strikes'}</span></p>
      ${recent.length ? `<p class="note">Recent: ${recent.map((h) => `${esc(h.kind)} ${ago(h.created_at)} (${esc(h.reason)})`).join('; ')}</p>` : ''}
      ${rv.done ? `<p class="status-line" role="status">${esc(rv.done)}</p>` : ''}
      ${sanctionForm(p, `sanction-r${r.id}`, { reason: rv.done ? '' : prefill })}
      <div class="acts"><button class="btn sm" data-a="open" data-v="${esc(p.id)}">Open full record<span class="sr-only"> of ${esc(p.name)}</span></button></div>
    </div>`;
}

function reportCard(r) {
  const m = r.message;
  if (!m) {
    return `<article class="report"><p class="report-msg faint">The message is gone.</p><p class="report-meta">Reported by ${esc(r.reporter_name || '')} ${ago(r.created_at)}${r.reason ? `: "${esc(r.reason)}"` : ''}.</p>
      <div class="acts"><button class="btn sm" data-a="resolveReport" data-v="${r.id}">Dismiss report</button></div></article>`;
  }
  const open = !!st.reviews[r.id]?.open;
  return `<article class="report" aria-labelledby="rep-${r.id}">
      <p class="report-msg" id="rep-${r.id}"><b>${esc(m.sender_name)}</b>${m.sender_role ? ` <span class="pill ${m.sender_role}">${m.sender_role}</span>` : ''}: ${messageText(m)}</p>
      <p class="report-meta">${channelText(m)}, ${ago(m.created_at)}. Reported by ${esc(r.reporter_name || 'a player')} ${ago(r.created_at)}${r.reason ? `: "${esc(r.reason)}"` : ' (no reason given)'}.</p>
      <div class="acts">
        ${m.sender_id ? `<button class="btn sm${open ? '' : ' primary'}" data-a="review" data-v="${r.id}" aria-expanded="${open}" aria-controls="review-${r.id}">${open ? 'Close review' : 'Review sender'}<span class="sr-only"> ${esc(m.sender_name)}</span></button>` : ''}
        ${!m.deleted_at ? `<button class="btn sm danger" data-a="chatDelete" data-v="${m.id}">Remove message</button>` : ''}
        <button class="btn sm" data-a="resolveReport" data-v="${r.id}">Dismiss report</button>
      </div>
      ${reviewPanel(r)}
    </article>`;
}

function viewChat() {
  const reports = st.reports;
  const msgs = st.chat;
  const q = st.chatQ;
  return `<section class="box" aria-labelledby="reports-title"><div class="box-head"><h2 id="reports-title" tabindex="-1">Open reports${reports ? ` (${reports.length})` : ''}</h2></div>
      ${!reports ? '<p class="note">Loading.</p>' : !reports.length ? '<p class="note">No open reports.</p>' : reports.map(reportCard).join('')}</section>
    <section class="box" aria-labelledby="history-title"><h2 id="history-title">Chat history</h2>
      <form id="chatsearch" novalidate>
        <p class="note">The last 14 days, including whispers. Removed messages keep their original text here.</p>
        <div class="form-grid">
          ${field({ id: 'cs-channel', label: 'Channel', control: select(opt('', 'All', q.channel || '') + ['global', 'zone', 'whisper'].map((c) => opt(c, c[0].toUpperCase() + c.slice(1), q.channel)).join(''), 'name="channel"') })}
          ${field({ id: 'cs-sender', label: 'Sender', control: input(`name="sender" value="${esc(q.sender || '')}" autocomplete="off"`) })}
          ${field({ id: 'cs-q', label: 'Text contains', control: input(`name="q" value="${esc(q.q || '')}" autocomplete="off"`) })}
        </div>
        <div class="form-foot"><button class="btn primary" type="submit">Search</button></div>
      </form>
      ${!msgs ? '<p class="note">Loading.</p>' : dataTable({
        label: 'Chat messages', empty: 'No messages.',
        cols: [{ label: 'Message', lead: true }, { label: 'Where' }, { label: 'When' }, { label: 'Actions', act: true, sr: true }],
        rows: msgs.map((m) => [
          `${m.sender_id ? playerLink(m.sender_id, m.sender_name) : esc(m.sender_name)}${m.sender_role ? ` <span class="pill ${m.sender_role}">${m.sender_role}</span>` : ''}: ${messageText(m)}`,
          channelText(m), ago(m.created_at),
          !m.deleted_at ? `<button class="btn sm danger" data-a="chatDelete" data-v="${m.id}">Remove<span class="sr-only"> message from ${esc(m.sender_name)}</span></button>` : '',
        ]),
      })}
    </section>`;
}

// ---- Keyboard focus and typed values across full re-renders.
// A stable selector for the focused control, so focus can move to its replacement.
function focusKey(el) {
  if (!el || el === document.body || !el.dataset) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const d = el.dataset;
  const v = d.v != null ? `[data-v="${CSS.escape(d.v)}"]` : ':not([data-v])';
  if (d.a) return `[data-a="${CSS.escape(d.a)}"]${v}`;
  if (d.f) return `[data-f="${CSS.escape(d.f)}"]`;
  if (d.toggle) return `[data-toggle="${CSS.escape(d.toggle)}"]`;
  if (d.list) return `[data-list="${CSS.escape(d.list)}"][value="${CSS.escape(el.value)}"]`;
  if (d.owpick) return `[data-owpick="${CSS.escape(d.owpick)}"]`;
  if (el.name && el.form?.id) return `#${CSS.escape(el.form.id)} [name="${CSS.escape(el.name)}"]`;
  if (el.type === 'submit' && el.form?.id) return `#${CSS.escape(el.form.id)} [type="submit"]`;
  return null;
}
const usable = (el) => !!el && el.isConnected && !el.disabled && el.getClientRects().length > 0;

// What people have typed into forms survives re-renders caused by data arriving elsewhere
// (the zone editor keeps its own working copy and is left alone).
function snapshotForms(root) {
  const out = new Map();
  for (const el of root.querySelectorAll('form[id] input, form[id] select, form[id] textarea')) {
    const form = el.form;
    if (!form || form.id === 'zone-form' || st.clearForms.has(form.id)) continue;
    const key = `${form.id}::${el.id || el.name}`;
    if (!el.id && !el.name) continue;
    out.set(key, el.type === 'checkbox' || el.type === 'radio' ? { checked: el.checked } : { value: el.value });
  }
  return out;
}
function restoreForms(root, saved) {
  for (const el of root.querySelectorAll('form[id] input, form[id] select, form[id] textarea')) {
    const s = saved.get(`${el.form?.id}::${el.id || el.name}`);
    if (!s) continue;
    if ('checked' in s) el.checked = s.checked; else if (el.value !== s.value) el.value = s.value;
  }
}

function render() {
  const root = $('#admin');
  const activeEl = document.activeElement;
  const hadFocus = activeEl && root.contains(activeEl);
  const key = hadFocus ? focusKey(activeEl) : null;
  const caret = hadFocus && 'selectionStart' in activeEl ? [activeEl.selectionStart, activeEl.selectionEnd] : null;
  const saved = snapshotForms(root);
  let html;
  if (st.phase === 'loading') html = '<div class="intro"><h1>ClickMonster Admin</h1><p>Loading</p></div>';
  else if (st.phase === 'login') html = viewLogin();
  else if (st.phase === 'denied') html = viewDenied();
  else {
    const body = { dashboard: viewDashboard, players: viewPlayers, world: viewWorld, hunts: viewHunts, economy: viewEconomy, zones: zones.view, chat: viewChat, announce: viewAnnounce, log: viewLog, staff: viewStaff }[st.tab]();
    const section = st.tab === 'players' && st.player ? `Player: ${st.player.player.name}` : SECTION_LABEL[st.tab] || st.tab;
    const group = GROUPS.find((g) => g.id === groupOf(st.tab));
    html = `<div class="a-shell">${header()}${nav()}<div class="a-main">
      <div class="a-section-head"><h2 id="section-title" tabindex="-1">${esc(section)}</h2><span class="a-crumb">${esc(group?.label || '')}</span></div>
      ${body}</div></div>`;
  }
  root.innerHTML = html;
  restoreForms(root, saved);
  st.clearForms.clear();
  markPending(root);

  // 1. An explicit target (e.g. a record that just loaded) waits until it exists.
  if (st.focusNext) {
    const target = $(st.focusNext);
    if (usable(target)) { target.focus({ preventScroll: true }); st.focusNext = null; return; }
  }
  if (!hadFocus) return;
  // 2. The same control after the re-render.
  const again = key && root.querySelector(key);
  if (usable(again)) {
    again.focus({ preventScroll: true });
    if (caret && 'setSelectionRange' in again) { try { again.setSelectionRange(...caret); } catch { /* not a text field */ } }
    return;
  }
  // 3. Otherwise the section heading, so focus never drops to the page body.
  $('#section-title')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- routing
// Each section (and an open player record or zone) has its own address, so a link or a reload
// lands in the same place and the browser's Back button works.
function route() {
  if (st.tab === 'players' && st.player) return `#player/${st.player.player.id}`;
  if (st.tab === 'zones' && st.zoneEdit && !st.zoneEdit.isNew) return `#zone/${st.zoneEdit.originalId}`;
  return `#${st.tab}`;
}
function pushRoute() { if (location.hash !== route()) history.pushState(null, '', route()); }
async function applyRoute() {
  const [kind, id] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (kind === 'player' && id) { await openPlayer(id, { push: false }); return; }
  if (kind === 'zone' && id) { st.tab = 'zones'; st.navGroup = 'content'; st.zoneEdit = null; render(); await zones.load(); zones.edit(id); return; }
  const tab = SECTION_LABEL[kind] && (kind !== 'staff' || isAdmin()) ? kind : 'dashboard';
  showTab(tab, { push: false });
}
window.addEventListener('popstate', () => { if (st.phase === 'ready') applyRoute(); });

function showTab(tab, { push = true } = {}) {
  st.tab = tab;
  st.player = null;
  st.navGroup = groupOf(tab);
  if (tab !== 'zones') st.zoneEdit = null;
  render();
  if (push) pushRoute();
  load(tab);
}

// ---------------------------------------------------------------- loading
async function load(tab = st.tab) {
  try {
    if (tab === 'dashboard') st.stats = await call('stats');
    if (tab === 'players' && !st.player) st.players = (await call('search', { q: st.q })).players;
    if (tab === 'announce') st.events = (await call('events')).events;
    if (tab === 'log') st.log = (await call('log')).log;
    if (tab === 'staff') st.staff = (await call('staff')).staff;
    if (tab === 'zones') { if (!st.zoneEdit) await zones.load(); return; }
    if (tab === 'chat') {
      const [log, rep] = await Promise.all([call('chatLog', st.chatQ), call('chatReports')]);
      st.chat = log.messages;
      st.reports = rep.reports;
    }
    if (tab === 'world') st.world = await call('world');
    if (tab === 'hunts') st.hunts = (await call('hunts')).hunts;
    if (tab === 'economy') { st.economy = await call('economy'); if (!st.stats) st.stats = await call('stats'); }
  } catch (e) { toast(e.message, true); }
  render();
}

async function openPlayer(id, { push = true } = {}) {
  // Remember how we got here so "Back to search" can return focus to this player's link.
  st.returnFocus = `.row-link[data-v="${CSS.escape(id)}"]`;
  st.tab = 'players';
  st.navGroup = 'people';
  st.player = null;
  render();
  try {
    st.player = await call('player', { id });
    st.focusNext = '#player-title';
  } catch (e) { toast(e.message, true); }
  render();
  if (push) pushRoute();
  window.scrollTo(0, 0);
}

async function editPlayer(patch, msg = 'Saved.', formId = null) {
  try {
    await call('update', { id: st.player.player.id, patch });
    st.player = await call('player', { id: st.player.player.id });
    if (formId) { delete st.formErrors[formId]; st.clearForms.add(formId); }
    toast(msg);
  } catch (e) {
    if (formId) st.formErrors[formId] = e.message; else toast(e.message, true); // keep the form as filled in
  }
  render();
}

// ---------------------------------------------------------------- forms: validation and pending
// Client-side checks only explain; the server checks everything again.
function checkForm(id, form) {
  const errs = {};
  const val = (sel) => (form.querySelector(sel)?.value ?? '').trim();
  const num = (v) => (v === '' ? null : Number(v));
  if (id === 'sanction' || id.startsWith('sanction-r')) {
    const ids = id === 'sanction' ? { kind: 's-kind', days: 's-days', reason: 's-reason' } : { kind: `${id}-kind`, days: `${id}-days`, reason: `${id}-reason` };
    const kind = val(`#${ids.kind}`);
    const days = num(val(`#${ids.days}`));
    if (!val(`#${ids.reason}`)) errs[ids.reason] = 'Give a reason. It goes on their record.';
    if (['mute', 'jail', 'ban'].includes(kind)) {
      if (days != null && (!Number.isFinite(days) || days < 0)) errs[ids.days] = 'Enter a number of days, 0 or more (blank or 0 means permanent).';
      else if (!isAdmin() && (days == null || days <= 0)) errs[ids.days] = 'Only admins can sanction permanently. Enter up to 7 days.';
      else if (!isAdmin() && days > MOD_MAX_DAYS) errs[ids.days] = `Moderators can sanction for up to ${MOD_MAX_DAYS} days. Ask an admin for longer.`;
    }
  }
  if (id === 'announce' && !val('#ann-text')) errs['ann-text'] = 'Write the message players will see.';
  if (id === 'addstaff' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('#st-email'))) errs['st-email'] = 'Enter the email address they play with.';
  if (id === 'event') {
    if (!val('#ev-name')) errs['ev-name'] = 'Give the event a name players will see.';
    const h = num(val('#ev-hours'));
    if (h == null || !(h >= 0.25)) errs['ev-hours'] = 'Enter at least 0.25 hours.';
  }
  if (id === 'hunt') {
    if (!val('#h-name')) errs['h-name'] = 'Give the boss a name.';
    const lvl = num(val('#h-level'));
    if (lvl == null || !(lvl >= 1)) errs['h-level'] = 'Enter a level of 1 or more.';
    const hp = num(val('#h-hp'));
    if (hp != null && !(hp >= 1000)) errs['h-hp'] = 'Leave blank for the suggested value, or enter at least 1,000.';
    const hrs = num(val('#h-hours'));
    if (hrs == null || !(hrs >= 0.25)) errs['h-hours'] = 'Enter at least 0.25 hours.';
  }
  if (id === 'base' || id === 'event') {
    for (const k of MULT_KEYS) {
      const fid = `${id === 'event' ? 'm' : 'b'}-${k}`;
      const v = num(val(`#${fid}`));
      if (v != null && (!Number.isFinite(v) || v < 0 || v > MULT_MAX)) errs[fid] = `Between 0 and ${MULT_MAX}.`;
    }
  }
  if (id === 'give-gem') { const n = num(val('#gg-n')); if (n == null || !(n >= 1 && n <= 99)) errs['gg-n'] = 'Between 1 and 99.'; }
  if (id === 'edit') {
    for (const el of form.querySelectorAll('input[type="number"]')) {
      const v = num(el.value.trim());
      const min = el.min === '' ? null : Number(el.min);
      const max = el.max === '' ? null : Number(el.max);
      if (v == null || !Number.isFinite(v)) errs[el.id] = 'Enter a number.';
      else if (min != null && v < min) errs[el.id] = `At least ${min}.`;
      else if (max != null && v > max) errs[el.id] = `At most ${max}.`;
    }
  }
  return errs;
}

// Shows inline errors (or clears them); returns true when the form can be sent.
function validate(id, form) {
  const errs = checkForm(id, form);
  st.fieldErrors = { ...(st.fieldErrors || {}) };
  for (const el of form.querySelectorAll('[id]')) delete st.fieldErrors[el.id];
  Object.assign(st.fieldErrors, errs);
  if (!Object.keys(errs).length) return true;
  render();
  document.getElementById(Object.keys(errs)[0])?.focus();
  return false;
}

// Button actions that change data. Each runs once at a time per target: the key names the
// action and what it acts on, so other buttons (and other targets) are never blocked or cleared.
const MUTATIONS = new Set(['quick', 'removeItem', 'deleteEvent', 'chatDelete', 'resolveReport', 'endEvent', 'cancelHunt', 'removeStaff']);
function actionKey(a, v) {
  if (!MUTATIONS.has(a)) return null;
  return a === 'quick' || a === 'removeItem' ? `${a}:${st.player?.player.id}:${v}` : `${a}:${v}`;
}
// Draws the pending look on every button whose action is in flight, after any re-render.
function markPending(root) {
  if (!st.pendingForms.size) return;
  for (const el of root.querySelectorAll('[data-a][data-v]')) {
    if (st.pendingForms.has(actionKey(el.dataset.a, el.dataset.v))) { el.classList.add('pending'); el.setAttribute('aria-busy', 'true'); }
  }
}
// Runs a button action's request under its key. A failure stays on screen as a problem; the
// button is usable again either way.
async function pendingWhile(key, fn) {
  st.pendingForms.add(key);
  render();
  try {
    await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    st.pendingForms.delete(key);
  }
  render();
}

// True (and says so) while this form's request is still running, so a second press sends nothing.
function stillWorking(id) {
  if (!st.pendingForms.has(id)) return false;
  toast('Still working on the last request.');
  return true;
}

// Runs a form's request once at a time, showing it as pending; a server error stays in the form.
// Each form has its own pending flag, so requests from different forms can overlap without one
// finishing and clearing the other's.
async function submitting(id, fn) {
  if (stillWorking(id)) return;
  st.pendingForms.add(id);
  delete st.formErrors[id];
  render();
  try {
    await fn();
  } catch (err) {
    st.formErrors[id] = err.message;
  } finally {
    st.pendingForms.delete(id);
  }
  render();
  if (st.formErrors[id]) document.getElementById(`${id}-error`)?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- events
const zones = setupZones({ st, call, toast, render, esc, isAdmin, field, input, pushRoute });
document.addEventListener('input', (e) => {
  zones.onInput(e);
  // Typing fixes an inline error: clear it for that field once it is valid again.
  const el = e.target;
  if (el.id && st.fieldErrors?.[el.id] && el.form) {
    const errs = checkForm(el.form.id, el.form);
    if (!errs[el.id]) { delete st.fieldErrors[el.id]; el.removeAttribute('aria-invalid'); document.getElementById(`${el.id}-err`)?.remove(); el.setAttribute('aria-describedby', (el.getAttribute('aria-describedby') || '').replace(`${el.id}-err`, '').trim()); }
  }
});
document.addEventListener('change', (e) => { if (e.target.dataset.toggle || e.target.dataset.list || e.target.tagName === 'SELECT') zones.onInput(e); });

async function toggleReview(rid) {
  const r = st.reports?.find((x) => String(x.id) === String(rid));
  if (!r) return;
  const rv = st.reviews[r.id] || (st.reviews[r.id] = {});
  rv.open = !rv.open;
  if (!rv.open) { render(); return; }
  if (!rv.player) {
    rv.loading = true;
    render();
    try { rv.player = await call('player', { id: r.message.sender_id }); } catch (e) { rv.open = false; toast(e.message, true); }
    rv.loading = false;
  }
  st.focusNext = `#review-${r.id}-title`;
  render();
}

document.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-owpick]');
  if (pick) { zones.onPick(pick); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  const v = el.dataset.v;
  if (a.startsWith('zone') && await zones.onClick(a, v)) return;
  if (a === 'dismissProblem') {
    const i = problems.findIndex((p) => String(p.id) === v);
    if (i >= 0) problems.splice(i, 1);
    renderProblems();
    ($('#alerts [data-a="dismissProblem"]') || $('.a-tabs [aria-current]'))?.focus();
    return;
  }
  if (a === 'signout') { await sb.auth.signOut(); return; }
  if (a === 'navgroup') { st.navGroup = v; render(); $(`[data-a="navgroup"][data-v="${v}"]`)?.focus(); return; }
  if (a === 'tab') showTab(v);
  if (a === 'refresh') load();
  if (a === 'open') openPlayer(v);
  if (a === 'back') { st.player = null; st.focusNext = st.returnFocus || null; render(); pushRoute(); load('players'); }
  if (a === 'review') toggleReview(v);
  // A press while the same action on the same target is in flight: nothing is sent or asked.
  const key = actionKey(a, v);
  if (key && stillWorking(key)) return;
  if (a === 'quick') await pendingWhile(key, () => editPlayer({ [v]: true }));
  if (a === 'removeItem') {
    const p = st.player?.player;
    const item = p?.data.inventory.find((i) => String(i.uid) === v);
    const d = item && itemDef(item);
    if (await ask({
      title: `Remove ${d?.name || 'this item'} from ${p?.name || 'the hero'}?`,
      points: [`The item${item?.gems.length ? ' and the gems socketed in it are' : ' is'} deleted, not returned to the shop.`, 'The change is recorded in the audit log.'],
      confirm: 'Remove item', cancel: 'Keep it',
    })) await pendingWhile(key, () => editPlayer({ removeItem: Number(v) }, 'Item removed.'));
  }
  if (a === 'deleteEvent' && await ask({ title: 'Delete this news item?', points: ['It disappears from the news feed for every player.'], confirm: 'Delete', cancel: 'Keep it' })) {
    await pendingWhile(key, async () => {
      try { await call('deleteEvent', { id: v }); toast('Deleted.'); } finally { await load('announce'); }
    });
  }
  if (a === 'chatDelete' && await ask({ title: 'Remove this message for everyone?', points: ['Players see "message removed" in its place.', 'The original text stays in the moderation log.'], confirm: 'Remove message', cancel: 'Keep it' })) {
    await pendingWhile(key, async () => { await call('chatDelete', { id: v }); toast('Removed.'); await load('chat'); });
  }
  if (a === 'resolveReport') {
    // Pending until the refreshed list arrives, so the report can't be dismissed twice.
    await pendingWhile(key, async () => {
      await call('resolveReport', { id: v });
      delete st.reviews[v];
      toast('Report dismissed.');
      st.focusNext = '#reports-title';
      await load('chat');
    });
  }
  if (a === 'endEvent' && await ask({ title: 'End this event now?', points: ['Its bonuses stop for every player straight away.'], confirm: 'End event', cancel: 'Keep it running' })) {
    await pendingWhile(key, async () => { st.world = await call('endEvent', { id: v }); toast('Event ended.'); });
  }
  if (a === 'cancelHunt' && await ask({ title: 'Cancel this hunt?', points: ['The world boss disappears and nobody is rewarded, including players who already hit it.'], confirm: 'Cancel hunt', cancel: 'Keep it running' })) {
    await pendingWhile(key, async () => { await call('cancelHunt', { id: v }); toast('Hunt cancelled.'); await load('hunts'); });
  }
  if (a === 'removeStaff' && await ask({ title: `Remove ${v} from staff?`, points: ['They lose access to this console straight away.', 'They keep their player account.'], confirm: 'Remove from staff', cancel: 'Cancel' })) {
    await pendingWhile(key, async () => { st.staff = (await call('setStaff', { email: v, role: null })).staff; toast('Removed.'); });
  }
});

// What each role can do, as the admin edge function enforces it.
const MOD_POWERS = 'look up players and their records, warn, mute, jail or ban for up to 7 days, lift sanctions, post news, and review reports and remove chat messages';
const ADMIN_POWERS = 'everything a moderator can, and also edit heroes and their items, sanction for longer or permanently, change world settings, events and hunts, edit zones, delete news, see players’ email addresses, and add or remove staff';

// Granting staff access asks first. Admin is full control of the game, so the email is typed.
function staffQuestion(email, role) {
  const current = st.staff?.find((s) => s.email.toLowerCase() === email.toLowerCase())?.role;
  const admin = role === 'admin';
  const title = current && current !== role
    ? `Change ${email} from ${current} to ${role}?`
    : `Make ${email} ${admin ? 'an admin' : 'a moderator'}?`;
  const powers = admin
    ? `Admins can do ${ADMIN_POWERS}.`
    : `${current === 'admin' ? 'They lose their admin powers. ' : ''}Moderators can ${MOD_POWERS}.`;
  return {
    title,
    points: [powers, 'It takes effect straight away.', 'The change is recorded in the audit log.'],
    typeToConfirm: admin ? email : null,
    confirm: admin ? 'Make admin' : 'Make moderator', cancel: 'Cancel', tone: admin ? 'danger' : 'normal',
  };
}

async function applySanction(id, form) {
  const ids = id === 'sanction' ? { kind: 's-kind', days: 's-days', reason: 's-reason' } : { kind: `${id}-kind`, days: `${id}-days`, reason: `${id}-reason` };
  const kind = form.querySelector(`#${ids.kind}`).value;
  const daysRaw = form.querySelector(`#${ids.days}`).value.trim();
  const days = daysRaw === '' ? null : Number(daysRaw);
  const reason = form.querySelector(`#${ids.reason}`).value.trim();
  const name = form.dataset.name;
  const playerId = form.dataset.player;
  const timed = ['mute', 'jail', 'ban'].includes(kind);
  const permanent = timed && (days == null || days <= 0);
  const span = timed ? (permanent ? 'permanently' : `for ${days} ${days === 1 ? 'day' : 'days'}`) : '';
  const effect = {
    warn: 'It goes on their record as a strike. Players are not shown warnings in the game.',
    mute: "They can't send chat messages.",
    jail: 'They can look around but not act.',
    ban: "They can't play.",
    lift: 'Every active mute, jail and ban on them ends now.',
  }[kind];
  const ok = await ask({
    title: kind === 'lift' ? `Lift all sanctions on ${name}?` : `${kind[0].toUpperCase()}${kind.slice(1)} ${name}${span ? ` ${span}` : ''}?`,
    points: [effect, ...(reason ? [`${timed ? 'Reason shown to them' : 'Reason on their record'}: "${reason}"`] : []), 'The action is recorded in the audit log.'],
    // A permanent ban is the one sanction worth typing the name for.
    typeToConfirm: kind === 'ban' && permanent ? name : null,
    confirm: kind === 'lift' ? 'Lift sanctions' : `Apply ${kind}`, cancel: 'Cancel', tone: kind === 'lift' ? 'normal' : 'danger',
  });
  if (!ok) return;
  await submitting(id, async () => {
    await call('sanction', { id: playerId, kind, days, reason });
    const fresh = await call('player', { id: playerId });
    const done = kind === 'lift' ? 'Sanctions lifted.' : `${kind === 'warn' ? 'Warning recorded' : `${kind[0].toUpperCase()}${kind.slice(1)} applied ${span}`}.`;
    if (id === 'sanction') st.player = fresh;
    else {
      const rv = st.reviews[id.slice('sanction-r'.length)];
      if (rv) { rv.player = fresh; rv.done = `${done} The report is still open: dismiss it when you're finished.`; }
    }
    st.clearForms.add(id);
    toast(done);
  });
}

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.id;
  if (id === 'login') {
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    if (error) { st.loginMsg = error.message; render(); }
    return;
  }
  if (id === 'chatsearch') {
    const f = new FormData(form);
    st.chatQ = { channel: f.get('channel') || undefined, sender: f.get('sender') || undefined, q: f.get('q') || undefined };
    st.chat = null; render(); load('chat');
    return;
  }
  if (id === 'search') { st.q = $('#q').value; st.players = null; render(); load('players'); return; }
  // Before validating or asking anything: a press while this form is sending does nothing.
  if (stillWorking(id)) return;
  if (!validate(id, form)) return;
  if (id === 'sanction' || id.startsWith('sanction-r')) { await applySanction(id, form); return; }
  if (id === 'edit') {
    const f = new FormData(form);
    const patch = { stats: {}, masteries: {} };
    for (const k of ['level', 'xp', 'gold', 'bank', 'pendingLevels']) patch[k] = f.get(k);
    for (const s of STATS) patch.stats[s] = f.get(`stat.${s}`);
    for (const m of MASTERIES) patch.masteries[m] = f.get(`mastery.${m}`);
    const c = st.player.player.data;
    if (f.get('zone') !== c.loc.zone || Number(f.get('x')) !== c.loc.x || Number(f.get('y')) !== c.loc.y) {
      patch.loc = { zone: f.get('zone'), x: f.get('x'), y: f.get('y') };
    }
    await submitting(id, async () => { await call('update', { id: st.player.player.id, patch }); st.player = await call('player', { id: st.player.player.id }); st.clearForms.add(id); toast('Saved.'); });
  }
  if (id === 'give-item') await submitting(id, async () => { await call('update', { id: st.player.player.id, patch: { addItem: { base: $('#gi-base').value, q: $('#gi-q').value || null } } }); st.player = await call('player', { id: st.player.player.id }); toast('Item given.'); });
  if (id === 'give-gem') await submitting(id, async () => { await call('update', { id: st.player.player.id, patch: { addGem: { key: $('#gg-key').value, count: $('#gg-n').value } } }); st.player = await call('player', { id: st.player.player.id }); toast('Gems given.'); });
  if (id === 'announce') {
    await submitting(id, async () => { await call('announce', { text: $('#ann-text').value.trim() }); st.clearForms.add(id); toast('Posted.'); });
    load('announce');
  }
  if (id === 'event' || id === 'base') {
    const f = new FormData(form);
    const prefix = id === 'event' ? 'm' : 'b';
    const mults = {};
    for (const k of MULT_KEYS) { const v = f.get(`${prefix}.${k}`); if (v !== '' && v != null) mults[k] = Number(v); }
    await submitting(id, async () => {
      st.world = id === 'event'
        ? await call('startEvent', { name: f.get('name'), hours: Number(f.get('hours')), mults })
        : await call('setBase', { base: mults });
      if (id === 'event') st.clearForms.add(id);
      toast(id === 'event' ? 'Event started.' : 'Saved.');
    });
  }
  if (id === 'hunt') {
    const f = new FormData(form);
    if (!await ask({
      title: `Start the hunt for ${f.get('name')}?`,
      points: [`It appears for every player in ${ZONES[f.get('zone')]?.name || f.get('zone')} for ${f.get('hours')} hours.`, 'Rewards are paid when it is defeated.'],
      confirm: 'Start hunt', cancel: 'Cancel', tone: 'normal',
    })) return;
    await submitting(id, async () => {
      await call('startHunt', {
        name: f.get('name'), zone: f.get('zone'), level: f.get('level'), hp: f.get('hp') || null,
        hours: f.get('hours'), gold: f.get('gold'), xp: f.get('xp'), relic: f.get('relic') === 'yes',
      });
      st.clearForms.add(id);
      toast('Hunt started.');
    });
    load('hunts');
  }
  if (id === 'addstaff') {
    const email = $('#st-email').value.trim();
    const role = $('#st-role').value;
    if (!await ask(staffQuestion(email, role))) return;
    await submitting(id, async () => { st.staff = (await call('setStaff', { email, role })).staff; st.clearForms.add(id); toast('Added.'); });
  }
});

sb.auth.onAuthStateChange((event, session) => {
  setTimeout(async () => {
    if (!session) { st.phase = 'login'; st.me = null; render(); return; }
    if (st.me) return;
    st.email = session.user.email;
    try {
      st.me = await call('whoami');
      st.phase = 'ready';
      // The open-report count shows in the navigation from the start.
      call('chatReports').then((r) => { st.reports = r.reports; render(); }).catch(() => {});
      await applyRoute();
    } catch {
      st.phase = 'denied';
      render();
    }
  }, 0);
});

fetchZoneDefs().then((defs) => { if (defs) { loadZones(defs); render(); } }).catch(() => {});
render();
