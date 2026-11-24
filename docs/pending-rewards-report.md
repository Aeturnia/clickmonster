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

**The `game` function on the local stack** (`tests/db/pending-rewards-api.test.mjs`, 13; 22 after the review corrections, 2.6):
- **How the failing saves are made:** a test-only trigger on the local database, installed and dropped by each test through `supabase db query --file`, and never in a migration.
  - **"Skip"** returns NULL for one hero's update. It **deterministically simulates** the zero-row update a changed version produces, without a second writer (corrected after the review, NB-04). Through it, the ordinary save answers 409, and the atomic save raises `MRVER`, which the function maps to 409. The real code paths run, but the cause of the zero rows is the trigger, not another request.
  - **"Raise"** fails the save outright (500).
  - **"Skip claims"** on `pending_rewards` simulates, in the same way, the zero-row claim that produces a real `MRREW`.
  - **A real conflict between two requests** is PR-5, with no trigger.
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

### 2.3 Evidence at `92f255e` (local, the owner's laptop, 2026-11-23; after the corrections, see 2.6)

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

### 2.6 Review corrections (the review of `92f255e`, 2026-11-24)

**The review's verdict:** changes requested. It accepted the core design: the atomic commit, acting-row staging, the error mapping and the ledger after the commit. It found three blocking issues and five smaller ones. All are corrected on the same PR (#108). The database contract (stage 1) isn't reopened, and #105 isn't touched.

