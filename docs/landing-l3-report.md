# Landing page — phase L-3 report: publication

**Status: review corrections made (L3-01, L3-02). Awaiting independent re-review.**
- **Authorized:** on 2026-11-13. On its own branch and PR.
- **Nothing has touched production:**
  - The migration is **not applied** to the live project.
  - The `admin` function is **not deployed**.
  - Neither may happen until the owner explicitly authorizes it, separately from approving this PR (scope section 9).
  - **This PR must not merge before that deploy,** because merging publishes the admin console, which would then call actions the live function doesn't have yet.
- **Not started:** L-4.

The contract is `docs/landing-scope.md`: section 7 ("Security of publishing", "Tests", and the local database), section 9 (L-3 and its order), Q4–Q9, and criteria LAC-13, LAC-14 and LAC-18 to LAC-20.

## 1. The gate: the local Supabase stack

The scope's first step for L-3 was to check that a local stack runs on this laptop, and that the existing migrations apply to a fresh database.

- **Docker Desktop** was installed but stopped. With the owner's go-ahead I started it. Its engine runs in WSL 2, with 8 CPUs and 7.9 GB of memory.
- **The Supabase CLI** is pinned as a dev dependency at **2.122.0** (released 2026-10-23). The newest release, 3.1.0, was 4 days old, so it wasn't used.
  - `supabase init` added `supabase/config.toml` (project id `clickmonster`) and `supabase/.gitignore`.
- **The stack** started without the services L-3 doesn't need:
  ```
  npx supabase start -x studio,imgproxy,storage-api,logflare,vector,supavisor,mailpit,realtime,postgres-meta
  ```
  - The first run downloads the official images, which takes several minutes.
  - The local URL and keys are the CLI's standard local defaults, printed by `npx supabase status`.
- **Result: all six existing migrations applied cleanly to a fresh database,** then the new one: `characters`, `quests_events`, `admin`, `world_hunts_ledger`, `zones`, `chat` and `news`.
  - `npx supabase db reset` repeated this from scratch on the final code, with the same result.
- **Postgres version:** the local stack runs Postgres 17, the CLI default. The live project's version was not checked; that needs the owner's access token. If it differs, the RLS and grant behaviour tested here is the same in Postgres 15 and 17, but that is reasoning, not a test.

## 2. What changed

- **`supabase/migrations/20261115090000_news.sql`:** the `news` table.
  - **Columns:** slug, kind, title, summary, body, status (draft, published or unpublished), first publication time, revision time, maintenance window, and creation and update times and authors.
  - **Constraints** (lengths, formats, kinds and states):
    - a draft has no publication time, and anything else has one;
    - a revision comes after publication;
    - only maintenance has a window, and the window ends after it starts.
  - **A trigger** that enforces Q8 whatever writes the row:
    - the address and the first publication time never change once published;
    - a published entry can't be deleted;
    - `updated_at` is kept current.
  - **Access:**
    - **Grants:** `anon` and `authenticated` get `select` on the ten article columns only, and nothing else.
    - **Row-level security:** they see only rows that are published and whose publication time has passed. Nothing grants client writes.
    - **Writes:** only the `admin` function's service role writes.
- **`supabase/checks/news_precheck.sql` and `news_verify.sql`** (added in the review corrections): read-only SQL-editor checks of the live schema and migration history, for before and after applying (section 4).
- **`supabase/rollback/20261115090000_news_down.sql`:** the rollback (drop the policy, the trigger, the table and its function). It is kept outside `migrations/`, so it never runs by itself.
- **`public/js/data/news.js` (shared):** the rules that every part uses.
  - The kinds, limits and address format.
  - `checkNews()` (validation and clean-up) and `slugify()`.
  - The body format (paragraphs, and `- ` bullet lists; plain text only, Q4): `newsBlocks()` and `newsBodyHtml()`, which escape everything.
  - Which states allow what.
  - It is in `data/` because `tools/deploy-functions.mjs` uploads only `js/engine/` and `js/data/` (section 6).
- **`supabase/functions/admin/index.ts`:** the news actions, all admin only (Q6).
  - `news` (the list, drafts included), `newsSave` (create or edit), `newsPublish`, `newsUnpublish` and `newsDelete`.
  - Each validates with `checkNews()` and gives clear reasons. Examples:
    - the address is taken;
    - the address can't change after publishing;
    - unpublish first.
  - Repeats are refused: publishing what is already published, unpublishing what isn't, deleting what is gone, or saving with no change. A double press therefore can't write a second audit entry.
  - Every change is logged in `admin_log` (`news:create`, `news:edit` with `revised`, `news:publish` with `republished`, `news:unpublish`, `news:delete`).
  - Editing a published or unpublished article's text sets `revised_at` (shown as "Updated"). Republishing keeps the first publication time.
