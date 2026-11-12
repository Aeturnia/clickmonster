# ClickMonster: notes for Claude

A text-based multiplayer fantasy RPG for mobile browsers.
- **Frontend:** vanilla JS ES modules in `public/`, no build step. Netlify publishes that folder.
- **Backend:** Supabase. It provides auth, Postgres with RLS, Realtime, and two edge functions: `game` (server-authoritative) and `admin` (staff API).
- **Players:** pick a race, raise uncapped stats, fight in level-gated grid zones, collect gold, gems and relic gear, and chat. Some zones allow PvP.

Read these first:
- `README.md`: features, architecture, layout, commands and deploying.
- `docs/ui-modernization-audit.md`: the Phase 0 audit and the phase plan.
- `docs/ui-phase-1-report.md` … `docs/ui-phase-4-report.md`: what each phase changed, its acceptance criteria, deviations and the review corrections.
- `docs/backlog.md`: agreed but unscheduled work (desktop layout, layout picker, sign-in news).

## Where things stand (handoff, 2026-11-12)

- **`main`:** the game, the admin console, chat, and UI modernization Phases 1–3. Phase 1 is the foundation and accessibility work, Phase 2 the responsive layout, Phase 3 interaction feedback and confirmations.
- **Phase 4 (admin console) is open as PR #13** on `claude/ui-phase-4-admin`, waiting for independent review. If the review asks for changes, fix them on that branch and PR.
- **Don't start the next milestone** until the owner approves it.
- **Likely next:** the desktop layout and the desktop/mobile choice in `docs/backlog.md`. The owner wants to design these at the desktop.

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

- **The engine runs on both sides.** `public/js/engine` and `public/js/data` are shared with the edge functions through symlinks (`supabase/functions/{game,admin}/js -> ../../../public/js`). After changing either, redeploy the functions (`npm run deploy:functions`, which needs `SUPABASE_ACCESS_TOKEN`, a Supabase personal access token, in your environment) so server and client agree.
- **Zones** live in the `zones` table, edited in the admin console. `loadZones()` replaces the live `ZONES`/`MONSTERS` registries in place. The built-ins in `data/zones.js` seed it and are the fallback.
- **Game UI** is `public/js/main.js`:
  - `render()` paints regions with `paint(id, html)`, which keeps focus by key (`focusKey`: `id` or `data-a` + `data-v`).
  - Actions go through one delegated click handler. `handleLocal` covers view-only actions; `remoteCall`/`runRemote` call the server.
  - The pending state is tracked by key (`ui.pendingKey`, `markPending()`).
  - Toasts and alerts are re-homed into the topmost open dialog (`placeOverlays()`).
- **Chat** is `chat-ui.js`. **Admin** is `admin.js` and `admin-zones.js`: grouped navigation with hash routes, `dataTable()`, `field()`, `checkForm`/`validate`/`submitting`, and form values kept across re-renders.
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
npm test                 # engine (24)
npm run test:ui          # browser UI tests: Playwright + axe, against a fake backend (68 on the Phase 4 branch)
npx playwright install chromium   # once
```

**`tests/ui/harness.mjs`** answers every Supabase request with a fake backend built on the real engine. Any other host fails the test, and the supabase-js CDN module is cached in `tests/ui/.cache`. It provides:
- **`FakeBackend({ hero, players, chat, events, zones, quests, reports })`**: `failNext(action, status, msg)`, `hold(action)` (returns a release function) and `broadcast()` for Realtime. Recorded `calls` and `unexpected` requests are available for assertions.
- **Test accounts:** `ACCOUNTS.player`, `admin`, `mod` (a moderator) and `fresh`.
- **Fixtures:** `makeHero()`, `bigZone(n)`, `fixedQuest()`, `ADMIN_CHAT`/`ADMIN_REPORTS`.
- **Keyboard:** `fakeKeyboard()` / `setKeyboard(px, pan)` simulate an iOS-style overlay keyboard.
- **Navigation and pages:** `adminTab()` opens admin sections on phones. `page.nativeDialogs` records any native dialog.

**Measuring tools**, all on the fake backend:
- `tools/ui-metrics.mjs` (game layout numbers);
- `tools/ui-shots.mjs` (screens plus axe);
- `tools/ui-states.mjs` (interaction states);
- `tools/admin-shots.mjs` (admin at 320, 390, 768, 1024 and 1440).

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
