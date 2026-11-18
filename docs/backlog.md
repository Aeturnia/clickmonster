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

- **Pagination of `/news`** (from the L-4 review). The public list (`netlify/edge-functions/news.js`, `LIST_LIMIT = 100`) shows the 100 newest published articles. Older ones stay reachable by their address but drop off the list. Add pages (for example `/news?page=2`, or a link to older articles) before there are 100.

- **Audit entries are best effort** (from the L-3 review).
  - The `admin` function's `log()` reports a failed `admin_log` insert to the server console but doesn't fail the action. Any admin change, news included, can therefore succeed without its audit entry if that insert fails.
  - Normal operation writes exactly one entry per change.
  - Guaranteeing the entry (the change and its log in one transaction, for example through a database function) would be a change across every admin action. It needs its own decision.

- **The entrance's startup budget** (landing LAC-2) is 34,000 decoded bytes. It was revised to 32,000 in the L-4 review, then to 34,000 by the owner for password recovery (2026-11-17). The first paint is 33,987 bytes with R-1. Comments are not to be stripped to meet it (the owner's direction).

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
  - **Startup budget:** the first paint is 33,987 of 34,000 bytes, so any change to `entry.js`, `index.html` or `entry.css` has only 13 bytes of room.
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