- **The admin console** (`public/js/admin-news.js`, wired into `admin.js`):
  - **The section:** "Public news" under Content, for admins only. Moderators don't see it, and `#news` sends them to the overview.
  - **The list:** title, kind, status, first publication and last change.
  - **The editor:**
    - fields for kind, title, address, summary and article, plus the maintenance window for maintenance (local time, stored as UTC);
    - inline validation with the shared rules;
    - the address made from the title until it is edited, and read-only once published;
    - a status line;
    - a preview that renders the body exactly as the rules define it, escaped.
  - **Actions, with the scope's confirmation tiers:**
    - publish: a normal confirmation, saying where it will be public and that the address becomes fixed;
    - unpublish: danger, with focus on "Keep it published";
    - delete a draft: danger, with focus on "Keep it";
    - delete an unpublished article: type its title.
  - **Unsaved changes block** publish and unpublish until saved.
  - **Single-flight:** one change per article at a time (`news:<id>:<op>` in `st.pendingForms`). A second press sends and asks nothing, and the draft is locked in a disabled fieldset while a change is sending.
  - **Each article has its own address** (`#news/<id>`). Back returns focus to the article it came from.
- **Tests and tools:**
  - **`supabase/tests/news.test.sql`:** 42 pgTAP database tests.
  - **`tests/db/news-rest.test.mjs`:** 5 tests over HTTP with the local anonymous key, and a signed-in player.
  - **`tests/db/news-admin.test.mjs`:** 3 tests of the real `admin` function, served by the local stack, as an admin, a moderator and a player.
  - **`tests/news.test.mjs`:** 7 tests of the shared rules, including that both functions import only from folders the deploy uploads.
  - **`tests/ui/admin-news.test.mjs`:** 10 tests on the fake backend:
    - 9 in the browser, covering the console and the audit log's news entries;
    - 1 that the fake's public read answers each case the way the local API does.
  - **The fake backend** (`tests/ui/harness.mjs`): the admin news actions, matching the real function; and the public read, which answers the same cases as the local API (published rows only, article columns only, otherwise 401 with code 42501). A test checks this. L-4 will build on it.
  - **The audit log view** shows news entries readably: the address, plus "text corrected after publishing", "published again" or "was unpublished".
  - **`npm run test:db`:** runs the database tests and `tests/db/` against the running local stack.
  - **`tools/news-public-check.mjs`:** the production check for step 4 (section 7).
- **`package.json`:** `supabase` 2.122.0 as a dev dependency, and the `test:db` script.

## 3. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| LAC-13 | Met | **States and rules:** draft, published and unpublished, with the Q8 rules, in the real function against the real local database (`tests/db/news-admin.test.mjs`): create; rename while a draft; publish; refuse a second publish; correct the text (marked revised, visible publicly); refuse an address change; refuse deleting while published; unpublish; republish with the first time kept; delete the unpublished entry; refuse deleting again (404); delete a draft. **Admin only:** a moderator and a player are refused (403), with nothing written. **Audit log:** exactly one entry per change, by the admin, none for refused attempts. **In the console** (`tests/ui/admin-news.test.mjs`): the same lifecycle, single-flight (one request and one audit entry under a held request), and the confirmation tiers, with focus checked |
| LAC-14 | Met locally; production pending | **Local, pgTAP (42 tests):** published and past rows readable; drafts, unpublished and future rows hidden; the hidden columns, `select *` and filtering on `status` refused; insert, update and delete refused for `anon` and `authenticated`; the service role can write; the Q8 rules and constraints hold for any writer. **Local, REST (5 tests):** the same over HTTP with the anonymous key, including the default select, ordering on a hidden column, upsert, and a signed-in player. **Production:** steps 2 to 5 of section 4 below, after the owner's authorization |
| LAC-18 | Met | No sideways scrolling on the news list or editor at 390 |
| LAC-19 | Met | 0 axe violations at all impacts: the empty list, the editor with errors, the preview, a published article in the editor (1440), and the list and editor at 390 |
| LAC-20 | Met | No change to game rules, the `game` function or existing tables. The server changes are the listed migration and new `admin` actions |

## 4. The order from here (scope section 9)

