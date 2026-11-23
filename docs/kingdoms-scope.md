# Kingdoms: design scope (#83, #84)

**Status: a draft for independent review.**
- **Design only.** No implementation, migration, deploy or balance numbers are authorized.
- **Authorized:** the owner authorized writing this scope on 2026-11-22, for [#83](https://github.com/Aeturnia/clickmonster/issues/83) (ownership, the Kingdom Zone and the management interface) and [#84](https://github.com/Aeturnia/clickmonster/issues/84) (resources and buildings), together.
- **What's here:** what the code supports today, what the owner has already decided, proposed designs, and the decisions only the owner can make (section 6).
- **How decisions are marked:** each is K-D*n*, with options and a recommendation.
- **The owner decided all 20 on 2026-11-23** (section 6). The design below is written to those decisions. Two differ from the original recommendations:
  - **K-D12:** management only in the Kingdom Zone;
  - **K-D19:** timed construction from the start.
- **The document is still a draft for independent review.** The decisions don't authorize any implementation.

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

### 5.1 What the Kingdom Zone is (K-D1: decided, C)

| Option | What it means | For | Against |
|---|---|---|---|
| **A. An ordinary walkable zone** with an exemption from the 40-cell limit | A `zones` row of size 100, entered by a portal, with heroes standing on cells | Reuses movement, portals, "who's here" and the zone editor | The editor, validation and map assume small hunting zones. The zone's definition would be mixed with ownership. An admin resize or delete could orphan plots (3.1) |
| **B. A plot map, not a walkable zone** | The Kingdom Zone is a separate screen listing plots. The hero never stands in it | Simplest. No conflict with the zone code | No sense of place. Geography (adjacency, travel) would need building from scratch later |
| **C. A place reached by a portal, drawn as a plot map** *(decided)* | A `kingdoms` zone entry with a fixed id, reached by a portal. It is drawn by its own plot-map view, not `viewMap()`, and no monsters roam there. The plots live in their own table (5.3), not in the zone's definition | Keeps the world consistent, and keeps a location for later geography or sieges. The zone editor never sees 10,000 plots | One special case in the zone code: its id is reserved, the editor can't delete or resize it, and the size check is exempted for it |

**Decided: C** (the owner, 2026-11-23).
- Its size, 100, is a fixed constant of the Kingdom code, not an editable zone field.
- **Entry:** a portal from the Overworld's Crossroads, as proposed. Portals from every town would be an alternative, raised in the review (section 12).
- **The level requirement for entry** is the same as for claiming (K-D2) unless the review says otherwise.

### 5.2 The plot map

- **Not 10,000 buttons.** The map shows a **window** of the grid (for example 10 × 10; the size is a parameter), with:
  - controls to move the window by a window or a row, and to jump to coordinates;
  - **"My Kingdom"**, and two finders (K-D3, decided: both):
    - **"Nearest free plot":** the free plot nearest the window, or a chosen point;
    - **"Random free plot".**
  - a list of the plots in view, for screen readers and small phones.
- **Keyboard:** the same roving focus and arrow keys as today's map. Moving past the window's edge moves the window.
- **Each plot's label:** its coordinates, then "Free", "Reserved", or "Claimed by" and the owner's hero name (K-D4, decided). The Kingdom's name is the hero's name (K-D8).
- **Claiming:** select a free plot, then "Claim this plot". It needs the minimum level and costs the claim price (K-D2, decided), and the price is on the button.
  - **A priced button would normally be tier 4,** with no dialog.
  - **Proposed: tier 2 instead (a dialog with focus on Cancel),** because a claim lasts until it's released (K-D5). This isn't one of the 20 decisions: for the review (section 12).

### 5.3 Ownership: where it is stored (K-D6: decided, S1)

**A new table, `kingdom_plots`:**
- `x`, `y`: the primary key, within 1 to 100;
- `character_id`: unique, referencing `characters(id)` on delete cascade (K-D7);
- `claimed_at`;
- `status`: claimed, or reserved for plots held by staff or kept back (K-D9).

There's no name column: the Kingdom takes the hero's name (K-D8, decided).

**Who can read and write it:**
- signed-in players can read the plot columns, as with `characters`;
- only the service role writes;
- RLS and column grants are tested in pgTAP.

**Where the Kingdom's own state lives** (resources, buildings, the production clock):

| Option | For | Against |
|---|---|---|
| **S1. In `characters.data.kingdom`** *(decided)* | One row: spending materials and upgrading a building is one versioned save, like every action today. No new transaction problem for #84 | Another player's action can't change it without writing the owner's row. That matters for #85 |
| **S2. A separate `kingdoms` table** | Ready for other players' actions (#85) | Every build spends from `characters.data` and writes `kingdoms`. That's two rows per action, so each needs a Postgres function |

**Decided: S1** (the owner, 2026-11-23).
- **Only the claim** crosses two rows: the plot and the hero, with any claim cost. It goes through **one Postgres function**, `kingdom_claim()`, in one transaction. The function:
  - inserts the plot;
  - updates the hero only where `version` matches;
  - fails as a whole if either fails.
- The function follows `hunt_hit()`'s pattern, but writes the hero too. The other order (insert the plot, then save the hero) could leave a claimed plot with an unpaid cost after a 409.
- **For #85 (out of scope),** S1 doesn't preclude sieges. They would act through Postgres functions on both heroes' rows with version checks, or the state could move into a table at that point. **That choice belongs to #85's scope.**

### 5.4 Claim rules (K-D2, K-D5, K-D7, K-D9, K-D10: decided)

- **Eligibility and cost** (K-D2, decided): a minimum hero level **and** a claim cost. Both values come from #86.
- **Concurrency:**
  - two heroes claiming the same plot at once: the primary key lets exactly one win, and the other is told the plot was just taken;
  - one hero claiming from two tabs: the unique `character_id` lets one succeed.
  - **Both are proved with tests on the local stack,** not by reasoning.
- **Release** (K-D5, decided):
  - a player can release their plot, losing its buildings and its stock, after typing the name to confirm (tier 1);
  - **there's no relocation;**
  - a player who releases can claim a new plot, meeting the level and paying the claim cost again.
- **Deleting the hero** (K-D7, decided): the plot row cascades, so the plot becomes free at once.
  - The existing delete confirmation already asks for the hero's name to be typed (`main.js:1543`). Its text gains a line naming the Kingdom it destroys. **That changes existing copy.**
- **Reserved plots and the full map** (K-D9, decided):
  - admins can mark plots reserved from the start, using the `status` column;
  - **the full-map policy** is decided before half the plots are claimed.
- **Inactive owners** (K-D10, decided):
  - no automatic reclaiming in the foundation;
  - each owner's last activity is recorded, so a policy can be set later. `characters.updated_at` already exists. The implementation phase checks whether it is enough, or whether a separate Kingdom activity time is needed;
  - any later policy is told to players before it applies (security notes, section 8).
- **Sanctions:** a banned or jailed hero keeps their plot. Only an admin can revoke it, with an audit entry (5.10).

### 5.5 The management interface (K-D11, K-D12: decided)

**Where it opens** (K-D11, decided): a **Kingdom section in the Hero tab.** There's no fifth tab, so the phone-landscape tab problem (#95) isn't made worse.

**Where it can be managed from** (K-D12, decided): **only while the hero is in the Kingdom Zone,** anywhere in it, outside a fight.
- **In the Kingdom Zone:** "Manage my Kingdom" opens the management view, where the player can start and cancel constructions (5.8).
- **Anywhere else:** the Hero tab's section is a **read-only summary**, and says "Travel to the Kingdom Lands to manage it". It shows:
  - the plot;
  - the stock;
  - the building levels;
  - any construction under way and when it finishes.
- **The server enforces it,** not only the interface: a management action from outside the Kingdom Zone is refused with a plain message. The engine checks `char.loc.zone`.
- **A hero without a plot** sees a line pointing to the Kingdom Lands, with the claim requirements.

**The management view contains:**
- the Kingdom's name (the hero's, K-D8) and its plot;
- the resource stock, with each storage cap;
- the four buildings (5.8), each with its level, its output, and the next level's cost and construction time;
- the construction under way, if any: what it is, when it finishes, and Cancel (full refund);
- Build and Upgrade buttons with the price on the button. They're unavailable, with the reason given, while a construction is running.

