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

**Status: revised after the independent review of `a42f2ff` (2026-11-24, changes requested).** The first version was written after stage 2 merged as `fc189b4`.
- **Not done:** no production read, apply, history change, deploy or rollback.
- **Authorization:** every gate needs the owner's explicit authorization, separately from approving this procedure, including the read-only gate.
- **Nothing moves automatically from one gate to the next.** Each gate ends with its evidence returned for independent review.
- **The basis:** the scope's section 7, and L-3's procedure and record (`docs/landing-l3-report.md`, sections 4 and 12).
- **Corrections:** the review's are listed in 3.8.

### 3.1 The baseline, and what is reviewed

**What production is expected to show,** from the L-3 record and the sign-out record. **This was not re-read: Gate A confirms it or stops.**
- **The migration history table** records **exactly `20261115090000`**. The six earlier versions are deliberately unrecorded, although their objects exist.
- **Postgres** 17.11.
- **The `game` function:** version 14, updated 2026-11-19T15:53:01Z, from `e1ffa43`.
- **The `admin` function:** version 8.

**The migration:** `supabase/migrations/20261123120000_save_hero_with_rewards.sql`, unchanged from stage 1's merge (`832199f`) through stage 2's (`fc189b4`).
- **Its exact bytes,** as git and GitHub store them (LF): **SHA-256 `12a5d73ee4884f77177bc20d13065fa6fd61a5e3f1fb7da46c113cc59c7915fe`.**
- **A Windows checkout with `core.autocrlf=true` makes it CRLF** (`3be3856a…`). Applied from that copy, the body would carry 30 carriage returns. So the file is always taken with `git show fc189b4:<path>`, and its hash is checked.

**The expected installed function** (`supabase/checks/pending_rewards_state.sql`, new and read-only; local stack, Postgres 17.11, from the LF bytes):
- **the definition:** md5 **`46cea39f9a83b467c847dc4916815ca2`**, length **1,329**;
- **the owner:** **`postgres`**. It is `SECURITY DEFINER`, so it runs as its owner (NB-03).

**The `game` payload:** what `tools/deploy-functions.mjs game` uploads, pinned to **`fc189b4`**: `index.ts` and every `.js` file in `public/js/engine` and `public/js/data`.
- **The bytes:** 25 files, each byte-identical to `fc189b4`, as checked by `tools/function-payload.mjs` (new and read-only, 3.6).
- **The payload hash:** **`1ccf3b355dd6b13bf587ef62f6d749ad265f09a94b2b0df40ae9066107f17f5a`.**
- **The deploy script uploads the checkout's files as they are on disk.** A CRLF checkout is a different payload, so the deploy runs from an LF checkout pinned at that commit.

**The rollback payload:** pinned to **`832199f`**. Its 24 files are byte-identical to `e1ffa43`'s (v14's commit), payload hash **`e49abd5259aa499147800a38941f14f4434dc7962e448a0b4742f4ddf4442a0f`**, by the same tool.

### 3.2 How production is read

**Gate A uses only the Supabase Management API, with the owner's access token:**
- `GET /v1/projects/janiqspmhkbsyemkknpv/functions` for the functions;
- the SQL query endpoint (`POST /v1/projects/janiqspmhkbsyemkknpv/database/query`) for the database. That is the service the SQL editor uses, and the one L-3 used.

**No CLI in Gate A** (B-01). L-3's record shows that `supabase link`, used to read the history, created the CLI's usual short-lived login role in production. So Gate A doesn't link the CLI, and reads the history from `supabase_migrations.schema_migrations` with SQL.

**Every SQL read is sent as one request of the form `set transaction read only;` followed by one check file.**
- **The check files** (`pending_rewards_precheck.sql`, `pending_rewards_verify.sql` and `pending_rewards_state.sql`) are each a single `SELECT`. The prefix makes the request's transaction read-only.
- **On the local stack,** this form returned the check's result, and refused a write (`cannot execute CREATE TABLE in a read-only transaction`).
- **Not rehearsed:** how the production endpoint handles the two statements. If it doesn't return the `SELECT`'s rows, the check alone is sent. A single `SELECT` can't write, and the report says which form was used.

