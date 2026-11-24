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

**The failure cases are followed by state checks,** not just the error: the rewards named are still unclaimed, and the hero's version and data are unchanged. That is what proves the rollback.
- **Some checks cover a group, not each case** (corrected after the review, NB-02):
  - the four bad id sets share one reward check and one hero check;
  - the missing-id and another-hero's-reward cases each have a reward check, but no hero check of their own;
  - the hero that doesn't exist has no state check.
- **The already claimed and stale version cases** each have their own reward and hero checks.

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

## 2. Stage 2: the `game` function, the engine and the client (authorized by the owner, 2026-11-23)

**Status: implemented, at its review gate.**
- Started after `main`'s CI passed at `832199f` (run 45313508984).
- **No production migration and no `game` deploy.** Stage 2's `game` function needs stage 1's migration in production first (the scope, section 7). Both are later gates.
- **The client half goes live on merge,** because Netlify publishes `public/`: `main.js` and `engine/rewards.js`. It is inert until the new `game` function is deployed. The deployed function (v14) never sets `rewardsWaiting`, so the reminder never shows, and no server behaviour changes (2.4).

### 2.1 What it changes

**`public/js/engine/rewards.js`** (new, shared; the scope's 5.1 and 5.6; question 5):
- **`stagePending(char, open, now)`:** applies in memory every open reward whose items fit in the pack, oldest first (by `id`). Each is applied whole: gold to the bank, XP, gems, items, and the delivery notice, with the same text as before. A reward that doesn't fit is reported as blocked, with the slots it still needs, and never holds back a later one.
- **`settleWaiting(char, blocked, now)`:**
  - sets `char.rewardsWaiting` from the last pass's blocked list, and removes it when that list is empty;
  - adds the notice "A reward is waiting: your pack is full. Free N inventory slots to receive it." **only for a reward that has just become blocked;**
  - returns whether the list changed.
- **`waitingReminder(char)`:** the Gear tab's text.

**`supabase/functions/game/index.ts`:**
- **`claimRewards()` is gone.** `stageRewards()` reads the hero's open rewards, with no cap of 20, and stages them without writing anything. The staged ids, the last pass's blocked list and the second-pass flag live on the acting hero's `row` (the `Staging` type). Only the row `handle()` stages for has them, so a duel's target save can never claim rewards (R-1).
- **`saveRow()`:**
  1. runs `finishStaging()`: the second pass (question 4) when something was blocked or rewards were created, then `settleWaiting()`;
  2. commits through `save_hero_with_rewards()` when rewards are staged, and through the ordinary versioned update otherwise;
  3. maps `MRREW` and `MRVER` to 409, "Your hero was busy — try again.". `MRARG` and anything else is a server error (500);
  4. writes the row's queued ledger entries only after the commit.
- **`state` reads** stage rewards, and save when rewards were staged or the waiting list changed, even if nothing else changed. A read whose commit conflicts answers 409, with no automatic retry (question 1).
- **The killing blow:** `huntAction()` no longer claims. It marks the row for a second pass, so the hunt's rewards are staged at the commit, after the action's ledger delta is taken. `delivered` is 0 on that path.
- **The ledger, after the commit (question 2):** all four save-dependent ledger writes are queued on the row (`queueLedger()`) and written after its save (`flushLedger()`):
  - pending rewards;
  - quest rewards;
  - hunt actions;
  - ordinary actions.

  No amount, source or announcement changed. The quest announcement is #105's.

**`public/js/main.js`, the Gear tab (question 3):**
- **A plain paragraph** under "Pack (N)" while a reward waits, for example "40 / 40 inventory slots. 1 reward waiting. Free 1 inventory slot to receive it."
- **No live region:** the one-time notice announces it.
- **It disappears** when the server's answer has no waiting reward.
- **The wording counts inventory slots** (the limit counts equipped items too), so it never contradicts "Pack (N)".

### 2.2 The tests

**Engine** (`tests/rewards.test.mjs`, 11):
- indivisibility at 39 and at 40;
- gold and XP only at a full pack;
- a blocked relic followed by a gold-only reward;
- two items at one and at two free slots;
- oldest first, with an earlier reward's items counting;
- more than 20 open rewards, with the blocked ones first;
- the delivery notice text;
- the waiting notice added once and not repeated;
- the list removed when empty;
- the Gear text.

**The `game` function on the local stack** (`tests/db/pending-rewards-api.test.mjs`, 13):
- **How the failing saves are made:** a test-only trigger on the local database, installed and dropped by each test through `supabase db query --file`, and never in a migration.
  - **"Skip"** returns NULL for one hero's update, a real version conflict: 409 from the ordinary save, and `MRVER` mapped to 409 from the atomic one.
  - **"Raise"** fails the save outright (500).
  - **"Skip claims"** on `pending_rewards` gives a real `MRREW`.
- **These calls go through** the real `game` function, its service-role client and PostgREST. That is NB-01.

**The old-code check:** the same file was run against `main`'s `game` function (`832199f`), on a restarted stack, then the new code was restored:

| Case | What it checks | Old code | New code |
|---|---|---|---|
| PR-1 | An action refused with 429 | **Fails:** the reward is claimed and never delivered | Passes |
| PR-2 | An action refused by a rule (healing at full health) | **Fails:** claimed, not delivered | Passes |
| PR-3 | An action whose save conflicts (409) | **Fails:** claimed, not delivered | Passes |
| PR-4 | A `state` read whose save conflicts (409) | **Fails:** claimed, not delivered | Passes |
| PR-4b | A `state` read whose save fails outright (500) | **Fails:** claimed, not delivered | Passes |
| PR-6 | The killing blow, then a failed save | **Fails:** the share and the killing-blow reward are claimed and lost | Passes: both pending, then delivered once (1,250 gold) |
| PR-7 | A full pack, a later gold-only reward, then selling to free a slot | **Fails:** the relic reward is claimed with its item discarded | Passes: whole reward pending; one notice, not repeated; a read with nothing new doesn't save; the gold-only reward is delivered; selling delivers the relic in the same request |
| PR-8 | A reward needing two free slots | **Fails:** claimed with its items discarded | Passes |
| PR-9 | Ledger timing, for a pending reward and a sale | **Fails:** a failed save still writes the ledger | Passes: no entry on a failed save, one after the commit |
| PR-10 | A reward claim conflict (`MRREW`) | **Fails:** answers 200 | Passes: 409, nothing written |
| PR-5 | Four requests at once, three rounds | Passes (design guard) | Passes: each reward delivered exactly once. On the last local run, 7 answers of 200 and 5 of 409 (recorded, not asserted) |
| PR-11 | R-1: a duel's target save | Passes (design guard) | Passes: the target's own reward isn't claimed or delivered by the attacker's request |
| PR-12 | The RPC refused to the anon key and to a signed-in player (`42501`) | Passes (design guard) | Passes |

Each old-code failure was checked for its reason: an assertion that the reward was still unclaimed, or the ledger unchanged. None was a setup error.

**One behaviour change that question 1 accepted:** when two requests read the same pending reward before either commits, one delivers it and the other now answers 409. Examples are two tabs loading, or an action racing a `state` refresh.
- **The old code** answered 200 to the loser, and could lose the reward.
- **What the player sees,** read in the client, not tested: an action's 409 shows its usual "Your hero was busy — try again." On the very first `state` call of a page, the entrance's existing failure path shows the same message with Try again (`entry.js`, the `catch` after `start()`).
- **No automatic retry was added** (question 1).

**Browser** (`tests/ui/game.test.mjs`, 2): the Gear reminder at 320 px and on desktop.
- its exact text;
- not inside a live region;
- axe with 0 violations of any impact;
- gone once the next answer has no waiting reward.

Both fail on `main`'s `main.js`, and pass with the change.

### 2.3 Evidence (local, the owner's laptop, 2026-11-23)

- **`npm test`:** 88 of 88 (77 before, plus 11).
- **`npm run test:db`,** on a restarted stack with the new code:
  - pgTAP 82 of 82;
  - the API, function, recovery, session and pending-rewards tests: 30 passed, 1 opt-in skipped (18 before, plus 13).
- **`npm run test:ui`,** with the stack stopped: **315 of 315** (313 before, plus 2).
- **CI:** see the PR's evidence.

### 2.4 Not done in stage 2

- **No production migration and no `game` deploy.**
  - The order is the scope's section 7: stage 1's migration, verified, then the `game` deploy.
  - At the migration gate, compare `pg_get_functiondef()` with the reviewed migration (NB-03).
  - The `game` version is read at the deploy gate, not assumed.
- **What merging does publish:** Netlify publishes `public/js/main.js` and `public/js/engine/rewards.js`. They are inert against the deployed `game` function (v14), which never sends `rewardsWaiting`. Nothing else in the client changes.
- **The wrong order, reasoned, not tested:** if the new `game` function were deployed before the migration, its call to `save_hero_with_rewards()` would fail. Requests with staged rewards would answer 500, and the rewards would stay pending, not lost. Requests without rewards would be unaffected. The gate order (migration first) stands.
- **#105 (quest completion)** is unchanged. Only its ledger write moved after the save.
- **Kingdoms:** `kingdom_claim()` and `kingdom_release()` don't exist yet. They will take the staged ids (Kingdoms amendment 1).

### 2.5 Deviations

- **None from the scope's design.**
- **Two details settled in the implementation:**
  - **The full-pack notice's wording:** "Free N inventory slots" rather than "make room for N items", to match the reminder and the limit's own counting.
  - **The second pass's trigger** is the scope's: something was blocked, or rewards were created. It re-reads the hero's open rewards once.
