# Windows browser CI: `ERR_NO_BUFFER_SPACE`, investigation plan

**Status: a plan (2026-11-19), with M0's results (section 7) and M1 and M3's counters in place (2026-11-20).** Authorized by the owner as "a separate, documentation-first investigation plan covering connection counts, socket lifecycle, HTTP keep-alive, browser-context cleanup and resource pressure". **What the owner has authorized** (2026-11-20):
- **M0:** reading the CI history and its artifacts. The results are in section 7.
- **M1 and M3:** observation-only counters in the test harness (`tests/ui/diagnostics.mjs`), in their own reviewed PR.
- **M4:** passive correlation, once the counters have data.

**Not authorized:** M2 (a workflow change), M5, and any change to connection behaviour, keep-alive settings, concurrency, timeouts or retries.

## 1. The problem

The CI `browser` job (`npm run test:ui`, Chromium, `windows-latest`, two cores) sometimes fails one test because Chromium's request to the test harness's own local server fails with `net::ERR_NO_BUFFER_SPACE`. That is Windows' socket error `WSAENOBUFS` (10055): the TCP stack couldn't allocate buffer space or a port for a socket.

**What is and isn't implicated:**
- **The features under test aren't shown to be defective:** each failing test fails because a page or module never loaded.
- **The test harness is not cleared.** How it manages connections is a candidate cause (sections 2 and 3): the one local HTTP server per file, a new browser context per test, and keep-alive.

**The seven known occurrences** (`docs/backlog.md`, and the PR comments):

| # | Run | Where | Failed request | The test (position in the run, where known) | Re-run |
| --- | --- | --- | --- | --- | --- |
| 1 | `44238281270` | PR #47, docs-only | `/js/data/masteries.js` | not recorded here | attempt 2 passed |
| 2 | `44410857655` | PR #51 | `/js/data/items.js` | `R1-02 an expired link…`, past test 200 | attempt 2 cancelled (superseded by a push): no result |
| 3 | `44432245764` | `main` after GP-1 | not recorded | `GP-B4` | attempt 2 passed, 248/248 |
| 4 | `44538744904` | PR #55 | `/js/data/stats.js` | `P4-04` (admin console) | attempt 2 passed, 288/288 |
| 5 | `44546513378` | PR #55 | not recorded here | (recorded on PR #55 only) | attempt 2 passed |
| 6 | `44643826518`, attempt 1 | PR #59 | `page.goto` of `/` | `LAC-5b`, test 95 | attempt 2 **failed, on another test** (GP-B7, a test timing assumption, not this fault) |
| 7 | `44668968108` | PR #61 | `/js/entry.js` | `AC-3 phone landscape`, test 261 | attempt 2 passed, 312/312 |

