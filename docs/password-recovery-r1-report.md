# Password recovery, R-1: implementation report

**Status: implemented, awaiting independent review. Not merged.**
- **Authorized** by the owner on 2026-11-17, for local development and testing, under the scope at `43327bd` (PR #44, with PR-S01 and PR-S02).
- **The base** is `main` at `752e25a`.
- **PR #44** (the scope itself) is still open. Merging it, and updating its status line to "approved, R-1 authorized", is an outstanding administrative step for the owner. This branch doesn't include the scope document.
- **No production reads or changes.** The public "Forgot your password?" is **off** (section 3).

## 1. Files changed

| File | Change |
|---|---|
| `public/js/entry-recover.js` | **New.** The recovery panel, loaded only when needed: asking for a reset, "Choose a new password", saving, signing out the other devices, and expired links |
| `public/js/entry.js` | The recovery guard (first paint), the release switch `RECOVERY_REQUESTS`, hooks for the module, and its place in `transition()` |
| `public/index.html` | One line: the hidden "Forgot your password?" link, under the password field |
| `public/js/net.js` | `signOut(options)`: `{ scope: 'local' }` ends only this browser's session (Cancel). The default is unchanged |
| `tests/ui/password-recovery.test.mjs` | **New.** 24 browser tests against the fake backend |
| `tests/ui/harness.mjs` | The fake backend gains `/recover`, the password update (`PUT /user`), sign-out scopes and failure switches, plus `recoveryUrl()` and `recoveryRequestsOn()` |
| `tests/db/password-recovery.test.mjs` | **New.** 3 real-flow tests on the local stack, with Mailpit |
| `tools/recovery-local-check.mjs` | **New.** An end-to-end check by hand through the real entrance on the local stack |
| `supabase/config.toml` | Local only:<br>- the Monstra Regna email drafts as the recovery and confirmation templates;<br>- the email rate limit raised from 2 to 60 an hour |
| `supabase/templates/recovery.html`, `confirmation.html` | **New.** Monstra Regna email drafts, for the owner's approval |
| `tests/entrance-budget.test.mjs` | LAC-2 raised to 34,000 (the owner's decision, section 4) |
| `.github/workflows/ci.yml` | The database job keeps Mailpit running (no longer `-x mailpit`) |
| `CLAUDE.md`, `README.md`, `docs/backlog.md`, `docs/landing-scope.md` | The budget, the start command, the recovery architecture notes, and the activation checklist |

**Not changed:** gameplay, `main.js`, the database schema, the edge functions, and the API contracts. The existing tests and their thresholds are unchanged, apart from the budget test (section 4).

**Shared entrance files** (for the Monstra Regna branding milestone): `index.html` gains one line; `entry.js` gains a recovery section, two lines in `setMode()`, a block in `transition()` and a start branch. New UI strings don't use the game's name; the email drafts use "Monstra Regna".

## 2. How it works

**The guard** (`entry.js`, first paint). The entrance is in recovery mode when any of these holds:
- **the address carries a reset link** (`type=recovery`) **or its error** (`error=`);
- **an unfinished reset is recorded** for the user whose session is saved (`localStorage` `clickmonster.recovery`);
- **Supabase reports `PASSWORD_RECOVERY`.**

**While it holds:**
- the game neither starts nor preloads;
- `transition()` records the marker for the user, and hands the session to the module instead of starting the game.

**When it ends:**
- **A stale marker** (another user, or no saved session) is cleared, and the entrance behaves as before.
- **`unguard()`** is called the moment the password update succeeds. It clears both the guard and the marker, so the `USER_UPDATED` event that follows can't put the marker back. That race was found by the PR-4a reload test.
- **Any sign-out** ends the guard.

**The module** (`entry-recover.js`), loaded only when needed:
- **Asking for a reset:** `resetPasswordForEmail(email, { redirectTo: location.origin + '/' })`. The answer is the same whether or not the account exists, and it promises no link lifetime. It maps 429 and network errors to clear messages, and is single-flight.
- **Arriving:** it starts the client, which reads the link's session. An error fragment shows "Reset link not valid" and is cleared from the address. If the library fails to load, the panel says so and offers Reload.
- **"Choose a new password":** two fields with `autocomplete="new-password"` and the page's own checks (`noValidate`): at least 6 characters, and matching.
- **Saving:** `updateUser({ password })`, then `signOut({ scope: 'others' })`.
  - **Both succeed:** the guard is released and the game starts. The status line says "Your password is changed, and your other devices are signed out."
  - **The update succeeds but the sign-out fails:** "Your password is changed, but your other devices couldn't be signed out. Try again." "Try again" repeats only the sign-out; "Continue to the realm" enters without claiming success.
  - **The update fails:** the error stays in the form, and the password and the guard are unchanged.
- **"Cancel":** `net.signOut({ scope: 'local' })`, which clears the marker and returns to the sign-in form.

**The UI guard doesn't restrict the server.** The recovery session is an ordinary Supabase session; its token works against the API and the `game` function. This is as the scope states.

**Two small robustness additions:**
- **A reset link opened in a tab already showing the page** changes only the fragment, so the entrance reloads to let the client read it. PR-6 tests this.
- **`entry.js` stays the only auth listener.** The module receives session events through hooks; one client and one listener are checked through a whole reset.

**Decisions for the reviewer:**
1. **Arrival is handled even while the request is switched off.**
   - **The problem it fixes:** anyone can already call production's public `/recover` endpoint with the publishable key, and the Supabase dashboard can send reset emails. Before R-1, such a link signed the player straight into the game without a new password (the scope's defect, 2.3).
   - **With R-1:** such a link opens "Choose a new password" instead. This needs no email sender of ours.
   - **If the reviewer prefers both gated,** `RECOVERY_REQUESTS` can also gate arrival. That would leave the defect in production until release.
2. **The link returns to `location.origin`, not `SITE_ORIGIN`** (the scope, 3.1, said `SITE_ORIGIN`).
   - **Why:** so local and test runs come back to themselves, never to the production site (the owner's section 4).
   - **In production** the page's origin *is* the production origin. Supabase's allow-list still decides: an origin that isn't listed falls back to the Site URL, which the local stack test PR-9 shows.
   - **A future domain move** needs only configuration: the Site URL and the allow-list.

## 3. The release control

**`const RECOVERY_REQUESTS = false;` in `public/js/entry.js`:**
- an explicit constant, off by default and off in production;
- releasing it is a one-line change in a reviewed PR;
- no query string, storage key or other thing in the browser turns it on.

**While it is off:**
- "Forgot your password?" stays hidden and its handler can't be reached through the UI;
- `entry-recover.js` doesn't load on a plain visit (PR-1);
- an expired link doesn't offer "Send a new link".

**Sign-in and sign-up are unchanged** (PR-7, and the existing entrance tests).

**In tests:** `recoveryRequestsOn(page)` (harness) and `tools/recovery-local-check.mjs` rewrite the served `entry.js` in memory, for that page only. They fail if the switch is missing.

## 4. The startup budget (LAC-2)

**The first paint is 33,702 bytes:** `index.html` 5,647, `css/entry.css` 10,465, `js/entry.js` 17,590.

**Why it no longer fits 32,000:** the guard had to be in the first paint. The first version measured 33,481; about 2,000 bytes were code and markup and 400 comments, so even without comments it would have been about 33,100.

**The owner's decision** (2026-11-17): raise LAC-2 to **34,000**.
- **Recorded in:** `tests/entrance-budget.test.mjs`, `docs/landing-scope.md`, `docs/backlog.md` and `CLAUDE.md`.
- **The three later fixes** (the library-failure panel, the same-tab reload, and `unguard()` for the marker race) brought it to 33,702.
- **Unchanged:** no comments were stripped, the metric is the same, and the first paint still makes three requests.

## 5. Evidence

### 5.1 The defect, reproduced on the old code

**PR-3** was run against `main`'s `public/` (`UI_PUBLIC_DIR`, a worktree at `752e25a`). It opens a reset link, then focuses the email field, as a visitor would.
- **On the old code: it fails** with "arrival: no state call". The client took the link's session and **started the game.**
- **On R-1: it passes.**

The PR-4a reload test also fails on the old code.

### 5.2 Browser tests (fake backend), `tests/ui/password-recovery.test.mjs`: 24

| Owner's evidence point | Tests |
|---|---|
| 1. The old bypass reproduced | PR-3 on `main` (5.1) |
| 2. A valid link opens the form, not the game | PR-3, and `noGame()` in every arrival test |
| 3. A reload keeps the guard | PR-4a reload (no state call and no `main.js` preload) |
| 4. A second tab keeps the guard | PR-4a second tab |
| 5. Cancel signs out and clears the state | PR-4a Cancel (scope `local` only, the marker and session cleared, a reload stays out) |
| 6. A successful update changes the password | PR-4 |
| 7. The old password fails, the new one works | PR-4 (through the entrance), PR-9 (real GoTrue) |
| 8. Other refresh tokens are invalidated | PR-4 (`logout?scope=others` sent), PR-9 (real: the other device's refresh refused, its own still renews) |
| 9. A failed invalidation is reported accurately | PR-4b: Try again repeats only the sign-out; Continue enters; nothing claims success |
| 10. Expired and invalid links | PR-5: an expired link, the release switch on and off, a token the server refuses |
| 11. A normal sign-in is unaffected | PR-7, and the existing entrance and sign-in tests |
| 12. The first paint is within budget | `tests/entrance-budget.test.mjs`: 33,702 ≤ 34,000 |

**Also tested:**
- **PR-1:** off by default, with no module and no link; when released, the link shows in sign-in mode only and follows the password field by keyboard.
- **PR-2:**
  - one request back to this page;
  - an identical answer for a known and an unknown address;
  - a double press sends one request;
  - 429 and offline messages.
- **PR-4:** the checks before sending, and a refused update keeping the form and the guard.
- **PR-4a:** a stale marker for another user, or with no session, is cleared and a normal session resumes. Storage refusing the marker gives a guard for the page only, the documented limit.
- **PR-6:** a link opened over a running game for another account (same tab) replaces it cleanly.
- **PR-7:** the library failing on arrival.
- **PR-8:** focus on the heading in each state; **axe at all impacts: 0 violations** in the request, sent, expired, choose, choose-with-error and partial states, at 320, 390 and 1440.
- **One client and one auth listener** through a whole reset.

**One test bug was found and fixed while writing them:** a `text=Try again` selector matched the message paragraph (which ends "…Try again.") instead of the button. All clicks now use role-based selectors.

### 5.3 The real flow on the local stack

**`tests/db/password-recovery.test.mjs`, 3 tests (PR-9):**
- **A reset request** (`/recover`) sends the **Monstra Regna draft** ("Reset your Monstra Regna password"), captured by local Mailpit. The draft has no images or outside links.
- **Its link** goes back to `http://127.0.0.1:3000/` with a recovery session, and never to the production site.
- **The new password** is saved with that session. The old password is refused and the new one signs in.
- **Signing out the other sessions:**
  - the other device's refresh token is refused;
  - this session's own refresh still works.
- **A used link** returns with an error and no session.
- **A `redirect_to` off the allow-list** (`https://attacker.example/…`) goes to the site address instead.
- **An unknown address** gets the same 200 and no email.

**`tools/recovery-local-check.mjs`, through the real entrance:**
- **Setup:** Chromium; vendored supabase-js; local GoTrue and Mailpit; `public/` served on `127.0.0.1:3000`.
- **All 8 steps passed:**
  1. ask from the entrance;
  2. the email in Mailpit;
  3. the link opens "Choose a new password", with the address cleaned and no game;
  4. a reload keeps the form;
  5. save, and the game starts;
  6. the old password is refused and the new one works;
  7. the marker is cleared;
  8. no page errors, and nothing left the local stack.

### 5.4 Suites

| Suite | Result |
|---|---|
| Engine (`npm test`) | **48/48** in each of 3 runs (the budget test now checks 34,000) |
| Browser (`npm run test:ui`) | **202/202** (178 before, plus 24) in each of 3 runs, 411–430 s |
| Database (`npm run test:db`), with the stack alone and stopped before the browser runs | **42 pgTAP + 12** (9 before, plus 3), in each of 3 runs |
| CI | The PR's three checks, linked in the PR |

## 6. Not verified, and limits

- **Real email delivery** to outside mailboxes, and how the templates render in real mail clients: there is no Resend account or sending domain yet (activation checklist).
- **Production settings:** none were read. The Site URL, allow-list, link lifetime, password policy, JWT expiry and email limits are unconfirmed.
- **The guard is UI-only** (by scope). Without browser storage it lasts only for the page (tested).
- **Already-issued access tokens** on other devices last until they expire after the sign-out (by Supabase's design; recorded in the scope).
- **The release switch** is a code constant: releasing needs a reviewed PR, by design.
- **Password managers** saving the new password: not checked. It belongs with the existing release check.
- **Real devices and screen readers:** as for the rest of the entrance (backlog release checks).

## 7. Production activation checklist (not authorized)

Each step is the owner's, or needs the owner's authorization. The dedicated Monstra Regna domain is **not** a prerequisite; `https://clickmonsters.netlify.app` can stay.

1. **Create the Resend account.**
2. **Verify a sending domain you control,** with Resend's DNS records. `netlify.app` can't be verified.
3. **Configure Resend's SMTP in Supabase** (Authentication → Emails → SMTP Settings). The credentials go only in the dashboard.
4. **Approve the Monstra Regna templates** (`supabase/templates/recovery.html` and `confirmation.html`), then paste them into the dashboard.
5. **Verify the Site URL** (`https://clickmonsters.netlify.app`) **and the redirect allow-list:** the production origin only, with no preview wildcards.
6. **Confirm the production settings:** link (OTP) expiry, minimum password length (the page assumes 6; change `MIN` in `entry-recover.js` if production differs), JWT expiry and email rate limits. This is a read-only inspection (P-1), which needs authorization.
7. **Test real delivery** to outside providers (for example Gmail and Outlook): inbox, not spam.
8. **An owner-controlled recovery test** on the live site, with a real address: ask, receive, open on another device, set, sign in.
9. **Enable the public feature:** `RECOVERY_REQUESTS = true` in `public/js/entry.js`, in its own reviewed PR, then check it live.
