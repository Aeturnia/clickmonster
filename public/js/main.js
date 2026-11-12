// UI layer. All game rules live in ./engine — this file only renders and dispatches.
import { RACES, affinityLabel } from './data/races.js';
import { STATS, STAT_LABEL, STAT_SHORT, STAT_DESC, POINTS_PER_LEVEL } from './data/stats.js';
import { ITEMS, SLOTS, SLOT_LABEL, WEAPON_TYPES, tierRoman } from './data/items.js';
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
import { sb, api, playersAt } from './net.js';

// The server owns the real character; `char` is the latest copy it sent us.
// Game rules run here only to display numbers (hit chances, costs, requirements).
let session = null;
let char = null;
const ui = {
  phase: 'loading', // loading | auth | game
  authMode: 'signin',
  tab: 'explore', list: 'monsters', race: 'human', modal: null, shopSlot: 'weapon',
  nextActionAt: 0, busy: false, players: null, playersKey: null,
};

// ---------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => `${Math.round(n * 100)}%`;
const fmt = (n) => Math.round(n).toLocaleString();
const btn = (a, v, label, cls = '', disabled = false) =>
  `<button data-a="${a}" ${v != null ? `data-v="${esc(v)}"` : ''} class="${cls}" ${disabled ? 'disabled' : ''}>${label}</button>`;

