# Monstra Regna — World, Zone Expansion, and Kingdoms

**Status:** Design discussion record; not an implementation specification  
**Recorded:** 2026-11-18  
**Scope:** Grid-based world structure, long-term progression, future procedural zones, and player Kingdoms

> **Decision convention:** **Established direction** records statements explicitly made by the project owner. **Exploratory** records possibilities raised during discussion and does not authorize implementation.

## 1. Established direction

### 1.1 World and zones

- The game world is made up of **Zones**, each of which is its own **grid map**. Zone grids can vary in square size.
- **A tile within a Zone can lead to another Zone**, allowing Zones to nest within Zones. Each destination is another grid map, not merely an encounter or a screen.
- Nested Zones do not need to follow a uniform level progression. For example:
  - A level **200 Holy** Zone may contain a tile connecting to a level **600 Holy** Zone.
  - Elsewhere in the world, a distinct **Fire** Zone may require **level 500**.
- These levels and elements are examples of the intended structural flexibility, **not finalized content or balance figures**.
- The game currently has handcrafted Zones covering content up to approximately **level 75**; their balance has not yet received a full pass.

### 1.2 Kingdoms

- **Kingdoms will be player-owned tiles in a special Kingdom Zone.**
- The initial Kingdom Zone is planned as a **100 × 100 grid**, or **10,000 total tiles** before any decision about reserved or unavailable plots.
- **Each player can claim one tile.** That tile represents the player's **entire Kingdom**.
- A Kingdom is **managed through an interface**, rather than by placing individual buildings on a second internal grid.
- Players will acquire **materials from fighting monsters** and use resources to **build and upgrade** their Kingdom.
- Anticipated building/production types include **mines, farms, woodcutters**, and other buildings offering useful benefits.
- **Player-versus-player Kingdom attacks and sieges** are intended as future functionality, not part of the initial economic foundation by default.

### 1.3 Progression and balancing

- Monstra Regna is planned as a **persistent game without periodic round resets**.
- The project owner has **deferred major numerical balance passes until Kingdoms are introduced**, because Kingdom systems may change resource generation and progression rates.
- Shimlar provides inspiration for very high long-term levels; however, **Monstra Regna is not committed to reproducing Shimlar's level scale or round cadence**.
- The owner wants to investigate long-horizon progression numerically, including how long dedicated players would take to reach extremely high levels.

## 2. Exploratory design: scaling the world

### 2.1 Procedural Zone generation

The owner raised the possibility of automatically creating Zones as players outgrow existing content, as an alternative to indefinitely hand-authoring every level band. **No procedural generator has been approved or specified.**

A potential **hybrid strategy** would combine deliberate handcrafted regions and significant encounters with procedurally generated branches or Zones. Nesting provides an especially useful option: expansion can occur **inside existing Zones**, without requiring limitless expansion of the top-level world map.

Possible generation inputs, pending design and balancing:

- World/region or parent-Zone identity and elemental/theme constraints.
- Level or difficulty band, not necessarily tied to nesting depth.
- Monster families and validated stat/reward archetypes.
- Grid dimensions, entrances and traversal constraints.
- Stable seeds and generation versions for reproducibility.

A proposed principle worth evaluating is that generated Zones could become **persistent, shared locations**, rather than per-player random maps. This is **not yet a binding decision**.

### 2.2 Possible world-graph model

An implementation-friendly model might distinguish:

- **Zone** — map identity, dimensions, theme, monster/content rules.
- **Tile** — position inside a Zone.
- **Connection** — link from a tile to a destination Zone and arrival position, potentially with prerequisites.

This could support branching, multiple entrances, shortcuts, and nested maps without imposing a strict tree. It remains an **architectural proposal for later review**. Generation and navigation tests would need to check reachability, intentional access gates, return routes where applicable, and safe handling of cycles.

### 2.3 Future progression simulations

