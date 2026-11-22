# Monstra Regna (formerly ClickMonster): notes for Claude

A text-based multiplayer fantasy RPG for mobile browsers, at `https://monstraregna.com`.
- **The name:** players see "Monstra Regna" everywhere (MR-B1). Technical identifiers keep "ClickMonster" on purpose (D2): the repository, the Supabase project, the function names, the Netlify site and the `clickmonster.*` storage keys. `tests/identity.test.mjs` fails on any other use of the old name in `public/`, `netlify/` or the email templates.
- **Frontend:** vanilla JS ES modules in `public/`, no build step. Netlify publishes that folder.
- **Backend:** Supabase. It provides auth, Postgres with RLS, Realtime, and two edge functions: `game` (server-authoritative) and `admin` (staff API).
- **Players:** pick a race, raise uncapped stats, fight in level-gated grid zones, collect gold, gems and relic gear, and chat. Some zones allow PvP.

Read these first:
- `README.md`: features, architecture, layout, commands and deploying.
- `docs/ui-modernization-audit.md`: the Phase 0 audit and the phase plan.
- `docs/ui-phase-1-report.md` … `docs/ui-phase-4-report.md`: what each phase changed, its acceptance criteria, deviations and the review corrections.
- `docs/backlog.md`: agreed but unscheduled work (sign-in news, password recovery, follow-ups), and the release verification still owed, split into before and after release.
- The owner's design notes, records rather than approved scopes:
  - `docs/monstra-regna-world-zones-kingdoms-design-notes.md`: world, nested zones and Kingdoms;
  - `docs/monstra-regna-security-hardening-design-notes.md`: security hardening, authentication, action frequency and engagement verification;
  - `docs/monstra-regna-github-project-setup-brief.md`: the brief for the GitHub tracking below.

## Tracking (GitHub, set up 2026-11-22)

