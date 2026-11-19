# Sign-out and session recovery: report

**Status: paused at a second review gate (2026-11-19), after the expired-token measurement (section 8).**
- **The first gate** (section 4) was decided by the review of `4ac3740`: the amended classification of section 5 is approved.
- **The second gate:** the expired token, measured as the review ordered, comes back exactly as a malformed one does. Under the approved client design, that would sign out a player whose session can still be renewed. No `sessionFailure()` or client code is written yet.
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
| `getUser` with an expired token | `AuthApiError`, 403, `bad_jwt`, the same as a malformed token. Measured in a second run (section 8); renewal with its refresh token still worked |

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

**The expired token:** the review chose to measure it (option 1). It is section 8.

**Approved** by the review of `4ac3740`, restricted to the `getUser` check on the server.

**Nothing else in the scope changes.** R1 to R7, the invariant, 5.1's fallback (which this evidence makes more necessary), the startup budget plan, and SO-1 to SO-13 stand. SO-6b's Node test will use the recorded answers in `tests/session-answers.mjs` as fixtures.

## 6. SO-1

**Passed on the local stack:**
- **Two sessions of one account:** signing out one with `scope=local` leaves the other's `getUser` and renewal working, and the signed-out session has ended.
- **A late `logout?scope=local`** with an older session's token, sent after a newer session of the same account exists, leaves the newer one working. That is the server side of SO-13 (scope 5.1, point 5).

## 7. Next, once the second gate is decided

1. **Write `sessionFailure()`** and its Node test from the recorded answers.
2. **Then the client,** with the renewal step if approved (section 8), the `game` function, the harness, and the rest of SO-2 to SO-13.
3. **Then the report's remaining sections:** evidence, runs and CI, deviations, and what wasn't verified.

## 8. The expired token (measured 2026-11-19, as the review of `4ac3740` ordered)

**How it was measured, on the local stack only:**
1. `supabase/config.toml`'s `[auth] jwt_expiry` was set from 3600 to 30, and the stack restarted.
2. A test account signed in, and its genuinely issued access token was left to expire, plus 5 s.
3. `getUser` with the expired token was recorded, without renewing. Then the session's refresh token was renewed separately.
4. The setting was restored. `git diff` shows `supabase/config.toml` unchanged, and after a restart a newly issued token lasts 3600 s.
5. Hosted settings were not touched.

The opt-in test is in `tests/db/session-answers.test.mjs` (run with `SO1B_EXPIRED=1` and a short `jwt_expiry`; skipped otherwise, including in CI). Its answer is in `tests/session-answers.mjs`.

**The answers:**
- `getUser` with the expired token: **`AuthApiError`, 403, `bad_jwt`.**
- Renewal with the same session's refresh token: **it worked.**

**Why this is a second gate.** GoTrue answers an expired token and a malformed one identically, and the approved rule classes `bad_jwt` as "ended" (401). That is right for the server: the token can't be used. But the approved client design then reacts to every 401 by ending the session (scope 5.2: "401 from the `game` function means the session is over"), and an expired token's session can still be renewed.
- **When would the `game` function see an expired token?** supabase-js renews before sending when the token has expired by the device's clock. So an expired token reaches the server when:
  - the device's clock is behind the server's by more than the library's renewal margin;
  - or the token expires in transit.
- **The result would be a new defect:** such a player would be signed out, regularly, by a session that still works. Today they get an error message instead.

**The proposed refinement, for review: one renewal before ending.** The server rule stays as approved. The client, on a 401 from the `game` function:
1. **Renews once** (`sb.auth.refreshSession()`).
2. **If the renewal succeeds:** repeats the request once with the new token. A second 401 then ends the session.
3. **If the renewal is refused** (for a session ended elsewhere, measured: `refresh_token_not_found`): the library itself removes the session and emits `SIGNED_OUT`, and the client's `endSession()` makes sure of it (scope 5.1's fallback). Then the form, as R2 requires.
4. **If the renewal can't reach the service** (`AuthRetryableFetchError`): "unavailable", the gate with Try again, and the session kept, as R4 requires.

**What it changes:**
- **The scope:** only the client's reaction to a 401 (5.2), at start-up and during play. The server, R1 to R7, the invariant and SO-1 to SO-13 are unchanged.
- **One criterion gains a case:** SO-2 and SO-3, where a 401 for an expired but renewable token renews and carries on (start-up and play), and an ended session still reaches the form.

**The alternative,** a separate server answer for an expired token (decoding the token's `exp` when GoTrue says `bad_jwt`), is not proposed. It puts token parsing in the function, and the client would still need the renewal step.

