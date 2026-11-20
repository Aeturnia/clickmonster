# Backlog

Planned work that is not yet scheduled into a phase. Each item names what it builds on.

## Release verification

The UI modernization (Phases 1–4), the desktop layout and the landing page were tested in Chromium only, against a fake backend. These checks are verification, not new features. Each comes from a phase report's "Not verified" section.

**Split by the owner on 2026-11-14.** There aren't the resources to test every device and browser before release.
- **Before release:** a short list, on the owner's laptop and own phone, covering what would break the game for everyone.
- **After release:** the rest, as players report problems (see "Bug reports" below).

### Before release

**Sign-in on the live site, on the laptop.** The vendored supabase-js 2.45.4 (landing L-1) has never talked to the live project, only to the fake backend.
- sign up with a real email address, and confirm it from the real email;
- sign in, then reload: the session is restored without signing in again;
- leave a tab open for over an hour, then act: the session refreshes by itself;
- play a little, which exercises the `game` function;
- send a chat message and see it arrive (Realtime);
- sign out.

**On the owner's own phone:**
- the same sign-in;
- one battle;
- moving around the map;
- typing in chat with the on-screen keyboard.

**Admin:** one admin action writes exactly one `admin_log` entry. The fake backend models this from `supabase/functions/admin/index.ts`; it was never observed live.

**Public news (landing L-3 and L-4):** unpublish an article on the live site and check that it's gone from `/news` and the entrance on the next request (`no-store`). Only after that is a cache considered (scope Q1).
- **Already seen live** by the owner on 2026-11-14: publishing a real maintenance article, and its line showing on the entrance while under way.
- **The test entries** `testing2` and `this-is-a-test` were removed by the owner on 2026-11-14.

**Netlify's `/vendor/*` cache header: done** on 2026-11-14, by Claude, with read-only requests to the live site:
- **Files:** `supabase.js`, `591.supabase.js` and `LICENSE` under `/vendor/supabase-js@2.45.4/` each return 200 with `Cache-Control: public,max-age=31536000,immutable`, as `netlify.toml` sets.
- **Contents:** each SHA-256 matches `main` and `public/vendor/README.md`.
- **Encoding:** the scripts are served as `application/javascript` and Brotli-compressed when accepted.
- **Observation, no action needed:** a missing file under `/vendor/` also gets the one-year `immutable` header on its 404. A browser could keep that 404 only for an address that doesn't exist yet, and Netlify publishes each deploy atomically, so the entrance can't point at a missing file.

**Optional, about ten minutes, free:**
- open the site in Firefox and Edge on the laptop (Firefox was never run);
- paste a news link into Discord to see the link preview;
- measure the owner's browser window (`innerWidth × innerHeight` and `devicePixelRatio`) and add it to the desktop measurements; 1920×1080 has stood in for it.

### After release, as players report problems

A separate staging Supabase project is dropped. The live sign-in session above covers the essentials, and the rest is checked on production as problems come in.

