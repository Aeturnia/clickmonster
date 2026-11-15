# CI-A report: GitHub Actions for the test suites

**Status: CI-A accepted and merged (2026-11-15). CI-1a is not yet passed (section 12).**
- **The final review** accepted CI-1 to CI-8 at `0822c79`. PR #39 was merged as `a54e392`, with a tree identical to `0822c79`.
- **After the merge:** the `push` run on `main` passed all three jobs.
- **The manual run** (`workflow_dispatch`, authorized by the owner) failed one browser test. The diagnostics show a timing assumption in that test, not contention and not an application fault (section 12).
- **Required checks stay off.**

Before the merge: CI-A-02 made (resource measurements, reduced tracing), and a pre-existing fixture expiry fixed by review decision (section 11).
- **The reduced-tracing series** (six Windows attempts): **6 of 6 passed 178/178.**
- **The measurements** point to broader contention on the two-core runner, not the Node test process (section 11.5). The trace's screencast added substantially to that contention.

Before that:
- **Re-review of `f218428`:** CI-A-01 (diagnostics) was accepted and stays on, and the LAC-5b correction was authorized.
- **The correction is in,** and `main` (with PR #38) is merged into the branch.
- **The new series:** LAC-5b passed in all six Windows attempts. Three attempts failed the earlier unexplained timeout (`#top .hud-row`), now with diagnostics. The evidence points to the test environment being starved on the Windows runner, not to the application (section 10.4). **CI-2 is still not met.**

Earlier status:
- **The review** of `3b8d0c7` accepted CI-1 and CI-3 to CI-8. CI-2 is not accepted, because the Windows browser job failed intermittently (section 4a).
- **CI-A-01** adds failure-only diagnostics (section 9). A bounded series of six Windows attempts captured two failures, both of a third test, `LAC-5b`. The evidence points to a timing assumption in that test, not a stalled browser or an application defect (section 9.3). The decisions are in section 9.4.
- **At that point nothing was fixed:** no test, timeout or retry had changed, and the two earlier failures hadn't been reproduced. (The LAC-5b test was corrected later, in section 10. The `#top .hud-row` timeout was captured in section 10.4.)
- **Authorized:** by the owner on 2026-11-14, after the scope (`docs/ci-scope.md`) was approved and merged as PR #37 (`6e21a82`).
- **Scope exception:** after the first run, the owner authorized one exception. Only the browser job runs on Windows (scope, section 10).
- **No game, server, database or deploy change.** No branch protection or required checks are set. Parts 2 and 3 are not started.
- **PR #38** (the scope-approval record) was merged on 2026-11-15 as `6c3ace0` and merged into this branch (section 10).

## 1. What changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | **New.** One workflow, three jobs (section 2) |
| `tests/entrance-budget.test.mjs` | **New.** LAC-2 as a test: at most 32,000 bytes (section 3) |
| `package.json`, `package-lock.json` | `"engines": { "node": "22.x" }` (Q4). The lockfile change is only that root entry; `npm ci` installs cleanly |
| `README.md`, `CLAUDE.md` | How CI runs and how to read a failure (CI-7). The engine count is now 48 |
| `docs/ci-scope.md` | Section 10, the runner exception; CI-2 and the cost revised (the owner's instruction) |
| `docs/backlog.md` | A follow-up: cross-platform fonts and responsive layout (section 5) |

**Not changed:** `public/` (the game, the entrance, the admin console), `supabase/` and `netlify/`; every browser test's thresholds and timeouts.

**Tests changed, by review decision only:**
- **`tests/ui/entrance.test.mjs`:** one test, LAC-5b, now waits for the held `state` call before acting (section 10). That is 13 lines added and no assertion changed.
- **`tests/ui/harness.mjs`:** one line, which starts the diagnostics (sections 9 and 11).
- **`tests/ui/diagnostics.mjs`:** new.

Every other existing test is unchanged.

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
| CI-6 | **Met.** No game, server, database or deploy change. The Linux failures were handled by the owner's runner exception, not by changing tests. **One existing test was later changed, by review decision:** LAC-5b's synchronization (section 10). No assertion or threshold was changed |
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
| `43647187448` (`3b8d0c7`) | 11 s → 1 | 452 s → 8 (Windows) | 115 s → 2 | 3 Ubuntu + 8 Windows | $0.098 |
| `43651793464` attempt 1 (CI-A-01, diagnostics on) | 20 s → 1 | 545 s → 10 (Windows) | 126 s → 3 | 4 Ubuntu + 10 Windows | $0.124 |
| `43651793464` attempts 2–6 (browser only) | | 719, 445, 716, 730, 476 s → 12 + 8 + 12 + 13 + 8 (Windows) | | 53 Windows | $0.530 |
| `43657243652` (`f218428`) | 13 s → 1 | 715 s → 12 (Windows) | 131 s → 3 | 4 Ubuntu + 12 Windows | $0.144 |
| `43675530218` attempt 1 (LAC-5b corrected) | 23 s → 1 | 776 s → 13 (Windows) | 131 s → 3 | 4 Ubuntu + 13 Windows | $0.154 |
| `43675530218` attempts 2–6 (browser only) | | 747, 587, 726, 552, 769 s → 13 + 10 + 13 + 10 + 13 (Windows) | | 59 Windows | $0.590 |
| `43680988350` (`2fc3a4e`) | 25 s → 1 | 722 s → 13 (Windows) | 129 s → 3 | 4 Ubuntu + 13 Windows | $0.154 |
| `43757000211` (`0bc605a`, screencast on, for comparison) | 12 s → 1 | 724 s → 13 (Windows) | 120 s → 2 | 3 Ubuntu + 13 Windows | $0.148 |
| `43758237058` attempt 1 (`7f1fd39`, reduced tracing) | 18 s → 1 | 516 s → 9 (Windows) | 129 s → 3 | 4 Ubuntu + 9 Windows | $0.114 |
| `43758237058` attempts 2–6 (browser only) | | 456, 500, 481, 581, 484 s → 8 + 9 + 9 + 10 + 9 (Windows) | | 45 Windows | $0.450 |
| `43765989167` (push to `main`, `a54e392`) | 19 s → 1 | 515 s → 9 (Windows) | 108 s → 2 | 3 Ubuntu + 9 Windows | $0.108 |
| `43776194000` (manual run, `a54e392`) | 13 s → 1 | 541 s → 10 (Windows) | 116 s → 2 | 3 Ubuntu + 10 Windows | $0.118 |
| **Total so far** | | | | | **$3.312** |

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
- **The browser check's reliability** on Windows (sections 4a and 9): not settled, and required checks shouldn't be turned on until it is.
- **Required checks** are not set (Q2). They're for the owner to turn on after CI-1a, once the check names `engine`, `browser` and `database` have passed on `main`.
- **Linux browser compatibility:** the browser job runs only on Windows, so a Linux-only layout regression won't be caught (section 5).
- **Billed cost:** computed from durations, not read from the account (section 6).
- **The Playwright browser** is downloaded on each run, not cached.
- **Runner images change.** `windows-latest` and `ubuntu-latest` move to new images over time, which could change fonts or timing. The image is recorded in each job's summary.
- **A slip, corrected before pushing:** the first attempt to revert CI-4 didn't apply. The amended commit kept the padding, so its tree was the same as `2ae7e24`. The local branch was reset to the pushed `2ae7e24` and the revert redone. The revert commit's tree is checked to equal `c3d46b8`. Nothing wrong was pushed.

## 9. Review correction CI-A-01: failure diagnostics (review of `3b8d0c7`)

**The review.** It accepted CI-1 and CI-3 to CI-8, and deferred CI-1a to after the merge. **CI-2 was not accepted**, because of the intermittent Windows failures (section 4a).

**The owner's decision:** capture evidence first. Retries and longer timeouts are not allowed yet.

### 9.1 What was added

**`tests/ui/diagnostics.mjs`** (new), wired into the harness with one line in `setup().page()` (`track(context, page, backend)`). It is on only with `UI_DIAGNOSTICS=1`, which the CI browser job sets; local runs are unchanged by default.

**Before a page navigates,** each test context:
- **starts a Playwright trace** (screenshots, DOM snapshots, network and sources), through `BrowserContext.tracing`. The suite runs on `node:test`, not Playwright Test, so Playwright Test's `trace: 'retain-on-failure'` doesn't apply;
- **records** console errors and warnings, page errors, failed requests, responses of 400 and over, and requests still in flight.

**When a test fails,** an `afterEach` hook sees `passed === false`. It writes each of that test's open contexts to `tests/ui/artifacts/failures/<file>/<test>/`:
- `trace.zip`, the trace (`npx playwright show-trace trace.zip`);
- `screenshot.png` and `dom.html`;
- `diag.json`, with:
  - the URL;
  - a timed trivial evaluate, and a timed `requestAnimationFrame`, which tell a stuck renderer from a running page;
  - `readyState`;
  - whether key elements (`#login`, `#authform`, `#top .hud-row`, `.a-nav` and others) are absent, present or visible;
  - the resources loaded, with timings;
  - the recorded errors and requests;
  - the fake backend's recent calls, auth calls and unexpected requests.

The existing failure-only upload (`tests/ui/artifacts/`) keeps them for 7 days.

**Safeguards:**
- **A passing test keeps nothing;** its trace is discarded when its context closes.
- **Every capture step** has its own time limit and catches its own errors. The diagnostics can't hang a run or change a result.
- **No test, assertion, timeout or outcome changed,** and there are no retries.
- **It stays inside the test environment:** the pages only reach the local server and the fake backend (`attach()`).

**Checked locally first** (Node 22.16.0):
- **The hook works when imported:** an `afterEach` registered at the top level of an imported module runs for each test in the importing file, and sees `passed` as `false` on an assertion failure and on a rejected wait. The failures and exit code 1 are unchanged.
- **A throwaway file** (not committed) produced the expected results:
  - a wait timing out after an admin sign-in: failed, all four files saved, every step under 0.13 s;
  - an assertion failure: failed, all four files saved;
  - a passing test: nothing saved;
  - the process exit code was 1.
- **The full browser suite, diagnostics on:** 178/178 in 472 s, against 410 s off. **About 15% overhead,** and no files kept.

### 9.2 The bounded series

One run at `bcea8c7`, then five re-runs of the browser job only. That is **six Windows attempts**, all in [run `43651793464`](https://github.com/Aeturnia/clickmonster/actions/runs/43651793464), each testing merge commit `c9f2048` (`bcea8c7` merged into `6e21a82`).

| Attempt | browser | Duration | Failure |
|---|---|---|---|
| 1 (with engine and database, both passing) | 178/178 | 545 s | |
| 2 | 178/178 | 719 s | |
| 3 | 178/178 | 445 s | |
| 4 | **177/178** | 716 s | `LAC-5b an account change while the game is starting…` (`tests/ui/entrance.test.mjs:230`), diagnostics captured (artifact `14137108862`) |
| 5 | **177/178** | 730 s | the same test, diagnostics captured (artifact `14138455797`) |
| 6 | 178/178 | 476 s | |

**Result:** 4 of 6 attempts passed. Neither earlier failure recurred (the `#login` wait in `admin-news`, the `#top .hud-row` wait in `layout-choice`). A third test failed twice.

### 9.3 The `LAC-5b` failure

**The error,** the same in both attempts: `assert.equal(stateCalls(backend), 1)` at `entrance.test.mjs:247` got **0**. The fake backend never received the game's `state` call.

The two assertions just before it passed: the game was never shown, and the sign-in form was visible.

**What the test does:**
1. holds the `state` call;
2. signs in;
3. waits for the entrance's veil (`#app.veiled`);
4. signs out;
5. releases the hold;
6. expects exactly one `state` call to have arrived.

**What the diagnostics show,** in both captures:
- **The browser wasn't stalled.**
  - The trivial evaluate answered in 6 ms, and an animation frame came within 0–1 ms.
  - `readyState` was `complete`, with no page errors, no console errors and nothing in flight.
- **The game's start-up never reached `state`.** In order:
  - the sign-in token request at about 280–300 ms;
  - `css/style.css` and `js/main.js` loaded;
  - the zones read (`/rest/v1/zones`) at 672 ms and 737 ms;
  - the test's sign-out (`/auth/v1/logout`) 19 ms and 4 ms after the zones read started.

  The backend's recorded calls are empty. Its auth calls are one `password` grant. The logout request shows as `net::ERR_ABORTED` in the browser, after the fake backend answered it.
- **The screenshot** shows the sign-in form with "Your session has ended. Please sign in again." and no game, which is the correct end state.

**What the code does.**
- `entry.js:221` adds the veil **before** calling `game.start()`.
- `start()` in `main.js` first awaits `zonesReady()` (line 1719). If the session has ended by then, it returns at line 1720, before `api('state')` at line 1721. This is the account-isolation guard from L-1 (L1-01, L1-02) working as designed.

**Conclusion, as far as the evidence goes:**
- **The application behaved correctly:** the stale start stopped before asking for the hero, and the entrance showed the sign-in form.
- **The test assumes** that once the veil is up, the `state` request is already being held. On a slower run, the sign-out lands during the zones read instead, so no `state` call is ever made.
- **This is a timing assumption in the test,** not a stalled browser and not an application defect.

**Not established:**
- **Why it appeared now.** It passed in all six earlier Windows attempts, the Ubuntu run and every local run. Tracing slows each page by about 15% locally, which may widen the window between the veil and the `state` call. The diagnostics may therefore be affecting this timing.
- **The two earlier failures** (`#login` after 30 s, `#top .hud-row` after 15 s) weren't reproduced, so their cause is still unknown. They needn't share a cause with this one.

### 9.4 For the reviewer to decide

Nothing below has been done.

- **`LAC-5b`, test-only:** the evidence supports changing the test to wait until the held `state` request has actually arrived (for example, `stateCalls(backend) === 1`) before signing out. That is what the test means to exercise. It would change only when the test acts, not what it asserts, and no application change is suggested.
- **The earlier two failures:** keep the diagnostics on in CI, so the next occurrence is captured. A further bounded series is possible, at about $0.09 to $0.13 per Windows attempt.
- **Required checks** should stay off until the browser check is reliable.

### 9.5 Cost of the correction

The series cost **$0.654**, of which $0.63 was 63 Windows minutes. The running total is **$1.332** (section 6). These figures are computed from job durations; the billing page wasn't read.

With diagnostics on, browser attempts took 445 to 730 s, against 437 to 516 s before. Part of that is the tracing; the rest is runner variation that wasn't separated out.

## 10. The LAC-5b correction (re-review of `f218428`)

**The re-review:**
- **CI-A-01 accepted:** the diagnostics stay on in the Windows browser job.
- **LAC-5b's diagnosis accepted** (section 9.3), and a test-only synchronization correction authorized.
- **Retries and longer timeouts:** still no.
- **Required checks:** still off.
- **PR #38:** approved, merged as `6c3ace0` (identical to `ddc62ee`), then merged into this branch (`8a3c72a`). The merge had no conflicts. The branch's `CLAUDE.md` now states CI-A as authorized and under review in PR #39.

### 10.1 The failure at the reviewed head

Run [`43657243652`](https://github.com/Aeturnia/clickmonster/actions/runs/43657243652), at `f218428` (merge `75e129e`):
- **Results:** engine and database passed; browser 177/178, failing `LAC-5b` (`0 !== 1`) again.
- **Its diagnostics** (artifact `14139146848`) match section 9.3:
  - the trivial evaluate answered in 5 ms, and a frame came at once;
  - no `state` call was made;
  - the sign-out came 5 ms after the zones read began (zones read at 586 ms, logout at 591 ms).

### 10.2 The correction

**`tests/ui/entrance.test.mjs` only, 13 lines added, none removed.**

**A new helper, `untilStateCalls(backend, n, ms = 15000)`:**
- it polls, from Node, every 20 ms, until the fake backend has recorded `n` `state` calls;
- after 15 seconds it fails the test with "expected n state call(s) within 15000 ms, got m";
- **why the count is a sound signal:** the backend records a call before it awaits a hold (`harness.mjs:587–588`), so once the count reaches `n`, the start really is waiting at `state`.

**Used at both points in the test:**
- **before the first sign-out:** `untilStateCalls(backend, 1)`;
- **before the switch to the moderator:** `untilStateCalls(backend, 2)`.

**Unchanged:**
- every assertion and final count: 1 after the first part, 3 at the end, the moderator's hero shown, no stale game;
- `public/`, the server, authentication, every other test, and every threshold and timeout. The 15-second deadline matches the waits already in this test; it isn't a global change;
- no retries, fixed sleeps or test hooks in the application.

### 10.3 Validation

**Locally,** with throwaway copies of the test that were not committed and are deleted:

| Variant | Result |
|---|---|
| The **old** test with a 400 ms delay on the zones read (as on the slow runner) | **Fails** `0 !== 1`, the CI failure reproduced |
| The **corrected** test with the same delay | Passes |
| The **corrected** test with a zones read that never answers, so `state` is never asked for | **Fails** "expected 1 state call(s) within 15000 ms, got 0": it fails when the request never arrives |

- **The corrected test alone,** 20 times with `UI_DIAGNOSTICS=1`: **20 of 20 passed.**
- **The full suites,** 3 runs: engine 48/48 and browser 178/178 in each.

**On CI:** run [`43675530218`](https://github.com/Aeturnia/clickmonster/actions/runs/43675530218) at `f3c22c1` (merge `4603484`), then five re-runs of the browser job. Six Windows attempts, diagnostics on; engine and database on Ubuntu passed.

| Attempt | browser | Duration | Failure |
|---|---|---|---|
| 1 | 177/178 | 776 s | `LAC-12 Desktop falls back under 200% text…` (`layout-choice.test.mjs:134`): `#top .hud-row` not visible within 15 s, in `play()` (artifact `14146523372`) |
| 2 | 177/178 | 747 s | the same test, the same wait (artifact `14146976364`) |
| 3 | 178/178 | 587 s | |
| 4 | 178/178 | 726 s | |
| 5 | 178/178 | 552 s | |
| 6 | 177/178 | 769 s | `LAC-12 Automatic, chosen or unset or unreadable…` (`layout-choice.test.mjs:193`): the same wait (artifact `14147723786`) |

**LAC-5b passed in all six attempts.** The correction holds on CI.

**The browser check passed in 3 of 6.** The failures are the earlier unexplained `#top .hud-row` timeout (section 4a, run `43645573860` attempt 2), now captured with diagnostics three times.

### 10.4 The `#top .hud-row` timeouts: what the diagnostics show

**The same in all three:**
- **The game never asked for its data.** The fake backend recorded **no game calls at all**, and only one auth call, the password grant. The test's sign-in went in, but the game's code never got as far as `state`.
- **Nothing errored:** no page errors, no console errors, no failed requests and no 4xx or 5xx responses.
- **The entrance was showing "Entering the realm",** with the game still hidden: `#app` present but not visible, and `appDataset` empty.

**Everything the test process serves was extremely slow:**
- **Attempt 1** (from its trace's network log):
  - the game's own modules, served by the local test server, took **33 to 43 seconds** (`engine/monster.js` 33.2 s, `engine/world.js` 34.2 s, `data/gems.js` 41.7 s, `data/zones.js` 42.9 s);
  - eight more modules never finished (`chat-ui.js`, `layout.js`, `engine/combat.js` and others).
- **Attempt 2:**
  - the fake backend's sign-in (`/auth/v1/token`) took 11.5 s;
  - `css/style.css` took 20.2 s.
- **Attempt 6:**
  - `js/net.js` took 10.3 s, and `js/config.js` 5.3 s;
  - the vendored supabase-js took 3.3 s, and sign-in 2.3 s;
  - `js/main.js` was still in flight when captured.

  Normally each of these takes 10 to 50 ms (section 9.3).

**Playwright's own commands to the page were slow too:**
- **Attempt 1:** a trivial evaluate didn't answer within 5 s, and every capture step failed except saving the trace.
- **Attempts 2 and 6:** the evaluate took 2.6 s and 1.9 s, against 5–6 ms in the LAC-5b captures. Every screenshot timed out after 10 s.

**The tests themselves ran 63 to 95 s.**

**Where those requests are handled:** the local file server (`startServer()`) and the fake backend's route handlers (`attach()`) both run **inside the Node test process**. Every page file and every Supabase request waits on that process.

**Conclusion, as far as the evidence goes:**
- **This isn't an application initialization defect.** The game's code was still being delivered when the wait ran out, with no errors.
- **The test environment on the Windows runner was starved,** so that serving files, answering routes and Playwright commands all took seconds to tens of seconds.
- **The earlier `admin-news` timeout** (`#login` after 30 s) is consistent with the same, but wasn't captured with diagnostics.

**Not established:**
- **What was starved:** the Node test process's event loop, the Playwright driver, or the whole runner VM. The diagnostics record no CPU or event-loop measurements.
- **Why these tests:** the captured failures ran at 1920×1080, two with text at 200%. The earlier ones were also large desktop sizes (`LAC-12 Automatic`; the admin console at 1440×900). Rendering large pages in software on a two-core runner may be the load, but that wasn't measured.
- **Whether tracing makes it worse.** Its screencast frames at 1920×1080 add load. But the same timeout happened without diagnostics (run `43645573860`), so tracing isn't the only cause.

### 10.5 For the reviewer to decide

Nothing below has been done.

1. **Measure the starvation:** add event-loop delay (`perf_hooks.monitorEventLoopDelay`) and process CPU use (`process.cpuUsage()`) to `diag.json`, sampled through each test. This would tell the Node process apart from the machine. It is diagnostics only.
2. **Reduce the tracing load:** keep DOM snapshots and network in the trace, but turn off its screencast (`screenshots: false`). The failure screenshot is taken separately anyway.
3. **Move the local file server out of the test process,** so a busy test process can't delay page files. This is a harness change; the tests stay the same.
4. **A larger Windows runner:** 4 cores, at a higher per-minute rate, if the runner itself is short of CPU.

**The browser check isn't reliable on Windows yet,** so required checks should stay off.

### 10.6 Cost

| Item | Cost |
|---|---|
| Run `43657243652` | $0.144 |
| This series | $0.744 |
| **Running total** | **$2.220** |

These figures are computed from job durations; the billing page wasn't read. Browser attempts in this series took 552 to 776 s, the longest so far.

## 11. CI-A-02: resource measurements and reduced tracing (re-review of `2fc3a4e`)

**The re-review:**
- **LAC-5b's correction accepted.** CI-2 remains open.
- **Authorized:**
  - low-overhead measurements of event-loop delay, CPU and memory for every test;
  - trace screenshots (the screencast) off;
  - a bounded series of up to six Windows attempts.
- **Not allowed without another decision:** retries, longer timeouts, moving the local server, or a larger runner.

### 11.1 The latest-head run before this work

Run [`43680988350`](https://github.com/Aeturnia/clickmonster/actions/runs/43680988350), at `2fc3a4e` (merge `c373e7e`): **all three jobs passed**, with engine 48, browser 178/178 and database 42 + 9. The browser job took 722 s.

### 11.2 A pre-existing fixture expiry (separate from CI-A-02)

**What happened.** On 2026-11-15, the local comparison runs (11.4) failed `moderation: from a report to a sanction without leaving the report; explicit steps` (`admin-console.test.mjs:259`) with "current sanctions shown". It failed in both trace configurations, with diagnostics off, and at the reviewed head `2fc3a4e`.

**Cause:**
- **The fixture:** the fake admin data banned Grubnak until `NOW + 3 days` (`harness.mjs:233`, since UI Phase 4, `5a306bc`), with `NOW` fixed at 2026-11-12 12:00 UTC.
- **The check:** the admin console decides whether a ban is current against the browser's real clock.
- **So** the ban expired at 2026-11-15 12:00 UTC, and the test's precondition stopped holding.
- **Not related** to CI or the diagnostics.

**The owner's decision:** a one-line correction, approved. Grubnak's `banned_until` is now `iso(Date.now() + 3 * day)`, like the fixture's other active entries.
- **Unchanged:** `NOW`, every historical timestamp, the application and every assertion.
- **Commit:** `d7fe356`, separate from CI-A-02.

**Checked:**
- the moderation test alone passed;
- Grubnak's ban was active, until 2026-11-18;
- the full browser suite passed 178/178 (406 s);
- it is the only date tied to the fixed `NOW` that lies in the future (a search for `NOW +`).

### 11.3 What was added

**In `tests/ui/diagnostics.mjs`,** still on only with `UI_DIAGNOSTICS=1`.

**Measurements for every test, passing or failing,** one JSON line each in `tests/ui/artifacts/metrics/<file>.jsonl`:
- the test's duration;
- the Node test process's **event-loop delay** (`monitorEventLoopDelay`, 20 ms resolution: mean, p99 and max);
- **the Node process's CPU** (`process.cpuUsage()` over wall time, as a percentage of one core);
- **the whole machine's CPU** (`os.cpus()` times, as a percentage of all cores);
- RSS, heap and free memory.

**Each file's first line** records the runner: OS and release, cores, CPU model, memory, Node version, and the runner image.

**Overhead:** the figures are read only at each test's start and end, and the histogram samples every 20 ms.

**Uploads:**
- **A new step uploads the measurements on every run** (`browser-metrics-attempt-<n>`, 7 days), so passing and failing runs can be compared.
- **On a failure,** `diag.json` also carries the failing test's measurements up to the failure.

**Reading the event-loop figures:** the histogram includes its own sampling interval, rounded to the OS timer.
- On Windows, an idle process reads about **31 ms** at a 20 ms resolution.
- A 300 ms stall reads as a maximum of about 316 ms. Both were checked on the laptop.
- So delay is about the reading minus 31 ms.

**Trace screenshots off:** `tracing.start({ screenshots: false, snapshots: true, sources: true })`.
- **Still kept on failure:** the failure screenshot (taken separately), the DOM snapshots, the network log, page state, and console and page errors.
- **`UI_TRACE_SCREENSHOTS=1`** turns the screencast back on, for comparison only. The workflow no longer sets it.

**Checked locally (throwaway file, not committed):**
- **A timed-out wait:** failed, with all four capture files saved, and the trace held **no screencast frames**.
- **A passing test:** nothing captured.
- **Both** wrote a measurement line; the process exit code was 1.

### 11.4 The comparison: screencast on, then off

**Locally,** on the owner's laptop (8 cores), the full browser suite with diagnostics on, in both configurations. Both include the fixture failure from 11.2, which was found here.

| Screencast | Wall time | Event-loop max, median per test | Node CPU, median | Machine CPU, median / p95 |
|---|---|---|---|---|
| off | 465 s | 34 ms | 49% | 34% / 49% |
| on | 503 s | 34 ms | 58% | 45% / 62% |

**On the Windows runner:**
- **2 cores** (AMD EPYC 7763), 8 GB, image `win25-vs2026` 20261103.298.1, Node 22.23.4.
- **One run with the screencast on,** then the series with it off.

| Run | Browser | Test time (sum) | Event-loop max, median / p95 / worst | Node CPU, median | Machine CPU, median / p95 |
|---|---|---|---|---|---|
| [`43757000211`](https://github.com/Aeturnia/clickmonster/actions/runs/43757000211) at `0bc605a` (merge `51bed55`), **screencast on** | **177/178** | 641 s | 42 / 113 / **3,651 ms** | 31% | **73% / 94%** |
| [`43758237058`](https://github.com/Aeturnia/clickmonster/actions/runs/43758237058) attempt 1 at `7f1fd39` (merge `a3b369b`), off | 178/178 | 451 s | 34 / 100 / 369 ms | 27% | 60% / 95% |
| attempt 2, off | 178/178 | 409 s | 33 / 66 / 172 ms | 26% | 56% / 89% |
| attempt 3, off | 178/178 | 427 s | 34 / 62 / 436 ms | 30% | 58% / 86% |
| attempt 4, off | 178/178 | 427 s | 34 / 59 / 88 ms | 29% | 58% / 86% |
| attempt 5, off | 178/178 | 513 s | 34 / 90 / **2,787 ms** | 30% | 67% / 90% |
| attempt 6, off | 178/178 | 424 s | 33 / 54 / 419 ms | 29% | 56% / 86% |

**The reduced-tracing series passed 6 of 6.** Engine and database passed on Ubuntu.

### 11.5 What the measurements show

**The test that keeps failing,** `LAC-12 Automatic, chosen or unset or unreadable, gives the same layouts as before`, failed again in the screencast-on run, with the same `#top .hud-row` timeout:

| Run | Duration | Event-loop max | Node CPU | Machine CPU |
|---|---|---|---|---|
| screencast on (failed) | **70.8 s** | **3,651 ms** (p99 482) | **10.6%** | **95.5%** |
| off, attempts 1–6 (all passed) | 13.0–17.7 s | 32–76 ms | 39–42% | 66–77% |

**Its failure capture:**
- a trivial evaluate took 3.3 s;
- the game's modules took 1.0–1.3 s each, against tens of milliseconds normally;
- by the time of the capture, the game's top bar *was* visible: the start finished after the 15 s wait had run out.

The capture also records no backend calls for that context. **This was not resolved:** it may be a different context of this many-context test, and it wasn't investigated further.

**The next test in that run** (`a choice made on the entrance applies on sign-in…`) measured 98.1% machine CPU, 8.5% Node and a 1,747 ms stall. It passed.

**Which explanation fits best:**
- **Not the Node test process being busy.** In the worst stalls, Node used about 10% of one core while the machine was 95–98% busy, and its event loop still stalled for seconds. Node was waiting for CPU, not using it. When contention was lower, Node used about 40% and stalled for under 80 ms.
- **Broader runner contention fits.** The two cores were saturated by something other than the Node process, and Node's stalls, the slow file serving and the slow Playwright commands all followed from that.
- **What used the CPU** wasn't measured: per-process CPU for Chromium or the Playwright driver isn't recorded. The browser's renderer and GPU processes are the likely candidates. The failing tests render large desktop pages (1920×1080, some at 200% text), and the screencast encodes those frames.
- **Browser responsiveness was low too:** Playwright evaluates took seconds. That is consistent with a saturated machine, not a browser-only fault.
- **Trace screenshots added substantially to the contention.** With them on, the machine was busier (median 73% against 56–67%) and the suite slower (641 s against 409–513 s). The one failure came in that run.

**Not established:**
- **That contention is gone with the screenshots off.** Attempt 5 still had one 2,787 ms stall: in `AC-8 axe: new layouts have no serious or critical violations` (`responsive.test`), at 78% machine and 10.9% Node, and it passed.
- **The earlier timeouts happened without any diagnostics** (run `43645573860`). So the runner's contention exists without tracing, and the six green attempts are a sample, not proof.

### 11.6 For the reviewer

**The evidence so far:**
- with reduced tracing, the browser check passed 6 of 6, on top of the green latest-head run;
- every captured timeout matches CPU contention on a two-core runner;
- no application error was seen in any capture.

**Options, none taken:**
- **Accept CI-2 on this series,** with diagnostics kept on, and watch the measurements.
- **A further bounded series.**
- **A larger runner, or moving work off the runner:** these need another decision, as the review said.

**Required checks** stay off until the reviewer decides.

### 11.7 Cost

| Item | Cost |
|---|---|
| `43680988350` | $0.154 |
| Comparison run `43757000211` | $0.148 |
| Series `43758237058` | $0.564 |
| **Running total** | **$3.086** |

These figures are computed from job durations; the billing page wasn't read. Reduced-tracing browser attempts took 456 to 581 s, against 724 s in the screencast-on run.

## 12. After the merge: CI-1a (2026-11-15)

**The final review** accepted CI-1 to CI-8 at `0822c79`.
- **PR #39** was merged as `a54e392`, its tree identical to `0822c79` (`git diff 0822c79 a54e392` is empty).
- **Still configured as reviewed:** engine on Ubuntu, browser on Windows Chromium, database on Ubuntu; trace screenshots off by default; failure artifacts and resource measurements on.

### 12.1 The two runs

| Run | Event | Tested | engine | browser | database |
|---|---|---|---|---|---|
| [`43765989167`](https://github.com/Aeturnia/clickmonster/actions/runs/43765989167) | `push` to `main` (the merge) | `a54e392` | 48/48 | **178/178** | 42 + 9 |
| [`43776194000`](https://github.com/Aeturnia/clickmonster/actions/runs/43776194000) | `workflow_dispatch` on `main` (authorized by the owner) | `a54e392` | 48/48 | **177/178** | 42 + 9 |

**Both triggers work.** Each job's summary recorded the event, and the tested commit `a54e392`; for these events there is no separate PR merge commit.

**The push run** is green. **The manual run** isn't, so **CI-1a is not passed yet.** The run was not re-run to make it green.

### 12.2 The manual run's failure

**The test:** `LAC-5b a library that fails once and is retried still gives one client` (`tests/ui/entrance.test.mjs:387`).
- **The error:** `page.waitForSelector: Timeout 15000ms exceeded`, waiting for `#top .hud-row`, in `inGame()`.
- **The page showed** "The sign-in service could not be loaded", with the form visible.

**Not contention.** The test's measurements:
- machine CPU 6.5% and Node 0.9%;
- event-loop max 36 ms, which is the idle baseline;
- a trivial evaluate took 3 ms, and nothing was in flight.

**What the test does:**
1. aborts the first two requests for the vendored supabase-js (`fail = 2`). Its comment: "the first attempt (on focus) and the first send";
2. fills the form;
3. sends;
4. waits for "could not be loaded";
5. sends again, and expects the game.

**What the trace shows:**

| Time in the trace | What happened |
|---|---|
| 24,330 ms | `fill('#email')` (focus) |
| 24,383 ms | the first click on Sign in |
| about 24,412 ms | **library request 1,** aborted |
| 24,444 ms | "could not be loaded" shown |
| 24,465 ms | the retry click |
| about 24,477 ms | **library request 2,** aborted |
| | **no third request, and no sign-in request (`authCalls` empty)** |

`js/net.js` itself took 40 ms to load and finished just before request 1. The focus and the first send therefore shared **one** in-flight load: request 1. Its failure produced the message. The retry then made request 2, the test's *second* planned abort. The entrance correctly showed the error again and waited for another try, which the test never makes.

**Conclusion, as far as the evidence goes:** a timing assumption in this test, like LAC-5b's earlier one.
- **The test assumes** the focus load and the first send are always separate requests.
- **When the library hasn't started loading by the time Sign in is clicked,** they share one, which is correct behaviour: one load at a time.
- **The application behaved correctly throughout:** one shared load, a persistent error with `role="alert"`, and a fresh attempt on retry.

**Not established:** why the timing differed on this run. The machine was idle, and the gap between focus and click (53 ms) is set by Playwright.

### 12.3 For the reviewer to decide

Nothing below has been done.

- **A test-only correction for this test,** along the lines of LAC-5b's:
  - abort until the retry instead of by count, for example failing every request until the test has seen "could not be loaded", then letting the next one through;
  - or wait, from Node, for the focus-triggered request to have failed before the first send.

  Either way the assertions stay as they are: one client, one listener, the alert, and the game after the retry.
- **Then** repeat the manual run to complete CI-1a.
- **Required checks** stay off until CI-1a passes and the owner authorizes them.

**Cost:** the two runs were $0.226; the running total is $3.312 (section 6).