### 3.3 Gate A: the read-only inspection (the owner's authorization)

1. **The functions,** with `GET …/functions`. Record `game`'s and `admin`'s version, status, update time and `verify_jwt`.
   - **Expected:** `game` version 14, from 2026-11-19T15:53:01Z, ACTIVE, `verify_jwt` false; `admin` version 8.
2. **The state,** with `pending_rewards_state.sql`. Expected:
   - `function_present` false;
   - `history_recorded` false;
   - `history_versions` exactly `20261115090000`.
3. **The precheck,** with `pending_rewards_precheck.sql`. Expected:
   - row 1, 17.11;
   - row 2, `none`;
   - rows 3 and 4, true;
   - row 5, exactly the expected column types;
   - row 6, true;
   - row 7, `20261115090000`.
4. **Optional, with the owner's authorization:** download `game`'s deployed source (`GET …/functions/game/body`), and compare it with `e1ffa43`.
   - **Not rehearsed:** the format of what that endpoint returns, and whether it can be compared file by file. If it can't, the report says so.

**Stop conditions:** anything other than every "expected" above. That includes another function version, any other history entry (for example the six earlier versions now recorded), the function already present, or any column type difference.
- **The response is the same in every case:** stop, record the evidence, and return it for review.
- **There is no alternative route** (B-02). No `db push`, no `--include-all`, and no reconciling of the earlier history entries in this rollout.

**At the end of Gate A:** independent review of the evidence, then the owner's authorization for Gate B.

### 3.4 Gate B: the migration (the owner's authorization, after Gate A's review)

**Applying and verifying:**
1. **Re-read the state** (`pending_rewards_state.sql`), and confirm it is unchanged from Gate A.
2. **Take the file:** `git show fc189b4:supabase/migrations/20261123120000_save_hero_with_rewards.sql`. Check its SHA-256 is `12a5d73e…7915fe`.
3. **Apply it** through the query endpoint as one request: `begin;`, the file's exact bytes, `commit;`. Record the endpoint's answer. Nothing else is applied.
4. **Record only this version in the history:** `npx supabase migration repair 20261123120000 --status applied --linked`, after `npx supabase link --project-ref janiqspmhkbsyemkknpv`.
   - **Disclosed:** as L-3 found, the CLI may create its short-lived login role in production for this. That is a transient change, and the owner's authorization of Gate B includes it.
   - **Then unlink.** Record the outputs.
5. **Verify,** each read-only:
   - **`pending_rewards_verify.sql`:** all 10 rows `ok`;
   - **`pending_rewards_state.sql`:**
     - `function_present` true;
     - `definition_md5` `46cea39f9a83b467c847dc4916815ca2`;
     - `definition_length` 1,329;
     - `owner` `postgres`;
     - `history_recorded` true;
     - `history_versions` exactly `20261115090000, 20261123120000`, with the six earlier versions still unrecorded;
   - **one refused call with the publishable key** (NB-01): `POST /rest/v1/rpc/save_hero_with_rewards`, with the body `{"p_char":"00000000-0000-4000-8000-000000000000","p_version":0,"p_data":{},"p_name":"probe","p_level":1,"p_zone":"probe","p_x":1,"p_y":1,"p_reward_ids":[]}`.
     - **It must answer HTTP 401 with SQLSTATE `42501`.**
     - **The empty id array** means that even if execute were wrongly granted, the function would refuse with `MRARG` (400) before writing anything. That would itself be a stop.
6. **Record every result** (section 4, "Production record").

**If a step fails, times out, or its answer is unclear** (B-03):
- **Read the actual state** with `pending_rewards_state.sql`, read-only.
- **Act only by this table.**
- **No step is retried, re-applied, repaired or rolled back automatically.** Every corrective change is a new authorization.

| `function_present` and the definition | `history_recorded` | Meaning | What happens |
|---|---|---|---|
| false | false | The migration wasn't applied | **Stop.** Record the apply's answer. A new apply needs a new authorization |
| true, md5 and owner as expected | false | The migration was applied; the history repair is incomplete | **Stop.** Repeating the repair (step 4) needs the owner's authorization |
| false | true | Inconsistent | **Stop.** Investigate before anything else |
| true, md5 and owner as expected | true | Applied and recorded | **Go on** with the rest of step 5 |
| true, md5 or owner not as expected | either | Not the reviewed function | **Stop.** Compare the `definition` column line by line with the reviewed migration, and report |

