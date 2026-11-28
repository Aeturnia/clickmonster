# Kingdoms K-2: implementation plan (#84)

**Status: revision 1, for independent re-review. No code, migration or deploy.**
- **Authorized:**
  - **the plan:** by the owner on 2026-11-27, after K-1 closed (#83);
  - **this revision:** on 2026-11-27, after the review of `4bc5b9a`.
- **What changed in revision 1:**
  - **the six review findings,** K2-B01 to K2-B06 (section 10);
  - **the owner's ratification** of OD-1 to OD-5, with the review's qualifications (section 4).
- **The implementation is not authorized.** Each stage below needs its own authorization and review gate, as in K-1. **No balancing value is chosen here.**
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
- **Nothing here reopens a K-0 decision.** Scope question 11 (release refused during a construction) and question 12 (stock above a cap) are implemented as the scope writes them.
- **Read at `main` `d1442d4`** (2026-11-27).

## 1. What K-2 delivers, and what it doesn't

**Delivers, dormant:** everything ships behind a second release switch, **`KINGDOM_ECONOMY`, off** (scope 8). While it's off:
- there is no material roll;
- there is no production;
- construction is refused;
- the management view says the Kingdom's economy isn't open yet.

**The parts:**
- **The economy's parameters,** in one module, with a validated schema (2.1) and **no live values**.
- **The material drop:** a separate roll on ordinary kills, for plot owners only, with the variant factor and a `materials` multiplier. **World-boss hunts give no materials.**
- **The Kingdom's economic state** in `characters.data.kingdom` (2.2).
- **Settlement, `settle()`,** exactly as scope 5.9 sets out, with its path-independence property test. **It's defined for every path that saves a hero** (2.5).
- **Timed construction,** bound to the inspected ownership instance and to the construction's own id (2.3):
  - one at a time;
  - a cancel refunds in full;
  - the Kingdom Zone only;
  - safe to retry, and safe against stale confirmations.
- **Release refused while a construction is under way** (question 11).
- **The ledgers:**
  - **the resource ledger:** source-attributed and best effort (2.6);
  - **the gold ledger's `kingdom` source:** for building costs and cancel refunds.
- **The management view,** the Hero tab's summary, and the battle's material line.
- **The admin console:**
  - a settled view of a Kingdom's economy;
  - the hero editor's corrections, settled first;
  - the `materials` multiplier;
  - **all of it behind a capability** (2.8).
- **The rollout procedure,** like K1-5's.

**Doesn't:**
- **the numbers.** These come from #86's simulations, then K-3's reviewed PR. K-3 must also show the economy can be entered from nothing (2.1, "bootstrap");
- **turning on either switch;**
- trading (K-D15);
- hero-benefit buildings (K-D17);
- an inactivity policy (K-D10);
- the full-map policy (K-D9).

## 2. The design, against the code as built

### 2.1 The parameters: `public/js/data/kingdom-economy.js` (new), and their schema (K2-B04)

- **`KINGDOM_ECONOMY = false`,** as `KINGDOMS_OPEN` is in `data/kingdoms.js`.
- **Two distinct "no value" states:**
  - **`null` means unset.** The economy can't open while any parameter is `null`.
  - **`'unlimited'` means deliberately no limit.** It's allowed only for `MATERIAL_CAP`, `STORAGE_CAP` and `MAX_BUILDING_LEVEL`, and never confused with unset.

**The schema.** Every number is a safe integer (`Number.isSafeInteger`) unless stated:

| Parameter | Shape | Domain |
|---|---|---|
| `MATERIAL_CHANCE` | a table by monster level, indexed 1 to 100, or one number | each a probability in [0, 1] (not an integer) |
| `MATERIAL_VARIANT_EFFECT` | `'drop'` (the variant's own `drop` factor), or a number | a number ≥ 1 |
| `MATERIAL_AMOUNT` | a table by monster level, indexed 1 to 100, or one number | ≥ 1 |
| `MATERIAL_CAP` | a number, or `'unlimited'` | ≥ 1 |
| `MAX_BUILDING_LEVEL` | a number, or `'unlimited'` | ≥ 1 |
| `BUILD_COST[kind][L]` | indexed by **the level built to,** L = 1 up to the maximum. Index 0 is never used | each `{ gold, ore, food, wood, material }`, all ≥ 0 |
| `BUILD_TIME[kind][L]` | as `BUILD_COST` | seconds, ≥ 1 |
| `OUTPUT[kind][L]` | for the mine, farm and woodcutter. L = 1 up to the maximum; **level 0 always produces 0,** and isn't in the table | units per hour, ≥ 0 |
| `STORAGE_CAP[resource][S]` | by storehouse level S = 0 up to the maximum (**level 0 included:** an empty Kingdom has caps) | ≥ 1, or `'unlimited'` |

**Rules:**
- **The tables must be complete** up to `MAX_BUILDING_LEVEL`.
- **OD-3's qualification: tables don't fix a finite maximum.** If K-3 chooses `MAX_BUILDING_LEVEL = 'unlimited'`, it must also give a rule for the levels after the last row. That rule's shape is K-3's to define, and the validator refuses `'unlimited'` without it. **Neither choice is made here.**
- **Products stay safe:** `OUTPUT × (t1 − t0)` within one settlement interval must stay within the safe range. Settlement cuts intervals at the cap (scope 5.9), and the validator checks the largest output times a bounded interval. That bound is stated in K2-2's tests.

**Fail closed.** `validateEconomy(params)` returns every problem it finds. **`economyOpen()` is true only when all of these hold:**
- Kingdoms are open;
- `KINGDOM_ECONOMY` is true;
- **the validation finds nothing.**

So the economy stays off when the configuration is incomplete **or malformed:** a wrong type, a missing table row, a value out of its domain, or an unsafe product. **The client and both functions run the same validator,** from the shared module.

**The bootstrap check.** A new Kingdom has zero stock and every level at 0.
- **The validator requires at least one producing building** whose level-1 cost needs only gold and the monster material. Those are the two things a new owner can get, so the economy can be entered from nothing.
- **This is also a K-3 acceptance criterion** (section 5): #86 must show a realistic path into the economy, not just a possible one.

**The test configuration** follows K-1's decision 9.1. Explicit, valid test values apply only with `KINGDOMS_TEST=1` and the local gateway (`kong`), which production can't have.

### 2.2 The state, in `characters.data.kingdom`

| Field | Contents |
|---|---|
| `plot`, `claimedAt` | K-1's, unchanged |
| `stock` | `{ ore, food, wood, material }`, whole numbers |
| `levels` | `{ mine, farm, woodcutter, storehouse }`, from 0 |
| `rem` | `{ ore, food, wood }`: the production remainders (5.9) |
| `clock` | server milliseconds, settled up to |
| `construction` | `null`, or `{ id, building, toLevel, startedAt, finishAt, paid: { gold, ore, food, wood, material } }` |

- **`construction.id`** is a random UUID made by the server when the construction starts (K2-B02). It is the construction's identity. `startedAt` isn't relied on to be unique.
- **`construction.finishAt` and `construction.paid.gold` are already a contract.** K1-1's `kingdom_revoke()` reads exactly those fields to refund a construction's gold. **K-2 writes exactly that shape.** The extra `id` is ignored by it.
- **Checked against the SQL as built (2026-11-27):** the extra fields need no database change.
  - **`kingdom_verify.sql` (I-1)** checks only that `data.kingdom` is an object, and that its `plot` matches.
  - **`kingdom_claim()`** checks the same, on `p_data`.
  - **`kingdom_release()`** requires no `kingdom` key.
  - **`kingdom_revoke()`** reads only `construction.finishAt` and `construction.paid.gold`, and removes `kingdom` whole.
- **A Kingdom without economic fields** (any K-1 claim) reads as zero stock, all levels 0, no construction. **Its clock starts at the first settlement while the economy is open.** Every level is 0 until something is built, so no production can be owed for the time before.
- **The engine validates the shape on every settlement,** and refuses a malformed Kingdom rather than repair it.

### 2.3 Settlement and construction: `public/js/engine/kingdom-economy.js` (new)

**`settle(kingdom, now, params)`:** scope 5.9's six steps, exactly.
- **Integers only,** with H = 3,600,000.
- **The cap rules:** time at the cap isn't banked, and a stock above its cap is kept but doesn't accrue.
- **A construction's finish splits the interval at `finishAt`.**
- **`now <= clock`** changes nothing.
- **It returns the resources it produced, per resource,** for the ledger (2.6).

**Every request names the Kingdom it acts on** (K2-B02). That's the ownership instance (`kingdom_plots.id`, which K1-3's client already reads for release), never replaced by the one the hero holds now. The server checks it against the hero's claimed plot, read in the same request. **A different instance is refused as `plot_changed`, and nothing is sent again.** The client reloads, and the player confirms again.

**`kingdomStart { plotId, building, fromLevel }`** refuses:
- unless the economy is open, the hero is in the Kingdom Zone and outside a fight;
- if `plotId` isn't the hero's current ownership instance (a release and reclaim since the confirmation);
- unless the building is one of the four;
- if `fromLevel` isn't the building's current level (a retried or doubled start: one start, one charge);
- if a construction is under way;
- at `MAX_BUILDING_LEVEL`;
- if the resources or the carried gold aren't enough.

**What it does:** settle first, then pay, recording `paid`, and set a new `id`, `startedAt = now` and `finishAt = now + BUILD_TIME`.

**`kingdomCancel { plotId, constructionId }`:**
- **It checks the ownership instance first,** as for a start.
- **It settles first.** A construction with `finishAt <= now` has finished, so the cancel is refused ("That construction has already finished.").
- **`constructionId` must equal the construction under way.** A stale cancel can never reach a later construction, and a doubled cancel refunds once.
- **The refund is exactly `paid`,** with the gold to carried gold (OD-2). Refunded stock above a cap is kept.

**Why the ownership check holds:**
- The hero's save is versioned, and claim, release and revoke all raise the version.
- **A request whose plot read and hero load disagree** either fails the instance check, or fails its save with 409.
- **It can't act on a newer Kingdom** with an older confirmation.

**`releaseKingdom()`** gains question 11's refusal: **while a construction is under way, release is refused.**

### 2.4 The material drop: `public/js/engine/battle.js`

`rollLoot()` gains **a separate roll,** after the gem and relic roll, which is unchanged.

**Only when all of these hold:**
- the economy is open;
- the hero has a Kingdom;
- the fight is an ordinary kill.

**The roll:**
- **the chance:** `MATERIAL_CHANCE(level) × variant effect × mult('materials')`;
- **the amount:** `MATERIAL_AMOUNT(level)`, up to `MATERIAL_CAP` unless `'unlimited'`;
- **the log line,** with "storage full" when the cap stops it.

**Unchanged** (K2-B06):
- **For every hero without a Kingdom, and for everyone while the economy is closed,** the material roll **doesn't consume a random number.** Their loot is identical, draw for draw, to today's.
- **For owners,** the gem and relic chances, and the one-bonus-drop rule between them, are unchanged. The material is a further, independent draw.
- **Hunts never reach it** (`hunt.js` has its own exchange). That is tested anyway.

**`MULT_KEYS` gains `materials`** (`engine/world-config.js`, label "Kingdom materials"). An existing configuration without it reads as 1. The players' event banner omits it while the economy is closed (2.9).

**`rollLoot()` doesn't take the hero today.** `battleAction()` passes it, or a flag. This is the only change to an existing engine signature.

### 2.5 Every path that saves a hero (K2-B01)

**The rule:** every economic change, whether production, a construction's finish, a cost, a refund, a material or a correction, **is applied to a settled Kingdom,** at the request's single server time `now`. A path that doesn't change the economy **preserves** the economic fields exactly. It doesn't settle, so the stored `clock` is untouched and the next settling path reaches the same numbers (path independence, scope 5.9).

| Path | Settles? | What it does to the economy | Resource ledger (2.6) |
|---|---|---|---|
| **`game`, a player's action** (`handle()`, through `commitRow()`) | **Yes,** once, before the action, beside `applyRegen()` | The action's effects, on the settled state | Production, the action's entries |
| **`game`, a `state` read that saves** (notices, staged rewards, a hunt ended, a location correction) | **Yes,** for the reply, **and the settled state is saved** with the save that was happening anyway | None besides settlement | Production |
| **`game`, a `state` read that doesn't save** | **Yes, for the reply only.** Nothing is saved | None | None. The next save records it (production is recomputed from the stored clock, so nothing is counted twice) |
| **`game`, a kill** (melee or cast) | As an action | The material drop | Production, `material_drop` |
| **`game`, a duel's target** (`attack`: the defender's row is loaded and saved) | **No:** preserved | None. A duel changes only gold and XP | None |
| **`game`, claim** (`kingdom_claim()`) | No. There's no Kingdom yet | The Kingdom starts empty | None |
| **`game`, release** (`kingdom_release()`) | **Yes,** first. Then it's refused if a construction is under way | The Kingdom is removed | Production, then `forfeit_release` (the settled stock) |
| **`game`, deleting a hero** | **Yes,** in memory only, for the ledger | The row is deleted; K-1's cascade frees the plot | `forfeit_delete` (the settled stock), after the delete |
| **`admin`, revoke** (`kingdom_revoke()`) | No: the database function removes the Kingdom whole | Forfeited. The construction's gold refunded (K1-1) | **Not recorded.** The function doesn't return the stock, and the stored stock isn't settled. A documented limitation (2.6) |
| **`admin`, the editor's economic corrections** (stock, building levels) | **Yes, before the correction,** at the admin request's `now`. Without that, the next settlement would apply a corrected level to the whole interval before it | The correction, on the settled state; then the versioned save | Production, then `admin_correction` |
| **`admin`, the editor's other edits** (stats, gold, location, items) | **No:** preserved | None | None |
| **`admin`, the plot record and player view** | **A projection:** settled in memory for display, **never saved** | None | None |