**The re-runs, counted:** of the seven, five completed and passed (#1, #3, #4, #5, #7). One was cancelled with no result (#2). One completed and failed on an unrelated test (#6). No re-run failed with this fault again.

**What they have in common** (only where the evidence exists):
- **The host:** every failed request whose address is recorded (#1, #2, #4, #6, #7) was to the harness's own HTTP server on `127.0.0.1`, never to the fake Supabase host. Those requests are answered by Playwright's routing, not by a socket. For #3 and #5 the failed request isn't recorded here; M0 would recover it from those runs' logs or artifacts where they still exist.
- **The kind of request:** each recorded one was a page or module load (HTML, or an ES module).
- **The runner's state:** where diagnostics exist (#2, #6, #7), there were no page errors and CPU and memory were low. In #7 the machine CPU was 7%, with 5.6 GB free.
- **The test:** never the same one twice.
- **The position:** from test 95 to past test 260. So it isn't only late in the run.

**Separate from these:** six other intermittent failures found in the same period were races in tests or the fake backend, each corrected or recorded separately:
- PR-4a's second tab;
- SO-9, SO-2 and SO-3;
- B2-6's paint entry;
- GP-B7's animation start;
- F-1 proof 4's counter.

This plan is about the network fault only.

## 2. How the suite uses connections (from the code)

- **`npm run test:ui`** runs 16 test files one after another (`--test-concurrency=1`), each in its own Node process.
- **Each file's `setup()`** (`tests/ui/harness.mjs`) starts:
  - a Node `http.createServer` on a random port of 127.0.0.1, with Node's defaults (keep-alive on, `keepAliveTimeout` 5 s);
  - one Chromium (`chromium.launch()`).
- **Each test** opens a fresh browser context (`browser.newContext()`), and most close it in `done()`.
  - **A new context starts with no connections.** Each one fetches the entrance or the game: about 3 requests for a visitor's first paint, and many more once the game loads its modules (`main.js` and the `js/engine` and `js/data` files).
  - **About 312 tests** in all, so thousands of short local connections per run.
- **The fake Supabase backend and Realtime** are Playwright routes (`context.route`, `routeWebSocket`), with no sockets of their own.
- **Not measured yet:** how many TCP connections a run opens, how many are open at once, and how many are left in `TIME_WAIT`.

## 3. Hypotheses

1. **Ephemeral ports in `TIME_WAIT`.** Many short connections, each closed, leave their local ports in `TIME_WAIT` (240 s by default on Windows) until the dynamic range is exhausted. **Against:** failures start as early as test 95, and each test file runs in a new process (though `TIME_WAIT` outlives the process). Whether this runner reports exhaustion as `WSAENOBUFS` isn't known; M2 would show the port counts.
2. **Sockets not closed.** Contexts or pages left open by a test that fails or returns early, or keep-alive connections the server holds, accumulate open sockets within a file's process. (Each file is a new process, so this would reset per file.)
3. **Server keep-alive and Chromium's pool, together.** Node keeps idle connections for 5 s; Chromium opens up to 6 per host per context. With a new context per test, closed contexts may leave the server holding idle sockets until they time out.
4. **Kernel non-paged pool or buffer pressure** on the small hosted runner, independent of our counts: the runner image, antivirus, or other services.
5. **Something specific to the runner image** (a Windows or Defender update), which would make the rate change over time with no change of ours.

They aren't exclusive.

## 4. Measurements, in order

Each step is read-only or observation-only. Nothing changes a test's outcome.

| Step | What | Needs |
| --- | --- | --- |
| M0 | **Collect what exists:** for every past occurrence, the run's `browser-metrics-attempt-*` artifact (per-test duration, CPU, memory, event-loop delay). Place each failure in its run: test number, file, time since the file's start. | Downloading those artifacts: owner's approval |
| M1 | **Count connections in the harness:** the server's `connection` and socket `close` events, per test and per file (opened, closed, still open, the most open at once), written into the existing per-test metrics. | A harness change (instrumentation only): owner's approval |
| M2 | **Observe the runner's TCP table:** a background step in the browser job that samples `Get-NetTCPConnection` by state (`Established`, `TimeWait`, `CloseWait`) for 127.0.0.1 every few seconds, and records `netsh int ipv4 show dynamicport tcp`, into an artifact. | A workflow change: owner's approval. Adds a little runner time |
| M3 | **Check context cleanup:** find any test path that doesn't close its context (a failing assertion before `done()`, or an early return) by counting contexts opened and closed per file (M1's counters). | Part of M1 |
| M4 | **Correlate:** with M1 and M2 in the artifacts, wait for the next occurrence. Compare its counts with a passing run at the same test. | Time; no further change |
| M5 | **Reproduce locally,** if M4 points to a count: a Windows laptop run with the same counts, or a stress script that opens the same pattern of connections against the harness's server. | A scratch script only; no repository change |

**Cost:** M2 adds a few seconds of sampling per run. M0 and M4 are reading. CI minutes are as now, except for any extra runs the owner approves.

## 5. Possible fixes, only after the evidence

None is proposed for implementation yet. Each depends on what M1 to M4 show:
- **If ports in `TIME_WAIT` (H1):**
  - let Chromium reuse connections: keep a context per file where a test doesn't need isolation (a test-design change, reviewed per file);
  - or have the server keep connections alive longer, so fewer new ones are opened.
- **If unclosed sockets (H2, H3):**
  - close contexts in a `finally`, not only in `done()`;
  - give the server a shorter `keepAliveTimeout`, or close idle sockets when a test's context closes.
- **If runner pressure (H4, H5):**
  - split the browser job across two runners (sharding: more CI minutes);
  - or record the fault as external, with the evidence.
- **Not an option:** automatic retries of failed tests. They would hide real races of the kind found in section 1.

## 6. What would count as resolved

- **The evidence** (M1, M2) explains the occurrences.
- **A change made** for it is reviewed like any other.
- **After that change,** a fixed number of consecutive full CI runs show no `ERR_NO_BUFFER_SPACE`. The owner sets the number, for example 10.
- **Today's rate isn't measured:** there have been seven occurrences since 2026-11-18. M0 would count the browser runs in the Actions history to give it.

## 7. M0 results (2026-11-20, authorized by the owner)

**What was read** (read-only):
- **The runs:** every run of the CI workflow in the Actions history, 105 runs from 2026-11-14 to 2026-11-20, and each attempt's `browser` job: 131 executions, 128 completed.
- **For each failed execution:**
  - the job log;
  - the runner label;
  - the run's failure artifact (`browser-output`): each failed test's `diag.json`, with its failed requests, page errors, and CPU and memory at the failure.
- **For each completed execution:** its metrics artifact (`browser-metrics-attempt-<n>`), with the runner image and version, and per-test duration, CPU, memory and contexts.

**Left out:** the `claude/ci-a` branch, where the job itself was being built (it ran first on Ubuntu, then on Windows while the job's setup changed). None of its failures was this fault.

**The record:** each execution's classification, with the totals and denominators, is kept in `docs/ui-audit/ci-m0/` (`executions.csv` and its README), so this section can be checked after the artifacts expire. Every artifact was still within its 7-day retention when read, so none was missing.

### 7.1 The fault is more frequent than section 1 records

Section 1 lists seven occurrences, gathered from the PRs. **From the artifacts, the fault hit 12 executions (13 failed tests), not 7.** Only 3 of the 12 show the error in the job's log: a request that fails inside the page reaches the log only as a later timeout or assertion. So the log alone undercounts it.

| Run | Date (UTC) | Branch | Test (position) | Failed request |
| --- | --- | --- | --- | --- |
| `44182526925` | 11-17 21:42 | password-recovery scope | D-1 larger text and zoom (78); LAC-15 / LAC-21 news failing (162) | `/`; `/js/data/masteries.js` |
| `44230917149` | 11-18 03:30 | Monstra Regna scope | PR-4a after the password is saved (178) | `/js/entry.js` |
| `44238281270` | 11-18 04:34 | Monstra Regna scope | responsive: no horizontal overflow (138) | `/js/data/masteries.js` |
| `44331958873` | 11-18 15:07 | `main` | PR-4a with storage refusing the marker (180) | `/js/data/variants.js` |
| `44332218391` | 11-18 15:08 | MR-B1 record | D2-03 a confirmation… (62) | `/js/data/variants.js` |
| `44410857655` | 11-18 22:21 | GP-1 | R1-02 an expired link… (217) | `/js/data/items.js` |
| `44432245764` | 11-19 00:50 | `main` | GP-B4 (154) | `/` |
| `44538744904` | 11-19 13:58 | sign-out | P4-04 (28) | `/js/data/stats.js` |
| `44546513378` | 11-19 14:41 | sign-out | realtime: focus survives… (144) | `/js/data/variants.js` |
| `44643826518`, attempt 1 | 11-20 00:11 | SO-9 | LAC-5b a malformed saved session (95) | `/` |
| `44657719343` | 11-20 02:00 | `main` | R1-02 after an invalid link… (250) | `/js/data/stats.js` |
| `44668968108` | 11-20 03:37 | `netlify.toml` cleanup | AC-3 phone landscape (261) | `/js/entry.js` |

**New since section 1:** `44182526925`, `44230917149`, `44331958873`, `44332218391` and `44657719343`. The last is the `push` run on `main` after PR #59's merge; its failure wasn't looked at at the time.

**Corrections to earlier records:**
- **Two PR-4a failures were this fault, not PR-4a's setup race.** These are `44230917149` ("after the password is saved") and `44331958873` ("with storage refusing the marker"). Both are PR-4a tests, but different from the second-tab test whose race PR #58 fixed.
- **`44332218391` had both:** this fault in D2-03, and the PR-4a second-tab race.
- **Section 1's #3 and #5** were missing their requests: `/` and `/js/data/variants.js`.

### 7.2 How often

| Executions (completed, outside `claude/ci-a`) | With the fault | Other failures | Passed |
| --- | --- | --- | --- |
| All, 2026-11-15 to 11-20: 93 | **12 (12.9%)** | 9 | 72 |
| Since the first occurrence, 2026-11-17: 82 | **12 (14.6%)** | 8 | 62 |

**By day** (executions, with the fault):
- 11-15: 3, 0
- 11-16: 8, 0
- 11-17: 3, 1
- 11-18: 35, 5
- 11-19: 27, 3
- 11-20 (so far): 17, 3

**About one browser execution in seven** has hit it since 2026-11-17.

**The other failures since 2026-11-17:**
- **Test or fixture races, since corrected:** PR-4a's second tab (3 executions), SO-9, B2-6 and GP-B7.
- **GP-1's own development runs:** AC-1 and GP-A1.

### 7.3 What it correlates with, and doesn't

- **The failed requests:** all 13 were to the harness's own server on 127.0.0.1:
  - the page `/` (3);
  - `/js/entry.js` (2);
  - modules in `/js/data/` (8): `variants.js` 3, `masteries.js` 2, `stats.js` 2, `items.js` 1.

  None was to the fake Supabase host, which is answered by Playwright's routing. Each was a page or module load.
- **Test files:** 9 different ones (entrance, desktop, news-public, password-recovery ×4, game ×2, desktop-chat, gameplay-polish, admin-console, responsive). So the fault doesn't belong to one file.
- **Position in the run:** tests 28 to 261, spread across the run. It isn't confined to late in the run, nor to the start of a file.
- **CPU:** the machine's CPU at the failure ranged from 5.9% to 86% (7, 6.4, 77.9, 8.5, 12.6, 80.1, 5.9, 9.2, 10.1, 15.1, 37.2, 86, 76.2). **No correlation with CPU load.**
- **Memory:** free memory was 5,252 to 5,758 MB of 8,187 every time. **No memory pressure seen.**
- **Runner image:**
  - **`win25-vs2026 20261103.298.1`:** the fault in 11 of 82 executions;
  - **`win25-vs2026 20261116.315.1`:** in 1 of 11, used from 2026-11-18 alongside the older one.

  The fault occurs on both, so H5 (the image) is weakened, though not ruled out: the newer image has few executions.
- **Contexts per test:** 1.33 to 1.50 across runs, measured since CI-A-02. That's steady, so no change in the suite's pattern explains when it began. The first occurrence (2026-11-17) is also when the number of runs per day rose (from 3 to 8 a day to 27 to 35). Whether the fault was absent before or just unseen in few runs can't be told.

### 7.4 Evidence not available

- **Connection counts:** M1 and M3 now collect them, per test and per file. There are none for past runs.
- **The runner's TCP table (M2):** not collected, and deferred by the owner.
- **Diagnostics coverage:** every failed execution outside `claude/ci-a` had a failure artifact with `diag.json`, so every one could be classified.
- **The cancelled attempt** of `44410857655`: no result.

### 7.5 What this changes in the plan

- **The rate is measured:** about 1 in 7 executions since 2026-11-17. With the fault this frequent, the next occurrence with M1 and M3's counters should come within a handful of runs (M4).
- **H4 (CPU or memory pressure) is weakened:** most failures came at low CPU, with ample free memory. Kernel buffer pressure isn't measured by these figures, though.
- **Still open:** H1 (ports in `TIME_WAIT`), H2 and H3 (sockets held by keep-alive), which M1 and M3 will show. The first local measurements already show sockets staying open for a few seconds after a test's context closes. In `entrance.test`, 168 connections were opened for 37 contexts, with 4 still open when the tests ended and none at exit.
