# ClickMonster: notes for Claude

A text-based multiplayer fantasy RPG for mobile browsers.
- **Frontend:** vanilla JS ES modules in `public/`, no build step. Netlify publishes that folder.
- **Backend:** Supabase. It provides auth, Postgres with RLS, Realtime, and two edge functions: `game` (server-authoritative) and `admin` (staff API).
- **Players:** pick a race, raise uncapped stats, fight in level-gated grid zones, collect gold, gems and relic gear, and chat. Some zones allow PvP.

Read these first:
- `README.md`: features, architecture, layout, commands and deploying.
- `docs/ui-modernization-audit.md`: the Phase 0 audit and the phase plan.
- `docs/ui-phase-1-report.md` … `docs/ui-phase-4-report.md`: what each phase changed, its acceptance criteria, deviations and the review corrections.
- `docs/backlog.md`: agreed but unscheduled work (sign-in news, password recovery, follow-ups), and the release verification still owed, split into before and after release.

## Where things stand (2026-11-14)

- **UI modernization Phases 1–4 are complete and merged into `main`.** Phase 4 (the admin console) was approved in its final independent review at `a8d9dc6` and merged as PR #13 (`baa75d9`). All four review findings, P4-01 to P4-04, are closed.
- **The desktop layout milestone is complete and merged into `main`** (2026-11-13). It was scoped in `docs/desktop-scope.md` (PR #17), with the owner's decisions in its section 4.
  - **D-1, the desktop frame:** merged as PR #18. See `docs/desktop-d1-report.md`.
  - **D-2, the persistent chat panel:** merged as PR #19 (`672a81a`). Findings D2-01 to D2-03 are closed. See `docs/desktop-d2-report.md`.
  - **D-3, keyboard shortcuts:** merged as PR #21 (`d567be2`), approved with no corrections. See `docs/desktop-d3-report.md`.
  - **Separate:** the layout picker was built as landing phase L-2 (below). Wider desktop sheets and the possible rename to "Monstra Regna", a working title only, are not approved.
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
  - **The entrance's startup budget** (LAC-2) is 32,000 decoded bytes, revised in the L-4 review. It is 31,112 after L-4. Don't strip comments to meet it.
  - **Still open:**
    - the backlog's release checks: before release, sign-in on the live site and unpublishing; after release, the live maintenance line and the rest;
    - `/news` pagination (a follow-up);
    - maintenance mode (a server-enforced pause of play) and bug reports, newly in the backlog, not scoped;
    - the rename, which is not approved.
- **CI (GitHub Actions): scope approved** (2026-11-14), `docs/ci-scope.md`, merged as PR #37 (`6e21a82`).
  - **What it is:** one workflow, three jobs (engine, browser in Chromium, database on the local stack), on each PR's merge commit, with no secrets and no production traffic.
  - **CI-A, its implementation,** was accepted and merged as PR #39 (`a54e392`, 2026-11-15). See `docs/ci-a-report.md`.
  - **CI-1a, the checks after the merge:** passed on 2026-11-16, after the library-retry test correction (PR #41).
    - **Both runs green:** the `push` run `43964915310` and the manual run `43966604836`, both on `0569796` (report section 12.5).
    - **Awaiting the completion review.**
    - **Required checks stay off** until the owner authorizes them.
  - **Not authorized:** turning on required checks or branch protection, and parts 2 and 3.
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
- **The Supabase client:** `net.js` owns the one client. `client()` loads `vendor/supabase-js@2.45.4/supabase.js` (Supabase's UMD build, byte-identical to the npm package; hashes and update steps in `public/vendor/README.md`) and creates the client once. `sb` is a live binding, and `signOut()` marks a player's own sign-out. Nothing else may call `createClient`. The admin console uses `await client()`.
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
- **Public news pages** are the Netlify Edge Function `netlify/edge-functions/news.js`, for `/news` and `/news/<slug>`.
  - **Data:** published rows only, read through the public REST API with the publishable key.
  - **Pages:** no script, a strict policy, `no-store`, and the canonical address from `public/js/site.js` (`SITE_ORIGIN`, which also holds `SITE_NAME`).
  - **Tests:** the handler is tested in Node (`tests/news-pages.test.mjs`), and the harness serves `/news` through it.
  - **The entrance's news** (`js/entry-news.js`) loads only after the first contentful paint, and failures show nothing.
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
npm test                 # engine, entrance file checks, the startup budget, news rules and the news page handler (48)
npm run test:ui          # browser UI tests: Playwright + axe, against a fake backend (178)
npm run test:db          # database (pgTAP, 42) and API/function tests (9) on the LOCAL Supabase stack
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
  - **The trace has no screenshots,** to reduce load on the two-core runner. `UI_TRACE_SCREENSHOTS=1` turns them back on, for comparison only.
  - **Reading the event-loop delay on Windows:** an idle process reads about 31 ms.
- **The startup budget** is now a test (`tests/entrance-budget.test.mjs`): the document plus every stylesheet and script `index.html` loads, counted as LF, at most 32,000 bytes.

**The local Supabase stack** (landing L-3) runs in Docker Desktop. The pinned CLI is a dev dependency.
- **Start it:**
  ```
  npx supabase start -x studio,imgproxy,storage-api,logflare,vector,supavisor,mailpit,realtime,postgres-meta
  ```
  This applies every migration to a fresh local database. Then run `npm run test:db`.
- **`npx supabase db reset`** re-applies the migrations from scratch. **`npx supabase stop`** stops it.
- **Local only:** the URL and keys are the CLI's local defaults (`npx supabase status`), and the tests refuse anything not on 127.0.0.1. Nothing here touches the live project.
- **Memory:** on the owner's laptop (about 8 GB for Docker), don't run the browser suite while the stack is running. In L-3, the two together starved the browsers and the run was stopped. Stop the stack (`npx supabase stop`) before `npm run test:ui`.
- **The functions run too,** at `127.0.0.1:54321/functions/v1/<name>`. The CLI mounts each imported file when the stack starts, so after adding or moving a shared file, stop and start the stack.

**`tests/ui/harness.mjs`** answers every Supabase request with a fake backend built on the real engine. Any other host fails the test. supabase-js comes from `public/vendor/`; the CDN module is allowed only when `UI_PUBLIC_DIR` points at another checkout, which may be older code, and is cached in `tests/ui/.cache`. It provides:
- **`FakeBackend({ hero, players, chat, events, zones, quests, reports, worldEvents, activeHunts })`**. Its admin actions write the audit log and refuse repeats the way `supabase/functions/admin/index.ts` does, so a duplicate request shows up as a duplicate audit entry (`backend.adminData().log`). Keep it in step when server behaviour changes. It also provides `failNext(action, status, msg)`, `hold(action)` (returns a release function) and `broadcast()` for Realtime. Recorded `calls` and `unexpected` requests are available for assertions.
- **Test accounts:** `ACCOUNTS.player`, `admin`, `mod` (a moderator) and `fresh`.
- **Auth:** `savedSession(acct, expiresIn)` builds a stored session to seed `localStorage` (a negative `expiresIn` gives an expired one). Refresh tokens are `refresh-<id>`; add one to `backend.revoked` to make the server refuse it. `backend.authCalls` lists the grant types requested, and `/auth/v1/signup` answers as with email confirmation on.
- **Fixtures:** `makeHero()`, `bigZone(n)`, `fixedQuest()`, `ADMIN_CHAT`/`ADMIN_REPORTS`.
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
