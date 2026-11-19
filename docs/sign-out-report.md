# Sign-out and session recovery: report

**Status: implementation paused at the SO-1b review gate (2026-11-19).** SO-1b's measurements contradict one statement of the approved scope (section 4). As the scope requires, the work stops for review before `sessionFailure()` or any client code is written.
- **Contract:** `docs/sign-out-scope.md`, approved at `0074459` and merged as PR #53 (`bfad9b3`).
- **Authorization:** the owner authorized the implementation on 2026-11-19 ("Sign-out fix implementation authorized").
- **Branch:** `claude/sign-out`, based on `main` at `bfad9b3`.
- **Done so far:**
  - SO-1b and SO-1 (`tests/db/session-answers.test.mjs`, with the recorded answers in `tests/session-answers.mjs`);
  - this report.

  Nothing else is implemented, and nothing is deployed.

## 1. What was run

- **Where:** the local Supabase stack (CLI 2.122.0), in Docker on the owner's laptop. Nothing touched the live project.
- **How:** through the vendored supabase-js 2.45.4 (gotrue-js 2.65.0), the version the browser and both edge functions use. It was loaded in Node as a classic script, as a browser loads it, with three small shims (`self`, `importScripts`, `location`) that only let the browser build start.
- **Recorded:** for each case, the error's type, status and GoTrue error code as supabase-js reports them. No token value was printed or stored.
- **The test accounts** are created by the test and removed after it.

## 2. SO-1b: GoTrue's answers

| Case | What supabase-js reports |
|---|---|
| `getUser` with the token of a session ended elsewhere (another device signed out everywhere) | `AuthSessionMissingError`, status 400, no code |
| `logout` (`scope=local`) with that token | `AuthSessionMissingError`, status 400, no code |
| Renewal with that session's refresh token | `AuthApiError`, 400, `refresh_token_not_found` |
| `getUser` with a malformed token | `AuthApiError`, 403, `bad_jwt` |
| `getUser` with a deleted user's token | `AuthApiError`, 403, `user_not_found` |
| `getUser` with no token | `AuthSessionMissingError`, 400, no code |
| `getUser` with an expired token | **Not measured.** The local stack signs its tokens with a key pair, not the HS256 secret the test could use to make an expired copy |

**Why an ended session isn't an `AuthApiError`:** GoTrue answers it with 403 `session_not_found`. supabase-js 2.45.4 recognises that code and throws its own `AuthSessionMissingError` instead, which has no status of GoTrue's and no code. That is the library's code, read in the vendored build:
- `if ("session_not_found" === code) throw new AuthSessionMissingError()`;
- `AuthSessionMissingError` is constructed with status 400 and no code;
- `isAuthApiError` checks the name `AuthApiError`.

**The test now keeps these answers:** it fails if they change, for example after a GoTrue or supabase-js upgrade.

## 3. What the answers establish

1. **The cause of the owner's "Sign out did nothing" is confirmed** (scope, section 3, point 3: the refused sign-out).
   - The library's `signOut()` treats only an `AuthApiError` with status 401, 403 or 404 as "already gone".
   - For a session ended elsewhere, the server's answer reaches it as an `AuthSessionMissingError`, which isn't one. So the library returns an error and **keeps the saved session.**
   - `net.signOut()` ignores that error, so nothing happened.
   - The scope's fallback (5.1) handles this case unchanged: an error leads to clearing the saved session directly.
2. **Ended and outage can be told apart reliably.** `AuthSessionMissingError` comes from GoTrue's `session_not_found`, or from having no session at all; a network failure is an `AuthRetryableFetchError`. So the distinction the scope relies on holds, on different evidence than the scope assumed.

## 4. What contradicts the approved scope

**Scope 5.2 says:** "401 ... only when ... `getUser` fails with an `AuthApiError` ... whose GoTrue error code is in the definitive list."

**The most important case, a session ended elsewhere (the owner's case), is not an `AuthApiError`.** Applied as written, the rule would call it "unavailable": the `game` function would answer 503, and the entrance would offer Try again for a session that can't work. R2 would fail for exactly the defect the scope fixes.

The scope expected the list to be set by evidence, but it fixed the error *type* as `AuthApiError`, and the evidence contradicts that. Hence this gate.

## 5. The proposed amendment to 5.2, for review

**"Ended" (401 "Please sign in again."):**
- **no token at all;**
- **`AuthSessionMissingError`:** supabase-js's own name for GoTrue's `session_not_found`, measured here for a session ended elsewhere, and for no session;
- **an `AuthApiError` with a definitive code:**
  - `bad_jwt` (measured: a malformed token);
  - `user_not_found` (measured: a deleted user);
  - `session_not_found`, if a later supabase-js passes it through unconverted.

**"Unavailable" (503), unchanged:** `AuthRetryableFetchError` (network failures, timeouts, 502 to 504), any other 5xx, a response that isn't GoTrue's, and any other type or code.

**Why this is still the conservative rule:**
- every "ended" entry is either measured, or is GoTrue's own statement that the session or user doesn't exist;
- everything unknown stays "unavailable", which keeps the saved session, and Sign out always works.

**The expired token, two options:**
1. **Measure it** before the rule is written, by lowering the local stack's `jwt_expiry` for one run (local only, restored after), and add the answer to the fixtures.
2. **Leave it unmeasured.** In the client, the library renews an expired token before using it, so an expired token rarely reaches the `game` function. An expired token's actual answer then falls to "unavailable" unless it is one of the listed answers. The report would say so.

Option 1 is proposed: it costs one local run.

**Nothing else in the scope changes.** R1 to R7, the invariant, 5.1's fallback (which this evidence makes more necessary), the startup budget plan, and SO-1 to SO-13 stand. SO-6b's Node test will use the recorded answers in `tests/session-answers.mjs` as fixtures.

## 6. SO-1

**Passed on the local stack:**
- **Two sessions of one account:** signing out one with `scope=local` leaves the other's `getUser` and renewal working, and the signed-out session has ended.
- **A late `logout?scope=local`** with an older session's token, sent after a newer session of the same account exists, leaves the newer one working. That is the server side of SO-13 (scope 5.1, point 5).

## 7. Next, when the amendment is decided

1. **Measure the expired token,** if option 1 is chosen.
2. **Write `sessionFailure()`** and its Node test from the recorded answers.
3. **Then the client, the `game` function, the harness and the rest of SO-2 to SO-13,** as the scope describes.
4. **Then the report's remaining sections:** evidence, runs and CI, deviations, and what wasn't verified.
