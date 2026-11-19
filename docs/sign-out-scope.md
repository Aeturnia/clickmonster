# Sign-out and session recovery: scope

**Status: conditionally approved at `c00b4ef`; revised for its three required refinements (section 12), for final scope acceptance.** Documentation only: nothing is implemented, nothing is deployed, and no production auth setting is read or changed.
- **Priority: P1,** a user-facing sign-in recovery defect. On current evidence it isn't a security incident.
- **Ordered by:** the owner, 2026-11-19, after the defect was found on the live site. Implementing, merging and deploying each wait for this scope's approval and their own authorization.
- **Kept separate from GP-1:** gameplay polish is closed; this defect isn't a GP-1 regression.

**Base:** `main` at `9fb022a`. File and line references are from that commit.

## 1. What the owner saw (2026-11-19, live site)

- **Setup:** the same account signed in on a phone and on a desktop (Edge).
- **The trigger:** the owner signed out on the phone.
- **On the desktop:**
  1. While playing, an error said to sign in again, with a Dismiss button.
  2. After a refresh, the entrance showed "Please sign in again." with **Try again** and **Sign out**.
  3. Try again showed the same message again.
  4. Sign out did nothing visible.
  5. Refreshing and hard refreshing changed nothing. The sign-in form never appeared, so **no account could sign in on that browser.**
- **The phone** went on working after signing in again.

## 2. How the sign-in works today (the trace)

