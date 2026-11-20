# M0: the CI browser executions, classified (2026-11-20)

The durable record of M0 (`docs/ci-windows-reliability-plan.md`, section 7), so its conclusions can still be checked after GitHub's artifacts expire (7 days) and its logs (90 days).

**`executions.csv`:** one line per `browser` job execution (a run and an attempt) of the CI workflow, 2026-11-14 to 2026-11-20. That's 131 lines.

| Column | What it is |
| --- | --- |
| `run`, `attempt` | the Actions run id and attempt number |
| `created_utc` | when the run was created |
| `branch`, `event` | the run's head branch and trigger |
| `conclusion` | the browser job's result for that attempt |
| `runner_image` | from the attempt's metrics artifact (`ImageOS` and `ImageVersion`); empty where there was none |
| `classification` | see below |
| `failed_tests` | from the job log: each `not ok` line's number and the start of its name |
| `no_buffer_space_requests` | from the failure artifact's `diag.json`: each request that failed with `ERR_NO_BUFFER_SPACE` (local server paths) |

**How each failed execution was classified:**
- **`ERR_NO_BUFFER_SPACE`:** a failed test's `diag.json` (or the log) shows a request that failed with it.
- **Otherwise:** by the failing test, against the causes found and recorded in `docs/backlog.md`:
  - the PR-4a second-tab race (PR #58);
  - the SO-9 race (PR #59);
  - the B2-6 paint entry (PR #62);
  - GP-B7's timing assumption (not corrected).
- **GP-1's development runs:** the two failures there (AC-1, GP-A1) aren't classified further.
- **One `other`:** `43776194000` (2026-11-15, `LAC-5b`, with `ERR_INTERNET_DISCONNECTED`), not this fault.
- **Excluded:** the `claude/ci-a` branch, where the job itself was being built.

**The totals:**

| Classification | Executions |
| --- | --- |
| passed | 72 |
| `ERR_NO_BUFFER_SPACE` | 12 |
| test race: PR-4a second tab | 3 |
| GP-1 development run | 2 |
| test race: SO-9 | 1 |
| test race: B2-6 | 1 |
| test timing assumption: GP-B7 | 1 |
| other | 1 |
| cancelled or not completed when read | 9 |
| excluded: the CI-A setup branch | 29 |
| **all** | **131** |

**The denominators used in section 7:**
- **93 executions:** completed and not cancelled, outside `claude/ci-a`, from 2026-11-15. 12 had the fault, 9 had other failures and 72 passed.
- **82 executions:** the same, from 2026-11-17, the first occurrence. 12 had the fault.

These are the observed rates for that period, not a probability for future runs.

**Not kept:** the artifacts and logs themselves. They were read in place and the figures taken from them. The scripts that read them were scratch, outside the repository.
