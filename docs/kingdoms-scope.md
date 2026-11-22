# Kingdoms: design scope (#83, #84)

**Status: a draft for independent review.**
- **Design only.** No implementation, migration, deploy or balance numbers are authorized.
- **Authorized:** the owner authorized writing this scope on 2026-11-22, for [#83](https://github.com/Aeturnia/clickmonster/issues/83) (ownership, the Kingdom Zone and the management interface) and [#84](https://github.com/Aeturnia/clickmonster/issues/84) (resources and buildings), together.
- **What's here:** what the code supports today, what the owner has already decided, proposed designs, and the decisions only the owner can make (section 6).
- **How decisions are marked:** each is K-D*n*, with options and a recommendation. **None is decided by this document.**

## 1. Method and limits

- **Read at `main` `2a43a12`** (2026-11-22). File and line references are from that commit.
- **The source of the owner's direction:** [`docs/monstra-regna-world-zones-kingdoms-design-notes.md`](monstra-regna-world-zones-kingdoms-design-notes.md) (the world notes). The integrity requirements come from [`docs/monstra-regna-security-hardening-design-notes.md`](monstra-regna-security-hardening-design-notes.md) (the security notes).
- **Nothing was measured or run** for this scope, and nothing in production was read. Every statement about cost or performance is marked "not measured" (section 11).
- **No numbers are proposed:** no costs, rates, caps, levels or timings. They are named parameters for the progression simulations ([#86](https://github.com/Aeturnia/clickmonster/issues/86); section 7).

## 2. The owner's established direction

From the world notes, 1.2, 1.3 and 6, kept apart from everything proposed below:

- **Kingdoms will be player-owned tiles in a special Kingdom Zone.**
- **The initial Kingdom Zone is a 100 × 100 grid:** 10,000 tiles, before any decision about reserved or unavailable plots.
- **Each player can claim one tile,** and that tile is the player's entire Kingdom.
- **A Kingdom is managed through an interface,** not by placing buildings on a second, internal grid. That internal grid is explicitly not the chosen direction (6).
- **Players get materials from fighting monsters,** and use resources to build and upgrade their Kingdom.
- **The buildings include mines, farms and woodcutters,** and others offering useful benefits.
- **Attacks and sieges between players' Kingdoms** are intended as future functionality. **They are not part of the initial economic foundation** ([#85](https://github.com/Aeturnia/clickmonster/issues/85)).
- **The game is persistent, with no round resets.** Major balance passes wait until Kingdoms exist (1.3).
- **Explicitly not decided** (6):
  - specific resource quantities, building levels, production timings or balance parameters;
  - whether all 10,000 tiles will be claimable;
  - siege rules, protection and territory loss.

## 3. What exists (evidence)

### 3.1 Zones and the map

- **Zones are definitions in the `zones` table** (`supabase/migrations/20261113180000_zones.sql`), compiled by `compileZone()` (`public/js/data/zones.js:236`).
  - **A zone is square:** `size` gives both width and height.
  - **Every cell shares the zone's monster list.** Towns, lairs and portals are "features" at single cells.
- **Zone size is limited to 3 to 40** (`ZONE_SIZE`, `public/js/engine/zone-validate.js:8`). The admin console's zone editor enforces it.
  - A 100 × 100 zone isn't a valid zone today.
- **Portals already link a cell to another zone,** with a level requirement (`usePortal()`, `public/js/engine/world.js:63`; `portals` in the zone format, `zones.js:27`).
  - The Overworld creates a portal into every zone placed on it (`zones.js:244`).
  - This is also partial evidence for [#87](https://github.com/Aeturnia/clickmonster/issues/87) (nested zones). It isn't explored here.
- **Walking within a zone is instant:** `walkTo()` (`world.js:50`) moves the hero to any cell in one step.
- **The map draws one `<button>` per cell, with roving focus** (`viewMap()`, `public/js/main.js:893`). It scrolls inside its own frame when it doesn't fit (`syncMapFrame()`).
  - At 100 × 100 that would be 10,000 buttons in the page, and in the accessibility tree.
  - **Not measured:** the effect on rendering time and on screen readers. The largest zone tested is 40 × 40 (`bigZone()`, `tests/ui/harness.mjs:953`).
- **If an admin deletes or shrinks a zone,** `ensureCharacter()` moves heroes inside it somewhere safe (`public/js/engine/character.js:66`). Nothing similar exists for anything a player *owns* in a zone.

### 3.2 How a hero is stored and saved

- **One hero per account:** `user_id` is unique (`supabase/migrations/20261112140000_characters.sql:6`).
  - **The game state is one `jsonb` value,** `characters.data`.
  - **Signed-in players can read only the public columns:** id, name, race, level, zone, x, y and updated_at.
- **Only the `game` function writes it.** `saveRow()` (`supabase/functions/game/index.ts:60`) uses optimistic locking: it saves only if `version` is unchanged since the read. Otherwise it answers 409, "Your hero was busy — try again."
- **The `game` function has no cross-table transaction.** Its database writes are separate REST calls. For example:
  - **A world-boss hit:** the hunt hit (`hunt_hit`, a Postgres function, `index.ts:173`) is committed before the hero's save, which can still fail with 409.
  - **Reward claims** (`claimRewards()`, `index.ts:108`) and **quest completion** (`index.ts:345`) are made safe by conditional updates: `is('claimed_at', null)`, `is('completed_by_name', null)`.
- **Postgres functions are used for atomic steps already:**
  - `hunt_hit()` locks the hunt row (`for update`) and updates two tables in one transaction (`20261113150000_world_hunts_ledger.sql:80`);
  - `ledger_add()` (`:104`), callable only by the service role.
- **Deleting a hero** removes the row (`index.ts:430`). Rows that reference it cascade: for example `pending_rewards` and `hunt_hits` (`20261113150000_world_hunts_ledger.sql:31`, `:41`).
- **Fast actions** (fighting, moving, hunts) are refused within 150 ms of the last one (`FAST_ACTIONS`, `MIN_ACTION_MS`, `index.ts:360`).

### 3.3 Time-based effects

- **HP regeneration is lazy and runs on server time** (`applyRegen()`, `character.js:234`).
  - On each request, the server adds the whole 3-second ticks elapsed since `char.lastTick`, and advances `lastTick` by exactly those ticks.
  - There's no background job. The client's clock is never used.
- **This is the precedent for production while a player is away.**

### 3.4 Loot and the economy

- **A kill drops gold, and at most one bonus drop: a gem or a relic** (`battle.js:58`). Gems are counters in `char.gems` (`battle.js:161`), not inventory items.
- **The pack holds 40 items** (`MAX_INVENTORY`, `public/js/engine/inventory.js:7`). Counters like `gems` don't use pack space.
- **Live multipliers** for XP, gold, drops, elites and mastery are set by admins and timed events (`public/js/engine/world-config.js`).
- **The economy ledger records gold only,** by source (`ledger()`, `index.ts:96`; `LEDGER_SOURCE`).
- **Battle rules are in the shared engine** (`public/js/engine`), which runs in the browser and in the `game` function. A change to them is a game-rule change. [`CLAUDE.md`](../CLAUDE.md) keeps game rules unchanged unless the task is explicitly about them.
  - **The precedent for deploying one:** GP-1's town rule, F2 ([`docs/gameplay-polish-scope.md`](gameplay-polish-scope.md), section 7).

### 3.5 The interface

- **Four tabs:** Explore (or Battle), Hero, Gear, Map (`main.js:386`).
  - In phone landscape, the tabs already fall below the screen's edge ([#95](https://github.com/Aeturnia/clickmonster/issues/95)).
- **Per-account UI state** comes from `freshUi()` (`main.js:54`), and every start and stop advances `gameGen` (`main.js:85`). New async game code must check `live(g)` ([`CLAUDE.md`](../CLAUDE.md), account isolation).
- **Destructive actions use `confirm.js`,** with four tiers. A priced action whose price is on the button needs no dialog (tier 4).

## 4. Constraints

- **The server is authoritative** (security notes, section 3, invariant 1). The browser never grants itself a claim, a resource, a building or a level. Every Kingdom change is a `game` function action, checked against the shared engine's rules.
- **One owner per plot, and one plot per hero.** Both are enforced by the database, not only by the engine. Two heroes' `characters.data` can't see each other, so this needs a table with unique constraints.
- **Atomic changes, safe to retry** (invariants 4 and 5):
  - spending, building and claiming either happen completely or not at all;
  - a retried request never claims, spends or upgrades twice.
- **Server time only** for production and any timers. No client timestamp is trusted.
- **Account isolation:** a hero's Kingdom view, drafts and pending requests don't carry over to the next account in the same page.
- **Accessibility:** the Phase 1 to 4 work stays intact. That means native dialogs, kept focus, roving focus on maps, polite announcements, and axe with 0 violations. No emojis or icons in the game UI.
- **Existing play is unchanged** unless a decision here says otherwise: zones, monsters, gems, relics, the multipliers, PvP and quests.
- **No numbers here.** Section 7 lists them as parameters.

## 5. Proposed design

### 5.1 What the Kingdom Zone is (K-D1)

| Option | What it means | For | Against |
|---|---|---|---|
| **A. An ordinary walkable zone** with an exemption from the 40-cell limit | A `zones` row of size 100, entered by a portal, with heroes standing on cells | Reuses movement, portals, "who's here" and the zone editor | The editor, validation and map assume small hunting zones. The zone's definition would be mixed with ownership. An admin resize or delete could orphan plots (3.1) |
| **B. A plot map, not a walkable zone** | The Kingdom Zone is a separate screen listing plots. The hero never stands in it | Simplest. No conflict with the zone code | No sense of place. Geography (adjacency, travel) would need building from scratch later |
| **C. A place reached by a portal, drawn as a plot map** *(recommended)* | A `kingdoms` zone entry with a fixed id, reached by a portal. It is drawn by its own plot-map view, not `viewMap()`, and no monsters roam there. The plots live in their own table (5.3), not in the zone's definition | Keeps the world consistent, and keeps a location for later geography or sieges. The zone editor never sees 10,000 plots | One special case in the zone code: its id is reserved, the editor can't delete or resize it, and the size check is exempted for it |

**Recommendation: C.**
- Its size, 100, is a fixed constant of the Kingdom code, not an editable zone field.
- **Entry:** a portal from the Overworld's Crossroads, or from every town. That is part of K-D1, and the level requirement is K-D2.

### 5.2 The plot map

- **Not 10,000 buttons.** The map shows a **window** of the grid (for example 10 × 10; the size is a parameter), with:
  - controls to move the window by a window or a row, and to jump to coordinates;
  - **"My Kingdom"** and **"Find a free plot"**, which jumps to the nearest free plot, or to a random one (K-D3);
  - a list of the plots in view, for screen readers and small phones.
- **Keyboard:** the same roving focus and arrow keys as today's map. Moving past the window's edge moves the window.
- **Each plot's label:** its coordinates, then "Free", "Reserved", or the owner's hero name and Kingdom name (K-D4).
- **Claiming:** select a free plot, then "Claim this plot". The cost is on the button if there is one (K-D2), so it's tier 4: no dialog.
  - **Recommendation: tier 2 instead (a dialog with focus on Cancel),** because a claim is permanent until released (K-D5). The owner decides.

### 5.3 Ownership: where it is stored (K-D6)

**A new table, `kingdom_plots`:**
- `x`, `y`: the primary key, within 1 to 100;
- `character_id`: unique, referencing `characters(id)` on delete cascade (K-D7);
- `kingdom_name` (K-D8) and `claimed_at`;
- `status`: claimed, or reserved for plots held by staff or kept back (K-D9).

**Who can read and write it:**
- signed-in players can read the plot columns, as with `characters`;
- only the service role writes;
- RLS and column grants are tested in pgTAP.

**Where the Kingdom's own state lives** (resources, buildings, the production clock):

| Option | For | Against |
|---|---|---|
| **S1. In `characters.data.kingdom`** *(recommended for the foundation)* | One row: spending materials and upgrading a building is one versioned save, like every action today. No new transaction problem for #84 | Another player's action can't change it without writing the owner's row. That matters for #85 |
| **S2. A separate `kingdoms` table** | Ready for other players' actions (#85) | Every build spends from `characters.data` and writes `kingdoms`. That's two rows per action, so each needs a Postgres function |

**Recommendation: S1.**
- **Only the claim** crosses two rows: the plot and the hero, with any claim cost. It goes through **one Postgres function**, `kingdom_claim()`, in one transaction. The function:
  - inserts the plot;
  - updates the hero only where `version` matches;
  - fails as a whole if either fails.
- The function follows `hunt_hit()`'s pattern, but writes the hero too. The other order (insert the plot, then save the hero) could leave a claimed plot with an unpaid cost after a 409.
- **For #85 (out of scope),** S1 doesn't preclude sieges. They would act through Postgres functions on both heroes' rows with version checks, or the state could move into a table at that point. **That choice belongs to #85's scope.**

### 5.4 Claim rules (K-D2, K-D5, K-D7, K-D9, K-D10)

- **Eligibility and cost** (K-D2): a level requirement, a gold or material cost, both, or neither.
- **Concurrency:**
  - two heroes claiming the same plot at once: the primary key lets exactly one win, and the other is told the plot was just taken;
  - one hero claiming from two tabs: the unique `character_id` lets one succeed.
  - **Both are proved with tests on the local stack,** not by reasoning.
- **Release and relocation** (K-D5): permanent, releasable, or movable, and at what cost.
  - **Recommendation for the foundation:** release is allowed and loses the Kingdom's buildings (tier 1, type the name to confirm). There's no relocation.
- **Deleting the hero** (K-D7): the plot row cascades, so the plot becomes free.
  - The delete confirmation's text names the Kingdom it destroys. **That changes existing copy.**
- **Reserved plots and the full map** (K-D9): staff plots, plots kept back for later, and what happens when every plot is taken.
  - **Recommendation:** decide before a large share is claimed. The scope doesn't need the answer for the foundation, but the `status` column allows for it.
- **Inactive owners** (K-D10):
  - **Recommendation for the foundation:** no automatic reclaiming. Record the owner's last activity; `characters.updated_at` already exists. Decide a policy before the map nears full, with players told the rule before it applies (security notes, section 8).
- **Sanctions:** a banned or jailed hero keeps their plot. Only an admin can revoke it, with an audit entry (5.10).

### 5.5 The management interface (K-D11)

**Where it opens:**

| Option | For | Against |
|---|---|---|
| **A fifth tab, "Kingdom"** | Always one tap away | Adds to the tab row's phone-landscape problem (#95), and to the narrowest screens |
| **A section of the Hero tab** *(recommended)*, with a "Manage my Kingdom" entry that opens its own view | No new tab. Fits "managed through an interface" | Two taps |
| **Only while in the Kingdom Zone** | A sense of place | Travel before every upgrade |

**Where it can be managed from** (K-D12): anywhere outside a fight (recommended), or only in a town or in the Kingdom Zone.

**Contents:**
- the Kingdom's name and plot;
- the resource stock, with each storage cap;
- the buildings, each with its level, output and the next upgrade's cost;
- Build and Upgrade buttons, with the price on the button;
- a short history of recent changes, if wanted.

It follows the existing patterns:
- the pending state is tracked by key (`kingdom:<building>:<op>`);
- focus is kept across re-renders;
- announcements are polite;
- each request records `gameGen` and drops its result unless `live(g)`.

**Desktop:** the same view in the main column. The side column is unchanged.

### 5.6 Resources (#84; K-D13, K-D14)

- **Two sources** (owner's direction):
  - **materials, from fighting monsters;**
  - **produced resources, from buildings:** the mine, the farm and the woodcutter.
- **The categories** (K-D13): the names below are placeholders.
  - **Produced:** ore (mine), food (farm), wood (woodcutter).
  - **Materials from monsters:** one generic kind, or several, for example by element (the game has five elements and 10 gem kinds) or by level band.
  - **Recommendation:** few categories in the foundation. Add more only where a building or recipe needs them.
- **Gold:** whether buildings also cost gold (K-D14). Gold is the one currency the ledger already tracks, and a gold sink.
- **Storage:** counters in `characters.data.kingdom`, like `gems`, not pack items. That keeps the 40-item pack unchanged.
  - Each resource has a storage cap. The cap is a parameter, and possibly a building (5.8).
- **Trading** between players (K-D15):
  - **Recommendation:** out of the foundation.
  - Any trade is a cross-hero transfer, with invariants 4 and 5 and a risk of collusion (security notes, section 10).

### 5.7 Materials from monsters: a game-rule change (K-D16)

Today a kill drops gold and at most one bonus drop, a gem or a relic (3.4). Materials change the shared engine's loot rule, which [`CLAUDE.md`](../CLAUDE.md) treats as a game-rule change. That makes it explicit here.

- **Options:**
  - **(a) A separate material roll** *(recommended)*: the gem and relic chances are unchanged.
  - **(b) A third kind of bonus drop:** existing gem and relic rates fall.
- **Which monsters drop materials** (K-D16):
  - all of them;
  - by level band;
  - by zone or element;
  - only heroes who own a Kingdom.
  - **Recommendation:** all monsters, but only for heroes who own a plot. A hero without a Kingdom is otherwise unaffected.
- **The `drop` multiplier, elites, variants and world-boss hunts:**
  - whether they apply, and whether there's a new `materials` multiplier key (K-D16);
  - **recommendation:** a separate `materials` key, so admins can tune it without touching gems.
- **The deploy order:** as for F2 (3.4).
  - The `game` function first, so the server's rule leads.
  - The client after, so it shows materials the server now awards.
  - Between the two, the client simply doesn't show material lines.
  - The order is confirmed in the implementation phase.
- **The ledger:** materials and produced resources need their own accounting if #86 and staff are to see inflows and outflows.
  - **Recommendation:** a `resource_ledger` (source, resource, amount), filled the way `ledger()` fills the gold one.

### 5.8 Buildings (#84; K-D17 to K-D19)

- **The kinds in the foundation** (K-D17):
  - **recommended:** the mine, the farm and the woodcutter, plus a storehouse that raises the storage caps;
  - **"Others offering useful benefits":** bonuses to the hero, for example to XP or gold. These cross from the Kingdom into character progression, which the world notes' section 4 flags for simulation. **Recommendation:** defer them until #86.
- **Slots** (K-D18): one of each kind, which is simplest and fits "one tile, one interface"; or a number of slots to fill with any kinds.
- **Levels:** each building has a level. Its upgrade cost and its output are functions of that level, with their curves as parameters (section 7).
  - **Whether the levels have a maximum** is a parameter, not decided here.
- **Instant or timed construction** (K-D19):
  - **Instant** *(recommended for the foundation)*: one action, one save, nothing to schedule.
  - **Timed:** an upgrade completes at a server time, evaluated lazily like production (5.9).
  - **Recommendation:** decide timed construction with #86's results, if they show it's needed to pace progression.
- **An upgrade request carries the level it upgrades from.** The server refuses it if the building has already changed. A retried request, or one from a second tab, then upgrades once. The same applies to building.

### 5.9 Production (#84; K-D20)

- **Lazy, on server time,** like `applyRegen()` (3.3):
  - each Kingdom keeps `kingdom.lastTick`;
  - on each request, the server adds each building's output for the elapsed time, up to the storage caps;
  - it advances `lastTick` by the time accounted for;
  - no background job, and no client clock.
  - **This closes off production-clock manipulation** (security notes, section 10).
- **Offline production** (K-D20): whether it continues while the player is signed out.
  - **Recommendation:** yes, up to the storage caps. The caps are what limit it.
  - This is game-provided idle production, which the security notes, section 6, separate from outside automation.
- **Collecting:** output accrues to the stock automatically (recommended); or a Collect action is needed.
  - **Recommendation:** automatic. A Collect chore adds requests and rewards frequent check-ins, which works against the idle balance the owner hasn't decided yet (#78).
- **Precision:** whole units only, with any remainder carried in `lastTick`, as regeneration does. No floating-point stock.

### 5.10 Integrity, abuse and staff tools

- **Every Kingdom action is a `game` action:** `kingdomClaim`, `kingdomRelease`, `kingdomBuild` and `kingdomUpgrade` (names indicative).
  - Each is validated by the shared engine and saved once, with the version check. The claim goes through its Postgres function (5.3).
- **A retry is safe:**
  - the claim's unique constraints;
  - the "from level" check on building and upgrading (5.8);
  - a 409 for a stale save, as today.
- **Rate limits:** whether Kingdom actions join `FAST_ACTIONS`. **Recommendation:** yes, with the same 150 ms floor. Numeric limits are #78's.
- **The admin console:**
  - a Kingdoms section: find a plot or owner, see a Kingdom;
  - **revoke a claim:** tier 1, type the name to confirm;
  - **correct a Kingdom's stock or buildings:** as the hero editor corrects a hero;
  - **reserve plots** (K-D9);
  - each change writes one audit entry. Audit entries are best effort today ([#80](https://github.com/Aeturnia/clickmonster/issues/80)), and these would be too unless #80 changes that.
- **Kingdom names** (K-D8): if players can name their Kingdom, the name follows the hero-name rules (`NAME_RE`) and is moderated by staff. **Recommendation:** use the hero's name ("Alda's Kingdom") in the foundation, which needs no moderation.

## 6. Decisions for the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| K-D1 | What the Kingdom Zone is | A walkable zone; B plot map; C portal-reached place drawn as a plot map (5.1) | C; entry from the Crossroads |
| K-D2 | Who can claim, and the cost | Level requirement; gold or material cost; both; neither | A level requirement and a cost, values from #86 |
| K-D3 | Finding a free plot | Nearest to a chosen point; random; both | Both |
| K-D4 | What the map shows of others' plots | Owner hero name; Kingdom name; level; nothing but "claimed" | Hero name and "claimed" |
| K-D5 | Release and relocation | Permanent; releasable; movable, with a cost | Releasable, losing the buildings; no relocation |
| K-D6 | Where Kingdom state lives | S1 in `characters.data`; S2 a table (5.3) | S1, with the plot in `kingdom_plots` |
| K-D7 | Deleting a hero | Frees the plot; plot kept reserved for a time | Frees it; the confirmation names the Kingdom |
| K-D8 | Kingdom names | The hero's name; a player-chosen name, moderated | The hero's name |
| K-D9 | Reserved plots, and a full map | Staff and reserved plots; what happens at full | Allow reserved plots now; decide a full-map policy before half are claimed |
| K-D10 | Inactive owners | None; reclaim after a period, announced first | None in the foundation; record activity |
| K-D11 | Where the interface opens | Fifth tab; Hero section; only in the Kingdom Zone | Hero section |
| K-D12 | Where it can be managed from | Anywhere outside a fight; towns; the Kingdom Zone | Anywhere outside a fight |
| K-D13 | Resource categories | Ore, food, wood; one or several monster materials | Few: the three produced, one or two monster materials |
| K-D14 | Gold in building costs | Yes; no | Yes, as a gold sink |
| K-D15 | Trading | In; out | Out of the foundation |
| K-D16 | Materials from monsters | Separate roll or shared bonus slot; which monsters; multipliers | A separate roll, all monsters, plot owners only, a new `materials` multiplier |
| K-D17 | Building kinds | Mine, farm, woodcutter; storehouse; hero-benefit buildings | The first four; hero benefits after #86 |
| K-D18 | Slots | One of each kind; N free slots | One of each kind |
| K-D19 | Construction time | Instant; timed | Instant in the foundation; revisit with #86 |
| K-D20 | Offline production | Continues to a cap; stops when signed out | Continues to the storage caps, accruing automatically |

## 7. Parameters for #86 (all undecided)

| Parameter | Unit | Controls |
|---|---|---|
| `KINGDOM_SIZE` | cells per side | The zone's size. The owner's direction is 100 for the initial zone |
| `PLOT_WINDOW` | cells per side | The plot map's window (5.2) |
| `CLAIM_MIN_LEVEL` | hero level | Who can claim (K-D2) |
| `CLAIM_COST` | gold and/or materials | The claim's price (K-D2) |
| `MATERIAL_CHANCE` | probability per kill | The material roll (K-D16) |
| `MATERIAL_AMOUNT(level)` | units | Materials per drop, by monster level |
| `BUILD_COST(kind, level)` | resources and gold | The cost to build and to upgrade |
| `OUTPUT(kind, level)` | units per hour | Production |
| `STORAGE_CAP(resource, storehouse level)` | units | The offline limit, and the stock limit |
| `MAX_BUILDING_LEVEL` | level, or none | Whether levels end |
| `BUILD_TIME(kind, level)` | seconds | Only if construction is timed (K-D19) |
| `materials` multiplier | factor | The admin and event multiplier (K-D16) |

## 8. Phasing (proposed; each phase needs its own authorization)

1. **K-0: this scope.**
   - Independent review, then the owner's decisions in section 6, then acceptance.
2. **K-1: ownership and the interface (#83).**
   - **Included:**
     - the `kingdom_plots` table and `kingdom_claim()`;
     - the Kingdom Zone's entry;
     - the plot map;
     - claim and release;
     - an empty management view;
     - the admin section's search, revoke and reserve.
   - **No resources yet.**
3. **K-2: resources, buildings and production (#84).**
   - the material drops (the game-rule change, with its deploy order);
   - the buildings and upgrades;
   - lazy production;
   - the resource ledger.
   - **The values are placeholders behind the named parameters,** marked as such, until K-3.
4. **K-3: the numbers,** from #86's simulations, in their own reviewed PR.

**What each implementation phase brings** (so the review can see the cost):
- **A new migration,** under the procedure in [`docs/landing-l3-report.md`](landing-l3-report.md), section 4. Production's migration history is incomplete on purpose. There's a precheck, a verify script and a rollback.
- **pgTAP tests:** RLS, the column grants, the unique constraints, and `kingdom_claim()`'s all-or-nothing behaviour, including two claims at once.
- **The engine rules** in `public/js/engine`, with Node tests, and the fake backend (`tests/ui/harness.mjs`) kept in step with the new actions.
- **Browser tests:** the plot map by keyboard and touch, claiming, a version conflict, account isolation, phones at 320 px, phone landscape (with #95 in mind), desktop, and axe with 0 violations.
- **Deploys:** the `game` function (and the `admin` function for the console), in an order the owner authorizes.
- **The first-paint budget is unaffected:** Kingdom code loads with the game, not the entrance.

## 9. Acceptance criteria (proposed, for K-1 and K-2)

**K-1:**
- Two heroes claiming the same plot at once: exactly one gets it. Tested on the local stack.
- One hero claiming from two tabs at once: one plot.
- A claim whose cost can't be paid, or whose hero save would conflict, leaves no plot claimed.
- The plot map never renders more than the window. It works fully by keyboard, and gives screen readers the coordinates and status of each plot.
- Deleting a hero frees their plot, and the confirmation says so.
- An admin revocation frees the plot and writes one audit entry.

**K-2:**
- Production depends only on server time. Changing the device's clock changes nothing.
- Production stops at the storage cap, and resumes from there.
- A retried, or doubled, upgrade upgrades once and charges once.
- Heroes without a plot see no change in their loot. Gem and relic rates are unchanged if K-D16 (a) is chosen.
- Every resource change is in the resource ledger.

## 10. Out of scope

- **Warfare and sieges** (#85): K-D6's storage choice doesn't preclude them (5.3).
- **Trading** (K-D15), alliances, and geography effects: adjacency, distance, travel time.
- **Hero-benefit buildings** (K-D17).
- **All balance numbers** (#86), and any change to the existing zones, monsters or rewards beyond material drops.
- **Nested or procedural zones** (#87).
- **Policies:** automation, engagement checks and rate limits (#78, #79).

## 11. Not verified

- **Rendering** a 100 × 100 grid as buttons, in time or with screen readers. The design avoids it, so it isn't claimed either way.
- **Load and storage:**
  - the database load and storage of 10,000 plot rows;
  - the extra jsonb size per hero;
  - production arithmetic on every request.
  - All are expected to be small. None was measured.
- **Supabase plan limits** for Postgres functions or row counts.
- **The deploy order for material drops** (5.7): proposed, to be confirmed in K-2.

## 12. Questions for the scope review

1. Is a Postgres function for the claim the right boundary, or should every Kingdom action go through one from the start (K-D6, S2)?
2. Is the windowed plot map an acceptable accessibility pattern, against a list-and-search interface only?
3. Should the material roll apply to world-boss hunts, which pay out through `pending_rewards`?
4. Does putting the interface in the Hero tab (K-D11) conflict with any Phase 2 layout rule for the side column on desktop?
