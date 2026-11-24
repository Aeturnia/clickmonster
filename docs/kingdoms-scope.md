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
- **Revised after the independent review of `1234901`** (2026-11-23; it superseded the review of `b4713d7`).
  - **K-D1 to K-D20 are binding,** and none is reopened.
  - **The review asked for five consistency corrections:**
    - ownership transactions (5.3.1);
    - accounting and audit (5.11);
    - phase dependencies and activation gates (8);
    - production settlement (5.9);
    - the Kingdom Zone's place in the world (5.1.1).
  - **Rules added by this revision** are marked "proposed (review)" where they are implementation clarifications, and listed in section 12 where they need an owner decision.
- **The owner answered section 12's eight owner-decision questions on 2026-11-23:** questions 3, 5, 6, 7, 8, 9, 10 and 15. The design is updated to them, and the pending-rewards defect is tracked as [#102](https://github.com/Aeturnia/clickmonster/issues/102).
- **Amendment 1 (2026-11-23), after K-0's acceptance (PR #101):** `kingdom_claim()` and `kingdom_release()` claim the request's staged pending rewards in their own transaction (5.3.1, rule 2).
  - **Why:** the owner decided this on question 6 of [#102's scope](pending-rewards-scope.md) (PR #104), to keep its rule R-1: any write that commits a hero's `data` claims that request's staged reward ids in the same transaction.
  - **Without it,** a claim or release would save delivered rewards without claiming them, and they would be delivered again.
  - **Nothing else in the accepted scope changes.**

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
| **C. A place reached by a portal, drawn as a plot map** *(decided)* | A zone with the reserved id `kingdoms`, defined in code and reached by a portal. It is drawn by its own plot-map view, not `viewMap()`, and no monsters roam there. The plots live in their own table (5.3), not in the zone's definition | Keeps the world consistent, and keeps a location for later geography or sieges. The zone editor never sees 10,000 plots | One special zone that the zone code must recognize (5.1.1) |

**Decided: C** (the owner, 2026-11-23).
- Its size, 100, is a fixed constant of the Kingdom code, not an editable zone field.
- **Entry** (question 6, decided by the owner on 2026-11-23): **one portal, on the Overworld at the Crossroads.** No other town has a path to the Kingdom Lands.
- **The level requirement for entry** is the same as for claiming (K-D2) unless the review says otherwise.

#### 5.1.1 The Kingdom Zone in the world (proposed; review)

**Where it is defined:**
- **In code, not in the `zones` table.** `loadZones()` (`zones.js:270`) registers the Kingdom Zone after the database's zones, under the reserved id `kingdoms`.
- **So the zone editor never lists it,** and can't edit, resize or delete it.
- **The 3-to-40 size limit (`ZONE_SIZE`) doesn't apply,** because the Kingdom Zone never passes through `validateZone()`.
- **The reserved id is protected:** `validateZone()` refuses a database zone with the id `kingdoms`, and `loadZones()` ignores one if it exists.
- **The definition has no** monsters, boss, lairs, town, shop or PvP, and its `pvp` is false.

**The hero's position:**
- **A hero in the Kingdom Zone has a real location:** `char.loc = { zone: 'kingdoms', x, y }`, at the zone's **gate**, a fixed cell. That keeps the public `zone`, `x` and `y` columns, and the save format, as they are for every zone.
- **In the foundation, the hero stays at the gate.**
  - `move()` and `walkTo()` are refused in the Kingdom Zone, with a plain message ("Choose plots on the plot map.").
  - Nothing in the foundation depends on where in the zone the hero stands. K-D12 needs only "in the Kingdom Zone".
  - A later phase can allow walking without changing the save format, if geography or sieges (#85) need it.
- **The plot-map window is not the hero's location.**
  - It is UI state in `freshUi()`, reset for each account, like the map cursor today.
  - Moving the window, selecting a plot, "My Kingdom" and the two finders change only the window. They never change `char.loc`.

**Plot selection and claiming:**
- **Selecting a plot is UI only.**
- **"Claim this plot"** sends the plot's coordinates.
- **The server checks** that the hero is in the Kingdom Zone (K-D12), not that the hero stands on that plot.

**Entering and leaving:**
- **Entering:** a portal on the Overworld leads to the gate. Its cell is a code constant, the Crossroads (question 6, decided). Its level is the claim level (5.1).
  - `compileZone()` adds it to the Overworld, as it already adds the Overworld's paths into other zones (`zones.js:244`).
  - `validateZone()` refuses a zone whose Overworld position is that cell, so two portals never share it.
- **Leaving:** the gate carries a portal back to the Overworld's gate cell, with level 0. The plot map shows it as "Leave the Kingdom Lands", using the existing portal action (`usePortal()`, `world.js:63`).

**Combat and other actions in the Kingdom Zone:**
- **Roaming monsters and bosses:** `monstersHere()` returns none, so `fight` has nothing to fight.
- **Duels:** refused, as in every non-PvP zone.
- **World-boss hunts:** the admin console's hunt start (`startHunt()`, `supabase/functions/admin/index.ts:304`) refuses the Kingdom Zone, so no hunt can run there.
- **Healing, the shop, the bank and quests:** unavailable, because there's no town. That is the same rule as any cell outside a town.
- **Chat:** zone chat works as in any zone.
- **The players list ("who's here"):** it lists heroes on the same cell, and in the foundation every hero in the zone stands at the gate. **Proposed:** the Explore tab doesn't show it in the Kingdom Zone. The implementation checks the existing query's limit.
- **The tabs:**
  - **the Map tab** shows the plot map instead of `viewMap()`;
  - **the Explore tab** shows the zone's description, "Leave the Kingdom Lands", and "Manage my Kingdom" or the claim prompt.

**Staff tools and recovery:**
- **The hero editor** (`index.ts:157` in the admin function) can move a hero to the Kingdom Zone, but only to the gate. Any other coordinates there are refused.
- **`ensureCharacter()`** (`character.js:66`) moves a hero in the Kingdom Zone to the gate if their coordinates aren't the gate. The Kingdom Zone is defined in code, so it can't be missing.
- **While the Kingdom release switch is off** (section 8), the Overworld portal isn't added. A hero found in the Kingdom Zone is moved to the Overworld's gate cell.

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
  - **Decided (question 7, the owner, 2026-11-23): tier 2,** a `confirm.js` dialog with focus on Cancel, because a claim lasts until it's released and can't be moved (K-D5). The dialog:
    - names the plot, by its coordinates;
    - gives the cost;
    - says the Kingdom can't be moved later.

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

**Decided: S1** (the owner, 2026-11-23). The rest of this section works within it.
- **Building, upgrading, cancelling and production** change only the hero's row. They use the ordinary versioned save.
- **For #85 (out of scope),** S1 doesn't preclude sieges. They would act through Postgres functions on both heroes' rows with version checks. **That belongs to #85's scope.**

#### 5.3.1 Changes that cross the plot and the hero (proposed; review)

**The invariant (I-1):**
- A hero has `data.kingdom` **if and only if** a `kingdom_plots` row with status `claimed` has that hero's `character_id`.
- `data.kingdom.plot` equals that row's `x` and `y`.

Every change that could break I-1 is listed here, with its single transaction. Nothing else may add or remove `data.kingdom`, or change `data.kingdom.plot`. That includes the `game` function's ordinary actions, the engine, and the admin hero editor.

| Change | Where it runs | One transaction, in this order | On failure |
|---|---|---|---|
| **Claim** | `game`: `kingdom_claim(p_char, p_version, p_data, p_public, p_x, p_y, p_reward_ids)` | **Insert the plot** (status `claimed`). **Claim the staged rewards** in `p_reward_ids`, if any, with #102's checks: each owned by `p_char`, unclaimed, no duplicates, and the count matching, or raise (amendment 1). **Update the hero** with `p_data` and the public columns, `version = p_version + 1`, where `id = p_char` and `version = p_version`; if no row is updated, raise | Everything rolls back, the reward claims included. A plot that is taken, or a hero that already has a plot, fails on the unique key. A stale version fails as "busy" (409). A reward conflict fails the same way. Nothing is written, and the staged rewards stay pending |
| **Release** | `game`: `kingdom_release(p_char, p_version, p_data, p_public, p_reward_ids)` | **Delete the hero's `claimed` plot;** if there's none, raise. **Claim the staged rewards,** as for the claim (amendment 1). **Update the hero** with the version check, as above. `p_data` has no `kingdom` | Everything rolls back, the reward claims included. The staged rewards stay pending |
| **Admin revoke** | `admin`: `kingdom_revoke(p_x, p_y, p_staff, p_staff_name, p_reason)` | **Lock and delete the plot;** if there's none, raise. **Lock its hero's row.** **Update the hero:** `version = version + 1`, unconditionally; `data = data - 'kingdom'`; and, **only if the construction is still under way,** add exactly its `paid` gold to the hero's `gold` (question 9). "Under way" means `data.kingdom.construction` exists **and** its `finishAt` is later than the transaction's time: `floor(extract(epoch from now()) * 1000)`, the same `finishAt <= time` rule as settlement (5.9). A stored construction whose `finishAt` has passed has finished, even if lazy settlement hasn't yet cleared it, so nothing is refunded. **Insert the audit entry,** recording the gold refunded, which may be 0, and the time used | Everything rolls back: plot, Kingdom, gold, construction and audit entry are all unchanged |
| **Admin reserve** | `admin`: `kingdom_reserve(p_x, p_y, …)` | **Insert a `reserved` plot,** which fails if the plot isn't free. **Insert the audit entry** | Everything rolls back |
| **Admin unreserve** | `admin`: `kingdom_unreserve(p_x, p_y, …)` | **Delete the plot where it is `reserved`;** if there's none, raise. **Insert the audit entry** | Everything rolls back |
| **Deleting a hero** | `game`: the existing `delete` (`index.ts:430`) | **Deleting the hero's row cascades** to its plot, in the same statement. `data.kingdom` goes with the row | No partial state is possible |

**Reserving a claimed plot** is refused: staff revoke it first, then reserve it. So no single change makes one plot both reserved and owned.
- **Proposed (review):** the table also enforces this. A `CHECK` requires a `claimed` row to have a `character_id` and a `reserved` row to have none.

**How the functions fit the `game` function's versioned saves** (`saveRow()`, `index.ts:60`):
1. **One request, one commit.** The claim and release actions commit the hero only through their function. No `saveRow()` runs before or after it in that request. The function's version becomes the row's version.
2. **Everything else is in `p_data`,** and the staged rewards are claimed with it (amendment 1).
   - `p_data` carries everything the request had already changed: regeneration, settlement (5.9), and any pending rewards staged in memory.
   - **The ids of those staged rewards are passed as `p_reward_ids`, and claimed in the same transaction** (R-1 of [#102's scope](pending-rewards-scope.md), 5.3.1; its 5.2 for the checks). One commit therefore carries the whole request, the reward claims included.
   - **If the function fails,** nothing is written, and the rewards stay pending for the next request.
   - **The admin functions** (revoke, reserve, unreserve) change the hero with SQL, not from a staged `p_data`, so they stage and claim nothing.
3. **A revoke makes in-flight saves fail.** The revoke raises the hero's `version` without knowing the game's version. So any `game` request for that hero that read the row before the revoke fails its save with 409, and can't write the Kingdom back.
   - A request after the revoke reads the hero without a Kingdom.
   - The cost: an unrelated action of that hero in flight at that moment (a fight, for example) also fails with 409, and is retried by the player. This is rare, and it is the same answer a busy hero gets today.

**Retries:**
- **A retried claim that had succeeded** fails on the unique `character_id`. The player is told they already have a Kingdom, and the client reloads its state.
- **A claim that failed** wrote nothing, so it can be retried as is.
- **A retried release, revoke or unreserve that had succeeded** finds no plot, so it is refused without changing anything.

**What this prevents:**
- **Split ownership and duplicate claims:** the primary key on `x`, `y`, and the unique `character_id`.
- **Double spending:** the claim's cost is in `p_data`, committed only with the version check.
- **Orphans:** a plot without a Kingdom, or a Kingdom without a plot. Every change that removes one removes the other in the same transaction.

**Checking it:**
- **pgTAP** tests each function's all-or-nothing behaviour, including:
  - two claims of one plot at once;
  - one hero claiming twice at once;
  - a stale version;
  - a revoke between a `game` read and its save.
- **A read-only check,** `supabase/checks/kingdom_verify.sql`, lists any hero or plot that breaks I-1, for tests and for production after deploys.
- **An engine test** shows that no ordinary action changes whether `data.kingdom` exists.

**A related defect, in the `game` function at `2a43a12`, outside this scope:**
- **Tracked as [#102](https://github.com/Aeturnia/clickmonster/issues/102)** (question 15, decided: a separate issue, not authorized).
- **What happens:** `claimRewards()` (`index.ts:108`, called at `index.ts:450`, and on reads at `index.ts:413`) marks pending rewards claimed **before** the rest of the request runs, and only adds them to the hero in memory. **Any refusal or failure later in the same request** loses them: they are marked claimed but never delivered. That includes:
  - the 150 ms "Slow down!" (429) on the next line;
  - any engine error ("Not enough gold.");
  - any `GameError`;
  - a failed or conflicting save (409).
- **The deployed function wasn't checked.** This was read in the repository at `2a43a12`, not in `game` version 14's deployed source.
- **It matters more for Kingdoms.** A refused claim (the plot was just taken, or the hero already has one) is a routine outcome, and it lands in that window. With #102's fix and amendment 1, a refused claim leaves the staged rewards pending: their claim is rolled back with the rest of the function.
- **It affects every action today,** not only Kingdoms.
- **Fixing it is not part of this scope.** It is #102's own workstream, recommended for priority review before K-1 reaches production. Until it is fixed, K-1 inherits it.
- **Current status (2026-11-24): fixed in production.**
  - **The fix:** `save_hero_with_rewards()` and `game` v15. The live checks were accepted in independent review (`docs/pending-rewards-report.md`, 4.4).
  - **What K-1 keeps:** the rule above, through amendment 1 (R-1).
  - **The dependency:** #83 stays blocked by #102 until the owner closes #102.
  - **K-1 is still not authorized.**

  The bullets above describe the defect as found, at `2a43a12`.

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
  - **Proposed (review): release is refused while a construction is under way.** The player cancels it first, for K-D19's full refund. That way release never has to decide what happens to a cost already paid.
- **Deleting the hero** (K-D7, decided): the plot row cascades, so the plot becomes free at once.
  - The existing delete confirmation already asks for the hero's name to be typed (`main.js:1543`). Its text gains a line naming the Kingdom it destroys. **That changes existing copy.**
- **Reserved plots and the full map** (K-D9, decided):
  - admins can mark plots reserved from the start, using the `status` column;
  - **the full-map policy** is decided before half the plots are claimed.
- **Inactive owners** (K-D10, decided):
  - no automatic reclaiming in the foundation;
  - each owner's last activity is recorded, so a policy can be set later. `characters.updated_at` already exists. The implementation phase checks whether it is enough, or whether a separate Kingdom activity time is needed;
  - any later policy is told to players before it applies (security notes, section 8).
- **Sanctions:** a banned or jailed hero keeps their plot. Only an admin can revoke it, with a guaranteed audit entry (5.3.1, 5.11).
- **A revoke while a construction is under way** (question 9, decided by the owner on 2026-11-23):
  - **The gold refund:** for a construction **still under way at the revoke's time,** its **gold is refunded to the hero, exactly as paid** (`construction.paid`), in the same transaction as the revoke (5.3.1).
  - **A construction that has already finished gets no refund,** even if the player hasn't acted since and the stored record is still there. Completion is lazy (5.9), so the revoke decides by `finishAt`, not by whether the record exists. `finishAt` at or before the revoke's time means finished, the same boundary as settlement and cancelling (5.8).
    - **For example:** a mine upgrade costing 500 gold finishes at 12:00, and the player is away until 15:00. A revoke at 15:00 refunds nothing: the upgrade finished at 12:00.
  - **What's forfeited:** the resources it cost, along with the Kingdom's stock and buildings.
  - **How it differs from cancelling:** this is not K-D19's cancellation, which refunds everything. A revoke refunds only the gold.
  - **Exactly once:** the refund happens once, because the plot and `data.kingdom` are deleted in the same transaction. A retried revoke finds no plot and refunds nothing.

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

**Decided (the owner, 2026-11-23):**
- **Only ordinary kills, not world-boss hunts** (question 3).
  - Materials come only from the ordinary kill rewards (`rollLoot()`, `battle.js:59`).
  - World-boss hunts, which pay out through `pending_rewards`, keep their current rewards exactly, and give no materials in the foundation.
- **Elites and variants raise the material chance** (question 8), the same way they raise other drops.
  - A variant's drop factor (`v.drop` in `rollLoot()`, `battle.js:64`, for example Fortunate and Hoarding) applies to the material roll as well.
  - **The size of that effect** is a #86 parameter (section 7).

**Still open, for #86:**
- **Whether the chance or amount varies** by monster level. Both are parameters (section 7).
- **The deploy order:** as for F2 (3.4).
  - The `game` function first, so the server's rule leads.
  - The client after, so it shows materials the server now awards.
  - Between the two, the client simply doesn't show material lines.
  - The order is confirmed in the implementation phase.
- **The ledger:** see 5.11 for its contract.
- **At the material's cap,** if `MATERIAL_CAP` is set: **proposed (review):** a drop that would go above the cap adds only up to the cap, and the battle log says the storage is full. Drops aren't production, so 5.9's clock doesn't apply to them.

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
  - **Cancelling counts as management** (question 5, decided by the owner on 2026-11-23): **a construction can only be cancelled in the Kingdom Zone.** Elsewhere, the Hero tab's summary shows it without a Cancel control.

**How finishing interacts with production:** a construction's finish is a step of the one settlement sequence (5.9).
- Production is settled up to the finish time at the old level, and from the finish time at the new level.
- A building's output never depends on when the player happens to act.

**Cancelling at the finish boundary:** a cancel request is settled first (5.9).
- **A construction whose finish time is at or before the request's time has finished.** The cancel is refused ("That construction has already finished.").
- **Only a construction still under way is cancelled.** The rule is `finishAt <= now`, so a cancel at exactly the finish time is refused.

**A full refund above the cap:** K-D19's refund is always in full.
- **Proposed (review):** if refunded resources take a stock above its cap, the stock keeps them.
- That resource's production then stops until the stock is below the cap again (5.9). Nothing is discarded.

**State,** in `characters.data.kingdom`:
- each building's level;
- `construction`: the building, the level it raises it to, the start and finish times, and exactly what was paid; or null.

**Safe to retry:**
- **Starting** carries the building and the level it upgrades from. The server refuses it if that building has changed, or if a construction is already under way. A retried or doubled start, including from a second tab, starts once and charges once.
- **Cancelling** carries the construction it cancels, by its start time. The server refuses it if that construction has already finished or been cancelled. A doubled cancel refunds once.
- **Finishing** is a calculation from the stored times, not an action, so it can't happen twice.

### 5.9 Production and settlement (#84; K-D20: decided; the settlement rules proposed, for review)

**The owner's rules** (K-D20, decided):
- **Production continues while the player is signed out,** up to each resource's storage cap. The storehouse raises the caps.
  - This is game-provided idle production, which the security notes, section 6, separate from outside automation.
- **Output goes into the stock automatically.** There's no Collect action.
- **During construction:** a building produces at its current level until the construction finishes (K-D19).

**The state,** in `characters.data.kingdom`, in whole numbers only:
- `stock`: ore, food, wood and the material;
- `levels`: the mine, farm, woodcutter and storehouse;
- `rem`: one remainder for each produced resource;
- `clock`: the server time in milliseconds up to which production has been settled;
- `construction`: as in 5.8.

**Production is measured** in whole units per hour: `OUTPUT(kind, level)`, with H = 3,600,000 ms. Each building's output is tracked with an integer remainder. There's no floating-point stock or rate, so the arithmetic is the same on every machine.

**Settlement: `settle(kingdom, now)`.** It is the one engine function in which production accrues and constructions finish. `now` is the request's single server time: `const now = Date.now()`, taken once at the start of `handle()` (`index.ts:394`). The client's clock is never used.

1. **If `now <= clock`, stop.** Time never runs backwards, even if two server instances' clocks differ slightly.
2. **Let `end`** be the construction's `finishAt` if there is a construction and `finishAt <= now`, and otherwise `now`.
3. **Accrue from `clock` to `end`,** at the current levels and caps.
4. **If the construction has finished** (`finishAt <= now`), apply its level and clear `construction`.
   - The new level, and any new storehouse cap, apply from `finishAt`.
5. **Accrue from `end` to `now`** at the levels and caps now in force.
6. **Set `clock = now`.**

**Accruing from `t0` to `t1`,** for each produced resource with its building at level L:
- **If L is 0:** no output, and the remainder is 0.
- **Otherwise:** `n = OUTPUT(kind, L) × (t1 − t0) + rem`; `units = floor(n / H)`; `rem = n mod H`.
- **If the stock is already at or above its cap:** add nothing, and set the remainder to 0.
- **Else, if `stock + units` reaches or passes the cap:** set the stock to the cap, and the remainder to 0.
- **Otherwise:** add the units.

**The rules this gives:**
- **Time spent at the cap isn't banked.** The reviewer's example: a mine making 10 ore an hour, a cap of 100, and the player away for 100 hours.
  - On return, the stock is 100 ore, not 1,000.
  - Spending 50 leaves 50. Accrual continues from that request's time, so an hour later there are 60.
  - The other 900 never appear.
- **Spending happens after settlement.** Every action that spends (start, release, claim) settles first, then spends from the settled stock. A stock spent down from the cap starts accruing from that moment.
- **No retroactive production.** An upgrade raises output only from its `finishAt`. A storehouse raises the caps only from its `finishAt`.
- **A stock above its cap** (after a full refund, 5.8, or a staff correction, 5.10) is kept. That resource doesn't accrue until the stock is below the cap again.
- **The order is fixed:** settlement runs once per request, before the action. It runs beside `applyRegen()` (`character.js:234`), on state reads and on actions alike, and with the same `now`.
- **Safe integers:** the implementation keeps every product within JavaScript's safe-integer range. For example, it may cut an interval short at the time the stock would reach its cap, which changes no result.

**Reads that don't save:**
- **Settlement is path-independent.** Settling to `t1` and then to `t2` gives exactly the same state as settling straight to `t2`, if no action happens between them.
  - That holds across the cap, which zeroes the remainder in both cases.
  - It holds across a construction's finish, which both paths split at `finishAt`.
- **So a `state` read** settles for its reply, but saves only when it already would today: for a changed notice or a hunt that has ended (`index.ts:398`).
- **The next action** settles again from the stored `clock`, and reaches the same numbers.
- **No new save is added to every read.**
- **An engine property test** checks path independence: random splits of an interval, with and without a cap and a construction's finish.

### 5.10 Integrity, abuse and staff tools

- **Every Kingdom action is a `game` action:** `kingdomClaim`, `kingdomRelease`, `kingdomStart` (build or upgrade) and `kingdomCancel` (names indicative).
  - Each is validated by the shared engine and committed once. Starting and cancelling use the ordinary versioned save. The claim and release go through their Postgres functions (5.3.1).
  - The claim, and every management action (start, cancel, release), are refused outside the Kingdom Zone (K-D12).
- **A retry is safe:**
  - the claim's unique constraints;
  - the "from level" and "one at a time" checks on starting, and the start-time check on cancelling (5.8);
  - a 409 for a stale save, as today.
- **Rate limits:** whether Kingdom actions join `FAST_ACTIONS`. **Recommendation:** yes, with the same 150 ms floor. Numeric limits are #78's.
- **The admin console:**
  - **a Kingdoms section:** find a plot or owner, and see a Kingdom;
  - **revoke a claim:** tier 1, type the name to confirm. It runs through `kingdom_revoke()` (5.3.1);
  - **reserve and unreserve plots** (K-D9), through their functions (5.3.1);
  - **correct a Kingdom's stock or buildings** through the hero editor's versioned save. This can't add or remove the Kingdom, or move its plot (I-1). A corrected cap or stock follows 5.9's rule for a stock above its cap;
  - **which audit entries are guaranteed and which are best effort:** see 5.11.
- **Kingdom names** (K-D8, decided): **the hero's name,** as in "Alda's Kingdom". There's no player-chosen name, so nothing new to moderate.

### 5.11 Accounting and audit (proposed; review)

**What is authoritative:**
- **A hero's resources and gold are what the hero's committed state says** (`characters.data`), saved with the version check (5.3.1).
- **Nothing else is a balance.** Refunds, costs and every rule read the state, never a ledger.

**The resource ledger is best-effort analytics,** like the gold ledger today:
- **Its shape:** a `resource_ledger` table of day, source, resource, amount and count. It is filled by a `resource_ledger_add()` function, as `ledger_add()` fills `ledger` (`20261113150000_world_hunts_ledger.sql:104`). Production is recorded as daily totals, not one row per request.
- **What a request's changes are measured from:** the hero's state **as loaded, before settlement.** Reads don't save their settlement (5.9), so production is recorded by the next request that saves. Measuring after settling would miss it.
- **When it is written:** **only after the hero's save has succeeded.**
  - A save that fails is never recorded.
  - A ledger write that fails after a successful save is reported to the server log, and lost.
  - **So the ledger can undercount, and never overcounts.**
- **What it is for:** #86, and staff watching inflows and outflows. It is not for proving an individual balance.
- **Gold spent or refunded on Kingdoms** goes to the existing gold ledger under a `kingdom` source, with the same contract.

**The alternative, not proposed:** an authoritative ledger.
- It would need the state and its ledger entries to commit together. In practice, every resource-changing save would become a Postgres function, and that would change the save path of every action.
- **Decided (question 10, the owner, 2026-11-23): the resource ledger stays best-effort statistics.** The hero's state remains authoritative, and there's no authoritative ledger.
- **A revoke's gold refund** (question 9) goes to the gold ledger under `kingdom`, after the revoke's transaction commits, with the same best-effort contract.

**Audit entries:**

| What | Audit | How |
|---|---|---|
| **Admin revoke, reserve and unreserve** | **Guaranteed** | The `admin_log` insert is inside the same function and transaction (5.3.1). If it fails, the action fails |
| **Admin corrections to a Kingdom's stock or buildings** (hero editor) | **Best effort, as every hero edit today** | `log()` after the save. A failed insert is reported, not fatal (#80) |
| **Players' own Kingdom actions** | **None,** as for players' actions today | The resource ledger records their totals |

- **Making the hero editor's audit guaranteed** belongs to #80, not here.

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

## 7. Parameters (all values undecided)

**The claim cost can only be gold.** The plot owners' material is K-D16's, and produced resources need a Kingdom, so before a hero has a plot they have neither. K-D2's cost can therefore be gold and nothing else. This follows from K-D2 and K-D16 together, not from a new decision, and it avoids a claim that needs something only owners can get.

"Needed before" is the gate at which a value must be set in a reviewed PR (section 8).

| Parameter | Unit | Controls | Needed before |
|---|---|---|---|
| `KINGDOM_SIZE` | cells per side | The zone's size. The owner's direction is 100 for the initial zone | K-1 activation (100 is the owner's direction) |
| `PLOT_WINDOW` | cells per side | The plot map's window (5.2). An interface value, not balance | K-1 implementation |
| `CLAIM_MIN_LEVEL` | hero level | Who can claim and enter (K-D2, 5.1) | K-1 activation |
| `CLAIM_COST` | gold | The claim's price (K-D2; gold only, above) | K-1 activation |
| `MATERIAL_CHANCE(level?)` | probability per kill | The material's own drop chance, for plot owners (K-D13, K-D16). Whether it varies by monster level is undecided | K-2 activation |
| `MATERIAL_VARIANT_EFFECT` | factor, per variant | How much a variant's drop factor raises the material chance (question 8). It may be the variant's existing `drop` factor | K-2 activation |
| `MATERIAL_AMOUNT(level)` | whole units | Materials per drop, by monster level | K-2 activation |
| `MATERIAL_CAP` | whole units, or none | Whether the material has a storage cap (5.7) | K-2 activation |
| `BUILD_COST(kind, level)` | whole units of resources, and gold | The cost to build and to upgrade (K-D14) | K-2 activation |
| `BUILD_TIME(kind, level)` | whole seconds | How long each construction takes (K-D19) | K-2 activation |
| `OUTPUT(kind, level)` | whole units per hour | Production (5.9) | K-2 activation |
| `STORAGE_CAP(resource, storehouse level)` | whole units | The offline limit, and the stock limit (K-D20) | K-2 activation |
| `MAX_BUILDING_LEVEL` | level, or none | Whether levels end | K-2 activation |
| `materials` multiplier | factor | The admin and event multiplier (K-D16) | 1 by default; admins change it |

## 8. Phasing (proposed; each phase needs its own authorization)

**Two release switches,** both off when merged and deployed. They follow `RECOVERY_REQUESTS` in `entry.js`, but are checked by the server's shared engine as well as shown by the client. Each is turned on only in its own reviewed PR, with the owner's authorization:
- **`KINGDOMS_OPEN`** (K-1). While it's off:
  - the Overworld portal isn't added (5.1.1);
  - claims are refused;
  - the Hero tab shows no Kingdom section.
- **`KINGDOM_ECONOMY`** (K-2). While it's off:
  - no material roll;
  - no production;
  - construction is refused;
  - the management view says the Kingdom's economy isn't open yet.

**While a switch is off, no economic rule runs,** so no undefined parameter is ever in effect. Tests run with explicit test values, which never ship as live values.

**The phases:**
1. **K-0: this scope.**
   - The owner's decisions are made (section 6, 2026-11-23).
   - Next: independent review, then acceptance.
2. **K-1: ownership and the interface (#83).** Merged and deployed with `KINGDOMS_OPEN` off.
   - **Included:**
     - the `kingdom_plots` table and its functions: claim, release, revoke, reserve and unreserve (5.3.1);
     - the I-1 check;
     - the Kingdom Zone (5.1.1);
     - the plot map;
     - claim and release;
     - the Hero tab's Kingdom section (the summary elsewhere, "Manage my Kingdom" in the Kingdom Zone) and an empty management view;
     - the admin section's search, revoke and reserve.
   - **No resources yet.** A claim costs gold only (section 7).
   - **K-1 activation gate:** `CLAIM_MIN_LEVEL` and `CLAIM_COST` are set in a reviewed PR, then `KINGDOMS_OPEN` is turned on, with the owner's authorization.
     - **The values are set by the separately authorized balancing work:** #86, or a balancing PR the owner authorizes. Claiming needs only the existing gold economy, so these values don't wait for K-2.
     - **K-D9's full-map policy** is due before half the plots are claimed, so after activation.
3. **K-2: resources, buildings and production (#84).** Merged and deployed with `KINGDOM_ECONOMY` off.
   - the material drops (the game-rule change, with its deploy order) and the `materials` multiplier;
   - the four buildings, with timed construction: one at a time, cancel with a full refund, finishing on server time;
   - settlement (5.9);
   - the resource ledger (5.11).
   - **The parameters are named constants in one module,** with no live values.
4. **#86: the simulations.** They run on K-2's engine functions (`settle()`, the costs, the drop roll), which are deterministic. Candidate values are an input, so they simulate the actual rules, not a model of them.
5. **K-3: the numbers.** Every parameter marked "K-2 activation" in section 7 is set from #86's results, in its own reviewed PR.
6. **K-2 activation:** `KINGDOM_ECONOMY` is turned on in its own reviewed PR, with the owner's authorization, only after K-3.

**So K-2's economy never runs on placeholders,** and K-1 needs nothing from K-2. K-1 and K-2 can also be activated together if the owner prefers.

**What each implementation phase brings** (so the review can see the cost):
- **A new migration,** under the procedure in [`docs/landing-l3-report.md`](landing-l3-report.md), section 4. Production's migration history is incomplete on purpose. There's a precheck, a verify script and a rollback.
- **pgTAP tests:** RLS, the column grants, the unique constraints, and every 5.3.1 function's all-or-nothing behaviour. That includes two claims at once, a stale version, and a revoke between a read and a save.
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
- An admin revocation frees the plot and removes the Kingdom in one transaction, with its audit entry. If the audit insert fails, nothing changes.
- **A revoke between a `game` read and its save:** the save fails with 409, and the Kingdom isn't written back.
- **Claim, release, revoke, reserve and unreserve each leave I-1 true,** or change nothing. The I-1 check finds no exceptions after the test suite.
- **A retried claim or release** after success changes nothing more.
- **Staged rewards and claims** (amendment 1):
  - a claim or release with staged rewards claims them in the same transaction as the hero's save;
  - a claim that fails (plot taken, stale version, or a reward conflict) leaves them pending and unclaimed;
  - they are never delivered twice.
  - This is #102's case 7.
- **The claim dialog** (question 7) is tier 2. It opens with focus on Cancel, and names the plot, the cost and that the Kingdom can't be moved. Cancelling it sends nothing.
- **The only way in** is the Crossroads portal (question 6).
- Management and claiming are refused by the server outside the Kingdom Zone. Elsewhere, the Hero tab shows the read-only summary.
- **In the Kingdom Zone:**
  - the hero stays at the gate, and moving and walking are refused;
  - no fight, duel or hunt is possible;
  - "Leave the Kingdom Lands" returns the hero to the Overworld.
- **Moving the plot-map window** never changes the hero's location.
- **With `KINGDOMS_OPEN` off,** nothing of Kingdoms is reachable, and a hero placed in the Kingdom Zone is moved out.

**K-2:**
- Production depends only on server time. Changing the device's clock changes nothing.
- **Production stops at the storage cap, and nothing is banked:**
  - 10 an hour, a cap of 100 and 100 hours away give 100;
  - spending then never releases the rest.
- **Settlement is path-independent** (an engine property test), so a read that doesn't save changes no later result.
- **A cancel at or after the finish time** is refused. The construction has finished.
- **A cancel from outside the Kingdom Zone** is refused by the server (question 5).
- **World-boss hunts give no materials** (question 3). On ordinary kills, a variant's drop factor raises the material chance (question 8). This is tested with explicit test values.
- **An admin revoke during a construction** (question 9):
  - **Success:** one transaction frees the plot, removes the Kingdom (stock, buildings and construction), adds exactly the construction's paid gold to the hero, raises the hero's version, and writes one audit entry recording the refund. The construction's resources aren't refunded.
  - **A revoke without a construction** refunds nothing.
  - **The finish boundary, with no player activity since the construction started** (pgTAP, with the transaction's time controlled):
    - **revoked before `finishAt`:** the paid gold is refunded;
    - **revoked exactly at `finishAt`:** the construction has finished, so nothing is refunded;
    - **revoked after `finishAt`,** with the stored record not yet cleared by settlement: nothing is refunded.

    In each case the plot, Kingdom, version and audit entry change together, and the audit entry records the amount refunded, 0 included.
  - **Transaction failure:** if any step fails (for example the audit insert, forced in a pgTAP test), nothing changes. The plot, the Kingdom, the hero's gold, the construction and the version are all as before.
  - **Concurrent actions:** a `game` request for that hero that read before the revoke fails its save with 409. It can't write back the Kingdom or the construction, so it can't trigger a cancel's full refund on top of the revoke's gold refund.
  - **A cancel racing a revoke:** tested on the local stack. The gold is refunded once: by the cancel (everything) if its save commits first, or by the revoke (gold only) if the revoke commits first.
  - **A retried revoke** finds no plot and refunds nothing.
- **A refund above the cap** is kept in full, and that resource doesn't accrue until the stock is below the cap.
- **With `KINGDOM_ECONOMY` off,** there are no material drops, no production and no construction.
- **A retried or doubled start** starts one construction and charges once. A second start while one is under way is refused.
- **A doubled cancel** refunds once, and the refund is exactly what was paid.
- **A construction finishes at its server time** whether or not the player is signed in, and only once. Changing the device's clock changes nothing.
- **Production across a construction's finish:** the old level's output up to the finish time, and the new level's after it, whenever the next request comes.
- **Heroes without a plot see no change in their loot.** For plot owners, gem and relic chances are unchanged, and the material drops by its own chance.
- **The ledgers are written only after a successful save** (5.11).
  - A failed save leaves no ledger entry.
  - In normal operation on the local stack, the resource ledger's totals match the heroes' changes.
  - Gold spent and refunded on Kingdoms is in the gold ledger under `kingdom`.

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
- **Two server clocks:** the revoke's finish check uses the database's time (`now()`, 5.3.1), while settlement uses the `game` function's `Date.now()` (5.9). Both use the same `finishAt <= time` rule. Any difference between the two clocks wasn't measured. It could matter only for a revoke within that difference of a construction's finish.

## 12. Questions for the scope review

Each is marked:
- **Owner decision:** it changes what players can do or get, so only the owner decides it;
- **Implementation clarification:** the review can settle it within the owner's decisions.

| # | Question | Kind |
|---|---|---|
| 1 | Is a Postgres function the right boundary for the changes that cross the plot and the hero (5.3.1), with everything else on the ordinary versioned save under S1? K-D6 itself is settled | Implementation clarification. **Answered by 5.3.1;** for the review to confirm |
| 2 | Is the windowed plot map an acceptable accessibility pattern, against a list-and-search interface only? | Implementation clarification |
| 3 | Should the material roll apply to world-boss hunts, which pay out through `pending_rewards`? | **Owner decision. Answered (2026-11-23): no.** Ordinary kills only; hunt rewards unchanged (5.7) |
| 4 | Does putting the interface in the Hero tab (K-D11) conflict with any Phase 2 layout rule for the side column on desktop? | Implementation clarification |
| 5 | **The assumption that cancelling is management,** and so only possible in the Kingdom Zone (K-D12, K-D19; 5.8). Or should cancelling be allowed anywhere, as a safety valve? | **Owner decision. Answered (2026-11-23): only in the Kingdom Zone** (5.8) |
| 6 | **Entering the Kingdom Zone:** a portal from the Crossroads only, or from every town? With management only in the Kingdom Zone (K-D12), the route affects how often players travel | **Owner decision. Answered (2026-11-23): the Crossroads only** (5.1, 5.1.1) |
| 7 | **Claiming as tier 2** (a dialog with focus on Cancel) rather than tier 4 (5.2) | **Owner decision. Answered (2026-11-23): tier 2.** The dialog names the plot and the cost, and says the Kingdom can't be moved; focus starts on Cancel (5.2) |
| 8 | **Whether elites and variants** affect the material drop (5.7). Hunts are question 3 | **Owner decision. Answered (2026-11-23): yes,** as for other drops; the size is a #86 parameter (5.7, section 7) |
| 9 | **A revoke while a construction is under way:** is its gold refunded to the hero? The stock and buildings go with the Kingdom (5.4) | **Owner decision. Answered (2026-11-23): yes,** exactly the gold paid, in the revoke's transaction; the resources are forfeited (5.3.1, 5.4) |
| 10 | **The ledger contract:** best-effort analytics that can undercount but never overcounts (5.11), or authoritative accounting? Authoritative would make every resource-changing save a Postgres function | **Owner decision. Answered (2026-11-23): best-effort statistics** (5.11) |
| 11 | **Release refused while a construction is under way** (5.4), so the player cancels first for the full refund | Implementation clarification |
| 12 | **Stock above a cap is kept, and accrual pauses** (5.8, 5.9), and **a material drop at its cap adds up to the cap** (5.7) | Implementation clarification |
| 13 | **The two release switches,** `KINGDOMS_OPEN` and `KINGDOM_ECONOMY`, and the activation gates (section 8) | Implementation clarification. Turning each on is the owner's authorization |
| 14 | **The Kingdom Zone's details** (5.1.1): the hero stays at the gate; no players list there; the Map tab shows the plot map | Implementation clarification |
| 15 | **The pending-rewards defect** in 5.3.1: should it get its own issue? | **Owner decision. Answered (2026-11-23): yes,** tracked as [#102](https://github.com/Aeturnia/clickmonster/issues/102), not authorized (5.3.1) |
