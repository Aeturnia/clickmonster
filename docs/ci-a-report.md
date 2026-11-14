# CI-A report: GitHub Actions for the test suites

**Status: implemented. Awaiting independent review. PR #39 is not merged.** At the final head, the browser job failed intermittently on Windows, with a different test on each attempt (section 4a). This is reported, not fixed.
- **Authorized:** by the owner on 2026-11-14, after the scope (`docs/ci-scope.md`) was approved and merged as PR #37 (`6e21a82`).
- **Scope exception:** after the first run, the owner authorized one exception. Only the browser job runs on Windows (scope, section 10).
- **No game, server, database or deploy change.** No branch protection or required checks are set. Parts 2 and 3 are not started.
- **PR #38** (the scope-approval record) is still open. This branch avoids the lines it changes.

## 1. What changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | **New.** One workflow, three jobs (section 2) |
| `tests/entrance-budget.test.mjs` | **New.** LAC-2 as a test: at most 32,000 bytes (section 3) |
| `package.json`, `package-lock.json` | `"engines": { "node": "22.x" }` (Q4). The lockfile change is only that root entry; `npm ci` installs cleanly |
| `README.md`, `CLAUDE.md` | How CI runs and how to read a failure (CI-7). The engine count is now 48 |
| `docs/ci-scope.md` | Section 10, the runner exception; CI-2 and the cost revised (the owner's instruction) |
| `docs/backlog.md` | A follow-up: cross-platform fonts and responsive layout (section 5) |

**Not changed:** every existing test, including all 178 browser tests and their thresholds; `public/` (the game, the entrance, the admin console); `supabase/`; `netlify/`.

## 2. The workflow

**Triggers:** `pull_request` into `main`, `push` to `main`, and `workflow_dispatch`.

**Runners:**

| Job | Runner (as run) | Steps |
|---|---|---|
| `engine` | `ubuntu-latest`, image `ubuntu-26.04`, version 20261111.196.1 | `npm ci`, `npm test` |
| `browser` | `windows-latest`, image `windows-2025-vs2026`, version 20261103.298.1 | `npm ci`, `npx playwright install chromium` (Chrome for Testing 153.0.8010.12, Playwright's chromium v1243), `npm run test:ui` |
| `database` | `ubuntu-latest`, image `ubuntu-26.04` | `npm ci`, `npx supabase start -x …` (the same services as `CLAUDE.md`), `npm run test:db`, then `npx supabase stop --no-backup` with `if: always()` |

**Settings and safeguards:**
- **Permissions:** `contents: read` only. The workflow uses no secrets: a search of it for `secrets.`, `supabase.co` and `netlify.app` finds nothing.
- **Pinned actions,** each by full commit SHA, with the version in a comment:
  - `actions/checkout` v7.0.1 (`3d3c42e5…`);
  - `actions/setup-node` v7.1.0 (`949feb24…`);
  - `actions/upload-artifact` v7.0.2 (`cf430e03…`).
- **Shell:** `bash` at workflow level, which adds `-o pipefail`, so `npm test | tee` fails when the tests fail. On Windows this is Git Bash, with the same flags. Shown in CI-3.
- **Timeouts:** 15 minutes for engine, 30 for browser and 30 for database, rather than GitHub's default of 360.
- **Concurrency:** `group: ci-${{ github.event.pull_request.number || github.run_id }}`, with `cancel-in-progress: true`.
  - A newer push to a PR cancels only that PR's older run.
  - A push to `main` or a manual run gets a group of its own (its run id), so it is never cancelled. Grouping `main` pushes by branch would let GitHub drop a pending run when merges come close together.
- **Commit identity (CI-S01):** each job writes the event, the PR head SHA (`github.event.pull_request.head.sha`), the tested SHA (`github.sha`), the Node version and the runner image to its summary. The values are passed through `env:`, not interpolated into the script.
- **Failure output:** a failed job uploads its suite's output (`ci-output/`; for the browser job, also `tests/ui/artifacts/`) as an artifact, kept for 7 days.
- **Caching:** `setup-node`'s npm cache. It missed only on the first run for each operating system. In the baseline run it hit for both Ubuntu jobs but not the browser job, its first Windows run; in the CI-3 run it hit in all three ("Cache restored successfully"). **The Playwright browser download is not cached;** it was optional in the scope, and is downloaded each run.

## 3. The startup-budget test (CI-4)

`tests/entrance-budget.test.mjs` counts the first paint: `index.html`, plus every `<link rel="stylesheet">` and `<script src>` it loads, read from `index.html` itself.
- **Why from the page:** a new render-blocking file is counted without editing the test.
- **Not counted:** the icon and the manifest, as LAC-2 leaves them out.
- **Line endings:** CRLF is counted as LF, so a Windows checkout and Linux give the same total.

**Reconciled exactly with the L-4 record:** `index.html` 5,510, `css/entry.css` 10,465 and `js/entry.js` 15,137 make **31,112**, the figure in `docs/landing-l4-report.md`. The test prints this breakdown on every run.

## 4. The runs

All on PR #39. "Tested" is GitHub's temporary merge commit of the PR head into `main` (`6e21a82`).

| Run | PR head | Tested | What | engine | browser | database |
|---|---|---|---|---|---|---|
| [`43638208611`](https://github.com/Aeturnia/clickmonster/actions/runs/43638208611) | `bff08ea` | `779d5eb` | First run, **all on Ubuntu** | pass 48/48 | **fail, 173/178** (section 5) | pass, 42 + 9 |
| [`43639927061`](https://github.com/Aeturnia/clickmonster/actions/runs/43639927061) | `c3d46b8` | `daa6cef` | Browser on Windows. **The green baseline** | pass 48/48 (31,112 bytes) | **pass 178/178** | pass, 42 + 9 |
| [`43640654600`](https://github.com/Aeturnia/clickmonster/actions/runs/43640654600) | `03205bd` | `affcd9f` | **CI-3:** a planted failure in each suite | fail: only `CI-3 planted failure`; 48 passed | fail: only `CI-3 planted failure`; 178 passed | fail: only `CI-3 planted failure`; 9 passed, pgTAP passed |
| [`43641540153`](https://github.com/Aeturnia/clickmonster/actions/runs/43641540153) | `2ae7e24` | `404d675` | **CI-4:** `index.html` padded | fail: only the LAC-2 test, "the first paint is 32038 bytes, over the 32000-byte budget"; 47 passed | pass 178/178 | pass, 42 + 9 |

| [`43645573860`](https://github.com/Aeturnia/clickmonster/actions/runs/43645573860), attempt 1 | `7c8c5d5` | `a60ef9e` | This report added; **code identical to `c3d46b8`** | pass 48/48 | **fail, 177/178** (section 4a) | pass, 42 + 9 |
| `43645573860`, attempt 2 (the browser job only, re-run once) | `7c8c5d5` | `a60ef9e` | The same commit | (not re-run) | **fail, 177/178, a different test** | (not re-run) |

`7c8c5d5` adds only this report to the reverted code. The code is byte-identical to `c3d46b8`: `git diff c3d46b8` on the code is empty.

### 4a. Intermittent browser failures on Windows (run `43645573860`)

At the same code that passed 178/178 in `43639927061`, the browser job failed one test on each attempt, a different test each time:

| Attempt | Test (file:line) | Error |
|---|---|---|
| 1 | "the audit log shows news changes readably" (`tests/ui/admin-news.test.mjs:242`) | `page.waitForSelector: Timeout 30000ms exceeded`, waiting for `#login` (the admin sign-in form), in `signIn` (`harness.mjs:687`), before the test's own steps |
| 2 | "LAC-12 Automatic, chosen or unset or unreadable, gives the same layouts as before" (`tests/ui/layout-choice.test.mjs:193`) | `page.waitForSelector: Timeout 15000ms exceeded`, waiting for `#top .hud-row` (the game's top bar), in `play()` (`layout-choice.test.mjs:27`) |

**What they have in common:** a page that didn't render its first element within the timeout. No assertion about the game's behaviour or layout failed, and every other test in each attempt passed.

**Not established:** the cause. It may be the shared Windows runner stalling, for example on CPU contention or antivirus scanning. It may also be a real intermittent problem in a page load or the fake backend that only shows under a slower machine. No trace or screenshot was captured: the harness saves none on a timeout, and the uploaded artifact holds only the test output.

**What it means for CI-2:** the browser check is **not yet reliable** on Windows. It passed 178/178 in 3 of 5 attempts with real code (`43639927061`, and the browser job of the CI-3 and CI-4 runs, where only the planted test failed or nothing failed), and failed one test in 2.

**Not done, because it changes test behaviour and needs the owner's decision:** retries, longer timeouts, or capturing a Playwright trace on failure. Locally the suite passed 178/178 in each of 3 runs at this code (section 7).

### Acceptance criteria

| ID | Result |
|---|---|
| CI-1 | **Met.** The PR runs show three separate checks, and each summary records the event, the PR head SHA and the tested SHA. The checkout logs confirm the merge commit, for example "HEAD is now at daa6cef Merge c3d46b8… into 6e21a82…" |
| CI-1a | **Not yet possible.** A push to `main` and a manual run can only happen after the merge. To be recorded in a short docs PR then (scope, section 8) |
| CI-2 | **Partly met.** Engine 48 on Ubuntu and database 42 + 9 on Ubuntu pass every time. Browser 178/178 on Windows in Chromium **passed at `c3d46b8`, but failed intermittently at the same code in `43645573860`** (section 4a). The browser result is a **Windows Chromium baseline, not Linux browser compatibility** |
| CI-3 | **Met.** Each of the three checks failed on its planted test alone, with every real test passing. The revert came only after all three jobs had finished. Artifacts were kept for all three (engine 2,816 bytes, browser 9,189, database 1,723). After the failure, the database job's stop step ran: "Stopped supabase local development setup." |
| CI-4 | **Met.** Padded `index.html` counts 32,038 both on Ubuntu (the CI log) and on the Windows CRLF checkout (locally), and fails there. Only the engine check failed, and only on the LAC-2 test. Unpadded, both count 31,112 |
| CI-5 | **Met.** `contents: read`, no secrets or production credentials, and no production host in the workflow. The tests' own boundaries were unchanged and ran: the UI harness fails any request off its fake backend, and the database tests refuse anything not on 127.0.0.1. Runner setup traffic (checkout, actions, `npm ci`, the Playwright browser, Docker images, caches, artifacts) is the allowed kind |
| CI-6 | **Met.** No game, server, database or deploy change, and **no test-only fixes:** no existing test was edited. The Linux failures were handled by the owner's runner exception, not by changing tests |
| CI-7 | **Met.** `README.md` and `CLAUDE.md` |
| CI-8 | **Met,** below |

## 5. The Linux browser failures (run `43638208611`)

All five are existing assertions, kept unchanged, and they pass on Windows. Each is an investigation item in the backlog follow-up "Cross-platform fonts and responsive layout".

| Test (file:line) | Assertion and threshold | Linux result |
|---|---|---|
| Admin: "navigation on a phone" (`tests/ui/admin-console.test.mjs:60`), 320×640 | The section title starts at most 250px from the top | **278px** ("content starts at 278px (before: 285)") |
| Admin: "tables … at every width" (`admin-console.test.mjs:142`) | No word broken to fit (`crushed` = 0) | **1** broken word: "320 players: no words broken to fit" |
| AC-1 320×640 (`tests/ui/responsive.test.mjs:51`) | The open-ground monster list shows at least 2 rows | **1** row ("open ground shows 1 rows (before: 0)") |
| AC-3 phone landscape 844×390 (`responsive.test.mjs:99`) | HUD text not clipped | **Clipped** |
| AC-7 200% text at 390px (`responsive.test.mjs:224`) | HUD text not clipped | **Clipped** |

**Likely cause, not established.** The game's font stack is `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. The thresholds were set on Windows with Segoe UI. The Ubuntu runner has neither Segoe UI nor Roboto, so it probably fell back to a wider font. **Which font Chromium actually resolved was not checked;** that is the follow-up's first item.

## 6. Cost (CI-8)

Billed per job, rounded up to a whole minute, at the documented rates: $0.006 a minute on Ubuntu and $0.010 on Windows. Durations are from the jobs' start and end times.

| Run | engine | browser | database | Billed minutes | Cost |
|---|---|---|---|---|---|
| `43638208611` (all Ubuntu) | 14 s → 1 | 383 s → 7 (Ubuntu) | 138 s → 3 | 11 Ubuntu | $0.066 |
| `43639927061` (baseline) | 13 s → 1 | 437 s → 8 (Windows) | 120 s → 2 | 3 Ubuntu + 8 Windows | $0.098 |
| `43640654600` (CI-3) | 12 s → 1 | 516 s → 9 (Windows) | 132 s → 3 | 4 Ubuntu + 9 Windows | $0.114 |
| `43641540153` (CI-4) | 14 s → 1 | 503 s → 9 (Windows) | 130 s → 3 | 4 Ubuntu + 9 Windows | $0.114 |
| `43645573860` attempt 1 (final head) | 20 s → 1 | 481 s → 9 (Windows) | 107 s → 2 | 3 Ubuntu + 9 Windows | $0.108 |
| `43645573860` attempt 2 (browser only) | | 463 s → 8 (Windows) | | 8 Windows | $0.080 |
| **Total so far** | | | | | **$0.580** |

**A normal passing run is about $0.10:** the browser job takes 7 to 9 minutes on Windows, and is about 80 to 90% of the cost. On Pro's $18 a month of shared compute, that is roughly 180 runs if nothing else uses it.

**Not verified:** the actual billed amounts.
- **The account's billing report** needs a token scope this session doesn't have (`user`); the owner can check it under Settings, Billing.
- **The run "timing" endpoint** reports 0 ms for every job under the new billing, so it was not used.

## 7. Local runs (Q7)

Kept alongside CI for this phase, on the laptop (Windows, Node 22.16.0), at the final code, which is identical to `c3d46b8`:
- **engine:** 48/48 in each of 3 runs;
- **browser:** 178/178 in each of 3 runs;
- **database:** 42 pgTAP plus 9 API and function tests, all passing, in 1 run. The stack ran alone and was stopped before the summary (0 containers).

The local runs and CI agree on every count.

## 8. Not verified, and limits

- **CI-1a:** the `push` and `workflow_dispatch` runs, after the merge.
- **The browser check's reliability** on Windows (section 4a): not settled, and required checks shouldn't be turned on until it is.
- **Required checks** are not set (Q2). They're for the owner to turn on after CI-1a, once the check names `engine`, `browser` and `database` have passed on `main`.
- **Linux browser compatibility:** the browser job runs only on Windows, so a Linux-only layout regression won't be caught (section 5).
- **Billed cost:** computed from durations, not read from the account (section 6).
- **The Playwright browser** is downloaded on each run, not cached.
- **Runner images change.** `windows-latest` and `ubuntu-latest` move to new images over time, which could change fonts or timing. The image is recorded in each job's summary.
- **A slip, corrected before pushing:** the first attempt to revert CI-4 didn't apply. The amended commit kept the padding, so its tree was the same as `2ae7e24`. The local branch was reset to the pushed `2ae7e24` and the revert redone. The revert commit's tree is checked to equal `c3d46b8`. Nothing wrong was pushed.
