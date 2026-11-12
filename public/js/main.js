// UI layer. All game rules live in ./engine — this file only renders and dispatches.
import { RACES, affinityLabel } from './data/races.js';
import { STATS, STAT_LABEL, STAT_SHORT, STAT_DESC, POINTS_PER_LEVEL } from './data/stats.js';
import { ITEMS, SLOTS, SLOT_LABEL, WEAPON_TYPES, tierRoman } from './data/items.js';
import { ELEMENT_LABEL } from './data/elements.js';
import { ZONES, MONSTERS } from './data/zones.js';
import { GEM_TYPES, parseGem, extractCost } from './data/gems.js';
import {
  createCharacter, maxHp, xpToNext, totalStats, gemBonuses, totalArmor, playerCombatant,
  spendLevel, applyRegen, healCost, findItem, equippedItem, meetsRequirements, SAVE_VERSION,
} from './engine/character.js';
import { currentZone, featuresAt, inTown, monstersHere, move, usePortal, heal, directionTo } from './engine/world.js';
import { startBattle, battleAction } from './engine/battle.js';
import { monsterCombatant } from './engine/monster.js';
import { meleeChance, spellChance, meleeBase, spellBase } from './engine/combat.js';
import { buy, sell, equip, unequip, socketGem, extractGem, shopItems, isEquipped, sellPrice } from './engine/inventory.js';

// ---------------------------------------------------------------- storage
const SAVE_KEY = 'clickmonster.save.v1';
const store = {
  load() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  save(c) {
    try { if (c) localStorage.setItem(SAVE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  },
  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  },
};

function validSave(c) {
  return c && c.v === SAVE_VERSION && RACES[c.race] && c.loc && ZONES[c.loc.zone] ? c : null;
}

let char = validSave(store.load());
const ui = { tab: 'explore', list: 'monsters', race: 'human', modal: null, shopSlot: 'weapon', nextActionAt: 0 };

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

  return `
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
  return `<div class="card"><p>You're the only adventurer at this spot.</p>
    <p class="muted small">Multiplayer is coming in the next phase: other players here will show up in this list${zone.pvp ? ', and since this is a PvP zone you’ll be able to challenge them' : ''}.</p></div>`;
}

function viewBattle() {
  const b = char.battle;
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
      <h3 style="margin-top:0">Save</h3>
      <p class="muted small">Your hero is saved on this device. Online accounts arrive with multiplayer.</p>
      ${btn('delete', null, 'Delete character', 'danger block')}
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
  if (!char) html = viewCreate();
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
const BATTLE_ACTIONS = new Set(['melee', 'cast', 'flee', 'again', 'fight']);

function handle(a, v) {
  switch (a) {
    case 'race': ui.draftName = $('#name')?.value || ''; ui.race = v; break;
    case 'create': {
      char = createCharacter($('#name')?.value, ui.race);
      ui.tab = 'explore';
      toast(`Welcome to ${ZONES[char.loc.zone].name}, ${char.name}!`);
      break;
    }
    case 'tab': ui.tab = v; ui.modal = null; break;
    case 'list': ui.list = v; break;
    case 'move': move(char, v); break;
    case 'fight': startBattle(char, v); ui.tab = 'explore'; break;
    case 'melee': case 'cast': case 'flee': battleAction(char, a); break;
    case 'again': {
      const id = char.battle.monsterId;
      char.battle = null;
      startBattle(char, id);
      break;
    }
    case 'done': char.battle = null; break;
    case 'portal': { const z = usePortal(char); toast(`You travel to ${z.name}.`); break; }
    case 'heal': { const c = heal(char); toast(`The healer restores you for ${c} gold.`); break; }
    case 'shopslot': ui.shopSlot = v; break;
    case 'buy': { buy(char, v); toast(`Bought ${ITEMS[v].name}. Equip it from the Gear tab.`); break; }
    case 'item': ui.modal = { type: 'item', uid: Number(v) }; break;
    case 'close': ui.modal = null; break;
    case 'equip': equip(char, Number(v)); toast('Equipped.'); break;
    case 'unequip': unequip(char, v); break;
    case 'socket': socketGem(char, ui.modal.uid, v); toast(`Socketed ${parseGem(v).name}.`); break;
    case 'extract': { const c = extractGem(char, ui.modal.uid, Number(v)); toast(`The jeweler extracts the gem for ${c} gold.`); break; }
    case 'sell': { const p = sell(char, Number(v)); ui.modal = null; toast(`Sold for ${p} gold.`); break; }
    case 'level': spendLevel(char, v); toast(v === 'all' ? 'All stats increased!' : `${STAT_LABEL[v]} increased!`); break;
    case 'delete':
      if (confirm(`Delete ${char.name} forever? This can't be undone.`)) {
        store.clear(); char = null; ui.tab = 'explore'; ui.modal = null;
      }
      break;
    default: break;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') { ui.modal = null; render(); return; }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  if (BATTLE_ACTIONS.has(a)) {
    const now = Date.now();
    if (now < ui.nextActionAt) return; // small cooldown against accidental double-taps
    ui.nextActionAt = now + 280;
  }
  try {
    handle(a, el.dataset.v);
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'bad');
  }
  store.save(char);
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'name') $('[data-a="create"]')?.click();
  if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); }
});

// Passive regeneration while out of combat.
setInterval(() => {
  if (!char) return;
  const before = char.hp;
  applyRegen(char);
  if (char.hp !== before) {
    store.save(char);
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

if (char) applyRegen(char);
render();

// Expose for debugging from the browser console.
window.clickmonster = { get char() { return char; }, MONSTERS };
