# Kingdoms K-1: report (#83)

**The plan is [`docs/kingdoms-k1-plan.md`](kingdoms-k1-plan.md):** revision 1, accepted and merged as PR #116 (`55e41f7`, 2026-11-25).
- **The design baseline** is [`docs/kingdoms-scope.md`](kingdoms-scope.md) (K-0, with amendment 1).
- **The stages:** five, each with its own authorization and review gate (plan section 2).
- **The plan's acceptance** carried four implementation qualifications, Q1 to Q4, into the stages. They're recorded on #83 (2026-11-25).

## 1. K1-1: the database foundation (authorized by the owner, 2026-11-25)

**Status: accepted and merged** as PR #117 (`0b9b4ab`, 2026-11-25), after its final independent review at `7c6c7f1`. `main`'s CI run 45673059067 passed. The review corrections are in 1.6 to 1.8.
- **Nothing calls the new functions** until K1-2.
- **Local only:** applied to the local stack, and run in CI. No production migration and no deploy.

### 1.1 What it adds

**`supabase/migrations/20261125120000_kingdoms.sql`:**
- **`kingdom_plots`**, as in the plan's 2.1:
  - `id`: the ownership instance, an identity column generated always and unique (`kingdom_plots_id_key`). Every claim or reservation gets a new id, never reused (K1-DB01);
  - `x` and `y`: the primary key, `kingdom_plots_pkey`, each 1 to 100;
  - `status`: `claimed` or `reserved`;
  - `character_id`: unique, cascading on the hero's deletion;
  - `claimed_at`.
  - **The CHECK** `kingdom_plots_owner`: a claimed plot has an owner, and a reserved one has none.
  - **Access:** RLS on. `authenticated` can read the six columns, every row. `anon` gets nothing, and nobody can write from the browser.
- **The five functions,** each `security definer`, with `search_path` fixed to `public`. Execute is revoked from PUBLIC, `anon` and `authenticated`, and granted to `service_role`.

  | Function | In order, one transaction | Returns |
  |---|---|---|
  | `kingdom_claim(p_char, p_version, p_data, p_name, p_level, p_zone, p_x, p_y, p_plot_x, p_plot_y, p_reward_ids)` | Check the arguments and `p_data` against I-1 (its `kingdom.plot` must be exactly the plot claimed); insert the plot; claim the staged rewards; save the hero where `version = p_version` | `p_version + 1` |
  | `kingdom_release(p_char, p_version, p_data, …, p_plot_id, p_reward_ids)` | Check `p_data` has no `kingdom`; delete the hero's claimed plot, **only if it is still instance `p_plot_id`**; claim the staged rewards; save the hero where `version = p_version` | `p_version + 1` |
  | `kingdom_revoke(p_x, p_y, p_plot_id, p_character_id, p_staff, p_staff_name, p_reason)` | Lock and delete the claimed plot, **only if it is still instance `p_plot_id`, held by `p_character_id`**; lock its hero; remove `data.kingdom`, refund a construction's paid gold only if it's still under way, and set `version = version + 1` on that current row (Q4); insert the audit entry | The gold refunded (`bigint`) |
  | `kingdom_reserve(p_x, p_y, …)` | Insert a reserved plot; insert the audit entry | The reservation's id |
  | `kingdom_unreserve(p_x, p_y, p_plot_id, …)` | Delete the plot where it is still reservation `p_plot_id`; insert the audit entry | Nothing |

  **A stale request** (K1-DB01): if there is a plot, but not the instance named (it changed hands, or was released and taken or reserved again), the function raises `MRSTL` and changes nothing. If there's no plot at all, it raises `MRNOP`.

- **A private helper, `kingdom_claim_staged_rewards()`:**
  - **#102's checks** (amendment 1): a null set, a null id or a duplicate is `MRARG`; a reward that is claimed, someone else's or missing is `MRREW`;
  - **an empty set claims nothing;**
  - **nobody can call it directly,** not even `service_role`. Only the two `security definer` functions do.
- **The finder, `kingdom_free_plot(p_x, p_y, p_random)`** (K1-B05, Q1):
  - **its declaration:** `volatile` and `security invoker`; execute for `authenticated` and `service_role` only;
  - **its arguments:** a null `p_random` is refused, and "nearest" needs a point within 1 to 100;
  - **nearest:** the smallest Chebyshev distance, with ties to the smallest `y`, then `x`. Random is uniform over the free cells;
  - **its answer:** at most one row, and none on a full map.
- **The error contract** is the plan's (`MRPLT`, `MRHAS`, `MRNOP`, `MRREW`, `MRVER` and `MRARG`), plus `MRSTL`, `plot_changed` (409), for a stale request. Each has its fixed message.
  - **The unique violations are caught** and re-raised by constraint name.
  - **A hero that doesn't exist** fails the foreign key, re-raised as `MRVER`.
- **`save_hero_with_rewards()` isn't changed.**

**The construction record, as the revoke reads it.** It's K-2's to write, so K1-1 fixes the shape the refund reads:
- **`data.kingdom.construction.finishAt`:** milliseconds since the epoch;
- **`data.kingdom.construction.paid.gold`:** a whole number from 0 to 9,007,199,254,740,991 (JavaScript's `Number.MAX_SAFE_INTEGER`, the engine's largest exact integer; K1-DB02). **The hero's gold, before and after the refund,** must be a whole number in the same range; absent means 0 (1.8).

"Under way" means `finishAt > floor(extract(epoch from now()) * 1000)`. A construction that is present but malformed, out of range or fractional raises `MRARG`, rather than refunding a guessed or rounded amount. Values are checked as `numeric` before any conversion. **K-2 must write this shape.**

**The checks,** in `supabase/checks/`, all read-only:
- **`kingdoms_precheck.sql`:** expects no Kingdom table or functions, the columns the functions rely on, and **no zone row that breaks the Kingdom portal** (K1-B03): no zone with the id `kingdoms`, no path into it, no Overworld path at its town cell, and no zone placed on the Overworld at that cell (K1-DB03). Without an Overworld row, the town cell is the built-in Crossroads, `(4, 4)`. It also shows the migration history.
- **`kingdoms_deploy_verify.sql`:** 17 rows, each with an `ok` (revised for K1-DB03, 1.6):
  - the table, RLS, its one policy, the constraints, the cascade and the identity column;
  - **the grants, at table and column level:** `authenticated` reads all six columns and writes none; `anon` and PUBLIC have nothing;
  - the five functions' properties, and the revoke's `bigint` return;
  - the helper and the finder;
  - `save_hero_with_rewards()` unchanged (its md5 `46cea39f…`);
  - the history entry.
- **`kingdoms_state.sql`:** one row: the table, its plot count, the seven functions, an md5 of their definitions, their owners and the history.
- **`kingdom_verify.sql`:** the I-1 check. Every row is an exception, so no rows is the expected answer.

**The rollback,** `supabase/rollback/20261125120000_kingdoms_down.sql`:
- it drops the seven functions and the table;
- **only while Kingdoms have never opened.** It deletes every plot, so it checks `plot_rows` 0 and an empty I-1 result first;
- once K1-2's functions are deployed, their previous versions must be redeployed first.

### 1.2 The tests (pgTAP, 133; and the checks, 4)

The first version had 104 pgTAP tests. The review corrections added 29 (1.6), and `tests/db/kingdom-checks.test.mjs` (4) tests the checks themselves.