**Real devices and other browsers** (iOS Safari, Android Chrome, desktop Safari, and Firefox if it wasn't done before release):
- Native `<dialog>`: focus behaviour, `::backdrop` taps, and `dvh` sizing inside dialogs (Phase 1).
- On-screen keyboards with `visualViewport`, `interactive-widget` on Android, safe-area insets on notched phones in landscape, and touch panning of the map frame (Phase 2).
- Type-to-confirm with autocorrect on phone keyboards, and haptics on refused taps (Phase 3).
- Admin console: the sticky zone save bar with the keyboard open, table cards and the phone navigation (Phase 4).
- **The entrance (L-1):**
  - time to the sign-in form on real phones on mobile networks (the harness's 0.67 s is an underestimate);
  - password managers and autofill other than the owner's;
  - the reload-on-retry after a failed game download, in browsers other than Chromium.
- **The interface choice (L-2):**
  - forced Desktop on a real touch tablet;
  - browser zoom with Desktop forced (200% text size and resizing were tested);
  - other browsers.

**Input methods and keyboards:** the desktop shortcuts (D-3) with real input-method composition (Japanese, Chinese, Korean) and non-US keyboards such as AZERTY, on real hardware. Composition was only simulated with synthetic events.

**Screen readers** (VoiceOver, TalkBack, NVDA). Names, roles and live regions were only checked in the DOM and with axe. Also check keyboard navigation with the desktop shortcuts: in browse mode, screen readers take single-letter keys for themselves, and `aria-keyshortcuts` was only checked in the DOM.
- **Game:** the dialogs and `alertdialog` confirmations, `role="status"` toasts, the roving map and the shortened amounts (Phases 1–3).
- **Admin console:**
  - the group switcher, review panel and table cards;
  - the zone editor's live save note;
  - `aria-busy` on pending buttons, the "Still working" toast and the locked zone draft (Phase 4 and its corrections).
- **The interface choice (L-2):** the radio group and the polite note.
- **Public news (L-4):** the news section, which appears after the form without moving focus.

**The live backend, with real players and staff:**
- zone save, delete and restore with real players in the zone;
- the moderation flow with real reports;
- real staff data volumes, such as many reports or a long audit log;
- a revoked session (signed out elsewhere, or banned) on the live auth server.
- **Desktop chat (D-2):** sign out and sign in as another account in the same page with live Realtime, and check that nothing carries over: drafts, whisper recipient, unread counts, late messages, open confirmations.
  - The tests use the fake backend. Late Realtime events were simulated by calling the old subscription's callbacks, because the harness could not deliver one during `removeChannel()`.
  - Also check a failed send while the window crosses 1280px.

**Public news (L-3 and L-4):**
- **The maintenance line's changes, live:**
  - an upcoming notice turns "under way" at its start, and disappears at its end;
  - an open-ended notice under way comes first.

  These are tested in the browser suite only; watch for them at the next scheduled maintenance.
- **Link previews** in Slack and iMessage (and Discord, if it wasn't done before release).
- **Dates** in other locales and time zones.

## Follow-ups (not blocking)

- **The sign-in library's own renewals discard a session on a temporary failure** (from the sign-out fix's F-1 review, 2026-11-19; a security-hardening investigation before the public launch).
  - **What happens:** supabase-js 2.45.4 treats only 502, 503, 504 and "no response" as temporary. On a 500 or 429 during a renewal it starts itself, it removes the saved session and signs the player out. That covers its background renewal (`autoRefreshToken`, about an hour after each sign-in) and a renewal before a request when the device's clock says the token has expired.
  - **What the sign-out fix covers:** only the renewal after a `game` 401, which is now the client's own (`docs/sign-out-report.md`, section 18).
  - **To investigate:**
    - option B, turning off the library's background renewal and renewing in `net.js` the same way;
    - a newer supabase-js, if it treats these failures differently (a similar report exists upstream, supabase-js issue 2715);
    - the cross-tab and scheduling risks either brings.
  - **Not authorized.**

- **A tab's stuck sign-in lock** (F-2 of the sign-out fix's review, 2026-11-19).
  - **What happens:** the library's renewal, sign-in and sign-out wait for one lock shared by every tab of the site, with no time limit. If one tab's request never finishes, the other tabs' library calls wait behind it.
  - **What the sign-out fix covers:** a sign-out still clears the session after 5 s, and other tabs follow through the `storage` event.
  - **To investigate:** whether recovery in the *other* tabs can be made independent of a blocked lock.
  - **Not authorized.**

- **The `admin` function answers 401 for any sign-in check failure** (from the sign-out scope's review, 2026-11-19; deferred there by decision, Q2).
  - **What it does:** `supabase/functions/admin/index.ts:672` answers 401 whenever `getUser` gives no user: an ended session, a bad token, or the sign-in service being briefly unreachable. Staff can't tell an outage from a session that has ended.
  - **The fix:** the same classification as the `game` function's, once that exists (`docs/sign-out-scope.md`, 5.2): 401 only for a definitive refusal, 503 otherwise, from the shared `sessionFailure()` rule.
  - **Not authorized;** it needs an `admin` redeploy.

- **Sign-out on one device locks another out (P1, a user-facing sign-in recovery defect;** found by the owner on the live site, 2026-11-19).
  - **What happened:** signed in as the same account on a phone and a desktop, the owner signed out on the phone. The desktop then showed "Please sign in again". After a refresh, the entrance showed it again with Try again and Sign out. Try again failed the same way, Sign out did nothing visible, and the sign-in form stayed hidden, so no account could sign in on that browser. The phone kept working.
  - **Not GP-1's:** it is in the entrance and `net.js`, and existed before GP-1.
  - **Its own scope,** for independent review before any implementation: `docs/sign-out-scope.md`, PR #53.

- **Phone landscape: the tabs below the screen's edge** (from GP-1's iPhone check, 2026-11-18; the owner chose to record it as a follow-up rather than change GP-1).
  - **What the owner saw:** on an iPhone turned to landscape, on PR #51's deploy preview, the tabs (Explore, Hero, Gear, Map) were below the screen's edge. Resizing brought them into view, but then the browser's tab bar covered the hero bar.
  - **The cause, measured in Chromium at 844 px wide:**
    - In landscape the game uses the two-column layout. The right-hand column stacks the hero bar, the chat bar, the actions and the tabs, and nothing in it scrolls. When the column is taller than the visible height, the tabs fall off the bottom.
    - Resizing shows them by moving the whole page up, which is why the hero bar went under the browser's tab bar.
  - **It existed before GP-1, and GP-1 makes it worse.**
    - At this column's width (about 300 px), the HP and XP bars sit one above the other. GP-1's bars carry their numbers and are taller, so the hero bar went from 65 px to 83 px.
    - At 300 px of visible height, the tabs are 15 px off-screen while exploring before GP-1, and 34 px with it; in a fight, 0 px before and 7 px with it. At 340 px everything fits on both.
    - On the phone, the home bar's space at the bottom (about 21 px, which the test browser doesn't have) and the browser's toolbars leave less height than that.
  - **A possible fix, not scoped:**
    - on short landscape screens, keep the HP and XP bars side by side, with the slimmer 1rem bar the gameplay polish scope already allows for a compact hero bar;
    - and let the action area scroll when the column still doesn't fit, so the hero bar and the tabs always stay on screen.

    Test at 844 × 300, exploring and in a fight; then check on the owner's iPhone, since the test browser can't reproduce its toolbars or the home bar's space.
  - **This is not authorized:** neither the fix nor a scope for it.