**Two rules the table depends on:**
- **A preserving path writes back the economic fields it loaded, unchanged.** No path edits them partially.
- **A path that settles saves the settled state** in the same versioned save as its own change. If that save fails (409, or a refusal), nothing is saved and nothing is recorded.

### 2.6 The database (K2-1), and the ledger's attribution (K2-B03)

**One migration: a `resource_ledger` table and a `resource_ledger_add()` function,** following the gold ledger (`20261113150000_world_hunts_ledger.sql`):
- **the table:** day, source, resource, amount and count, as daily totals;
- **the function:** service role only;
- **reads:** none for players; the admin console reads it through `admin`, behind the capability (2.8).

**Entries are source-attributed.** Each request collects its resource deltas by source, as they happen, during settlement and the action, rather than one net difference:

| Source | When |
|---|---|
| `production` | each resource settlement adds |
| `material_drop` | a kill's material |
| `construction` | a start's cost, negative |
| `refund` | a cancel's refund, positive |
| `admin_correction` | an editor correction's difference, either sign |
| `forfeit_release`, `forfeit_delete` | the settled stock given up, negative |

**So a request that produces 30 ore and spends 30 records both,** not a net 0.

**When they're written:** only after the hero's save, or the delete, has committed. They're queued as K-1 and #102 queue the gold ledger (`queueLedger()`).
- **A failed or refused save records nothing.**
- **A ledger write that fails after a commit** is logged, and lost.
- **So the ledger can undercount, never overcount** (5.11, the owner's question 10).

**Not recorded, and stated as limits:**
- **a revoke's forfeited stock** (2.5);
- **production that accrues and is then forfeited by a revoke** before any save.

**The ledger is statistics for #86 and staff. It doesn't reconcile the economy, and never claims to.**

**The gold ledger's `kingdom` source:** a start's gold, negative, and a cancel's refund, positive, under the same commit rule.

**Kept unchanged:**
- **`kingdom_revoke()`** already refunds a construction's gold, with its boundary tests (K1-1);
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
  - These are tier 4, as priced actions are.
  - They're unavailable, with the reason, during a construction.
- **Cancel is tier 3:** a normal question. It refunds in full and loses nothing.
- **Pending keys:** `kingdom:<building>:<op>`.

**Identity through the confirmation** (K2-B02). The view carries the ownership instance id and, for Cancel, the construction's id, taken when the button is pressed. A refusal as `plot_changed` (or a construction no longer there) reloads the view and sends nothing more, as K1-3's release does.

**Account isolation** (K2-B06). Every read and action records `gameGen`, and is dropped for another account, as in K1-3. The view's reads are numbered, as in K1-3's corrections.

**The Hero tab's summary** outside the Kingdom Zone: the stock and the levels, and any construction with when it finishes. **No Cancel** (question 5).

**The battle:**
- the log's material line;
- the outcome card lists the material, as it lists a gem.

**The clock shown is the server's.** Progress is computed from `finishAt` and the server time the reply carries.

**The players' event banner** omits `materials` while the economy is closed.

### 2.8 The admin console (K2-4), behind a capability (K2-B05)

**K-1's capability is extended** (`meta.kingdoms`, Q3) with an economy capability. It's reported by the `admin` function that supports it: `meta.kingdoms.economy = { version, open }`.

| What the deployed `admin` reports | The `materials` multiplier | The editor's economic fields, and the ledger | The plot record's economy |
|---|---|---|---|
| **No economy key** (`admin` v9, deployed now) | **Visible, but disabled,** saying the server doesn't support it yet. **Never sent:** v9's `cleanMults()` drops unknown keys, and refuses a `materials`-only event ("Set at least one multiplier.") | **Not shown.** No request | Not shown |
| **Supported, economy closed** | **Editable,** saying it has no effect until the economy opens. Stored by the server | **Refused by the server while closed;** the console shows them read-only | **A settled projection** (2.5): zero for every K-1 Kingdom |
| **Economy open** | Fully operational | Corrections, settled first (2.5) | The settled projection |

- **An older server must never silently drop an economic change that the console presents as done.** The console sends economic fields only when the capability says they're supported, and shows the server's answer.
- **The editor can't correct the level of a building under construction:** its `toLevel` would no longer follow.
- **The editor can't add or remove a Kingdom, move its plot, or write a construction** (I-1, and the revoke's contract).
- **A corrected stock above its cap** follows 5.9's rule.
- **The ledger's reads** (for #86 and staff) are behind the same capability.

