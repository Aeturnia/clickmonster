// Admin and moderator console. All checks happen on the server (`admin` edge function);
// this page only renders what the server allows.
import { sb, fetchZoneDefs } from './net.js';
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
// After a confirmation whose button was re-rendered away: the section heading.
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
function detailsText(action, d) {
  if (!d) return '';
  if (action === 'edit') {
    return Object.entries(d).map(([k, v]) => (Array.isArray(v) ? `${k} ${JSON.stringify(v[0])} to ${JSON.stringify(v[1])}` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(', ');
  }
  if (action.startsWith('sanction:')) return `${d.reason || ''}${d.days ? ` (${d.days} days)` : d.until ? ' (permanent)' : ''}`;
  if (action === 'announce') return d.text;
  return JSON.stringify(d);
}
const untilText = (t) => (new Date(t).getFullYear() > 9000 ? 'permanent' : `until ${when(t)}`);

const st = { phase: 'loading', me: null, tab: 'dashboard', q: '', players: null, player: null, stats: null, log: null, events: null, staff: null, world: null, hunts: null, economy: null, zones: null, zoneEdit: null, chat: null, reports: null, chatQ: {}, focusNext: null, returnFocus: null };

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
  el.className = `show ${bad ? 'bad' : ''}`;
  el.style.top = 'auto';
  el.style.bottom = '24px';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

async function call(action, args = {}) {
  const { data, error } = await sb.functions.invoke('admin', { body: { action, args } });
  if (error) {
    let msg = 'Request failed.';
    let status = error.context?.status;
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

// ---------------------------------------------------------------- views
function viewLogin() {
  return `<div class="intro"><h1>ClickMonster Admin</h1><p>Staff sign in with their game account.</p></div>
    <form id="login" class="box" style="max-width:420px;margin:0 auto">
      <label class="field">Email<input id="email" type="email" autocomplete="email" required></label>
      <label class="field">Password<input id="password" type="password" autocomplete="current-password" required></label>
      ${st.loginMsg ? `<p class="small bad" style="margin-top:10px">${esc(st.loginMsg)}</p>` : ''}
      <button class="btn primary block" style="margin-top:16px" type="submit">Sign in</button>
    </form>`;
}

function viewDenied() {
  return `<div class="intro"><h1>ClickMonster Admin</h1></div>
    <div class="box" style="max-width:480px;margin:0 auto"><p>This account is not on the staff list.</p>
    <p class="small muted">Signed in as ${esc(st.email)}. An admin can add you from the Staff tab.</p>
    <button class="btn" data-a="signout">Sign out</button></div>`;
}

function header() {
  const tabs = [['dashboard', 'Dashboard'], ['players', 'Players'], ['world', 'World'], ['hunts', 'Hunts'], ['economy', 'Economy'], ['zones', 'Zones'], ['chat', 'Chat'], ['announce', 'Announce'], ['log', 'Log']];
  if (isAdmin()) tabs.push(['staff', 'Staff']);
  return `<div class="a-head"><h1>ClickMonster Admin</h1>
      <span class="who">${esc(st.me.email)} <span class="pill ${st.me.role}">${st.me.role}</span>
      <button class="textbtn" data-a="signout">Sign out</button></span></div>
    <nav class="a-tabs" aria-label="Admin sections">${tabs.map(([id, l]) => `<button class="chip ${st.tab === id ? 'on' : ''}" data-a="tab" data-v="${id}"${st.tab === id ? ' aria-current="page"' : ''}>${l}</button>`).join('')}
      <a class="chip" href="./" style="text-decoration:none;display:inline-flex;align-items:center">Open game</a></nav>`;
}

function barList(obj, label = (k) => k) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => `<div class="bar-row"><span>${esc(label(k))}</span><i style="width:${(v / max) * 100}%"></i><span class="num">${v}</span></div>`).join('') || '<p class="small muted">None yet.</p>';
}

function viewDashboard() {
  const s = st.stats;
  if (!s) return '<p class="muted">Loading statistics.</p>';
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
      <div class="box"><h2>Top heroes</h2><table>${(s.top || []).map((p) =>
        `<tr class="click" data-a="open" data-v="${p.id}"><td><button type="button" class="textbtn row-link" data-a="open" data-v="${p.id}">${esc(p.name)}</button></td><td>${RACES[p.race]?.name || ''}</td><td class="num">Lv ${p.level}</td></tr>`).join('')}</table></div>
    </div>
    <button class="btn sm" data-a="refresh">Refresh</button>`;
}

function viewPlayers() {
  if (st.player) return viewPlayer();
  const list = st.players;
  return `<form id="search" class="acts" style="margin-top:0">
      <input id="q" class="a-input" style="flex:1;min-width:180px;margin:0" placeholder="Search by hero name" value="${esc(st.q)}">
      <button class="btn primary" type="submit">Search</button></form>
    ${!list ? '<p class="muted">Loading.</p>' : !list.length ? '<p class="muted">No heroes found.</p>' : `<table style="margin-top:12px">
      <tr><th>Hero</th><th>Race</th><th class="num">Lv</th><th>Where</th><th>Last seen</th></tr>
      ${list.map((p) => `<tr class="click" data-a="open" data-v="${p.id}">
        <td><button type="button" class="textbtn row-link" data-a="open" data-v="${p.id}">${esc(p.name)}</button> ${sanctionPills(p)}${p.strikes ? `<span class="small faint">${p.strikes} strikes</span>` : ''}</td>
        <td>${RACES[p.race]?.name || p.race}</td><td class="num">${p.level}</td>
        <td>${esc(ZONES[p.zone]?.name || p.zone)} ${p.x},${p.y}</td><td>${ago(p.updated_at)}</td></tr>`).join('')}</table>`}`;
}

function sanctionBox(p) {
  const current = [
    active(p.banned_until) ? `Banned ${untilText(p.banned_until)}` : '',
    active(p.jailed_until) ? `Jailed ${untilText(p.jailed_until)}` : '',
    active(p.muted_until) ? `Muted ${untilText(p.muted_until)}` : '',
  ].filter(Boolean);
  return `<div class="box"><h2>Moderation</h2>
    <p class="small">${current.length ? current.join('. ') + '.' : 'No active sanctions.'} Strikes: ${p.strikes || 0}.${p.sanction_reason ? ` Last reason: ${esc(p.sanction_reason)}` : ''}</p>
    <form id="sanction" class="form-grid">
      <label>Action<select id="s-kind"><option value="warn">Warn</option><option value="mute">Mute</option><option value="jail">Jail</option><option value="ban">Ban</option><option value="lift">Lift all</option></select></label>
      <label>Days (blank = permanent${isAdmin() ? '' : ', admin only'})<input id="s-days" type="number" min="0" step="0.5" value="1"></label>
      <label style="grid-column:1/-1">Reason<input id="s-reason" required placeholder="Shown to the player"></label>
      <button class="btn primary" type="submit">Apply</button>
    </form>
    <p class="small faint" style="margin-top:8px">Moderators can sanction for up to 7 days. Muted players can still play (chat is not built yet); jailed players can only look around; banned players can't play.</p>
  </div>`;
}

function editBox(p) {
  const c = p.data;
  const zoneOpts = Object.values(ZONES).map((z) => `<option value="${z.id}" ${z.id === c.loc.zone ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
  const itemOpts = Object.values(ITEMS).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((i) => `<option value="${i.id}">Class ${i.tier}: ${esc(i.name)}</option>`).join('');
  const gemOpts = Object.keys(GEM_TYPES).flatMap((t) => [1, 2, 3, 4, 5].map((n) => `<option value="${t}:${n}">${GEM_TIERS[n]} ${GEM_TYPES[t].name}</option>`)).join('');
  const equipped = new Set(Object.values(c.equipment));
  return `<div class="box"><h2>Edit hero</h2>
    <form id="edit" class="form-grid">
      ${['level', 'xp', 'gold', 'bank', 'pendingLevels'].map((k) => `<label>${k === 'pendingLevels' ? 'Unspent levels' : k}<input name="${k}" type="number" min="0" value="${c[k] ?? 0}"></label>`).join('')}
      ${STATS.map((s) => `<label>${STAT_SHORT[s]}<input name="stat.${s}" type="number" min="1" value="${c.stats[s]}"></label>`).join('')}
      ${MASTERIES.map((m) => `<label>${MASTERY_LABEL[m]} (max ${masteryCap(c.race, m)})<input name="mastery.${m}" type="number" min="0" value="${c.masteries?.[m] ?? 0}"></label>`).join('')}
      <label>Zone<select name="zone">${zoneOpts}</select></label>
      <label>X<input name="x" type="number" min="1" value="${c.loc.x}"></label>
      <label>Y<input name="y" type="number" min="1" value="${c.loc.y}"></label>
      <button class="btn primary" type="submit" style="align-self:end">Save changes</button>
    </form>
    <div class="acts">
      <button class="btn sm" data-a="quick" data-v="heal">Full heal</button>
      <button class="btn sm" data-a="quick" data-v="clearBattle">End battle</button>
      <button class="btn sm" data-a="quick" data-v="clearQuest">Clear quest and cooldown</button>
    </div>
    <h3>Give item</h3>
    <form id="give-item" class="acts" style="margin-top:0">
      <select id="gi-base" aria-label="Item to give" class="a-input" style="flex:1;min-width:200px;margin:0">${itemOpts}</select>
      <select id="gi-q" aria-label="Quality" class="a-input" style="width:auto;margin:0"><option value="">Normal</option><option value="relic">Relic</option></select>
      <button class="btn" type="submit">Give</button></form>
    <h3>Give gems</h3>
    <form id="give-gem" class="acts" style="margin-top:0">
      <select id="gg-key" aria-label="Gem to give" class="a-input" style="flex:1;min-width:200px;margin:0">${gemOpts}</select>
      <input id="gg-n" aria-label="Number of gems" class="a-input" type="number" min="1" value="1" style="width:80px;margin:0">
      <button class="btn" type="submit">Give</button></form>
    <h3>Inventory (${c.inventory.length})</h3>
    <table>${c.inventory.map((i) => {
      const d = itemDef(i);
      return `<tr><td>${esc(d?.name || i.base)}${equipped.has(i.uid) ? ' <span class="small good">equipped</span>' : ''}<br><span class="small faint">${SLOT_LABEL[d?.slot] || ''}, gems: ${i.gems.join(', ') || 'none'}</span></td>
        <td class="num"><button class="btn sm danger" data-a="removeItem" data-v="${i.uid}">Remove</button></td></tr>`;
    }).join('')}</table>
    <h3>Gems</h3><p class="small">${Object.entries(c.gems).map(([k, n]) => `${esc(k)} x${n}`).join(', ') || 'None'}</p>
  </div>`;
}

function viewPlayer() {
  const { player: p, history, actions, email } = st.player;
  const c = p.data;
  return `<button class="btn sm" data-a="back">Back to search</button>
    <div class="box" style="margin-top:12px"><h2 id="player-title" tabindex="-1">${esc(p.name)} ${sanctionPills(p)}</h2>
      <p class="small muted">Level ${c.level} ${RACES[c.race]?.name || ''}, in ${esc(ZONES[c.loc.zone]?.name || c.loc.zone)} at ${c.loc.x}, ${c.loc.y}. Last seen ${ago(p.updated_at)}. Created ${when(p.created_at)}.${email ? ` Email: ${esc(email)}.` : ''}</p>
      <p class="small">Gold ${fmt(c.gold)} carried, ${fmt(c.bank)} banked. Kills ${fmt(c.kills)}, deaths ${fmt(c.deaths)}, quests ${fmt(c.questsDone || 0)}, duels won ${fmt(c.pvpWins || 0)}.</p>
    </div>
    ${sanctionBox(p)}
    ${isAdmin() ? editBox(p) : ''}
    <div class="cols">
      <div class="box"><h2>Sanction history</h2>${history?.length ? `<table>${history.map((h) =>
        `<tr><td><b>${esc(h.kind)}</b> ${h.until ? untilText(h.until) : ''}<br><span class="small">${esc(h.reason)}</span></td><td class="small muted">${esc(shortName(h.by_name))}<br>${ago(h.created_at)}</td></tr>`).join('')}</table>` : '<p class="small muted">None.</p>'}</div>
      <div class="box"><h2>Staff actions</h2>${actions?.length ? `<table>${actions.map((a) =>
        `<tr><td><b>${esc(a.action)}</b><br><span class="small muted">${esc(detailsText(a.action, a.details))}</span></td><td class="small muted">${esc(shortName(a.actor_name))}<br>${ago(a.created_at)}</td></tr>`).join('')}</table>` : '<p class="small muted">None.</p>'}</div>
    </div>`;
}

function viewAnnounce() {
  const ev = st.events;
  return `<form id="announce" class="box">
      <h2>Post an announcement</h2>
      <p class="small muted">Shown at the top of every player's Explore screen for three days, and in the quest board news.</p>
      <textarea id="ann-text" class="a-input" maxlength="300" required placeholder="Message to all players"></textarea>
      <div class="acts"><button class="btn primary" type="submit">Post</button></div>
    </form>
    <div class="box"><h2>Recent news</h2>${!ev ? '<p class="muted">Loading.</p>' : `<table>${ev.map((e) =>
      `<tr><td><span class="small faint">${esc(e.kind)}</span><br>${esc(e.text)}</td><td class="small muted">${ago(e.created_at)}</td>
       <td class="num">${isAdmin() ? `<button class="btn sm danger" data-a="deleteEvent" data-v="${e.id}">Delete</button>` : ''}</td></tr>`).join('')}</table>`}</div>`;
}

function viewLog() {
  const log = st.log;
  return `<div class="box"><h2>Staff audit log</h2>${!log ? '<p class="muted">Loading.</p>' : !log.length ? '<p class="small muted">No staff actions yet.</p>' : `<table>
    ${log.map((l) => `<tr><td>
      <b>${esc(l.action)}</b> ${l.target_id ? `<button class="textbtn" data-a="open" data-v="${l.target_id}">${esc(l.target_name || 'player')}</button>` : esc(l.target_name || '')}
      <br><span class="small muted">${esc(detailsText(l.action, l.details))}</span>
      <br><span class="small faint">${esc(shortName(l.actor_name))}, ${ago(l.created_at)}</span></td></tr>`).join('')}</table>`}</div>`;
}

function viewStaff() {
  const list = st.staff;
  return `<div class="box"><h2>Staff</h2>${!list ? '<p class="muted">Loading.</p>' : `<table>${list.map((s) =>
      `<tr><td>${esc(s.email)}</td><td><span class="pill ${s.role}">${s.role}</span></td><td class="small muted">since ${when(s.created_at)}</td>
       <td class="num">${s.email !== st.me.email ? `<button class="btn sm danger" data-a="removeStaff" data-v="${esc(s.email)}">Remove</button>` : ''}</td></tr>`).join('')}</table>`}</div>
    <form id="addstaff" class="box"><h2>Add staff</h2>
      <p class="small muted">They must have signed up in the game first.</p>
      <div class="form-grid"><label>Email<input id="st-email" type="email" required></label>
      <label>Role<select id="st-role"><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label>
      <button class="btn primary" type="submit" style="align-self:end">Add</button></div></form>`;
}

function multInputs(prefix, values = {}, placeholder = '1') {
  return MULT_KEYS.map((k) => `<label>${MULT_LABEL[k]}<input name="${prefix}.${k}" type="number" step="0.1" min="0" max="${MULT_MAX}" value="${values[k] ?? ''}" placeholder="${placeholder}"></label>`).join('');
}

function viewWorld() {
  const w = st.world;
  if (!w) return '<p class="muted">Loading.</p>';
  const now = Date.now();
  const events = (w.data.events || []).filter((e) => new Date(e.until).getTime() > now);
  const admin = isAdmin();
  return `<div class="box"><h2>Active events</h2>
      ${events.length ? `<table>${events.map((e) => `<tr><td><b>${esc(e.name)}</b><br><span class="small muted">${MULT_KEYS.filter((k) => e[k] != null).map((k) => `${MULT_LABEL[k]} x${e[k]}`).join(', ')}</span></td>
        <td class="small muted">ends ${when(e.until)}</td><td class="num">${admin ? `<button class="btn sm danger" data-a="endEvent" data-v="${e.id}">End now</button>` : ''}</td></tr>`).join('')}</table>`
        : '<p class="small muted">No events running.</p>'}</div>
    ${admin ? `<form id="event" class="box"><h2>Start an event</h2>
      <p class="small muted">Multipliers stack on top of the base settings. Leave a box empty to leave it alone. Players see a banner and an announcement.</p>
      <div class="form-grid">
        <label style="grid-column:1/-1">Name<input name="name" required placeholder="Double XP weekend"></label>
        <label>Hours<input name="hours" type="number" min="0.25" step="0.25" value="24" required></label>
        ${multInputs('m', {}, 'unchanged')}
        <button class="btn primary" type="submit" style="align-self:end">Start</button></div></form>
    <form id="base" class="box"><h2>Base settings</h2>
      <p class="small muted">Always in effect. 1 is normal, 2 is double, 0.5 is half. Maximum ${MULT_MAX}.</p>
      <div class="form-grid">${multInputs('b', w.data.base)}<button class="btn primary" type="submit" style="align-self:end">Save</button></div></form>`
    : `<div class="box"><h2>Base settings</h2><p class="small">${MULT_KEYS.map((k) => `${MULT_LABEL[k]} x${w.data.base?.[k] ?? 1}`).join(', ')}</p><p class="small faint">Only admins can change world settings.</p></div>`}`;
}

function viewHunts() {
  const h = st.hunts;
  if (!h) return '<p class="muted">Loading.</p>';
  const now = Date.now();
  const status = (x) => (x.status === 'active' && new Date(x.ends_at).getTime() < now ? 'expired' : x.status);
  const zoneOpts = Object.values(ZONES).map((z) => `<option value="${z.id}">${esc(z.name)} (level ${z.levelRange[0]} to ${z.levelRange[1]})</option>`).join('');
  return `${isAdmin() ? `<form id="hunt" class="box"><h2>Start a hunt</h2>
      <p class="small muted">A world boss with one shared health pool. Everyone who hits it shares the gold and XP by damage done (2% minimum); the killing blow also earns a relic and 25% extra gold. Rewards arrive in players' banks. Leave health blank for a suggested value (about 300 hits from heroes at its level).</p>
      <div class="form-grid">
        <label style="grid-column:1/-1">Boss name<input name="name" required placeholder="The Ashen Colossus"></label>
        <label style="grid-column:1/-1">Zone<select name="zone">${zoneOpts}</select></label>
        <label>Level<input name="level" type="number" min="1" value="20" required></label>
        <label>Health<input name="hp" type="number" min="1000" placeholder="suggested"></label>
        <label>Hours<input name="hours" type="number" min="0.25" step="0.25" value="24"></label>
        <label>Gold pool<input name="gold" type="number" min="0" value="20000"></label>
        <label>XP pool<input name="xp" type="number" min="0" value="20000"></label>
        <label>Relic for killer<select name="relic"><option value="yes">Yes</option><option value="no">No</option></select></label>
        <button class="btn primary" type="submit" style="align-self:end">Start hunt</button></div></form>` : ''}
    <div class="box"><h2>Hunts</h2>${!h.length ? '<p class="small muted">No hunts yet.</p>' : `<table>${h.map((x) => `<tr><td>
        <b>${esc(x.name)}</b> <span class="small faint">${status(x)}</span><br>
        <span class="small muted">Level ${x.level} in ${esc(ZONES[x.zone]?.name || x.zone)}. Health ${fmt(x.hp)} / ${fmt(x.max_hp)}. ${x.hunters} hunters. ${x.status === 'active' ? `Ends ${when(x.ends_at)}.` : x.killed_by_name ? `Killed by ${esc(x.killed_by_name)}.` : ''}</span>
        ${x.top.length ? `<br><span class="small">Top: ${x.top.map((t) => `${esc(t.name)} ${fmt(t.damage)}`).join(', ')}</span>` : ''}
      </td><td class="num">${isAdmin() && status(x) === 'active' ? `<button class="btn sm danger" data-a="cancelHunt" data-v="${x.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table>`}</div>`;
}

const LEDGER_LABEL = {
  monsters: 'Monster loot', quests: 'Quest rewards', hunt: 'Hunt rewards', selling: 'Selling to shops', admin: 'Admin edits',
  shop: 'Shop purchases', healer: 'Healer', jeweler: 'Jeweler', death: 'Lost on death',
};

function viewEconomy() {
  const e = st.economy;
  if (!e) return '<p class="muted">Loading.</p>';
  const days = [...new Set(e.rows.map((r) => r.day))].sort().reverse();
  const sources = [...new Set(e.rows.map((r) => r.source))];
  const total = (src) => e.rows.filter((r) => r.source === src).reduce((a, r) => a + Number(r.amount), 0);
  const inflow = sources.filter((s) => total(s) > 0).sort((a, b) => total(b) - total(a));
  const outflow = sources.filter((s) => total(s) < 0).sort((a, b) => total(a) - total(b));
  const sum = (list) => list.reduce((a, s) => a + total(s), 0);
  const row = (s) => `<tr><td>${esc(LEDGER_LABEL[s] || s)}</td><td class="num">${fmt(Math.abs(total(s)))}</td></tr>`;
  const net = sum(inflow) + sum(outflow);
  return `<div class="tiles">
      <div class="tile"><b class="good">${fmt(sum(inflow))}</b><span>Gold created (14 days)</span></div>
      <div class="tile"><b class="bad">${fmt(-sum(outflow))}</b><span>Gold removed (14 days)</span></div>
      <div class="tile"><b>${net >= 0 ? '+' : ''}${fmt(net)}</b><span>Net change</span></div>
      ${st.stats ? `<div class="tile"><b>${fmt(st.stats.goldCarried + st.stats.goldBanked)}</b><span>Gold in the world now</span></div>` : ''}
    </div>
    <div class="cols">
      <div class="box"><h2>Where gold comes from</h2>${inflow.length ? `<table>${inflow.map(row).join('')}</table>` : '<p class="small muted">Nothing yet.</p>'}</div>
      <div class="box"><h2>Where gold goes</h2>${outflow.length ? `<table>${outflow.map(row).join('')}</table>` : '<p class="small muted">Nothing yet.</p>'}
        <p class="small faint">Gold moved between players (duels) and to or from the bank isn't counted.</p></div>
    </div>
    <div class="box"><h2>By day</h2>${days.length ? `<table><tr><th>Day</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr>${days.map((d) => {
      const rows = e.rows.filter((r) => r.day === d);
      const inn = rows.filter((r) => r.amount > 0).reduce((a, r) => a + Number(r.amount), 0);
      const out = rows.filter((r) => r.amount < 0).reduce((a, r) => a + Number(r.amount), 0);
      return `<tr><td>${d}</td><td class="num good">${fmt(inn)}</td><td class="num bad">${fmt(-out)}</td><td class="num">${fmt(inn + out)}</td></tr>`;
    }).join('')}</table>` : '<p class="small muted">No activity recorded yet.</p>'}</div>`;
}

function chatLine(m, withActions = true) {
  const where = m.channel === 'zone' ? `zone ${esc(ZONES[m.zone]?.name || m.zone)}` : m.channel === 'whisper' ? `whisper to ${esc(m.recipient_name)}` : 'global';
  return `<tr><td><span class="small faint">${ago(m.created_at)}, ${where}</span><br>
    ${m.sender_id ? `<button class="textbtn" data-a="open" data-v="${m.sender_id}">${esc(m.sender_name)}</button>` : esc(m.sender_name)}${m.sender_role ? ` <span class="pill ${m.sender_role}">${m.sender_role}</span>` : ''}:
    ${m.deleted_at ? `<span class="faint">[removed by ${esc(shortName(m.deleted_by))}]</span> <span class="small faint">${esc(m.original_text || '')}</span>` : esc(m.text)}</td>
    <td class="num">${withActions && !m.deleted_at ? `<button class="btn sm danger" data-a="chatDelete" data-v="${m.id}">Remove</button>` : ''}</td></tr>`;
}

function viewChat() {
  const reports = st.reports;
  const msgs = st.chat;
  const q = st.chatQ;
  return `<div class="box"><h2>Reports${reports ? ` (${reports.length})` : ''}</h2>
      ${!reports ? '<p class="muted">Loading.</p>' : !reports.length ? '<p class="small muted">No open reports.</p>' : `<table>${reports.map((r) => `
        <tr><td>${r.message ? chatLine(r.message, false).replace(/^<tr><td>|<\/td><td class="num"><\/td><\/tr>$/g, '') : '<span class="faint">message gone</span>'}
          <br><span class="small muted">Reported by ${esc(r.reporter_name || '')} ${ago(r.created_at)}${r.reason ? `: ${esc(r.reason)}` : ''}</span></td>
          <td class="num"><div class="acts" style="justify-content:flex-end;margin:0">
            ${r.message && !r.message.deleted_at ? `<button class="btn sm danger" data-a="chatDelete" data-v="${r.message.id}">Remove</button>` : ''}
            ${r.message?.sender_id ? `<button class="btn sm" data-a="open" data-v="${r.message.sender_id}">Sanction</button>` : ''}
            <button class="btn sm" data-a="resolveReport" data-v="${r.id}">Dismiss</button></div></td></tr>`).join('')}</table>`}</div>
    <form id="chatsearch" class="box"><h2>Chat history</h2>
      <p class="small muted">The last 14 days, including whispers. Removed messages keep their original text here.</p>
      <div class="form-grid">
        <label>Channel<select name="channel"><option value="">All</option>${['global', 'zone', 'whisper'].map((c) => `<option value="${c}" ${q.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Sender<input name="sender" value="${esc(q.sender || '')}"></label>
        <label>Text contains<input name="q" value="${esc(q.q || '')}"></label>
        <button class="btn primary" type="submit" style="align-self:end">Search</button></div>
      ${!msgs ? '<p class="muted">Loading.</p>' : !msgs.length ? '<p class="small muted">No messages.</p>' : `<table style="margin-top:10px">${msgs.map((m) => chatLine(m)).join('')}</table>`}
    </form>`;
}

// ---- Keyboard focus across full re-renders.
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
  return null;
}
const usable = (el) => !!el && el.isConnected && !el.disabled && el.getClientRects().length > 0;
const SECTION_LABEL = { dashboard: 'Dashboard', players: 'Players', world: 'World', hunts: 'Hunts', economy: 'Economy', zones: 'Zones', chat: 'Chat moderation', announce: 'Announcements', log: 'Audit log', staff: 'Staff' };

function render() {
  const root = $('#admin');
  const active = document.activeElement;
  const hadFocus = active && root.contains(active);
  const key = hadFocus ? focusKey(active) : null;
  const caret = hadFocus && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  let html;
  if (st.phase === 'loading') html = '<div class="intro"><h1>ClickMonster Admin</h1><p>Loading</p></div>';
  else if (st.phase === 'login') html = viewLogin();
  else if (st.phase === 'denied') html = viewDenied();
  else {
    const body = { dashboard: viewDashboard, players: viewPlayers, world: viewWorld, hunts: viewHunts, economy: viewEconomy, zones: zones.view, chat: viewChat, announce: viewAnnounce, log: viewLog, staff: viewStaff }[st.tab]();
    const section = st.tab === 'players' && st.player ? `Player: ${st.player.player.name}` : SECTION_LABEL[st.tab] || st.tab;
    html = `${header()}<h2 class="sr-only" id="section-title" tabindex="-1">${esc(section)}</h2>${body}`;
  }
  root.innerHTML = html;

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

// ---------------------------------------------------------------- loading
async function load(tab = st.tab) {
  try {
    if (tab === 'dashboard') st.stats = await call('stats');
    if (tab === 'players' && !st.player) st.players = (await call('search', { q: st.q })).players;
    if (tab === 'announce') st.events = (await call('events')).events;
    if (tab === 'log') st.log = (await call('log')).log;
    if (tab === 'staff') st.staff = (await call('staff')).staff;
    if (tab === 'zones') { st.zoneEdit = null; await zones.load(); return; }
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

async function openPlayer(id) {
  // Remember how we got here so "Back to search" can return focus to this player's link.
  st.returnFocus = `.row-link[data-v="${CSS.escape(id)}"]`;
  st.tab = 'players';
  st.player = null;
  render();
  try {
    st.player = await call('player', { id });
    st.focusNext = '#player-title';
  } catch (e) { toast(e.message, true); }
  render();
  window.scrollTo(0, 0);
}

async function editPlayer(patch, msg = 'Saved.') {
  try {
    await call('update', { id: st.player.player.id, patch });
    st.player = await call('player', { id: st.player.player.id });
    toast(msg);
    render();
  } catch (e) { toast(e.message, true); } // keep the form as filled in
}

// ---------------------------------------------------------------- events
const zones = setupZones({ st, call, toast, render, esc, isAdmin });
document.addEventListener('input', (e) => zones.onInput(e));
document.addEventListener('change', (e) => { if (e.target.dataset.toggle || e.target.dataset.list || e.target.tagName === 'SELECT') zones.onInput(e); });

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
  if (a === 'tab') { st.tab = v; st.player = null; render(); load(v); }
  if (a === 'refresh') load();
  if (a === 'open') openPlayer(v);
  if (a === 'back') { st.player = null; st.focusNext = st.returnFocus || null; render(); load('players'); }
  if (a === 'quick') editPlayer({ [v]: true });
  if (a === 'removeItem') {
    const p = st.player?.player;
    const item = p?.data.inventory.find((i) => String(i.uid) === v);
    const d = item && itemDef(item);
    if (await ask({
      title: `Remove ${d?.name || 'this item'} from ${p?.name || 'the hero'}?`,
      points: [`The item${item?.gems.length ? ' and the gems socketed in it are' : ' is'} deleted, not returned to the shop.`, 'The change is recorded in the audit log.'],
      confirm: 'Remove item', cancel: 'Keep it',
    })) editPlayer({ removeItem: Number(v) }, 'Item removed.');
  }
  if (a === 'deleteEvent' && await ask({ title: 'Delete this news item?', points: ['It disappears from the news feed for every player.'], confirm: 'Delete', cancel: 'Keep it' })) {
    try { await call('deleteEvent', { id: v }); toast('Deleted.'); } catch (err) { toast(err.message, true); }
    load('announce');
  }
  if (a === 'chatDelete' && await ask({ title: 'Remove this message for everyone?', points: ['Players see "message removed" in its place.', 'The original text stays in the moderation log.'], confirm: 'Remove message', cancel: 'Keep it' })) {
    try { await call('chatDelete', { id: v }); toast('Removed.'); load('chat'); } catch (err) { toast(err.message, true); }
  }
  if (a === 'resolveReport') {
    try { await call('resolveReport', { id: v }); toast('Report dismissed.'); load('chat'); } catch (err) { toast(err.message, true); }
  }
  if (a === 'endEvent' && await ask({ title: 'End this event now?', points: ['Its bonuses stop for every player straight away.'], confirm: 'End event', cancel: 'Keep it running' })) {
    try { st.world = await call('endEvent', { id: v }); toast('Event ended.'); render(); } catch (err) { toast(err.message, true); }
  }
  if (a === 'cancelHunt' && await ask({ title: 'Cancel this hunt?', points: ['The world boss disappears and nobody is rewarded, including players who already hit it.'], confirm: 'Cancel hunt', cancel: 'Keep it running' })) {
    try { await call('cancelHunt', { id: v }); toast('Hunt cancelled.'); load('hunts'); } catch (err) { toast(err.message, true); }
  }
  if (a === 'removeStaff' && await ask({ title: `Remove ${v} from staff?`, points: ['They lose access to this console straight away.', 'They keep their player account.'], confirm: 'Remove from staff', cancel: 'Cancel' })) {
    try { st.staff = (await call('setStaff', { email: v, role: null })).staff; toast('Removed.'); } catch (err) { toast(err.message, true); }
    render();
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'login') {
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    if (error) { st.loginMsg = error.message; render(); }
    return;
  }
  if (id === 'chatsearch') {
    const f = new FormData(e.target);
    st.chatQ = { channel: f.get('channel') || undefined, sender: f.get('sender') || undefined, q: f.get('q') || undefined };
    st.chat = null; render(); load('chat');
    return;
  }
  if (id === 'search') { st.q = $('#q').value; st.players = null; render(); load('players'); }
  if (id === 'sanction') {
    const kind = $('#s-kind').value;
    const daysRaw = $('#s-days').value.trim();
    const days = daysRaw === '' ? null : Number(daysRaw);
    const reason = $('#s-reason').value;
    const name = st.player.player.name;
    const timed = ['mute', 'jail', 'ban'].includes(kind);
    const span = timed ? (days ? `for ${days} ${days === 1 ? 'day' : 'days'}` : 'permanently') : '';
    const effect = {
      warn: 'They see the warning and the reason. It counts as a strike on their record.',
      mute: "They can't send chat messages.",
      jail: 'They can look around but not act.',
      ban: "They can't play.",
      lift: 'Every active mute, jail and ban on them ends now.',
    }[kind];
    const ok = await ask({
      title: kind === 'lift' ? `Lift all sanctions on ${name}?` : `${kind[0].toUpperCase()}${kind.slice(1)} ${name}${span ? ` ${span}` : ''}?`,
      points: [effect, ...(reason ? [`Reason shown to them: "${reason}"`] : []), 'The action is recorded in the audit log.'],
      // A permanent ban is the one sanction worth typing the name for.
      typeToConfirm: kind === 'ban' && !days ? name : null,
      confirm: kind === 'lift' ? 'Lift sanctions' : `Apply ${kind}`, cancel: 'Cancel', tone: kind === 'lift' ? 'normal' : 'danger',
    });
    if (!ok) return;
    try {
      await call('sanction', { id: st.player.player.id, kind, days, reason });
      st.player = await call('player', { id: st.player.player.id });
      toast('Done.');
      render();
    } catch (err) { toast(err.message, true); } // keep the form as filled in
  }
  if (id === 'edit') {
    const f = new FormData(e.target);
    const patch = { stats: {}, masteries: {} };
    for (const k of ['level', 'xp', 'gold', 'bank', 'pendingLevels']) patch[k] = f.get(k);
    for (const s of STATS) patch.stats[s] = f.get(`stat.${s}`);
    for (const m of MASTERIES) patch.masteries[m] = f.get(`mastery.${m}`);
    const c = st.player.player.data;
    if (f.get('zone') !== c.loc.zone || Number(f.get('x')) !== c.loc.x || Number(f.get('y')) !== c.loc.y) {
      patch.loc = { zone: f.get('zone'), x: f.get('x'), y: f.get('y') };
    }
    editPlayer(patch);
  }
  if (id === 'give-item') editPlayer({ addItem: { base: $('#gi-base').value, q: $('#gi-q').value || null } }, 'Item given.');
  if (id === 'give-gem') editPlayer({ addGem: { key: $('#gg-key').value, count: $('#gg-n').value } }, 'Gems given.');
  if (id === 'announce') {
    try { await call('announce', { text: $('#ann-text').value }); toast('Posted.'); } catch (err) { toast(err.message, true); }
    load('announce');
  }
  if (id === 'event' || id === 'base') {
    const f = new FormData(e.target);
    const prefix = id === 'event' ? 'm' : 'b';
    const mults = {};
    for (const k of MULT_KEYS) { const v = f.get(`${prefix}.${k}`); if (v !== '' && v != null) mults[k] = Number(v); }
    try {
      st.world = id === 'event'
        ? await call('startEvent', { name: f.get('name'), hours: Number(f.get('hours')), mults })
        : await call('setBase', { base: mults });
      toast(id === 'event' ? 'Event started.' : 'Saved.');
      render();
    } catch (err) { toast(err.message, true); }
  }
  if (id === 'hunt') {
    const f = new FormData(e.target);
    if (!await ask({
      title: `Start the hunt for ${f.get('name')}?`,
      points: [`It appears for every player in ${ZONES[f.get('zone')]?.name || f.get('zone')} for ${f.get('hours')} hours.`, 'Rewards are paid when it is defeated.'],
      confirm: 'Start hunt', cancel: 'Cancel', tone: 'normal',
    })) return;
    try {
      await call('startHunt', {
        name: f.get('name'), zone: f.get('zone'), level: f.get('level'), hp: f.get('hp') || null,
        hours: f.get('hours'), gold: f.get('gold'), xp: f.get('xp'), relic: f.get('relic') === 'yes',
      });
      toast('Hunt started.');
      load('hunts');
    } catch (err) { toast(err.message, true); }
  }
  if (id === 'addstaff') {
    try { st.staff = (await call('setStaff', { email: $('#st-email').value, role: $('#st-role').value })).staff; toast('Added.'); } catch (err) { toast(err.message, true); }
    render();
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
      render();
      load('dashboard');
    } catch {
      st.phase = 'denied';
      render();
    }
  }, 0);
});

fetchZoneDefs().then((defs) => { if (defs) { loadZones(defs); render(); } }).catch(() => {});
render();