- **Cross-platform fonts and responsive layout** (from CI-A, 2026-11-14).
  - **What happened:** CI-A's first run (`43638208611`) ran the browser suite on Ubuntu, and five existing layout assertions failed. The browser job now runs on Windows by the owner's exception (`docs/ci-scope.md`, section 10). The Linux results stand, recorded in `docs/ci-a-report.md`.
  - **The likely cause** is Linux font metrics, but it isn't established. The game's stack is `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, and the thresholds were set with Segoe UI.
  - **The investigation must cover:**
    - which font the browser actually resolves on Linux;
    - the HUD text clipped in phone landscape (844×390) and at 200% text (390px);
    - the monster list showing 1 row at 320×640, against at least 2;
    - a word broken to fit in an admin table at 320px;
    - the admin content starting at 278px on a phone, against at most 250.
  - **Keep the tests:** the thresholds and assertions stay as they are. Any fix is to the layout, not the tests, and only once scoped.
  - **This is not authorized:** neither a CSS change nor the investigation as a milestone.

- **An intermittent timeout in `PR-4a a second tab with the saved session also shows the form`** (`tests/ui/password-recovery.test.mjs`): **cause found, a race in the test's setup; corrected in PR #58 (`0029aea`, merged 2026-11-19).**
  - **The failure:** the second tab's `untilHeading(…, 'Choose a new password')` times out after 15 s.
  - **Where it happened:**
    - CI run `44368408591` on PR #50's docs-only commit `2cef100`, Windows (passed on its one re-run);
    - local run 2 of 3 for GP-1, Linux. Runs 1 and 3 passed, and so did CI on PR #51;
    - CI run `44596307837` on PR #57 (`4033a94`), Windows, 2026-11-19, the first time with diagnostics. Its failed job was re-run once, as authorized.
  - **The cause** (from that run's trace):
    - **The heading comes first.** The first tab shows the reset form from the link alone, before the library has read it. `entry.js` saves the session and the recovery marker only after that, once `/auth/v1/user` answers.
    - **The test didn't wait for the save.** `arrive()` returned at the heading and the test opened the second tab at once. On the runner, the first tab's library load was slow (machine CPU about 51%), so the second tab loaded about 200 ms before the save. Finding no session, it rightly showed the sign-in form, and never loaded `entry-recover.js`, `net.js` or the library.
    - **No defect elsewhere:** no page errors, failed requests or runner network faults, and nothing wrong in the application. The criterion is a new tab *with the saved session*, and this tab had none.
    - **The two earlier failures** had no diagnostics; the same cause is likely but not shown.
  - **The correction (test only):**
    - **The wait:** the test now waits, by condition, until the first tab has saved both the session and the marker for this account, then opens the second tab. Its assertions are unchanged.
    - **The proof:** a second test holds back the first tab's `/auth/v1/user` answer by 2.5 s and checks that nothing is saved when the heading shows. With the old setup it failed 3 of 3 times, with CI's error at the same line. With the correction it passed 3 of 3 times.
  - **Eight passes in a row locally** (before the cause was known) did not show the test was sound: it depended on the machine's timing.
- **SO-9 measured the page before the sign-out reload** (`tests/ui/sign-out.test.mjs`): **cause found, a race in the test; corrected on `claude/so9-race`, pending review.**
  - **The failure:** CI run `44634288178` on `main` at `577a253`, Windows, 2026-11-19. `SO-9 at 390x844…` failed: `page.evaluate: Execution context was destroyed, most likely because of a navigation`. The other two sizes passed. The run was not re-run.
  - **The cause** (from that run's trace and diagnostics):
    - **The reload is by design.** An ended session's `state` call got 401, the renewal 400 and the library's `/logout` 403 (`session_not_found`). The library then keeps the session, so `leave()` removes it and reloads (`net.js`).
    - **The form shows before the reload.** `entry.js` leaves the resuming state before calling `endSession()`, so the sign-in form is visible while `/logout` is answered.
    - **The test resolved on that early form.** `theForm()` returned at it, the test's `evaluate` started 10 ms later, and the reload destroyed it. The diagnostics show the page after the reload (124 ms old, navigation type `reload`), with no page errors or failed requests. The machine's CPU was at about 90%.
  - **The correction (test only):**
    - **The wait:** SO-9 now waits, by condition, for the page after the reload: navigation type `reload`, the document complete, the notice "Your session has ended. Please sign in again." and the form visible. Then it checks the notice and measures. Its viewport, keyboard and axe assertions are unchanged.
    - **A fourth case:** it holds back `/logout` by 1.5 s, checks that the early form shows before the reload, then runs the same checks.
  - **The proof, under the same delay:**
    - **The old wait, with the new checks:** failed 3 of 3 times at "measured after the reload".
    - **The literal old test:** passed 3 of 3 times, but falsely. It finished measuring the page before the reload arrived. So it can't be made to fail deterministically as written. On CI the reload landed mid-measurement.
    - **The correction:** passed 3 of 3 times.
  - **The same pattern elsewhere, not changed:** SO-2, SO-3, SO-4 and F-1 proof 2 also read the notice right after `theForm()`, after the same reload. Correcting them needs its own authorization.
- **UX: a sign-in form that can be used just before the sign-out reload** (found with the SO-9 race, 2026-11-19; not authorized).
  - **What happens:** when the server has ended a session, the entrance shows the sign-in form while the library's `/logout` is answered, then `leave()`'s fallback reloads the page. On a slow answer the form is usable for up to 5 s (`SIGN_OUT_MS`). Anything typed in it is lost in the reload.
  - **Acceptance criterion:** credentials entered during this transition cannot be silently lost.
  - **Constraint:** any change keeps the hard constraint that signing out never depends on the server (`CLAUDE.md`).
- **`net::ERR_NO_BUFFER_SPACE` on the Windows browser runner** (CI run `44410857655`, 2026-11-18, PR #51 at `b60c6ae`).
  - **What happened:** `R1-02 an expired link (error_code only)…` failed when Chromium's request for `/js/data/items.js` from the harness's local server failed with a Windows socket-buffer error. The entrance showed "The game could not be loaded", as it should for a module that fails.
  - **The diagnostics:** `diag.json` showed no page errors, no bad responses, and low CPU and memory.
  - **The likely cause** is the runner's network stack under the suite's many short connections, after more than 200 tests. It isn't established.
  - **Next step, when authorized:** see whether it recurs, and whether the harness's server should keep connections alive or the job should limit them. The `PR-4a` timeout above is a separate cause, a race in that test's setup: its third occurrence had no runner network error.
  - **It recurs.** It has been seen four times on 2026-11-18 and 19:
    - PR #47's docs-only commit (`/js/data/masteries.js`);
    - run `44410857655` above;
    - the `push` run on `main` after GP-1's merge (run `44432245764`, attempt 1): `GP-B4` failed at `page.goto: net::ERR_NO_BUFFER_SPACE`.
    - PR #55's run on `8aa0349` (run `44538744904`, attempt 1): `P4-04` (admin console); the request for `/js/data/stats.js` failed, so the admin page's script never ran.

    **The re-runs:**
    - PR #47's run (`44238281270`): attempt 2, authorized by the owner, passed.
    - Run `44410857655`: attempt 2 was started and then cancelled, most likely when the next push to the PR superseded it; it gave no result.
    - The `push` run after GP-1's merge (`44432245764`): attempt 2, authorized by the owner, passed 248/248.
    - PR #55's run on `8aa0349` (`44538744904`, 2026-11-19): `P4-04` in the admin console tests; its page's request for `/js/data/stats.js` failed, so the admin script never ran. Attempt 2, authorized by the owner after the diagnostics showed the fault: passed 288/288.

    The passing re-runs support the diagnosis but don't fix the fault.

- **B2-6 read the first-paint entry before the browser published it** (`tests/ui/homepage.test.mjs`): **cause found, a race in the test; corrected on `claude/b2-6-fcp`, pending review.**
  - **The failure:** CI run `44650435250` on PR #61 (`c521979`), Windows, 2026-11-19: `page.evaluate: TypeError: Cannot read properties of undefined (reading 'startTime')`. It was not re-run.
  - **The cause:** B2-6 read `performance.getEntriesByType('paint')`'s `first-contentful-paint` entry as soon as `#authform` was visible. The browser publishes that entry asynchronously, so the form can be visible first.
  - **The correction (test only):**
    - **The wait:** B2-6 waits, by condition, for the entry, then counts against its own timestamp, as before.
    - **Unchanged:** the limit (3), the exclusions (the icon and manifest), and the checks that a visitor loads no game code, `style.css` or supabase-js.
    - **A second case** hides the paint entries for the page's first 1.5 s, as a late publication would, and checks that the form shows first.
  - **The proof:**
    - **The late entry:** with the old code, the second case failed 3 of 3 times with CI's error. With the correction it passed 3 of 3.
    - **The limit still holds:** with a fourth request before the paint (an extra stylesheet in a copy of `public/`), both cases fail with "requests before the form: /, /css/entry.css, /css/news.css, /js/entry.js".