- **The Project:** [Monstra Regna — Development & Release](https://github.com/users/Aeturnia/projects/1), a private user-level Project linked to this repository.
  - **Fields:** Status, Priority (set by the owner only), Work type and Area.
  - **Status values:** Backlog, Research / Design, Scoped, Authorized, In progress, Review, Blocked, Done.
  - **Views:** Board, Roadmap (grouped by milestone), Backlog, Review gates, and Security & release.
- **Milestones #1 to #7** have no due dates; don't invent any:
  - Security Hardening — Baseline;
  - Authentication & Session Recovery — follow-ups;
  - Kingdoms — Design & Foundation;
  - Progression & Economy Simulation;
  - World & Zone Expansion Research;
  - Monstra Regna — Identity & Homepage;
  - Public Launch Readiness.
- **Issues #76 to #99** mirror the open work. Each entry in `docs/backlog.md` names its issue.
- **The rules:**
  - **The Markdown documents stay authoritative** (the backlog, the scopes and the reports). Issues link to them, not the reverse.
  - **A Status, milestone or assignment is a tracking signal, never authorization.** Only the owner's explicit instructions and accepted scopes authorize work, merges or deployment.
  - **Keep both in step:** when work is authorized, starts, reaches a review gate or completes, update the issue's Status. Cite the issue number in the PR and the report. Add new backlog entries as issues, linked both ways.
  - **Closed work stays closed.** Don't reopen it, or assign old PRs to milestones afterwards.
  - **Exploitable security findings** go in a private security advisory, not a public issue. The repository is public.
  - **No secrets or personal details** in issues, as elsewhere.
- **How to edit it:**
  - **Most changes:** `gh` with the `project` scope (`gh project item-add`, `item-edit`, `field-list`) and `gh issue`.
  - **The Status options and views:** GitHub's GraphQL API (`updateProjectV2Field`, `createProjectV2View`, `updateProjectV2View`).
  - **Web UI only:** view grouping and the built-in workflows.

## Where things stand (2026-11-14)

- **UI modernization Phases 1–4 are complete and merged into `main`.** Phase 4 (the admin console) was approved in its final independent review at `a8d9dc6` and merged as PR #13 (`baa75d9`). All four review findings, P4-01 to P4-04, are closed.
- **The desktop layout milestone is complete and merged into `main`** (2026-11-13). It was scoped in `docs/desktop-scope.md` (PR #17), with the owner's decisions in its section 4.
  - **D-1, the desktop frame:** merged as PR #18. See `docs/desktop-d1-report.md`.
  - **D-2, the persistent chat panel:** merged as PR #19 (`672a81a`). Findings D2-01 to D2-03 are closed. See `docs/desktop-d2-report.md`.
  - **D-3, keyboard shortcuts:** merged as PR #21 (`d567be2`), approved with no corrections. See `docs/desktop-d3-report.md`.
  - **Separate:** the layout picker was built as landing phase L-2 (below). Wider desktop sheets are not approved. The rename to Monstra Regna was later approved and scoped (`docs/monstra-regna-scope.md`); see MR-B1 below.
- **The landing page milestone is complete** (2026-11-14). All four phases passed independent review, and Stages 1 (L-1, L-2) and 2 (L-3, L-4) are formally closed. `docs/landing-scope.md` was the contract (PR #23, `e385e38`); its section 5 holds the owner's decisions and section 12 the scope review's corrections.
  - **L-1, the entrance:** merged as PR #25 (`b911a79`). L1-01 and L1-02 (account isolation) are closed. See `docs/landing-l1-report.md`.
  - **L-2, the interface picker:** merged as PR #27 (`4c9d049`), with no corrections. See `docs/landing-l2-report.md`.
  - **L-3, publication:** merged as PR #29 (`724807b`) and in production. See `docs/landing-l3-report.md`, section 12.
    - **Database:** the news migration was applied by hand, because production has no history for the earlier migrations. Only `20261115090000` is recorded in the history; the six earlier versions are deliberately unrecorded.
    - **Function:** `admin` version 8.
    - **Public check:** 21 of 21.
  - **L-4, public news:** merged as PR #32 (`d754dad`) after its final review at `888434d`, and live. The read-only live checks passed; their record is PR #33 (`8018bbb`). See `docs/landing-l4-report.md`.
    - **What it covers:** the entrance's news and maintenance line (`js/entry-news.js`, loaded after the first paint) and the article pages (`netlify/edge-functions/news.js`).
    - **Findings:** L4-01 (the maintenance notice expires while the page is open), L4-02 (405 headers) and L4-03 (an open-ended notice under way comes first) are closed.
  - **Final baseline** on `main` at `d754dad`: engine 47/47 and browser 178/178, in each of 3 runs.
  - **The entrance's first paint** is under MR-B2's performance contract (`docs/monstra-regna-scope.md`, 4.5), which replaced LAC-2's hard limit (32,000, then 34,000):
    - **the tripwire:** at most 48,000 decoded bytes, failing CI;
    - **the review threshold:** above 40,000, the milestone's report explains the increase;
    - **hard checks:** at most 3 requests before the form, no game code for an anonymous visitor, and the news after the first paint.

    It is 35,620 with MR-B2. Don't strip comments to meet it.
  - **Still open:**
    - the backlog's release checks: before release, sign-in on the live site and unpublishing; after release, the live maintenance line and the rest;
    - `/news` pagination (a follow-up);
    - maintenance mode (a server-enforced pause of play) and bug reports, newly in the backlog, not scoped;
    - the rename: now MR-B1, below.
- **CI (GitHub Actions), part 1: complete and accepted** (2026-11-16). Scope `docs/ci-scope.md` (PR #37, `6e21a82`); report `docs/ci-a-report.md`.
  - **What it is:** one workflow, three jobs (engine and database on Ubuntu, browser in Chromium on Windows), on each PR's merge commit, with no secrets and no production traffic.
  - **CI-A, its implementation,** was accepted and merged as PR #39 (`a54e392`, 2026-11-15). See `docs/ci-a-report.md`.
  - **CI-1a, the checks after the merge:** passed on 2026-11-16, after the library-retry test correction (PR #41).
    - **Both runs green:** the `push` run `43964915310` and the manual run `43966604836`, both on `0569796` (report section 12.5).
    - **Accepted:** CI-A and CI-1a are complete; the record was merged as PR #42 (`a0d5629`).
    - **Required checks** are ready for the owner to configure: `engine`, `browser` and `database`, on PRs into `main` (Q2). Don't change branch protection yourself.
  - **Not authorized:** parts 2 and 3.
- **MR-B1, identity and domain** (`docs/monstra-regna-scope.md`, section 3), authorized by the owner on 2026-11-18. See `docs/monstra-regna-b1-report.md`.
  - **Step 1 (the rename and `SITE_ORIGIN`, without the redirect) is complete:** merged as PR #48 (`ea2e4a4`) after independent review and green CI.
  - **Step 2** (Supabase Auth URLs) was done early by the owner; it is recorded as such, not independently inspected.
  - **Step 3: the applicable checks passed** under the current production authentication configuration (owner-reported, 2026-11-18): session kept and the reset link worked end to end on `monstraregna.com`. **Sign-up confirmation was not performed:** email confirmation is off in production (since the first setup). It is deferred until email confirmation and delivery are separately authorized and configured; don't enable it as part of other work.
  - **Step 4 passed** (2026-11-18): titles, manifest, and news canonical and `og:url` on `monstraregna.com`, checked by the owner and independently by authorized read-only requests.
  - **The announcement (QB-2) was waived** by the owner on 2026-11-21, as there are no players yet.
  - **Step 5, the redirect, is live:** PR #70 merged as `a468ee0` (2026-11-21).
    - **B1-4b found one deviation:** `/news` and `/news/*` on the old host are served by the news edge function, not redirected. The function's fix is its own PR (report sections 6 and 7).
    - **B1-4c wasn't performed.**
    - **The old host name** is allowed only as `LEGACY_HOST` in `netlify/edge-functions/news.js` (`tests/identity.test.mjs`).
  - **Don't touch** the Supabase allow-list (step 7) without authorization.
  - **MR-B2, the homepage and navigation,** was authorized on 2026-11-19. See `docs/monstra-regna-b2-report.md`.
    - **The milestone** merged as PR #56 (`1679855`).
    - **Its routing correction** merged as PR #57 (`577a253`) and is live.
    - **Accepted (2026-11-19)** under the revised canonical-address contract: the closing record merged as PR #60 (`9e788c3`), report section 7.5.
    - **The `netlify.toml` cleanup** (section 7.6) is at its own review gate.
    - **What it adds:** "Skip to sign in", the site menu (Home, Guide, Leaderboard, Contact), a footer on every public page, and the static pages `/guide`, `/leaderboard` and `/contact`.
    - **Not yet:** Discord waits for a permanent invite (D9); Privacy and Terms wait for the legal milestone (D7).
  - **MR-S1** needs its own authorization.
- **Gameplay polish: complete** (2026-11-19). Scope `docs/gameplay-polish-scope.md` (PR #50, `cc736b5`; amendment 1 in its section 14, PR #52, `99357cb`). GP-1 was merged as PR #51 (`9fb022a`) and the `game` function redeployed (version 13); the owner's live check passed. See `docs/gameplay-polish-report.md`, section 10.
  - **The fixes:**
    - A: the XP cue plays once;
    - B: numbers on the bars;
    - C: only the current round shows;
    - D: the outcome is shown once;
    - E: a mastery gain is shown once, under its round;
    - F1: a native monster drop-down;
    - F2: no roaming monsters on a town tile.
  - **Amendment 1:**
    - "+XP" and gold changes float over the hero bar;
    - two-line meters span the bar (an iPhone WebKit fix);
    - no HP bars on the fight screen, except a world boss's Shared HP.
  - **F2 is a game rule in the shared engine,** enforced by the live server since the redeploy.
  - **Follow-ups:** the phone-landscape tabs below the screen's edge (#95), and the Windows runner's `ERR_NO_BUFFER_SPACE` (#97, parked by the owner on 2026-11-22: the NetLog capture only observes ordinary CI runs, and nothing more is done unless the owner asks).
- **P1: sign-out on one device locks another out** (found 2026-11-19, live).
  - **Scope:** `docs/sign-out-scope.md`, PR #53 (`bfad9b3`), with two amendments decided at review gates.
  - **Delivered and resolved.** See `docs/sign-out-report.md`, section 22.
    - **Merged** as PR #55 (`e1ffa43`, 2026-11-19).
    - **The `game` function** was redeployed as version 14.
    - **The owner confirmed** the lockout resolved on 2026-11-20.
  - **A separate two-device check's results** are not recorded.
  - **The CI work after it** was on tests, the fake backend and the runner (PRs #58, #59, #62, #63, #65; the plan in #64), not on this fix.
- **Development moved to the owner's Windows laptop.** `npm run deploy:functions` now runs from any shell (PR #15) and needs `SUPABASE_ACCESS_TOKEN` set in the environment.
- **Don't start another milestone, or make gameplay or server changes,** until the owner approves it.
- **Release verification** is in `docs/backlog.md`. The owner split it on 2026-11-14, because there aren't the resources to test every device before release.
  - **Before release:** a short list on the owner's laptop and own phone:
    - sign-in on the live site: a real confirmation email, session restore and refresh, the `game` function, Realtime chat;
    - the same on the phone, with a battle and the map;
    - one admin action writing one audit entry;
    - unpublishing a news article live;
    - the `/vendor/*` cache header (done, 2026-11-14);
    - optionally, Firefox and Edge, a Discord link preview, and the owner's window size.
  - **After release, as players report problems:**
    - other devices and browsers;
    - screen readers;
    - input methods and non-US keyboards;
    - real players and staff data;
    - the maintenance line's changes;
    - other link previews and locales.

    A separate staging project is dropped.

  The test suites run in Chromium against a fake backend only.

## How the owner works

- **Phase-gated, with independent review.** Each phase gets its own branch and PR. Work stops at the review gate. The owner pastes reviews in like "Changes requested", with findings numbered P2-01, P3-02 and so on, or "APPROVED FOR MERGE".
- **Correction passes:**
  - Fix only what was asked, on the same branch.
  - For each finding, add a regression test that fails on the old code.
  - Update the phase report with a "Review corrections" section.
  - Push, comment on the PR with a summary, then stop.
- **Merging:** only when told. Before merging, check the PR is mergeable and pass the expected head SHA. Merge with a merge commit.
- **Evidence:**
  - Before/after screenshots and metrics, measured the same way on both versions.
  - Full engine and browser suites, run at least three times.
  - An axe sweep with **0 violations of any impact**.
  - A report that states deviations and what was *not* verified (real devices, screen readers).
  - Never claim a check that wasn't run. If a metric reports "0 before", check it really detects the defect on the old code first. That has caught bad metrics twice.
- **Writing style:** plain and direct. **No emojis or icons in the game UI.**

## Hard constraints

- **Signing out never depends on the server** (`docs/sign-out-scope.md`, 5.5). The browser must always be able to discard its own saved session and return to the sign-in form, whatever the server answers or however long it takes. The server stays authoritative on whether a session is valid. Every change to sign-in or sign-out keeps this; `tests/ui/sign-out.test.mjs` (SO-5, SO-8, SO-13) tests it.

- **Vanilla JS, no build.** No production dependencies; dev dependencies only with a justification (Playwright 1.63.0 and axe-core 4.10.2 are pinned).
- **Unchanged unless the task is explicitly about them:** game rules, database schema, API contracts and moderation consequences. UI work is client-only.
- **The server is authoritative.** Client checks only explain the rules (for example, the moderator 7-day sanction limit); never rely on hiding a control for security.
- **Keep the Phase 1–4 accessibility work intact:**
  - native `<dialog>` with focus handling;
  - focus preserved across re-renders;
  - persistent errors and inline validation;
  - polite announcements;
  - roving focus on the map and in chat;
  - `confirm.js` for every destructive action. No `confirm()` or `prompt()`: tests fail on any native dialog.
- **Secrets and personal details:**
  - Never commit secrets. The publishable key in `public/js/config.js` is public by design.
  - Don't put personal details (emails, names) into requests to outside services or into the repo.

## Architecture notes

- **The engine runs on both sides.** `public/js/engine` and `public/js/data` are shared with the edge functions through symlinks (`supabase/functions/{game,admin}/js -> ../../../public/js`). On Windows these check out as small text files unless Developer Mode is on and `git config core.symlinks true` is set before checkout (the deploy script reads `public/js` directly, so only `supabase functions serve` needs them). After changing either, redeploy the functions (`npm run deploy:functions`, which needs `SUPABASE_ACCESS_TOKEN`, a Supabase personal access token, in your environment) so server and client agree.
- **Zones** live in the `zones` table, edited in the admin console. `loadZones()` replaces the live `ZONES`/`MONSTERS` registries in place. The built-ins in `data/zones.js` seed it and are the fallback.
- **The entrance** (landing L-1, `docs/landing-scope.md`) is plain HTML in `index.html`, styled by `css/entry.css`, with `js/entry.js`.
  - **Anonymous visitors download no game code.** supabase-js loads when they first focus or type in the form; `main.js`, its modules and `css/style.css` load only after sign-in, or at once when a saved session is found. There is no autofocus.
  - **`entry.js` is the page's only auth listener.** It starts the game (`start(session, isCurrent)` in `main.js`) for a new user and stops it (`stop()`) on sign-out or when the session ends. Refreshes and repeated sign-in events for the same user do nothing. Each start has a generation number, and a stale one is dropped.
  - **Failures stay separate.** If the library, Supabase, the game's code or the first `state` call fails, the entrance stays with a message. A module that failed to load stays failed for the page, so Try again reloads in that case.
  - **Account isolation in `main.js`** (L-1 review, L1-01 and L1-02). Per-account UI state comes from `freshUi()`, and `stop()` replaces it. Every `start()` and `stop()` advances `gameGen`. Anything that awaits (an action in `runRemote()`, `loadBoard`, `refreshPlayers`, `loadHunts` and the other reads) records `gameGen` first and drops its result unless `live(g)`. New async game code must do the same.
  - **The entrance's CSS never reads `data-layout`.** Its colour tokens copy `style.css` `:root`, and `tests/entrance-files.test.mjs` checks they match.
- **The Supabase client:** `net.js` owns the one client. `client()` loads `vendor/supabase-js@2.45.4/supabase.js` (Supabase's UMD build, byte-identical to the npm package; hashes and update steps in `public/vendor/README.md`) and creates the client once. `sb` is a live binding. Nothing else may call `createClient`. The admin console uses `await client()`.
- **Signing out and refused sessions** (`net.js`; `docs/sign-out-report.md`):
  - **`signOut()` and `endSession()`** end this device's session only (`scope: 'local'`), with a 5 s limit. If the library errs, runs out of time or leaves a session saved, they remove `clickmonster.auth` themselves (only if it is still the session being ended), keep the message in `sessionStorage` (`clickmonster.note`) and reload. `signOut()` is the player's own; `endSession()` says "Your session has ended".
  - **Other tabs** follow a removed session through a `storage` listener.
  - **`api(action, args, isCurrent)`:** on a 401 from `game`, one renewal, then the request once more, only if the sign-in is unchanged (`err.stale` otherwise).
    - **The renewal is net.js's own request,** not `refreshSession()`: the library would itself remove the session on a 500 or 429. It runs one at a time, with a lock across tabs, and is installed with `setSession()`.
    - **Only `refresh_token_not_found` ends a session** (`err.ended`, with `err.session`), and only while the browser still holds that session. A 429 backs off; anything else keeps the session.
    - **The library saves and removes through a guard** (its `storage` option). A renewal being installed is refused at the save, and the session's removal during this tab's sign-out is refused, if the browser no longer holds that session. Both happen inside the library's lock, before anything is announced. A late result of one session never overwrites, ends or removes a newer one, even of the same account.
    - **`endSession(expected)`** ends only that session.
    - **Nothing else is retried.**
    - **The library's own background renewal** still discards a session on a 500 or 429 (backlog).
  - **The server:** the `game` function answers 401 only when `sessionFailure()` (`engine/session.js`) says "ended", and 503 otherwise. Its list comes from GoTrue's measured answers (`tests/session-answers.mjs`).
  - **Watch out:** supabase-js reports GoTrue's `session_not_found` as `AuthSessionMissingError`, not as an `AuthApiError`, and its own `signOut()` then keeps the saved session.
- **Game UI** is `public/js/main.js`:
  - `render()` paints regions with `paint(id, html)`, which keeps focus by key (`focusKey`: `id` or `data-a` + `data-v`).
  - Actions go through one delegated click handler. `handleLocal` covers view-only actions; `remoteCall`/`runRemote` call the server.
  - The pending state is tracked by key (`ui.pendingKey`, `markPending()`).
  - Toasts and alerts are re-homed into the topmost open dialog (`placeOverlays()`).
- **Layout state** is `layout.js`. It sets `#app[data-layout]` (`mobile`, `wide` or `desktop`) and `#app[data-chat]` (`panel` or `drawer`), and reorders the regions in the DOM for desktop. Desktop starts at 75em with a fine pointer, and the chat panel at 80em. Both conditions also check the usable width in rem, so larger text falls back.
- **The interface choice** (landing L-2) is `prefs.layout`: `auto`, `desktop` or `mobile`. It can be set on the entrance and in Hero, Settings.
  - `layout.js` resolves it (`setLayoutPreference()`, `resolveLayout()`, `layoutStatus()`). Desktop falls back to Automatic when it doesn't fit, without changing the saved choice.
  - The Phase 2 two-column rules are keyed off `#app:is([data-layout="wide"], [data-layout="desktop"])`, so a forced layout applies fully.
  - `entry.js` copies the Desktop rule's numbers, and a file test keeps them in step.
- **Keyboard shortcuts** (desktop only) are the `SHORTCUTS` table in `main.js`. The same table drives `shortcut()` and the `?` list (`sheetKeys()`).
  - A shortcut presses the existing button, and `markShortcuts()` adds `aria-keyshortcuts` after every render.
  - The off setting is `prefs.keys`.
  - The keydown handler checks `defaultPrevented` first, so keys that chat already handled are left alone.
- **The battle log** (gameplay polish C to E) is `logHtml()` in `main.js`, with the rules in `js/log-view.js`.
  - **What shows:** only the current round. Earlier rounds are a collapsed `<details>`.
  - **After a reload:** the lines already there are "Before this page loaded (N lines)", never rounds. The round marks exist only in the page (`ui.turnLog`).
  - **`cardLine()`** hides, from the finished round, the rewards and losses its outcome card lists. It is presentation only: `char.battle.log` is never changed.
- **Meters** (`meter()`, `fitMeters()`) carry their numbers on the bar. `fitMeters()` picks the full, short (`.compact`) or stacked (`.stack`) form after each render. It measures each part's own text width, not its box, because WebKit keeps a stale box width after the switch. On two lines, the label and the numbers span the bar. The hero bar is three paint regions (`hud-row`, `hud-hp`, `hud-xp`), so a regeneration tick doesn't recreate the XP meter.
- **Gold and XP cues** (`showCues()`, `floatCue()`) are created once per change, directly in `#top`, which redraws never replace, and removed after 1.6 s (`CUE_MS`). They take no space in the hero bar. Tests read them through the harness's `watchCues()`.
- **The fight screen** has no HP bars except a world boss's Shared HP. Each side has a strip (`.side-fx`) where `floatText()` puts the damage numbers, clear of the names.
- **The monster drop-down** (`#mon-select`) is marked `data-keep`. `paint()` leaves such an element in place when the new HTML has the same one (`keepInPlace()`), so an open native picker survives redraws.
  - **The Fight button** has no `data-v`; it reads the drop-down.
  - **Arrow keys** don't move the hero while a `<select>` has focus.
- **Chat** is `chat-ui.js`. It draws one chat state into the drawer or the desktop panel (`setMode()`).
  - Each sign-in is a chat session. `stop()` resets everything that belongs to the account. Anything awaited, including Realtime callbacks and confirmations, checks on return that its session is still current.
- **Admin** is `admin.js` and `admin-zones.js`: grouped navigation with hash routes, `dataTable()`, `field()`, `checkForm`/`validate`/`submitting`, and form values kept across re-renders.
- **Public news** (landing L-3) is the `news` table (`supabase/migrations/20261115090000_news.sql`).
  - **Access:**
    - `anon` and `authenticated` can read only published rows whose time has passed, and only the ten article columns (column grants plus RLS);
    - only the `admin` function writes, admins only;
    - a trigger enforces the publication rules: the address and first publication time are fixed once published, and a published row can't be deleted.
  - **The shared rules** are `public/js/data/news.js`: validation, the address, and the plain-text body format.
  - **The console section** is `admin-news.js`. Its pending keys are `news:<id>:<op>`.
  - **Rollback:** `supabase/rollback/20261115090000_news_down.sql`.
  - **Production checks:** `supabase/checks/news_precheck.sql` before applying, and `news_verify.sql` after. Both are read-only.
  - **The deploy procedure,** including how the migration history is read and reconciled, is in `docs/landing-l3-report.md`, section 4. Every step needs the owner's authorization.
  - **`tools/news-public-check.mjs`** requires `--published` and `--hidden`.
- **The public pages' menu and footer** (MR-B2) are defined once, in `public/js/site.js` (`menuHtml()`, `footerHtml()`, `COPYRIGHT_HTML`).
  - **The news pages** draw them from there.
  - **`index.html` and the static pages** (`public/guide.html`, `leaderboard.html` and `contact.html`, plain HTML with no script) carry the same markup, and `tests/site-pages.test.mjs` checks they match.
  - **Each static page is a single file** with a 200 rewrite in `netlify.toml`. Never a directory with an `index.html`: Netlify redirects such a directory's address to its slash form before any rewrite. That happened after MR-B2's first deployment.
  - **The address contract** (owner, 2026-11-19; report section 7.5):
    - the canonical, slashless address answers 200 directly;
    - its slash form answers one 301 to it, from Netlify itself, before any rewrite.

    No `force = true`, and no change to Pretty URLs.
  - **`tools/public-pages-check.mjs`** checks the live pages read-only, from their first responses. Run it against a routing PR's deploy preview before review (`node tools/public-pages-check.mjs https://deploy-preview-<n>--clickmonsters.netlify.app`), and against the live site after the merge.
  - **To add a menu item** (Discord, once there is a permanent invite) or a footer link (Privacy and Terms, after the legal milestone): change `site.js`, then each HTML copy.
  - **Each January,** update the copyright year in `site.js` and its copies.
- **Public news pages** are the Netlify Edge Function `netlify/edge-functions/news.js`, for `/news` and `/news/<slug>`.
  - **Data:** published rows only, read through the public REST API with the publishable key.
  - **Pages:** no script, a strict policy, `no-store`, and the canonical address from `public/js/site.js` (`SITE_ORIGIN`, which also holds `SITE_NAME`).
  - **Tests:** the handler is tested in Node (`tests/news-pages.test.mjs`), and the harness serves `/news` through it.
  - **The entrance's news** (`js/entry-news.js`) loads only after the first contentful paint, and failures show nothing.
- **Password recovery: R-1 implemented and accepted,** pending production activation. It was merged as PR #45 (`48be811`, 2026-11-17). See `docs/password-recovery-r1-report.md`; the scope is `docs/password-recovery-scope.md`, PR #44 (`031a026`).
  - **The first paint** is 35,620 bytes, against MR-B2's 48,000-byte tripwire and 40,000 review threshold (see above).
  - **The guard** is in `entry.js`, in the first paint. A reset link, its error, a `PASSWORD_RECOVERY` event, or the `clickmonster.recovery` marker for the saved session's user holds the game back: no start and no preload. It is a UI guard, not server-enforced.
  - **The rest** is lazily loaded: `js/entry-recover.js`.
  - **`entry.js` stays the only auth listener;** the module gets sessions through hooks.
  - **The release switch:** "Forgot your password?" is off until `RECOVERY_REQUESTS` in `entry.js` is set to `true` in a reviewed PR. Arriving from a link is handled regardless.
  - **Tests:** `tests/ui/password-recovery.test.mjs` (`recoveryUrl()` and `recoveryRequestsOn()` in the harness), `tests/db/password-recovery.test.mjs` (local GoTrue and Mailpit), and `tools/recovery-local-check.mjs` (end to end through the entrance, local only).
  - **Production activation is not authorized.** Its checklist is in the report, section 7.
- **Supabase edge functions import shared code only from `js/engine/` and `js/data/`,** because `tools/deploy-functions.mjs` uploads only those; `tests/news.test.mjs` checks this.
- **Admin requests are single-flight** (Phase 4 review, P4-01 to P4-04). `st.pendingForms` holds one key per request in flight:
  - a form id;
  - `action:target` for button actions (`actionKey()`, drawn by `markPending()` after every render, run through `pendingWhile()`);
  - `zone:<id>:<op>` for zone save, delete and restore.

  A second press of the same key sends nothing and opens no second confirmation. While a zone change is pending, its draft is locked in a disabled `fieldset.zone-lock`. New admin mutations should use the same pattern.
- **Confirmations** use `confirm.js`, with four tiers, documented in the Phase 3 report:
  1. Type the name to confirm.
  2. Danger dialog with focus on Cancel.
  3. Normal dialog.
  4. No dialog when the price is on the button.

  The owner approved not confirming ordinary priced transactions, and no percentage-of-gold thresholds.
- **Accuracy matters in copy.**
  - Losing a duel or dying drops **all carried gold** plus up to 20% of a level's XP (`deathPenalty()`).
  - Players are **never shown warnings**; mute, jail and ban reasons are shown.

## Testing

```
npm test                 # engine, entrance file checks, the first-paint tripwire, the public pages, news rules, the news page handler, the town rule, the log rules and the session rule (77)
npm run test:ui          # browser UI tests: Playwright + axe, against a fake backend (313)
npm run test:db          # database (pgTAP, 42) and API/function/recovery/session tests (17, plus 1 opt-in) on the LOCAL Supabase stack, with Mailpit
npx playwright install chromium   # once
```

**CI** (GitHub Actions, `.github/workflows/ci.yml`; scope `docs/ci-scope.md`):
- **Three checks,** each on its own runner, in parallel:
  - `engine` (`npm test`), on Ubuntu;
  - `browser` (`npm run test:ui`, Chromium), **on Windows**;
  - `database` (`npm run test:db` on the local stack, which the job starts and always stops), on Ubuntu.
- **Why the browser job runs on Windows:** on Ubuntu, five layout tests failed. This is an exception the owner approved (`docs/ci-scope.md`, section 10). It gives a Windows Chromium baseline, not Linux browser compatibility. The Linux font investigation is a backlog follow-up; don't change the tests' thresholds to make Linux pass.
- **When it runs:**
  - on a PR into `main`, testing GitHub's merge commit (the PR merged into `main`);
  - on each push to `main`;
  - by hand (Actions, CI, Run workflow).
- **Each job's summary** records the PR head SHA and the tested SHA. Cite both in reports.
- **No secrets, no production traffic,** and `contents: read` only. Actions are pinned by commit SHA, with the version in a comment.
- **Concurrency:** a newer push to a PR cancels that PR's older run. Runs on `main` are never cancelled.
- **Reading a failure:** the job's log on the PR's Checks tab. The failed suite's output is kept as an artifact for 7 days.
- **Cost:** GitHub Pro's $18 a month of shared compute, at $0.006 a minute per job, rounded up per job. Batch fixes into one push.
- **Failure diagnostics** (`tests/ui/diagnostics.mjs`, CI-A-01) are on in the CI browser job (`UI_DIAGNOSTICS=1`). For each failed test they save a Playwright trace, a screenshot, the DOM and `diag.json` under `tests/ui/artifacts/failures/`, in the failure artifact. Locally, run `UI_DIAGNOSTICS=1 npm run test:ui` to get the same. They only record; they never change a result.
  - **Every test** also writes resource measurements (duration, Node event-loop delay and CPU, machine CPU, memory) to `tests/ui/artifacts/metrics/`. CI uploads them on every run as `browser-metrics-attempt-<n>`.
  - **Connection and context counters** (`docs/ci-windows-reliability-plan.md`, M1 and M3) are in the same lines:
    - **per test:** the harness server's TCP connections opened and closed, how many were open at the end, the most open at once, and contexts created and still open;
    - **per file:** a summary line when its last test ends, and another at process exit.

    They only count, and change no connection behaviour.
  - **The runner's TCP table** (M2, `tools/ci-tcp-sampler.ps1`): the browser job samples it about every 5 to 6 s (a 5 s pause after each sample), as aggregate counts by state, machine-wide and loopback. It also takes snapshots, with the dynamic port range, before and after. The results go in the `browser-tcp-attempt-<n>` artifact.
    - **The steps** are `continue-on-error`, and the test step is unchanged, so they can't change its result.
    - **Correlating:** the metrics lines' `endedAt` (UTC) line up with the samples' `t`. `docs/ci-windows-reliability-plan.md`, section 8.3, says how to read them with a failure.
  - **The Chromium NetLog** (`tests/ui/netlog.mjs`; plan section 9). It's on only when `UI_NETLOG_DIR` is set, which CI's browser job does.
    - **What it adds:** each file's Chromium launch gets one added `--log-net-log=<unique file>`, in the default capture mode. A `.meta.json` beside it records the file, the server port, the PID, the launch command line (`DEBUG=pw:browser`) and whether the log was flushed.
    - **The artifact:** `browser-netlog-attempt-<n>`, with `windows-network.txt` and a size summary.
    - **Reading it:** `tools/netlog-trace.mjs`.
    - **Switching it off:** remove `UI_NETLOG_DIR`; the launch is then exactly as before.
    - **Never commit raw NetLogs.**
  - **The trace has no screenshots,** to reduce load on the two-core runner. `UI_TRACE_SCREENSHOTS=1` turns them back on, for comparison only.
  - **Reading the event-loop delay on Windows:** an idle process reads about 31 ms.
- **The first paint** is a test (`tests/entrance-budget.test.mjs`): the document plus every stylesheet and script `index.html` loads, counted as LF. At most 48,000 bytes (MR-B2's tripwire); above 40,000 is reported.

**The local Supabase stack** (landing L-3) runs in Docker Desktop. The pinned CLI is a dev dependency.
- **Start it:**
  ```
  npx supabase start -x studio,imgproxy,storage-api,logflare,vector,supavisor,realtime,postgres-meta
  ```
  This applies every migration to a fresh local database. Then run `npm run test:db`.
- **`npx supabase db reset`** re-applies the migrations from scratch. **`npx supabase stop`** stops it.
- **Local only:** the URL and keys are the CLI's local defaults (`npx supabase status`), and the tests refuse anything not on 127.0.0.1. Nothing here touches the live project.
- **Memory:** on the owner's laptop (about 8 GB for Docker), don't run the browser suite while the stack is running. In L-3, the two together starved the browsers and the run was stopped. Stop the stack (`npx supabase stop`) before `npm run test:ui`.
- **The functions run too,** at `127.0.0.1:54321/functions/v1/<name>`. The CLI mounts each imported file when the stack starts, so after adding or moving a shared file, stop and start the stack.

**`tests/ui/harness.mjs`** serves `public/` as Netlify does, as far as the tests need: a file first; then a directory's address without its slash redirected (301) to the slash form; then an address with a slash, where `x.html` exists, redirected (301) to `/x`; then `netlify.toml`'s 200 rewrites; then `x.html` for `/x`. It is a limited model: the live check is the authority for Netlify's routing. It answers every Supabase request with a fake backend built on the real engine. Any other host fails the test. supabase-js comes from `public/vendor/`; the CDN module is allowed only when `UI_PUBLIC_DIR` points at another checkout, which may be older code, and is cached in `tests/ui/.cache`. It provides:
- **`FakeBackend({ hero, players, chat, events, zones, quests, reports, worldEvents, activeHunts })`**. Its admin actions write the audit log and refuse repeats the way `supabase/functions/admin/index.ts` does, so a duplicate request shows up as a duplicate audit entry (`backend.adminData().log`). Keep it in step when server behaviour changes. It also provides `failNext(action, status, msg)`, `hold(action)` (returns a release function) and `broadcast()` for Realtime. Recorded `calls` and `unexpected` requests are available for assertions.
- **Test accounts:** `ACCOUNTS.player`, `admin`, `mod` (a moderator) and `fresh`.
- **Auth:** `savedSession(acct, expiresIn)` builds a stored session to seed `localStorage` (a negative `expiresIn` gives an expired one). Every access token is distinct (a `jti` counter). Refresh tokens are `refresh-<id>`; add one to `backend.revoked` to make the server refuse it. `backend.staleTokens = n` refuses the next n game calls, for one request at a time. For concurrent refusals, use `backend.expireIssuedTokens({ together: n })`: it refuses by token, answers the first n refusals together, and records `backend.tokenLog`. `backend.authCalls` lists the grant types requested, and `/auth/v1/signup` answers as with email confirmation on.
- **Fixtures:** `makeHero()`, `bigZone(n)`, `townLairZone()` (a lair on the town tile), `fixedQuest()`, `ADMIN_CHAT`/`ADMIN_REPORTS`. `makeHero()` stands in Bramblebrook's village (5, 5), where no roaming monsters can be fought (F2): tests that fight use `makeHero({ y: 4 })` or step north first, and choose with `#mon-select`.
- **Keyboard:** `fakeKeyboard()` / `setKeyboard(px, pan)` simulate an iOS-style overlay keyboard.
- **Navigation and pages:** `adminTab()` opens admin sections on phones. `page.nativeDialogs` records any native dialog.

**Measuring tools**, all on the fake backend:
- `tools/ui-metrics.mjs` (game layout numbers);
- `tools/ui-shots.mjs` (screens plus axe);
- `tools/ui-states.mjs` (interaction states);
- `tools/admin-shots.mjs` (admin at 320, 390, 768, 1024 and 1440);
- `tools/desktop-metrics.mjs` (desktop layout geometry: side column, battle actions, chat panel);
- `tools/entry-metrics.mjs` (the entry: startup requests and bytes, what an idle visitor downloads, what blocks the form, throttled time to the form, the sign-in screen with axe).

**Measuring the old version:** set `UI_PUBLIC_DIR` to another checkout's `public/` folder, for example `git worktree add ../cm-main origin/main`.

### Pitfalls already hit

- **Double taps:** battle actions have a 250ms double-tap guard. Wait about 270ms between taps in tests.
- **`settle()`** waits until nothing is `.pending` or `[aria-busy]`. Loading states are `aria-busy`, so don't call it while a request is held.
- **Quest board:** it changes every hour. Tests that need a quest pass `fixedQuest()`.
- **Fading text:** text animated with opacity fails axe contrast mid-fade, which shows up as an intermittent failure. Animate with transform only.
- **Admin on phones:** sections can sit in a collapsed navigation group. Use `adminTab()`.
- **Code passed as strings:** don't pass code into `page.evaluate` as a template string, because `\S` and similar escapes get mangled. Pass a function.
- **Admin tables:** they switch to cards with a container query on `.a-main` (the content column), not the viewport.

## Commands for deploying

- **Site:** Netlify publishes `public/` from `main` on merge.
- **Functions:** `npm run deploy:functions`.
- **Database:** add a new file in `supabase/migrations/`, apply it to the local stack and test it (`npm run test:db`), then, with the owner's authorization, `supabase db push` or the SQL editor. The Supabase project URL is in `public/js/config.js`.
