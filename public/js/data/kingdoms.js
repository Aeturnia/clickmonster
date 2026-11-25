// Kingdoms K-1 (#83; docs/kingdoms-scope.md 5.1 to 5.5; docs/kingdoms-k1-plan.md 2.2).
// The shipped switch, the parameters, the Kingdom Zone's place, and the configuration every part
// of the game asks before anything of Kingdoms is reachable. Shared by the browser and the edge
// functions, like the rest of public/js/data.
//
// Kingdoms are OPEN only when the switch is on AND both claim values are set (kingdomsOpen()).
// All three ship off or unset, so every part is closed. Opening is a reviewed code change here,
// deployed to the site and to both functions (the plan's section 3). Unset values never mean
// unrestricted entry.
export const KINGDOMS_OPEN = false;
export const CLAIM_MIN_LEVEL = null; // set from #86, or a balancing PR the owner authorizes (scope 7)
export const CLAIM_COST = null; // gold only (scope 7)

export const KINGDOM_ZONE_ID = 'kingdoms';
export const KINGDOM_SIZE = 100; // the owner's direction for the initial Kingdom Zone
export const PLOT_WINDOW = 10; // the plot map's window: a presentation value (decision 9.4)
export const KINGDOM_GATE = Object.freeze({ x: 1, y: 1 }); // where a hero in the Kingdom Zone stands

export const SHIPPED_CONFIG = Object.freeze({ open: KINGDOMS_OPEN, minLevel: CLAIM_MIN_LEVEL, cost: CLAIM_COST });

// The local test configuration (decision 9.1; docs/kingdoms-k1-plan.md 2.2 and 10). Fixed values
// that never ship as live ones. Only the edge functions can select it, and only on the local
// stack: see testConfigFrom().
export const TEST_CONFIG = Object.freeze({ open: true, minLevel: 1, cost: 100 });

// The local stack's gateway, as the functions see it. Production's SUPABASE_URL is the project's
// own address, injected by the platform, whose SUPABASE_ prefix no secret can use.
const LOCAL_GATEWAY_HOST = 'kong';

// The test configuration, or null. Both must hold: KINGDOMS_TEST is exactly "1", and SUPABASE_URL's
// host is exactly the local gateway. Anything missing or malformed is null: closed.
export function testConfigFrom(kingdomsTest, supabaseUrl) {
  if (kingdomsTest !== '1' || typeof supabaseUrl !== 'string') return null;
  let host;
  try { host = new URL(supabaseUrl).hostname; } catch { return null; }
  return host === LOCAL_GATEWAY_HOST ? TEST_CONFIG : null;
}

let current = SHIPPED_CONFIG;

// The configuration in force. The browser always has the shipped one; each edge function sets its
// own once, at start-up, before it registers the zones.
export function kingdomConfig() {
  return current;
}

export function setKingdomConfig(config) {
  current = config || SHIPPED_CONFIG;
}

// The one predicate (K1-B02): the switch on and both values set.
export function kingdomsOpen(config = current) {
  return !!config && config.open === true
    && Number.isInteger(config.minLevel) && config.minLevel >= 1
    && Number.isInteger(config.cost) && config.cost >= 0;
}

// The Kingdom Zone's definition, built for the current Overworld. Defined in code, never in the
// zones table: the zone editor never sees it (5.1.1). Its only path leads back to the Overworld's
// town cell, the Crossroads, where the only way in is (zones.js).
export function kingdomZoneDef(overworldTown) {
  return {
    id: KINGDOM_ZONE_ID,
    name: 'The Kingdom Lands',
    desc: 'Ten thousand plots of open country. Each hero may hold one, as their Kingdom.',
    size: KINGDOM_SIZE,
    starter: false, pvp: false, minLevel: 0, exitLevel: 0,
    overworld: null,
    entry: { x: KINGDOM_GATE.x, y: KINGDOM_GATE.y },
    town: null, shop: null, lairs: [],
    portals: overworldTown
      ? [{ x: KINGDOM_GATE.x, y: KINGDOM_GATE.y, to: 'overworld', tx: overworldTown.x, ty: overworldTown.y, minLevel: 0, label: 'Leave the Kingdom Lands' }]
      : [],
    monsters: [],
    boss: null,
  };
}
