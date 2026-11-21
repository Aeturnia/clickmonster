# M4: evidence for `ERR_NO_BUFFER_SPACE` failures with the measurements running

Kept so `docs/ci-windows-reliability-plan.md`, section 8.4, can be checked after GitHub's artifacts expire (7 days).

**The failing run:**
- **`44929807369-failed/`:** PR #70's CI run, 2026-11-21. It's the first `ERR_NO_BUFFER_SPACE` with M2 (the TCP sampler) running. It holds:
  - `failure/`: the failed test's `diag.json`, `dom.html`, `screenshot.png` and `trace.zip`, from the run's `browser-output` artifact;
  - `tcp.jsonl`: M2's samples (`browser-tcp-attempt-1`);
  - `metrics/`: M1/M3's per-test metrics (`browser-metrics-attempt-1`);
  - `browser-log.txt`: the suite's output.

**The passing runs, for comparison** (each with `tcp.jsonl` and `metrics/`):
- **`44786839333-passed/`:** PR #69's combined run, attempt 1;
- **`44788881637-passed/`:** the `push` run on `main` after PR #69's merge;
- **`44755355412-passed/`:** PR #69's run, attempt 2.

**`compare.mjs`:** run with `node docs/ui-audit/ci-m4/compare.mjs` from the repository root. It aligns each run at the start of the failing test (`entrance.test`, test 21), using the `endedAt` of the test before it. For each run it prints:
- the TCP samples from 60 s before to 10 s after that point;
- the harness connections opened in the run so far.

**What the files contain:** only fake test data, as the harness uses, and the Supabase project URL and publishable key the site already serves. No secrets, and no personal data.