It follows the existing patterns:
- the pending state is tracked by key (`kingdom:<building>:<op>`);
- focus is kept across re-renders;
- announcements are polite;
- each request records `gameGen` and drops its result unless `live(g)`.

**Desktop:** the same view in the main column. The side column is unchanged.

### 5.6 Resources (#84; K-D13, K-D14, K-D15: decided)

- **Two sources** (owner's direction):
  - **a material, from fighting monsters;**
  - **produced resources, from buildings:** the mine, the farm and the woodcutter.
- **The categories** (K-D13, decided). The names are placeholders.
  - **Three produced resources:** ore (mine), food (farm), wood (woodcutter).
  - **One generic monster material.**
  - **The owner's note:** the material **doesn't drop on every kill.** Like gems and relics, it has a chance to drop (5.7).
- **Gold** (K-D14, decided): building and upgrading cost **gold as well as resources.** It's a gold sink, recorded in the gold ledger.
- **Storage:** counters in `characters.data.kingdom`, like `gems`, not pack items. That keeps the 40-item pack unchanged.
  - Each produced resource has a storage cap, raised by the storehouse (5.8).
  - **Whether the monster material has a cap** is a parameter (section 7).
- **Trading** (K-D15, decided): **not in the foundation.** Any trade would be a cross-hero transfer, with invariants 4 and 5 and a risk of collusion (security notes, section 10). It needs its own scope.

### 5.7 Materials from monsters: a game-rule change (K-D16: decided)

Today a kill drops gold and at most one bonus drop, a gem or a relic (3.4). Materials change the shared engine's loot rule, which [`CLAUDE.md`](../CLAUDE.md) treats as a game-rule change. That makes it explicit here.

**Decided (the owner, 2026-11-23):**
- **Its own chance:** the material has **a separate roll,** with a drop chance like gems and relics. It isn't on every kill. The gem and relic chances, and the one-bonus-drop rule between them, are unchanged. One kill can give a gem or relic **and** a material.
- **Plot owners only:** only a hero who has claimed a plot rolls for the material. Every other hero's loot is exactly as today.
- **A new `materials` multiplier** joins `MULT_KEYS` (`world-config.js`), so admins and timed events can tune it without touching gems and relics.

**Still open, for the review or #86:**
- **Elites, variants and world-boss hunts:**
  - whether elites and variants raise the material chance, as they raise gold;
  - whether world-boss hunts, which pay out through `pending_rewards`, give materials. That is question 3 in section 12.
- **Whether the chance or amount varies** by monster level. Both are parameters (section 7).
- **The deploy order:** as for F2 (3.4).
  - The `game` function first, so the server's rule leads.
  - The client after, so it shows materials the server now awards.
  - Between the two, the client simply doesn't show material lines.
  - The order is confirmed in the implementation phase.
- **The ledger:** materials and produced resources need their own accounting if #86 and staff are to see inflows and outflows.
  - **Recommendation:** a `resource_ledger` (source, resource, amount), filled the way `ledger()` fills the gold one.

### 5.8 Buildings and construction (#84; K-D17 to K-D19: decided)

- **The kinds** (K-D17, decided): **the mine, the farm, the woodcutter, and a storehouse** that raises the storage caps.
  - **Buildings that benefit the hero** (for example XP or gold bonuses) wait until #86. They cross from the Kingdom into character progression, which the world notes' section 4 flags for simulation.
- **Slots** (K-D18, decided): **one of each kind.** A Kingdom grows by upgrading levels.
  - Each building starts unbuilt, at level 0; building it is the upgrade to level 1.
- **Levels:** each level's cost (resources and gold, K-D14), its output and its construction time are functions of the level. Their curves are parameters (section 7).
  - **Whether the levels have a maximum** is a parameter.

**Timed construction** (K-D19, decided: timed from the start). The owner's rules:
- **One construction at a time per Kingdom.** Starting a second while one is under way is refused.
- **The cost is paid when the construction starts.** The building's new level applies when it finishes, at a server time: the start plus that level's construction time.
- **A building keeps producing at its current level while it's upgraded,** and at the new level from the moment the construction finishes.
- **A construction under way can be cancelled, for a full refund** of everything paid.
- **It finishes whether or not the player is signed in.** Like production (5.9), it is worked out lazily on the next request, on server time only. It isn't a job that runs on its own.
- **Starting and cancelling are management, so they happen only in the Kingdom Zone** (K-D12).
  - Applying a finished construction, and accruing production, happen on any request, wherever the hero is.
  - **Cancelling counts as management:** that's an assumption, for the review to confirm (section 12).

**How finishing interacts with production:** when a request covers a period in which a construction finished, production is accrued up to the finish time at the old level, then from the finish time at the new level. A building's output never depends on when the player happens to act.

**State,** in `characters.data.kingdom`:
- each building's level;
- `construction`: the building, the level it raises it to, the start and finish times, and exactly what was paid; or null.

**Safe to retry:**
- **Starting** carries the building and the level it upgrades from. The server refuses it if that building has changed, or if a construction is already under way. A retried or doubled start, including from a second tab, starts once and charges once.
- **Cancelling** carries the construction it cancels, by its start time. The server refuses it if that construction has already finished or been cancelled. A doubled cancel refunds once.
- **Finishing** is a calculation from the stored times, not an action, so it can't happen twice.

### 5.9 Production (#84; K-D20: decided)

- **Lazy, on server time,** like `applyRegen()` (3.3):
  - each Kingdom keeps `kingdom.lastTick`;
  - on each request, the server adds each building's output for the elapsed time, up to the storage caps;
  - it advances `lastTick` by the time accounted for;
  - no background job, and no client clock.
  - **This closes off production-clock manipulation** (security notes, section 10).
- **Offline production** (K-D20, decided): **it continues while the player is signed out, up to each resource's storage cap.** The storehouse raises the caps.
  - This is game-provided idle production, which the security notes, section 6, separate from outside automation.
- **Collecting** (K-D20, decided): **output goes into the stock automatically.** There's no Collect action, so it's credited on any request, wherever the hero is.
- **During construction:** production follows the building's current level until the construction finishes (5.8).
- **Precision:** whole units only, with any remainder carried in `lastTick`, as regeneration does. No floating-point stock.

### 5.10 Integrity, abuse and staff tools

- **Every Kingdom action is a `game` action:** `kingdomClaim`, `kingdomRelease`, `kingdomStart` (build or upgrade) and `kingdomCancel` (names indicative).
  - Each is validated by the shared engine and saved once, with the version check. The claim goes through its Postgres function (5.3).
  - The claim, and every management action (start, cancel, release), are refused outside the Kingdom Zone (K-D12).
- **A retry is safe:**
  - the claim's unique constraints;
  - the "from level" and "one at a time" checks on starting, and the start-time check on cancelling (5.8);
  - a 409 for a stale save, as today.
- **Rate limits:** whether Kingdom actions join `FAST_ACTIONS`. **Recommendation:** yes, with the same 150 ms floor. Numeric limits are #78's.
- **The admin console:**
  - a Kingdoms section: find a plot or owner, see a Kingdom;
  - **revoke a claim:** tier 1, type the name to confirm;
  - **correct a Kingdom's stock or buildings:** as the hero editor corrects a hero;
  - **reserve plots** (K-D9);
  - each change writes one audit entry. Audit entries are best effort today ([#80](https://github.com/Aeturnia/clickmonster/issues/80)), and these would be too unless #80 changes that.
- **Kingdom names** (K-D8, decided): **the hero's name,** as in "Alda's Kingdom". There's no player-chosen name, so nothing new to moderate.

## 6. The owner's decisions (2026-11-23)

The owner answered all 20, one at a time, on 2026-11-23. "As recommended" means the owner chose the option this draft recommended.

| # | Decision | The owner's answer |
|---|---|---|
| K-D1 | What the Kingdom Zone is | **C:** a place reached by a portal, drawn as a windowed plot map. Plots are in their own table. As recommended |
| K-D2 | Who can claim, and the cost | **A minimum hero level and a claim cost.** Values from #86. As recommended |
| K-D3 | Finding a free plot | **Both:** nearest free plot (to the window or a chosen point), and a random free plot. As recommended |
| K-D4 | What the map shows of others' plots | **"Claimed by" and the owner's hero name.** As recommended |
| K-D5 | Release and relocation | **Release is allowed,** losing the buildings, with a type-the-name confirmation. **No relocation.** As recommended |
| K-D6 | Where Kingdom state lives | **S1:** in `characters.data`, with the plot in `kingdom_plots` and the claim through one Postgres function. As recommended |
| K-D7 | Deleting a hero | **The plot is freed at once.** The delete confirmation names the Kingdom. As recommended |
| K-D8 | Kingdom names | **The hero's name.** As recommended |
| K-D9 | Reserved plots, and a full map | **Admins can reserve plots from the start.** The full-map policy is decided before half the plots are claimed. As recommended |
| K-D10 | Inactive owners | **No reclaiming in the foundation.** Last activity is recorded, and any later policy is announced before it applies. As recommended |
| K-D11 | Where the interface opens | **A Kingdom section in the Hero tab.** No fifth tab. As recommended |
| K-D12 | Where it can be managed from | **Only in the Kingdom Zone,** anywhere in it. Elsewhere, the Hero tab shows a read-only summary and "Travel to the Kingdom Lands to manage it". **Differs from the recommendation,** which was anywhere outside a fight |
| K-D13 | Resource categories | **Ore, food and wood, produced, and one generic monster material.** The owner's note: the material drops by chance, like gems and relics, not on every kill. As recommended, with that note |
| K-D14 | Gold in building costs | **Yes, gold as well as resources.** As recommended |
| K-D15 | Trading | **Not in the foundation.** As recommended |
| K-D16 | Materials from monsters | **A separate drop chance,** with gem and relic chances unchanged. **Plot owners only.** **A new `materials` multiplier.** As recommended |
| K-D17 | Building kinds | **The mine, the farm, the woodcutter and a storehouse.** Hero-benefit buildings wait for #86. As recommended |
| K-D18 | Slots | **One of each kind,** grown by levels. As recommended |
| K-D19 | Construction time | **Timed from the start.** One construction at a time per Kingdom; a building keeps producing at its current level while upgraded; cancelling refunds in full. **Differs from the recommendation,** which was instant |
| K-D20 | Offline production | **It continues while signed out, up to each storage cap,** and goes into the stock automatically. As recommended |

## 7. Parameters for #86 (all undecided)

| Parameter | Unit | Controls |
|---|---|---|
| `KINGDOM_SIZE` | cells per side | The zone's size. The owner's direction is 100 for the initial zone |
| `PLOT_WINDOW` | cells per side | The plot map's window (5.2) |
| `CLAIM_MIN_LEVEL` | hero level | Who can claim (K-D2) |
| `CLAIM_COST` | gold and/or materials | The claim's price (K-D2) |
| `MATERIAL_CHANCE(level?)` | probability per kill | The material's own drop chance, for plot owners (K-D13, K-D16). Whether it varies by monster level is undecided |
| `MATERIAL_AMOUNT(level)` | units | Materials per drop, by monster level |
| `MATERIAL_CAP` | units, or none | Whether the monster material has a storage cap |
| `BUILD_COST(kind, level)` | resources and gold | The cost to build and to upgrade (K-D14) |
| `BUILD_TIME(kind, level)` | seconds | How long each construction takes (K-D19, decided: timed) |
| `OUTPUT(kind, level)` | units per hour | Production |
| `STORAGE_CAP(resource, storehouse level)` | units | The offline limit, and the stock limit (K-D20) |
| `MAX_BUILDING_LEVEL` | level, or none | Whether levels end |
| `materials` multiplier | factor | The admin and event multiplier (K-D16); 1 by default |

## 8. Phasing (proposed; each phase needs its own authorization)

1. **K-0: this scope.**
   - The owner's decisions are made (section 6, 2026-11-23).
   - Next: independent review, then acceptance.
2. **K-1: ownership and the interface (#83).**
   - **Included:**
     - the `kingdom_plots` table and `kingdom_claim()`;
     - the Kingdom Zone's entry;
     - the plot map;
     - claim and release;
     - the Hero tab's Kingdom section (the summary elsewhere, "Manage my Kingdom" in the Kingdom Zone) and an empty management view;
     - the admin section's search, revoke and reserve.
   - **No resources yet.**
3. **K-2: resources, buildings and production (#84).**
   - the material drops (the game-rule change, with its deploy order) and the `materials` multiplier;
   - the four buildings, with timed construction: one at a time, cancel with a full refund, finishing on server time;
   - lazy production, including across a construction's finish;
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
- Management and claiming are refused by the server outside the Kingdom Zone. Elsewhere, the Hero tab shows the read-only summary.

**K-2:**
- Production depends only on server time. Changing the device's clock changes nothing.
- Production stops at the storage cap, and resumes from there.
- **A retried or doubled start** starts one construction and charges once. A second start while one is under way is refused.
- **A doubled cancel** refunds once, and the refund is exactly what was paid.
- **A construction finishes at its server time** whether or not the player is signed in, and only once. Changing the device's clock changes nothing.
- **Production across a construction's finish:** the old level's output up to the finish time, and the new level's after it, whenever the next request comes.
- **Heroes without a plot see no change in their loot.** For plot owners, gem and relic chances are unchanged, and the material drops by its own chance.
- **Every resource change is in the resource ledger.** Gold spent and refunded is in the gold ledger.

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
5. **The assumption that cancelling is management,** and so only possible in the Kingdom Zone (K-D12, K-D19; 5.8). Or should cancelling be allowed anywhere, as a safety valve?
6. **Entering the Kingdom Zone:** a portal from the Crossroads only, or from every town? With management only in the Kingdom Zone (K-D12), the route affects how often players travel.
7. **Claiming as tier 2** (a dialog with focus on Cancel) rather than tier 4 (5.2).
8. **Whether elites, variants and world-boss hunts** affect the material drop (5.7).