### 2.9 What is live while closed, and the publish order

**Netlify publishes `public/` on each merge,** long before K2-5 deploys the functions. Every state in between must work with the functions then deployed.

**While `KINGDOM_ECONOMY` is off:**

| Part | While off |
|---|---|
| **The material roll** | Never runs, and consumes no random number. Loot is exactly as today |
| **Settlement** | Never runs. A Kingdom's economic fields aren't written |
| **`kingdomStart` and `kingdomCancel`** | Refused: "The Kingdom's economy isn't open yet." The client doesn't send them |
| **The management view** | Says the economy isn't open yet |
| **The `materials` multiplier** | Per the capability (2.8). **The players' banner omits it** |
| **The resource ledger** (after K2-1) | Exists, empty |
| **The editor's economic corrections** | Refused |

**Each merge and gate:**

| After | The site | The server | Effect |
|---|---|---|---|
| **K2-1's merge** | Unchanged | Unchanged | None |
| **K2-2's merge** | The engine has the economy, off. `MULT_KEYS` has `materials` | `game` v16, `admin` v9 | **None for players.** **The console** sees no economy capability, so the multiplier is disabled and never sent |
| **K2-3 and K2-4's merges** | The interfaces, drawing no economy while off | Unchanged | None |
| **K2-5, Gate B** | Unchanged | The resource-ledger table and function | None |
| **K2-5, Gate C** | Unchanged | `game` and `admin` with the economy, off. `admin` reports the economy capability, closed | **The console's multiplier becomes editable,** with its dormant notice. Nothing for players |
| **K-2 activation** (not K-2) | Open, in a reviewed PR | The same PR, redeployed | The economy runs |

