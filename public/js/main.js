// UI layer. Game rules live in ./engine (the server runs the same code); this file
// renders the screen and sends actions. Text only by design: no icons or emoji.
import { RACES, affinityLabel } from './data/races.js';
import { STATS, STAT_LABEL, STAT_SHORT, STAT_DESC, POINTS_PER_LEVEL } from './data/stats.js';
import { ITEMS, SLOTS, SLOT_LABEL, WEAPON_TYPES, tierRoman, itemDef } from './data/items.js';
import { MASTERIES, MASTERY_LABEL, masteryCap, raceSpecialties } from './data/masteries.js';
import { VARIANTS } from './data/variants.js';
import { ELEMENT_LABEL } from './data/elements.js';
import { ZONES, MONSTERS } from './data/zones.js';
import { parseGem, extractCost } from './data/gems.js';
import {
  maxHp, xpToNext, totalStats, gemBonuses, totalArmor, playerCombatant,
  applyRegen, healCost, findItem, equippedItem, meetsRequirements,
} from './engine/character.js';
import { currentZone, featuresAt, inTown, monstersHere, directionTo } from './engine/world.js';
import { monsterCombatant } from './engine/monster.js';
import { meleeChance, spellChance, meleeBase, spellBase } from './engine/combat.js';
import { shopItems, isEquipped, sellPrice } from './engine/inventory.js';
import { PVP_LEVEL_GAP } from './engine/pvp.js';
import { sb, api, playersAt, recentEvents } from './net.js';
import { questTitle, canAccept } from './engine/quests.js';
import { setWorld, activeEvents, MULT_LABEL, MULT_KEYS } from './engine/world-config.js';
import { huntCombatant } from './engine/hunt.js';

// ---------------------------------------------------------------- state
const PREFS_KEY = 'clickmonster.prefs';
const prefs = (() => {
  const defaults = { leftHanded: false, vibrate: true };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
})();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

let session = null;
let char = null; // the server's copy of our hero
const ui = {
  phase: 'loading', // loading | auth | game
  authMode: 'signin',
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
  hunts: [],
};

const SEEN_KEY = 'clickmonster.seenAnnouncement';
const seenAnnouncement = () => { try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; } };

// ---------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => `${Math.round(n * 100)}%`;
const fmt = (n) => Math.round(n).toLocaleString();
const btn = (a, v, label, cls = '', disabled = false) =>
  `<button data-a="${a}"${v != null ? ` data-v="${esc(v)}"` : ''} class="btn ${cls}"${disabled ? ' disabled' : ''}>${label}</button>`;

