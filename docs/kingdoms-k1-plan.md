# Kingdoms K-1: implementation plan (#83)

**Status: revision 1, for independent review. No code, migration or deploy.**
- **Authorized:**
  - **the owner authorized the K-1 gate on 2026-11-24,** after PR #115's merge, starting with this plan;
  - **revision 1 and a bounded local feasibility check on 2026-11-25,** with the four owner decisions ratified (section 9).
- **The implementation is not authorized.** Each stage below needs its own authorization and review gate.
- **What changed in revision 1:**
  - the ratified decisions;
  - the feasibility evidence (section 10);
  - the six review findings K1-B01 to K1-B06 (section 11);
  - the deviations from K-0 (section 12).
- **The contract** is the accepted K-0 scope, [`docs/kingdoms-scope.md`](kingdoms-scope.md) (PR #101, with amendment 1 in PR #106). The parts K-1 implements are:
  - the Kingdom Zone (5.1, 5.1.1) and the plot map (5.2);
  - ownership (5.3), and the changes that cross the plot and the hero (5.3.1);
  - the claim rules (5.4);
  - the management interface's K-1 part (5.5);
  - integrity and staff tools (5.10), and the guaranteed audit entries (5.11);
  - section 8's K-1 phase, and section 9's K-1 criteria.
- **Nothing here reopens a decision:** no K-D decision, no owner answer, and none of section 12's implementation clarifications. Questions 2, 4, 13 and 14 are implemented as the scope writes them. Question 11 concerns construction, which is K-2's.
- **Where this plan departs from K-0's text,** section 12 lists it.
- **Read at `main` `09eee7f`** (2026-11-24). Line references are from that commit.
- **The prerequisite, #102, is closed.** K-1's claim and release extend its rule R-1: a write of a hero's `data` claims that request's staged reward ids in the same transaction. **`save_hero_with_rewards()` is not changed.**

## 1. What K-1 delivers, and what it doesn't

**Delivered** (scope 8, item 2):
- **The database:**
  - the `kingdom_plots` table;
  - the functions `kingdom_claim()`, `kingdom_release()`, `kingdom_revoke()`, `kingdom_reserve()` and `kingdom_unreserve()`;
  - the plot finder;
  - the I-1 check.
- **The game:**
  - the Kingdom Zone, reached only by the Crossroads portal;
  - the windowed plot map, 10 × 10, with "My Kingdom" and the two free-plot finders;
  - claim (tier 2) and release (tier 1);
  - the Hero tab's Kingdom section: the read-only summary outside the Kingdom Zone, and "Manage my Kingdom" inside it, opening an empty management view.
- **The admin console:** finding a plot or an owner, and revoking, reserving and unreserving plots.

**It ships dormant.** Kingdoms are open only when `KINGDOMS_OPEN` is true **and** both `CLAIM_MIN_LEVEL` and `CLAIM_COST` are set (2.2). All three ship off or unset, so every part is closed. What "closed" means for each part is in section 3.

**Not in K-1:**
- resources, materials, buildings, construction, production and the resource ledger (K-2, #84);
- **any live value:** `CLAIM_MIN_LEVEL` and `CLAIM_COST` stay unset;
- **activation:** setting the values and turning `KINGDOMS_OPEN` on are the K-1 activation gate (scope 8), each in its own reviewed PR, with the owner's authorization;
- #85 (sieges), #86 (the numbers), #87, #95 and #105.

## 2. Stages

There are five stages (decision 9.2). Each is one branch and one PR, with its own authorization, independent review, CI, and an entry in a K-1 report (`docs/kingdoms-k1-report.md`). The order is the order of dependency.

### 2.1 K1-1: the database

**The migration:** one new file in `supabase/migrations/`.
- **`kingdom_plots`:**

  | Column | Type | Rule |
  |---|---|---|
  | `x`, `y` | `smallint` | The primary key. Each `between 1 and 100` (`KINGDOM_SIZE`) |
  | `status` | `text` | `claimed` or `reserved` |
  | `character_id` | `uuid` | Unique. References `characters(id)` **on delete cascade** (K-D7) |
  | `claimed_at` | `timestamptz` | Default `now()` |

  - **The CHECK proposed in 5.3.1:** a `claimed` row has a `character_id`, and a `reserved` row has none.
  - **No name column** (K-D8).
- **Access:**
  - RLS on;
  - `select` on the four columns granted to `authenticated`, with a policy allowing every row;
  - nothing for `anon`, and no write grants: only the service role writes (5.3).
  - **While Kingdoms are closed the table is empty,** because nothing can write a row (section 3).
- **The five functions:** each is `security definer`, with `set search_path = public`. Execute is revoked from PUBLIC, `anon` and `authenticated`, and granted to `service_role`, as for `save_hero_with_rewards()`.
  - **Each follows 5.3.1's table,** in its order, as one transaction.
  - **The parameters are separate public columns** (`p_name`, `p_level`, `p_zone`, `p_x`, `p_y`), as in `save_hero_with_rewards()`, with the plot as `p_plot_x` and `p_plot_y` (item 8.1).
  - **Every update of the hero** sets `data`, the public columns, `version = p_version + 1` and `updated_at = now()`, as `save_hero_with_rewards()` does.
  - **`kingdom_claim()` and `kingdom_release()`:**
    - claim the staged rewards with #102's checks (amendment 1), through a private helper that only they use (item 8.3);
    - **validate `p_data` against I-1** (item 8.2). The claim requires `p_data->'kingdom'->'plot'` to be exactly `{x, y}` equal to the plot claimed. The release requires `p_data` to have no `kingdom`. A null, non-object or malformed `p_data` is refused. Each refusal raises `MRARG` before anything is written.
  - **`kingdom_revoke()`, `kingdom_reserve()` and `kingdom_unreserve()`** each insert their `admin_log` row inside the transaction (5.11: guaranteed).
  - **`kingdom_revoke()` returns the gold it refunded,** an integer that is 0 when there's nothing to refund (K1-B06; 2.2 for the ledger). The refund follows 5.3.1 exactly (item 8.4).
- **The plot finder** (K1-B05): `kingdom_free_plot(p_x int, p_y int, p_random boolean) returns table (x smallint, y smallint)`.
  - **Who can call it:** `security invoker`, `stable`. Execute is granted to `authenticated` and `service_role`, not to `anon` or PUBLIC. It reads only `kingdom_plots`, which `authenticated` can read anyway.
  - **Its arguments:** `p_x` and `p_y` must be integers from 1 to 100, unless `p_random` is true, when they're ignored. Anything else raises `MRARG`.
  - **"Nearest":**
    - the free cell with the smallest Chebyshev distance (`greatest(abs(dx), abs(dy))`, the same rings as the square window);
    - ties go to the smallest `y`, then the smallest `x`.
  - **"Random":** a uniformly random free cell.
  - **The answer:**
    - **at most one row,** and none when every plot is taken (the client says "No free plots");
    - computed over the 10,000 cells with `generate_series`, with no spatial index or other infrastructure.
  - **It's advisory.** The plot can be taken before the player claims it. The claim's transaction decides, and answers `MRPLT` (409).
- **The error contract.** Each error has a fixed SQLSTATE and message, so the functions can tell them apart (as in #102's stage 1):

  | SQLSTATE | Message | When | The player or staff sees |
  |---|---|---|---|
  | `MRPLT` | `plot_taken` | The plot is claimed or reserved (the primary key) | 409, "That plot was just taken." |
  | `MRHAS` | `has_kingdom` | The hero already has a plot (the unique `character_id`) | 409, "You already have a Kingdom." |
  | `MRNOP` | `no_plot` | Release, revoke or unreserve find no matching plot | 409, "You don't have a Kingdom." (game), or "That plot isn't claimed." / "That plot isn't reserved." (admin) |
  | `MRREW` | `rewards_conflict` | A staged reward is claimed already, another hero's, or missing | 409, "Your hero was busy — try again." |
  | `MRVER` | `version_conflict` | The hero's version has changed, or the hero doesn't exist | 409, "Your hero was busy — try again." |
  | `MRARG` | `bad_arguments` | A malformed call, or `p_data` that breaks I-1 | 500. It's a bug, never a player error |

  - **The unique violations are caught inside the function** and re-raised by constraint name, so `23505` never reaches the edge functions.

**Also in K1-1:**
- **pgTAP,** `supabase/tests/kingdoms.test.sql`:
  - the table, the constraints, the CHECK, RLS and the column grants;
  - **each function, all or nothing:** success; each error code; a reward conflict; a stale version; `p_data` null, malformed, or not matching I-1;
  - `updated_at`, the version and the public columns after each change;
  - a forced `admin_log` failure on revoke, reserve and unreserve, which changes nothing;
  - **the revoke's refund at its boundaries,** with fixture data and the transaction's time controlled:
    - before `finishAt`: the gold paid is refunded, and returned;
    - exactly at `finishAt`: 0;
    - after it: 0;
    - without a construction: 0.

    The audit entry records the amount in each case (5.3.1, question 9);
  - **the finder:** its grants, its argument checks, the nearest tie-break, and a full map giving no row;
  - deleting a hero frees the plot.
  - **Concurrency isn't tested in pgTAP.** It's tested through the functions in K1-2.
- **Checks** in `supabase/checks/`, read-only (item 8.5):
  - `kingdoms_precheck.sql`, `kingdoms_deploy_verify.sql` and `kingdoms_state.sql`, the same pattern as #102's;
  - `kingdom_verify.sql`, the I-1 check, named as in the scope.
- **Rollback:** `supabase/rollback/<version>_kingdoms_down.sql`.
- **Nothing calls the functions** until K1-2.

### 2.2 K1-2: the engine and the two functions

**The engine** (shared, so it is also published to the site on merge; section 3):
- **`public/js/engine/kingdom.js`, new:**
  - **the shipped constants:** `KINGDOMS_OPEN = false`, `CLAIM_MIN_LEVEL = null`, `CLAIM_COST = null`, `KINGDOM_SIZE = 100`, `PLOT_WINDOW = 10`, and the gate cell `(1, 1)`;
  - **one predicate, `kingdomsOpen(config)`:** true only if the switch is on **and** both values are set. Everything else in this plan asks it, on both sides. So unset values never mean unrestricted entry (K1-B03);
  - **the rules:**
    - can enter;
    - can claim: open, the level, the gold, in the Kingdom Zone, no Kingdom yet;
    - apply a claim: spend the gold, set `data.kingdom = { plot: { x, y }, claimedAt }`;
    - apply a release: remove `data.kingdom`;
  - **every rule takes the config as an argument,** so engine tests pass explicit test values.
- **The test configuration** (decision 9.1; K1-B01; evidence in section 10):
  - **When it applies:** only in the `game` and `admin` functions, and only when **both** hold:
    - `KINGDOMS_TEST` is exactly `1`;
    - the hostname of `SUPABASE_URL` is exactly `kong`, the local stack's gateway.
  - **What it gives:** the test values, fixed in code (for example open, level 1, cost 100). They're never read from the environment or from a request.
  - **How it is guarded:**
    - **Production can't meet the second condition.** The platform injects `SUPABASE_URL` and reserves the `SUPABASE_` prefix, so no secret can change it.
    - **A missing or malformed `SUPABASE_URL` fails closed.**
    - **An engine test covers the guard:** every other hostname, a missing variable, and any value but `1`.
    - **Production's secret names are checked again** at Gates A and C (2.5), as a second safeguard.
  - **The code-reviewed switch stays the only production activation.**
  - **Where `KINGDOMS_TEST` is set:**
    - **CI's database job** writes `supabase/functions/.env` before `supabase start`;
    - **locally,** the developer does the same.
    - **`supabase/functions/.env` goes in `.gitignore`.** It isn't ignored today.
- **The browser** has no test configuration. Browser tests turn Kingdoms on by rewriting the shipped constants in the harness, as `recoveryRequestsOn()` does for `RECOVERY_REQUESTS`.
- **`public/js/data/zones.js`** (K1-B02, K1-B03; section 12, item 1):
  - **`loadZones()` registers the Kingdom Zone only while Kingdoms are open,** after the database's zones, under the reserved id `kingdoms`. While closed, it isn't in `ZONES` at all.
  - **It always ignores a database zone with the id `kingdoms`,** and drops any database portal whose target is `kingdoms`. This is a second line behind validation, for rows written without it.
  - **`compileZone()` adds the Kingdom portal to the Overworld only while open:**
    - at the Overworld's town cell, the Crossroads (`(4, 4)` in the built-in Overworld, `zones.js:213`);
    - with `minLevel` equal to `CLAIM_MIN_LEVEL`.
- **`public/js/engine/zone-validate.js`** (K1-B03): `validateZone()` refuses:
  - the id `kingdoms`;
  - any portal whose target is `kingdoms`;
  - a portal in the Overworld's own `portals` at its town cell, where the Kingdom portal goes.
  - **What is already refused:**
    - a zone placed at the Overworld town;
    - an Overworld without a town;
    - a portal to a zone that doesn't exist.
- **`public/js/engine/world.js`:**
  - `move()` and `walkTo()` are refused in the Kingdom Zone ("Choose plots on the plot map.");
  - `usePortal()` already enforces the portal's `minLevel` on the server;
  - `monstersHere()` already returns none for a zone without monsters.
- **`public/js/engine/character.js`:** `ensureCharacter()`:
  - moves a hero in the Kingdom Zone who isn't at the gate to the gate;
  - **while closed,** moves a hero in the Kingdom Zone to the Crossroads, not to the race's home as for other missing zones (5.1.1);
  - **reports whether it moved the hero,** for K1-B04 (below);
  - never changes `data.kingdom`.

**The `game` function:**
- **One commit path.** `saveRow()`'s steps move into one helper, used by `saveRow()`, the claim and the release:
  - finish staging;
  - call the right function: `save_hero_with_rewards()`, `kingdom_claim()`, `kingdom_release()`, or the plain versioned update;
  - map the errors (2.1's table);
  - set `row.version` from the result;
  - flush the queued ledger only after the commit.

  So R-1, the version, the public columns, `updated_at`, reward staging and the ledger rule can't drift between the paths. **A request commits once.**
- **Location corrections are saved** (K1-B04):
  - **When `loadRow()`'s `ensureCharacter()` moves the hero,** the request marks the row changed.
  - **A `state` read** then saves through the shared commit path, as it already does for a changed notice or a staged reward. So the correction reaches `data` and the public `zone`, `x` and `y` columns with the version check.
  - **Every other action** saves anyway.
  - **There's no other write of the location,** and no unversioned one.
  - **The same fixes heroes in deleted or resized zones,** whose correction today stays in memory until their next save. It's the same mechanism, recorded as a deviation in section 12.
- **The actions** `kingdomClaim` and `kingdomRelease` (names from 5.10):
  - **refused while closed** ("Kingdoms aren't open yet.");
  - **checked by the engine** in the request, including K-D12: in the Kingdom Zone, outside a fight;
  - **committed** through the helper;
  - **the claim's gold** is queued for the gold ledger under a new `kingdom` source (5.11);
  - **added to `FAST_ACTIONS`** (item 8.6).
- **Nothing else changes `data.kingdom`.** An engine test checks that no ordinary action adds or removes it (5.3.1).

**The `admin` function:**
- **`startHunt()` refuses the Kingdom Zone.** While closed, the zone isn't in `ZONES`, so it is refused as unknown.
- **The hero editor:**
  - **moves a hero to the Kingdom Zone only while open,** and only to the gate. While closed, the zone is unknown, so "Invalid location.";
  - can't add or remove `data.kingdom`, or move its plot (5.10). It saves the `data` it read, version-checked, as today.
- **New actions:**
  - **reads:** find a plot, or an owner by hero name; see a Kingdom. Allowed to staff roles that can see players, whether Kingdoms are open or not. While closed they find nothing;
  - **mutations:** `kingdomRevoke`, `kingdomReserve` and `kingdomUnreserve`, admins only (`requireAdmin`), **refused while closed** ("Kingdoms aren't open yet."; K1-B02). No recovery exception is proposed, because nothing can exist to recover while closed (section 3).
- **The revoke's refund** (K1-B06):
  - **after `kingdom_revoke()` commits,** the function writes the refund it returned to the gold ledger under `kingdom`, through `ledger_add()`, as the hero editor does today (`admin/index.ts:196`), and only if it's above 0;
  - **a failed transaction writes nothing,** and neither does a retried revoke, which finds no plot (`MRNOP`);
  - **best effort,** as every ledger write (5.11).

**Every reader of `ZONES` and `ZONE_DEFS`** is checked in this stage. The table is in section 4.

**Tests:**
- **Engine tests** (Node):
  - `kingdom.js`, `kingdomsOpen()` and the test-configuration guard;
  - the zone rules: validation, the dropped portals, conditional registration and the portal's level;
  - `ensureCharacter()` and its report.
- **API tests,** `tests/db/kingdoms-api.test.mjs`, through the real `game` function on the local stack, in the test configuration:
  - **concurrency:** two heroes claiming one plot at once; one hero claiming twice at once;
  - a stale version;
  - **a revoke between a `game` read and its save:** 409, and the Kingdom isn't written back;
  - staged rewards with a claim and with a release (#102's case 7);
  - a failed claim leaves the rewards pending;
  - retried claims and releases;
  - refusals outside the Kingdom Zone;
  - **a location correction saved by a `state` read:** the version, the public columns and `updated_at`;
  - **the I-1 check** after the suite: no exceptions.
- **Admin API tests,** `tests/db/kingdoms-admin.test.mjs`, through the real `admin` function (K1-B06):
  - **authorization:** a moderator is refused the mutations (403);
  - **the RPCs are refused to players** through the REST API (`42501`);
  - revoke, reserve and unreserve each write exactly one audit entry, in the same transaction;
  - the refund is returned, and written to the ledger once after a successful revoke, and never after a failed or retried one.
- **The limitation:** the API tests run with Kingdoms open for the whole run. The closed behaviour through the real functions is covered by:
  - the engine tests of the same shared code;
  - Gate C's live checks, with Kingdoms closed (2.5).

  Running a second, closed function runtime in CI isn't proposed.

### 2.3 K1-3: the player's interface

- **The plot map,** in a new module (`public/js/kingdom-ui.js`), so `main.js` (1,929 lines) doesn't grow much (5.2):
  - **the window:** 10 × 10, showing 100 of the 10,000 plots (decision 9.4). `PLOT_WINDOW` is a presentation constant, separate from `KINGDOM_SIZE`;
  - controls to move it by a window or a row, and to jump to coordinates;
  - "My Kingdom", "Nearest free plot" and "Random free plot", the finders calling `kingdom_free_plot()`;
  - a list of the plots in view;
  - roving focus and arrow keys, as on today's map. Moving past the window's edge moves the window;
  - **moving the window never sends a request that changes the hero,** and never changes `char.loc`;
  - **each plot's label:** its coordinates, then "Free", "Reserved", or "Claimed by" and the owner's hero name (K-D4);
  - **its data** (item 8.8): the window's rows from `kingdom_plots`, and the owners' names from `characters`' public columns, both through the REST API;
  - **usability at 320 px** is checked in this stage. Adaptive window sizing isn't added without a demonstrated need (decision 9.4).
- **The tabs in the Kingdom Zone** (5.1.1):
  - **Map** shows the plot map;
  - **Explore** shows the zone's description, "Leave the Kingdom Lands", and "Manage my Kingdom" or the claim prompt;
  - **the players list isn't shown** there.
- **The Hero tab's Kingdom section** (5.5, K-1 part):
  - **outside the Kingdom Zone:** the plot, and "Travel to the Kingdom Lands to manage it". Without a plot, a line pointing to the Kingdom Lands, with the claim requirements;
  - **inside it:** "Manage my Kingdom", opening the management view with the Kingdom's name (the hero's) and its plot, and nothing else yet.
- **While closed, the interface draws nothing of Kingdoms** (section 3).
- **Claiming:** tier 2, a `confirm.js` dialog with focus on Cancel. It names the plot by its coordinates, gives the cost, and says the Kingdom can't be moved (question 7). Cancelling sends nothing.
- **Releasing:** tier 1, type the name (K-D5).
- **Deleting a hero:** the existing confirmation gains a line naming the Kingdom it destroys (K-D7). That changes existing copy, and the text is reviewed in this stage.
- **The existing patterns:**
  - pending keys `kingdom:<op>`;
  - focus kept across re-renders;
  - polite announcements;
  - per-account state in `freshUi()`;
  - every request records `gameGen` and checks `live(g)`.
- **The fake backend** (`tests/ui/harness.mjs`) learns the two actions, the plot reads, the finder, and the switch.
- **Browser tests:**
  - the plot map by keyboard and touch;
  - claiming, a version conflict, and account isolation;
  - phones at 320 px, phone landscape (with #95 in mind), and desktop;
  - **nothing of Kingdoms with the shipped constants;**
  - **axe with 0 violations** of any impact.

### 2.4 K1-4: the admin console

- **A Kingdoms section** in its own module (`public/js/admin-kingdoms.js`):
  - find a plot or an owner;
  - see a Kingdom;
  - revoke (tier 1, type the name);
  - reserve and unreserve.
- **While closed,** the section shows the reads, and says the mutations open with Kingdoms. The server refuses them anyway (2.2).
- **Single flight,** as every admin mutation (`CLAUDE.md`): pending keys `kingdom:<x>,<y>:<op>`.
- **Tests:**
  - admin browser tests at the five widths (`tools/admin-shots.mjs`);
  - the fake backend's audit entries;
  - the closed state.

### 2.5 K1-5: the production rollout procedure

**A written procedure for review,** like #102's (PR #109), before anything is done. **One coordinated rollout,** after K1-1 to K1-4 are accepted and merged, with Kingdoms closed (decision 9.3).
- **Gate A:** a read-only inspection:
  - the functions' versions and `ezbr_sha256`;
  - the migration history;
  - the precheck;
  - **every database zone, checked against the new validation** (2.2): no id `kingdoms`, no portal to it, and no Overworld portal at the town cell;
  - **the names (not the values) of the functions' secrets:** no `KINGDOMS_TEST`.
- **Gate B:** the migration, then its deploy-verify and state checks, and the I-1 check.
- **Gate C:** the `game` and `admin` deploys.
  - **Each from a pinned LF checkout,** with `tools/function-payload.mjs`.
  - **`admin` has been v8 since 2026-11-14.** This is its first redeploy since then, so it gets its own payload check and its own rollback pin.
  - **The secret names are checked again.**
- **The live checks, with Kingdoms closed:**
  - nothing of Kingdoms is reachable, for a player or an admin;
  - ordinary play is unchanged: the smoke check;
  - the I-1 check finds nothing.
- **Each gate needs the owner's authorization.**

**Activation is not part of the rollout.** It is its own gate (scope 8).

## 3. Closed: what each part does, and what is live at each step

**Kingdoms are closed** unless `kingdomsOpen()` is true (2.2). This table is the dormant-feature contract (K1-B02). Read access is separate from gameplay.

| Part | While closed |
|---|---|
| **Zone registration** (client, `game`, `admin`) | The Kingdom Zone isn't in `ZONES`. A database zone with its id is ignored |
| **The portal** | Not added. No other way in exists (K1-B03) |
| **Claim and release** (`game`) | Refused: "Kingdoms aren't open yet." |
| **A hero found in the Kingdom Zone** | Moved to the Crossroads, and the correction is saved (K1-B04) |
| **The admin hero editor** | Can't move a hero there: the zone is unknown |
| **The admin Kingdom mutations** | Refused. No recovery exception: no plot or Kingdom can exist while closed |
| **The admin Kingdom reads** | Allowed. They find nothing |
| **The database functions** (after Gate B) | Executable only by the service role. Nothing calls them |
| **Direct reads of `kingdom_plots` and the finder** (after Gate B) | Allowed for signed-in players. The table is empty, and the finder returns free plots. **Read access, not gameplay:** nothing a read returns opens a way in |
| **The player's interface** | Draws nothing of Kingdoms |
| **The admin console** | The section shows the reads, and says the mutations open with Kingdoms |

**Netlify publishes `public/` on merge,** including the shared engine, before any function is deployed. Every published state must work with the deployed functions (decision 9.3):

| After | The site | The server | Effect |
|---|---|---|---|
| K1-1 merge | Unchanged | Unchanged | None. The migration is a file |
| K1-2 merge | The engine has the Kingdom code, closed: no zone, no portal | `game` v15 and `admin` v8, unchanged | None. The client never sends the new actions while closed. The console's zone lists can't show a zone that isn't registered |
| K1-3 and K1-4 merges | The interfaces, drawing nothing while closed | Unchanged | None |
| Gate B | Unchanged | The table, the functions and the finder exist. Nothing calls the five functions | None. The empty table and the finder are readable |
| Gate C | Unchanged | `game` and `admin` have the Kingdom code, closed | None |
| Activation (not K-1) | Open, in a reviewed PR | The same PR, redeployed | Kingdoms open |

**Opening is a code change in both places.** It needs a reviewed PR, the site's publication and a redeploy of both functions, in an order its own procedure sets out. That procedure also says what happens if Kingdoms are ever closed again after opening, which is when a recovery exception could first be needed.

## 4. Every reader of `ZONES` and `ZONE_DEFS`

Registering a zone in code reaches every caller (grep at `09eee7f`). **While closed, the Kingdom Zone isn't registered,** so every reader below behaves as today. The table says what each does once it's open:

| Where | Use | With `kingdoms`, once open |
|---|---|---|
| `engine/character.js:36`, `createCharacter()` | The race's start zone | Unaffected |
| `engine/character.js:67-69`, `ensureCharacter()` | A missing zone; the `Object.values(ZONES)[0]` fallback | Its Kingdom rule (2.2). The fallback can't pick `kingdoms`, because the Kingdom Zone is registered last |
| `engine/world.js:9, 71, 88` | The current zone; a portal's target; `respawnPoint()` | No town in the Kingdom Zone, so `respawnPoint()` uses the race's home. No fight is possible there anyway |
| `engine/quests.js:50, 72, 80, 97` | The quest board's zones | Excluded already: it has no monsters |
| `main.js:94, 408, 469, 500, 613, 931, 1100, 1605, 1613, 1814` | Names, portals, toasts, the missing-zone check | Names and portals work. `viewMap()` (931) isn't used there: the Map tab draws the plot map (K1-3) |
| `admin.js:227, 248, 337, 452, 499, 1066` | Names in statistics, players, hunts, chat | Names only |
| `admin.js:283` | The hero editor's zone options | Kept, at the gate only, enforced by the server (2.2) |
| `admin.js:433` | The world-boss hunt's zone options | **Left out** (K1-2), and refused by the server |
| `admin-zones.js:172, 264, 369` | The zone editor | Not listed: the editor reads the database's zones |
| `admin/index.ts:157` | The hero editor's location | At the gate only (2.2) |
| `admin/index.ts:305` | `startHunt()` | Refused (2.2) |
| `admin/index.ts:368, 445, 452` | The zone list and restore, from the database and `DEFAULT_ZONES` | Unaffected: the Kingdom Zone isn't in either |
| `admin/index.ts:661` | The zones sent to the console | Sent, so names resolve. The hunt options leave it out (`admin.js:433`) |
| `net.js:259`, `playersAt()` | Who is on a cell | Not called in the Kingdom Zone (K1-3) |

## 5. The scope's K-1 acceptance criteria, traced

| Criterion (scope 9, K-1) | Stage | Proved by |
|---|---|---|
| Two heroes claiming one plot at once: exactly one gets it | K1-2 | API test (local stack) |
| One hero claiming from two tabs: one plot | K1-2 | API test |
| A claim that can't be paid, or whose save would conflict, leaves no plot | K1-1, K1-2 | pgTAP (conflict), engine and API tests (cost) |
| The plot map never renders more than the window; fully usable by keyboard; screen readers get each plot's coordinates and status | K1-3 | Browser tests, axe |
| Deleting a hero frees the plot, and the confirmation says so | K1-1, K1-3 | pgTAP (cascade), browser test (copy) |
| A revoke frees the plot and removes the Kingdom in one transaction, with its audit entry; a failed audit insert changes nothing | K1-1, K1-2 | pgTAP, admin API test |
| A revoke between a `game` read and its save: 409, and the Kingdom isn't written back | K1-2 | API test |
| Claim, release, revoke, reserve and unreserve keep I-1 true, or change nothing; the I-1 check finds nothing after the suite | K1-1, K1-2 | pgTAP, API tests plus the check |
| A retried claim or release changes nothing more | K1-2 | API test |
| Staged rewards: claimed with a claim or release; pending after a failed claim; never delivered twice (#102's case 7) | K1-1, K1-2 | pgTAP, API test |
| The claim dialog is tier 2, focus on Cancel, names the plot, the cost, and that it can't be moved; Cancel sends nothing | K1-3 | Browser test |
| The only way in is the Crossroads portal | K1-2 | Engine tests (validation, dropped portals, the portal's level) |
| Claiming and management are refused outside the Kingdom Zone; elsewhere, the read-only summary | K1-2, K1-3 | API test, browser test |
| In the Kingdom Zone: the hero stays at the gate; no fight, duel or hunt; "Leave the Kingdom Lands" returns to the Overworld | K1-2, K1-3 | Engine and API tests, browser test |
| Moving the plot-map window never changes the hero's location | K1-3 | Browser test (no request sent) |
| With `KINGDOMS_OPEN` off, nothing is reachable, and a hero in the Kingdom Zone is moved out | K1-2, K1-3, K1-4, K1-5 | Engine and browser tests, the admin closed state, Gate C's live checks (the limitation in 2.2) |

**Nothing is added to these criteria.** The stages' own tests support them: the error contract, the grants, the finder, the refund accounting, the location save and the zone readers.

## 6. Evidence for each stage

As for every phase (`CLAUDE.md`):
- the full engine and browser suites, three times;
- `npm run test:db` on the local stack;
- axe with 0 violations;
- for K1-3 and K1-4, screenshots at the usual widths, measured the same way before and after;
- **each regression test is checked to fail on the code before it;**
- a report that states the deviations, and what wasn't verified (real devices, screen readers).

## 7. Not verified by this plan

- **The value of `SUPABASE_URL` inside production's functions.** It rests on Supabase's documentation (section 10), not on observation. The test configuration's guard doesn't depend on it beyond "not `kong`".
- **`supabase functions serve`.** Only `supabase start` was checked, which is what CI uses.
- **Later CLI versions.** The check was on the pinned 2.122.0, and must be repeated when the CLI is upgraded.
- **Rendering cost** of the windowed map and of 10,000 plot rows. Expected small, not measured (scope 11).
- **The finder's query time** on a full table. Expected small for 10,000 cells, measured in K1-1.

## 8. Implementation choices, for review

**Accepted** by the owner on 2026-11-25, subject to the review's qualifications, which are written in here.
1. **The functions' parameters:** separate public columns (`p_name`, `p_level`, `p_zone`, `p_x`, `p_y`), as in `save_hero_with_rewards()`, rather than 5.3.1's `p_public`. The plot is `p_plot_x`, `p_plot_y`.
2. **The database checks `p_data` against I-1:** the claim's plot must match, the release must have no `kingdom`, and null or malformed data is refused (`MRARG`).
3. **The reward claim** is a private helper used only by the new functions. **`save_hero_with_rewards()` isn't changed.**
4. **The revoke's construction refund** is implemented now, exactly as 5.3.1 specifies, with its boundary tests (2.1). No construction can exist in K-1, so it refunds 0. K-2 needn't replace a live `security definer` function.
5. **The check files' names:**
   - `kingdom_verify.sql` for the I-1 check, as the scope names it;
   - `kingdoms_deploy_verify.sql` and `kingdoms_state.sql` for the deployment checks.
6. **Claim and release join `FAST_ACTIONS`,** with the 150 ms floor. Numeric limits stay #78's.
7. **No database trigger** guards `data->'kingdom'` on ordinary saves. The engine test and the I-1 check cover it.
8. **The plot map's data:**
   - **the window:** direct REST reads, under RLS and the column grants;
   - **the finders:** the bounded SQL finder (2.1).

   **The `game` function stays authoritative for claims.**
9. **The gate cell** is `(1, 1)`, a code constant. A hero's location there doesn't make that plot theirs, or unclaimable.

## 9. Owner decisions (ratified 2026-11-25)

1. **Test activation: an isolated local test configuration,** with the bounded feasibility check authorized.
   - The owner preferred an isolated runtime or a test-only payload.
   - An environment override needs a verified local-only guard.
   - Production must not be able to activate test values through an environment variable alone, or through a player request.
   - **The code-reviewed activation stays the only production route.**
   - **The mechanism chosen** is in 2.2. **Its evidence** is in section 10.
2. **Implementation stages: five,** each independently authorized and reviewed: K1-1 the database, K1-2 the engine and both functions, K1-3 the player's interface, K1-4 the administration interface, and K1-5 the rollout procedure.
3. **Production rollout: one coordinated rollout** after K1-1 to K1-4 are accepted and merged, with Kingdoms closed.
   - Every intermediate Netlify publication must work with the deployed functions (section 3).
   - The migration, the `game` deploy, the `admin` deploy and the production verification each keep their own authorized gate.
   - Activation stays separate.
   - **No production operation is authorized** by this decision.
4. **The plot-map window: `PLOT_WINDOW` = 10,** so 100 plots in view, with the Kingdom Zone staying 100 × 100.
   - Moving the window doesn't change the hero's location.
   - Usability, including at 320 px, is evaluated in K1-3.
   - No adaptive sizing or other optimization without a demonstrated need.

## 10. The local feasibility check (2026-11-25)

**What was asked:** the simplest viable way to turn Kingdoms on for the local stack's real functions, isolated from production. It was bounded to that question.

**What was done:**
- **A temporary probe function** (`supabase/functions/zz-envprobe`, never committed) reported selected environment names and `SUPABASE_URL`.
- **A temporary `supabase/functions/.env`** held `KINGDOMS_TEST=1`.
- **The stack was started** with the usual command (`npx supabase start -x …`, CLI 2.122.0), then stopped.
- **Both files were then removed.** The working tree was clean afterwards.

**What it showed:**

| Question | Result |
|---|---|
| Does `supabase start` pass `supabase/functions/.env` to the functions? | **Yes.** The probe saw `KINGDOMS_TEST` = `1` |
| What is `SUPABASE_URL` inside the local runtime? | **`http://kong:8000`** |
| Can `.env` override `SUPABASE_URL` locally? | **No.** The CLI printed "Env name cannot start with SUPABASE_, skipping: SUPABASE_URL", and the probe still saw `http://kong:8000` |
| Can a production secret set `SUPABASE_URL`? | **No, per Supabase's documentation.** The `SUPABASE_` prefix is reserved for the injected values, and the Dashboard and Management API refuse it. `SUPABASE_URL` is the project's own gateway ([Environment variables](https://supabase.com/docs/guides/functions/secrets); [Edge Functions limits](https://supabase.com/docs/guides/functions/limits)) |

**Why this mechanism over the alternatives:**
- **A test-only payload file next to `index.ts`** wouldn't be uploaded by `tools/deploy-functions.mjs`, which sends only `index.ts` and the engine and data files. **But `supabase functions deploy` would bundle it,** so it would fail open under other tooling.
- **A separate test function** has the same problem, and duplicates the `game` function.
- **The local stack is already an isolated runtime.** The guard needs a deliberate variable **and** a gateway that production can't have. So neither a secret alone nor a request can open anything.

**Limitations:**
- **Production's injected value wasn't observed.** It rests on the documentation.
- **`.env` isn't ignored by Git today.** K1-2 adds it to `.gitignore`.
- **The rest:** the ones in section 7.

## 11. The review findings, disposed

| Finding | Disposition | Where |
|---|---|---|
| **K1-B01:** fail-closed test activation | **Resolved.** `KINGDOMS_TEST` **and** a `kong` gateway, fixed test values, an engine test of the guard. Secret names are checked at Gates A and C as the secondary safeguard. Evidence and limits recorded | 2.2, 10, 7 |
| **K1-B02:** dormant-feature compatibility | **Resolved.** One predicate on both sides. The closed contract covers the portal, claim and release, admin movement, admin mutations (refused, with no exception), zone registration (none while closed) and direct reads (allowed; read access isn't gameplay). Every intermediate state is listed | 2.2, 3, 2.4 |
| **K1-B03:** portal integrity | **Resolved.** The reserved id is refused and ignored; portals to `kingdoms` are refused and dropped; there are no portals at the Overworld town cell; the portal follows the Overworld's town; entry needs `CLAIM_MIN_LEVEL`, and unset values mean closed, not open. Gate A checks production's zones | 2.2, 2.5 |
| **K1-B04:** persistent location recovery | **Resolved.** `ensureCharacter()` reports a move. A `state` read then saves through the shared versioned commit path, with R-1 kept. There's no unversioned location write | 2.2 |
| **K1-B05:** plot finders | **Resolved.** `kingdom_free_plot()` in K1-1, used in K1-3. Its grants, argument checks, Chebyshev distance with a `y`-then-`x` tie-break, at most one row, none on a full map, and advisory semantics are specified | 2.1, 2.3 |
| **K1-B06:** accounting and administration | **Resolved.** The revoke returns the refund, which is written to the ledger only after the commit and only above 0, never on failure or retry. Real-stack admin API tests cover authorization and the transactional audit. The shared commit path keeps the version, the public columns, `updated_at`, staging and the ledger rule | 2.1, 2.2 |

## 12. Deviations from the accepted K-0 scope

None changes what players can do or get. Each is for the review to accept.

1. **The Kingdom Zone is registered only while Kingdoms are open** (5.1.1 says `loadZones()` registers it). While closed, a hero found there is still moved to the Crossroads, as 5.1.1 requires, by a rule for the id `kingdoms`. It's the simplest way to keep every `ZONES` reader closed (K1-B02).
2. **The portal is at the Overworld's town cell, wherever the Overworld's row puts it** (5.1.1 says "a code constant, the Crossroads"). Today that is `(4, 4)`, the Crossroads. The town can't be removed, and nothing else may use its cell.
3. **The Kingdom Zone's portal level is `CLAIM_MIN_LEVEL`,** and Kingdoms are closed while it is unset. This follows 5.1, made fail-closed.
4. **The function signatures** (item 8.1), **the I-1 check of `p_data`** (8.2), and **the revoke's returned refund** (K1-B06). 5.3.1's table didn't specify them.
5. **Admin Kingdom mutations are refused while closed.** K-D9's "reserve from the start" means from opening. The activation procedure can open reservation before claiming if the owner wants plots reserved before players can claim.
6. **The finder is a database function** (item 8.8). The scope named the finders, not their mechanism.
7. **A `state` read saves a location correction** (K1-B04). The scope didn't mention persistence. It also applies to heroes whose zone was deleted or resized.

## 13. Tracking

- **#83:** K-1 implementation planning authorized on 2026-11-24, revision 1 on 2026-11-25. **The implementation is not authorized.**
- **#84 (K-2):** unchanged and not authorized.
- **This plan cites #83.** Each stage's PR and report will too.
