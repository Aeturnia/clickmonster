# Kingdoms K-1: implementation plan (#83)

**Status: a plan for independent review. No code, migration or deploy.**
- **Authorized:** the owner authorized the K-1 gate on 2026-11-24, after PR #115's merge, and chose to start with a plan.
- **The implementation is not authorized.** Each stage below needs its own authorization and review gate.
- **The contract** is the accepted K-0 scope, [`docs/kingdoms-scope.md`](kingdoms-scope.md) (PR #101, with amendment 1 in PR #106). The parts K-1 implements are:
  - the Kingdom Zone (5.1, 5.1.1) and the plot map (5.2);
  - ownership (5.3), and the changes that cross the plot and the hero (5.3.1);
  - the claim rules (5.4);
  - the management interface's K-1 part (5.5);
  - integrity and staff tools (5.10), and the guaranteed audit entries (5.11);
  - section 8's K-1 phase, and section 9's K-1 criteria.
- **Nothing here reopens a decision:** no K-D decision, no owner answer, and none of section 12's implementation clarifications. Questions 2, 4, 13 and 14 are implemented as the scope writes them. Question 11 concerns construction, which is K-2's.
- **What is new here:** how the work is split, built, tested and deployed. Where that needs a choice, the choice is listed for review (section 8) or for the owner (section 9).
- **Read at `main` `09eee7f`** (2026-11-24). Line references are from that commit.
- **The prerequisite, #102, is closed** (2026-11-24). K-1's claim and release extend its rule R-1: a write of a hero's `data` claims that request's staged reward ids in the same transaction.

## 1. What K-1 delivers, and what it doesn't

**Delivered** (scope 8, item 2):
- **The database:**
  - the `kingdom_plots` table;
  - the functions `kingdom_claim()`, `kingdom_release()`, `kingdom_revoke()`, `kingdom_reserve()` and `kingdom_unreserve()`;
  - the I-1 check.
- **The game:**
  - the Kingdom Zone, reached only by the Crossroads portal;
  - the windowed plot map, with "My Kingdom" and the two free-plot finders;
  - claim (tier 2) and release (tier 1);
  - the Hero tab's Kingdom section: the read-only summary outside the Kingdom Zone, and "Manage my Kingdom" inside it, opening an empty management view.
- **The admin console:** finding a plot or an owner, and revoking, reserving and unreserving plots.

**It ships switched off.** `KINGDOMS_OPEN` is false when merged and deployed. While it's off:
- the portal isn't added;
- claims are refused;
- the Hero tab shows no Kingdom section;
- a hero found in the Kingdom Zone is moved to the Crossroads (5.1.1).

**Not in K-1:**
- resources, materials, buildings, construction, production and the resource ledger (K-2, #84);
- **any live value:** `CLAIM_MIN_LEVEL` and `CLAIM_COST` stay unset. Claims are refused while either is unset, even with the switch on;
- **activation:** setting the values and turning `KINGDOMS_OPEN` on are the K-1 activation gate (scope 8), each in its own reviewed PR with the owner's authorization;
- #85 (sieges), #86 (the numbers), #87, #95 and #105.

## 2. Stages

Each stage is one branch and one PR. Each has its own authorization, independent review, CI, and an entry in a K-1 report (`docs/kingdoms-k1-report.md`). The order is the order of dependency.

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
- **The functions:** each is `security definer`, with `set search_path = public`. Execute is revoked from PUBLIC, `anon` and `authenticated`, and granted to `service_role`, as for `save_hero_with_rewards()`.
  - **Each follows 5.3.1's table,** in its order, as one transaction.
  - **`kingdom_claim()` and `kingdom_release()`** claim the staged rewards with #102's checks (amendment 1).
  - **`kingdom_revoke()`, `kingdom_reserve()` and `kingdom_unreserve()`** each insert their `admin_log` row inside the transaction (5.11: guaranteed).
- **The error contract.** Each error has a fixed SQLSTATE and message, so the functions can tell them apart (as in #102's stage 1):

  | SQLSTATE | Message | When | The player or staff sees |
  |---|---|---|---|
  | `MRPLT` | `plot_taken` | The plot is claimed or reserved (the primary key) | 409, "That plot was just taken." |
  | `MRHAS` | `has_kingdom` | The hero already has a plot (the unique `character_id`) | 409, "You already have a Kingdom." |
  | `MRNOP` | `no_plot` | Release, revoke or unreserve find no matching plot | 409, "You don't have a Kingdom." (game), or "That plot isn't claimed." / "That plot isn't reserved." (admin) |
  | `MRREW` | `rewards_conflict` | A staged reward is claimed already, another hero's, or missing | 409, "Your hero was busy — try again." |
  | `MRVER` | `version_conflict` | The hero's version has changed | 409, "Your hero was busy — try again." |
  | `MRARG` | `bad_arguments` | A malformed call (8.2) | 500. It's a bug, never a player error |

  - **The unique violations are caught inside the function** and re-raised by constraint name, so `23505` never reaches the `game` function.

**Also in K1-1:**
- **pgTAP,** `supabase/tests/kingdoms.test.sql`:
  - the table, the constraints, the CHECK, RLS and the column grants;
  - **each function, all or nothing:** success; each error; a reward conflict; a stale version;
  - a forced `admin_log` failure on revoke, reserve and unreserve, which changes nothing;
  - deleting a hero frees the plot.
  - **Concurrency isn't tested in pgTAP.** It's tested through the `game` function in K1-2.
- **Checks** in `supabase/checks/`, read-only:
  - `kingdoms_precheck.sql`, `kingdoms_verify.sql` and `kingdoms_state.sql`, the same pattern as #102's;
  - the I-1 check (5.3.1). Its name is item 8.5.
- **Rollback:** `supabase/rollback/<version>_kingdoms_down.sql`.
- **Nothing calls the functions** until K1-2.

### 2.2 K1-2: the engine and the two functions

**The engine** (shared, so it is also published to the site on merge; section 3):
- **`public/js/engine/kingdom.js`, new:**
  - **the constants:** `KINGDOMS_OPEN = false`, `KINGDOM_SIZE = 100`, `CLAIM_MIN_LEVEL = null`, `CLAIM_COST = null`, and the gate cell;
  - **the rules:**
    - can claim: the switch, both values set, the level, the gold, in the Kingdom Zone, no Kingdom yet;
    - apply a claim: spend the gold, set `data.kingdom = { plot: { x, y }, claimedAt }`;
    - apply a release: remove `data.kingdom`;
  - **every rule takes its values as arguments,** so tests pass explicit test values that never ship.
- **`public/js/data/zones.js`:** the Kingdom Zone's definition, registered by `loadZones()` after the database's zones, under the reserved id `kingdoms` (5.1.1).
  - `compileZone()` adds the Crossroads portal only while the switch is on.
  - The Crossroads is `(4, 4)` on the Overworld (`zones.js:213`). It is also the town and the Overworld's entry, and no zone's path uses it today.
- **`public/js/engine/zone-validate.js`:** `validateZone()` refuses the id `kingdoms`, and an Overworld position at the Crossroads (5.1.1).
- **`public/js/engine/world.js`:** `move()` and `walkTo()` are refused in the Kingdom Zone ("Choose plots on the plot map."). `monstersHere()` already returns none for a zone without monsters.
- **`public/js/engine/character.js`:** `ensureCharacter()`:
  - moves a hero in the Kingdom Zone, but not at the gate, to the gate;
  - with the switch off, moves the hero to the Crossroads;
  - never changes `data.kingdom`.

**The `game` function:**
- **One commit path.** `saveRow()`'s steps move into one helper, used by `saveRow()`, the claim and the release:
  - finish staging;
  - call the right function: `save_hero_with_rewards()`, `kingdom_claim()`, `kingdom_release()`, or the plain versioned update;
  - map the errors (2.1's table);
  - flush the ledger after the commit.

  So R-1 can't drift between the three paths. **A request commits once.**
- **The actions** `kingdomClaim` and `kingdomRelease` (names from 5.10):
  - **checked by the engine** in the request, including K-D12: in the Kingdom Zone, outside a fight;
  - **committed** through the helper;
  - **the claim's gold** is queued for the gold ledger under a new `kingdom` source (5.11);
  - **added to `FAST_ACTIONS`** (item 8.6).
- **Nothing else changes `data.kingdom`.** An engine test checks that no ordinary action adds or removes it (5.3.1).

**The `admin` function:**
- **`startHunt()` refuses the Kingdom Zone** (5.1.1).
- **The hero editor:**
  - moves a hero to the Kingdom Zone only at the gate;
  - can't add or remove `data.kingdom`, or move its plot (5.10). It saves the `data` it read, version-checked, as today.
- **New actions,** admin only (`requireAdmin`):
  - find a plot, or an owner by hero name;
  - see a Kingdom;
  - `kingdomRevoke`, `kingdomReserve` and `kingdomUnreserve`, each through its function.

**Every reader of `ZONES` and `ZONE_DEFS`** is checked in this stage. The table is in section 4.

**Tests:**
- **Engine tests** (Node) for `kingdom.js`, the zone rules and `ensureCharacter()`.
- **API tests,** `tests/db/kingdoms-api.test.mjs`, through the real functions on the local stack:
  - **concurrency:** two heroes claiming one plot at once; one hero claiming twice at once;
  - a stale version;
  - **a revoke between a `game` read and its save:** 409, and the Kingdom isn't written back;
  - staged rewards with a claim and with a release (#102's case 7);
  - a failed claim leaves the rewards pending;
  - retried claims and releases;
  - refusals outside the Kingdom Zone, with the switch off, and with the values unset;
  - **the I-1 check** after the suite: no exceptions.
- **How these tests turn the switch on** is decision 9.1.

### 2.3 K1-3: the player's interface

- **The plot map,** in a new module (`public/js/kingdom-ui.js`), so `main.js` (1,900 lines) doesn't grow much (5.2):
  - a window of `PLOT_WINDOW` × `PLOT_WINDOW` cells (decision 9.4), with controls to move it by a window or a row, and to jump to coordinates;
  - "My Kingdom", "Nearest free plot" and "Random free plot";
  - a list of the plots in view;
  - roving focus and arrow keys, as on today's map. Moving past the window's edge moves the window;
  - **each plot's label:** its coordinates, then "Free", "Reserved", or "Claimed by" and the owner's hero name (K-D4);
  - **where its data comes from:** item 8.8.
- **The tabs in the Kingdom Zone** (5.1.1):
  - **Map** shows the plot map;
  - **Explore** shows the zone's description, "Leave the Kingdom Lands", and "Manage my Kingdom" or the claim prompt;
  - **the players list isn't shown** there.
- **The Hero tab's Kingdom section** (5.5, K-1 part):
  - **outside the Kingdom Zone:** the plot, and "Travel to the Kingdom Lands to manage it". Without a plot, a line pointing to the Kingdom Lands, with the claim requirements;
  - **inside it:** "Manage my Kingdom", opening the management view with the Kingdom's name (the hero's) and its plot, and nothing else yet.
- **Claiming:** tier 2, a `confirm.js` dialog with focus on Cancel. It names the plot by its coordinates, gives the cost, and says the Kingdom can't be moved (question 7). Cancelling sends nothing.
- **Releasing:** tier 1, type the name (K-D5).
- **Deleting a hero:** the existing confirmation (`main.js`, the delete sheet) gains a line naming the Kingdom it destroys (K-D7). That changes existing copy, and the text is reviewed in this stage.
- **The existing patterns:**
  - pending keys `kingdom:<op>`;
  - focus kept across re-renders;
  - polite announcements;
  - per-account state in `freshUi()`;
  - every request records `gameGen` and checks `live(g)`.
- **The fake backend** (`tests/ui/harness.mjs`) learns the two actions, the plot reads, and the switch.
- **Browser tests** (section 9 of the scope):
  - the plot map by keyboard and touch;
  - claiming, a version conflict, and account isolation;
  - phones at 320 px, phone landscape (with #95 in mind), and desktop;
  - **axe with 0 violations** of any impact.

### 2.4 K1-4: the admin console

- **A Kingdoms section** in its own module (`public/js/admin-kingdoms.js`):
  - find a plot or an owner;
  - see a Kingdom;
  - revoke (tier 1, type the name);
  - reserve and unreserve.
- **Single flight,** as every admin mutation (`CLAUDE.md`): pending keys `kingdom:<x>,<y>:<op>`.
- **Tests:** admin browser tests at the five widths (`tools/admin-shots.mjs`), and the fake backend's audit entries.
- **Why it's separate from K1-3:** decision 9.2.

### 2.5 K1-5: the production rollout procedure

**A written procedure for review,** like #102's (PR #109), before anything is done:
- **Gate A:** a read-only inspection:
  - the functions' versions and `ezbr_sha256`;
  - the migration history;
  - the precheck;
  - **the names (not the values) of the functions' secrets,** for decision 9.1.
- **Gate B:** the migration, then its verify and state checks, and the I-1 check.
- **Gate C:** the `game` and `admin` deploys.
  - **Each from a pinned LF checkout,** with `tools/function-payload.mjs`.
  - **`admin` has been v8 since 2026-11-14.** This is its first redeploy since then, so it gets its own payload check and its own rollback pin.
- **The live checks, with the switch off:**
  - nothing of Kingdoms is reachable;
  - ordinary play is unchanged: the smoke check;
  - the I-1 check finds nothing.
- **Each gate needs the owner's authorization.**

**Activation is not part of the rollout.** It is its own gate (scope 8).

## 3. What is live at each step

**Netlify publishes `public/` on merge,** including the shared engine, before any function is deployed. So each merge is live on the site at once, and the server catches up only at Gate C.

| After | The site | The server | Effect for players |
|---|---|---|---|
| K1-1 merge | Unchanged | Unchanged | None. The migration is a file |
| K1-2 merge | The engine knows the Kingdom Zone. The switch is off, so no portal | `game` v15 and `admin` v8, unchanged | None. The client draws no Kingdom. The admin console's zone lists leave the Kingdom Zone out (section 4) |
| K1-3 and K1-4 merges | The interface is there, hidden while the switch is off | Unchanged | None |
| Gate B | Unchanged | The table and functions exist. Nothing calls them | None |
| Gate C | Unchanged | `game` and `admin` know the Kingdom Zone and the actions, and refuse them while the switch is off | None |
| Activation (not K-1) | The switch on, in a reviewed PR | The same PR, redeployed | Kingdoms open |

**Turning the switch on is a code change in both places.** It needs a reviewed PR, the site's publication, and a redeploy of both functions, in an order its own procedure sets out.

## 4. Every reader of `ZONES` and `ZONE_DEFS`

Registering a zone in code reaches every caller (grep at `09eee7f`):

| Where | Use | With `kingdoms` |
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
| A revoke frees the plot and removes the Kingdom in one transaction, with its audit entry; a failed audit insert changes nothing | K1-1 | pgTAP |
| A revoke between a `game` read and its save: 409, and the Kingdom isn't written back | K1-2 | API test |
| Claim, release, revoke, reserve and unreserve keep I-1 true, or change nothing; the I-1 check finds nothing after the suite | K1-1, K1-2 | pgTAP, API test plus the check |
| A retried claim or release changes nothing more | K1-2 | API test |
| Staged rewards: claimed with a claim or release; pending after a failed claim; never delivered twice (#102's case 7) | K1-1, K1-2 | pgTAP, API test |
| The claim dialog is tier 2, focus on Cancel, names the plot, the cost, and that it can't be moved; Cancel sends nothing | K1-3 | Browser test |
| The only way in is the Crossroads portal | K1-2 | Engine test |
| Claiming and management are refused outside the Kingdom Zone; elsewhere, the read-only summary | K1-2, K1-3 | API test, browser test |
| In the Kingdom Zone: the hero stays at the gate; no fight, duel or hunt; "Leave the Kingdom Lands" returns to the Overworld | K1-2, K1-3 | Engine and API tests, browser test |
| Moving the plot-map window never changes the hero's location | K1-3 | Browser test (no request sent) |
| With `KINGDOMS_OPEN` off, nothing is reachable, and a hero in the Kingdom Zone is moved out | K1-2, K1-3 | Engine, API and browser tests |

**Nothing is added to these criteria.** The stages' own tests (the error contract, the grants, the zone readers) support them.

## 6. Evidence for each stage

As for every phase (`CLAUDE.md`):
- the full engine and browser suites, three times;
- `npm run test:db` on the local stack;
- axe with 0 violations;
- for K1-3 and K1-4, screenshots at the usual widths, measured the same way before and after;
- **each regression test is checked to fail on the code before it;**
- a report that states the deviations, and what wasn't verified (real devices, screen readers).

## 7. Not verified by this plan

- **How the local stack's edge runtime receives environment variables** (decision 9.1). This must be checked in K1-2 before relying on it: what `supabase start` passes to the functions, compared with `supabase functions serve --env-file`. The pinned CLI is 2.122.0.
- **Rendering cost** of the windowed map and of 10,000 plot rows. Expected small, not measured (scope 11).
- **The query behind "nearest free plot"** on a full table (item 8.8).

## 8. Implementation choices, for review

Each has a recommendation. None changes what players can do.

1. **The functions' parameters.** **Recommended:** the public columns as separate parameters (`p_name`, `p_level`, `p_zone`, `p_x`, `p_y`), as in `save_hero_with_rewards()`, rather than 5.3.1's `p_public`. The plot's coordinates would be `p_plot_x` and `p_plot_y`.
2. **The database checks `p_data` against I-1.** **Recommended:** the claim raises `MRARG` unless `p_data->'kingdom'->'plot'` equals the plot claimed, and the release raises it if `p_data` still has a `kingdom`. That's the same invariant, checked where it is committed.
3. **The reward claim inside the new functions.** **Recommended:** a private helper used only by them. **`save_hero_with_rewards()`, live since 2026-11-24, isn't changed.**
4. **The revoke's construction refund** (question 9). **Recommended:** implement it now, exactly as 5.3.1 specifies, tested in pgTAP with fixture data.
   - No construction can exist in K-1, so it refunds 0.
   - It means K-2 doesn't need to replace a live `security definer` function.
5. **The check files' names.** **Recommended:** keep `kingdom_verify.sql` for the I-1 check, as the scope names it. Name the deployment checks `kingdoms_deploy_verify.sql` and `kingdoms_state.sql`, so the two "verify" files can't be confused.
6. **Claim and release in `FAST_ACTIONS`**, with the 150 ms floor. **Recommended:** yes, as 5.10 recommends. Numeric limits stay #78's.
7. **A database trigger** refusing any change to `data->'kingdom'` outside the five functions. **Recommended:** not in K-1.
   - The scope relies on the engine test and the I-1 check.
   - A trigger would also apply to every ordinary save.
   - It could be its own proposal later.
8. **The plot map's data:**
   - **The window:** the client reads `kingdom_plots` for the window's cells through the REST API (RLS and column grants), and the owners' names from `characters`' public columns.
   - **The finders:** a read-only SQL function for "nearest free plot" and "random free plot", callable by `authenticated`.

   **Recommended:** both as described, and the `game` function stays authoritative for claims. Alternative: both reads as `game` actions.
9. **The gate cell.** **Recommended:** `(1, 1)` in the Kingdom Zone, as a code constant. A hero's location there doesn't make the plot at `(1, 1)` theirs or unclaimable.

## 9. Decisions for the owner

One at a time, before K1-1 starts. Each has a recommendation.

1. **How tests turn Kingdoms on.** The API tests run through the real `game` function, so with `KINGDOMS_OPEN` false in code they can't exercise a claim.
   - **A. A test-only environment variable** (for example `KINGDOMS_TEST`). It turns the switch on and supplies test values, on the local stack only. It's set for CI's database job.
     - **The guard:** production never has it. Gate A and Gate C check the functions' secret names (never values) to show it's absent.
     - **Claims are still refused** while the shipped values are unset.
     - **Recommended,** subject to the check in section 7.
   - **B. The browser harness rewrites the constant,** as `recoveryRequestsOn()` does for `RECOVERY_REQUESTS`. That covers the browser tests only, not the API tests, so it isn't enough alone. It is used for the browser tests in any case.
   - **C. The switch and values in a database row.** **Not recommended:** activation would become a data change, not the reviewed PR that section 8 of the scope requires.
2. **The stages.** **Recommended:** five PRs (K1-1 to K1-5), each reviewed. The alternative is to join K1-3 and K1-4 into one interface PR, which means fewer reviews but a larger diff.
3. **When production gets K-1.** **Recommended:** one rollout after K1-1 to K1-4 are merged, with the switch off, as for #102. The alternative is a migration after K1-1 and the functions after K1-2, which puts dormant code in production earlier.
4. **`PLOT_WINDOW`**, an interface value due before K-1's implementation (scope 7). **Recommended:** 10 × 10, the scope's example. It's checked at 320 px in K1-3, and can change in its review.

## 10. Tracking

- **#83:** K-1 implementation planning authorized on 2026-11-24. The implementation is not authorized.
- **#84 (K-2):** unchanged and not authorized.
- **This plan cites #83.** Each stage's PR and report will too.
