# Password recovery: scope

**Status: accepted at `43327bd`, with the owner's later decisions recorded in section 10 (2026-11-17).**
- **R-1 is implemented and accepted,** pending production activation. It was merged as PR #45 (`48be811`), and the request is still switched off.
- **Production activation is not authorized.**
- **Backlog item:** "Password recovery" (`docs/backlog.md`), raised in the landing scope review (Q14) as a higher-priority account-reliability item.
- **This scope adds no code.**
- **It reads nothing from production.** One gate below asks for a read-only inspection of the production auth settings, which needs the owner's authorization.

## 1. Why

- **Today there is no way to reset a forgotten password.** A player who forgets theirs loses their hero for good.
- **What it needs:**
  - a way to ask for a reset from the entrance;
  - an email with a link;
  - a place to choose the new password;
  - the player back in the game.
- **Supabase Auth provides the email and the link.** The work here is mostly on the entrance, plus configuration in the Supabase dashboard.

## 2. What exists (evidence)

### 2.1 The entrance (landing L-1)

- **The form:** `public/index.html` has one sign-in form (`#authform`): email, password (`minlength="6"`) and a message line (`#auth-msg`). A button (`#authmode`) switches between sign-in and sign-up.
- **The logic is in `public/js/entry.js`.**
  - It loads supabase-js only when the visitor first focuses or types in the form, or at once when a saved session is found (`loadNet()`).
  - It has the page's only auth listener: `onAuthStateChange` → `transition()`.