function bar(cur, max, cls = '') {
  const w = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="bar ${cls}"><i style="width:${w}%"></i><span>${fmt(cur)} / ${fmt(max)}</span></div>`;
}

function conClass(monLevel) {
  const d = monLevel - char.level;
  if (d <= -6) return 'con-gray';
  if (d <= -3) return 'con-green';
  if (d <= 1) return 'con-white';
  if (d <= 3) return 'con-yellow';
  if (d <= 6) return 'con-orange';
  return 'con-red';
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

function socketsHtml(item) {
  const base = ITEMS[item.base];
  if (!base.sockets) return '';
  let s = '<span class="sockets">';
  for (let i = 0; i < base.sockets; i++) {
    const g = item.gems[i] && parseGem(item.gems[i]);
    s += `<span class="sock ${g ? g.type : ''}"></span>`;
  }
  return `${s}</span>`;
}

function itemSummary(base) {
  if (base.slot === 'weapon') return `${WEAPON_TYPES[base.type].label} · Power ${base.power}`;
  if (base.slot === 'focus') return `${ELEMENT_LABEL[base.element]} focus · Power ${base.power}`;
  return `Armor ${base.armor}`;
}

function reqHtml(baseId) {
  const base = ITEMS[baseId];
  const entries = Object.entries(base.req);
  if (!entries.length) return '<span class="muted">No requirements</span>';
  const stats = totalStats(char, base.slot);
  return entries.map(([s, n]) => `<span class="${stats[s] < n ? 'req-bad' : ''}">${STAT_SHORT[s]} ${n}</span>`).join(' · ');
}

function isProficient(base) {
  const a = RACES[char.race].affinity;
  return (base.slot === 'weapon' && a.kind === 'weapon' && a.type === base.type)
    || (base.slot === 'focus' && a.kind === 'element' && a.element === base.element);
}

// ---------------------------------------------------------------- header + nav
function renderTop() {
  if (!char) { $('#top').innerHTML = ''; return; }
  const race = RACES[char.race];
  const gemCount = Object.values(char.gems).reduce((a, b) => a + b, 0);
  $('#top').innerHTML = `
    <div class="who">
      <b>${esc(char.name)}</b><span class="muted">Lv ${char.level} ${race.name}</span>
      <span class="purse"><span class="gold">● ${fmt(char.gold)}</span><span title="Gems">◆ ${gemCount}</span></span>
    </div>
    <div class="bars">
      ${bar(char.hp, maxHp(char))}
      ${bar(char.xp, xpToNext(char.level), 'xp')}
    </div>
    ${char.pendingLevels && ui.tab !== 'hero' ? `<button class="levelup" data-a="tab" data-v="hero">Level up! Spend your points (${char.pendingLevels})</button>` : ''}`;
}

function renderNav() {
  if (!char) { $('#nav').innerHTML = ''; return; }
  const fighting = char.battle && !char.battle.over;
  const tabs = [
    ['explore', fighting ? '⚔' : '⌖', fighting ? 'Battle' : 'Explore'],
    ['hero', '♜', 'Hero'],
    ['gear', '⛨', 'Gear'],
    ['map', '▦', 'Map'],
  ];
  const active = ui.tab === 'shop' ? 'explore' : ui.tab;
  $('#nav').innerHTML = `<div class="in">${tabs.map(([id, ic, label]) =>
    `<button data-a="tab" data-v="${id}" class="${active === id ? 'on' : ''}"><span class="ic">${ic}</span>${label}${id === 'hero' && char.pendingLevels ? '<span class="dot"></span>' : ''}</button>`).join('')}</div>`;
}

// ---------------------------------------------------------------- views
function viewLoading() {
  return '<div class="hero-title"><h1>ClickMonster</h1><p>Loading…</p></div>';
}

function viewAuth() {
  const signup = ui.authMode === 'signup';
  return `
    <div class="hero-title">
      <h1>ClickMonster</h1>
      <p>A shared world of monsters, gold and glory.</p>
    </div>
    <form class="card" id="authform" autocomplete="on">
      <h2>${signup ? 'Create an account' : 'Sign in'}</h2>
      <h3>Email</h3>
      <input id="email" type="email" inputmode="email" autocomplete="email" required value="${esc(ui.email || '')}">
      <h3>Password</h3>
      <input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required>
      ${ui.authMsg ? `<p class="small ${ui.authMsgKind || 'muted'}" style="margin-top:10px">${esc(ui.authMsg)}</p>` : ''}
      <button type="submit" class="primary block" style="margin-top:14px">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    ${btn('authmode', signup ? 'signin' : 'signup', signup ? 'I already have an account' : 'New here? Create an account', 'block')}`;
}

function viewCreate() {
  const r = RACES[ui.race];
  const zone = ZONES[r.startZone];
  const bonuses = Object.entries(r.bonus).map(([s, n]) => `+${n} ${STAT_SHORT[s]}`).join(', ');
  return `
    <div class="hero-title">
      <h1>ClickMonster</h1>
      <p>A world of monsters awaits. Who are you?</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Name</h3>
      <input id="name" type="text" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Your hero's name" value="${esc(ui.draftName || '')}">
      <h3>Race</h3>
      <div class="races">
        ${Object.values(RACES).map((x) => `<button data-a="race" data-v="${x.id}" class="${x.id === ui.race ? 'on' : ''}"><b>${x.name}</b><small>${affinityLabel(x)}</small></button>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>${r.name}</h2>
      <p>${r.desc}</p>
      <dl class="kv">
        <dt>Proficiency</dt><dd>${affinityLabel(r)}</dd>
        <dt>Stat bonus</dt><dd>${bonuses}</dd>
        <dt>Starting zone</dt><dd>${zone.name}</dd>
      </dl>
      <p class="small muted" style="margin-top:10px">Proficiency gives +25% damage and +5% hit chance with that weapon or element. There are no classes — you choose where every point goes.</p>
    </div>
    ${btn('create', null, 'Begin your adventure', 'primary block')}`;
}

function viewExplore() {
  if (char.battle) return viewBattle();
  const zone = currentZone(char);
  const { x, y } = char.loc;
  const here = featuresAt(zone, x, y);
  let featureHtml = '';

  for (const f of here) {
    if (f.type === 'town') {
      const cost = healCost(char);
      featureHtml += `<div class="card feature">
        <h2>${esc(f.name)}</h2>
        <p class="muted small">A safe haven with a merchant, a healer and a jeweler.</p>
        <div class="grid2">
          ${btn('tab', 'shop', 'Shop')}
          ${btn('heal', null, cost > 0 ? `Healer · ${fmt(cost)}g` : 'Healer · Full HP', '', cost <= 0)}
        </div>
      </div>`;
    } else if (f.type === 'portal') {
      const locked = char.level < f.minLevel;
      featureHtml += `<div class="card feature">
        <h2>${esc(f.label)}</h2>
        ${locked ? `<p class="warn small">Requires level ${f.minLevel}. The way is barred to you for now.</p>` : `<p class="muted small">Travel to ${esc(ZONES[f.to].name)}${ZONES[f.to].minLevel ? ` (level ${ZONES[f.to].minLevel}+)` : ''}.</p>`}
        ${btn('portal', null, locked ? `Locked · Level ${f.minLevel}` : 'Travel', locked ? '' : 'primary block', locked)}
      </div>`;
    } else if (f.type === 'lair' && zone.boss) {
      featureHtml += `<div class="card feature"><h2>A Lair</h2><p class="muted small">Something powerful dwells here. ${esc(zone.boss.name)} awaits challengers.</p></div>`;
    }
  }

  const pois = [];
  if (zone.town) pois.push([zone.town.name, zone.town.x, zone.town.y]);
  for (const f of zone.features) {
    if (f.type === 'portal') pois.push([f.label + (char.level < f.minLevel ? ` (Lv ${f.minLevel})` : ''), f.x, f.y]);
    if (f.type === 'lair' && zone.boss) pois.push(['Boss lair', f.x, f.y]);
  }

  const list = ui.list === 'monsters' ? monsterListHtml() : playersHtml(zone);
  const notices = (char.notices || []).length ? `<div class="card feature">
      ${char.notices.map((n) => `<p class="small">${esc(n.text)}</p>`).join('')}
      ${btn('dismiss', null, 'Dismiss', 'sm')}
    </div>` : '';

  return `
    ${notices}
    <div class="card">
      <div class="loc-title">
        <h2 style="margin:0">${esc(zone.name)}</h2>
        <span class="coords">x:${x} y:${y}</span>
        ${zone.pvp ? '<span class="badge pvp">PvP</span>' : ''}
        <span class="badge">Lv ${zone.levelRange[0]}–${zone.levelRange[1]}</span>
      </div>
      <p class="muted small" style="margin-top:6px">${esc(zone.desc)}</p>
      <ul class="pois">${pois.map(([n, px, py]) => `<li><b>${esc(n)}</b><span>${directionTo(char, px, py)}</span></li>`).join('')}</ul>
    </div>
    ${featureHtml}
    <div class="dpad">
      ${btn('move', 'n', '▲', 'n', y <= 1)}
      ${btn('move', 'w', '◀', 'w', x <= 1)}
      <div class="c">${x},${y}</div>
      ${btn('move', 'e', '▶', 'e', x >= zone.size)}
      ${btn('move', 's', '▼', 's', y >= zone.size)}
    </div>
    <div class="seg">
      ${btn('list', 'monsters', 'Monsters', ui.list === 'monsters' ? 'on' : '')}
      ${btn('list', 'players', 'Players', ui.list === 'players' ? 'on' : '')}
    </div>
    ${list}`;
}

function monsterListHtml() {
  const mons = monstersHere(char);
  if (!mons.length) return '<p class="muted">No monsters roam here.</p>';
  return `<div class="list">${mons.map((m) => `
    <button class="mon ${m.boss ? 'boss' : ''}" data-a="fight" data-v="${m.id}">
      <span class="lvl ${conClass(m.level)}">Lv ${m.level}</span>
      <span class="nm">${esc(m.name)}${m.boss ? ' <span class="badge">Boss</span>' : ''}<small>${m.element ? `${ELEMENT_LABEL[m.element]} · ` : ''}${m.arch}</small></span>
      <span class="go">Fight</span>
    </button>`).join('')}</div>`;
}

function playersHtml(zone) {
  const players = ui.playersKey === locKey() ? ui.players : null;
  const safe = inTown(char);
  const pvpNote = zone.pvp
    ? `<p class="small ${safe ? 'muted' : 'warn'}" style="margin:0 0 8px">${safe ? 'Towns are safe, even in lawless lands.' : 'Lawless land: players here may attack you, and you them.'}</p>`
    : '';
  if (!players) return `${pvpNote}<p class="muted">Looking around…</p>`;
  if (!players.length) return `${pvpNote}<div class="card"><p style="margin:0">No other adventurers are here right now.</p></div>`;
  return `${pvpNote}<div class="list">${players.map((p) => {
    const canHit = zone.pvp && !safe && p.level >= char.level - PVP_LEVEL_GAP;
    return `<div class="mon card" style="margin:0">
      <span class="lvl ${conClass(p.level)}">Lv ${p.level}</span>
      <span class="nm">${esc(p.name)}<small>${RACES[p.race]?.name || ''}</small></span>
      ${canHit ? btn('attack', p.id, 'Attack', 'sm danger') : ''}
    </div>`;
  }).join('')}</div>`;
}

const locKey = () => `${char.loc.zone}:${char.loc.x}:${char.loc.y}`;

async function refreshPlayers() {
  if (!char || ui.list !== 'players' || ui.tab !== 'explore' || char.battle) return;
  const key = locKey();
  try {
    const list = await playersAt(char.loc, char.name);
    if (key !== locKey()) return;
    ui.players = list;
    ui.playersKey = key;
    render();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function viewBattle() {
  const b = char.battle;
  if (b.pvp) {
    return `
      <div class="card foe"><h2>Duel: ${esc(b.opponent)}</h2>
        <p class="muted small">${b.over === 'victory' ? 'You won the duel.' : 'You lost the duel.'}</p></div>
      <div class="log" id="log">${b.log.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('')}</div>
      <div class="actions">${btn('done', null, 'Continue', 'big primary full')}</div>`;
  }
  const mon = monsterCombatant(b.monsterId);
  const player = playerCombatant(char);
  const logHtml = b.log.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('');
  let actions;
  if (!b.over) {
    const mHit = meleeChance(player, mon);
    const sHit = spellChance(player, mon);
    const wName = player.melee.type === 'fists' ? 'Fists' : WEAPON_TYPES[player.melee.type].label;
    const sName = ELEMENT_LABEL[player.spell.element];
    actions = `
      ${btn('melee', null, `Melee<small>${wName} · ${pct(mHit)} hit · ~${fmt(meleeBase(player))}</small>`, 'big primary')}
      ${btn('cast', null, `Cast<small>${sName} · ${pct(sHit)} cast · ~${fmt(spellBase(player))}</small>`, 'big')}
      ${btn('flee', null, 'Flee', 'full')}`;
  } else if (b.over === 'victory') {
    const stillHere = monstersHere(char).some((m) => m.id === b.monsterId);
    actions = `
      ${btn('again', null, 'Fight again', 'big primary', !stillHere)}
      ${btn('done', null, 'Continue', 'big')}`;
  } else {
    actions = btn('done', null, 'Continue', 'big primary full');
  }
  const gem = b.rewardGem && parseGem(b.rewardGem);
  return `
    <div class="card foe">
      <h2>${esc(mon.name)}</h2>
      <p class="muted small"><span class="${conClass(mon.level)}">Level ${mon.level}</span>${mon.element ? ` · ${ELEMENT_LABEL[mon.element]}` : ''} · ${mon.def.arch}</p>
      ${bar(b.hp, b.maxHp, 'mon')}
    </div>
    <div class="log" id="log">${logHtml}${gem ? `<p class="win">You found a ${esc(gem.name)}! (+${gem.bonus} ${STAT_SHORT[gem.stat]})</p>` : ''}</div>
    <div class="actions">${actions}</div>`;
}

function viewHero() {
  const race = RACES[char.race];
  const stats = totalStats(char);
  const bonus = gemBonuses(char);
  const p = playerCombatant(char);
  let lvl = '';
  if (char.pendingLevels) {
    lvl = `<div class="card feature">
      <h2>Level up! <span class="badge">${char.pendingLevels} to spend</span></h2>
      <p class="muted small">Put all ${POINTS_PER_LEVEL} points into one stat, or spread ${POINTS_PER_LEVEL / STATS.length} into every stat.</p>
      <div class="lvlgrid">
        ${STATS.map((s) => btn('level', s, `+${POINTS_PER_LEVEL} ${STAT_SHORT[s]}<small>${char.stats[s]} → ${char.stats[s] + POINTS_PER_LEVEL}</small>`)).join('')}
        ${btn('level', 'all', `+${POINTS_PER_LEVEL / STATS.length} to all stats`, 'all')}
      </div>
    </div>`;
  }
  return `
    ${lvl}
    <div class="card">
      <h2>${esc(char.name)}</h2>
      <p class="muted">Level ${char.level} ${race.name} · <span class="badge prof">${affinityLabel(race)}</span></p>
      ${STATS.map((s) => `<div class="stat"><span>${STAT_LABEL[s]}</span>
        <span class="v">${fmt(stats[s])}${bonus[s] ? ` <span class="plus">(+${bonus[s]})</span>` : ''}</span>
        <span class="d">${STAT_DESC[s]}</span></div>`).join('')}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Combat</h3>
      <dl class="kv">
        <dt>Max health</dt><dd>${fmt(maxHp(char))}</dd>
        <dt>Armor</dt><dd>${fmt(totalArmor(char))}</dd>
        <dt>Melee damage</dt><dd>~${fmt(meleeBase(p))}${p.melee.prof ? ' <span class="badge prof">Prof</span>' : ''}</dd>
        <dt>Spell damage</dt><dd>~${fmt(spellBase(p))} ${ELEMENT_LABEL[p.spell.element]}${p.spell.prof ? ' <span class="badge prof">Prof</span>' : ''}</dd>
        <dt>Experience</dt><dd>${fmt(char.xp)} / ${fmt(xpToNext(char.level))}</dd>
        <dt>Monsters slain</dt><dd>${fmt(char.kills)}</dd>
        <dt>Defeats</dt><dd>${fmt(char.deaths)}</dd>
      </dl>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Account</h3>
      <p class="muted small">Signed in as ${esc(session?.user?.email || '')}. Your hero is saved online.</p>
      <div class="grid2">
        ${btn('signout', null, 'Sign out')}
        ${btn('delete', null, 'Delete hero', 'danger')}
      </div>
    </div>`;
}

function itemRow(item, slotLabel) {
  const base = ITEMS[item.base];
  return `<button class="item" data-a="item" data-v="${item.uid}">
    ${slotLabel ? `<span class="slot">${slotLabel}</span>` : ''}
    <span class="nm">${esc(base.name)}${socketsHtml(item)}<small>${itemSummary(base)}</small></span>
    <span class="sc">Class ${tierRoman(base.tier)}<br>${base.score}</span>
  </button>`;
}

function viewGear() {
  const equipped = SLOTS.map((slot) => {
    const item = equippedItem(char, slot);
    return item ? itemRow(item, SLOT_LABEL[slot])
      : `<div class="item card" style="margin:0"><span class="slot">${SLOT_LABEL[slot]}</span><span class="nm muted">Empty</span></div>`;
  }).join('');
  const pack = char.inventory.filter((i) => !isEquipped(char, i.uid));
  const gems = Object.entries(char.gems).filter(([, n]) => n > 0)
    .map(([k, n]) => ({ ...parseGem(k), n })).filter((g) => g.name)
    .sort((a, b) => b.tier - a.tier || a.type.localeCompare(b.type));
  return `
    <h3 style="margin-top:4px">Equipped</h3>
    <div class="list">${equipped}</div>
    <h3>Pack <span class="muted small">(${pack.length})</span></h3>
    <div class="list">${pack.length ? pack.map((i) => itemRow(i, SLOT_LABEL[ITEMS[i.base].slot])).join('') : '<p class="muted small">Nothing in your pack. Buy gear from a town shop.</p>'}</div>
    <h3>Gems</h3>
    <div class="card">${gems.length ? gems.map((g) => `<div class="gemrow"><span class="sock ${g.type}"></span><span style="flex:1">${g.name}</span><span class="muted">+${g.bonus} ${STAT_SHORT[g.stat]}</span><b>×${g.n}</b></div>`).join('')
      : '<p class="muted small" style="margin:0">Monsters sometimes drop gems. Socket them into gear for stat bonuses. Bosses always drop one.</p>'}</div>`;
}

function viewShop() {
  if (!inTown(char)) { ui.tab = 'explore'; return viewExplore(); }
  const zone = currentZone(char);
  const stock = shopItems(char);
  const slots = SLOTS.filter((s) => stock.some((id) => ITEMS[id].slot === s));
  if (!slots.includes(ui.shopSlot)) ui.shopSlot = slots[0];
  const items = stock.filter((id) => ITEMS[id].slot === ui.shopSlot)
    .sort((a, b) => ITEMS[a].tier - ITEMS[b].tier || ITEMS[a].name.localeCompare(ITEMS[b].name));
  const current = equippedItem(char, ui.shopSlot);
  const curScore = current ? ITEMS[current.base].score : 0;
  return `
    <div class="row" style="margin-bottom:10px">
      ${btn('tab', 'explore', '← Back', 'sm')}
      <h2 style="margin:0 0 0 4px">${esc(zone.town.name)} Shop</h2>
    </div>
    <div class="chips">${slots.map((s) => btn('shopslot', s, SLOT_LABEL[s], s === ui.shopSlot ? 'on' : '')).join('')}</div>
    <div class="list">${items.map((id) => {
      const base = ITEMS[id];
      const ok = meetsRequirements(char, id).ok;
      const diff = base.score - curScore;
      return `<div class="card" style="margin:0">
        <div class="row"><b style="flex:1">${esc(base.name)}</b><span class="badge">Class ${tierRoman(base.tier)}</span></div>
        <p class="small muted" style="margin:4px 0">${itemSummary(base)} · Sockets ${base.sockets}${isProficient(base) ? ' · <span class="good">Proficient</span>' : ''}</p>
        <p class="small" style="margin:0 0 8px">Score ${base.score} <span class="${diff > 0 ? 'good' : 'muted'}">(${diff >= 0 ? '+' : ''}${diff})</span> · ${reqHtml(id)}</p>
        <div class="row"><span class="gold">● ${fmt(base.price)}</span><span class="spacer"></span>
          ${!ok ? '<span class="small req-bad">Can’t equip yet</span>' : ''}
          ${btn('buy', id, 'Buy', 'sm primary', char.gold < base.price)}</div>
      </div>`;
    }).join('')}</div>`;
}

function viewMap() {
  const zone = currentZone(char);
  const cells = [];
  for (let y = 1; y <= zone.size; y++) {
    for (let x = 1; x <= zone.size; x++) {
      const fs = featuresAt(zone, x, y);
      let cls = zone.pvp ? 'pvp' : '';
      let label = '';
      for (const f of fs) {
        if (f.type === 'town') { cls = 'town'; label = '⌂'; }
        if (f.type === 'portal') { cls = `portal ${char.level < f.minLevel ? 'locked' : ''}`; label = char.level < f.minLevel ? '✕' : '⇄'; }
        if (f.type === 'lair') { cls = 'lair'; label = '☠'; }
      }
      if (x === char.loc.x && y === char.loc.y) cls += ' me';
      cells.push(`<div class="${cls}">${label}</div>`);
    }
  }
  const legend = [];
  if (zone.id === 'overworld') {
    for (const f of zone.features) {
      const z = ZONES[f.to];
      legend.push(`<li>${char.level < f.minLevel ? '✕' : '⇄'} <b>${esc(z.name)}</b> <span class="muted">(${f.x},${f.y}) · Lv ${z.levelRange[0]}–${z.levelRange[1]}</span>${z.pvp ? ' <span class="badge pvp">PvP</span>' : ''}</li>`);
    }
  }
  return `
    <div class="card">
      <h2>${esc(zone.name)}</h2>
      <p class="muted small">${zone.size}×${zone.size} · You are at <span class="coords">${char.loc.x},${char.loc.y}</span>. Every spot shares the zone’s monsters; special spots are marked.</p>
      <div class="map" style="grid-template-columns:repeat(${zone.size},1fr)">${cells.join('')}</div>
      <ul class="legend">
        <li>⌂ Town · ⇄ Path · ✕ Locked path · ☠ Boss lair</li>
        ${legend.join('')}
      </ul>
    </div>`;
}

function viewItemModal(uid) {
  const item = findItem(char, uid);
  if (!item) return '';
  const base = ITEMS[item.base];
  const equipped = isEquipped(char, uid);
  const town = inTown(char);
  const req = meetsRequirements(char, item.base);
  const free = base.sockets - item.gems.length;
  const gemKeys = Object.keys(char.gems).filter((k) => char.gems[k] > 0 && parseGem(k));

  const socketList = [];
  for (let i = 0; i < base.sockets; i++) {
    const g = item.gems[i] && parseGem(item.gems[i]);
    socketList.push(`<div class="gemrow"><span class="sock ${g ? g.type : ''}"></span>
      <span style="flex:1">${g ? `${g.name} <span class="muted">+${g.bonus} ${STAT_SHORT[g.stat]}</span>` : '<span class="muted">Empty socket</span>'}</span>
      ${g && town ? btn('extract', i, `Extract · ${extractCost(g.tier)}g`, 'sm', char.gold < extractCost(g.tier)) : ''}</div>`);
  }

  let perk = '';
  if (base.slot === 'weapon') perk = WEAPON_TYPES[base.type].perk;
  if (base.slot === 'focus') perk = `Casts ${ELEMENT_LABEL[base.element]} spells`;

  return `<div class="sheet">
    <div class="row"><h2 style="flex:1;margin:0">${esc(base.name)}</h2>${btn('close', null, '✕', 'sm')}</div>
    <p class="muted small">${SLOT_LABEL[base.slot]} · Class ${tierRoman(base.tier)} · Score ${base.score}${isProficient(base) ? ' · <span class="good">Proficient</span>' : ''}</p>
    <dl class="kv">
      <dt>${base.slot === 'weapon' || base.slot === 'focus' ? 'Power' : 'Armor'}</dt><dd>${base.power ?? base.armor}</dd>
      ${perk ? `<dt>Trait</dt><dd>${perk}</dd>` : ''}
      <dt>Requires</dt><dd>${reqHtml(item.base)}</dd>
    </dl>
    ${base.sockets ? `<h3>Sockets</h3>${socketList.join('')}` : ''}
    ${free > 0 && gemKeys.length ? `<h3>Socket a gem</h3><div class="chips" style="flex-wrap:wrap">${gemKeys.map((k) => {
      const g = parseGem(k);
      return btn('socket', k, `<span class="sock ${g.type}"></span> ${g.name} ×${char.gems[k]}`);
    }).join('')}</div><p class="small muted">Socketed gems can be extracted later at a town jeweler for a fee.</p>` : ''}
    <div class="grid2" style="margin-top:14px">
      ${equipped ? btn('unequip', base.slot, 'Unequip') : btn('equip', uid, req.ok ? 'Equip' : 'Requirements not met', 'primary', !req.ok)}
      ${town ? btn('sell', uid, equipped ? 'Unequip to sell' : `Sell · ${fmt(sellPrice(item))}g`, 'danger', equipped) : '<button disabled>Sell in town</button>'}
    </div>
    ${item.gems.length && !equipped && town ? '<p class="small warn" style="margin-top:8px">Selling destroys any socketed gems.</p>' : ''}
  </div>`;
}

// ---------------------------------------------------------------- render
function render() {
  const prevTab = $('#main').dataset.tab;
  const scroll = window.scrollY;
  let html;
  if (ui.phase === 'loading') html = viewLoading();
  else if (ui.phase === 'auth') html = viewAuth();
  else if (!char) html = viewCreate();
  else if (ui.tab === 'hero') html = viewHero();
  else if (ui.tab === 'gear') html = viewGear();
  else if (ui.tab === 'map') html = viewMap();
  else if (ui.tab === 'shop') html = viewShop();
  else html = viewExplore();
  $('#main').innerHTML = html;
  $('#main').dataset.tab = ui.tab;
  renderTop();
  renderNav();
  $('#modal').innerHTML = char && ui.modal?.type === 'item' ? viewItemModal(ui.modal.uid) : '';
  const log = $('#log');
  if (log) log.scrollTop = log.scrollHeight;
  if (prevTab === ui.tab) window.scrollTo(0, scroll);
  else window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- actions
const BATTLE_ACTIONS = new Set(['melee', 'cast', 'flee', 'again', 'fight', 'attack']);

// Actions that only change what's on screen.
function handleLocal(a, v) {
  switch (a) {
    case 'race': ui.draftName = $('#name')?.value || ''; ui.race = v; return true;
    case 'authmode': ui.authMode = v; ui.authMsg = ''; ui.email = $('#email')?.value || ui.email; return true;
    case 'tab': ui.tab = v; ui.modal = null; if (v === 'explore') refreshPlayers(); return true;
    case 'list': ui.list = v; refreshPlayers(); return true;
    case 'shopslot': ui.shopSlot = v; return true;
    case 'item': ui.modal = { type: 'item', uid: Number(v) }; return true;
    case 'close': ui.modal = null; return true;
    default: return false;
  }
}

// Actions the server performs. Returns [action, args, successMessage?] or null to cancel.
function remoteCall(a, v) {
  switch (a) {
    case 'create': return ['create', { name: $('#name')?.value || '', race: ui.race }];
    case 'move': return ['move', { dir: v }];
    case 'fight': return ['fight', { monsterId: v }];
    case 'melee': case 'cast': case 'flee': case 'again': case 'done': case 'dismiss': return [a, {}];
    case 'portal': return ['portal', {}];
    case 'heal': return ['heal', {}, `You are fully healed for ${healCost(char)} gold.`];
    case 'buy': return ['buy', { itemId: v }, `Bought ${ITEMS[v].name}. Equip it from the Gear tab.`];
    case 'equip': return ['equip', { uid: Number(v) }, 'Equipped.'];
    case 'unequip': return ['unequip', { slot: v }];
    case 'socket': return ['socket', { uid: ui.modal.uid, gem: v }, `Socketed ${parseGem(v).name}.`];
    case 'extract': return ['extract', { uid: ui.modal.uid, index: Number(v) }, 'The jeweler extracts the gem.'];
    case 'sell': return ['sell', { uid: Number(v) }, 'Sold.'];
    case 'level': return ['level', { stat: v }, v === 'all' ? 'All stats increased!' : `${STAT_LABEL[v]} increased!`];
    case 'attack': return confirm('Attack this player? The loser drops 10% of their gold.') ? ['attack', { targetId: v }] : null;
    case 'delete':
      return confirm(`Delete ${char.name} forever? This can't be undone.`) ? ['delete', {}, 'Your hero is gone.'] : null;
    default: return null;
  }
}

async function runRemote(a, v) {
  const call = remoteCall(a, v);
  if (!call) return;
  const [action, args, msg] = call;
  const before = char && { zone: char.loc.zone, ...char.loc, level: char.level };
  ui.busy = true;
  document.body.classList.add('busy');
  try {
    const res = await api(action, args);
    char = res.char;
    if (msg) toast(msg);
    if (action === 'create' && char) { ui.tab = 'explore'; toast(`Welcome to ${ZONES[char.loc.zone].name}, ${char.name}!`); }
    if (action === 'sell') ui.modal = null;
    if (action === 'fight' || action === 'attack') ui.tab = 'explore';
    if (char && before && char.loc.zone !== before.zone) toast(`You travel to ${ZONES[char.loc.zone].name}.`);
    if (char && before && char.level > before.level) toast(`Level ${char.level}! Spend your points on the Hero tab.`);
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'bad');
    if (err.status === 401) await sb.auth.signOut();
  } finally {
    ui.busy = false;
    document.body.classList.remove('busy');
  }
  render();
  if (char && before && locKey() !== `${before.zone}:${before.x}:${before.y}`) { ui.players = null; refreshPlayers(); }
  if (action === 'attack' || action === 'done') refreshPlayers();
}

document.addEventListener('click', async (e) => {
  if (e.target.id === 'modal') { ui.modal = null; render(); return; }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if (a === 'signout') { await sb.auth.signOut(); return; }
  if (handleLocal(a, el.dataset.v)) { render(); return; }
  if (ui.busy) return;
  if (BATTLE_ACTIONS.has(a)) {
    const now = Date.now();
    if (now < ui.nextActionAt) return; // small cooldown against accidental double-taps
    ui.nextActionAt = now + 250;
  }
  await runRemote(a, el.dataset.v);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authform') return;
  e.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  ui.email = email;
  const submit = e.target.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    if (ui.authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        ui.authMode = 'signin';
        ui.authMsg = 'Account created! Check your email to confirm it, then sign in here.';
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
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'name') $('[data-a="create"]')?.click();
  if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); }
});

// Passive regeneration, shown locally between server updates (the server does the real math).
setInterval(() => {
  if (!char) return;
  const before = char.hp;
  applyRegen(char);
  if (char.hp !== before) {
    renderTop();
    if (ui.tab === 'explore' && !char.battle) {
      const healBtn = document.querySelector('[data-a="heal"]');
      if (healBtn) {
        const cost = healCost(char);
        healBtn.textContent = cost > 0 ? `Healer · ${fmt(cost)}g` : 'Healer · Full HP';
        healBtn.disabled = cost <= 0;
      }
    }
  }
}, 1000);

// Keep the players list fresh while it's open.
setInterval(() => { if (document.visibilityState === 'visible') refreshPlayers(); }, 15000);

async function loadHero() {
  try {
    char = (await api('state')).char;
    ui.phase = 'game';
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
    ui.modal = null;
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