**Rollback, separately authorized:**
1. **Drop the function:** `supabase/rollback/20261123120000_save_hero_with_rewards_down.sql`, through the query endpoint.
2. **Then the history:** `npx supabase migration repair 20261123120000 --status reverted --linked` (linked as in step 4, then unlinked).
3. **Then verify the rollback** (NB-04), read-only:
   - **the state:** `function_present` false, `history_recorded` false, and `history_versions` exactly `20261115090000`. The earlier entries are untouched: still only that one;
   - **the precheck:** row 2 `none`.

This is safe at Gate B, because nothing calls the function until Gate C.

**At the end of Gate B:** independent review of the installed database contract, then the owner's authorization for Gate C.

### 3.5 Gate C: the `game` function (the owner's authorization, after Gate B's review)

**Before the deploy:**
1. **Re-read the functions** (`GET …/functions`). `game` must be at the version recorded in Gate A. Any other version is a stop (NB-05, B-04).
2. **Make the pinned checkout**, outside the repository: `git -c core.autocrlf=false worktree add --detach ../cm-deploy-fc189b4 fc189b4`. The `-c` makes it LF.
3. **Check the payload and the target** (B-04): `node tools/function-payload.mjs game --rev fc189b4 --root ../cm-deploy-fc189b4`, with `SUPABASE_PROJECT_REF` unset. It must print:
   - 25 files, each `matches`;
   - `target project: janiqspmhkbsyemkknpv (the default)`;
   - `payload: 1ccf3b35…7f5a`;
   - the `RESULT` line saying every file is byte-identical and the target is production.
   - **Anything else is a stop.**
   - **A later revision of `main`** may be used instead of `fc189b4` only if the tool shows its payload hash equals `1ccf3b35…`, and that is reviewed.

**The deploy and its checks:**
4. **Deploy `game` only,** from that checkout: `node tools/deploy-functions.mjs game`, run in `../cm-deploy-fc189b4`, with `SUPABASE_ACCESS_TOKEN` set and `SUPABASE_PROJECT_REF` unset.
   - **The slug argument** keeps `admin` out of the deploy.
   - **Record** the script's output, then re-read the functions: the new version (read, not assumed) and its update time.
