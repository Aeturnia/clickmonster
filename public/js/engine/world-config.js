// Live world settings, set by admins: base multipliers plus timed events.
// The server loads them from the database each request; the client loads them for display.
export const MULT_KEYS = ['xp', 'gold', 'drop', 'elite', 'mastery'];
export const MULT_LABEL = { xp: 'Experience', gold: 'Gold', drop: 'Gem and relic drops', elite: 'Elite monsters', mastery: 'Mastery gain' };
export const MULT_MAX = 10;

const state = { base: {}, events: [], effective: {} };

const clampMult = (v) => Math.max(0, Math.min(MULT_MAX, Number(v) || 1));

export function setWorld(cfg, now = Date.now()) {
  state.base = {};
  for (const k of MULT_KEYS) state.base[k] = clampMult(cfg?.base?.[k] ?? 1);
  state.events = (cfg?.events || []).filter((e) => e && e.until && new Date(e.until).getTime() > now);
  state.effective = {};
  for (const k of MULT_KEYS) {
    let m = state.base[k];
    for (const e of state.events) m *= clampMult(e[k] ?? 1);
    state.effective[k] = m;
  }
}

export function mult(key) {
  return state.effective[key] ?? 1;
}

export function activeEvents() {
  return state.events;
}

setWorld(null);
