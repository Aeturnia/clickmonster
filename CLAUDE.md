# ClickMonster: notes for Claude

A text-based multiplayer fantasy RPG for mobile browsers.
- **Frontend:** vanilla JS ES modules in `public/`, no build step. Netlify publishes that folder.
- **Backend:** Supabase. It provides auth, Postgres with RLS, Realtime, and two edge functions: `game` (server-authoritative) and `admin` (staff API).
- **Players:** pick a race, raise uncapped stats, fight in level-gated grid zones, collect gold, gems and relic gear, and chat. Some zones allow PvP.

Read these first:
- `README.md`: features, architecture, layout, commands and deploying.
- `docs/ui-modernization-audit.md`: the Phase 0 audit and the phase plan.
- `docs/ui-phase-1-report.md` … `docs/ui-phase-4-report.md`: what each phase changed, its acceptance criteria, deviations and the review corrections.
- `docs/backlog.md`: agreed but unscheduled work (desktop layout, layout picker, sign-in news), and the pre-release verification still owed (real devices, screen readers, live-backend staging).

## Where things stand (2026-11-13)

- **UI modernization Phases 1–4 are complete and merged into `main`.** Phase 4 (the admin console) was approved in its final independent review at `a8d9dc6` and merged as PR #13 (`baa75d9`). All four review findings, P4-01 to P4-04, are closed.
- **The desktop layout milestone is complete and merged into `main`** (2026-11-13). It was scoped in `docs/desktop-scope.md` (PR #17), with the owner's decisions in its section 4.
  - **D-1, the desktop frame:** merged as PR #18. See `docs/desktop-d1-report.md`.
  - **D-2, the persistent chat panel:** merged as PR #19 (`672a81a`). Findings D2-01 to D2-03 are closed. See `docs/desktop-d2-report.md`.
  - **D-3, keyboard shortcuts:** merged as PR #21 (`d567be2`), approved with no corrections. See `docs/desktop-d3-report.md`.
  - **Separate, and not approved:** the layout picker, wider desktop sheets, and the possible rename to "Monstra Regna", which is a working title only. None of them is to be started without the owner's approval.
- **Landing page: the scope is approved and merged** (PR #23, `e385e38`, 2026-11-13). `docs/landing-scope.md` is the implementation contract for L-1 to L-4, covering the entrance, the interface picker and public news.
  - **No phase is authorized.** L-1 starts only when the owner separately authorizes it.
  - **Not authorized either:** code or server changes, migrations, deploys, or the rename.
  - **Implementation gates still open:**
    - L-1 validates the vendored Supabase UMD build before it replaces the CDN client;
    - L-3 needs the local Supabase stack running before any production change.
  - **Every question in section 5 is decided.** The main ones:
    - a Netlify Edge Function for article pages, uncached at first;
    - Supabase's UMD build vendored into `public/vendor/`;
    - four PRs, L-1 to L-4;
    - article bodies of paragraphs and bullet lists.
  - **Review corrections** are recorded in section 12:
    - no gameplay download for anonymous visitors;
    - one Supabase client owned by `net.js`;
    - the local RLS tests and production gate in L-3.
- **Development moved to the owner's Windows laptop.** `npm run deploy:functions` now runs from any shell (PR #15) and needs `SUPABASE_ACCESS_TOKEN` set in the environment.
- **Landing page L-1 (the entrance) is implemented** on its own branch and PR, awaiting independent review. See `docs/landing-l1-report.md`. The scope was approved and merged as PR #23 (`e385e38`). L-2 and later phases are not authorized.
- **Don't start another milestone, or make gameplay or server changes,** until the owner approves it. There is no approved next milestone.
- **Before a release:** the pre-release verification in `docs/backlog.md` is still owed:
  - real devices and other browsers (including Firefox and Safari on desktop);
  - screen readers, including keyboard navigation with the shortcuts;
  - input methods and non-US keyboards;
  - the owner's actual browser viewport;
  - live-backend staging, including chat session changes and Realtime.

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
- **Keyboard shortcuts** (desktop only) are the `SHORTCUTS` table in `main.js`. The same table drives `shortcut()` and the `?` list (`sheetKeys()`).
  - A shortcut presses the existing button, and `markShortcuts()` adds `aria-keyshortcuts` after every render.
  - The off setting is `prefs.keys`.
  - The keydown handler checks `defaultPrevented` first, so keys that chat already handled are left alone.
- **Chat** is `chat-ui.js`. It draws one chat state into the drawer or the desktop panel (`setMode()`).
  - Each sign-in is a chat session. `stop()` resets everything that belongs to the account. Anything awaited, including Realtime callbacks and confirmations, checks on return that its session is still current.
- **Admin** is `admin.js` and `admin-zones.js`: grouped navigation with hash routes, `dataTable()`, `field()`, `checkForm`/`validate`/`submitting`, and form values kept across re-renders.
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
npm test                 # engine, plus the entrance file checks (28)
npm run test:ui          # browser UI tests: Playwright + axe, against a fake backend (146)
npx playwright install chromium   # once
```

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
- **Database:** add a new file in `supabase/migrations/`, then `supabase db push` or the SQL editor. The Supabase project URL is in `public/js/config.js`.