`supabase/tests/kingdoms.test.sql`, one transaction, rolled back. `now()` is fixed for the whole run, which makes the revoke's finish boundary exact. **Each failure is followed by checks of the state after it.**

| Area | What is tested |
|---|---|
| **The table** | It exists; the primary key; RLS; `authenticated` reads and can't write; `anon` can't read; each CHECK (the range, the owner rule, the status) |
| **Privileges** | Each function's declaration and grants; the helper's: nobody; the finder: volatile, invoker, `authenticated` only (Q1); `save_hero_with_rewards()` still there; calls refused as `authenticated` and `anon` (`42501`) |
| **Claim** | `MRARG`: the range, null or non-object `p_data`, no `kingdom`, a `kingdom` that isn't an object, a `kingdom.plot` that isn't the plot claimed, a null reward set, a duplicate id. **Success:** the version, the plot, the hero's data, public columns and `updated_at`, the staged rewards claimed. `MRHAS`, `MRPLT` (another hero's plot, a reserved plot), `MRVER` (stale, and a missing hero), `MRREW`. After each refusal: no plot, the hero unchanged, the rewards pending |
| **Release** | `MRARG` (a `kingdom` still in `p_data`, null data), `MRNOP`, `MRVER`, `MRREW`; success, with its reward claimed; a retried release |
| **Revoke** | `MRARG`; `MRNOP` (a free plot, a reserved plot); success with no construction: refund 0, the version raised from the current row (Q4), the audit entry with the refund and the time used. **A save from a read before the revoke fails with `MRVER`, and the Kingdom isn't written back.** A retried revoke |
| **The refund's boundaries** | Before `finishAt`: 500 returned and added, and audited. Exactly at it: 0. After it: 0. A malformed or negative record: `MRARG`, with nothing changed and no audit entry |
| **The audit is guaranteed** | A trigger refusing every `admin_log` insert makes revoke, reserve and unreserve fail, and each leaves everything as it was |
| **Reserve and unreserve** | Success with one audit entry each; `MRPLT` (reserved, claimed); `MRNOP` (a claimed plot, a retry); `MRARG` |
| **Deleting a hero** | Frees the plot |
| **The finder** | Its argument checks; the nearest free plot; **the tie-break, y before x,** tested where the two orders differ; the next ring; random returns one free plot; `authenticated` can call it and read the plots; a full map returns nothing either way |

**Mutation checks** (local only, never committed). Each mutation replaced one rule in a copy of the migration, applied to the local database, ran the suite, then restored the original:

| Mutation | Tests that failed |
|---|---|
| M1: the revoke refunds at exactly `finishAt` (`>=`) | 2: the exact-boundary refund and its audit |
| M2: the revoke doesn't raise the version | 3: Q4's version, the stale save's `MRVER`, the Kingdom not written back |
| M3: the claim skips the I-1 plot check | 4: the mismatch test, and the refusals after it |
| M4: the release accepts a `kingdom` in `p_data` | 5: the I-1 test, and the release tests after it |
| M5: the helper allows duplicate ids | 1: the duplicate test |
| M6: the finder breaks ties by `x` before `y` | 1: the tie-break test |
| M7: the finder declared `stable` | 1: its declaration (Q1) |
| M8: the claim doesn't call the reward helper | 3: the null-set and duplicate refusals, and the state after them |

**The original passed again** after the last mutation (0 failing). The first version of the tie-break test didn't tell the two orders apart, so a case where they differ was added before M6 was run.

### 1.3 Evidence (local, the owner's laptop, 2026-11-25)

**The first version, at `1a104ce`.** The corrected head's evidence is in 1.6 and at the end of this section. Row numbers below are the first version's deploy-verify rows; row 11 there is row 16 now.

- **The migration from scratch:** `npx supabase db reset` applied every migration, `20261125120000_kingdoms.sql` last, with no error.
- **The database suite, three times:** `npm run test:db`. Each run: pgTAP **186 of 186** (news 42, pending rewards 40, Kingdoms 104), and API tests 39 passed with 1 opt-in skip.
- **The checks:**
  - `kingdoms_deploy_verify.sql`: rows 1 to 10 and 12 `ok`;
  - `kingdom_verify.sql`: no rows;
  - `kingdoms_state.sql`: the table present, 0 plots, 7 functions, owner `postgres`, **definitions md5 `f21b2b3397bd818645bf0dda0e9d30c7`**, measured on the LF file.
- **Row 11 locally:**
  - **After `db reset`,** row 11 (`save_hero_with_rewards()` unchanged) read `f825cc85…`, the form recorded during #102 when the function was applied from a CRLF copy on Windows.
  - **Re-applied from `git show`** (LF), it read `46cea39f9a83b467c847dc4916815ca2`, production's reviewed value.
  - **So row 11 is meaningful against production,** and on this laptop only after an LF apply.
- **The rollback, rehearsed locally:**
  1. **The rollback:** `kingdoms_state.sql` showed no table and 0 functions.
  2. **`kingdoms_precheck.sql`:**
     - rows 2, 3 and 6 were `none`;
     - row 5 matched its expected text exactly;
     - row 8 listed the history.
  3. **Re-applied from the LF file:** the same state md5, and no I-1 rows.
- **Precheck row 6 detects what it should:**
  - **In a rolled-back transaction,** zone rows were inserted with three problems: a `kingdoms` zone, a path into it, and an Overworld path at its town cell. Row 6 listed all three.
  - **A harmless path elsewhere wasn't flagged.**
  - The local `zones` table was empty before and after.
- **Engine and browser suites,** unaffected by K1-1, run three times each on the laptop, with the stack stopped for the browser runs:
  - engine **90 of 90**;
  - browser **315 of 315**.

**The corrected head** (the review corrections, 1.6):
- **The migration from scratch:** `db reset`, with no error.
- **The checks:**
  - `kingdoms_deploy_verify.sql`: rows 1 to 15 and 17 `ok`. Row 16 is `f825cc85…` after `db reset`, the same local line-ending effect as above;
  - `kingdom_verify.sql`: no rows;
  - `kingdoms_state.sql`: 7 functions, 0 plots, **definitions md5 `a0c2fb6aed663292f318a028c29e0bc7`**.
- **The rollback, rehearsed again:** the rollback, then the precheck (rows 2, 3 and 6 `none`), then the LF re-apply, giving the same md5.
- **The suites:** in section 1.7.

### 1.4 Not done in K1-1

- **No change to the `game` or `admin` function,** the engine or the client. Nothing calls the functions (K1-2).
- **No concurrency test.** Two claims at once are K1-2's, through the real `game` function.
- **No production access:** no precheck, migration or verify there. That's the coordinated rollout (K1-5; decision 9.3).

### 1.5 Deviations from the plan

- **The construction record's shape** (1.1) is fixed here, because the revoke must read it. The scope says only "exactly what was paid". K-2 must write `paid.gold` and `finishAt` as above.
- **A refund larger than 2,147,483,647 gold** was refused as malformed in the first version, with an `integer` return. **Superseded by K1-DB02** (1.6): the return is `bigint`, and the exact range is JavaScript's safe integers.
- **The precheck also checks the zone rows** (K1-B03). The plan put this at Gate A, and the precheck is where Gate A reads it.
- **From the review corrections** (1.6), all accepted by the owner on 2026-11-25:
  - **the ownership instance:** an `id` column, and an expected id on release, revoke and unreserve (K1-DB01). The plan's signatures gain these parameters, and the error contract gains `MRSTL`;
  - **reserve returns** the new reservation's id;
  - **the audit entries** record the instance's `plot_id`.

