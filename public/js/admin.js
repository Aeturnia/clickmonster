// Admin and moderator console. All checks happen on the server (`admin` edge function);
// this page only renders what the server allows.
import { sb } from './net.js';
import { STATS, STAT_SHORT } from './data/stats.js';
import { MASTERIES, MASTERY_LABEL, masteryCap } from './data/masteries.js';
import { GEM_TYPES, GEM_TIERS } from './data/gems.js';
import { ITEMS, itemDef, SLOT_LABEL } from './data/items.js';
import { ZONES } from './data/zones.js';
import { RACES } from './data/races.js';

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

const st = { phase: 'loading', me: null, tab: 'dashboard', q: '', players: null, player: null, stats: null, log: null, events: null, staff: null };

let toastTimer;
function toast(msg, bad = false) {
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
    try { msg = (await error.context.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
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
  const tabs = [['dashboard', 'Dashboard'], ['players', 'Players'], ['announce', 'Announce'], ['log', 'Log']];
  if (isAdmin()) tabs.push(['staff', 'Staff']);
  return `<div class="a-head"><h1>ClickMonster Admin</h1>
      <span class="who">${esc(st.me.email)} <span class="pill ${st.me.role}">${st.me.role}</span>
      <button class="textbtn" data-a="signout">Sign out</button></span></div>
    <div class="a-tabs">${tabs.map(([id, l]) => `<button class="chip ${st.tab === id ? 'on' : ''}" data-a="tab" data-v="${id}">${l}</button>`).join('')}
      <a class="chip" href="./" style="text-decoration:none;display:inline-flex;align-items:center">Open game</a></div>`;
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
        `<tr class="click" data-a="open" data-v="${p.id}"><td>${esc(p.name)}</td><td>${RACES[p.race]?.name || ''}</td><td class="num">Lv ${p.level}</td></tr>`).join('')}</table></div>
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
        <td>${esc(p.name)} ${sanctionPills(p)}${p.strikes ? `<span class="small faint">${p.strikes} strikes</span>` : ''}</td>
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
      <select id="gi-base" class="a-input" style="flex:1;min-width:200px;margin:0">${itemOpts}</select>
      <select id="gi-q" class="a-input" style="width:auto;margin:0"><option value="">Normal</option><option value="relic">Relic</option></select>
      <button class="btn" type="submit">Give</button></form>
    <h3>Give gems</h3>
    <form id="give-gem" class="acts" style="margin-top:0">
      <select id="gg-key" class="a-input" style="flex:1;min-width:200px;margin:0">${gemOpts}</select>
      <input id="gg-n" class="a-input" type="number" min="1" value="1" style="width:80px;margin:0">
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
    <div class="box" style="margin-top:12px"><h2>${esc(p.name)} ${sanctionPills(p)}</h2>
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

function render() {
  let html;
  if (st.phase === 'loading') html = '<div class="intro"><h1>ClickMonster Admin</h1><p>Loading</p></div>';
  else if (st.phase === 'login') html = viewLogin();
  else if (st.phase === 'denied') html = viewDenied();
  else {
    const body = { dashboard: viewDashboard, players: viewPlayers, announce: viewAnnounce, log: viewLog, staff: viewStaff }[st.tab]();
    html = header() + body;
  }
  $('#admin').innerHTML = html;
}

// ---------------------------------------------------------------- loading
async function load(tab = st.tab) {
  try {
    if (tab === 'dashboard') st.stats = await call('stats');
    if (tab === 'players' && !st.player) st.players = (await call('search', { q: st.q })).players;
    if (tab === 'announce') st.events = (await call('events')).events;
    if (tab === 'log') st.log = (await call('log')).log;
    if (tab === 'staff') st.staff = (await call('staff')).staff;
  } catch (e) { toast(e.message, true); }
  render();
}

async function openPlayer(id) {
  st.tab = 'players';
  st.player = null;
  render();
  try { st.player = await call('player', { id }); } catch (e) { toast(e.message, true); }
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
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  const v = el.dataset.v;
  if (a === 'signout') { await sb.auth.signOut(); return; }
  if (a === 'tab') { st.tab = v; st.player = null; render(); load(v); }
  if (a === 'refresh') load();
  if (a === 'open') openPlayer(v);
  if (a === 'back') { st.player = null; render(); load('players'); }
  if (a === 'quick') editPlayer({ [v]: true });
  if (a === 'removeItem' && confirm('Remove this item from the hero?')) editPlayer({ removeItem: Number(v) }, 'Item removed.');
  if (a === 'deleteEvent' && confirm('Delete this news item?')) {
    try { await call('deleteEvent', { id: v }); toast('Deleted.'); } catch (err) { toast(err.message, true); }
    load('announce');
  }
  if (a === 'removeStaff' && confirm(`Remove ${v} from staff?`)) {
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
  if (id === 'search') { st.q = $('#q').value; st.players = null; render(); load('players'); }
  if (id === 'sanction') {
    const kind = $('#s-kind').value;
    const daysRaw = $('#s-days').value.trim();
    const days = daysRaw === '' ? null : Number(daysRaw);
    const reason = $('#s-reason').value;
    if (!confirm(`Apply "${kind}"${['mute', 'jail', 'ban'].includes(kind) ? (days ? ` for ${days} days` : ' permanently') : ''} to ${st.player.player.name}?`)) return;
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

render();
