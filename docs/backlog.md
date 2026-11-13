# Backlog

Planned work that is not yet scheduled into a phase. Each item names what it builds on.

## Pre-release verification (required before a release)

The UI modernization (Phases 1–4) was tested in Chromium only, against a fake backend. These checks were not done in any phase and must be done before release. They are verification, not new features. Each item comes from a phase report's "Not verified" section.

**Real devices** (iOS Safari, Android Chrome; also Firefox, which was never run):
- Native `<dialog>`: focus behaviour, `::backdrop` taps, and `dvh` sizing inside dialogs (Phase 1).
- On-screen keyboards with `visualViewport`, `interactive-widget` on Android, safe-area insets on notched phones in landscape, and touch panning of the map frame (Phase 2).
- Type-to-confirm with autocorrect on phone keyboards, and haptics on refused taps (Phase 3).
- Admin console: the sticky zone save bar with the keyboard open, table cards and the phone navigation (Phase 4).

**Screen readers** (VoiceOver, TalkBack, NVDA). Names, roles and live regions were only checked in the DOM and with axe:
- Game: the dialogs and `alertdialog` confirmations, `role="status"` toasts, the roving map and the shortened amounts (Phases 1–3).
- Admin console:
  - the group switcher, review panel and table cards;
  - the zone editor's live save note;
  - `aria-busy` on pending buttons, the "Still working" toast and the locked zone draft (Phase 4 and its corrections).

**Live-backend staging:**
- Run the admin and game flows against a staging Supabase project, not the fake backend.
- In particular, check that a pending admin action sends one request and writes one `admin_log` entry. The fake backend models the server's audit behaviour, which was read from `supabase/functions/admin/index.ts`, not observed.
- Check zone save, delete and restore with real players in the zone.
- Check the moderation flow with real reports.
- Check real staff data volumes, such as many reports or a long audit log.

## Desktop layout

To be designed at a desktop, after the UI modernization phases.

- A layout made for large screens and mouse/keyboard play, rather than the phone layout stretched.
- Starting point: the Phase 2 two-column layout (`@media (min-width: 900px)` in `public/css/style.css`) and its 1024×768 and 1440×900 tests in `tests/ui/responsive.test.mjs`.
- Use the empty side-column space on tall screens. Candidates: a minimap of the current zone, inline chat instead of the drawer, quest and event notices.
- Acceptance criteria and before/after measurements as in Phase 2 (`tools/ui-metrics.mjs`).

## Layout choice: desktop or mobile

- A choice on the sign-in page: **Automatic** (default, by screen size as now), **Desktop** or **Mobile**.
- Implement it as a class on `#app` (for example `layout-desktop` / `layout-mobile`) that overrides the media queries. With no class set, the media queries keep deciding.
- Save it in the local preferences (`clickmonster.prefs` in `main.js`, alongside `leftHanded`), and also offer it on the Hero screen so it can be changed after signing in.
- The control must be labelled and keyboard reachable, and announce the active layout. Add tests for each forced layout at a phone and a desktop size.

## News and updates on the sign-in page

- The sign-in page (`viewAuth`) shows recent news and game updates before signing in.
- Today's announcements (`world_config`) and world events (`events`) are readable only by signed-in players (row-level security `to authenticated`). Options:
  1. a new `news` table (title, body, published_at, author) with a public read policy for published rows, edited from the admin console; or
  2. a narrow anonymous read policy on announcements only.
  Option 1 keeps player-facing events private and gives staff a proper editor; it is the recommended one.
- Admin console: a News section to write, preview, publish and unpublish posts, logged in `admin_log`.
- Keep the sign-in form first in the reading order on phones; news follows it (or sits beside it on desktop).
- Plain text with paragraphs, no links, consistent with the chat link policy. No external images.
