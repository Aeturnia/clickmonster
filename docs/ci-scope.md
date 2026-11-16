# Continuous integration: scope

**Status: scope approved (2026-11-14).** It was approved in the final re-review at `b2df19e` and merged as PR #37 (`6e21a82`). CI-S01 to CI-S04 are closed (section 9). The owner's decisions Q1 to Q7 stand.
- **CI-A was authorized** by the owner on 2026-11-14, after this approval. It was accepted and merged as PR #39 (`a54e392`) on 2026-11-15. CI-1a is still open (`docs/ci-a-report.md`, section 12). Still not authorized: required checks or branch protection, and parts 2 and 3.
- **For the CI-A implementation review** (the reviewer's notes, not blockers):
  - the concurrency group must not cancel unrelated runs: group by workflow and branch or PR, never one global group;
  - Linux-specific test fixes must not weaken existing assertions; each is listed in the report with its reason;
  - a failed database job still stops its local stack (a cleanup step that runs even on failure);
  - CI-1a stays a separate gate after the merge, and required checks are turned on only once the check names exist and the first runs have passed.
- **Backlog item:** "Continuous integration (GitHub Actions)" in `docs/backlog.md`.
- **This scope covers part 1:** the test suites on every PR. Parts 2 and 3 are described in section 7 and left for later.
- **No workflow file is added by this PR.** A workflow with `pull_request` or `push` triggers runs, and spends Actions minutes, as soon as it's pushed. It arrives only in the implementation PR, once authorized.
- **No game, server, database or deploy change.**

## 1. Why now

- **Independent evidence.** In the L-4 reviews, the reviewer noted that they hadn't run the suites themselves, and that the live results were Claude's recorded observations. A check run by GitHub closes the first gap for every later phase. It tests the PR merged into `main`, not the PR's head on its own (section 3, "Which commit is tested").
- **The laptop's memory limit.** In L-3, the local Supabase stack and the browser suite together starved the browsers, and the runs have been split by hand since. On CI each suite gets its own runner.
- **The next backlog items all need the database suite:** password recovery, bug reports and maintenance mode. CI makes each of those cheaper to review.
- **No production authorization needed.** It touches no database, function, deploy or live site, unlike the other candidates. Password recovery, for example, needs production Supabase Auth settings (the redirect URL and the email template) changed by the owner.

## 2. What exists

- **No CI:** there was no `.github/` directory when this scope was written. CI-A has since added `.github/workflows/ci.yml`.
- **The suites** (`package.json`):
  - `npm test`: engine, entrance file checks, news rules and the news page handler (47);
  - `npm run test:ui`: Playwright 1.63.0 and axe-core 4.10.2 in Chromium, against the fake backend (178);
  - `npm run test:db`: pgTAP (42), then the API and function tests (9), on the local Supabase stack (CLI 2.122.0, Postgres 17).
- **They are already safe to run unattended:**
  - `tests/ui/harness.mjs` fails a test on any request to a host other than the fake backend;
  - the database tests refuse anything not on 127.0.0.1;
  - none needs a secret: the local stack uses the CLI's built-in development keys.
- **Timing, measured once on the owner's laptop** (2026-11-14, a rough guide only, not runner time):
  - engine: about 1 second;
  - browser: 7 minutes 12 seconds (432 s for 178 tests).

  The database suite wasn't timed: it needs the stack, and the stack is stopped.
- **Cost, a rough estimate to be replaced by measurement (CI-8):**
  - **Per run:** about 10 to 15 runner minutes. Each job is billed separately and **rounded up to a whole minute**: engine about 1, browser about 8 to 10 with setup, and database a few more for starting the stack.
  - **Revised for the runner exception (section 10):** the browser job runs on Windows, at $0.010 a minute instead of $0.006. A run is then roughly $0.10 rather than $0.07, about 180 runs on $18 if nothing else uses it. The CI-A report records the measured durations and billed cost.
  - **Per PR:** a run for each push, plus one for the merge to `main`.
  - **The allowance is money, not minutes** (checked against GitHub's docs, 2026-11-14):
    - since GitHub's change of 2026-10-28, GitHub Pro (Q1) includes **$18 a month of compute**;
    - that is **shared** between eligible GitHub Actions and cloud sandbox use on the account, not reserved for this repo;
    - a standard Linux 2-core runner (`ubuntu-latest`) costs $0.006 a minute, so $18 is about **3,000 minutes** if nothing else uses the allowance;
    - at the upper estimate that is roughly 200 runs a month.
  - **Beyond the allowance,** usage is billed at the account's rates, subject to its budget and payment settings. The owner reviews actual spend in the account's billing page. The report records the measured cost per run (CI-8).
- **Lockfile:** `package-lock.json` is committed, so `npm ci` installs exactly the pinned versions.
- **Node:** 22.16.0 locally. The repo has no `engines` field, `.nvmrc` or `.node-version`.
- **The startup budget (LAC-2, 32,000 decoded bytes)** is not asserted by any test. `tools/entry-metrics.mjs` measures it, and the number in the reports (31,112) was counted from git's LF bytes by hand, because a Windows checkout turns LF into CRLF and inflates the measurement.
- **Symlinks:** `supabase/functions/game/js` and `supabase/functions/admin/js` are git symlinks to `public/js`. On Linux they check out as real symlinks; on the owner's Windows checkout they are small text files.
- **Line endings:** `.gitattributes` keeps `public/vendor/**` byte-identical (`-text`). Everything else follows `core.autocrlf` locally; a Linux runner checks out LF.

## 3. Proposed design

**One workflow, `.github/workflows/ci.yml`:**
- **Triggers:** `pull_request` into `main`, `push` to `main` (the merged result), and `workflow_dispatch` (run by hand).
  - **Only `pull_request` can run before the workflow reaches `main`.** A push to `main` happens only on the merge. GitHub offers "Run workflow" only for a workflow that is already on the default branch.
- **Which commit is tested:**
  - **For `pull_request`:** the default checkout is GitHub's temporary merge commit, the PR's changes merged into the current `main`, not the PR's head commit on its own. This is kept on purpose: it tests what `main` would become.
  - **Both commits are recorded:** each job writes the PR's head SHA (`github.event.pull_request.head.sha`) and the tested merge SHA (`github.sha`) to its run summary. The report and the reviewer cite both.
  - **For `push` and `workflow_dispatch`:** the tested commit is the branch's commit (`github.sha`).
- **Concurrency:** a newer push to the same branch cancels the run still going, to save minutes.
- **Permissions:** `contents: read` only. No secrets, and no access to the live project, Netlify or the Supabase access token.
- **Runners:** Node 22 and `npm ci` on each.
  - **Engine and database:** `ubuntu-latest`.
  - **Browser:** `windows-latest`, by the owner's exception in CI-A (section 10).

**Three jobs, in parallel, each its own check on the PR:**

| Job | Steps | Notes |
|---|---|---|
| `engine` | `npm test` | Also runs the new budget check (below) |
| `browser` | `npx playwright install chromium`, then `npm run test:ui` | Chromium only, **on Windows** (section 10). `--with-deps` is dropped there: it installs Linux system packages. Caching the browser download between runs is an implementation option: it counts only once the workflow has a cache key (for example the Playwright version) and a run shows a cache hit |
| `database` | `npx supabase start -x studio,imgproxy,storage-api,logflare,vector,supavisor,mailpit,realtime,postgres-meta`, then `npm run test:db`, then `npx supabase stop` | The same command as `CLAUDE.md`. Docker is preinstalled on the runner |

**A new budget check, in `npm test`** (a file test, so it also runs locally):
- It counts the bytes of the files the first paint loads, with CRLF normalized to LF, so it gives the same number on Windows and Linux.
- It fails above 32,000.
- **Which files:** the ones LAC-2 counts (the document, the entry CSS and the entry JS). During implementation the test's total is reconciled against the 31,112 recorded in the L-4 report, and any difference is explained before the limit is set.

**On failure:** the job uploads its test output as an artifact, so a reviewer can read it without rerunning.

**Pinned actions:** each third-party action (`actions/checkout`, `actions/setup-node`, `actions/cache`) is pinned to a full commit SHA, with its version in a comment. This matches the project's exact pinning of Playwright, axe-core and the CLI (Q6).

## 4. Acceptance criteria

| ID | Criterion | How it's shown |
|---|---|---|
| CI-1 | **In CI-A:** the workflow runs on a PR into `main`, with three separate checks, and each job's summary records the PR head SHA and the tested merge SHA | The implementation PR's own checks page and run summaries |
| CI-1a | **After CI-A merges:** the workflow runs on the push to `main`, and by hand (`workflow_dispatch`), with the same three checks and the tested commit recorded | The two runs' links, recorded in a short follow-up docs PR |
| CI-2 | All three suites pass with the same counts as locally: **engine** 47 plus the budget check (48) **on Ubuntu**, **browser** 178 **on Windows, in Chromium**, and **database** 42 + 9 **on Ubuntu**. Revised by the owner's runner exception (section 10): the browser result is a Windows Chromium baseline, **not Linux browser compatibility** | The run's logs and job summaries (runner and image) |
| CI-3 | **A failing test fails the check.** Shown once per job, on a throwaway commit (for example an `assert.fail()`), then reverted | Linked runs in the report |
| CI-4 | The budget check fails above 32,000, passes at today's size, and counts the same on Windows (CRLF) and Linux (LF) | Run on both; a padded `index.html` makes it fail, then reverted |
| CI-5 | **Least privilege and no production traffic:**<br>- `contents: read` only, and no secrets or production credentials (no `SUPABASE_ACCESS_TOKEN`, no Netlify token);<br>- **no test traffic** to the production Supabase project or the live Netlify site;<br>- the existing boundaries stay enforced: the UI harness fails any request to a host other than its fake backend, and the database tests refuse anything not on 127.0.0.1.<br>**Allowed:** the runner's own setup and reporting traffic, such as the checkout, action downloads, `npm ci`, the Playwright browser, Docker image pulls, caches, artifact uploads and status reports | The workflow file; the harness's and database tests' host checks; a search of the workflow for production hosts and secrets |
| CI-6 | No game, server, database or deploy change. Any test-only fix needed for Linux is listed in the report, each with its reason | The diff |
| CI-7 | `CLAUDE.md` and `README.md` say how CI runs and how to read a failure | The diff |
| CI-8 | Measured minutes per job and per run (as billed, rounded up per job), and the cost at $0.006 a minute, recorded in the report against Pro's $18 shared allowance | The runs' timings and usage |

**Evidence, as for every phase:** the suites still run locally three times as well, so CI is in addition to, not instead of, the local runs, until the owner decides otherwise.

## 5. Risks, not yet verified

Nothing in this project has run on Linux yet. The first run may need test-only fixes.
- **Rendering on Linux. This happened:** in CI-A's first run, five layout tests failed on Ubuntu (section 10). Chromium on Linux has different fonts and font metrics. Things that could behave differently:
  - layout and geometry assertions (the desktop and chat-panel breakpoints in rem, the metric thresholds);
  - axe colour contrast.
- **Timing on a slower runner.** A standard runner may be slower than the laptop. The tests with timing in them could be flaky: the 250 ms double-tap guard (tests wait about 270 ms) and the after-paint news loading.
- **Symlinks in `test:db`.** On Linux the function folders' `js` links are real symlinks. The CLI's mounts of imported files (which on Windows needed a stop and start after a file moved) may behave differently. To verify, not assume.
- **Image pulls.** `supabase start` pulls several Docker images on every run, which takes time and can hit registry rate limits. Caching the images may be worth it if it is slow.
- **The budget check's number.** If the reconciled total differs from 31,112 (for example by what counts as the first paint), the difference is explained before the limit is set, never fudged to pass.

## 6. Questions for the owner

| Q | Question | Recommendation |
|---|---|---|
| Q1 | **Your GitHub plan and Actions minutes** | **Answered (2026-11-14):** the personal account was upgraded to GitHub Pro, so the repo stays where it is. Checked read-only: branch protection on `main` now answers "not protected" rather than requiring an upgrade, and there are no rulesets. The report compares measured minutes against Pro's allowance |
| Q2 | **Require the checks before merging?** Pro makes this available on this private repo | Yes, the three checks on `main`, set by the owner once CI-A has shown them passing (a rule naming a check that has never run blocks every merge) |
| Q3 | **What goes in the first PR:** part 1 only, or part 3 (live-site checks) too? Part 3 is automated traffic to production on a schedule | Part 1 only. Part 3 as its own small PR later. **Accepted by the owner (2026-11-14).** |
| Q4 | **Node version:** pin Node 22 in the workflow and add `"engines"` to `package.json`? | Yes, 22, matching the laptop. **Accepted by the owner (2026-11-14).** |
| Q5 | **Run the database job on every PR,** or only when `supabase/`, `tests/db/` or the shared news rules change? | Every PR at first, so it is a stable check. Filter by path later if minutes are tight. A path filter and a required check don't mix well: a skipped job can leave a required check waiting. **Accepted by the owner (2026-11-14).** |
| Q6 | **Pin actions by commit SHA,** or by major version tag (`@v4`)? | SHA, with the version in a comment. A tag can be moved; a SHA can't. **Accepted by the owner (2026-11-14).** |
| Q7 | **Local runs as evidence:** keep running the suites three times locally for each phase, or let one green CI run plus one local run stand in? | Keep both for the first phase after CI lands; decide after that. **Accepted by the owner (2026-11-14).** |

## 7. Later parts (not in this scope)

- **Part 2: Firefox and WebKit** (Playwright's builds; WebKit is Safari's engine), nightly or by hand. The suite has only ever run in Chromium, so expect fixes first.
- **Part 3: live-site checks** after each merge to `main` and daily, reads only:
  - the live files match `main`;
  - the news pages' statuses and headers;
  - the `/vendor/*` cache header.

  It confirms a Netlify deploy landed, since Netlify posts no deploy status for `main`.
- **Possible later: deploying the server functions** through a manual workflow that needs the owner's approval on each run. It needs its own decision, because it moves `SUPABASE_ACCESS_TOKEN` into a repo secret.

## 8. Phasing

**One implementation PR, CI-A,** after this scope is approved and the owner authorizes it:
1. Add the workflow and the budget check.
2. Make any test-only Linux fixes.
3. Show CI-3 and CI-4 failing on throwaway commits, then revert them.
4. Write `docs/ci-a-report.md`, with:
   - the run links, with each run's head and merge SHAs;
   - the timings and cost;
   - any fixes;
   - what wasn't verified, including CI-1a, which can only run after the merge.
5. Stop at the review gate.

**After CI-A merges,** with the owner's go-ahead:
1. Check the `push` run on `main` (CI-1a).
2. Run the workflow once by hand (CI-1a).
3. Record both in a short docs PR.
4. The owner then turns on required checks (Q2).

## 9. Scope review corrections (review of `a3434de`)

The review accepted the three-job architecture, read-only permissions, no production secrets, the failure demonstrations and the separate budget check. The owner's decisions Q1 to Q7 are unchanged.

- **CI-S01, which commit is tested.** The scope said GitHub would test the PR's exact head commit. A `pull_request` run checks out GitHub's temporary merge commit by default.
  - **Corrected** in sections 1 and 3: the merge commit is kept on purpose, because it tests the PR against `main`.
  - **Both SHAs are recorded** in each job's summary, and in CI-1 and the phasing.
- **CI-S02, manual runs before the first merge.** CI-1 required CI-A to show all three triggers, but `workflow_dispatch` (and a push to `main`) can only run once the workflow is on `main`.
  - **Split:** CI-1 covers the PR run in CI-A. The new CI-1a covers the push and manual runs after the merge, recorded in a short docs PR.
  - **The phasing** adds the after-merge steps.
- **CI-S03, the allowance.** The scope described Pro as 3,000 dedicated minutes.
  - **Corrected** in section 2: since 2026-10-28, Pro includes $18 a month of compute, shared with other eligible use on the account. At $0.006 a minute for a standard Linux runner, that is about 3,000 minutes if nothing else uses it.
  - **Also added:** jobs are rounded up to a whole minute; usage beyond the allowance is billed; the owner reviews actual spend. CI-8 now records cost as well as minutes.
  - Both figures were checked against GitHub's docs on 2026-11-14.
- **CI-S04, network traffic.** CI-5 claimed no request leaves the runner except downloads, which can't be established.
  - **Reworded:** no test traffic to production Supabase or Netlify, no production credentials, and the existing fake-backend and localhost boundaries enforced.
  - **Explicitly allowed:** the runner's setup and reporting traffic.
- **Nonblocking note, the browser cache.** It is now an implementation option, counted only with a cache key and a shown cache hit.

## 10. Runner exception (CI-A, 2026-11-14)

**What happened.** CI-A's first run, `43638208611`, ran all three jobs on Ubuntu:
- **engine and database:** passed;
- **browser:** 173 of 178. Five existing layout assertions failed. The full record is in `docs/ci-a-report.md`.

The likely cause is Linux font metrics, but it isn't established. The game's font stack is `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, and the thresholds were set on Windows with Segoe UI.

**The owner's decision:** a limited exception. **Only the browser job** runs on a GitHub-hosted Windows runner.

| Job | Runner |
|---|---|
| `engine` | Ubuntu (`ubuntu-latest`) |
| `browser` | Windows (`windows-latest`), Chromium |
| `database` | Ubuntu (`ubuntu-latest`) |

**Unchanged:**
- all 178 browser tests, with their thresholds and assertions;
- the fake-backend isolation;
- SHA-pinned actions and read-only permissions;
- the startup-budget test and its 32,000-byte ceiling.

**What it establishes:** a Windows Chromium browser baseline, **not Linux browser compatibility**.

**Kept:**
- **The five Linux failures** are recorded, with their thresholds, in the CI-A report.
- **A separate backlog item** investigates fonts and responsive layout across platforms (`docs/backlog.md`).

The owner's decision is not authorization to change the game's CSS or to start that investigation.

**CI-2 and the cost estimate** are revised above.