### 1.6 Review corrections (the review of `1a104ce`, 2026-11-25)

The review accepted the core architecture: the transactions, the private reward helper, the privilege boundaries, the finder, the construction record's shape, and Q1 and Q4. **It asked for three corrections. The owner approved them, and chose a new `id` column for K1-DB01.**

| Finding | What changed | Its tests |
|---|---|---|
| **K1-DB01:** a destructive request must name the ownership it was prepared against | `kingdom_plots.id`, an identity column (generated always, unique, readable by `authenticated`). **`kingdom_revoke()`** takes the expected `p_plot_id` and `p_character_id`, and acts only on that instance. **`kingdom_unreserve()`** takes the expected reservation's `p_plot_id`. **`kingdom_release()`** takes the hero's expected `p_plot_id`: this is the stale-release protection, in the database, for K1-2 and K1-3 to pass through. A plot that exists, but isn't the instance named, raises **`MRSTL` (`plot_changed`)**, and changes nothing; no plot at all is still `MRNOP`. `kingdom_reserve()` returns the new id. The audit entries record it | **The three scenarios the review named:** a plot that changed owners before a prepared revoke; a plot reacquired by the same hero before a revoke retry (a new id); a reservation replaced before an old unreserve. Each is refused with `MRSTL`, and the new ownership, the hero's data and gold, and the audit log are unchanged. **Also tested:** a stale release, after the hero released and claimed again, can't release the new Kingdom; the right id with the wrong owner; null ids |
| **K1-DB02:** the refund mustn't impose a 32-bit ceiling | The revoke returns `bigint`. `paid.gold` is validated as `numeric` before any conversion: a whole number from 0 to 9,007,199,254,740,991 (`Number.MAX_SAFE_INTEGER`, the engine's largest exact integer, and within the ledger's `bigint`). The hero's gold after the refund must stay within the same range. Anything else is `MRARG`, never rounded | A refund of 3,000,000,007 is returned, added and audited exactly; exactly 9,007,199,254,740,991 is exact; one more is refused; a refund that would take the hero's gold past the range is refused; a fractional amount is refused. After the refusals, nothing changed and no audit entry was written |
| **K1-DB03:** the deployment checks must establish what they claim | **`kingdoms_deploy_verify.sql`, 17 rows:** all six columns readable by `authenticated`; no insert, update or references on any column, and no delete, truncate or trigger (`has_column_privilege()` covers column and table grants); `anon` with nothing at either level; PUBLIC with nothing in the table's or the columns' ACLs; the one policy, exactly (permissive, select, `authenticated`, `true`, no check); the identity column; the `bigint` return. **`kingdoms_precheck.sql` row 6** also reports a zone placed on the Overworld at its town cell, using the built-in `(4, 4)` when there's no Overworld row | **`tests/db/kingdom-checks.test.mjs`** runs the check files exactly as written, against fixtures on the local stack. **I-1:** four inconsistent heroes (a kingdom without a plot, a plot without a kingdom, a mismatch, a malformed kingdom) are each reported once; a valid ownership isn't; after repair, nothing is. **Precheck row 6:** all four kinds of bad zone row are reported, a harmless one isn't, and `none` returns after cleanup; also the built-in-Overworld case. **Deploy verify:** every row `ok` on the migrated database, except row 16, which is reported but not asserted because a local apply's line endings can differ (1.3). pgTAP also checks the six columns, both privilege levels and the policy |

**Showing the new checks can fail** (local, then restored):
- **The I-1 test:** with the check's mismatch condition inverted, it failed, naming `plot_mismatch`.
- **The deploy-verify test:**
  - with `select (claimed_at)` granted to `anon`, it failed on row 9;
  - with `update (status)` granted to `authenticated`, it failed;
  - after both were revoked, it passed.

**Mutation checks, repeated on the corrected migration:**
- **The method was corrected.** The first script counted only named failing tests. A SQL error outside `throws_ok()` stops the file, so it now also reports the error and the plan it cut short.
- **All of M1 to M8 are still caught.**
- **The new mutations:**

  | Mutation | Caught by |
  |---|---|
  | M9: the revoke ignores the expected instance and owner | The right-id, wrong-owner test, and the state after it. The file then stops (`no_plot`, 68 of 133 run) |
  | M9b: the revoke checks the owner but not the instance | **The reacquired-plot retry scenario on its own:** the retry and the state after it |
  | M10: the unreserve ignores the expected reservation | The replaced-reservation scenario, and the state after it |
  | M11: the release ignores the expected instance | 7, from the `MRSTL` release test on |
  | M12: the refund narrowed to `integer` | The 3,000,000,007 refund (`integer out of range`; the file stops, 88 of 133 run) |

- **The original passes again** (0 failing).

**The LF definition fingerprint:** `kingdoms_state.sql`'s `definitions_md5` is now **`a0c2fb6aed663292f318a028c29e0bc7`**, measured on the LF migration, after `db reset` and again after the rollback and an LF re-apply. The first version's value was `f21b2b33…`.

### 1.7 Evidence for the corrected head (local, the owner's laptop, 2026-11-25)

- **`npm run test:db`, three times.** Each run:
  - pgTAP **215 of 215** (news 42, pending rewards 40, Kingdoms 133);
  - API and check tests **43 passed**, 1 opt-in skipped. That's 39 before, plus the 4 in `kingdom-checks.test.mjs`.
- **Engine:** 90 of 90, three times.
- **Browser:** 315 of 315, three times, with the stack stopped.

**CI on `bf0b504` (run 45643786524) and on `ab87580` (run 45647032736) failed in the database job:** all four tests in `kingdom-checks.test.mjs` failed. pgTAP passed (215 of 215), as did the other API tests.
- **The cause was the test's own parsing.** It read the result by slicing from the CLI output's first `{` to its last `}`, so `JSON.parse` failed ("Unexpected non-whitespace character after JSON"). On the laptop it had passed.
- **A first fix, `ab87580`, misread the cause.** It scanned for a JSON object with a `rows` key. CI run 45647032736 failed the same four tests, and **its error message, which now includes the raw output, showed the real cause.**
- **The real cause:** the same CLI version (2.122.0) prints two shapes:
  - **on CI, a bare JSON array of rows.** Slicing from the first `{` to the last `}` of an array of objects gives `{…},{…}`;
  - **on the laptop, an object with a `rows` array,** with a boundary and a warning. The CLI wraps results this way when an AI agent runs it.
- **The fix:**
  - the test scans the output for every top-level JSON object or array, and accepts either shape;
  - a query or check file that prints no rows still fails, with the raw output in the message;
  - an insert, update or delete prints only its command tag, so it returns no rows.
- **The CI run's output also shows the checks themselves working on CI.** The I-1 check reported the fixture heroes `kingdom_malformed`, `kingdom_without_plot` and `plot_mismatch`, at (93, 93).
- **Nothing in the checks or the migration changed.**
- **Reproduced locally.** The CLI prints the bare array when it is run without the AI-agent environment variables (`AI_AGENT`, `CLAUDECODE` and the other `CLAUDE_CODE_*` ones). In that mode, `ab87580`'s parser failed all four tests, and the new one passed all four. With the variables set, it also passes all four.
- **The parser, checked directly** against both shapes, an empty result and a command tag.
- **Cleanup:** the fixtures were removed each time, with no zones, plots or test heroes left.