Every production step below needs the owner's explicit authorization, separately from approving this PR. That includes reading the live migration history and any change to it. Nothing in this section has been done.

1. **Done for review:** the local database tests pass, and the PR is up for independent review and approval.
2. **Production database (the owner's authorization, with the owner's access token):**
   1. **Link the CLI to the live project.**
      - Run `npx supabase link --project-ref janiqspmhkbsyemkknpv`. It asks for the database password, and writes only to `supabase/.temp/`, which git ignores.
   2. **Inspect the migration history, changing nothing.**
      - Run `npx supabase migration list --linked`. It prints which versions the live history table records.
      - Record the output here.
   3. **Inspect the schema, changing nothing.**
      - Paste `supabase/checks/news_precheck.sql` into the SQL editor, and record the result.
      - **Rows 2 to 4 (news objects) must be false or none.** If they aren't, stop: news objects already exist, and that must be understood first.
      - **Row 1** gives the Postgres version, row 6 the recorded versions, and row 7 any of the earlier migrations' tables that are missing.
   4. **Decide how to apply, from steps 2 and 3:**

      | What the history shows | How the news migration is applied |
      |---|---|
      | Exactly the six earlier versions, `20261112140000` to `20261114090000`, and nothing newer | **Through the CLI.** First `npx supabase db push --linked --dry-run`; it must list only `20261115090000_news.sql`. Then `npx supabase db push --linked`. The CLI records the history entry itself |
      | Some or all earlier versions missing, or no history table | **By hand.** Paste `20261115090000_news.sql` into the SQL editor, then record only that version: `npx supabase migration repair 20261115090000 --status applied --linked`. Never use `db push` here: with older versions missing it either refuses or, with `--include-all`, re-applies migrations that already ran. `--include-all` is never used |
      | `20261115090000` already recorded, or news objects present | **Stop.** Nothing is applied until the owner has looked at what is there |

      **The earlier versions are never marked applied** just because their files exist. If some are missing from the history, that stays as it is. Reconciling them would need each one's objects checked in production first, and it is a separate decision for the owner, outside L-3.
   5. **Verify.**
      - Paste `supabase/checks/news_verify.sql` into the SQL editor. Every row's `ok` must be true: the table, RLS, the exact column grants, no table-wide or write privileges, the one read policy, the trigger, the constraints, the unique address, the index, no execute right on `news_guard()`, and the history entry.
      - Run `npx supabase migration list --linked` again; it must show `20261115090000` recorded.
      - Record both here.
   6. **If anything fails, roll back.**
      - Run `supabase/rollback/20261115090000_news_down.sql` in the SQL editor. It removes every news row, and the table, policy, trigger and function; nothing else depends on them.
      - Then remove the history entry: `npx supabase migration repair 20261115090000 --status reverted --linked`.
