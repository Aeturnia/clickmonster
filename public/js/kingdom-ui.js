// Kingdoms K-1, stage K1-3: the player's interface (#83; docs/kingdoms-scope.md 5.1.1, 5.2, 5.5;
// docs/kingdoms-k1-plan.md 2.3). The plot map, the Kingdom Zone's Explore screen, the Hero tab's
// Kingdom section and the management view.
//
// Only views and pure helpers live here: main.js owns the state (ui.kingdom, in freshUi()), the
// reads (net.js), the requests and the confirmations, and passes helpers in. This module never
// imports main.js. Nothing here is drawn while Kingdoms are closed: main.js asks kingdomsOpen()
// first.
import { PLOT_WINDOW, KINGDOM_SIZE } from './data/kingdoms.js';

// The per-account state (freshUi()). The window is the top-left plot of the 10 x 10 view; the cells
// are the loaded window's plots, by "x,y", and their key says which window they belong to.
export function freshKingdomState() {
  return {
    win: null, // { x, y }: the window's top-left plot
    cursor: null, // { x, y }: the plot in the tab order (roving focus)
    selected: null, // { x, y }: the plot whose details are shown
    cells: null, cellsKey: null, loadingKey: null, errorKey: null,
    owners: {}, // character id -> hero name
    mine: null, mineKey: null, mineLoading: null, mineErrorKey: null, // the hero's own plot row
    stale: false, mineStale: false, // reload when next drawn, keeping what is shown meanwhile
    finding: false, note: null,
  };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const MAX_ORIGIN = KINGDOM_SIZE - PLOT_WINDOW + 1;
export const windowKey = (win) => (win ? `${win.x},${win.y}` : null);

// The window that shows (x, y), as near the middle as the map's edges allow.
export function windowAround(x, y) {
  const half = Math.floor(PLOT_WINDOW / 2);
  return { x: clamp(x - half + 1, 1, MAX_ORIGIN), y: clamp(y - half + 1, 1, MAX_ORIGIN) };
}
export const inWindow = (win, x, y) => !!win && x >= win.x && y >= win.y && x < win.x + PLOT_WINDOW && y < win.y + PLOT_WINDOW;
export function shiftWindow(win, dx, dy) {
  return { x: clamp(win.x + dx, 1, MAX_ORIGIN), y: clamp(win.y + dy, 1, MAX_ORIGIN) };
}

// What a plot is, for its label and its look. Unknown until the window's plots have loaded:
// a plot is never called free before that is known (the K1-3 plan).
export function plotStatus(k, x, y, char) {
  if (!k.cells || k.cellsKey !== windowKey(k.win)) return { kind: 'loading', text: 'Loading' };
  const p = k.cells[`${x},${y}`];
  if (!p) return { kind: 'free', text: 'Free' };
  if (p.status === 'reserved') return { kind: 'reserved', text: 'Reserved' };
  // The hero's own plot is the one their Kingdom records (I-1).
  if (char?.kingdom && char.kingdom.plot.x === x && char.kingdom.plot.y === y) return { kind: 'mine', text: 'Your Kingdom' };
  const name = k.owners[p.character_id];
  return { kind: 'claimed', text: name ? `Claimed by ${name}` : 'Claimed' };
}
const MARK = { free: '', reserved: 'R', claimed: 'C', mine: 'Y', loading: '' };

// Why a free plot can't be claimed now, or null if it can.
export function claimBlock(char, cfg) {
  if (char.kingdom) return 'You already have a Kingdom.';
  if (char.battle && !char.battle.over) return 'Finish your fight first.';
  if (char.level < cfg.minLevel) return `You must be level ${cfg.minLevel} to claim a plot.`;
  if ((char.gold || 0) < cfg.cost) return `Claiming costs ${cfg.cost} gold, carried. You carry ${char.gold || 0}. Withdraw gold at a bank first.`;
  return null;
}

// ------------------------------------------------------------ the plot map (the Map tab)
export function viewPlotMap({ char, k, cfg, esc, btn, fmt }) {
  const win = k.win;
  const cur = k.cursor && inWindow(win, k.cursor.x, k.cursor.y) ? k.cursor : { x: win.x, y: win.y };
  const loaded = k.cells && k.cellsKey === windowKey(win);
  const failed = !loaded && k.errorKey === windowKey(win);
  const cells = [];
  for (let y = win.y; y < win.y + PLOT_WINDOW; y++) {
    for (let x = win.x; x < win.x + PLOT_WINDOW; x++) {
      const s = failed ? { kind: 'loading', text: 'Not loaded' } : plotStatus(k, x, y, char);
      const sel = k.selected && k.selected.x === x && k.selected.y === y;
      const label = `Plot ${x}, ${y}. ${s.text}${sel ? '. Selected' : ''}`;
      cells.push(`<button class="${s.kind}${sel ? ' sel' : ''}" data-a="kplot" data-v="${x},${y}" tabindex="${x === cur.x && y === cur.y ? '0' : '-1'}" aria-label="${esc(label)}"${sel ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${MARK[s.kind]}</button>`);
    }
  }
  const last = { x: win.x + PLOT_WINDOW - 1, y: win.y + PLOT_WINDOW - 1 };
  const range = `Plots ${win.x} to ${last.x} across, ${win.y} to ${last.y} down`;
  const status = failed
    ? `<div class="notice bad" role="alert"><p class="small" style="margin:0">Couldn’t load these plots.</p>${btn('kretry', null, 'Try again', 'sm')}</div>`
    : loaded ? '' : '<p class="small muted" aria-busy="true">Loading plots…</p>';
  const others = loaded ? Object.values(k.cells).sort((a, b) => a.y - b.y || a.x - b.x) : [];
  const free = loaded ? PLOT_WINDOW * PLOT_WINDOW - others.length : null;
  const list = loaded ? `<h3>In view</h3>
    <p class="small muted">${free === 0 ? 'No free plots in view.' : `${free} free ${free === 1 ? 'plot' : 'plots'} in view.`}${others.length ? ' Taken and reserved:' : ''}</p>
    ${others.length ? `<div class="rows">${others.map((p) => {
      const s = plotStatus(k, p.x, p.y, char);
      return `<button class="row" data-a="kplot" data-v="${p.x},${p.y}"><span class="lv num">${p.x}, ${p.y}</span><span class="nm">${esc(s.text)}</span><span class="go">Show</span></button>`;
    }).join('')}</div>` : ''}` : '';
  return `
    <div class="place-row"><h2>The Kingdom Lands</h2><span class="coords">${KINGDOM_SIZE} by ${KINGDOM_SIZE}</span></div>
    <p class="small muted" style="margin-top:6px">Choose a plot. Moving the view doesn’t move you: you stay at the gate.</p>
    <div class="plot-tools" role="group" aria-label="Move the view">
      ${btn('kwin', 'n', 'North', 'sm', win.y <= 1)}${btn('kwin', 'w', 'West', 'sm', win.x <= 1)}${btn('kwin', 'e', 'East', 'sm', win.x >= MAX_ORIGIN)}${btn('kwin', 's', 'South', 'sm', win.y >= MAX_ORIGIN)}
    </div>
    <p class="small muted" id="plot-range">${range}.</p>
    ${status}
    <div class="map plots" id="plots" role="group" aria-label="${esc(`${range}, ${PLOT_WINDOW} by ${PLOT_WINDOW}`)}" aria-describedby="plot-help" style="--n:${PLOT_WINDOW}">${cells.join('')}</div>
    <div class="legend"><span><b>Y</b> Yours</span><span><b>C</b> Claimed</span><span><b>R</b> Reserved</span><span>Blank: free</span><span id="plot-help">Tap a plot to see it. With a keyboard, arrow keys move between plots, and past the edge move the view by one row.</span></div>
    ${viewSelected({ char, k, cfg, esc, btn, fmt })}
    <h3>Find a plot</h3>
    <div class="plot-find">
      ${char.kingdom ? btn('kmine', null, 'My Kingdom', 'sm') : ''}
      ${btn('kfind', 'near', 'Nearest free plot', 'sm', k.finding)}
      ${btn('kfind', 'random', 'Random free plot', 'sm', k.finding)}
    </div>
    <div class="plot-jump" role="group" aria-label="Show a plot by its coordinates">
      <label class="field">Across <input id="kjump-x" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(k.jumpX ?? '')}"></label>
      <label class="field">Down <input id="kjump-y" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(k.jumpY ?? '')}"></label>
      ${btn('kjump', null, 'Show plot', 'sm')}
    </div>
    ${k.note ? `<p class="small" role="status">${esc(k.note)}</p>` : ''}
    ${list}`;
}

// The selected plot: what it is, and what can be done with it.
function viewSelected({ char, k, cfg, esc, btn, fmt }) {
  if (!k.selected || !inWindow(k.win, k.selected.x, k.selected.y)) return '';
  const { x, y } = k.selected;
  const s = plotStatus(k, x, y, char);
  let act = '';
  if (s.kind === 'free') {
    const why = claimBlock(char, cfg);
    act = `${btn('kclaim', `${x},${y}`, `Claim for ${fmt(cfg.cost)} gold`, 'primary', !!why)}${why ? `<p class="small muted">${esc(why)}</p>` : ''}`;
  } else if (s.kind === 'mine') {
    act = btn('kmanage', null, 'Manage my Kingdom', 'primary');
  }
  return `<div class="plot-sel" aria-live="polite"><h3>Plot ${x}, ${y}</h3><p class="small">${esc(s.text)}.</p>${act}</div>`;
}

// ------------------------------------------------------------ the Kingdom Zone's Explore screen
export function viewKingdomPlace({ char, k, cfg, esc, btn, fmt, zone }) {
  const own = char.kingdom
    ? `<p>Your Kingdom is on plot ${char.kingdom.plot.x}, ${char.kingdom.plot.y}.</p>${btn('kmanage', null, 'Manage my Kingdom', 'primary', !k.mine)}`
    : `<p>Each hero may hold one plot here, as their Kingdom. Choose a free plot on the plot map to claim it.</p>
       <p class="small muted">Claiming needs level ${cfg.minLevel} and costs ${fmt(cfg.cost)} gold, paid from the gold you carry. A Kingdom can’t be moved later.</p>
       ${btn('tab', 'map', 'Open the plot map', 'primary')}`;
  return `<div class="place">
      <div class="place-row"><h2>${esc(zone.name)}</h2><span class="coords">The gate</span></div>
      <p class="here">${esc(zone.desc)}</p>
    </div>
    ${own}`;
}

// ------------------------------------------------------------ the Hero tab's Kingdom section (5.5)
export function viewHeroKingdom({ char, cfg, esc, btn, fmt, inZone }) {
  let body;
  if (!char.kingdom) {
    body = `<p class="small">You have no Kingdom yet. Each hero may claim one plot in the Kingdom Lands, reached from the Crossroads on the Overworld.</p>
      <p class="small muted">Claiming needs level ${cfg.minLevel} and costs ${fmt(cfg.cost)} gold, carried.</p>`;
  } else if (inZone) {
    body = `<p class="small">${esc(char.name)}’s Kingdom, on plot ${char.kingdom.plot.x}, ${char.kingdom.plot.y}.</p>${btn('kmanage', null, 'Manage my Kingdom', 'primary')}`;
  } else {
    body = `<p class="small">${esc(char.name)}’s Kingdom, on plot ${char.kingdom.plot.x}, ${char.kingdom.plot.y}.</p>
      <p class="small muted">Travel to the Kingdom Lands to manage it.</p>`;
  }
  return `<h3>Kingdom</h3>${body}`;
}

// ------------------------------------------------------------ the management view (empty in K-1)
// Release is offered only once the hero's own plot row is loaded and current: the button carries
// that row's ownership instance id, which the release names (K1-DB01).
export function sheetKingdom({ char, k, esc, btn }) {
  const p = char.kingdom?.plot;
  const mk = p ? `${p.x},${p.y}` : null;
  const ready = !!k.mine && k.mineKey === mk && !k.mineStale;
  const failed = !ready && k.mineErrorKey === mk;
  const release = ready
    ? btn('krelease', String(k.mine.id), 'Release my Kingdom', 'danger')
    : failed
      ? `<p class="small" role="alert">Couldn’t load your plot.</p>${btn('kretry', null, 'Try again', 'sm')}`
      : '<p class="small muted" aria-busy="true">Loading your plot…</p>';
  return `<div class="panel">
    <div class="panel-head"><h2 id="sheet-title" tabindex="-1">${esc(char.name)}’s Kingdom</h2>${btn('close', null, 'Close', 'sm ghost')}</div>
    <p class="small">On plot ${p ? `${p.x}, ${p.y}` : 'none'}.</p>
    <p class="small muted">Buildings and resources come later. For now your Kingdom is your plot.</p>
    <h3>Release</h3>
    <p class="small muted">Releasing gives up your plot and everything on it. Nothing is refunded.</p>
    ${release}
  </div>`;
}

// The parts of the claim confirmation (tier 2, focus on Cancel; question 7).
export function claimQuestion(x, y, cfg, fmt) {
  return {
    title: `Claim plot ${x}, ${y}?`,
    points: [
      `It costs ${fmt(cfg.cost)} gold, from the gold you carry.`,
      'Your Kingdom can’t be moved later. You can release it, but you lose it.',
    ],
    confirm: `Claim for ${fmt(cfg.cost)} gold`, cancel: 'Not now',
  };
}