**The library:** `public/vendor/supabase-js@2.45.4/supabase.js`, which bundles the auth client `gotrue-js` 2.65.0.
- **Its sign-out scopes:** `global` (the default: every session of the account), `local` (this browser's session) and `others` (every other session).
- **For `local` and `global`,** it first asks the server to end the session (`/auth/v1/logout?scope=…`), then removes the saved session and emits `SIGNED_OUT`.
- **If the server's answer is an error,** the library treats only 401, 403 and 404 as "already gone" and clears anyway. Any other failure (another status, a network failure) is *returned* as `{ error }`, not thrown, and **the saved session is kept.**
- **Before that,** it loads the session. If loading fails, the same `{ error }` comes back and nothing is cleared.
- **The lock:** `signOut()` first waits for the library's lock, with **no time limit**. In a browser with `navigator.locks` that is an exclusive lock shared by **every tab of the site**, and sign-in, renewal and session reads wait for the same lock.
- **No time limit on the request:** the library sets none on its sign-out request. A request that never answers keeps the lock, and every later sign-out, sign-in or session read in any of the site's tabs waits behind it.
- **Renewal:** when a saved session has expired, the library renews it. A refusal from the server (not retryable) removes the saved session and emits `SIGNED_OUT`; a network failure keeps it.
- **Other tabs:** the library broadcasts its auth events to the browser's other tabs on a `BroadcastChannel` named after the storage key (`clickmonster.auth`).

**The client:**

| Where | What it does |
|---|---|
| `index.html` (inline) | Adds `resuming` when `localStorage` has `clickmonster.auth`, so a saved session goes straight to the game |
| `entry.js`, `loadNet()` | Loads `net.js` and the library; the page's one `onAuthStateChange` listener calls `transition()` |
| `entry.js`, `transition()` | A session: `enterGame()`. None: stop the game, show the entrance, say "You have signed out." or "Your session has ended. Please sign in again." |
| `entry.js`, `enterGame()` (`:243`) | `game.start()` calls `state`. **Any failure** shows the gate: the message, **Try again** and **Sign out**, with the form hidden (`:264`–`:274`) |
| `entry.js`, gate Try again (`:364`) | Starts the game again with **the same session** |
| `entry.js`, gate Sign out (`:371`) | `net.signOut()` |
| `net.js`, `signOut()` (`:46`) | `sb.auth.signOut(options)`, **global by default** ("Everywhere by default"); errors are caught, but a returned `{ error }` is ignored |
| `main.js`, `runRemote()` (`:1581`) | On a 401 from an action: shows the error, then `sb.auth.signOut()`, **global** |
| `main.js`, the Sign out action (`:1627`) | `net.signOut()`, **global** |
| `admin.js` (`:898`) | `sb.auth.signOut()`, **global** |
| `entry-recover.js` (`:218`) | After a new password: `signOut({ scope: 'others' })`. **Deliberate,** and unchanged by this scope |

**The server:** the `game` function (`supabase/functions/game/index.ts:519`) checks each request with `admin.auth.getUser(token)`, and answers **401 "Please sign in again." for any failure**: a dead session, a bad token, *or* the sign-in service being briefly unreachable.

## 3. The cause

1. **Confirmed, from the code: the phone's sign-out ended the desktop's session too.** The game's Sign out is global by default (`net.js:46`), so signing out on the phone ended every session of the account.
2. **Confirmed, from the code: the entrance has no way out of a refused session.**
   - **The desktop's saved session still looks valid,** for up to an hour, until its access token expires. So a refresh doesn't renew it: the entrance starts the game with it, and the `game` function refuses it with 401.
   - **The entrance then shows the gate:** Try again reuses the same refused session, and the form stays hidden.
3. **Likely but not confirmed: Sign out didn't clear the saved session.** Two candidate causes, not exclusive:
   - **A refused sign-out:** `net.signOut()` ignores the `{ error }` the library returns. If the server's answer to signing out an already-ended session isn't 401, 403 or 404, or the request fails, nothing is cleared and nothing is shown.
   - **A sign-out that never finished:** the library's lock, or its sign-out request, never resolving (section 2). The click then waits for ever, with nothing shown, which matches "did nothing".
   - **What would tell them apart:** the `logout` request's status, or whether it was sent at all. The owner wasn't able to capture it before recovering.
   - **The first implementation step** measures the real server's answers on the local stack (GoTrue): signing out with an ended session's token, and `getUser` with it (SO-1b). The hang is checked in the browser with a sign-out request that never answers (SO-5).
4. **Probably self-limiting, also not confirmed:** about an hour after the phone's sign-out, the desktop's access token expires. The renewal is then refused, and the library removes the session, so the form should come back. Nothing in the interface tells the player so.

**The wider problem:** the client treats a saved session as proof of sign-in, and offers no way back when the server disagrees. The server stays authoritative on whether a session is valid. The browser must always be able to discard its own saved session and show the sign-in form. A failed server request must never make signing out on this device impossible.

**Recovery meanwhile:** in the affected browser, delete the `localStorage` key `clickmonster.auth` for the site (developer tools, Application, Local storage), then reload. That removes only the saved sign-in; the player's other settings stay.

## 4. Required behaviour (owner and review, 2026-11-19)

| # | Situation | Required behaviour |
|---|---|---|
| R1 | A player signs out | **Only this device's session ends.** Signing out everywhere may come later as a separate, labelled choice; it is not in this scope |
| R2 | The server says definitively that the session is invalid (ended, expired and refused, or a bad token) | The saved session is cleared on this device, and the entrance shows the **sign-in form** with "Your session has ended. Please sign in again." No Try again for a session that can't work |
| R3 | The player chooses Sign out, and the server refuses or can't be reached | **This device is signed out anyway:** the saved session is cleared and the form shows |
| R4 | A temporary failure (a timeout, a 5xx, the network) | **Not treated as an invalid session.** The saved session is kept, and Try again is offered |
| R5 | After recovering, another account signs in | Nothing of the previous account remains (L-1's isolation) |
| R6 | Several tabs in one browser | Signing out in one returns the others to the entrance, including when the server refused the sign-out |
| R7 | Phone and desktop layouts | The player is never left on a screen without the sign-in form or a working way to it |

**Also required:**
- **Clearing is idempotent:** doing it twice is harmless, and an already-ended session can't prevent it.
- **No tokens in logs:** no access token, refresh token or complete saved-session value is logged, printed or committed, in the code, the tests or the investigation.

## 5. Proposed design

### 5.1 Signing out: this device, and always clear (R1, R3, R6)

`net.js`, `signOut()`:
1. **`sb.auth.signOut({ scope: 'local' })`,** explicitly, **raced against a time limit** (proposed: 5 s).
2. **The normal case:** it finishes in time and the saved session is gone. The library has emitted `SIGNED_OUT` to this tab's listener and, over its `BroadcastChannel`, to the other tabs. Nothing more is done.
3. **The fallback,** when it returns an error, runs out of time, or leaves a saved session behind:
   - **Remove `clickmonster.auth` from `localStorage` directly.** This is outside the library's API, deliberately: it is the one step that can't be blocked by the library's lock or the server.
   - **Reload the page.** The library's lock may still be held by the unfinished request, and in this page every later sign-in would wait behind it; a reload releases this page's hold on it. The entrance then starts with no saved session and shows the form. A one-time flag in `sessionStorage` carries the message ("You have signed out." or "Your session has ended. Please sign in again."), so the reload doesn't lose it.
   - **The other tabs:** removing the key fires the browser's `storage` event in them. `net.js` listens for the removal of `clickmonster.auth` and does the same there: the game stops and the entrance shows the form.
   - **Not covered:** a lock held by *another* tab's stuck request (for example a hung renewal) still delays that tab's own library calls. Its own `storage` listener and the same fallback apply when its player signs out.
4. **Idempotent:** with no saved session, the fallback has nothing to remove and simply shows the form; a second click changes nothing.
5. **A late finish can't clear a newer session.** The race doesn't cancel the library's call, so its late completion is handled explicitly:
   - **After a time-out, the fallback never calls the library again, and always reloads.** The reload discards this page's pending call, so its late completion can't remove anything from this page's storage, whatever is saved by then.
   - **Compare before removing.** At the start, `signOut()` notes in memory which saved session it is ending (never logged or stored elsewhere). The fallback removes `clickmonster.auth` only if it still holds that session. If another tab has saved a new session meanwhile, the key is left alone, and this tab reloads into the new session like any other tab of the browser.
   - **The server side:** a late sign-out request ends only the session whose token it carries (`scope=local`). A session signed in afterwards has its own token and isn't affected. SO-1b confirms this with GoTrue.
   - **Other tabs:** while this page's call holds the library's lock, the other tabs' library calls wait. The reload releases the lock, and they run then, against whatever is saved at that moment.
   - **Tested by SO-13.**
6. **The same function serves every sign-out:**
   - the game's Sign out (`main.js:1627`);
   - the admin console's (`admin.js:898`, which today calls the library directly);
   - the entrance gate's (`entry.js:371`);
   - cancelling a reset (`entry.js:162`, already `local`).
7. **A second entry point, `endSession()`,** does the same without marking the sign-out as the player's own. The entrance then says "Your session has ended" rather than "You have signed out".

**Unchanged:** after a new password, `entry-recover.js` still signs out the account's **other** sessions (`others`), as the password recovery scope decided.

### 5.2 Telling an ended session from an outage (R2, R4)

**The server (`game` function).** The request check answers by the kind of failure:
- **401, "Please sign in again.":** only when the sign-in service has definitively refused the token: no token at all, or `getUser` fails with an `AuthApiError` (a response from GoTrue itself) whose GoTrue error code is in the definitive list, with a status consistent with it.
- **503, "Can't reach the sign-in service. Please try again.":** anything else:
  - a network failure or timeout (`AuthRetryableFetchError`);
  - a 5xx;
  - a response that isn't GoTrue's;
  - an error code that isn't in the list.
- **The decision rests on the error's type and GoTrue's error code, not on a status alone.** The function uses supabase-js 2.45.4 (gotrue-js 2.65.0), the browser's version, whose `AuthApiError` carries both the status and GoTrue's `code`.
- **The definitive list is set by evidence, not assumed.** SO-1b runs first and records GoTrue's actual answers (status, error type, error code) for each case:
  - an ended session's token;
  - an expired token;
  - a malformed token;
  - a deleted user;
  - no token.

  The list and the table that maps each answer to "ended" or "unavailable" are written into the report from those records before `sessionFailure()` is written, and the Node test uses the recorded answers as its fixtures. The codes expected, still to be confirmed, are `session_not_found`, `bad_jwt`, `user_not_found` and `no_authorization`.
- **When in doubt, "unavailable".** An unknown answer keeps the saved session and offers Try again. That is safe because Sign out always works (5.1). The cost of a wrong "ended" is a lost session; the cost of a wrong "unavailable" is a gate with a working Sign out.
- **The hosted service may run a newer GoTrue than the local stack.** Its answers aren't read in this scope; the report says so, and an unknown code falls to "unavailable".
- **The decision is a small pure function in the shared code** (`public/js/engine/session.js`, `sessionFailure(error)`), so Node can test it and both sides use the same rule.
- **This changes the `game` function, so it needs a redeploy,** with its own authorization.
- **The status codes are compatible with today's client:** a 503 already goes to the gate with Try again.

**The client:**
- **401 from the `game` function** means the session is over.
- **At start-up** (`enterGame()`): `endSession()`, then the form, instead of the gate.
- **During play** (`runRemote()`): `endSession()` replaces today's global `signOut()`.
- **Anything else** (503, another status, a network failure) keeps today's gate, with Try again and Sign out, and the saved session is kept.
- **The library's own renewal refusal** already emits `SIGNED_OUT`, which `transition()` handles (LAC-5b); that path is unchanged.

**Why on the server:** the server is authoritative, and the classification is then made once, where `getUser`'s actual error is visible. The alternative, the client asking the sign-in service itself after a 401, adds a request and still has to classify it the same way. It is listed as Q1.

### 5.3 The entrance and its startup budget (R7)

The entrance has **11 bytes of room** (33,989 of 34,000). The change to it is small:
- **`enterGame()`:** after a 401, call `endSession()` instead of showing the gate.
- **The gate's Sign out:** uses the new `signOut()` (no change in its line).
- **The reset-cancel hook:** loses its now-default `{ scope: 'local' }`.
- **The one-time message after a fallback reload:** read from `sessionStorage` at start-up and shown with the form.

**The extraction that makes room:** `authError()` (`entry.js:61`–`:69`, 435 bytes with its comment) turns a failed sign-in into a message. It runs only after a sign-in attempt, when `net.js` has already loaded, and its subject is the sign-in service. It moves to `net.js` as `authMessage()`, outside the first paint.
- **The entrance keeps one check:** a library that failed to load (`err.unavailable`) still shows its own message, so the move doesn't depend on `net.js` loading.
- **Estimate:** about 370 bytes freed, and about 120 to 200 bytes added. The first paint would end near 33,800 to 33,850 bytes.
- **The exact number** is measured in the implementation and reported. No comment is removed, no code is minified, and the budget isn't raised.

### 5.4 What stays as it is

- **The saved session's key** (`clickmonster.auth`) and the `resuming` class.
- **`entry.js` is the only auth listener;** L-1's account isolation (`stop()`, `gameGen`, `live(g)`).
- **The password recovery guard,** and its sign-out of other devices after a new password.
- **The `admin` function.** Its request check is not changed in this scope (Q2, decided: deferred). It has the same flaw, any failure of `getUser` answered 401 (`supabase/functions/admin/index.ts:672`), and is tracked as its own backlog follow-up. The admin console's Sign out does become local (5.1).

### 5.5 The invariant this scope establishes

**A browser must never depend on the server accepting a sign-out before it can return to the sign-in form.** The server stays authoritative on whether a session is valid; the browser always controls whether it keeps or discards its own saved session.
- **Permanent:** once implemented, it goes into `CLAUDE.md`'s hard constraints.
- **Kept by later work:** future auth changes keep it, and SO-5, SO-8 and SO-13 test it.

## 6. Acceptance criteria and tests

Each test is run against `main` at `9fb022a` (`UI_PUBLIC_DIR` for the browser tests). The last column says whether it fails there, and why. **Guards** pass on `main`: they keep behaviour that already works, or measure, and are not claimed to detect the defect.

**The harness gains:**
- **sessions that have ended on the server:** the `game` function answers 401, and `/auth/v1/user` answers 403 `session_not_found`;
- **sign-out failures on demand:** a chosen status, a dropped connection, or a request that never answers;
- **a `game` function failure on demand:** a 503 or a dropped connection, as `failNext` does for actions;
- **the scope of every sign-out,** already logged in `backend.logouts`.

| ID | Criterion | Test | On `main` |
|---|---|---|---|
| SO-1 | Signing out on one device leaves another signed in (R1) | Browser: Sign out sends only `scope=local`, in the game and in the admin console. Database (GoTrue, local stack): two sessions of one account; signing out one with `local` leaves the other's `getUser` and renewal working | **Browser part fails:** the sign-out sent is `global`. The database part is a guard: it tests GoTrue's `local` scope, not our code |
| SO-1b | **GoTrue's actual answers,** recorded with status, error type and error code, before `sessionFailure()` is written: `getUser` with an ended session's token, an expired token, a malformed token, a deleted user's token, and no token; `logout` with an ended session's token; renewal with an ended session's refresh token; and a late `logout?scope=local` with an old session's token leaving a newer session of the same account working | Database test on the local stack, recording the answers (no token values recorded) | **Measurement,** not a pass or fail on `main`. It sets `sessionFailure()`'s list (5.2), and establishes or rules out the refused-sign-out cause in section 3 |
| SO-2 | A saved session the server has ended, still unexpired, at start-up: the form with "Your session has ended", the saved session removed, no gate (R2) | Browser | **Fails:** the gate, with the form hidden |
| SO-3 | The same during play: an action answered 401 returns to the entrance with the form, the saved session is removed, and the sign-out sent is `local` | Browser | **Fails only on its scope check:** `main` already returns to the form here, through a `global` sign-out |
| SO-4 | An expired session whose renewal is refused: the form; signing in again works without clearing anything by hand | Browser (LAC-5b extended with a sign-in) | **Guard:** the library already handles this |
| SO-5 | The player's Sign out when the server's sign-out fails: a 500, a dropped connection, and a request that never answers. Signed out on this device anyway, within the time limit plus a margin; the form shows; a second Sign out is harmless (R3) | Browser, for the game's Sign out and the gate's | **Fails:** nothing is cleared after a 500 or a dropped connection, and nothing happens while the request hangs |
| SO-6 | A temporary failure at start-up (503, a dropped connection): the gate with Try again, the saved session kept; Try again starts the game once the service answers (R4) | Browser | **Guard:** `main` already does this; it must keep doing it |
| SO-6b | The server's rule: `sessionFailure()` gives "ended" for no token and for each GoTrue answer SO-1b recorded as definitive, and "unavailable" for network failures, 5xx, non-GoTrue responses and unknown codes; the `game` function answers 401 for an ended session's token and for a malformed one | Node (the rule, with SO-1b's recorded answers as fixtures), and database (the real function, local stack) | **The Node test fails:** the rule doesn't exist, and today any failure is a 401. The database part is a guard: an ended or malformed token is already a 401 |
| SO-7 | After recovering from SO-2, another account signs in and sees nothing of the first (R5) | Browser: its own hero, chat and messages | **Fails:** on `main` there is no recovery, so no second sign-in |
| SO-8 | Two tabs: signing out in one returns the other to the entrance, including when the server refused the sign-out (R6) | Browser, two pages sharing one browser context | **The refused case fails;** the normal case is a guard (the library's broadcast) |
| SO-9 | Phone and desktop: after SO-2, the form is on screen and reachable by keyboard at 390 x 844, 844 x 390 and 1440 x 900, with 0 axe violations (R7) | Browser | **Fails:** the gate, with the form hidden |
| SO-10 | The first paint stays within 34,000 bytes, with the number reported; no comment is removed | `tests/entrance-budget.test.mjs`, and the report | **Guard** |
| SO-11 | A new password still signs out the other devices (`others`), and only them | The existing password recovery tests, kept | **Guard** |
| SO-12 | Nothing logs or stores a token beyond the library's own saved session | Code review, and a check that the new code's log and message strings carry no token | **Review,** not a test on `main` |
| SO-13 | **A late finish can't clear a newer session** (5.1, point 5). This tab: the sign-out request is held, the fallback reloads to the form, the player signs in again, and then the held request is answered; the new session stays saved and the game keeps working. Another tab: tab A's sign-out hangs while tab B starts a sign-in; after A's fallback, B's new session is saved, A follows it, and answering A's held request doesn't remove it | Browser, two pages sharing one browser context | **Fails:** on `main` the hung sign-out never falls back, so the steps can't complete |

**Tests that change:**
- **LAC-21, "the first state call fails",** expects the gate after a failed `state` call. It is kept for a 503, and a 401 now leads to the form (SO-2).
- **The L-1 sign-out tests** expect a sign-out request; they now expect `scope=local`.

## 7. Evidence

- **The full engine, browser and database suites,** three runs each of engine and browser, and CI.
- **Before and after screenshots** of the state the owner was stuck in: the gate after a 401 (before), and the form with its message (after), at 390 and 1440.
- **SO-1b's measured statuses,** from the local stack.
- **The startup budget,** before and after.
- **A report** (`docs/sign-out-report.md`) with deviations and what wasn't verified:
  - the hosted sign-in service's exact answers (the local GoTrue may differ in version);
  - real phones;
  - Edge, the owner's browser, which the suite doesn't run.

## 8. Deployment, when authorized

The `game` function's change is compatible both ways: an old client treats a 503 as a failure with Try again, and the new client handles the old function's 401s as today's do.
1. **Before the merge is scheduled:** the owner's authorization for the `game` function redeploy.
2. **Merge.** Netlify publishes the client.
3. **Straight after:** `npm run deploy:functions -- game`.
4. **The owner's live check:**
   - signed in on the phone and the desktop, sign out on the phone: the desktop keeps playing;
   - Sign out on the desktop: the form, at once.

**Rollback:** revert the merge, then redeploy `game` from the reverted `main`. No data is involved.

## 9. Phasing

**One phase, SO-1 to SO-13, in one PR,** after this scope is approved and the implementation is authorized. It touches:
- the client: `net.js`, `entry.js`, `main.js`, `admin.js`;
- the shared rule: `engine/session.js`;
- the `game` function;
- the harness and the tests.

The change is small and the parts depend on each other, so it is reviewed as one.

**Order within the phase:**
1. **SO-1b first,** on the local stack.
2. **The classification table** written into the report from its records.
3. **Then the code.**

If SO-1b shows something that changes the design, for example GoTrue answering an ended session in a way that can't be told apart from an outage, the work stops and comes back for review before any code is written.

## 10. Out of scope

- **Signing out everywhere** as a player's choice. It may be offered later, labelled as such.
- **The `admin` function's request check** (Q2: deferred, tracked in `docs/backlog.md`).
- **Email confirmation, password recovery activation** and any other production auth setting.
- **The phone-landscape layout follow-up.**
- **Session lifetimes** and the hosted project's auth configuration.

## 11. Questions for the scope review (answered)

1. **Q1, where the session's end is decided: on the server,** in the `game` function, as proposed. One authoritative rule.
2. **Q2, the `admin` function: deferred,** with a tracked follow-up (`docs/backlog.md`). Its request check is outside this implementation; the admin console's Sign out still becomes local.
3. **Q3, the message: kept,** "Your session has ended. Please sign in again." It doesn't imply the player signed out elsewhere, which the client can't establish.

## 12. Scope review corrections (review of `c00b4ef`)

**Disposition:** conditional scope approval. The architecture is agreed. Documentation only: nothing implemented or deployed.

| # | Correction | Where |
|---|---|---|
| 1 | **Late completion after the time limit.** The race doesn't cancel the library's call. After a time-out the fallback never calls the library again and always reloads, which discards the pending call. It removes the saved session only if it is still the one being ended, so a newer session (another tab's, or this tab's after the reload) is never cleared. A late server request ends only its own session. Tested in one tab and across two | 5.1 point 5; SO-1b, SO-13 |
| 2 | **Classification from GoTrue's actual errors.** "Ended" requires an `AuthApiError` from GoTrue with a definitive error code, not a status alone. SO-1b records the real answers first, and they set the list and the Node test's fixtures. Anything unknown is "unavailable" | 5.2; SO-1b, SO-6b |
| 3 | **The `admin` function's classification deferred and tracked.** The same any-failure-is-401 check at `admin/index.ts:672` is a backlog follow-up | 5.4, section 10; `docs/backlog.md` |
| Q1–Q3 | **Decided:** server-side classification; `admin` deferred with a follow-up; the message kept | Section 11 |
| Also | **The invariant,** recorded as permanent: a browser never depends on the server accepting a sign-out before it can return to the sign-in form | 5.5 |