### 1.8 Re-review correction (the re-review of `4504c47`, 2026-11-25)

**The re-review accepted K1-DB01 and K1-DB03, and the parser investigation.** It found one remaining gap in K1-DB02, and the owner authorized its correction.

**The gap:** the revoke checked only that the hero's gold plus the refund stayed within the range. It didn't check that the existing balance, and so the result, was a whole number and not negative. For example:
- 1,000.5 + 500 gave 1,500.5;
- −1,000 + 500 gave −500.

**The correction** applies when there is a refund to add.
- **The hero's `gold`, if present, must be a JSON number.** Absent means 0.
- **It must be a whole number from 0 to 9,007,199,254,740,991,** and so must the result.
- **Anything else is `MRARG`,** raised before anything is written.
- **The rest of the revoke is unchanged:**
  - with no refund, the balance is never read or changed;
  - the 3,000,000,007 and maximum-refund tests still pass.

**The tests (pgTAP, 140, up from 133):**
- **Four refusals:**
  - a fractional balance (1,000.5 + 500);
  - a negative balance (−1,000 + 500);
  - a balance that isn't a number (`"1000"`);
  - a balance already above the range.
- **After each:** the balance, the Kingdom, the version and the plot are unchanged.
- **No audit entry** was written for any of them.
- **On the previous code:**
  - **M13**, the previous upper-bound-only check, fails 14 tests, starting with the fractional-balance refusal;
  - the restored migration passes.

**The test harness** (`kingdom-checks.test.mjs`): the database URL is checked as local before it is kept. The cleanup hook runs only when it is set, so it can never target a database that failed the check.

