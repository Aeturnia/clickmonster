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

## Evidence safety check (2026-11-21, before merging)

Every file here was scanned, including the six entries inside `44929807369-failed/failure/trace.zip`. The check was for credentials (Supabase access, secret and service keys; GitHub tokens; private keys), JWTs, `Authorization` headers, cookies, refresh tokens, email addresses, local user paths and personal identifiers. What was found:
- **No credentials, tokens, cookies, local paths or personal identifiers.**
- **No JWTs at all,** not even the harness's fake ones: the failing page's first request failed, before any sign-in.
- **The only email addresses** are the harness's `@example.test` test accounts.
- **The trace:** its network log holds one request (`GET /`, failed), with only Chromium's standard request headers, and no `Authorization` or `Cookie`. Its three source files are the suite's own test code, already in this repository.
- **`dom.html` and `screenshot.png`** are blank: the page never loaded.

The evidence files and `compare.mjs` are unchanged from when they were added.
