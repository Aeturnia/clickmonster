# Sign-out and session recovery: report

**Status: delivered and resolved.** The P1 lockout (signing out on one device left another behind an unusable sign-in screen) is fixed (section 22):
- **Merged** as PR #55 (`e1ffa43`, 2026-11-19, 15:52 UTC).
- **The `game` function** was redeployed from that commit as **version 14** (15:53 UTC).
- **The site** was published by Netlify on the merge.
- **Confirmed resolved by the owner** at the review of 2026-11-20.

The later CI work (section 22) was on tests, the fake backend and the CI runner, not on this fix.

*Before delivery, as recorded at the time:* implemented, with the corrections for F-1 (section 18), F-3 and F-4 (section 20), and F-5 (section 21); at the independent implementation review gate (2026-11-19). At that point nothing was deployed or merged.
- **The review gates on the way** (sections 4 to 8):
  - **First:** SO-1b showed that an ended session isn't an `AuthApiError`. The review of `4ac3740` approved the amended classification (section 5).
  - **Second:** an expired token is answered exactly as a malformed one. The review of `4853b02` approved one renewal before ending a session, with safeguards (section 9).
- **Contract:** `docs/sign-out-scope.md`, approved at `0074459` and merged as PR #53 (`bfad9b3`), with the two amendments above.
- **Authorization:** the owner authorized the implementation on 2026-11-19 ("Sign-out fix implementation authorized"). Merging and the `game` function redeploy each need their own.
- **Branch:** `claude/sign-out` (PR #55), based on `main` at `bfad9b3`.

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

## 7. The order of the work

1. SO-1b and SO-1 (sections 2 to 6), then the first review gate.
2. The expired-token measurement (section 8), then the second review gate.
3. Then the rule, the function, the client and the tests (sections 9 to 16).

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

**Decided** by the review of `4853b02`: approved, with safeguards (section 9).

## 9. The renewal amendment, and its safeguards

**The behaviour** (`net.js`, `api()`), on a 401 from the `game` function:

| Condition | Behaviour |
|---|---|
| The renewal succeeds | The request is sent once more |
| The second answer succeeds | Carry on |
| A second 401 | The session ends (`err.ended`), only if the sign-in is still the one that asked |
| The renewal is refused | The library removes the session and emits `SIGNED_OUT`; `err.ended` |
| The renewal can't reach the service | A 503, the session kept; the player can try again |
| A 503 or any other answer | Unchanged: nothing is retried |

**The review's safeguards, and how each is met:**
1. **Supported renewal, no storms** (superseded for F-1 by section 18: the renewal is now the client's own request, installed with `setSession()`): `sb.auth.refreshSession()`, through one shared promise. Concurrent refusals wait for the same renewal, and the library also serialises its own renewals under its lock. SO-3 sends three refused requests at once: one renewal, and all three succeed.
2. **One resend:** after a successful renewal, the request is sent exactly once more; a second 401 is final. There is no loop.
3. **Account and generation before resending:**
   - `api()` takes an `isCurrent()` check (`main.js` passes `live(g)`; `start()` passes its own);
   - it notes the signed-in user before the first request, and checks both after the renewal;
   - if either changed, nothing is resent and the caller gets `err.stale`, which `runRemote()` drops.

   SO-3 holds a renewal while the sign-in changes: the refused request isn't sent again.
4. **Refusal before any change:** the `game` function's sign-in check is the first thing it does after the method check (`index.ts`, before the body is read), so a 401 means nothing was done. SO-3 moves with an expired token: two calls, and exactly one step. Nothing else is retried: a timeout or a 5xx may have come after the server acted.
5. **A refused renewal:** the form, through the library's own `SIGNED_OUT` or `endSession()` (SO-2, SO-3).
6. **An unreachable service during renewal:** a 503, the session kept, the action can be pressed again.
7. **A second 401 ends the session only for the same sign-in:** otherwise it is `err.stale`.
8. **Tests:** the renewable cases are in SO-2 and SO-3, with concurrent refusals, a sign-in change during a renewal, and no duplicate move.

## 10. What changed

| Where | Change |
|---|---|
| `public/js/engine/session.js` (new) | `sessionFailure(token, error)`: "ended" for no token, `AuthSessionMissingError`, or an `AuthApiError` with `bad_jwt`, `user_not_found` or `session_not_found`; "unavailable" for anything else. Shared with the server |
| `supabase/functions/game/index.ts` | The sign-in check answers 401 for "ended" and 503 "Can't reach the sign-in service. Please try again." for "unavailable", before anything else |
| `public/js/net.js` | **Signing out:** `signOut()` and `endSession()` sign out this device only (`scope: 'local'`), with a 5 s limit. On an error, a time-out or a leftover session, the fallback removes the saved session only if it is still the one being ended, keeps the message in `sessionStorage` (`clickmonster.note`), and reloads. **Other tabs:** a `storage` listener returns them to the entrance when the saved session is removed. **`api()`:** the renewal of section 9. **`authMessage()`:** the sign-in error wording, moved from the entrance |
| `public/js/entry.js` | A session the server ended goes to the form, not the gate (`err.ended`); the message kept across a fallback reload is shown; `authError()` moved out; the reset-cancel hook uses the default local sign-out |
| `public/js/main.js` | `api()` gets the generation check; `endSession()` replaces the global sign-out after a 401; stale answers are dropped |
| `public/js/admin.js` | The console's Sign out goes through `net.js`, so it is local |
| `supabase/config.toml` | Local only: `[functions.game] verify_jwt = false`, matching how it is deployed (`tools/deploy-functions.mjs`), so the local function checks its own token (deviation 2) |

**Unchanged:**
- the `admin` function (Q2: deferred, tracked);
- the password recovery's sign-out of other devices (`others`);
- `entry.js` as the page's only auth listener;
- L-1's account isolation.

**The startup budget:** the first paint is **33,949 of 34,000 bytes** (33,989 before; 33,960 after section 20). `authError()` moved out and the session-note line came in; no comment was removed and nothing was minified.

## 11. Acceptance criteria (scope, section 6)

Every browser test was run against `main` at `bfad9b3` (`UI_PUBLIC_DIR`): **18 of the 23 fail there, and 5 pass as guards.**

| ID | Status | On `bfad9b3` |
|---|---|---|
| SO-1 | **Met.** The game's and the admin console's Sign out send `scope=local`. On the local stack, a local sign-out leaves the account's other session working, and a late one with an older token leaves a newer session working | **Browser fails** (a `global` sign-out). The database part is a guard |
| SO-1b | **Done:** the answers recorded (sections 2 and 8); the test fails if they change | Measurement |
| SO-2 | **Met.** An ended session at start-up: the form with "Your session has ended. Please sign in again.", the saved session gone, no Try again, one refused renewal. **And:** an expired but renewable token renews once, the request is sent again, and the game starts | **Both fail:** the gate |
| SO-3 | **Met.** An ended session during play: back to the form, the saved session gone, no `global` sign-out. **And:** a renewable token during play renews once and moves one step; three concurrent refusals share one renewal; a sign-in change during a renewal stops the resend | **All four fail** |
| SO-4 | **Met.** An expired session with a refused renewal: the form; signing in again works | **Guard** |
| SO-5 | **Met** for a 500, a dropped connection and a sign-out that never answers (the form within the 5 s limit plus a margin), and for the gate's Sign out. A second Sign out is harmless | **All fail:** nothing is cleared, or nothing happens |
| SO-6 | **Met** for a 503 and a dropped connection at start-up: the gate with Try again, the session kept, no renewal; Try again starts the game | **Guard** |
| SO-6b | **Met.** The rule's Node test covers every recorded answer and nine kinds of failure that must stay "unavailable". The real function on the local stack answers 401 "Please sign in again." for an ended session's token and for a malformed one | The rule is new. The database part ran on the fixed function only |
| SO-7 | **Met.** After recovering, the `fresh` account signs in: hero creation, no hero carried over, no hero bar of the first | **Fails:** no recovery |
| SO-8 | **Met.** Two tabs: signing out in one returns the other to the entrance, also when the server refused it | **The refused case fails;** the normal case is a guard |
| SO-9 | **Met** at 390 x 844, 844 x 390 and 1440 x 900: the form on screen, the email field focusable, 0 axe violations | **All fail:** the gate |
| SO-10 | **Met:** 33,949 bytes, and 33,960 after section 20 | Guard |
| SO-11 | **Met:** the password recovery tests pass unchanged | Guard |
| SO-12 | **Reviewed:** the new code logs nothing and keeps no token. The message kept across a reload is the message's text only, and the comparison before removing is made in memory | Review |
| SO-13 | **Met.** This tab: a hung sign-out falls back, the player signs in again, the late answer clears nothing, and the game works. Compare before removing: a session saved meanwhile is left alone. Two tabs: A's sign-out hangs while B signs in as another account; B's session survives A's late answer | **This tab and two tabs fail.** Compare-before-removing passes as a guard: the old code never removes anything |

## 12. Evidence

`tools/sign-out-evidence.mjs`, run on `bfad9b3` and on this branch the same way (fake backend). The screenshots and `summary.json` are in `docs/ui-audit/sign-out/before/` and `after/`.

| Measure, at 390 and 1440 | Before | After |
|---|---|---|
| An ended session at start-up | The gate: Try again and Sign out, no form, the session still saved | The form, "Your session has ended. Please sign in again.", nothing saved |
| Then Sign out, if offered | **Nothing changes:** the gate stays, the session still saved (the owner's lockout) | Not needed: the form is already there |
| The game's Sign out when the server answers 500 (390) | Still in the game, the session saved; a `global` sign-out was sent | The form, "You have signed out.", nothing saved; a `local` sign-out was sent |
| Axe, after | 0 violations | 0 violations |

**A correction to the harness, found by the evidence.** The fake backend first answered an ended session's token without GoTrue's API version header. supabase-js then read a plain 403, and on the old code the gate's Sign out appeared to work, unlike on the owner's desktop. With the header, as GoTrue sends it, the fake gives exactly the measured `AuthSessionMissingError`, and the before evidence shows the lockout.

## 13. Deviations

1. **The amendments of sections 5 and 8,** decided at their review gates.
2. **`supabase/config.toml`:** `[functions.game] verify_jwt = false`, local only. The local edge runtime otherwise refused a malformed token before the function ran, unlike production, where the deploy script turns that check off. Without it, SO-6b's database part couldn't reach the function.
3. **The harness's ended-session answers carry GoTrue's API version header** (section 12).
4. **SO-13, two tabs:** after A's fallback reload, A shows either the form or B's new account. B's sign-in can finish before or after A's page starts again, and both are correct; the test accepts either, and requires that A has left the player's game.
5. **SO-13's compare-before-removing case is a guard on `bfad9b3`,** not a detector: the old code never removed anything.
6. **`api()` reads the signed-in user before each call** (`getSession()`, from storage, under the library's lock), to compare it after a renewal. `functions.invoke` already does the same read.
7. **The scope expected LAC-21 and the L-1 sign-out tests to change.** They pass unchanged.
8. **Two new technical names, `clickmonster.note`** (a `sessionStorage` key) **and `clickmonster.renew`** (the renewal lock, section 18), follow the existing `clickmonster.*` keys (MR-B1's D2), and are added deliberately to the identity test's list of allowed technical identifiers (`tests/identity.test.mjs`). The MR-B1 report's list is a record of its time; the test is the current list.
9. **The opt-in expired-token test** needs a short local `jwt_expiry` and is skipped otherwise, including in CI. Its recorded answer is checked by the rule's Node test, which runs everywhere.

## 14. Runs and CI

**Local, on the owner's Windows laptop, with the local stack stopped:**

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 65 of 65 | 271 of 271 |
| 2 | 65 of 65 | 271 of 271 |
| 3 | 65 of 65 | 271 of 271 |

- **Browser** runs on `0713613`. Every later commit leaves `public/` and `tests/ui/` unchanged.
- **Engine** runs after the identity test's list gained `clickmonster.note` (deviation 8). The first three engine runs failed only that test, which caught the new key: 64 of 65.
- **The counts:** engine 65 (63 before; the two `sessionFailure()` tests); browser 271 (248 before; the 23 tests of `tests/ui/sign-out.test.mjs`).
- **The database suite,** run once locally with the stack up: pgTAP 42 of 42, and 16 of 16 API, recovery and session tests, plus the opt-in expired-token test, skipped. It is 13 before, plus SO-1b, SO-1 and SO-6b's function test.

**CI:** recorded on PR #55 once the run on the pushed head completes.

## 15. Not verified

- **The hosted sign-in service's answers.** The answers were measured on the local stack (CLI 2.122.0). An unknown answer falls to "unavailable", the safe side.
- **Edge,** the owner's browser, and **real devices.** The suites run in Chromium.
- **A lock held by another tab's stuck request** (for example a hung renewal). It delays that tab's own library calls; its Sign out has the same fallback. This case is not tested.
- **Screen readers.**
- **The production behaviour,** until the `game` function is redeployed (section 16).
- **R4 is not guaranteed everywhere** (section 18). A temporary failure of the client's own renewal after a 401 keeps the session. But the library's own background renewal, and any renewal it starts itself before sending a request, still discard the session on a 500 or 429. That is tracked separately (`docs/backlog.md`).

## 16. Deployment, when authorized (scope, section 8)

1. **Before the merge is scheduled:** the owner's authorization for the `game` function redeploy.
2. **Merge.** Netlify publishes the client.
3. **Straight after:** `npm run deploy:functions -- game`.
4. **The owner's live check:**
   - signed in on the phone and the desktop, sign out on the phone: the desktop keeps playing;
   - Sign out on the desktop: the form, at once.

**The order is safe either way:**
- an old page treats the function's new 503 as a failure with Try again;
- the new page handles the old function's 401s with one renewal, then the form.

**Rollback:** revert the merge, then redeploy `game` from the reverted `main`. No data is involved.

## 17. The review of `543cbde`, and a finding at the gate

**The review:** changes requested.
- **F-1 (blocking):** `renew()` classed every renewal error other than a network failure as "ended". A temporary 500, a 429 or an unknown code would sign the player out, against R4. The fix asked for: "ended" only for a measured, definitive refusal, and everything else "unavailable", with the session kept and tested.
- **F-2 (non-blocking):** the stuck-lock case in another tab, to be recorded as a separate investigation.

**What checking F-1 found:** the classification in `renew()` is wrong, but correcting it alone can't keep the session.
1. **supabase-js 2.45.4 treats only 502, 503, 504 and "no response" as temporary.** Its error handler throws `AuthRetryableFetchError` for those statuses only. A 500 or a 429 becomes an `AuthApiError`.
2. **On any renewal error that isn't `AuthRetryableFetchError`,** the library's `_callRefreshToken()` itself removes the saved session and emits `SIGNED_OUT`, before `refreshSession()` returns to `renew()`.
3. **Measured in the browser** (fake backend, a refresh answered 500, then 429): in both cases the saved session was gone and the sign-in form was shown, whatever `renew()` decided.
4. **The same applies to the library's own background renewal** (`autoRefreshToken`, about an hour after each sign-in), outside this fix's 401 path. A temporary 500 or 429 there signs a player out on the live site today.

**Why this stops at a gate:** keeping the session through a temporary renewal failure can't be done with `refreshSession()`, the approved, supported mechanism (review safeguard 1). The options:
- **A. Our own renewal request on the 401 path.** `net.js` sends the refresh request itself (`/auth/v1/token?grant_type=refresh_token`, with the publishable key) and classifies the answer:
  - "ended" only for the measured `refresh_token_not_found`;
  - everything else "unavailable", with nothing removed;
  - on success, the library saves the new session through its public `setSession()`.

  One shared request, so no storm. **Proposed.** The library's background renewal keeps its behaviour and becomes a separate follow-up.
- **B. A, and also turning off the library's background renewal** (`autoRefreshToken: false`), with `net.js` renewing ahead of expiry the same way. That covers the background case as well, but it is a larger change to how every session is kept.
- **C. Keep `refreshSession()`, fix only the classification,** and document that the library still discards the session on a 500 or 429. That doesn't meet F-1 or R4.

**Nothing has changed since `543cbde`.** F-1 waits for this decision; F-2 will be recorded as asked.

## 18. The correction for F-1 (option A, approved at the review of `2178097`)

**The decision:** option A, conditionally.
- **What changes:** the renewal after a `game` 401 is the client's own request, and the library's `refreshSession()` is no longer used for it.
- **What doesn't:** background renewal is left to a separate investigation.
- **Conditions:**
  1. prove the hand-over to `setSession()` first;
  2. end a session only on measured evidence;
  3. keep one renewal and one resend;
  4. serialise across tabs, and alongside the library's own renewal;
  5. a late answer never restores a changed session, including a new session of the same account;
  6. a 429, 500 or unknown answer never erases the session;
  7. no immediate retry after a 429;
  8. document the remaining limitation, and track F-2 and background renewal.

**Before:** `renew()` called `sb.auth.refreshSession()`, and classed any error but `AuthRetryableFetchError` as "ended". On a 500 or 429, the library had already removed the saved session and emitted `SIGNED_OUT` (section 17).

**After** (`net.js`, `renew()`):
- **The request:** `POST /auth/v1/token?grant_type=refresh_token`, with the publishable key and GoTrue's API version header, using the refresh token of the session the refused request was made with.
- **Its answers:**

| Answer | Result |
|---|---|
| 200 with a session | If this browser still holds the session it renewed, it is handed to the library with `setSession()`, and the request is sent once more |
| 400 `refresh_token_not_found` (measured: an ended session's refresh token) | "Ended": the caller ends the session, and the form shows |
| 429 | "Unavailable", the session kept; no renewal before `Retry-After`, or 30 s |
| Anything else: 500, another code (a malformed token gets `validation_failed`, measured), a dropped connection, a `setSession()` error | "Unavailable", the session kept; the player can try again |

- **One at a time:** a shared promise in the tab, and a lock (`navigator.locks`, `clickmonster.renew`) across the browser's tabs. Whoever goes second re-reads the saved session, finds it already renewed (a new refresh token, the same `session_id`), and sends nothing.
- **Late answers:**
  - The saved session is re-read before the request and again before installing.
  - If it has changed to a different session (a sign-out, another account, or a new sign-in of the same account, told apart by `session_id`), nothing is installed, nothing is resent, and the caller gets `err.stale`.
  - A second 401 ends the session only if the saved session is still the same one.
- **The library's own renewal at the same moment:** GoTrue lets the same refresh token be used twice within its reuse interval, for the same session (measured). Both results are valid, so whichever is saved last works.

**The proofs:**
- **Browser** (`tests/ui/sign-out.test.mjs`, "F-1 proof"):
  1. A renewal is installed with `setSession()` (a new refresh token, the same session), no second renewal follows, and the next request works unrenewed.
  2. A renewal answered 500, 429, with an unknown 400 code, or with a dropped connection leaves the saved session exactly as it was, keeps the player in the game with "Can't reach the sign-in service", and lets them try again. After a 429, a further refusal sends no renewal before `Retry-After`. Only `refresh_token_not_found` ends the session.
  3. A renewal held while the browser's session changes (a new session of the same account, or a sign-out) installs nothing, resends nothing, and leaves what the browser saved.
  4. The library's `refreshSession()` and a refused request at the same moment: the same session, working.
  5. Refusals in two tabs at once: one renewal request for both.
- **GoTrue, on the local stack** (`tests/db/session-answers.test.mjs`, "F-1"):
  - two renewals of one refresh token at once both answer 200, for the same session, and both work;
  - `setSession()` accepts a renewed session, and it works;
  - an ended session's refresh token gets 400 `refresh_token_not_found`;
  - a malformed one gets 400 `validation_failed`.

**Against `543cbde`:** 7 of the 10 browser proofs fail there.
- **Guards** (pass there too): proof 1 (`refreshSession()` also installed a renewal), the `refresh_token_not_found` case, and proof 6.
- **The dropped-connection case** fails there only on its "untouched" check: the library retried the renewal and saved a renewed session, so the session wasn't lost.

**The remaining limitation, stated as the review asks:** R4 holds for the renewal this fix controls, after a `game` 401. It does not hold for renewals the library starts itself:
- its background renewal, about an hour after each sign-in;
- a renewal before sending a request, when the device's clock says the token has expired.

On a 500 or 429 those still remove the session. **R4 is not claimed as universal.** Background renewal is a separate tracked investigation (`docs/backlog.md`), with option B as one possible remedy.

**F-2:** the stuck-lock case in another tab is recorded in the backlog as a separate investigation, as asked.

**Runs and CI for this correction:** section 19.

## 19. Runs and CI after the F-1 correction

**Local, on the owner's Windows laptop, with the local stack stopped:**

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 65 of 65 | 281 of 281 |
| 2 | 65 of 65 | 281 of 281 |
| 3 | 65 of 65 | 281 of 281 |

- **Browser:** on `23a5b44`, the correction itself; later commits don't touch `public/` or `tests/ui/`. 281 is 271 plus the 10 F-1 proofs.
- **Engine:** after the identity test's list gained the renewal lock's name, `clickmonster.renew` (deviation 8). The first three engine runs failed only that test, which caught the new name: 64 of 65.
- **The database suite,** once locally with the stack up: pgTAP 42 of 42, and 17 of 17 tests (the F-1 GoTrue proof added), plus the opt-in one, skipped.

**CI:** recorded on PR #55 once the run on the pushed head completes.

## 20. The review of `ef20c15`: F-3 and F-4

**The review:** F-1 is accepted for the controlled 401 renewal, and CI run `44468455936` verified. Changes requested for two session-identity concerns: a late result of session S1 must never have authority over S2.

### F-3 (blocking): a late refusal of S1 could sign out S2

**Before:** on `refresh_token_not_found`, `renew()` returned "ended" without checking that S1 was still the saved session. `endSession()` then ended whatever was saved, possibly S2: a new sign-in of the same account, which doesn't advance the game's generation.

**After:**
1. **The refusal is re-checked.** "Ended" only while the browser still holds S1's refresh token. Otherwise S1 was renewed meanwhile (the same `session_id`: resend) or replaced (stale: nothing ended, nothing resent).
2. **`err.ended` carries the refused session** (`err.session`), and the callers pass it (`endSession(err.session)` in `main.js` and `entry.js`).
3. **`endSession(expected)` ends nothing** if the saved session isn't the same sign-in as `expected`: the same refresh token, or the same session renewed.
4. **The sign-out fallback compares sign-ins, not strings.** A renewed S1 (its token rotated meanwhile) is still removed, and a newer S2 never is.

**Tests:**
- **A held renewal of S1;** S2 of the same account saved meanwhile; then S1's token refused with `refresh_token_not_found`. The result is stale, not ended: S2 stays saved, signed in, and working.
- **`endSession(S1)` with S2 saved:** no reload, nothing signed out, S2 kept.
- **Both fail on `ef20c15`.**

### F-4: the hand-over to `setSession()`

**What was checked:** `setSession()` (supabase-js 2.45.4) waits for the library's lock, checks the token with the server (`GET /auth/v1/user`), then saves and announces the session. The client's own check of the saved session ran before that, not with it.

**What the tests found:**
- **Another tab saving a new session during the hand-over: the race is real.** Tab A's renewal was fetched and its `setSession()` held at its token check. Tab B then signed in again (S2, the same account), and A's renewal was saved over S2. On `ef20c15`: A carried on with S1's renewal, and S2 was gone.
  - The library's lock doesn't prevent this, because `signInWithPassword()` saves without taking it.
- **A sign-out in the same tab during the hand-over: no race.** The library runs its calls in order under its lock, so the sign-out comes after the pending save and clears it. When the sign-out falls back to the reload, the reload drops the pending save. Both orders were tested (the hand-over released before and after the 5 s limit); the session isn't restored, on `ef20c15` and now.

**The correction:** the library saves through a guard, its own `storage` option, which supabase-js supports.
- **Every save passes unchanged,** except a renewal being installed. That one is saved only if the browser still holds the session it renewed.
- **The check runs as the library saves,** inside its lock, and synchronously with the write. A save that would overwrite a newer session is refused before the library announces anything, so no tab is told about a session that wasn't kept.
- **`renew()` then reports the session as replaced:** stale, with nothing resent.
- **Test:** the cross-tab case above. A's renewal is refused at the save, nothing is resent, and S2 stays saved. It fails on `ef20c15`.

**What it can't cover:** another tab writing to `localStorage` in the instant between the guard's read and its write. The two are adjacent synchronous calls, and no browser API makes them atomic across processes.

### Startup budget

The first paint is **33,960 of 34,000 bytes.** The callers pass `err.session`.

### Runs and CI after F-3 and F-4

**Local, on `c6f20aa`** (the code and tests as pushed), with the local stack stopped:

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 65 of 65 | 286 of 286 |
| 2 | 65 of 65 | 286 of 286 |
| 3 | 65 of 65 | 286 of 286 |

- **The browser count:** 286 is 281 plus the 5 F-3 and F-4 tests.
- **The database suite** is unchanged since section 19; it runs in CI.
- **CI:** recorded on PR #55 once the run on the pushed head completes.

## 21. The review of `4218e2f`: F-5

**The review:** F-3 is accepted, and F-4 is accepted with its documented limitation. CI run `44528115859` is verified. Changes requested for F-5: a late, successful sign-out of S1 could remove S2.

**The race:** gotrue-js 2.65.0's `signOut()` asks the server, then removes the saved session without checking whose it is, and `signInWithPassword()` saves without the library's lock.

**The sequence:**
1. Tab A signs out S1, and its sign-out request is on its way.
2. Tab B signs in again as S2, and saves it.
3. A's request succeeds.
4. The library removes the saved session, which is now S2.

**Reproduced on `4218e2f`.** The test held A's sign-out request, signed B in as S2 (the same account), then answered A's request 204, within the 5 s limit. The saved session was then gone: `null`, not S2.

**The correction:** the storage guard of F-4 also covers removals while this tab signs out.
- **The removal is refused** if the saved session is no longer the sign-in being ended (`sameSession()`: the same refresh token, or the same session renewed).
- **The refusal is thrown before the library announces `SIGNED_OUT`,** so no tab is told to stop.
- **`leave()` then takes its existing fallback:** it removes the session only if it is still the same sign-in (here it isn't, so nothing is removed), and reloads. The tab then follows the browser's current sign-in, S2.
- **The guard is lifted once the library's call has finished.** After a time-out it stays, because the call may still finish and the page reloads.
- **Unchanged:** `scope=local`, the conditional cleanup, cross-tab behaviour, and the 5 s fallback.

**Tests** (`tests/ui/sign-out.test.mjs`, "F-5"):
1. **The sequence above.** S2 stays saved, B stays signed in, and a move works with S2. **It fails on `4218e2f`.**
2. **The guard is lifted after a normal sign-out.** Signing in again and out again in the same tab removes the second session, with two local sign-outs. It guards the correction itself, and passes on `4218e2f`, where there was no guard to lift.

**Still not covered:** the library's other unconditional removals, such as a renewal it starts itself and that is refused. They belong to the tracked background-renewal investigation.

**Runs and CI:**

**Local, on `937ffbd`** (the code and tests as pushed), with the local stack stopped:

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 65 of 65 | 288 of 288 |
| 2 | 65 of 65 | 288 of 288 |
| 3 | 65 of 65 | 288 of 288 |

- **The browser count:** 288 is 286 plus the two F-5 tests. The SO-1 to SO-13 tests and the F-1 to F-4 proofs are all among them.
- **On `4218e2f`:** the F-5 race test fails and the guard test passes, as stated above.
- **CI, run `44538744904`, on head `8aa0349`** (tested merge commit `8750070`):
  - **Attempt 1:** engine 65 of 65 and database passed. The browser job failed **1 of 288**: `P4-04 a failed save unlocks the draft…` (admin console) timed out after 30 s in its setup, waiting for the admin sign-in form. Its neighbours ran in 2.5 to 5 s, and it passed in all three local runs and three more runs of the admin tests.
  - **The diagnostics** (the failure artifact, downloaded with the owner's approval; not committed):
    - **The cause:** the browser's request for `/js/data/stats.js`, one of the admin page's modules, failed with **`net::ERR_NO_BUFFER_SPACE`**. The page's script never ran: an empty body, no `#login`, and no element of the admin console.
    - **Not this change:** `net.js` loaded normally (206 ms). There were no page errors, no bad responses, and no request to the fake backend at all.
    - **Not a slow runner:** the machine's CPU was at 12.6%, Node at 1.2%, the event-loop delay idle (mean 31 ms, as an idle Windows process reads), and 5.5 GB free.
    - **Classified as infrastructure:** the Windows runner's socket-buffer fault already in the backlog, its fourth occurrence.
  - **Attempt 2,** the one re-run of the failed job the owner authorized for that finding, with no code changed: **passed in full:** browser 288 of 288, and engine and database again (65 of 65; 42 of 42 pgTAP, and 17 of 17 plus 1 opt-in, skipped). The run's conclusion is success. It supports the infrastructure diagnosis; it doesn't show the runner fault is gone. Attempt 1's failure stands on record.
  - **Kept separate:** the infrastructure investigation stays apart from the sign-out correction, whose F-5 evidence is reviewed on its own.


## 22. Delivery and resolution

**Merged:** PR #55, after the final implementation review, by merge commit `e1ffa43` (2026-11-19, 15:52 UTC). Netlify published the site (`net.js`, `entry.js`, `main.js` and `admin.js`) on the merge.

**Deployed:** only the `game` function, with the owner's authorization (`npm run deploy:functions -- game`), from the clean merged `main` at `e1ffa43`.
- **The new version:** it went from version 13 to **version 14**: `ACTIVE`, updated `2026-11-19T15:53:01Z`, `verify_jwt: false` as before.
- **The quick check after it:** the endpoint answered `OPTIONS` with 200, and a call with no sign-in got 401.
- **Not touched:** no other function, migration or auth setting.

**Resolved:** at the review of 2026-11-20, the owner confirmed that the underlying authentication problem is corrected. They asked for the original lockout fix to be marked resolved, as the player-facing defect that started the investigation. (This is a paraphrase of the owner's confirmation, not a quotation.)

**Not recorded:** the results of a separate two-device check (sign in on two devices, sign out on one, the other returns to the form). The owner deferred that check on 2026-11-19 ("defer the end to end test"), and its results are not recorded here. The resolution rests on the owner's confirmation above, not on a recorded checklist.

**What came after, and what it was not.** After the merge, these addressed the tests, the fake backend and the CI runner, not the fix:

| Area | PRs |
| --- | --- |
| Test races | PR #58 (PR-4a), #59 (SO-9), #62 (B2-6), #63 (SO-2 and SO-3) |
| The fake backend's simulation of renewal | PR #65 (F-1 proof 4 and SO-3 concurrent: unique fake tokens, refusal by token identity) |
| The Windows runner's network fault | the plan in PR #64 |

None found a defect in the sign-out or renewal code. PR #65's negative controls show that the corrected tests still fail when the client's renewal coordination is broken.

**Known limitations, unchanged and in the backlog:**
- the library's own background renewal still discards a session on a 500 or 429 (section 18);
- a tab's stuck sign-in lock (F-2);
- the `admin` function's 401 classification;
- the brief sign-in form before the sign-out reload (a UX question).

**One more runner fault** came after section 21's: run `44546513378` on PR #55 hit `ERR_NO_BUFFER_SPACE` too. Its one authorized re-run passed, as recorded on PR #55.