After Kingdom systems are defined sufficiently, run simulations based on **actual game rules**, not arbitrary assumed experience-per-hour curves. Useful scenarios include casual, regular, dedicated, and extreme activity profiles; varied strategies such as optimizing XP, gold, or Kingdom development; and horizons ranging from months to multiple years or longer.

Suggested measurements:

- Time to levels and distribution of progress across player profiles.
- XP requirements versus achievable encounter rewards and combat throughput.
- Resource inflows, outflows, storage, and upgrade costs.
- Effects of Kingdom bonuses on character progression.
- Numerical limits, runaway compounding, and situations where optimal play becomes degenerate.
- Economic and PvP disparities between long-established and newer players.

**No level cap, XP curve, zone-generation trigger, or player growth targets have been decided.**

## 3. Exploratory design: Kingdoms

### 3.1 Initial functional shape

The planned structure is:

1. A shared special Kingdom Zone displays claimable player plots.
2. A player claims one tile, which represents their entire Kingdom.
3. Selecting/entering that Kingdom opens a **Kingdom management interface**.
4. Combat can yield materials used for development.
5. Buildings such as mines, farms, and woodcutters can be constructed and upgraded to provide useful outputs.
6. Future systems can introduce attacks and sieges involving player Kingdoms.

The precise UI, build slots, building caps, production rates, resource categories, costs, and military systems remain **unsettled**.

### 3.2 Questions for later Kingdom design

- **Offline production:** Does production continue while signed out? Is it capped by storage or collection requirements?
- **Resources:** Which resources come from combat versus production, and which are consumed or traded?
- **Territory:** Are all 10,000 tiles claimable? What happens when the map fills? Can players relocate?
- **Ownership/inactivity:** What happens to inactive owners and abandoned Kingdoms?
- **Geography:** Do adjacency and distance affect interaction, alliances, attack eligibility, or travel time?
- **Sieges:** How are attack timing, offline defense, loss, rebuilding, and fairness across levels handled?
- **Persistence:** Can Kingdom progress or territory be lost, and by what explicit rules?
- **Scale:** How will thousands of Kingdoms affect storage, simulation load, and the economy?

Potential safeguards such as separation between Kingdom military strength and character level, and avoiding irreversible losses during offline periods, are **discussion suggestions only**, not approved policy.

## 4. Relationship between systems

The emerging concept has three interacting layers:

| Layer | Primary role | Connection to other layers |
|---|---|---|
| Character progression | Combat, levels, equipment, loot | Acquires materials; may receive benefits from Kingdoms |
| World / Zone exploration | Variable-size grid maps and nested connections | Provides monsters, elemental regions, and future expansion space |
| Kingdom progression | One player-owned tile managed through an interface | Consumes loot/materials, produces resources/benefits, eventually supports warfare |

The exact feedback loops and numerical balance must be validated before finalizing progression rates.

## 5. Proposed sequencing — not yet authorized

1. Preserve handcrafted Zones and existing gameplay while defining the first Kingdom economy.
2. Establish Kingdom ownership, one-tile-per-player behavior, management interface, and initial resource/building rules.
3. Build a deterministic simulation using the actual Kingdom and combat formulas.
4. Use simulation results to set progression and economy targets.
5. Explore an offline prototype of deterministic procedural Zone generation and navigation validation.
6. Review long-term Kingdom warfare separately before implementation.

## 6. Explicit non-decisions

The discussion **does not establish** any of the following:

- An unlimited level system or maximum level.
- Automatic zone creation at a particular player threshold.
- Procedural content as a replacement for handcrafted content.
- An internal construction grid for Kingdoms (**the chosen direction is a single claimed tile plus management interface**).
- Any specific resource quantities, building levels, production timings, or balance parameters.
- Detailed PvP siege rules, player protection, territory loss, or warfare scheduling.
- Whether all 10,000 tiles will be available for claims.

---

**Record intent:** Preserve the owner's established directions and the adjacent design hypotheses for future scoping. No code changes or implementation approvals are implied.
