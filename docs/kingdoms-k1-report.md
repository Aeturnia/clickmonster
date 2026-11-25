# Kingdoms K-1: report (#83)

**The plan is [`docs/kingdoms-k1-plan.md`](kingdoms-k1-plan.md):** revision 1, accepted and merged as PR #116 (`55e41f7`, 2026-11-25).
- **The design baseline** is [`docs/kingdoms-scope.md`](kingdoms-scope.md) (K-0, with amendment 1).
- **The stages:** five, each with its own authorization and review gate (plan section 2).
- **The plan's acceptance** carried four implementation qualifications, Q1 to Q4, into the stages. They're recorded on #83 (2026-11-25).

## 1. K1-1: the database foundation (authorized by the owner, 2026-11-25)

**Status: implemented, with the review corrections K1-DB01 to K1-DB03 (1.6), at its re-review gate.**
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
- **`data.kingdom.construction.paid.gold`:** a whole number from 0 to 9,007,199,254,740,991 (JavaScript's `Number.MAX_SAFE_INTEGER`, the engine's largest exact integer; K1-DB02). The hero's gold after the refund must stay within the same range.

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