| Finding | The correction | Its test | Detected |
|---|---|---|---|
| **B-01:** retrieval still capped at PostgREST's `max_rows` (1,000), so blocked rewards could hide a later eligible one | `openRewards()` reads in **keyset pages by id** (500 a page, `id > last`), until a page comes back empty. A failed page throws, so the request fails and nothing is committed: a partial read is never taken as the whole waiting list | **B-01:** 1,000 blocked rewards and then a gold-only one, at a full pack. The gold-only one is delivered, and all 1,000 are still waiting | Fails on `92f255e` (the gold-only reward isn't delivered) |
| **B-02:** a blocked reward's slots counted before later rewards of the same pass took a free slot | `stagePending()` counts each blocked reward's slots against the pack **after** every eligible reward of the pass is applied | **B-02** (engine and API), the review's scenario: a full pack, an older reward needing 2 slots, a newer one needing 1, one item sold. The newer one is delivered, the pack is full again, and the older one waits for 2, in the answer and in the saved state | Both fail on `92f255e` (they report 1) |
| **B-03:** the ledger timing wasn't tested for fighting, buying, hunt actions and quest-completing fights | No code change: they were already queued after the commit | **B-03**, four tests, each with **exact amounts and counts.** A failed save writes no entry; then a saved one writes: the fight's gold, once; the price, once; the hunt death's loss (−500), once; and the quest gold (321) and the loot, once each. The sale in PR-9 is now exact too | All four fail on `main`'s function ("no entry … whose save failed") |
| **NB-01:** no test of a first-pass and a second-pass reward in one request | None needed | **NB-01:** a gold-only reward (first pass) and a relic reward (second pass, after a sale) delivered in one request. Each is applied once and recorded once, with an exact ledger entry by its own source, and nothing more on the next request | A mutation, no exclusion of already-staged ids: fails (the RPC is sent a duplicate id) |
| **NB-02:** no test of a killing blow that saves | None needed | **NB-02:** the killing request's own answer already has the share and the killing blow (1,250 gold). Both are claimed, the `hunt` ledger has +1,250 in exactly 2 entries, and nothing more on the next request | A mutation, no second pass after the killing blow: fails |
| **NB-03:** the Gear browser tests used pointer clicks | The two tests now reach the Gear tab (and Explore, and the move) **by keyboard only**: Tab to the control, then Enter. 320 px, desktop and axe (0 of any impact) are kept | The same two tests | Both fail on `main`'s `main.js` |
| **NB-04:** the report called the "skip" trigger a real version conflict | The wording now says it deterministically simulates the zero-row update a changed version produces (2.2, and the test file's header). PR-5 is the real conflict | n/a | n/a |
| **NB-05:** no positive test of gold, XP, item and gems together | None needed | **NB-05** (engine and API): all four delivered and saved | A mutation, no gem delivery: both fail |

**The test counts after the corrections:**
- **engine:** 13 in `tests/rewards.test.mjs` (11 before, plus B-02 and NB-05);
- **the `game` function:** 22 in `tests/db/pending-rewards-api.test.mjs` (13 before, plus B-01, B-02, the four B-03 tests, NB-01, NB-02 and NB-05);
- **browser:** 2, unchanged in number, now by keyboard.

**Detection runs** (local, each on a restarted stack, then restored):

| Code under test | Failing tests |
|---|---|
| The previous stage 2 (`92f255e`) | B-01 and B-02 only (20 of 22 pass) |
| `main`'s `game` function (before stage 2) | 16: PR-1 to PR-4b, PR-6 to PR-10, B-01, B-02 and the four B-03 tests. The four B-03 tests fail on their "no entry for … whose save failed" assertions. PR-5, PR-11, PR-12, NB-01, NB-02 and NB-05 pass: they are guards and positive checks |
| A mutation: no staged-id exclusion | NB-01 |
| A mutation: no second pass after the killing blow | NB-02 |
| A mutation: no gem delivery | NB-05 (API and engine) |

**Evidence after the corrections** (local, 2026-11-24):
- **`npm test`:** 90 of 90.
- **`npm run test:db`:** pgTAP 82 of 82; the API tests 39 passed, 1 opt-in skipped (18 before stage 2, plus 22). PR-5 recorded 7 answers of 200 and 5 of 409.
- **`npm run test:ui`,** with the stack stopped: **315 of 315**.
- **CI:** see the PR's evidence.

**Deviations:** none from the scope.
- **The page size, 500,** is below `max_rows` (1,000), and pagination doesn't depend on it: it stops only at an empty page.
- **The cost:** one more read when a hero has open rewards (the empty last page).

## 3. The production rollout procedure (proposed, for review; nothing in it has been done)

**Status: written for review, after stage 2 merged as `fc189b4` (2026-11-24).**
- **Not done:** no production read, apply, history change or deploy.
- **Authorization:** every step below needs the owner's explicit authorization, separately from approving this procedure. That includes the read-only inspections and any history change. Each gate is authorized on its own.
- **The basis:** it follows the scope's section 7, and the L-3 procedure that put the news migration into production (`docs/landing-l3-report.md`, section 4, with its record in section 12). L-3 is also why production's migration history is deliberately incomplete.

### 3.1 What production is expected to look like, and what is reviewed

**From the L-3 record** (`docs/landing-l3-report.md`, section 12, 2026-11-13): this was **not re-read for this procedure.**
- **The history table** exists and records only `20261115090000` (news). The six earlier versions (`20261112140000` to `20261114090000`) are deliberately unrecorded, although their objects exist.
- **Postgres** is 17.11, the same as the local stack.
- **The deployed `game` function** was version 14, from `e1ffa43` (`docs/sign-out-report.md`, section 22), and `admin` version 8. **Neither was re-read:** the version numbers are read at their gates (3.3 and 3.4), not assumed.

**What goes in.** The reviewed migration is `supabase/migrations/20261123120000_save_hero_with_rewards.sql` on `main` (stage 1, PR #107, merged at `832199f` and unchanged since).
- **Its exact bytes, as git and GitHub store them (LF line endings): SHA-256 `12a5d73ee4884f77177bc20d13065fa6fd61a5e3f1fb7da46c113cc59c7915fe`.**
- **Line endings matter.** A Windows checkout with `core.autocrlf=true` turns the file into CRLF (SHA-256 `3be3856a…`). Applied from that copy, the function's body would carry 30 carriage returns, and its definition wouldn't match the reviewed one: md5 `f825cc85…` instead of `46cea39f…`. This was seen on the local stack.
- **So the file is always taken with `git show main:supabase/migrations/20261123120000_save_hero_with_rewards.sql`,** and its SHA-256 is checked before it is sent.

**The expected installed definition** (NB-03; `supabase/checks/pending_rewards_functiondef.sql`, new and read-only): **md5 `46cea39f9a83b467c847dc4916815ca2`, length 1,329.**
- This is `pg_get_functiondef()` on the local stack (Postgres 17.11), after applying those LF bytes.

### 3.2 Gate A: read-only inspection (the owner's authorization)

As in L-3, all production SQL goes through the Supabase Management API query endpoint (the service the SQL editor uses), with the owner's access token. **Every read runs inside `begin transaction read only; … rollback;`.**

1. **Link the CLI for the history only:** `npx supabase link --project-ref janiqspmhkbsyemkknpv`. It writes only to `supabase/.temp/`, which git ignores.
2. **Read the history:** `npx supabase migration list --linked`. Record the output.
3. **Run `supabase/checks/pending_rewards_precheck.sql`,** read-only, and record all seven rows. The expected results:
   - **row 1:** the Postgres version (expected 17.11);
   - **row 2:** **none**, meaning no function of that name;
   - **rows 3 and 4:** true;
   - **row 5:** exactly the expected column types;
   - **rows 6 and 7:** the history table, with its recorded versions.
4. **Decide how to apply, from steps 2 and 3:**

   | What production shows | How `20261123120000` is applied |
   |---|---|
   | The history records **exactly `20261115090000`** (as expected), row 2 is `none`, and row 5 matches | **By hand** (3.3). `db push` is never used here: with the six earlier versions unrecorded it refuses, and its suggested `--include-all` would re-apply them. `--include-all` is never used |
   | The history records all seven earlier versions and nothing newer | **Through the CLI:** `npx supabase db push --linked --dry-run`, which must list only `20261123120000_save_hero_with_rewards.sql`, then `npx supabase db push --linked` |
   | `20261123120000` already recorded; a function named `save_hero_with_rewards` present; row 5 different; or any other history | **Stop.** Nothing is applied until the owner has looked at what is there |

   **The six earlier versions are never marked applied** because their files exist. That stays as L-3 left it, and reconciling them is a separate decision for the owner.
5. **Unlink, or leave linked only until Gate B** if it follows straight after. Record which.

### 3.3 Gate B: the migration (the owner's authorization, after Gate A)

1. **Run the precheck again** just before applying, and confirm the result is unchanged.
2. **Take the file from `main` and check its SHA-256** is `12a5d73e…7915fe` (3.1).
3. **Apply it as one transaction:** the request is `begin;`, then the file's exact bytes, then `commit;`. Record the endpoint's answer.
   - **Nothing else may be applied.**
   - **The function is inert until Gate C:** the deployed `game` function doesn't call it.
4. **Record only this version** (the manual route): `npx supabase migration repair 20261123120000 --status applied --linked`. Record the output.
5. **Verify,** each read-only:
   - **`supabase/checks/pending_rewards_verify.sql`: all 10 rows `ok`.**
     - the exact signature, and only one function of that name;
     - it returns integer;
     - `security definer`;
     - `search_path` is `public`;
     - no execute for PUBLIC, `anon` or `authenticated`;
     - execute for `service_role`;
     - the history entry.
   - **`supabase/checks/pending_rewards_functiondef.sql`: md5 `46cea39f9a83b467c847dc4916815ca2` and length 1,329** (NB-03). If they differ, the `definition` column is compared line by line with the reviewed migration before anything else is done. A difference is a stop, not a pass.
   - **`npx supabase migration list --linked`** shows `20261115090000` and `20261123120000`, and the six earlier versions still unrecorded.
   - **One refused call through the public API** (non-mutating): `POST /rest/v1/rpc/save_hero_with_rewards` with the publishable key must answer 401 with code `42501`. The privilege check refuses it before the function body runs.
6. **Unlink the CLI,** and record every result in this report (a new section 4, "Production record").

**If any verification fails, roll back** (the owner's authorization):
1. run `supabase/rollback/20261123120000_save_hero_with_rewards_down.sql`, which drops the function;
2. then `npx supabase migration repair 20261123120000 --status reverted --linked`.

This is safe at this gate because nothing calls the function yet. No table or data changes either way.

### 3.4 Gate C: the `game` function (the owner's authorization, only after Gate B's verification passed)

**The `game` function is not deployed before Gate B has passed in full,** all 10 verify rows and the md5 included.
- **Deployed first,** the new function's commit would fail (the RPC doesn't exist).
- **What players would see:** requests with staged rewards would answer 500. The rewards would stay pending, not lost (report 2.4). That is still a broken game, so the order isn't optional.

1. **Read the deployed function,** read-only: `supabase functions list` (or the dashboard). Record its version and update time, expected version 14 from 2026-11-19T15:53:01Z.
   - **Optional, with the owner's authorization:** download its source (read-only), and compare it with `832199f` (section 2.4, and the scope's section 7). That would turn "the deployed function has the defect" from repository evidence into production evidence.
2. **Deploy** from `main` with a clean working tree: `npm run deploy:functions -- game`, with `SUPABASE_ACCESS_TOKEN` set.
   - **Only `game`:** `admin` is unchanged, and the argument keeps the script from deploying it.
   - **Record** the commit SHA and the new version number, as read after the deploy, not assumed.
   - **The deploy script uploads every file in `public/js/engine` and `public/js/data`,** `rewards.js` included (section 2.4).
3. **Boot check:** an unauthenticated call. The function's own answer (401 "Please sign in again.", or 503 if the sign-in service can't be reached) shows the new version boots, including its new import.
4. **The owner's live check:** sign in and play normally (a fight, a move, the Gear tab), with no errors.
   - **If a world-boss hunt is available:** its reward arrives once, with its notice.
   - **Optional:** a full-pack check with the owner's own hero.

   No test data is created in production unless the owner chooses to.