- **`transition()` (entry.js:184–202) starts the game for any new user session.** A session for a different user stops the old game first. No session shows the entrance.
- **The startup budget (LAC-2):** 32,000 decoded bytes, at 31,112 today (`tests/entrance-budget.test.mjs`). There are **888 bytes** of headroom, and comments may not be stripped to meet it (the owner's direction).

### 2.2 The Supabase client

- **The client:** `public/js/net.js` creates the one client (vendored supabase-js 2.45.4) with `persistSession`, `autoRefreshToken` and a storage key. Everything else is the library default.
- **Defaults that matter here,** read from the vendored build:
  - **Flow:** `implicit`. A reset link returns to the site with the session in the address fragment: `#access_token=…&refresh_token=…&type=recovery`. It doesn't need the browser that asked for the reset, so a link opened on another device works.
  - **`detectSessionInUrl: true`:** on load, the client reads that fragment, saves the session, and emits **`PASSWORD_RECOVERY`**, not `SIGNED_IN`. It then clears the fragment (`window.location.hash = ""`).
  - **An expired or used link** returns with `#error=…&error_code=…&error_description=…`. The client raises an error and **does not clear** that fragment.
  - **Available calls:** `resetPasswordForEmail(email, { redirectTo })` (POST `/auth/v1/recover`), `updateUser({ password })` (PUT `/auth/v1/user`), and `signOut({ scope: 'others' })`.

### 2.3 What would happen today with a reset link (a defect to fix)

**The flow:**
1. The link opens the entrance with a recovery session in the fragment.
2. The client saves the session and notifies listeners.
3. `transition()` sees a new user and **starts the game.**

**The player** is signed in without being asked for a new password, and the forgotten password stays unchanged. Nothing on the entrance reacts to `PASSWORD_RECOVERY` or to an error fragment.

### 2.4 Email delivery (a production question)

- **Supabase's built-in email sender** only delivers to members of the Supabase organization that owns the project, at about 2 emails an hour. Every other address fails with "Email address not authorized". **To reach real players, the project needs custom SMTP** (Authentication → Emails → SMTP Settings) with a verified sending domain. Sources: Supabase's [custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp), [changelog](https://supabase.com/changelog/29370-supabase-auth-changes-to-default-email-provider) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), read on 2026-11-17.
- **The same applies to sign-up confirmation emails.** The backlog already lists "a real confirmation email" as a before-release check.
- **Unknown, because it isn't in the repo:** whether production has custom SMTP, and its Site URL, redirect allow-list, reset email template, email rate limit, minimum password length and link expiry.
  - **`supabase/config.toml`** is the local stack only: a minimum length of 6, `otp_expiry` of 3600 s, an email rate limit of 2 an hour, and a site URL of `http://127.0.0.1:3000`.

### 2.5 Tests today

- **The fake backend** (`tests/ui/harness.mjs`) answers these auth routes:
  - `/auth/v1/token`;
  - `/auth/v1/user` (GET);
  - `/auth/v1/logout`;
  - `/auth/v1/signup`.

  It has no `/recover` and no password update.
- **The local stack** runs GoTrue. It can make a real recovery link without email through the admin API (`POST /auth/v1/admin/generate_link`, `type: recovery`, with the local service key), so the whole flow can be tested for real with no mail server.

## 3. Proposed design

### 3.1 Asking for a reset

- **The link:** in sign-in mode, a **"Forgot your password?"** link-style button, under the password field. It is hidden in sign-up mode.
- **The panel:** choosing it turns the panel into **"Reset your password"**:
  - an email field, filled in from the sign-in form;
  - a "Send reset link" button;
  - "Back to sign in".
- **Sending:** it calls `resetPasswordForEmail(email, { redirectTo: SITE_ORIGIN + '/' })`.
  - `SITE_ORIGIN` comes from `public/js/site.js`.
  - The send is single-flight: one request at a time, with the busy state the form already uses.
- **The answer is the same whether or not the address has an account,** so the page can't be used to find accounts: "If an account uses that address, we've sent it a link to choose a new password."
  - **The wording promises no particular lifetime** until P-1 confirms the production setting (Q8). After that, it may say "It works for a limited time", or the confirmed duration.
- **Errors:**
  - unreachable: the existing "Can't reach the sign-in service" message;
  - rate-limited (429): "Too many reset requests. Wait a few minutes, then try again.";
  - an invalid address: inline validation, as now.

### 3.2 Arriving from the link

- **`entry.js` reads the fragment before anything else:**
  - **With `type=recovery`:** the entrance shows **"Choose a new password"** at once, and loads supabase-js immediately, not waiting for a focus. **The game does not start** while the page is in this state, even though the library now holds a session (`transition()` checks a `recovering` flag).
  - **With `error_code`, or `error` for an expired or used link:** the page shows "This reset link has expired or has already been used." and a "Send a new link" action, which opens 3.1. It clears the fragment itself. Nothing starts.
- **The form:**
  - "New password" and "Confirm new password" (`autocomplete="new-password"`, the minimum length from the production setting, inline validation that the two match);
  - "Save password".
- **Saving:** it calls `updateUser({ password })`, then `signOut({ scope: 'others' })` (Q3, approved). **What that sign-out does and doesn't do:**
  - **Every other session's refresh token is revoked,** so other devices can't renew their sessions.
  - **Access tokens already issued** to other devices may stay usable until they expire: `jwt_expiry`, 3600 s locally, with the production value confirmed in P-1. Supabase doesn't recall issued JWTs.
  - **The current recovery session stays active.**
- **The outcomes, reported truthfully:**
  - **Both succeed (Q2):** "Your password is changed, and your other devices are signed out." The recovery guard is released (below), and the player enters the realm with this session, as after a sign-in.
  - **The password is changed, but signing out the other devices fails:**
    - **the message says so:** "Your password is changed, but your other devices couldn't be signed out. Try again." Nothing claims they were signed out;
    - **the actions:** "Try again", which repeats only `signOut({ scope: 'others' })`, and "Continue to the realm", which proceeds without it;
    - **the guard is released,** because the password is changed;
    - **"Try again"** stays single-flight.
  - **The password update fails:** the error stays in the form, and the password is **not** changed. The causes are a weak or too-short password (Supabase's own message), an unreachable service, or a session that is no longer valid; the last offers "Send a new link". The guard stays.
- **Another account signed in in that browser:** the recovery session replaces it. As with any account change, the old game stops (L-1's account isolation), and the new form shows.

**The recovery guard (Q9, PR-S01).** An incomplete recovery stays in recovery mode until the password is changed or the player cancels.
- **When a recovery link arrives,** the entrance stores a marker in `localStorage` (`clickmonster.recovery`) holding the recovering user's id. It does this before the session can be used.
- **On every load, the entrance checks first.** If the saved session belongs to the user in the marker, it opens "Choose a new password" and **does not start or preload the game.** This holds for a reload, a new tab, or coming back later.
- **"Cancel"** signs out the recovery session, which removes it everywhere in this browser, and clears the marker.
- **A successful password update clears the marker,** and the player may enter normally.
- **A stale marker** (it names a different user from the saved session, or there is no saved session) is cleared, and the entrance behaves as today.
- **If storage is unavailable** (a private window or blocked site data), the marker can't be kept. The guard then lasts only for this page, and a reload behaves as a normal saved session. The report states this limit.
- **This is an entrance and UI guard, not a server-enforced restriction.** The recovery session is an ordinary Supabase session, and its bearer token still works against the API and the `game` function. The guard decides only what the entrance shows and whether it starts the game. Enforcing it on the server would mean an API and server change, which is outside this scope.

### 3.3 Staying within the startup budget

- **In the first paint, only:**
  - the "Forgot your password?" button in `index.html`;
  - in `entry.js`: a short check of the address fragment and of the recovery marker, made before the saved-session start (the marker must stop the game preload), plus the lazy loader.
- **Everything else** loads only when needed, from a new **`js/entry-recover.js`**, plus its styles if it needs any: the reset request, the new-password form, their messages and their logic. "When needed" means the button is chosen, or the address carries a recovery or error fragment. The pattern is the same as `entry-news.js`.
- **The budget test** (`tests/entrance-budget.test.mjs`) stays at 32,000 and must pass. Comments are kept.
- **If the first-paint additions can't fit in 888 bytes,** that is reported as a decision for the owner, not trimmed to fit.

### 3.4 Not changed

- **Unchanged:**
  - the database schema;
  - the `game` and `admin` functions;
  - the game (`main.js`) and its API contracts.
- **The admin console's own sign-in** (`admin.html`) gets no reset link. Staff reset through the entrance (Q7).

## 4. Production configuration (the owner's, in the Supabase dashboard)

Each item is the owner's action or authorization. Claude only reads, and only once authorized.

| # | Setting | Needed value |
|---|---|---|
| P-1 | **Read-only inspection** of the production auth settings, through the Management API (`GET /v1/projects/{ref}/config/auth`). It covers whether custom SMTP is set, Site URL, redirect allow-list, the reset template, rate limits, minimum password length, link (OTP) expiry and JWT expiry. **Only once the owner explicitly authorizes it.** **No secrets are disclosed:** SMTP credentials, tokens and keys are never printed, logged or recorded. The record keeps only which fields are set and the non-secret values above | (inspection) |
| P-2 | **Custom SMTP** with a verified sending domain, unless P-1 shows it is already set. **The owner is leaning towards Resend** (no account yet). The steps are the owner's:<br>- create the Resend account;<br>- verify a sending domain **you own**, with Resend's DNS records. `clickmonsters.netlify.app` belongs to Netlify and can't be verified, so this needs your own domain or a subdomain of it;<br>- enter Resend's SMTP details in Supabase (Authentication → Emails → SMTP Settings).<br>The credentials go only in the dashboard: never in the repo, a PR or chat | sends to any address |
| P-3 | **Site URL** | `https://clickmonsters.netlify.app` |
| P-4 | **Redirect URLs** allow-list | **Only the production origin,** `https://clickmonsters.netlify.app/**`. Deploy-preview wildcards are **not** added: a wildcard would let reset links land on any preview build. Previews can be added later only by a separate decision |
| P-5 | **"Reset password" email template:** plain text and the game's name, no tracking, and the link from `{{ .ConfirmationURL }}`. A draft is proposed in the implementation PR for the owner to approve | approved text |
| P-6 | **The email rate limit,** with custom SMTP | at least the default of 30 an hour |
| P-7 | **The live check,** by the owner, after the merge. With a real address: ask for a reset, receive the email, open the link on another device, set a password, and sign in with it. Claude can't do this: it doesn't enter passwords or read the owner's email | recorded |

## 5. Questions for the owner

| Q | Question | Recommendation |
|---|---|---|
| Q1 | **Email delivery.** Authorize the read-only inspection (P-1)? If custom SMTP isn't set, which provider and sending domain? | Authorize P-1 first, separately. **Leaning: Resend** (the owner, 2026-11-17; no account yet). It needs a sending domain you own (P-2). The fake-backend and local work can go ahead meanwhile |
| Q2 | **After the new password is saved:** straight into the game, or back to sign in? | Straight in. The player has proven they own the address and chosen a password. Sign in again only if you want them to practise the new one |
| Q3 | **Sign out every other device** after a reset? | **Approved in the review:** `signOut({ scope: 'others' })`. It revokes the other refresh sessions, while their issued access tokens last until they expire; the current session stays. A failure is reported truthfully, with "Try again" (3.2) |
| Q4 | **Where the request lives:** in the same entrance panel, or a separate page? | Same panel, so focus, layout and the interface choice stay as they are |
| Q5 | **The startup budget:** keep 32,000 with the lazily loaded module (3.3), or raise it? | Keep 32,000 |
| Q6 | **Email template wording** (P-5) | Claude drafts it in the implementation PR; the owner approves it before it goes in the dashboard |
| Q7 | **The admin console's sign-in:** add a reset link? | No. Staff use the entrance |
| Q8 | **Link lifetime** | Whatever production is set to, read in P-1. The page promises no lifetime until then (3.1) |
| Q9 | **A player who opens the link and leaves without saving** | **Decided in the review (PR-S01):** they stay in recovery mode across reloads and new tabs, and the game doesn't start. "Cancel" signs out; a saved password releases the guard (3.2). It is a UI guard, not server-enforced |

## 6. Acceptance criteria

| ID | Criterion | How it's shown |
|---|---|---|
| PR-1 | "Forgot your password?" appears in sign-in mode only. It has an accessible name and is reachable by keyboard after the password field. The first paint stays within 32,000 bytes, and no recovery code loads until it's needed | Browser tests; the budget test; a request check that `entry-recover.js` doesn't load on a plain visit |
| PR-2 | **The request:** sends `/recover` once, with `redirect_to` set to `SITE_ORIGIN/`. It shows the same neutral confirmation whether or not the account exists, and promises no link lifetime. It maps a rate limit and an unreachable service to clear messages, and is single-flight | Fake backend: an existing address, an unknown address, 429, offline, a double press |
| PR-3 | **A recovery link:** shows "Choose a new password" first, and **never starts the game before a password is saved.** The token fragment is cleared from the address | A test on the old code that shows the game starting, which must fail on it; then the new behaviour |
| PR-4 | **Saving a password:** new and confirm fields, matching and length checks, `updateUser`, then `signOut({ scope: 'others' })`. Then (Q2) into the game. Errors stay in the form, including a weak password and an invalid session, and the password is unchanged on those | Fake backend, with each error |
| PR-4a | **The recovery guard (PR-S01):**<br>- **reload:** a reload during recovery shows "Choose a new password" again, with no game start or preload;<br>- **new tab:** the same in a new tab with the saved session;<br>- **Cancel:** signs out, clears the marker, and leaves the plain entrance;<br>- **success:** after the password is saved, a reload enters the game normally;<br>- **stale marker:** a marker for a different user, or with no saved session, is ignored and cleared, and a normal saved session still resumes straight into the game;<br>- **no storage:** without `localStorage`, the guard holds for the page, as documented | Browser tests, one per case. The reload case must fail on the old code |
| PR-4b | **Other sessions (PR-S02):**<br>- **success:** after a successful update, the fake backend has received a `logout` with `scope=others`, and the message says the other devices are signed out;<br>- **sign-out failure:** if that sign-out fails, the message says the password is changed but the devices weren't signed out. "Try again" repeats only the sign-out, single-flight; "Continue to the realm" enters; nothing claims success;<br>- **current session:** it remains valid throughout | Fake backend: success, failure then retry, failure then continue |
| PR-5 | **An expired or used link:** a clear message and "Send a new link", the fragment cleared, nothing started | A fake `#error_code=otp_expired` |
| PR-6 | **Account isolation:** a recovery link opened while another account is in the game stops that game cleanly, as L-1 does, and shows the form for the new account | A browser test in the style of the L-1 isolation tests |
| PR-7 | **Independent failures:** if the library or the service is down, the entrance stays usable with a message. News and sign-in are unaffected | Failure tests, as LAC-21 |
| PR-8 | **Accessibility:** focus moves to each new panel's heading; messages use the existing alert and status pattern; no native dialogs; **axe finds 0 violations of any impact** in every new state at 320, 390 and 1440 | Browser tests and axe |
| PR-9 | **The real flow, on the local stack:**<br>- an admin-generated recovery link, followed, redirects to an allowed URL with a recovery session;<br>- `updateUser` changes the password, so the new one signs in and the old one doesn't;<br>- after `signOut({ scope: 'others' })`, another session's refresh token is refused, while the recovery session's own still works;<br>- a link to a URL off the allow-list is not honoured | `npm run test:db`, new tests |
| PR-10 | **Documentation:** `README.md`, `CLAUDE.md` and `docs/backlog.md`. The production settings (section 4) are recorded as the owner sets them | The diff |

**Evidence, as before:**
- **Suites:** engine and browser, three times locally; the database suite once; all three CI checks green.
- **The report** says what was not verified.

## 7. Phasing

1. **This scope:** review and the owner's decisions (Q1 to Q9).
2. **P-1, if authorized:** the read-only inspection of production auth, recorded. It may decide whether P-2 is needed.
3. **R-1, implementation:** one PR, after authorization.
   - **Contents:** the entrance changes, `entry-recover.js`, the fake backend's `/recover` and password update, the browser tests, the local-stack tests and the draft email template.
   - **Production:** no production change.
   - **Process:** independent review, then merge.
4. **P-2 to P-6:** the owner configures production. Claude can re-read the settings afterwards to confirm, if authorized.
5. **P-7:** the owner's live check, recorded in a docs PR. Then the backlog item is closed.

## 8. Not verified by this scope

- **The production auth settings:** none were read (P-1).
- **How the Supabase template renders** in real mail clients, and **delivery and spam handling** with a custom SMTP provider.
- **Password managers** offering to save the new password. This belongs with the existing "password managers and autofill" release check.
- **Server-side enforcement of the recovery guard:** none, by design (3.2).

## 9. Scope review corrections (review of `01a5b0f`)

The review accepted the design in principle, and requested these changes.

**PR-S01, recovery-session persistence.** The draft let a reload enter the game without a new password.
- **Changed to:** a `localStorage` marker keyed to the recovering user. The player stays in recovery mode across reloads and new tabs, without a game start or preload.
- **"Cancel"** signs out. **A successful update** releases the guard.
- **Documented:** without storage the guard is per page only, and it is a UI guard, not server-enforced.
- **Where:** sections 3.2 and 3.3, Q9, and acceptance criterion PR-4a.

**PR-S02, other sessions.** Q3 is kept, approved.
- **Documented:** other refresh sessions are revoked; already-issued access tokens last until they expire; the current session stays.
- **A failed sign-out after a successful update** is reported truthfully, with "Try again" and "Continue to the realm".
- **Where:** section 3.2, Q3, PR-4b, and PR-9's local-stack check.

**Refinements:**
- **The budget:** 32,000 is kept. The recovery code stays lazily loaded, and the first-paint check now also covers the marker (3.3). If the additions don't fit, that goes to the owner, not trimmed.
- **No link lifetime is promised** until P-1 confirms the setting (3.1, Q8, PR-2).
- **Redirect URLs** are limited to the production origin; deploy-preview wildcards are dropped (P-4).
- **Kept:** the neutral confirmation, the real recovery-link tests on the local stack (PR-9), and the central regression test, no game before the password is changed (PR-3, PR-4a).
- **P-1** only with the owner's explicit authorization, and no secret is ever disclosed.

**The owner's note:** leaning towards Resend for production email; no account yet. This is recorded in Q1 and P-2, including the need for a sending domain the owner controls.

## 10. Decisions after acceptance (2026-11-17)

**R-1 authorized.** The owner authorized R-1 for local development and testing, without waiting for Resend, a domain, or production SMTP. Its implementation is PR #45, and its report is `docs/password-recovery-r1-report.md`.

**Email provider: Resend** (the owner's choice; no account yet).
- **Its prerequisites:** a sending domain the owner controls (P-2).
- **A dedicated Monstra Regna website domain is not a prerequisite:** `https://clickmonsters.netlify.app` can stay until a separately approved domain move.

**The public name.** "Monstra Regna" is the public-facing name, for new UI and email drafts. Technical identifiers may keep "ClickMonster".

**The startup budget (LAC-2) is 34,000 decoded bytes,** the owner's exception for R-1.
- **Why:** the guard can't fit in 32,000. It has to be in the first paint, to stop a returning player's game from preloading.
- **Unchanged:** comments are not stripped; everything else for recovery loads lazily.
- **This supersedes** the 32,000 in 3.3 and Q5.

**Accepted in the R-1 review** (PR #45, review of `cbddd42`):
- **Arriving from a reset link is handled even while asking is switched off.** It fixes the defect in 2.3, where a link entered the game, without depending on any email sender.
- **The link returns to the requesting page's own origin** (`location.origin`), not `SITE_ORIGIN` (3.1). Supabase's allow-list, limited to the production origin (P-4), still decides where it may land.
- **The release switch** (`RECOVERY_REQUESTS` in `entry.js`) is a UI gate, not a security boundary. Supabase's public recovery endpoint stays as Supabase provides it.