5. **The boot check** (NB-02): `POST https://janiqspmhkbsyemkknpv.supabase.co/functions/v1/game` with `{"action":"state"}` and no token.
   - **It must answer HTTP 401 with `{"error":"Please sign in again."}`,** the function's own answer, which shows the new version boots and imports `rewards.js`. Rehearsed locally.
   - **A 503** ("Can't reach the sign-in service") is not a pass: it doesn't show readiness. The check is repeated later, and Gate C doesn't go on until it passes.
   - **A 500, or a platform error,** is a stop, with rollback considered (owner's authorization).
6. **Database verification after the deploy** (B-05, the scope's section 7): `pending_rewards_verify.sql` 10 of 10, and `pending_rewards_state.sql` unchanged from Gate B.
7. **The owner's live checks:**
   - **The smoke check:** sign in and play normally (a fight, a move, the Gear tab), with no errors.
   - **The two behavioural checks the scope requires:**
     1. **a world-boss hunt reward delivered exactly once,** with its notice;
     2. **a pending reward surviving a refused action:**
        - while the owner's hero has a pending reward, an action the game refuses (for example healing at full health in town) answers its error;
        - a read-only query shows the reward still unclaimed;
        - the next request delivers it, once.
   - **If those conditions don't arise naturally:**
     - **behavioural verification is recorded as pending,** and #102 stays open;
     - **creating them is the owner's decision,** and isn't assumed: for example, starting a hunt from the admin console, or inserting a pending reward for the owner's own hero. No production test data is created, no criterion is waived, and #102 isn't closed without the owner's explicit decision.

**Rollback, separately authorized:**
1. **The pinned checkout:** `git -c core.autocrlf=false worktree add --detach ../cm-deploy-832199f 832199f`.
2. **The payload check:** `node tools/function-payload.mjs game --rev 832199f --root ../cm-deploy-832199f` must print 24 files, all `matches`, the production target, and payload `e49abd52…0a0f`. That is byte-identical to `e1ffa43`, v14's source.
3. **Deploy `game`** from that checkout.
4. **The boot check,** as in step 5.

**What the rollback costs:**
- **It brings back #102's reward loss** on refused or failed requests, and the discarded relic at a full pack, until the fix is redeployed.
- **The database function stays** (the old code doesn't call it).
- **The client's Gear reminder** stays harmless without `rewardsWaiting`.

**Afterwards:** remove the pinned checkouts (`git worktree remove`).

**At the end of Gate C:** independent review of the production evidence, then the owner's decision on closing #102.

### 3.6 The tools and checks

| File | What it does | Writes? |
|---|---|---|
| `supabase/checks/pending_rewards_precheck.sql` (stage 1) | No such function yet, the column types, the history | No (one `SELECT`) |
| `supabase/checks/pending_rewards_verify.sql` (stage 1) | The 10 checks of the installed function and its grants | No (one `SELECT`) |
| `supabase/checks/pending_rewards_state.sql` (new; replaces the first version's `pending_rewards_functiondef.sql`) | One row: present or not, the definition's md5, length and owner, whether the history records the migration, every recorded version, and the definition text | No (one `SELECT`) |
| `supabase/rollback/20261123120000_save_hero_with_rewards_down.sql` (stage 1) | Drops the function | Yes (rollback only) |
| `tools/function-payload.mjs` (new) | What `deploy-functions.mjs <slug>` would upload from a given checkout: each file's size and SHA-256 compared byte for byte with a pinned revision, no file missing, the target project, and a payload hash. It exits 1 on any difference, or a target other than production | No (reads files and git; never calls Supabase) |

### 3.7 Rehearsed on the local stack (2026-11-24)

**From the first version, unchanged:**
- **The setup:** the local database was put in production's expected state, with the function dropped and the history reduced to `20261115090000`.
- **The precheck** matched.
- **`db push --dry-run --local`** refused ("Found local migration files to be inserted before the last migration on remote database"), suggesting `--include-all`, which this procedure never uses.
- **The LF bytes** applied as one transaction.
- **The history repair** recorded only `20261123120000`.
- **Verify:** 10 of 10.
- **The rollback** gave verify 0 of 10 and the history `20261115090000`.
- **Everything was restored** afterwards.

**For this revision:**

| Rehearsal | Result |
|---|---|
| The read form: `set transaction read only;` then a check, in one request (`psql -c`) | The check's row returned. The same form with a write was refused: "cannot execute CREATE TABLE in a read-only transaction". The probe table doesn't exist afterwards |
| The five states of 3.4's table, each read with `pending_rewards_state.sql` (columns: present, md5, length, owner, recorded, versions) | **Applied and recorded:** `t`, `46cea39f…`, 1,329, `postgres`, `t`, …, `20261115090000`, `20261123120000`. **Applied, not recorded:** the same, but `f`. **Neither:** `f`, none, none, none, `f`. **Recorded, not present:** `f`, none, none, none, `t`. **Present, unexpected** (the CRLF copy): `t`, `f825cc85…`, 1,359, `postgres`, `t`. Each state is distinct |
| The refusal probe (NB-01), with the exact body | Correct grants: `42501`, HTTP 401. With execute wrongly granted to `anon`: `MRARG`, HTTP 400, and nothing written. Restored: `42501` again |
| The boot check (NB-02), against the local `game` function | No token: HTTP 401 `{"error":"Please sign in again."}`. The anon key: the same |
| `tools/function-payload.mjs` | **This Windows checkout** (CRLF) against `fc189b4`: every file `DIFFERS (LF vs disk CRLF)`, exit 1. **An LF checkout at `fc189b4`:** 25 files match, the production target, payload `1ccf3b35…`, exit 0. **The same with `SUPABASE_PROJECT_REF` set to another project:** `NOT PRODUCTION`, exit 1. **The `fc189b4` checkout pinned to `832199f`:** exit 1, since `rewards.js` isn't in that revision. **An LF checkout at `832199f`,** pinned to `832199f` and to `e1ffa43`: both match, 24 files, payload `e49abd52…` |

**Not rehearsed** (they need production):
- the Management API's query endpoint, and how it treats the two-statement read form;
- `GET …/functions` and `…/functions/game/body`;
- `supabase link` and `--linked` repair against production;
- a deploy;
- production's function owner: `postgres` is the local value, and a different owner is a stop for review, not a failure assumed in advance.

### 3.8 The review of `a42f2ff`: corrections, and decisions for the owner

| Finding | The correction |
|---|---|
| **B-01:** Gate A wasn't strictly read-only (the CLI link can create a login role) | Gate A uses only the Management API, with read-only requests. The CLI is linked only in Gate B, for the history repair, with its transient role disclosed and covered by Gate B's authorization (3.2 to 3.4) |
| **B-02:** an alternative `db push` route contradicted Gate B's verification | Removed. Only the expected manual route remains. Any other history or state is a stop for review (3.3) |
| **B-03:** no handling of partial or unclear results | The state check and the five-state table. Read first, then stop or go on, with no automatic retry, re-apply, repair or rollback (3.4) |
| **B-04:** the deploy wasn't pinned | An LF checkout pinned at `fc189b4`. The payload checker verifies every uploaded file, nothing missing, the target project and the payload hash. The function version is re-read before the deploy, and the same is done for the rollback at `832199f` (3.1, 3.5) |
| **B-05:** missing live checks | Restored: the verify script after the deploy, a hunt reward delivered exactly once, and a pending reward surviving a refused action. If those conditions don't arise, behavioural verification stays pending and #102 stays open (3.5) |
| **NB-01** | The probe's exact body, with an empty id array, and the required `42501` |
| **NB-02** | Only 401 "Please sign in again." passes. 503 doesn't |
| **NB-03** | The owner is in the state check, expected `postgres` |
| **NB-04** | Verification after a Gate B rollback |
| **NB-05** | The functions' metadata is read in Gate A, and again before the deploy |

**Deviations from the scope's section 7:**
- **None in substance:** the migration first, the precheck and verify, the deploy after, rollback by redeploying the previous version, and the live checks.
- **Added:**
  - the state check;
  - the payload checker;
  - pinned checkouts;
  - Gate A's API-only reads;
  - the stop table.

**Decisions only the owner can make** (at the gates, not now):
1. **Authorizing the CLI's transient login role in Gate B.** That is the route L-3 used and this one rehearsed. Writing the history entry with SQL instead would avoid it, but it isn't rehearsed and isn't proposed.
2. **If the live behavioural conditions don't arise:** whether to create them (a hunt started from the admin console, or a pending reward for the owner's own hero), or to leave that verification pending.
3. **Closing #102.**

## 4. Production record

Each gate was authorized by the owner on its own, and run by the procedure in section 3 (merged as PR #109, `758c741`), with the safeguards OP-01 to OP-04.
- **All production SQL** went through the Supabase Management API's query endpoint, with the owner's access token. The token was never printed or recorded.
- **Every read** was sent as `set transaction read only;` plus the exact reviewed check file from `main`. That form returned the check's rows each time, so OP-01's fallback wasn't needed.

### 4.1 Gate A: the read-only inspection (2026-11-24, 14:04:16 to 14:04:18 UTC)

- **The authorization:** the owner authorized it with PR #109's merge.
- **Method:** the Management API only. **No CLI and no link,** and nothing was written. `main` was at `758c741`.

| Check | Expected | Production |
|---|---|---|
| `game` | v14, ACTIVE, `verify_jwt` false, 2026-11-19T15:53:01Z | **v14**, ACTIVE, `verify_jwt` false, updated 2026-11-19T15:53:01.715Z, `ezbr_sha256` `af1b47addd9cdab72e3d4fe894d643cc686320f0f3222e7ac48598143f5083db` |
| `admin` | v8 | **v8**, ACTIVE, `verify_jwt` false, updated 2026-11-14T00:38:35.393Z, `ezbr_sha256` `572f2b2c3581588407c24efd7ed4ee315b25e2064b1a51e8a15bc2206146ef64` |
| State: `function_present`, `history_recorded`, `history_versions` | false, false, `20261115090000` | **false, false, `20261115090000`** |
| Precheck rows 1 to 7 | 17.11; none; true; true; the 12 expected column types; true; `20261115090000` | **identical** |

- **Not done:** the optional download of `game`'s source (not separately authorized).
- **Not shown:** that the read-only prefix is enforced in production. Testing it would take a write.
- **The review:** Gate A was accepted in independent review on 2026-11-24, with no stop conditions.

### 4.2 Gate B: the migration (2026-11-24, 14:30:07 to 14:32:09 UTC)

- **The authorization:** the owner authorized it after Gate A's review, including the CLI's temporary login role for the history repair.

1. **The baseline again** (OP-02), read-only, at 14:30:07 to 14:30:08: the functions (`game` v14, `admin` v8, the same `ezbr_sha256` values), the state and the full precheck. **All identical to Gate A.**
   - `SUPABASE_PROJECT_REF` was unset, and `public/js/config.js` names `janiqspmhkbsyemkknpv`.
2. **The file:** `git show fc189b4:supabase/migrations/20261123120000_save_hero_with_rewards.sql`. That is 3,466 bytes, no carriage returns, **SHA-256 `12a5d73ee4884f77177bc20d13065fa6fd61a5e3f1fb7da46c113cc59c7915fe`,** as expected. It is unchanged between `fc189b4` and `main`.
3. **The apply** (14:30:41.848Z): one request, `begin;`, the file's exact bytes, then `commit;`. **The answer was HTTP 201 `[]`** at 14:30:42.410Z.
   - **The state straight after** (read-only): `function_present` true; md5 `46cea39f9a83b467c847dc4916815ca2`; length 1,329; owner `postgres`; `history_recorded` false; history `20261115090000`.
   - That is the expected point before the repair: the function applied and exact, the history not yet recorded.
4. **The history repair:**
   - **`npx supabase link --project-ref janiqspmhkbsyemkknpv`** (14:30:54Z) succeeded with the access token.
   - **`npx supabase migration repair 20261123120000 --status applied --linked`** (14:31:11Z) printed "Initialising login role…", then **"Repaired migration history: [20261123120000] => applied"**. The login role is the disclosed transient one.
   - **`npx supabase unlink`** (14:31:15Z) ran. The working tree was clean afterwards.
5. **Verification,** read-only:
   - **`pending_rewards_verify.sql`: 10 of 10 `ok`.** That covers the signature, only one such function, the integer return, `security definer`, the `search_path` `public`, no execute for PUBLIC, `anon` or `authenticated`, execute for `service_role`, and the history entry.
   - **`pending_rewards_state.sql`:**
     - `function_present` true;
     - **md5 `46cea39f9a83b467c847dc4916815ca2`,** length **1,329**, owner **`postgres`**: all as reviewed;
     - `history_recorded` true;
     - history **exactly `20261115090000, 20261123120000`.** The six earlier versions are still unrecorded, as L-3 left them.
   - **The refusal probe,** with the publishable key and the reviewed body with an empty id array: **HTTP 401, `{"code":"42501", … "permission denied for function save_hero_with_rewards"}`.**
   - **The functions:** `game` **v14** and `admin` **v8**, both unchanged, with the same `ezbr_sha256` as Gate A.

**A note on the first verification run** (14:31:48Z):
- **What happened:** my verification script looked for the publishable key under the wrong constant name (`config.js` calls it `SUPABASE_KEY`). It reported "FAIL: publishable key found in config.js", and so didn't send the probe. Every production check in that run passed.
- **The fix:** I corrected the script's lookup and re-ran the whole verification at 14:32:08Z, with every check passing.
- **No production state was changed** between the two runs. Both were read-only.

**Result:** Gate B passed. The function is installed exactly as reviewed, and recorded in the history. Nothing calls it yet: `game` is still v14.

**Not done in Gate B:** the `game` deploy (Gate C), any rollback, any test data, and the earlier history entries.
