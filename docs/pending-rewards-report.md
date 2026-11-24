# Pending rewards delivered exactly once: report (#102)

The scope is [`docs/pending-rewards-scope.md`](pending-rewards-scope.md), accepted and merged as PR #104 (`99d2055`, 2026-11-23). The review recommended two independently reviewable stages:
1. **the database migration and its atomicity tests;**
2. **the `game` function and client changes,** with end-to-end regression tests.

## 1. Stage 1: the database function (authorized by the owner, 2026-11-23)

**Status: implemented, at its review gate.**
- Nothing calls the function until stage 2.
- **No production migration and no deploy:** it was applied only to the local stack, and runs in CI.

### 1.1 What it adds

**`supabase/migrations/20261123120000_save_hero_with_rewards.sql`:** `save_hero_with_rewards()`, as in the scope's 5.2.
- **The signature** is the scope's: `(p_char uuid, p_version int, p_data jsonb, p_name text, p_level int, p_zone text, p_x int, p_y int, p_reward_ids bigint[]) returns int`. The public columns match `publicColumns()` in the `game` function.
- **The order is the scope's:**
  1. refuse a bad id set;
  2. claim the rewards (owned by `p_char`, unclaimed), and raise unless every id was claimed;
  3. save the hero with the version check;
  4. return the new version.
- **Any raise rolls back both updates.**
- **Declared** `security definer`, with `set search_path = public`.
- **Execute** is revoked from PUBLIC, `anon` and `authenticated`, and granted to `service_role` only. It uses `create or replace`, with the grants restated, so it is safe to re-run.

**Its errors.** Each has a fixed SQLSTATE and message, so stage 2 can tell a conflict from a mistake:

| SQLSTATE | Message | When | Stage 2 maps it to |
|---|---|---|---|
| `MRREW` | `rewards_conflict` | A reward is already claimed, another hero's, or missing (or the hero doesn't exist) | 409, "Your hero was busy — try again." |
| `MRVER` | `version_conflict` | The hero's version has changed | 409, as above |
| `MRARG` | `invalid_reward_ids` | The id set is null, empty, has a null element, or has a duplicate | A server error (500): a programming mistake, not "busy" |

- **None is in PostgREST's `PT` class,** which PostgREST would read as an HTTP status. PostgREST answers these with 400 and reports the SQLSTATE as the error's `code`. Stage 2 maps the code, not the HTTP status.
- **Stage 2's review** should check that a real `MRREW` or `MRVER` reaches the player as HTTP 409 (the review of PR #104).

**The scripts,** following the news migration's pattern (`docs/landing-l3-report.md`, section 4):
- **`supabase/checks/pending_rewards_precheck.sql`** (read-only): no function of that name exists, the columns it relies on have the expected types, and the migration history.
- **`supabase/checks/pending_rewards_verify.sql`** (read-only), with 10 rows:
  - the exact signature, and only one function of that name;
  - the return type;
  - `security definer`;
  - the `search_path`;
  - execute for PUBLIC, `anon`, `authenticated` and `service_role`;
  - the history entry.
- **`supabase/rollback/20261123120000_save_hero_with_rewards_down.sql`:** drops the function. Its header says to drop it only while no deployed `game` function calls it, and that redeploying the old `game` function brings back #102's reward loss.

**`supabase/tests/pending_rewards.test.sql`:** 40 pgTAP assertions (1.2).

### 1.2 The tests (pgTAP, 40)

**After every failure case,** the test checks the state, not just the error. The rewards the call named are still unclaimed, and the hero's version and data are unchanged. That is what proves the rollback.

- **The function and its privileges (11):**
  - the signature, the return type, `security definer` and the `search_path`;
  - no execute for PUBLIC, `anon` or `authenticated`, and execute for `service_role`;
  - calls as `anon` and as `authenticated` refused with `42501`, with the reward still unclaimed afterwards.
- **A bad id set (6):** empty, null, a null element and a duplicate are refused with `MRARG`. Afterwards the reward is unclaimed and the hero unchanged.
- **Reward conflicts (8):** refused with `MRREW`, each followed by the state checks:
  - a set with an already claimed reward: its other reward's claim is rolled back;
  - another hero's reward;
  - a missing id;
  - a hero that doesn't exist.
- **A stale version (3):** refused with `MRVER`. Both named rewards are still unclaimed: **the claims made before the version check rolled back.** The hero is unchanged.
- **Success (6):**
  - it returns version 1;
  - both named rewards are claimed;
  - a reward not named stays unclaimed;
  - the other hero's reward stays unclaimed;
  - the hero's data and public columns are saved;
  - the other hero is untouched.
- **Retries after success (3):**
  - replaying the same call is refused (`MRREW`);
  - claiming a delivered reward again at the current version is refused;
  - the hero still has version 1, with the delivery saved once.
- **A later delivery (3):** the remaining reward is delivered at the current version (returning 2), and no unclaimed reward is left.

**The fixtures** insert two `auth.users` rows (`@example.test`) and two heroes, inside the test's transaction, which is rolled back. Reward ids are generated, so each fixture is found by its note.

**Concurrency** between two real sessions isn't tested in pgTAP, which runs in one session. The deterministic conflicts (an already claimed id, a stale version) are proved here. Two requests at once is stage 2's case 5, on the local stack.

### 1.3 Evidence (local, the owner's laptop, 2026-11-23)

**The local stack:** Docker Desktop 29.7.2. `npx supabase db reset` applied every migration, the new one last. The browser suite wasn't running.

**`npx supabase test db`:** **82 of 82** (news 42, pending rewards 40), on the first run.

**Mutation checks.** Each broke the function on the local database only; the tests caught it; then the original was re-applied.

| Mutation | Result |
|---|---|
| Remove the reward-count check (`n_claimed <> n_ids`) | **Caught:** 8 failures, including the rollback checks after an already claimed, another hero's and a missing reward |
| Grant execute to `anon` and `authenticated` | **Caught:** 4 failures: the two privilege checks and the two refused calls |
| Remove the version check (`n_saved = 0`) | **Caught:** 2 failures: the stale version is refused, and the claims made before the version check rolled back |
| The original, re-applied | 82 of 82 |

**The scripts, on the local database:**
- **the verify script:** 10 of 10 rows `ok`, the history entry included;
- **the precheck after the migration:** row 2 lists the function, so it detects that it exists. The column types match the expected text;
- **the rollback:** the function is gone, and the precheck's row 2 then reads `none`;
- **re-applying the migration twice** works, and the verify script is still 10 of 10.

**`npm run test:db`** (pgTAP, then the API, function, recovery and session tests): pgTAP 82 of 82; 17 passed and 1 opt-in test skipped, as before.

**`npm test`:** see the PR's evidence.

**CI:** see the PR's evidence: the run's id, with engine, browser and database.

### 1.4 Not done in stage 1

- **The `game` function** still uses `claimRewards()` and `saveRow()`, unchanged. Nothing calls the new function. The staging rule, the ledger order (question 2), the Gear reminder (question 3) and the end-to-end regression cases are stage 2.
- **No production read, migration or deploy.** Applying the migration to production follows the L-3 procedure, at its own gate.
- **Not verified:** the deployed `game` function's source (the scope, section 10).

### 1.5 Deviations

- **None from the scope's 5.2.**
- **Added beyond 5.2:**
  - the third error code, `MRARG`, so a programming mistake isn't reported as "busy";
  - the refusal of a null id inside the set.
