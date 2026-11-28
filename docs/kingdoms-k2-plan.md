# Kingdoms K-2: implementation plan (#84)

**Status: draft, for independent review. No code, migration or deploy.**
- **Authorized:** the owner authorized this plan on 2026-11-27, after K-1 closed (#83).
- **The implementation is not authorized.** Each stage below needs its own authorization and review gate, as in K-1.
- **The contract** is the accepted K-0 scope, [`docs/kingdoms-scope.md`](kingdoms-scope.md) (PR #101, with amendment 1 in PR #106). The parts K-2 implements are:
  - resources (5.6);
  - materials from monsters (5.7), a game-rule change;
  - buildings and timed construction (5.8);
  - production and settlement (5.9);
  - the management interface's K-2 part (5.5);
  - the admin console's corrections (5.10);
  - the resource ledger (5.11);
  - section 8's K-2 phase, and section 9's K-2 criteria.
- **K-1 as built** is the foundation ([`docs/kingdoms-k1-report.md`](kingdoms-k1-report.md)). It has been in production since 2026-11-27, closed: `game` v16, `admin` v9, and the empty `kingdom_plots` table and its functions.
- **Nothing here reopens a decision:** no K-D decision, and no owner answer. Scope question 11 (release refused during a construction) and question 12 (stock above a cap) are implemented as the scope writes them.
- **Read at `main` `aecc3d7`** (2026-11-27).

## 1. What K-2 delivers, and what it doesn't

**Delivers, dormant:** everything below ships behind a second release switch, **`KINGDOM_ECONOMY`, off** (scope 8). While it's off:
- there is no material roll;
- there is no production;
- construction is refused;
- the management view says the Kingdom's economy isn't open yet.

**The parts:**
- **The economy's parameters,** as named constants in one module **with no live values** (scope 7 and 8). Tests use explicit test values that never ship.
- **The material drop:** a separate roll on ordinary kills, for plot owners only, with the variant factor and a new `materials` multiplier. **World-boss hunts give no materials** (scope 5.7).
- **The Kingdom's economic state** in `characters.data.kingdom`: the stock, the building levels, the production remainders, the settlement clock, and the construction.
- **Settlement, `settle(kingdom, now)`,** exactly as scope 5.9 sets out, with its path-independence property test.
- **Timed construction:**
  - start and cancel;
  - one at a time;
  - a cancel refunds in full;
  - the Kingdom Zone only;
  - safe to retry.
- **Release refused while a construction is under way** (scope question 11).
- **The ledgers:**
  - **the resource ledger:** a new table and function, best effort, with daily totals (5.11);
  - **the gold ledger's `kingdom` source:** for building costs and cancel refunds.
- **The management view** (5.5), the Hero tab's summary, and the battle log's material line.
- **The admin console:** a Kingdom's economy on its plot record, and the hero editor's corrections of stock and building levels through the versioned save (5.10).
- **The rollout procedure,** like K1-5's.

**Doesn't:**
- **the numbers.** Every parameter marked "K-2 activation" in scope 7 is set later: by #86's simulations, then K-3's reviewed PR;
- **turning on either switch:** K-1 activation or K-2 activation;
- trading (K-D15);
- hero-benefit buildings (K-D17);
- an inactivity policy (K-D10);
- the full-map policy (K-D9).

## 2. The design, against the code as built

### 2.1 The parameters and the switch: `public/js/data/kingdom-economy.js` (new)

- **`KINGDOM_ECONOMY = false`,** as `KINGDOMS_OPEN` is in `data/kingdoms.js`.
- **The parameters, every one `null`:**

  | Parameter | Shape |
  |---|---|
  | `MATERIAL_CHANCE` | a probability per kill, or per-level |
  | `MATERIAL_VARIANT_EFFECT` | a factor, or the variant's `drop` |
  | `MATERIAL_AMOUNT` | per monster level |
  | `MATERIAL_CAP` | a number, or none |
  | `BUILD_COST`, `BUILD_TIME`, `OUTPUT` | per kind and level |
  | `STORAGE_CAP` | per resource and storehouse level |
  | `MAX_BUILDING_LEVEL` | a number, or none |

- **The one predicate, `economyOpen()`,** is true only when all of these hold:
  - Kingdoms are open (`kingdomsOpen()`): an economy can't run without ownership;
  - `KINGDOM_ECONOMY` is true;
  - **every parameter is set.**

  So no rule ever runs on an undefined value (scope 8).
- **The test configuration** follows K-1's (plan 2.2, decision 9.1). `testConfigFrom()` extends to the economy, with explicit test values. **They apply only together with `KINGDOMS_TEST=1` and the local gateway (`kong`)**, which production can't have.
- **The curves' representation** (owner decision OD-3):
  - **proposed:** per-level tables, so `BUILD_COST.mine[level]` and so on;
  - **`MAX_BUILDING_LEVEL`** is then each table's length;
  - **why:** simulations can feed any table, and a reviewer reads the exact numbers. Formulas would be shorter to write, and harder to audit.

### 2.2 The state, in `characters.data.kingdom`

| Field | Contents |
|---|---|
| `plot`, `claimedAt` | K-1's, unchanged |
| `stock` | `{ ore, food, wood, material }`, whole numbers |
| `levels` | `{ mine, farm, woodcutter, storehouse }`, from 0 |
| `rem` | `{ ore, food, wood }`: the production remainders (5.9) |
| `clock` | server milliseconds, settled up to |
| `construction` | `null`, or `{ building, toLevel, startedAt, finishAt, paid: { gold, ore, food, wood, material } }` |

- **`construction.finishAt` and `construction.paid.gold` are already a contract.** K1-1's `kingdom_revoke()` reads exactly those fields to refund a construction's gold (`supabase/migrations/20261125120000_kingdoms.sql`). It is refused with `MRARG` if they're malformed. **K-2 writes exactly that shape.**
- **Checked against the SQL as built, read-only (2026-11-27):** the extra fields need no database change.
  - **`kingdom_verify.sql` (I-1)** checks only that `data.kingdom` is an object, and that its `plot` matches the claimed plot. Extra keys pass.
  - **`kingdom_claim()`** checks the same, on `p_data`.
  - **`kingdom_release()`** requires no `kingdom` key.
  - **`kingdom_revoke()`** reads only `construction.finishAt` and `construction.paid.gold`, and removes `kingdom` whole, so the stock and buildings are forfeited, as scope 5.4 says.
- **A Kingdom without economic fields** (any K-1 claim) reads as zero stock, all levels 0, no construction. **Its clock starts at the first settlement while the economy is open.** Every level is 0 until something is built, so no production can be owed for the time before.
- **The engine validates the shape on every settlement,** and refuses a malformed Kingdom rather than repair it. That's the same rule as K-1's I-1.

### 2.3 Settlement and construction: `public/js/engine/kingdom-economy.js` (new)

**`settle(kingdom, now, params)`:** scope 5.9's six steps, exactly.
- **Integers only,** with H = 3,600,000.
- **The cap rules:** time at the cap isn't banked, and a stock above its cap is kept but doesn't accrue.
- **A construction's finish splits the interval at `finishAt`.**
- **`now <= clock`** changes nothing.
- **Safe integers throughout:** an interval may be cut short at the time the stock reaches its cap, which changes no result.

**`startConstruction(char, building, fromLevel, now)`** refuses:
- unless the economy is open, the hero is in the Kingdom Zone and outside a fight;
- unless the building is one of the four;
- if `fromLevel` isn't the building's current level (a retried or doubled start: one start, one charge);
- if a construction is under way;
- at `MAX_BUILDING_LEVEL`;
- if the resources or gold aren't enough.

**What it does:** settle first, then pay, recording `paid`, and set `finishAt = now + BUILD_TIME`.

**`cancelConstruction(char, startedAt, now)`:**
- **It settles first.** A construction with `finishAt <= now` has finished, so the cancel is refused ("That construction has already finished.").
- **`startedAt` must match.** A doubled cancel refunds once.
- **The refund is exactly `paid`.** Refunded stock above a cap is kept.

**`releaseKingdom()`** gains question 11's refusal: **while a construction is under way, release is refused,** and the player cancels it first, for the full refund.

**Gold** (owner decision OD-2):
- **proposed:** a building's gold is paid from **carried gold,** as the claim is (ratified in K1-2);
- **a cancel refunds to carried gold.**

### 2.4 The material drop: `public/js/engine/battle.js`

`rollLoot()` gains **a separate roll,** after the gem and relic roll, which is unchanged.

**Only when all of these hold:**
- the economy is open;
- the hero has a Kingdom;
- the fight is an ordinary kill.

**The roll:**
- **the chance:** `MATERIAL_CHANCE(level) × variant effect × mult('materials')`;
- **the amount:** `MATERIAL_AMOUNT(level)`, up to `MATERIAL_CAP` if set;
- **the log line,** with "storage full" when the cap stops it.

**Hunts never reach it** (`hunt.js` has its own exchange). That is tested anyway.

**`MULT_KEYS` gains `materials`** (`engine/world-config.js`, label "Kingdom materials").
- An existing configuration without it reads as 1.
- The admin console's multiplier forms are drawn from `MULT_KEYS`, so they gain the field. **Owner decision OD-5:** show it now, saying it has no effect until the economy opens, or hide it until then.

**`rollLoot()` doesn't take the hero today.** `battleAction()` passes it, or a flag. This is the only change to an existing engine signature.

### 2.5 The `game` function

**Settlement runs once per request, before the action, with the request's single `now`,** next to `applyRegen()` (`index.ts`, `handle()`). That covers state reads and actions alike.
- **A `state` read settles for its reply,** but saves only when it already would. Scope 5.9 shows this changes no later result: settlement is path-independent.

**`kingdomStart { building, fromLevel }`** and **`kingdomCancel { startedAt }`:**
- **They use the ordinary versioned save** through `commitRow()`. Only claim and release go through the Postgres functions (K1-2).
- **They are refused outside the Kingdom Zone,** and while the economy is closed.
- **They join `FAST_ACTIONS`,** with its 150 ms floor, as scope 5.10 recommends and as claim and release did (K-1 plan, choice 6).

**A kill's material** is saved with the hero, as gold is.

**The ledgers, after the save commits,** best effort (5.11):
- **the resource ledger:** the request's resource changes, measured from the state as loaded, before settlement. Production is recorded by the next save, as 5.11 explains;
- **the gold ledger:** under `kingdom`, building costs negative and cancel refunds positive.

**Release and claim** go through `kingdom_release()` and `kingdom_claim()` unchanged. Release settles first, then refuses during a construction.

### 2.6 The database: one migration (K2-1)

**A `resource_ledger` table and a `resource_ledger_add()` function,** following the gold ledger (`20261113150000_world_hunts_ledger.sql`):
- **the table:** day, source, resource, amount and count, as daily totals;
- **the function:** service role only;
- **reads:** none for players; the admin console reads it through `admin`.

**Kept unchanged:**
- **`kingdom_revoke()`** already refunds a construction's gold, and has its boundary tests (K1-1);
- **`kingdom_claim()` and `kingdom_release()`;**
- **`save_hero_with_rewards()`** (R-1).

**The checks:**
- `resource_ledger` precheck and verify files;
- a rollback file;
- pgTAP for the grants and the function.

### 2.7 The player's interface (K2-3)

**The management view** (5.5, in the existing sheet). It shows:
- the stock with each cap;
- the four buildings: level, output, and the next level's cost and time;
- the construction under way, with when it finishes and Cancel;
- **Build or Upgrade, with the price on the button.**
  - These are tier 4, as priced actions are (`CLAUDE.md`, confirmations).
  - They're unavailable, with the reason, during a construction.
- **Cancel is tier 3:** a normal question. It refunds in full and loses nothing.
- **Pending keys:** `kingdom:<building>:<op>`.

**The Hero tab's summary** outside the Kingdom Zone:
- the stock and the levels;
- any construction, with when it finishes;
- no Cancel (question 5).

**The battle:**
- the log's material line;
- the outcome card lists the material, as it lists a gem.

**The clock shown is the server's.** Progress is computed from `finishAt` and the server time the reply carries, never from the device's clock alone.

### 2.8 The admin console (K2-4)

- **A Kingdom's economy on its plot record:** the stock, the levels and the construction.
- **The hero editor's corrections** (5.10): stock and building levels, through the existing versioned `update`, with its audit entry.
  - **These are best effort,** like every hero edit (5.11; #80).
  - **The editor can't add or remove a Kingdom, move its plot, or write a construction** (I-1 and the revoke's contract).
  - **A corrected stock above its cap** follows 5.9's rule.
  - **The building a construction is raising can't have its level corrected** while that construction is under way. Its `toLevel` would no longer follow. The editor refuses it, with the reason.
- **The `materials` multiplier** in Events and rates (OD-5).

### 2.9 What is live while closed, and the publish order

**Netlify publishes `public/` on each merge,** long before K2-5 deploys the functions. Every state in between must work with the functions then deployed, as in K-1 (its plan, section 3).

**While `KINGDOM_ECONOMY` is off:**

| Part | While off |
|---|---|
| **The material roll** (engine, client and `game`) | Never runs. Loot is exactly as today |
| **Settlement** | Never runs. A Kingdom's economic fields aren't written |
| **`kingdomStart` and `kingdomCancel`** | Refused: "The Kingdom's economy isn't open yet." The client doesn't send them |
| **The management view** | Says the economy isn't open yet. No stock, buildings or buttons |
| **The `materials` multiplier** | The console may show it (OD-5). **The players' event banner omits it,** so no event can promise players a material bonus while there are no materials |
| **The resource ledger** (after K2-1) | Exists, empty. Nothing writes it |
| **The hero editor's corrections** | Refused while closed, like the admin Kingdom changes |

**Each merge and gate:**

| After | The site | The server | Effect |
|---|---|---|---|
| **K2-1's merge** | Unchanged | Unchanged | None. The migration is a file |
| **K2-2's merge** | The engine has the economy, off. `MULT_KEYS` has `materials` | `game` v16, `admin` v9 | **None for players:** closed, and the banner omits `materials`. **The console:** `admin` v9's `cleanMults()` iterates its own deployed `MULT_KEYS`, so a `materials` value sent by the newer console is **dropped, not stored.** The console says the multiplier has no effect yet (OD-5) |
| **K2-3 and K2-4's merges** | The interfaces, drawing no economy while off | Unchanged | None |
| **K2-5, Gate B** | Unchanged | The resource-ledger table and function | None. Nothing writes the table |
| **K2-5, Gate C** | Unchanged | `game` and `admin` with the economy, off. `admin` now stores a `materials` multiplier | None for players: the banner still omits it while closed |
| **K-2 activation** (not K-2) | Open, in a reviewed PR, after K-3's numbers | The same PR, redeployed | The economy runs |

**The reverse, a newer function with an older cached client,** is harmless. The older client doesn't know `materials` or the new actions, and the server refuses them while closed anyway.

## 3. Stages

Each stage needs the owner's authorization and an independent review, as in K-1.

1. **K2-1, the database:** the resource-ledger migration, pgTAP, checks and rollback. No production step.
2. **K2-2, the engine and the functions:** the parameter module and switch, `settle()`, construction, the material roll, `MULT_KEYS`, and the `game` and `admin` actions.
   - **Tests:** Node, including the property test; the API tests on the local stack, with the economy's test values; and the fake backend kept in step.
3. **K2-3, the player's interface:** the management view, the Hero tab's summary, and the battle's material line.
   - **Evidence:** browser tests, screens and axe.
4. **K2-4, the admin console:** the economy on the plot record, the editor's corrections, and the multiplier.
5. **K2-5, the rollout:** a procedure for review, then Gates A to C (the migration, then `game` and `admin`), with `KINGDOM_ECONOMY` off.

**Owner decision OD-1:** these five stages, or fewer. K2-1 could fold into K2-2, since the migration is small.

**After K-2 (not part of it):**
- **#86's simulations,** on K-2's deterministic engine functions;
- **K-3,** the numbers, in a reviewed PR;
- **the activation decisions:** K-1's switch, K-2's switch, or both together (scope 8 allows either).

## 4. Owner decisions for this plan

| # | Decision | Proposed |
|---|---|---|
| OD-1 | The stages | Five, as in section 3, mirroring K-1 |
| OD-2 | Where a building's gold comes from | Carried gold, as the claim. A cancel refunds to carried gold |
| OD-3 | How the level curves are written | Per-level tables. `MAX_BUILDING_LEVEL` is their length |
| OD-4 | The resources' names | "Ore", "food", "wood" and a material name to choose. K-D13 calls them placeholders; the names are copy, decided before K2-3 |
| OD-5 | The `materials` multiplier before the economy opens | Shown in the console, saying it has no effect until the economy opens |

## 5. The scope's K-2 acceptance criteria, traced

| Criterion (scope 9, K-2) | Where |
|---|---|
| Production depends only on server time | 2.3, 2.5. Node tests with a moved device clock; the browser shows only server-derived times |
| Production stops at the cap, nothing banked (10 an hour, a cap of 100, 100 hours give 100; spending never releases the rest) | 2.3, Node tests with exactly those numbers |
| Settlement is path-independent | 2.3, the property test |
| A cancel at or after `finishAt` is refused | 2.3, Node and API tests at the boundary |
| A cancel from outside the Kingdom Zone is refused | 2.3, 2.5, the API test |
| Hunts give no materials; a variant raises the chance | 2.4, Node tests with test values |
| A revoke during a construction refunds exactly its gold, with the boundary cases | K1-1's function and pgTAP, unchanged. K2-2 adds an API test with a real construction written by `kingdomStart` |
| A refund above the cap is kept, and accrual pauses | 2.3, Node tests |
| `KINGDOM_ECONOMY` off: no drops, no production, no construction | 2.1, Node, API and browser tests (as K-1's closed-state checks) |
| A doubled start starts once and charges once; a second start is refused | 2.3, 2.5, Node and API tests, including two at once |
| A doubled cancel refunds once, and exactly what was paid | 2.3, 2.5 |
| A construction finishes at its server time, signed in or not, once | 2.3, 2.5 |

## 6. Evidence for each stage

As in K-1:
- **The suites:** the full engine and browser suites, and `npm run test:db` on the local stack.
- **axe:** 0 violations of any impact.
- **Screens:** at the usual widths, before and after.
- **Regression tests** shown to fail on the code before them.
- **Time-limited mutation checks,** for the guards.
- **A report** (`docs/kingdoms-k2-report.md`) stating the deviations, and what wasn't verified.

## 7. Deviations from the accepted K-0 scope

**None in substance.** Clarifications, within the scope's own decisions:
- **The banner leaves out `materials` while the economy is closed** (2.9). The scope doesn't mention event banners. This keeps copy accurate (`CLAUDE.md`: accuracy matters in copy).
- **The editor can't correct the level of a building under construction** (2.8). The scope's corrections (5.10) don't say; this keeps the construction's `toLevel` consistent.
- **The test configuration** extends K-1's decision 9.1 to the economy's test values (2.1).

## 8. Not verified by this plan

- **The economy's balance:** that's #86 and K-3.
- **The arithmetic at extreme values:** the safe-integer bounds are designed in, and tested in K2-2.
- **Real devices and screen readers:** still owed before any activation, as for K-1.
- **#120,** the 120-second zone-edit race: unchanged, tracked and not authorized. K-2 adds no new path that replaces the hero.