**The reverse, a newer function with an older cached client,** is harmless. The older client doesn't know `materials` or the new actions, and the server refuses them while closed.

**Activation keeps scope 5.7's server-first order** for the material rule: the `game` function's rule first, the client after. That needs its own reviewed procedure (K2-B05). **The dormant rollout is not that procedure.**

## 3. Stages

Each stage needs the owner's authorization and an independent review, as in K-1.

1. **K2-1, the database:** the resource-ledger migration, its grants and constraints, verification scripts, rollback and pgTAP.
2. **K2-2, the engine and the functions:**
   - the validated configuration;
   - `settle()`, construction with its identities, and the material roll;
   - every persistence path (2.5);
   - the source-attributed accounting;
   - `MULT_KEYS`;
   - **the `admin` capability;**
   - the `game` and `admin` actions.

   **Tests:** Node, including the property test; the API tests on the local stack, with the economy's test values; **a bounded closed-state run on the local stack,** as K-1's Q2 (direct requests can't bypass either switch); and the fake backend kept in step.
3. **K2-3, the player's interface:** the management view, the Hero tab's summary, the confirmations with their identities, the battle's material line, and the banner.
   - **Evidence:** browser tests, screens and axe.
4. **K2-4, the admin console:** the economy's view and corrections, the ledger's reads, and the multiplier, all behind the capability.
5. **K2-5, the dormant rollout:** a procedure for review, then Gates A to C (the migration, then `game` and `admin`), with `KINGDOM_ECONOMY` off.

**After K-2, not part of it:**
- **#86's simulations,** on K-2's engine functions;
- **K-3,** the numbers, which must pass the validator and the bootstrap criterion;
- **the activation decisions.**

## 4. The owner's decisions (ratified 2026-11-27)

The owner ratified all five on 2026-11-27, with the review's qualifications:

| # | Decision | Ratified |
|---|---|---|
| **OD-1** | The stages | **Five,** as in section 3. The migration, though small, sets a new security and accounting contract worth its own review |
| **OD-2** | Where a building's gold comes from | **Carried gold,** as the claim. **A cancel refunds to carried gold** |
| **OD-3** | How the level curves are written | **Per-level tables,** indexed by the level built to (2.1). **Tables don't fix a finite maximum:** `MAX_BUILDING_LEVEL` stays a balancing decision, and `'unlimited'` needs K-3's rule for the levels beyond the tables |
| **OD-4** | The resources' names | **Ore, Food and Wood,** and **"Essence"** as the monster material's working name. The display names are final before K2-3 |
| **OD-5** | The `materials` multiplier before the economy opens | **Shown,** guarded by the `admin` capability (2.8): disabled while the server doesn't support it, editable with a dormant notice once it does |

## 5. The K-2 acceptance criteria, traced (K2-B06)

| Criterion (scope 9, K-2, and this plan) | Where, and the evidence |
|---|---|
| Production depends only on server time | 2.3, 2.5. Node tests with a moved device clock; the browser shows only server-derived times |
| Production stops at the cap, nothing banked (10 an hour, a cap of 100, 100 hours give 100; spending never releases the rest) | 2.3, Node tests with exactly those numbers |
| **Production across a construction's finish:** the old output before `finishAt`, the new after | 2.3, Node tests, and the property test splitting at `finishAt` |
| Settlement is path-independent | 2.3, the property test |
| **Every persistence path settles, preserves or removes as in 2.5** | 2.5, API tests per path: an action, a saving read, a non-saving read, a duel target, release, delete, the admin corrections and other edits, the admin projection |
| **An admin level correction applies only from the correction** | 2.5, an API test: settle, correct, settle again, against the expected totals |
| A cancel at or after `finishAt` is refused | 2.3, Node and API tests at the boundary |
| A cancel from outside the Kingdom Zone is refused | 2.3, the API test |
| **A stale confirmation can't act on replacement state:** release and reclaim, then the old start or cancel | 2.3, API tests (`plot_changed`, nothing changed); browser tests (one request, a reload, nothing sent again) |
| A doubled start starts once and charges once; a second start is refused, **including two at once** | 2.3, Node and API tests, concurrent on the local stack |
| A doubled cancel refunds once, and exactly what was paid | 2.3, API tests |
| **A cancel racing a revoke refunds once,** through whichever commits first | 2.3, K1-1's function: an API test on the local stack, as scope 9 requires |
| A revoke during a construction refunds exactly its gold, with the boundary cases | K1-1's function and pgTAP, unchanged. K2-2 adds an API test with a real construction written by `kingdomStart` |
| A refund above the cap is kept, and accrual pauses | 2.3, Node tests |
| A construction finishes at its server time, signed in or not, once | 2.3, 2.5 |
| Hunts give no materials; a variant raises the chance | 2.4, Node tests with test values |
| **Non-owners' loot is unchanged,** and consumes no extra random number | 2.4, a Node test comparing seeded loot draw for draw, with the economy closed and open |
| **Owners' gem and relic chances,** and their mutual exclusion, are unchanged | 2.4, a seeded Node test |
| **A failed or refused save writes no resource or `kingdom` gold ledger entry** | 2.6, API tests with the local stack's failing-save trigger (as #102's) |
| **Successful saves write the correct source totals** | 2.6, API tests: one request that produces and spends, giving both entries |
| **Building costs and refunds** are recorded under the gold ledger's `kingdom` source | 2.6, API tests |
| **Account isolation:** a late answer can't affect another signed-in hero | 2.7, browser tests, as K1-3's |
| `KINGDOM_ECONOMY` off: no drops, no production, no construction | 2.9: Node, API and browser tests, and **the bounded closed-state run on the local stack** (as K-1's Q2) |
| **A malformed or incomplete configuration keeps the economy closed** | 2.1, Node tests for each kind of fault |
| **The admin capability:** unsupported, supported but closed, and open | 2.8, browser tests against each `meta` shape, as K1-4's Q3 |
| **K-3 (not K-2): the economy can be entered from nothing** | 2.1, the validator's bootstrap check, and #86's evidence of a realistic path |

## 6. Evidence for each stage

As in K-1:
- **The suites:** the full engine and browser suites, and `npm run test:db` on the local stack, **including the closed-state run.**
- **axe:** 0 violations of any impact.
- **Screens:** at the usual widths, before and after.
- **Regression tests** shown to fail on the code before them.
- **Time-limited mutation checks,** for the guards.
- **A report** (`docs/kingdoms-k2-report.md`) stating the deviations, and what wasn't verified.

## 7. Deviations from the accepted K-0 scope

**None in substance.** Clarifications, within the scope's own decisions:
- **The banner leaves out `materials` while the economy is closed** (2.4, 2.9). The scope doesn't mention event banners; this keeps copy accurate.
- **The editor can't correct the level of a building under construction** (2.8). This keeps the construction's `toLevel` consistent.
- **The test configuration** extends K-1's decision 9.1 (2.1).
- **Constructions carry an `id`** (2.2), and requests name the ownership instance (2.3). The scope's retry rules (5.8) named the building's level and the start time. These are stricter, and they also cover stale confirmations (K2-B02).
- **The ledger's sources** (2.6) refine 5.11's "inflows and outflows". Its contract, best effort, is unchanged.

## 8. Not verified by this plan

- **The economy's balance,** and the bootstrap path's realism: that's #86 and K-3.
- **The arithmetic at extreme values:** the safe-integer bounds are designed in, and tested in K2-2.
- **Real devices and screen readers:** still owed before any activation, as for K-1.
- **#120,** the 120-second zone-edit race: unchanged, tracked and not authorized. Its `state` read is a non-saving path in 2.5's table, so it doesn't affect settlement.

## 9. Tracking

- **#84:** the plan is at its review gate; the implementation is not authorized.
- **#86:** the simulations that feed K-3.
- **K-1's issue, #83,** is closed. K-2 builds on it without changing its database functions.

## 10. The review findings, disposed (the review of `4bc5b9a`, 2026-11-27)

| Finding | Where |
|---|---|
| **K2-B01:** settlement across every persistence path | 2.5, a path-by-path table; admin corrections settle first; admin views are unsaved projections. Section 5's per-path tests |
| **K2-B02:** construction identity and stale confirmations | 2.2 `construction.id`; 2.3, requests name the ownership instance and the construction; 2.7, identities carried through the confirmation; section 5's release-and-reclaim, concurrency and cancel-and-revoke tests |
| **K2-B03:** source-attributed resource accounting | 2.6, the sources, the post-commit rule, and the unrecorded forfeitures stated as limits |
| **K2-B04:** the configuration contract | 2.1: unset against `'unlimited'`, indexing, domains, safe integers, fail-closed validation, and the bootstrap check as a K-3 criterion |
| **K2-B05:** compatibility and the admin capability | 2.8, the three capability states; 2.9, the publish order with v9's `cleanMults()` behaviour; activation keeps 5.7's server-first order |
| **K2-B06:** acceptance traceability | Section 5, completed, with the closed-state run on the local stack in K2-2's gate |