**Carried into K1-2 to K1-4** (the re-review's requirements, not done here):
- **A destructive request passes the ownership id that was inspected and confirmed.** It is never silently replaced by the current id.
- **`MRSTL` refreshes the state,** and asks for a new confirmation where one applies.
- **The refund keeps the exact range** through the RPC response and the ledger entry after the commit.

**Evidence for the corrected head** (local, the owner's laptop, 2026-11-25):
- **pgTAP, alone:** 140 of 140 for Kingdoms.
- **`npm run test:db`, three times:** pgTAP **222 of 222** (news 42, pending rewards 40, Kingdoms 140), and API and check tests **43 passed** with 1 opt-in skipped.
- **The check tests:** `kingdom-checks.test.mjs` passes 4 of 4 in both output shapes, with and without the AI-agent environment.
- **The checks:**
  - `kingdom_verify.sql`: no rows;
  - `kingdoms_state.sql`: 7 functions, 0 plots, **definitions md5 `afac33eeb3fb45123b4d18eb5300673b`**, measured on the LF migration. The previous value was `a0c2fb6a…`.
- **Mutation checks:** all 14 (M1 to M13, with M9b) are caught, and the restored migration passes.
- **Engine:** 90 of 90, three times.
- **The browser suite was not completed locally.** Claude Code stopped the background run because the laptop was critically low on memory.
  - The first run was cut off, and its partial count isn't a result.
  - The run wasn't restarted. K1-1 changes no browser code.
  - **For this head, the browser evidence is CI's browser job.**

## 2. K1-2: the engine and the game and admin functions (authorized by the owner, 2026-11-25)

**Status: accepted and merged** as PR #118 (`6b19337`, 2026-11-26), after its final independent review at `bd5e992`. `main`'s CI run 45848086852 passed. The review corrections are in 2.6.
- **Kingdoms stay closed:** the shipped configuration is closed, so nothing of Kingdoms is reachable in production or on the site.
- **No production access, and no deploy.**
- **The authorization:** the owner's "Next stage owner authorized", given with K1-1's final review, read as authorizing PR #117's merge and K1-2. Both were recorded on #83.

### 2.1 What it changes

**The shared code** (published to the site on merge; inert while closed):
- **`public/js/data/kingdoms.js`, new:**
  - **the shipped switch and values:** `KINGDOMS_OPEN = false`, `CLAIM_MIN_LEVEL = null`, `CLAIM_COST = null`;
  - **the constants:** `KINGDOM_SIZE` 100, `PLOT_WINDOW` 10 (decision 9.4), and the gate `(1, 1)`;
  - **`kingdomsOpen()`, the one predicate:** the switch on and both values set. Unset values mean closed, never unrestricted;
  - **the test configuration's guard, `testConfigFrom()`:** `KINGDOMS_TEST` exactly `1` **and** `SUPABASE_URL`'s host exactly `kong`. Anything missing or malformed is closed. The test values are fixed in code: open, level 1, cost 100;
  - **the Kingdom Zone's definition,** built for the current Overworld town.
- **`public/js/data/zones.js`:**
  - **`loadZones()` always ignores a zone with the id `kingdoms`,** and drops any path into it;
  - **while open, it registers the Kingdom Zone last,** and adds the one path in: at the Overworld's town cell, needing `CLAIM_MIN_LEVEL`. Any other path at that cell is removed;
  - **`ZONE_DEFS` never holds the Kingdom Zone;**
  - **`reloadZones()`** re-registers under the current configuration.
- **`public/js/engine/zone-validate.js`** refuses:
  - the id `kingdoms`;
  - any path into it;
  - an Overworld path at its town cell.
- **`public/js/engine/world.js`:** `move()` and `walkTo()` are refused in the Kingdom Zone ("Choose plots on the plot map.").
- **`public/js/engine/character.js`, `ensureCharacter()`:**
  - in the Kingdom Zone, away from the gate: to the gate;
  - while closed: to the Crossroads, not to the race's home;
  - **it never touches `data.kingdom`.**
- **`public/js/engine/kingdom.js`, new:** `claimKingdom()` and `releaseKingdom()`.
  - **Refused:** while closed; outside the Kingdom Zone (K-D12); in a fight; on a plot outside 1 to 100; with a Kingdom already, or without one.
  - **The level and the cost** are checked. **The cost is paid from carried gold,** as every other purchase is.
- **`public/js/admin.js`:** the world-boss hunt's zone list leaves out the Kingdom Zone.

**The `game` function:**
- **The configuration:** set once at start-up, followed by `reloadZones()`.
- **One commit path, `commitRow()`,** used by every save:
  - finish staging;
  - commit through `save_hero_with_rewards()`, `kingdom_claim()`, `kingdom_release()` or the plain versioned update;
  - map the refusals;
  - take the new version;
  - and only then flush the ledger.

  **`saveRow()` calls it.** The #102 API tests (22) pass unchanged through it.
- **The refusals:** `MRPLT`, `MRHAS`, `MRNOP` and `MRSTL` answer 409 with a `reason` field (`plot_taken`, `has_kingdom`, `no_plot`, `plot_changed`). `MRREW` and `MRVER` remain "busy" (409).
- **`kingdomClaim` and `kingdomRelease`:**
  - they come before the generic actions, so the claim's gold is ledgered once, under `kingdom`, and only after the commit;
  - **the release takes the plot instance's id from the request,** checked as a positive safe integer. It is never looked up, so a stale confirmation can't release a newer Kingdom;
  - **both join `FAST_ACTIONS`.**
- **Location corrections are saved** (K1-B04).
  - `loadRow()` compares only `loc` before and after `ensureCharacter()`.
  - A `state` read with a correction saves it through `commitRow()`, versioned, public columns included.
  - This also applies to a hero in a deleted or resized zone.

**The `admin` function:**
- **The same configuration rule.**
- **`meta`** reports `kingdoms: { version: 1, open }`. This is the capability that K1-4's console needs before asking for Kingdom data (Q3). `admin` v8 has no such key.
- **The hero editor:** a move into the Kingdom Zone is possible only while open (otherwise the zone is unknown), and only to the gate.
- **`startHunt()`** refuses the Kingdom Zone.
- **The reads, `kingdomPlot` and `kingdomSearch`,** are for any staff member, open or closed.
- **The changes, `kingdomRevoke`, `kingdomReserve` and `kingdomUnreserve`,** are admin only, and refused while closed (409).
  - **Revoke and unreserve take the instance id,** and revoke also the owner, from the request.
  - **The revoke's refund** is checked as a non-negative safe integer, then ledgered under `kingdom` after the commit, if it's above 0.

**CI and the local stack:**
- **CI's database job** writes `supabase/functions/.env` (`KINGDOMS_TEST=1`) before `supabase start`.
- **`supabase/.gitignore`** ignores `functions/.env`, confirmed with `git check-ignore`.
- **`CLAUDE.md`** says how to run the open and the closed tests locally.

### 2.2 The tests

- **Engine, `tests/kingdom.test.mjs` (20 after 2.6; 19 at first):**
  - the shipped configuration;
  - `kingdomsOpen()`, including unset values meaning closed;
  - **the guard:** every non-`kong` host, every flag but `1`, and missing values;
  - registration closed and open, the one way in, and the portal's level;
  - a rogue database zone and path are ignored;
  - the collision at the town cell is removed;
  - the portal follows a moved town;
  - the validation refusals, with every built-in zone still valid;
  - the gate and the closed move to the Crossroads;
  - no walking or monsters in the Kingdom Zone;
  - the claim and release rules;
  - no ordinary action changes `data.kingdom`.
- **API, `tests/db/kingdoms-api.test.mjs` (20 after 2.6; 17 at first),** through the real functions in the test configuration:

  | Test | What it proves |
  |---|---|
  | K-1 | A claim takes the plot and records the Kingdom; the cost is ledgered once; a retried claim changes nothing |
  | K-2 | Two heroes claiming one plot at once: exactly one wins; the other gets 409 `plot_taken`, pays nothing, and has no Kingdom |
  | K-3 | One hero claiming twice at once: one plot, charged once |
  | K-4 | A conflicting save: no plot, no charge, **no ledger entry** |
  | K-5 | Staged rewards are claimed in the claim's own transaction, and delivered once (#102's case 7) |
  | K-6 | A claim refused by the database leaves the staged rewards pending, and they are delivered once later |
  | K-7 | Walking and stepping in the Kingdom Zone are refused; a claim from outside it is refused (renamed in 2.6: it never sent a release) |
  | K-7b | An unaffordable claim, with banked gold available: no plot, carried and banked gold unchanged, nothing saved, no ledger entry (2.6) |
  | K-7c | A plot owner can't release from outside the Kingdom Zone: the plot and the Kingdom are intact, nothing saved (2.6) |
  | K-7d | In the Kingdom Zone, no fight, no duel (not a PvP zone), and no hunt: neither one elsewhere, nor a hunt row placed in the Kingdom Zone directly (2.6) |
  | K-8 | **A stale release naming an older Kingdom gets 409 `plot_changed`,** and the new Kingdom is intact. A release frees the plot named and claims its staged reward. Invalid ids are refused, never looked up |
  | K-9 | A retried release saves nothing |
  | K-10 | **A revoke between a `game` read and its save.** A test-only trigger makes the reward claim (the first step of `save_hero_with_rewards()`) wait, before the hero's row is locked. The revoke commits meanwhile. The save then fails with 409, the Kingdom isn't written back, and the reward stays pending |
  | K-11 | A `state` read saves a location correction (the gate; a deleted zone), with one versioned save; a read with nothing to correct saves nothing |
  | K-12 | The `meta` capability; a moderator can read and search, and is refused changes (403) |
  | K-13 | The Kingdom RPCs are refused to a player and to `anon` through the REST API (`42501`) |
  | K-14 | Reserve and unreserve write one audit entry each; an old unreserve after a re-reserve gets 409, with no audit entry; a missing id is refused |
  | K-15 | **The refund:** 3,000,000,007 is returned, added and ledgered exactly, once. A stale revoke and a retried one leave the ledger and the audit log unchanged |
  | K-16 | The hero editor moves a hero only to the gate; hunts in the Kingdom Lands are refused |
  | K-17 | The I-1 check finds no exception among the file's heroes |

- **The closed-state check, `tests/db/kingdoms-closed.test.mjs` (3, opt-in, Q2).** It runs with `KINGDOMS_EXPECT_CLOSED=1`, against a stack started without `.env`, and checks that:
  - a hero placed in the Kingdom Zone is moved to the Crossroads, and saved;
  - claim and release are refused by `game`;
  - `meta` reports closed, and the Kingdom Zone isn't registered;
  - all three admin changes, and a move into the Kingdom Zone, are refused by `admin`;
  - reads still work.
- **Without `.env` and without the flag,** the open-state file fails at once, naming the missing configuration.

**Mutation checks on the server code** (local only; each file was restored byte for byte, checked by md5). The edge runtime was restarted after each edit: its hot reload had shown edits a run late, which made the first attempt's results unreliable, so they were discarded.

| Mutation | Caught by |
|---|---|
| S2: the claim drops the staged reward ids | K-5 |
| S3: the release looks up the current plot id | K-8, K-9 |
| S4: the ledger is flushed before the commit | K-4 |
| S5: a location correction isn't saved | K-11 |
| S9: `MRSTL` isn't mapped | K-8 |
| S6: the admin function ledgers before the revoke commits | K-15 |
| S7: the hero editor allows any Kingdom cell | K-16 |
| S8: hunts are allowed in the Kingdom Lands | K-16 |

**The baseline before** and **the run after** had 0 failing.

**A test-isolation fix found on the way:** K-14 and K-15 first counted audit entries for their plots from every run, so a second run failed. They now count only entries whose reason starts with the run's id.

### 2.3 Evidence (local, the owner's laptop, 2026-11-25)

- **Engine:** 109 of 109 (90 before, plus 19), three times.
- **The #102 regression net:** `pending-rewards-api.test.mjs`, 22 of 22, unchanged, through the new commit path, in the test configuration.
- **`kingdoms-api.test.mjs`:** 17 of 17, in the test configuration; also within the mutation runs (the baseline and the run after, each 0 failing).
- **The closed-state check (Q2),** against a stack started without `.env`: 3 of 3. The 17 open-state tests skipped, with the flag. Without the flag, they failed at once, naming the missing configuration.
- **`npm run test:db`, in the test configuration:** pgTAP **222 of 222**, and API tests **60 passed**, 4 skipped (the earlier opt-in, and the 3 closed-state checks).
  - **Two runs completed.** Claude Code stopped the third because the laptop was critically low on memory, and it wasn't restarted.
- **Browser:** **315 of 315, one run,** with the stack stopped.
  - **Fewer than the usual three runs,** because of the same memory pressure.
  - K1-2 changes shared code the browser loads, but closed, so nothing of Kingdoms is drawn and every reader of `ZONES` sees what it saw before. CI's browser job is the further evidence.
- **`supabase/functions/.env`** is ignored by Git (`git check-ignore`). It was never staged.

### 2.4 Deviations from the plan

- **The Kingdom configuration lives in `public/js/data/kingdoms.js`,** not in `public/js/engine/kingdom.js` alone (the plan's 2.2). `data/zones.js` needs it, and `data/` mustn't import from `engine/`. The rules are in `engine/kingdom.js`.
- **A `reason` code on some `game` refusals** (`plot_taken`, `has_kingdom`, `no_plot`, `plot_changed`). It is added to the JSON beside `error`, so K1-3 can tell a stale plot from a busy hero. Older clients ignore it.
- **The claim's cost comes from carried gold.** The plan didn't say which. Every other purchase works this way.
- **While Kingdoms are open, any other path at the Overworld town cell is removed** when the Kingdom portal is added. This is a second line behind validation, so the Crossroads can't lead anywhere else.
- **The closed-state check** is a committed, opt-in test file, so it can be rerun. The review asked only for a bounded local check.

### 2.5 Not done in K1-2

- **The player's interface (K1-3) and the admin console's Kingdoms section (K1-4).** No client draws Kingdoms yet. The only client change is the hunt zone list.
- **The production rollout (K1-5):** no precheck, migration or deploy. **`game` v15 and `admin` v8 are unchanged.**
- **Activation:** no live values. Kingdoms stay closed.

### 2.6 Review corrections (the review of `07f189f`, 2026-11-25)

**The review accepted:**
- the shared `commitRow()` and its guarantees;
- the local test configuration;
- Q2, and Q3's server side;
- the documented local-testing deviation;
- the mutation method.

It asked for two corrections. **The owner authorized them, and ratified two things:**
- **the claim is paid from carried gold** (banked gold doesn't pay);
- **"Next stage owner authorized" as covering** PR #117's merge and K1-2.

| Finding | What changed | Its tests |
|---|---|---|
| **K1-ENG01:** the reverse Overworld collision | **`validateZone()`** now also refuses an Overworld whose town is on a cell where another zone is placed. Editing and restoring the Overworld both validate through it (`saveZone()`, `resetZone()`), so neither can move the town onto an existing route. The other direction (a zone placed on the town) was already refused. **`registerKingdomZone()`'s removal of other paths at the town cell stays,** as a second line | **Engine:** moving the town onto Ashford Vale's cell is refused, by name; restoring the built-in Overworld over a zone placed on its town is refused; a free cell is fine; the other direction is still refused. **Fails on `07f189f`:** with the change undone, this test fails (19 pass, 1 fails) |
| **K1-ENG02:** the real-stack acceptance evidence | **K-7 renamed** to what it does: walking and stepping refused, a claim from outside refused. **K-7b, K-7c and K-7d added.** **The engine** (`startHuntBattle()`) now refuses a hunt in the Kingdom Zone, so the accepted rule ("no hunt", 5.1.1) holds even for a hunt row placed there without the admin console. This is not a new gameplay rule | **K-7b:** an unaffordable claim, with banked gold available: no plot, gold and bank unchanged, nothing saved, no ledger entry. **K-7c:** a plot owner outside the Kingdom Zone can't release; the plot and the Kingdom are intact. **K-7d:** no fight; no duel; and no hunt, neither one elsewhere nor a row placed in the Kingdom Zone. **The guard was needed:** without it, the hero joined the placed hunt and K-7d failed (shown on the local stack, then the guard restored) |

**Evidence (local, targeted, as the review allowed):**
- **Engine:** 110 of 110: 109, plus the K1-ENG01 test. The hunt guard was added to an existing test.
- **`kingdoms-api.test.mjs`:** 20 of 20, in the test configuration.
- **The suites as a whole** are CI's, on this head.

**Carried into K1-3 and K1-4** (the review's requirements, not done here):
- **K1-3:**
  - **`net.js`'s `call()` must keep the server's `reason`,** which it drops today, when it turns a refusal into an error;
  - on `plot_changed`, refresh the state and ask for a new confirmation;
  - keep the ownership id that was inspected.
- **K1-4:**
  - **the console's side of Q3:**
    - with no `meta.kingdoms` (`admin` v8), it sends no Kingdom request;
    - while closed, it is read-only;
    - while open, it does what each role may;
  - **a stale admin change (409)** either gets a reason code or refreshes the inspected plot. It is never retried with a replacement id.

## 3. K1-3: the player's interface (authorized by the owner, 2026-11-26)

**Status: implemented, with the review corrections K1-UI01 to K1-UI03 (3.6), at its re-review gate.**
- **Kingdoms stay closed as shipped.** With the shipped constants, nothing of Kingdoms is drawn, and no Kingdom request leaves the browser. Production has no Kingdom table yet (the rollout is K1-5), and `game` is still v15.
- **No server change,** and no deploy.

### 3.1 What it adds

**`public/js/kingdom-ui.js`, new:** views and pure helpers only. `main.js` owns the state, the reads and the requests, and passes helpers in; the module never imports `main.js`.
- **The plot map (the Map tab in the Kingdom Zone):**
  - **a 10 × 10 window** (`PLOT_WINDOW`, decision 9.4) on the 100 × 100 Kingdom Lands;
  - **controls:** North, West, East and South move the view by a window; show a plot by its coordinates; "My Kingdom"; "Nearest free plot" and "Random free plot";
  - **the selected plot:** what it is, and the claim, or "Manage my Kingdom";
  - **a list of the plots in view.** It lists the claimed and reserved plots, with a count of the free ones, rather than 100 rows. That is a choice for the review;
  - **each plot's label:** its coordinates, then "Free", "Reserved", "Claimed by" and the owner's hero name (K-D4), or "Your Kingdom". **Until the window's plots have loaded, a plot is "Loading", never "Free".** A failed read shows "Couldn't load these plots" with Try again;
  - **plain text only:** no icons or arrow glyphs.
- **The Explore screen in the Kingdom Zone:** the zone's description, and "Manage my Kingdom" or the claim prompt, with the level and the carried-gold cost.
- **The Hero tab's Kingdom section** (5.5):
  - outside the Kingdom Zone, the plot and "Travel to the Kingdom Lands to manage it";
  - inside it, "Manage my Kingdom";
  - without a Kingdom, the requirements.
- **The management view,** a sheet: the Kingdom (the hero's name) and its plot, and Release. Nothing else yet. **Release is offered only once the hero's own plot row has been read fresh.** Its button carries that row's ownership instance id.

**`public/js/main.js`:**
- **The state:** `ui.kingdom`, in `freshUi()`, so each account starts afresh.
- **The reads** (`loadPlots()`, `loadMine()`, started by `syncKingdom()` after each render) record `gameGen` **and** the window they were asked for. An answer for another account, or for a window the player has moved on from, is dropped.
  - **A refresh** (after a claim, a release, a refusal, or every 30 seconds on the plot map) keeps what is shown until the new answer arrives.
  - **A revision counter** stops a read already on its way from passing for the refreshed one. (Replaced by a number for each read in the review corrections, 3.6.)
- **Nothing iterates the Kingdom Zone's 10,000 cells:**
  - the Map tab draws the plot map, not `viewMap()`;
  - the desktop side column shows a summary, not the minimap;
  - the dock has no arrow pad, so the arrow-key move shortcut finds nothing to press;
  - **there's no players list**, so `playersAt()` isn't called.
- **Claiming** is tier 2: `confirm.js`'s danger tone, with focus on Cancel (question 7). It names the plot and the cost, and says the Kingdom can't be moved, with the price on the button.
  - **When the hero can't claim,** the button is disabled, with the reason. For gold, the reason says the cost is carried gold, and to withdraw at a bank.
- **Releasing** is tier 1: type the name (K-D5). **The plot instance id is the one on screen when Release was pressed,** taken before the dialog opens.
- **A Kingdom refusal** (`plot_taken`, `plot_changed`, `has_kingdom`, `no_plot`) shows the server's message, reads the hero and the plots again, **and sends nothing more.** The player looks, and confirms again (the K1-2 review's carry-forward).
- **The finders are advisory:** they move the view and select a plot, nothing else. A full map says "No free plots are left."
- **Deleting a hero with a Kingdom** adds a line to the confirmation (K-D7): the Kingdom on its plot is destroyed, and the plot freed. The copy is unchanged for a hero without one.

**`public/js/net.js`:**
- **`call()` keeps the server's `reason`** on the error (the K1-2 review's carry-forward).
- **`kingdomPlots()`, `kingdomOwners()` and `kingdomFreePlot()`:** the window's plots, the owners' names, and the finder, under RLS. **They're called only while Kingdoms are open.**

**`public/css/style.css`:** the plot grid. Ten plots across at any width, each at least 24 × 24 px (WCAG 2.5.8), with no scrolling frame.

**The test harness, `tests/ui/harness.mjs`:**
- **`kingdomsOn(page)`** opens Kingdoms in the browser by rewriting the three shipped constants, with the fake's test values (level 1, cost 100). It throws if a constant isn't found.
- **`new FakeBackend({ kingdoms: { plots } })`** opens them in the fake `game` function, which mirrors K1-2:
  - the engine's checks, then the table's: a new instance id per claim, carried-gold payment;
  - the same messages, statuses and `reason` codes, including `plot_changed` against `no_plot`.
- **The configuration** is set before every request, because the engine's module state is shared within a test worker.
- **Every Kingdom request is recorded** (`kingdomCalls`).
- **Owners' names** come through `characters?id=in.(…)`. The finder works as the database function does.
- **`reclaimFor()`** plays another tab's release and claim. **`failNext()`** can carry a `reason`.

**`tools/kingdom-shots.mjs`, new:** the Kingdom screens, with an axe summary.

### 3.2 The tests (`tests/ui/kingdoms.test.mjs`, 17)

| Test | What it proves |
|---|---|
| K3-1 | **Closed (the shipped constants): no Kingdom request is sent.** No plot read, owner read, finder call or Kingdom action (`kingdomCalls` is empty). No path at the Crossroads, no Kingdom text on Explore or the Hero tab, and the ordinary map |
| K3-2 | The Crossroads leads to the Kingdom Lands. There: no monsters, no players list, no arrow pad, and an arrow key sends no move. "Leave the Kingdom Lands" returns to the Overworld |
| K3-3 | The window is exactly 100 plots, with each plot's status and the owner's name. Moving the view and selecting send no game action, and the hero stays at the gate |
| K3-4 | One tab stop. Arrows move between plots, and past the edge move the view by one row, **with focus on the matching plot after the reload.** Enter selects |
| K3-5 | **The claim:** tier 2, with focus on Cancel. Cancel sends nothing. The claim sends `{ x, y }`, the plot becomes "Your Kingdom", carried gold drops by 100, and the Hero tab shows the Kingdom |
| K3-6 | A claim the hero can't pay for, with banked gold available: disabled, with the reason. Nothing is sent |
| K3-7 | A plot taken meanwhile: **one** claim is sent and refused (`plot_taken`), and the map is read again, showing the new owner |
| K3-8 | **The release:** type the name. **The instance id on screen is sent.** The Kingdom is gone and the view closes |
| K3-9 | **A stale release** (`plot_changed`): another tab releases and claims again. **One** release is sent, naming the old instance. The hero is read again, the view shows the new plot, and nothing is sent again by itself |
| K3-10 | The finders: nearest (ring 1, `y` then `x`), random, no game action, and a full map says so |
| K3-11 | Showing a plot by its coordinates; out-of-range input is refused with a message |
| K3-12 | The Hero tab: the summary outside, "Manage" inside, and the requirements without a Kingdom |
| K3-13 | Deleting a hero with a Kingdom says it is destroyed and its plot freed |
| K3-14 | Account isolation: after signing out and in again, the plot map starts afresh |
| K3-15 | At 320 px and in phone landscape (740 × 360): ten plots fit, each at least 24 px, with no horizontal scrolling |
| K3-16 | Desktop: the side column summarises the Kingdom Lands, with no squares, and the page never draws the 10,000 |
| K3-17 | **axe, 0 violations of any impact:** Explore, the plot map, a plot selected, the claim dialog, the Hero section, the management view |

**Mutation checks on the client** (local only; each file restored byte for byte, checked by md5):

| Mutation | Caught by |
|---|---|
| C1: the Hero section shown while closed | K3-1 |
| C2: `net.js` drops the `reason` | K3-9 |
| C3: a stale release is retried by itself | K3-9 |
| C4: past the edge, the view doesn't move | K3-4 |
| C5: the claim dialog focuses its confirm button | K3-5 |
| C6: the dock keeps the arrow pad in the Kingdom Zone | K3-2 |
| C7: the minimap draws the Kingdom Zone | K3-16 |
| C8: a claim the hero can't pay for is offered | K3-6 |

**The restored run had 0 failing.** One run, C6's, stopped making progress after K3-2 had failed, and was ended after about 80 minutes. Its result stands: K3-2 caught it. Later mutation runs will have a time limit.

### 3.3 Evidence (local, the owner's laptop, 2026-11-26)

- **`tests/ui/kingdoms.test.mjs`:** 17 of 17, and again within the mutation runs (the restored run, 0 failing).
- **Engine:** 110 of 110.
- **The screens before and after** (`tools/ui-shots.mjs`, at 320, 390 and 1440). `main` (`6b19337`) came from a temporary worktree, and this branch was measured the same way.
  - **43 of 51 are byte-identical.** The other 8 are the battle screens, the chat drawer and the 320 px Hero tab, whose values depend on the dice and the clock. The Hero tab differs only in its health bar (398 against 400, the regeneration's timing).
  - **axe: 0 violations of any impact,** before and after.
- **The Kingdom screens** (`tools/kingdom-shots.mjs`, at 320, 740 × 360, 390 and 1440): 28 screens, **axe 0 violations of any impact**, with no page errors and no unexpected requests.
- **The full browser suite:** **332 of 332** (315, plus the 17), in two runs, with the local stack stopped. Two runs rather than three, given the laptop's memory pressure in earlier stages; CI's browser job is the further run.
- **The database suite** wasn't run. K1-3 changes no server or database code, and the local stack stayed stopped for the browser runs.

### 3.4 Deviations

- **The list of plots in view** shows the claimed and reserved plots and counts the free ones, rather than listing all 100 (the plan said "a list of the plots in view").
- **The window moves by a whole window** with the buttons, and by a row or column with the arrow keys past the edge. The plan said "by a window or a row".
- **The jump-to-coordinates controls are a group, not a form,** so a button can't submit the page.
- **The Explore dock in the Kingdom Zone** has "Leave the Kingdom Lands" and "Manage my Kingdom" (or "Plot map"), and no arrow pad.

### 3.5 Not done in K1-3

- **The admin console's Kingdoms section (K1-4),** including Q3's client side.
- **The rollout (K1-5)** and activation. Kingdoms stay closed.
- **Real devices and screen readers:** not tested. The browser tests run in Chromium against the fake backend.

### 3.6 Review corrections (the review of `ae3e694`, 2026-11-26)

**The review accepted:**
- the player-interface design: the 10 × 10 window, the navigation, the confirmation tiers and the mobile layout;
- the four deviations (3.4);
- the claim and release confirmations, and the instance id kept through the confirmation;
- `reason` kept through `net.js`;
- the closed state;
- the reported screens and axe results, within their limits;
- the two local full runs.

It asked for three corrections, all about asynchronous state. **The owner authorized them** (2026-11-26). They are client-only: no server or database change, and Kingdoms stay closed.

| Finding | What changed | Its tests |
|---|---|---|
| **K1-UI01:** recovering from a refusal was not serialized | **`resyncHero()`** reads the hero again after a Kingdom refusal. **`runRemote()` keeps `ui.busy` through that read,** so no other action can start until its answer is in ("Still working on your last action"). **The answer is used only if nothing newer replaced the hero meanwhile** (`heroSeq`, counted at every replacement). **While the hero is being read, or if that failed,** Claim is disabled with the reason, and Release isn't offered. **A failure says so** ("Couldn't check your hero"), with Try again (`kresync`), which reads the hero again the same way. **The refusal's message stays on screen.** The claim or release is never sent again by itself | **K3-18:** a stale release, and a refused claim, each with the hero's read held. No Release, Claim disabled, and another action refused and not sent; then the new plot's Release, and one request each. **K3-19:** the hero's read fails. Try again shows, Claim waits, then is offered again; one claim. **K3-20, the ordinary version conflict** (409, no `reason`), on a claim and on a release: no success shown, the Kingdom state unchanged, one request, and a second claim asks again |
| **K1-UI02:** the hero's plot was found by its coordinates | **The hero's own plot is the one whose owner is the hero's character id.** The id comes from `my_character()` (`net.js` `myCharacterId()`, the function chat already reads), only while open. **"Your Kingdom" on the map, and the row Release names, both need it;** coordinates alone never do. **A missing row, or someone else's,** reads the hero again once for that mismatch (`resyncedFor`), so it can't loop, and shows "Plot x, y couldn't be confirmed as your Kingdom", with Try again, instead of Release. **That replaces the "Loading your plot…" that could stay for ever.** A new or deleted hero starts a fresh `ui.kingdom` | **K3-21:** another hero's row at the hero's recorded coordinates. "Claimed by Rival", no Release, nothing carrying Rival's id, the hero read again once (not repeatedly), then the no-Kingdom view once the record catches up. **K3-22:** no row: the message and Try again, not "Loading"; one hero read, and one more on Try again |
| **K1-UI03:** a superseded read could still be used | **Each read is numbered** (`plotsSeq`, `mineSeq`, `findSeq` in `ui.kingdom`), replacing the revision counter. **An answer is used only while its read is the latest of its kind,** for the same account (`gameGen`, and the same `ui.kingdom`) and, for the plots, the same window. **That is checked before the owners read as well as after it.** **`refreshKingdom()`** drops the reads in flight and starts new ones, keeping what is shown. **The finder's answer is dropped** if the window, the selection or the tab changed, or the hero left the Kingdom Zone; its buttons are enabled again | **K3-23:** window A, then B, then A again, with the first read of A held and answered last: the newer plots stay. **K3-24:** a window read held across signing out and another account signing in on the same page: no owners read follows from it, and nothing is sent for the next account. **K3-25:** a finder answer held while the view moves: the view stays, and the finder works again. **K3-26:** a window read held across a refresh (leaving the Kingdom Lands and coming back): the refreshed plots are shown, and the old answer, landing last, is dropped |

**The harness** (`tests/ui/harness.mjs`):
- **`backend.holdRead(kind)`** holds one Kingdom read: a window, the hero's plot, the owners, the finder, or `my_character`. **Its answer is taken when the request arrives,** so it comes back as an old answer (`hold()` answers with the state at release). `release.arrived()` says whether it has come in.
- **Each recorded Kingdom request has its account,** so K3-24 can tell which session sent it.

**Negative controls:**
- **The original head, `ae3e694`** (from a temporary worktree, with the new harness and tests): **7 of the 8 new tests fail.**
  - **K3-24** fails exactly as the review described: the old read sent an owners request under the next account's sign-in.
  - **K3-23 and K3-25** fail on their assertions: the old answer replaced the newer plots, and the finder moved the view back.
  - **K3-18, K3-19, K3-21 and K3-22** fail because the old code has no such state: it never says the hero is being read, or that the plot couldn't be confirmed.
  - **K3-20 passes on the old code.** The version conflict was already handled correctly; the test is the coverage the plan asked for, not a regression.
- **Mutations** (each undoes one fix and runs only the tests meant to catch it, with a 4-minute limit per run, then restores the file; the restored files are unchanged):

| Mutation | Caught by |
|---|---|
| M1: busy cleared before the hero's read (the old order) | K3-18: "no other action was sent before the hero's answer" |
| M2: a failed read of the hero isn't reported | K3-19 |
| M3: Claim isn't held back while the hero is unconfirmed | K3-19 ("Claim waits") |
| M4: "Your Kingdom" by coordinates again | K3-21 |
| M5: any claimed row at those coordinates accepted as the hero's | K3-21 |
| M6: no once-per-mismatch limit | K3-21 and K3-22 |
| M7: no check before the owners read | K3-24 |
| M8: no read number for the plots (window only, as before) | K3-23 |
| M9: the finder's answer used after the view moved | K3-25 |
| M10: a refresh doesn't drop the reads in flight | K3-26: the refreshed read never started, and the old answer was shown |

- **Found by the mutations:**
  - **The first M1 run wasn't caught.** In K3-18's stale-release case, the plot read that follows found the hero's plot changed, and K1-UI02's path then read the hero again while busy. K3-18 now also has a refused claim by a hero without a Kingdom, where only K1-UI01 serializes, and M1 is caught there.
  - **A second owner check in the management view** couldn't be caught. It repeated `loadMine()`'s check, which alone sets the hero's row. It was removed, rather than kept untested.
  - **M10 first passed every test.** Nothing exercised a read in flight across a refresh, the case the review named. K3-26 was added for it. It wasn't run against `ae3e694`, whose revision counter started a fresh read once the old answer had been shown.
  - **K3-18's assertions were reordered** so that the count of requests is checked before waiting for the "Still working" message. M1 now fails on that count.

**Evidence (local, the owner's laptop, 2026-11-26):**
- **`tests/ui/kingdoms.test.mjs`:** 26 of 26 (the 17, plus 9).
- **Engine:** 110 of 110.
- **The full browser suite:** **340 of 340** (332, plus K3-18 to K3-25), in two runs, with the local stack stopped, then **341 of 341** in one run with K3-26. The review accepted two local runs.
- **No new screens:** the corrections change only the new states' text (a notice, and Claim's reason). axe ran on those states in K3-19 and K3-21: 0 violations of any impact.
- **The database suite** wasn't run: no server or database change. CI runs it.

**Not covered:**
- **The 120-second zone-edit read** (`api('state')` after a zone edit removes the hero's zone) existed before K1-3 and isn't serialized with actions. It now counts toward `heroSeq`, so a slower recovery read can't overwrite it, but it can still replace a newer action's answer, as before K1-3. It is outside these findings and unchanged otherwise.
- **`heroSeq`'s guard** has no browser test of its own. With `ui.busy` held, the only other replacement in that window is the 120-second read above.
- **Real devices and screen readers** remain pre-activation work, as the review says.