**Rollback:** redeploy `game` from `832199f`, whose function, engine and data files are unchanged since v14's commit `e1ffa43` (`git log e1ffa43..832199f` lists no change to them).
- **This brings back #102's reward loss** on refused or failed requests, and the discarded relic at a full pack, until the fix is redeployed.
- **The database function can stay:** the old code doesn't call it.
- **The client:** the Gear reminder is already live, and harmless without `rewardsWaiting`.

### 3.5 After the rollout

- **The record:** each gate's results go in this report, section 4.
- **Closing #102** is the owner's decision once Gate C's live check is accepted.
- **Not in this procedure:**
  - **Repairing rewards lost before the fix.** Claimed rewards whose effects were never saved can't be told apart from delivered ones by `claimed_at` alone. Any compensation is a separate decision.
  - **#105** (quest completion).
  - **The six earlier history entries.**

### 3.6 Rehearsed on the local stack (2026-11-24)

The database was first put into production's expected state: the function dropped (the rollback script), and the history reduced to `20261115090000` with `migration repair … --status reverted --local`. Then each step ran with `--local` and `psql`:

| Step | Result |
|---|---|
| Precheck | Postgres 17.11; row 2 `none`; rows 3 and 4 true; row 5 exactly the expected types; history `20261115090000` |
| `db push --dry-run --local` | **Refused:** "Found local migration files to be inserted before the last migration on remote database", suggesting `--include-all` with the six earlier files. That confirms the manual route in the decision table |
| The LF bytes applied as one transaction (`psql -1`) | Applied |
| `migration repair 20261123120000 --status applied --local` | Only that version recorded: history `20261115090000, 20261123120000` |
| Verify | **10 of 10 `ok`** |
| Definition check | **md5 `46cea39f9a83b467c847dc4916815ca2`, length 1,329,** with no carriage returns in the body |
| Rollback (the script, then `--status reverted`) | The function gone; verify 0 of 10 `ok`, as it should be before the migration; history `20261115090000` |
| Restored | The function re-applied from the LF bytes, the full local history restored (all eight versions), verify 10 of 10, and the same md5 |

**Not rehearsed:**
- the Management API endpoint itself (L-3 used it, and the rehearsal used `psql` against the local container);
- `supabase link` and `--linked` commands against production;
- the `game` deploy.