- **Pagination of `/news`** (from the L-4 review). The public list (`netlify/edge-functions/news.js`, `LIST_LIMIT = 100`) shows the 100 newest published articles. Older ones stay reachable by their address but drop off the list. Add pages (for example `/news?page=2`, or a link to older articles) before there are 100.

- **Audit entries are best effort** (from the L-3 review).
  - The `admin` function's `log()` reports a failed `admin_log` insert to the server console but doesn't fail the action. Any admin change, news included, can therefore succeed without its audit entry if that insert fails.
  - Normal operation writes exactly one entry per change.
  - Guaranteeing the entry (the change and its log in one transaction, for example through a database function) would be a change across every admin action. It needs its own decision.

- **The entrance's startup budget** (landing LAC-2) is 34,000 decoded bytes. It was revised to 32,000 in the L-4 review, then to 34,000 by the owner for password recovery (2026-11-17). The first paint is 33,987 bytes with R-1, and 33,989 with MR-B1's rename. Comments are not to be stripped to meet it (the owner's direction).

- **Queued battle effects across an account change** (from the L-1 final review).
  - `playEffects()` in `main.js` schedules battle animations with `setTimeout`. The timers aren't tied to the game session (`gameGen`).
  - If a battle ends and the account changes at once, a remaining animation could run on the next account's screen. It can't change hero or server state; it would be a brief visual glitch.
  - Fix by checking `live(g)` in the callbacks, or clearing the timers in `stop()`.
  - Add a test that signs out while effects are queued.

## Desktop layout (done)

Built in phases D-1 to D-3 and merged on 2026-11-13. See `docs/desktop-scope.md` and the three D reports. The layout picker from that scope was built as landing phase L-2. Still not approved: wider desktop sheets, and the possible rename to "Monstra Regna".

## Layout choice: desktop or mobile (done)

Built in landing phase L-2 and merged as PR #27 on 2026-11-13. See `docs/landing-l2-report.md`. Its checks still owed are in the release verification above.

## Maintenance mode

Raised by the owner on 2026-11-14, after publishing a real maintenance notice. Not yet scoped or scheduled.

- **Today:** a maintenance notice is information only. It is a news article of kind `maintenance`, shown as a line on the entrance (landing L-4). Nothing enforces it: players can still sign in and play while it is under way, as the owner saw on 2026-11-14.
- **Wanted:** a real maintenance mode that stops play while it is on.
- **The server must enforce it,** because the server is authoritative:
  - the `game` function refuses actions with a clear maintenance message, with the reads that need it too;
  - hiding the sign-in form alone is not enough.
- **Sign-in itself** is Supabase Auth, which the game doesn't control. In practice "no logins" would mean that sign-in succeeds, but the game doesn't start and the entrance shows the maintenance message.
- **Staff keep access.** Admins can still sign in and use the console, at least to turn the mode off.
- **Players already in the game:** a message, then back to the entrance. For example on the next `state` call or action, or pushed through Realtime. Decide what happens to a battle or hunt in progress, and to chat.
- **Questions for the scope:**
  - Is it a separate switch, or tied to a maintenance article's window?
  - Manual, or scheduled to turn on and off by itself?
  - Who can turn it on: admins only?
  - Should the entrance's line say "Play is paused" while it is on?
- **It touches** the database (where the switch lives), the `game` and `admin` functions, and the API contract. It needs its own scope, local tests, and the owner's authorization for each production step.

## Bug reports

Raised by the owner on 2026-11-14. Most device and browser checks are done after release (see "Release verification" above), so players need a way to report what breaks. Not yet scoped or scheduled.

- **Today:** players can report chat messages (`chat_reports`, reviewed in the admin console's moderation section). There is no way to report a bug.
- **Wanted:**
  - **The form:** a "Report a problem" form in the game, for example in Hero, Settings.
  - **What the player writes:** what happened, and optionally what they were doing.
  - **Context attached automatically,** shown to the player before sending:
    - the screen they were on;
    - the layout (`data-layout`) and interface choice;
    - the browser and device as the user agent reports them;
    - the window size;
    - the time;
    - the site version.
  - **Staff review it** in a new admin console section, with a status (new, seen, fixed or won't fix), modelled on the moderation queue.
- **Rules:**
  - signed-in players only, at least at first, to avoid spam;
  - a server-side rate limit;
  - plain text with a length limit, escaped when shown, as with chat and news;
  - no personal details collected beyond the account and what the player types;
  - the confirmation tells the player it was received.
- **Questions for the scope:**
  - Should the entrance have a form too, for problems that stop sign-in, given the spam risk without an account?
  - Should players see the status of their own reports?
  - Should the game also record client errors automatically (uncaught exceptions, failed game loads)? That is useful for problems players don't notice or describe, but it is a separate privacy and volume decision.
- **It touches** the database (a new table and its access rules), the `game` or a new function to accept reports, and the `admin` function and console. It needs its own scope, local tests, and the owner's authorization for each production step.

## Continuous integration (GitHub Actions)

Raised by the owner on 2026-11-14. **Part 1 is scoped:** `docs/ci-scope.md`, approved and merged as PR #37 (`6e21a82`). Its implementation, CI-A, was accepted and merged as PR #39 (`a54e392`, 2026-11-15). The after-merge check CI-1a passed on 2026-11-16, and CI-A and CI-1a are accepted as complete (`docs/ci-a-report.md`). Parts 2 and 3 below are not started. Part 1 now runs as `.github/workflows/ci.yml`: engine and database on Ubuntu, browser on Windows. This is a development-only change: no game, server or database change.

**1. The test suites on every PR** (the core):
- **Jobs:** `npm test`, `npm run test:ui` (Chromium), and `npm run test:db` (the local Supabase stack in Docker), each on its own runner.
- **The laptop's memory limit goes away.** The browser suite and the stack no longer compete for memory, as they did in L-3.
- **Independent evidence for reviews.** The result is run by GitHub on the PR's exact head commit, not reported by Claude.
- **The startup budget, measured exactly.** The runners check out LF line endings, so LAC-2 (32,000 decoded bytes) can be enforced as a failing check, with no Windows CRLF inflation.
- **Optional:** require these checks before merging. This may need a paid GitHub plan for a private repo.

**2. The browser suite in Firefox and WebKit** (Playwright's builds; WebKit is Safari's engine):
- **When:** nightly or on demand, to keep PR runs fast and within the free minutes.
- **What it covers:** part of the "after release" browser list. It isn't real devices or screen readers.
- **Expect fixes first:** the suite has only ever run in Chromium.
- **Raised again by GP-1 (2026-11-18):** on the owner's iPhone, a meter that switched to two lines kept its one-line width and cut its label off. Chromium measured it correctly, so the suite couldn't see it (`docs/gameplay-polish-scope.md`, section 14). A WebKit run might expose problems like this, but Playwright's WebKit isn't Safari on iOS and font metrics differ between systems, so it doesn't replace checking on the affected device.

**3. Live-site checks after each merge to `main`, and daily.** These repeat, with reads only, the checks made by hand in the L-4 report's section 9:
- the live files match `main`;
- the news pages' statuses and headers (`no-store`, the no-script policy, 404 for unknown addresses, 405 for POST);
- the `/vendor/*` cache header.

Netlify posts no deploy status for `main`, so this confirms that a deploy landed. Run daily, it also serves as a simple uptime check.

**Possible later, not by default: deploying the server functions** through a manual workflow that needs the owner's approval on every run. It would keep the "every production action is authorized" rule, but moves `SUPABASE_ACCESS_TOKEN` into a repo secret. That needs its own decision.

**Not covered by CI:** real phones, screen readers, real input methods, and anything needing a person signed in.

**Cost:** private repos get a monthly allowance of free Actions minutes. Part 1 in Chromium should fit; Firefox and WebKit on every PR would roughly triple the browser time.

## Password recovery

Raised in the landing-page scope review (2026-11-13, Q14). It is tracked separately from that milestone, as a higher-priority account-reliability item.

- **Today:** there is no way to reset a forgotten password. A player who forgets it loses access to their hero.
- **Needs:**
  - a "Forgot password" request from the entrance;
  - Supabase's reset email, with its redirect URL and email template configured;
  - a page to set the new password;
  - tests on the fake backend.
- **Fits with the entrance** (L-1), but isn't part of it unless the owner schedules it.
- **Status (2026-11-17):**
  - **Scoped and accepted** in `docs/password-recovery-scope.md` (PR #44, merged as `031a026`).
  - **R-1 is implemented and accepted, pending production activation.** It was merged as PR #45 (`48be811`), with "Forgot your password?" switched off (`RECOVERY_REQUESTS = false`). See `docs/password-recovery-r1-report.md`.
  - **Startup budget:** the first paint is 33,989 of 34,000 bytes after MR-B1, so any change to `entry.js`, `index.html` or `entry.css` has only 11 bytes of room.
- **Production activation** is not authorized. The checklist is in the R-1 report, section 7:
  1. a Resend account;
  2. a verified sending domain the owner controls;
  3. Resend's SMTP in Supabase;
  4. approved Monstra Regna templates;
  5. the Site URL and the allow-list, production origin only;
  6. expiry, password policy and rate limits;
  7. real delivery tests;
  8. the owner's live test;
  9. switching the request on.

## News and updates on the sign-in page

Done: built as landing phases L-3 and L-4 (`docs/landing-scope.md`), complete on 2026-11-14. The notes below are the original backlog entry.

- The sign-in page (`viewAuth`) shows recent news and game updates before signing in.
- Today's announcements (`world_config`) and world events (`events`) are readable only by signed-in players (row-level security `to authenticated`). Options:
  1. a new `news` table (title, body, published_at, author) with a public read policy for published rows, edited from the admin console; or
  2. a narrow anonymous read policy on announcements only.
  Option 1 keeps player-facing events private and gives staff a proper editor; it is the recommended one.
- Admin console: a News section to write, preview, publish and unpublish posts, logged in `admin_log`.
- Keep the sign-in form first in the reading order on phones; news follows it (or sits beside it on desktop).
- Plain text with paragraphs, no links, consistent with the chat link policy. No external images.