function meter(label, cur, max, cls = '') {
  const w = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="meter ${cls}"><div class="meter-label"><span>${label}</span><b>${fmt(cur)} / ${fmt(max)}</b></div>
    <div class="meter-track"><i style="width:${w}%"></i></div></div>`;
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

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  // Sit just above the bottom controls so it never covers the screen title.
  const anchor = $('#dock:not(:empty)') || $('#nav:not(:empty)');
  el.style.top = 'auto';
  el.style.bottom = anchor ? `${window.innerHeight - anchor.getBoundingClientRect().top + 10}px` : '24px';
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
function viewTop() {
  if (!char) return '';
  const race = RACES[char.race];
  const gems = Object.values(char.gems).reduce((a, b) => a + b, 0);
  return `<div class="hud-row">
      <span class="hud-name">${esc(char.name)}</span>
      <span class="hud-sub">Lv ${char.level} ${race.name}</span>
      <span class="hud-res"><b>${fmt(char.gold)}</b> gold <span class="gems"><b>${gems}</b> gems</span></span>
    </div>
    <div class="hud-bars">${meter('HP', char.hp, maxHp(char))}${meter('XP', char.xp, xpToNext(char.level), 'xp')}</div>`;
}

function viewNav() {
  if (!char) return '';
  const tabs = [['explore', fighting() ? 'Battle' : 'Explore'], ['hero', 'Hero'], ['gear', 'Gear'], ['map', 'Map']];
  return `<div class="tabs">${tabs.map(([id, label]) =>
    `<button data-a="tab" data-v="${id}" class="${ui.tab === id ? 'on' : ''}">${label}${id === 'hero' && char.pendingLevels ? `<span class="count">${char.pendingLevels}</span>` : ''}</button>`).join('')}</div>`;
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

function viewLoading() {
  return '<div class="intro"><h1>ClickMonster</h1><p>Loading</p></div>';
}

function viewAuth() {
  const signup = ui.authMode === 'signup';
  return `
    <div class="intro"><h1>ClickMonster</h1><p>A shared world of monsters, gold and glory.</p></div>
    <form id="authform" autocomplete="on">
      <h2>${signup ? 'Create an account' : 'Sign in'}</h2>
      <label class="field">Email<input id="email" type="email" inputmode="email" autocomplete="email" required value="${esc(ui.email || '')}"></label>
      <label class="field">Password<input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
      ${ui.authMsg ? `<p class="small ${ui.authMsgKind || 'muted'}" style="margin-top:12px">${esc(ui.authMsg)}</p>` : ''}
      <button type="submit" class="btn primary block" style="margin-top:18px">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p style="text-align:center;margin-top:14px"><button class="textbtn" data-a="authmode" data-v="${signup ? 'signin' : 'signup'}">${signup ? 'I already have an account' : 'New here? Create an account'}</button></p>`;
}

function viewCreate() {
  const r = RACES[ui.race];
  const bonuses = Object.entries(r.bonus).map(([s, n]) => `+${n} ${STAT_SHORT[s]}`).join(', ');
  return `
    <div class="intro"><h1>ClickMonster</h1><p>Who are you?</p></div>
    <label class="field">Name<input id="name" type="text" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Your hero's name" value="${esc(ui.draftName || '')}"></label>
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
    ${btn('create', null, 'Begin your adventure', 'primary block')}`;
}

// ---------------------------------------------------------------- explore
function viewExplore() {
  const zone = currentZone(char);
  const { x, y } = char.loc;
  const here = featuresAt(zone, x, y);
  const lines = [];
  for (const f of here) {
    if (f.type === 'town') lines.push(`You are in <b>${esc(f.name)}</b>. Shop, healer and jeweler are here, and it is safe from attack.`);
    if (f.type === 'portal') lines.push(char.level < f.minLevel
      ? `<b>${esc(f.label)}</b>. <span class="warn">Requires level ${f.minLevel}.</span>`
      : `<b>${esc(f.label)}</b> leads to ${esc(ZONES[f.to].name)}.`);
    if (f.type === 'lair' && zone.boss) lines.push(`A lair. <b>${esc(zone.boss.name)}</b> waits here.`);
  }
  if (!lines.length) lines.push(zone.pvp ? '<span class="warn">Lawless ground. Other players may attack you here.</span>' : 'Open ground.');

  const near = [];
  if (zone.town && !(zone.town.x === x && zone.town.y === y)) near.push([zone.town.name, zone.town.x, zone.town.y]);
  for (const f of zone.features) {
    if (f.x === x && f.y === y) continue;
    if (f.type === 'portal' && zone.id !== 'overworld') near.push([f.label, f.x, f.y]);
    if (f.type === 'lair' && zone.boss) near.push(['Boss lair', f.x, f.y]);
  }

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
  const events = activeEvents().map((e) => {
    const bits = MULT_KEYS.filter((k) => e[k] && e[k] !== 1).map((k) => `${MULT_LABEL[k]} x${e[k]}`).join(', ');
    return `<div class="notice event"><p class="small" style="margin:0"><b>${esc(e.name)}</b>: ${bits}. ${timeLeft(new Date(e.until).getTime() - Date.now())} left.</p></div>`;
  }).join('');
  return `
    ${jail}${mute}${ann}${events}
    ${notices}
    ${questLine}
    <div class="place">
      <div class="place-row"><h2>${esc(zone.name)}</h2><span class="coords">${x}, ${y}</span></div>
      <div class="tags"><span class="tag">Level ${zone.levelRange[0]} to ${zone.levelRange[1]}</span>${zone.pvp ? '<span class="tag pvp">PvP</span>' : ''}</div>
      <p class="here">${lines.join('<br>')}</p>
      ${near.length ? `<div class="nearby">${near.map(([n, nx, ny]) => `<span><b>${esc(n)}</b> ${directionTo(char, nx, ny)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="seg">
      <button data-a="list" data-v="monsters" class="${ui.list === 'monsters' ? 'on' : ''}">Monsters</button>
      <button data-a="list" data-v="players" class="${ui.list === 'players' ? 'on' : ''}">Players${playersCount}</button>
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
  if (!mons.length && !hunts) return '<p class="empty">No monsters roam here.</p>';
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
  if (!players) return '<p class="empty">Looking around.</p>';
  if (!players.length) return '<p class="empty">No other adventurers are here right now.</p>';
  const safe = inTown(char);
  return `<div class="rows">${players.map((p) => {
    const d = difficulty(p.level);
    const canHit = zone.pvp && !safe && p.level >= char.level - PVP_LEVEL_GAP;
    return `<div class="row static">
      <span class="lv ${d.cls}">Lv ${p.level}</span>
      <span class="nm">${esc(p.name)}<small>${RACES[p.race]?.name || ''}</small></span>
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
        ${btn('heal', null, cost > 0 ? `Heal <small>${fmt(cost)} gold</small>` : 'Heal <small>Full health</small>', '', cost <= 0)}
        ${btn('bank', null, `Bank <small>${fmt(char.bank)} saved</small>`)}
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
function logHtml(log) {
  const firstFresh = Math.max(0, log.length - 4);
  return log.map((l, i) => `<p class="${l.kind}${i >= firstFresh ? ' fresh' : ''}${i === log.length - 1 ? ' latest' : ''}">${esc(l.text)}</p>`).join('');
}

function viewHuntBattle(b, you) {
  const ended = b.over && b.over !== 'defeat';
  return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
      <div class="side foe" id="fx-foe"><div class="side-name elite-name">${esc(b.name)}</div>
        <div class="side-sub">World boss, level ${b.level}</div>
        ${meter('Shared HP', b.hp, b.maxHp, 'foe big')}</div></div>
    <div class="summary"><span>Your damage: ${fmt(b.myDamage || 0)}</span>${ended ? '' : '<span class="faint">Every hunter shares the reward</span>'}</div>
    <div class="log" id="log">${logHtml(b.log)}</div>`;
}

function viewBattle() {
  const b = char.battle;
  const you = `<div class="side you" id="fx-you"><div class="side-name">${esc(char.name)}</div><div class="side-sub">Lv ${char.level}</div>${meter('HP', char.hp, maxHp(char), 'big')}</div>`;
  if (b.hunt) return viewHuntBattle(b, you);
  if (b.pvp) {
    return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
        <div class="side foe" id="fx-foe"><div class="side-name">${esc(b.opponent)}</div><div class="side-sub">${b.over === 'victory' ? 'Defeated' : 'Victorious'}</div></div></div>
      <div class="log" id="log">${logHtml(b.log)}</div>`;
  }
  const mon = monsterCombatant(b.monsterId, b.variant);
  const d = difficulty(mon.level);
  const r = b.rewards;
  const gem = r?.gem && parseGem(r.gem);
  const summary = b.over === 'victory' && r ? `<div class="summary">
      <span>+${fmt(r.xp)} XP</span><span>+${fmt(r.gold)} gold</span>${gem ? `<span class="gem">Found ${esc(gem.name)}</span>` : ''}${r.relic ? `<span class="gem">Found ${esc(r.relic)}</span>` : ''}${r.levels ? `<span class="gem">Level ${char.level}!</span>` : ''}
    </div>` : '';
  return `<div class="versus" id="versus">${you}<div class="vs">vs</div>
      <div class="side foe" id="fx-foe"><div class="side-name${b.variant ? ' elite-name' : ''}">${esc(mon.name)}</div>
        <div class="side-sub"><span class="${d.cls}">Lv ${mon.level} ${d.word}</span>${mon.element ? `, ${ELEMENT_LABEL[mon.element]}` : ''}</div>
        ${meter('HP', b.hp, b.maxHp, 'foe big')}</div></div>
    ${summary}
    <div class="log" id="log">${logHtml(b.log)}</div>`;
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
      ${btn('again', null, 'Fight again', 'big primary wide', !stillHere)}
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
      <button class="row" data-a="pref" data-v="vibrate"><span class="nm">Vibration<small>Buzz when you take a hit (Android)</small></span><span class="go">${prefs.vibrate ? 'On' : 'Off'}</span></button>
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
    ${pack.length ? `<div class="rows">${pack.map((i) => itemRow(i)).join('')}</div>` : '<p class="empty">Your pack is empty. Town shops sell gear.</p>'}
    <h3>Gems</h3>
    ${gems.length ? `<div class="rows">${gems.map((g) => `<div class="row static"><span class="nm">${gemText(g.key)}</span><span class="go">x${g.n}</span></div>`).join('')}</div>`
      : '<p class="empty">Monsters sometimes drop gems, and bosses always do. Socket them into gear for stat bonuses.</p>'}`;
}

// ---------------------------------------------------------------- map
function viewMap() {
  const zone = currentZone(char);
  const cells = [];
  for (let y = 1; y <= zone.size; y++) {
    for (let x = 1; x <= zone.size; x++) {
      let cls = '';
      let label = '';
      for (const f of featuresAt(zone, x, y)) {
        if (f.type === 'town') { cls = 'town'; label = 'T'; }
        if (f.type === 'portal') { const locked = char.level < f.minLevel; cls = locked ? 'locked' : 'portal'; label = locked ? 'X' : 'P'; }
        if (f.type === 'lair') { cls = 'lair'; label = 'B'; }
      }
      if (x === char.loc.x && y === char.loc.y) { cls += ' me'; label = 'You'; }
      cells.push(`<button class="${cls}" data-a="walk" data-v="${x},${y}" aria-label="${x}, ${y}">${label}</button>`);
    }
  }
  const dests = zone.features.filter((f) => f.type === 'portal').map((f) => {
    const z = ZONES[f.to];
    const locked = char.level < f.minLevel;
    return `<button class="row" data-a="walk" data-v="${f.x},${f.y}">
      <span class="lv num">${f.x}, ${f.y}</span>
      <span class="nm">${esc(zone.id === 'overworld' ? z.name : f.label)}<small>Level ${z.levelRange[0]} to ${z.levelRange[1]}${z.pvp ? ', PvP' : ''}${locked ? `, requires level ${f.minLevel}` : ''}</small></span>
      <span class="go">Go</span></button>`;
  });
  return `
    <div class="place-row"><h2>${esc(zone.name)}</h2><span class="coords">${char.loc.x}, ${char.loc.y}</span></div>
    <p class="small muted" style="margin-top:6px">${esc(zone.desc)}</p>
    <div class="map ${zone.pvp ? 'pvp' : ''}" style="grid-template-columns:repeat(${zone.size},1fr)">${cells.join('')}</div>
    <div class="legend"><span><b>T</b> Town</span><span><b>P</b> Path</span><span><b>X</b> Locked path</span><span><b>B</b> Boss</span><span>Tap any square to walk there.</span></div>
    ${dests.length ? `<h3>Paths</h3><div class="rows">${dests.join('')}</div>` : ''}`;
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
    <div class="panel-head"><h2>${esc(base.name)}</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
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
    <div class="panel-head"><h2>${esc(zone.town.name)} Shop</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small muted">You have <span class="gold">${fmt(char.gold)} gold</span>.</p>
    <div class="chips">
      ${slots.map((s) => `<button class="chip ${s === ui.shopSlot ? 'on' : ''}" data-a="shopslot" data-v="${s}">${SLOT_LABEL[s]}</button>`).join('')}
      <button class="chip ${ui.usableOnly ? 'on' : ''}" data-a="usable">Usable only</button>
    </div>
    ${wares || '<p class="empty">Nothing here you can use yet.</p>'}
  </div>`;
}

function sheetLevel() {
  return `<div class="panel">
    <div class="panel-head"><h2>Level ${char.level}!</h2>${btn('later', null, 'Later', 'sm ghost')}</div>
    <p class="muted">You have ${char.pendingLevels} level${char.pendingLevels > 1 ? 's' : ''} to spend. Put all ${POINTS_PER_LEVEL} points into one stat, or ${POINTS_PER_LEVEL / STATS.length} into every stat.</p>
    ${levelChooser()}
  </div>`;
}

function sheetBank() {
  if (!inTown(char)) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>Bank</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="muted small">Gold in the bank is safe. If you die or lose a duel, you lose everything you carry.</p>
    <dl class="kv" style="margin:12px 0">
      <dt>Carried</dt><dd class="gold">${fmt(char.gold)} gold</dd>
      <dt>In the bank</dt><dd>${fmt(char.bank || 0)} gold</dd>
    </dl>
    <div class="choose" style="grid-template-columns:1fr 1fr">
      ${btn('deposit', 'all', 'Deposit all', 'primary', char.gold <= 0)}
      ${btn('withdraw', 'all', 'Withdraw all', '', !(char.bank > 0))}
    </div>
    <label class="field">Amount<input id="amount" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Gold"></label>
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
  const list = !board ? '<p class="empty">Reading the board.</p>'
    : !board.length ? '<p class="empty">The board is empty. New quests are posted every hour.</p>'
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
    <div class="panel-head"><h2>Quest board</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small muted">New quests are posted every hour and last three hours. The first adventurer to finish one claims the reward.</p>
    ${active}${cooldown}${list}${news}
  </div>`;
}

async function loadBoard() {
  try {
    const [res, news] = await Promise.all([api('quests'), recentEvents().catch(() => [])]);
    ui.questBoard = res.quests;
    ui.news = news;
  } catch (err) {
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
  if (char.pendingLevels > ui.levelSheetSnoozed && !fighting() && ui.tab !== 'hero') return sheetLevel();
  return '';
}

// ---------------------------------------------------------------- render
const painted = {};
function paint(id, html) {
  if (painted[id] === html) return false;
  painted[id] = html;
  document.getElementById(id).innerHTML = html;
  return true;
}

let lastView = null;
function render() {
  let main;
  let dock = '';
  let fill = false;
  if (ui.phase === 'loading') main = viewLoading();
  else if (ui.phase === 'auth') main = viewAuth();
  else if (char && ui.sanctions?.banned) main = viewBanned();
  else if (!char) main = viewCreate();
  else if (ui.tab === 'hero') main = viewHero();
  else if (ui.tab === 'gear') main = viewGear();
  else if (ui.tab === 'map') main = viewMap();
  else if (char.battle) { main = viewBattle(); dock = dockBattle(); fill = true; }
  else { main = viewExplore(); dock = dockExplore(); }

  const mainEl = $('#main');
  mainEl.classList.toggle('fill', fill);
  const changed = paint('main', main);
  const inGame = ui.phase === 'game' && !!char && !ui.sanctions?.banned;
  paint('top', inGame ? viewTop() : '');
  paint('dock', inGame ? dock : '');
  paint('nav', inGame ? viewNav() : '');
  paint('sheet', viewSheet());

  const viewKey = `${ui.phase}:${!!char}:${ui.tab}:${!!char?.battle}`;
  if (viewKey !== lastView) { mainEl.scrollTop = 0; lastView = viewKey; }
  const log = $('#log');
  if (log && changed) log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------- battle feedback
function floatText(sideId, text, cls) {
  const side = document.getElementById(sideId);
  if (!side) return;
  const el = document.createElement('span');
  el.className = `float ${cls}`;
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
function playEffects(entries) {
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
    case 'authmode': ui.authMode = v; ui.authMsg = ''; ui.email = $('#email')?.value || ui.email; return true;
    case 'tab': ui.tab = v; ui.sheet = null; if (v === 'explore') refreshPlayers(); return true;
    case 'list': ui.list = v; refreshPlayers(); return true;
    case 'shop': ui.sheet = { type: 'shop' }; return true;
    case 'bank': ui.sheet = { type: 'bank' }; return true;
    case 'quests': ui.sheet = { type: 'quests' }; ui.questBoard = null; loadBoard(); return true;
    case 'shopslot': ui.shopSlot = v; return true;
    case 'usable': ui.usableOnly = !ui.usableOnly; return true;
    case 'item': ui.sheet = { type: 'item', uid: Number(v) }; return true;
    case 'close': ui.sheet = null; return true;
    case 'later': ui.levelSheetSnoozed = char.pendingLevels; return true;
    case 'pref': prefs[v] = !prefs[v]; savePrefs(); if (v === 'vibrate' && prefs.vibrate) buzz(30); return true;
    case 'noop': return true;
    case 'seenann': try { localStorage.setItem(SEEN_KEY, String(ui.announcement?.id || 0)); } catch { /* ignore */ } return true;
    default: return false;
  }
}

// Actions the server performs: [action, args, successMessage?], or null to cancel.
function remoteCall(a, v) {
  switch (a) {
    case 'create': return ['create', { name: $('#name')?.value || '', race: ui.race }];
    case 'move': return ['move', { dir: v }];
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
    case 'sell': return ['sell', { uid: Number(v) }, 'Sold.'];
    case 'deposit': case 'withdraw': {
      const amount = v === 'all' ? 'all' : ($('#amount')?.value || '').trim();
      if (v !== 'all' && !amount) { toast('Enter an amount of gold.', 'bad'); return null; }
      return [a, { amount }, a === 'deposit' ? 'Deposited.' : 'Withdrawn.'];
    }
    case 'accept': return ['accept', { questId: v }, 'Quest accepted. Good hunting.'];
    case 'abandon': return confirm('Abandon your quest?') ? ['abandon', {}, 'Quest abandoned.'] : null;
    case 'level': return ['level', { stat: v }, v === 'all' ? 'Every stat increased.' : `${STAT_LABEL[v]} increased.`];
    case 'attack': return confirm('Attack this player? The loser drops 10% of their gold.') ? ['attack', { targetId: v }] : null;
    case 'delete': return confirm(`Delete ${char.name} forever? This cannot be undone.`) ? ['delete', {}, 'Your hero is gone.'] : null;
    default: return null;
  }
}

async function runRemote(a, v, el) {
  const call = remoteCall(a, v);
  if (!call) return;
  const [action, args, msg] = call;
  const before = char && {
    loc: locKey(), zone: char.loc.zone,
    battleLog: char.battle && !char.battle.pvp ? char.battle.log.length : 0,
    battleId: char.battle?.monsterId,
  };
  ui.busy = true;
  el?.classList.add('pending');
  try {
    const res = await api(action, args);
    char = res.char;
    if ('sanctions' in res) ui.sanctions = res.sanctions;
    if (msg) toast(msg);
    if (action === 'create' && char) { ui.tab = 'explore'; toast(`Welcome to ${ZONES[char.loc.zone].name}, ${char.name}.`); }
    if (action === 'sell' || action === 'buyequip') ui.sheet = null;
    if (action === 'fight' || action === 'attack' || action === 'hunt') ui.tab = 'explore';
    if (char?.battle?.hunt && ['melee', 'cast'].includes(action)) {
      const h = ui.hunts.find((x) => x.id === char.battle.hunt);
      if (h) h.hp = char.battle.hp;
      if (char.battle.over === 'victory' || char.battle.over === 'ended') loadHunts();
    }
    if (char && before && char.loc.zone !== before.zone && char.battle?.over !== 'defeat') toast(`You travel to ${ZONES[char.loc.zone].name}.`);
    if (action === 'accept' || action === 'abandon') loadBoard();
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'bad');
    if (err.status === 401) await sb.auth.signOut();
  } finally {
    ui.busy = false;
    el?.classList.remove('pending');
  }
  render();
  // Battle feedback for the new log lines.
  const b = char?.battle;
  if (b && ['melee', 'cast', 'flee', 'attack'].includes(action)) {
    const start = b.monsterId && b.monsterId === before?.battleId ? before.battleLog : 0;
    playEffects(b.log.slice(start));
  }
  if (char && before && locKey() !== before.loc) { ui.players = null; refreshPlayers(); }
  if (action === 'attack' || action === 'done') refreshPlayers();
}

document.addEventListener('click', async (e) => {
  if (e.target.id === 'sheet') {
    if (ui.sheet) ui.sheet = null; else if (char) ui.levelSheetSnoozed = char.pendingLevels;
    render();
    return;
  }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if (a === 'signout') { await sb.auth.signOut(); return; }
  if (handleLocal(a, el.dataset.v)) { render(); return; }
  if (ui.busy) return;
  if (BATTLE_ACTIONS.has(a)) {
    const now = Date.now();
    if (now < ui.nextActionAt) return; // guard against accidental double taps
    ui.nextActionAt = now + 250;
  }
  await runRemote(a, el.dataset.v, el);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authform') return;
  e.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  ui.email = email;
  const submit = e.target.querySelector('button[type=submit]');
  submit.disabled = true;
  submit.classList.add('pending');
  try {
    if (ui.authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        ui.authMode = 'signin';
        ui.authMsg = 'Account created. Check your email to confirm it, then sign in here.';
        ui.authMsgKind = 'good';
        render();
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    ui.authMsg = err.message || 'Could not sign in.';
    ui.authMsgKind = 'bad';
    painted.main = null;
    render();
  }
});

// Keyboard support for desktop testing.
const KEY_DIRS = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e' };
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'name') $('[data-a="create"]')?.click();
    return;
  }
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); return; }
  if (KEY_DIRS[e.key] && char && !char.battle && ui.tab === 'explore' && !ui.sheet) {
    e.preventDefault();
    $(`[data-a="move"][data-v="${KEY_DIRS[e.key]}"]`)?.click();
  }
});

// ---------------------------------------------------------------- timers and boot
async function refreshPlayers() {
  if (!char || ui.list !== 'players' || ui.tab !== 'explore' || char.battle) return;
  const key = locKey();
  try {
    const list = await playersAt(char.loc, char.name);
    if (!char || key !== locKey()) return;
    ui.players = list;
    ui.playersKey = key;
    render();
  } catch (err) {
    toast(err.message, 'bad');
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

async function loadWorldConfig() {
  try {
    const { data } = await sb.from('world_config').select('data').eq('id', 1).maybeSingle();
    setWorld(data?.data || null);
    render();
  } catch { /* keep defaults */ }
}

async function loadHunts() {
  try {
    const { data } = await sb.from('hunts').select('id, zone, name, level, hp, max_hp, ends_at')
      .eq('status', 'active').gt('ends_at', new Date().toISOString()).limit(20);
    ui.hunts = data || [];
    render();
  } catch { /* not important */ }
}

async function loadAnnouncement() {
  try {
    const { data } = await sb.from('events').select('id, text, created_at').eq('kind', 'announce')
      .gt('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
      .order('created_at', { ascending: false }).limit(1);
    ui.announcement = data?.[0] || null;
    render();
  } catch { /* not important */ }
}

async function loadHero() {
  try {
    const res = await api('state');
    char = res.char;
    ui.sanctions = res.sanctions || null;
    ui.phase = 'game';
    loadAnnouncement();
    loadWorldConfig();
    loadHunts();
  } catch (err) {
    toast(err.message, 'bad');
    ui.phase = 'auth';
  }
  render();
  refreshPlayers();
}

sb.auth.onAuthStateChange((event, newSession) => {
  const wasSignedIn = !!session;
  session = newSession;
  if (!newSession) {
    char = null;
    ui.phase = 'auth';
    ui.sheet = null;
    render();
  } else if (!wasSignedIn) {
    ui.phase = 'loading';
    render();
    setTimeout(loadHero, 0); // don't call Supabase from inside the auth callback
  }
});

render();

// Expose for debugging from the browser console.
window.clickmonster = { get char() { return char; }, MONSTERS };