3. **Production function (the owner's authorization):** deploy the `admin` function only, from the reviewed head of this branch: `npm run deploy:functions -- admin`, with `SUPABASE_ACCESS_TOKEN` set.
   - Without the argument the script deploys `game` too, unchanged.
   - The deploy happens before the merge, so the SHA it was made from is recorded here at that point.
   - **Rollback:** redeploy `admin` from `main` before this PR.
4. **Only then merge this PR,** so the admin console's News section goes live when the deployed function supports it.
5. **The production check:**
   - **The owner, in the admin console:**
     - publishes an article. It can be a real first article, or a clearly marked test entry that is unpublished and deleted afterwards; the report records which;
     - confirms a second, different entry that **exists with status Draft or Unpublished**.
   - **The prerequisite:** the public key can't see a hidden entry, so the tool can't tell an existing hidden entry from a typo. That confirmation in the console is what makes its hidden-row check meaningful, and the report records it.
   - Then run:
     ```
     node tools/news-public-check.mjs --published <its address> --hidden <the hidden entry's address> --out docs/ui-audit/landing/l3-public-check.json
     ```
   - Both addresses are required (L3-01). The results go in this report.
6. **Review of those results.** L-4 doesn't start until they are accepted.

### Rehearsed on the local stack

The checks and the history commands were rehearsed with `--local` only.

| Rehearsal | Result |
|---|---|
| `news_verify.sql` on the database as the CLI applied it | 13 of 13 rows ok |
| `news_precheck.sql` with news already present | Rows 2 to 4 flag it: `true`, `true`, and the policy's name |
| Both checks with news dropped inside a rolled-back transaction (the "before" state) | **Precheck:** Postgres 17.11; no news objects; history `20261112140000` … `20261114090000`; no earlier tables missing. **Verify:** 12 of 13 rows fail, as they should (only "no write privileges" holds) |
| History entry removed (`migration repair 20261115090000 --status reverted --local`), with the objects still present | `migration list --local` shows it unrecorded, and `db push --dry-run --local` would push only `20261115090000_news.sql` |
| `migration repair 20261115090000 --status applied --local` | Exactly that version is recorded again; the others are unchanged |
| The six earlier history entries removed, then `db push --dry-run --local` | The CLI refuses ("Found local migration files to be inserted before the last migration on remote database") and suggests `--include-all`, which would re-apply all six. That is why the second row of the decision table never uses `db push` |

After the rehearsal the local history was restored exactly, and verify was 13 of 13 again.

`tools/news-public-check.mjs` uses only the publishable key from `public/js/config.js`, and refuses to run with a secret key. It requires `--published` and `--hidden`: two different, well-formed addresses. Without them it stops before any request, and the hidden-row check is never skipped. It checks:
- the published read and its columns;
- that the hidden entry stays hidden;
- nine kinds of hidden-column and filter request;
- insert, upsert, update and delete.

Its write probes use the address `rls-check-<time>`. An inserted probe would be marked published, so that if the insert got through it would be seen. If any write gets through, the tool says so, names what to remove, and exits with a failure.

**Every write probe is aimed at the probe's own address, never at a real article.** Postgres checks the write privilege before it looks for rows, so a refused write is refused either way. If writes were wrongly allowed, an update or delete of a missing row would return success without the 42501 code, and the tool counts that as a failure. The published article is only read, before and after.

**The tool was tried on the local stack only:**
- with the correct rules: 21 of 21 checks pass;
- with row-level security turned off and writes granted: 15 of 21 pass. The 6 failures are named: the hidden draft visible, the insert, the update, the delete, the future-time check, and the probe row created. It reports the probe row to remove, and the seeded published article was not touched.

The local rows were removed afterwards, and RLS and the grants were checked again.

## 5. Proving the tests catch weaker rules

Each mutation was applied by hand to the local database, the tests were run, and the correct rules were restored:

| Mutation | pgTAP | REST tests |
|---|---|---|
| Every column granted to `anon` and `authenticated` | 10 of 42 fail (hidden columns, `select *`, filtering on status) | 2 of 5 fail |
| The read policy shows every row (`using (true)`) | 5 of 42 fail (drafts, unpublished and future rows) | 3 of 5 fail |
| Row-level security off, and writes granted to `anon` | 8 of 42 fail (hidden rows and every write) | 4 of 5 fail |

After restoring, everything passed again, and the database was checked: RLS on, no write grant for `anon`.

## 6. Found and fixed during L-3

**The deploy would have broken the `admin` function.**
- `tools/deploy-functions.mjs` uploads only `public/js/engine/` and `public/js/data/`. I had first put the shared rules at `public/js/news.js`.
- The local stack didn't show it, because the local runtime follows the `js/` symlink to the whole folder.
- **Fix:** the file moved to `public/js/data/news.js`.
- **Guard:** a new engine test checks that both functions import shared code only from `js/engine/` or `js/data/`. With the old path it fails ("./js/news.js is uploaded by tools/deploy-functions.mjs").
- **A local-stack note** for later phases: the CLI mounts each imported file individually when the stack starts. A shared file added or moved while the stack is running needs `npx supabase stop` then `start`; restarting the runtime container alone fails.

## 7. Changed existing test

`navigation: four labelled groups, every section listed, current one marked (desktop)` (`tests/ui/admin-console.test.mjs`) lists every section by group. It now includes the new "Public news" section under Content for an admin. A moderator's navigation, without it, is checked in `tests/ui/admin-news.test.mjs`.

## 8. Regression evidence

**The first 8 console tests against `main`** (`de7cfde`, via `UI_PUBLIC_DIR`):
- 7 fail;
- 1 passes, "only admins see Public news", because `main` has no news section for anyone.

The audit-log test was added later; it needs the News section, which `main` doesn't have. The fake-read test exercises the test harness, not `main`.

**The database, function and REST tests** have no "before" to run against, since the table doesn't exist on `main`. Section 5 shows they fail when the rules are weakened.

## 9. Test runs

| Suite | Tests | Result |
|---|---|---|
| Engine (`npm test`) | 39: 29 before, plus 6 news rules, 1 deploy check and 3 public-check argument tests | 39/39 in each of 3 runs |
| Browser (`npm run test:ui`) | 166: 156 before, plus 10 | 166/166 in each of 3 runs, with the local stack stopped |
| Local stack (`npm run test:db`) | 42 pgTAP, plus 8 API and function tests | 42/42 and 8/8 in each of 3 runs on the corrected code, run with no browsers open |

**A stopped run on the way.** A first three-run pass, with the local stack running alongside the browser suite, was stopped by Claude Code because the laptop ran critically low on memory. Before that, its first browser run had 9 failures: 7 whole test files at once, and 2 D2-03 tests.
- With the owner's agreement, the runs were split: the stack was stopped for the engine and browser suites, then started again for the database tests with no browsers running.
- All passed, as above. The failures were memory starvation, not defects.
- **On this laptop, don't run the browser suite and the local stack at the same time.**

## 10. Review corrections (review of `b0d9a15`)

The review accepted the database design, the RLS policy and grants, the admin-only operations, the publication lifecycle, the admin News section and the local test evidence. It found two gaps in the production gate.

### L3-01: the production check could pass without testing a hidden entry (medium)

**Defect.** `--hidden` was optional. Leaving it out recorded "hidden entry check: skipped" as a pass, so the gate could report every check passing without ever testing a draft or unpublished entry.

**Correction** (`tools/news-public-check.mjs`):
- `--published` and `--hidden` are both required.
- Each must be a well-formed news address, which also rules out query-string injection, and the two must differ. A flag given with no value counts as missing.
- Otherwise the tool stops with exit code 2 and a clear message, before any request, and reports nothing as passing. The skip path is gone.
- **The tool:**
  - still uses only the public key;
  - still aims its write probes only at its own `rls-check-<time>` address;
  - now prints, and writes into its JSON output, the prerequisite: the owner confirmed in the admin console that the hidden entry exists as a Draft or Unpublished entry.

**Tests** (`tests/news-public-check.test.mjs`, 3 tests in the engine suite):
- The tool runs with `fetch` replaced by a stub, so nothing can reach a server.
- **Bad arguments** must stop it with code 2, before any request and with nothing reported as passing: no arguments, either address missing, a flag with no value, identical addresses, malformed addresses, and an injection attempt.
- **A valid pair** gets as far as its first request (the stub), so validation doesn't block a correct run.
- **On `b0d9a15`'s tool,** 2 of the 3 fail; the valid-pair test passes there too.

### L3-02: a manual SQL apply had no plan for the migration history (medium)

**Defect.** The procedure recommended the SQL editor without saying how the history would record the migration. A later `db push` could then treat it as pending.

**Correction:** section 4, step 2, is now a complete procedure:
1. link;
2. read the history;
3. read the schema with `supabase/checks/news_precheck.sql`;
4. a decision table for the CLI or a manual apply;
5. for a manual apply, record only `20261115090000` with `supabase migration repair … --status applied`;
6. verify with `supabase/checks/news_verify.sql` and a second `migration list`;
7. roll back, including removing the history entry.

- **The earlier six versions are never marked applied** without their objects being checked, and that is outside L-3.
- **Every step needs the owner's explicit authorization,** including history changes.
- **Both SQL checks are read-only.** They and the history commands were rehearsed on the local stack (section 4, "Rehearsed on the local stack").

### Recorded, not changed: the audit log can miss an entry

The `admin` function's `log()` helper reports a failed `admin_log` insert to the server console but doesn't fail the action. So a news change, like every other admin change, could succeed without its audit entry if that insert failed.
- **Inherited:** this is the existing behaviour of all admin actions, not something new in L-3.
- **Normal operation:** the tests show exactly one entry per change.
- **Recorded as a limitation** in `docs/backlog.md`. Making audit entries guaranteed (transactional) would be a change across every admin action, and it isn't part of L-3.

## 11. Not verified

- **Production.** Steps 2 to 5 of section 4 are the owner's to authorize, and none has happened. The production Postgres version, and whether the migration applies there, are unknown until then.
- **The deployed function.** Deploying it bundles the files the deploy script uploads. The new import was checked against that rule, but the deploy itself wasn't run.
- **Real devices, other browsers and screen readers** for the admin News section. Axe and the fake backend only.
- **Concurrent editing by two admins.** The last save wins. There is no version check, which matches the existing admin sections. Publish, unpublish and delete re-check the state they started from (`eq('status', …)`), so they can't act on a state that changed in between.
