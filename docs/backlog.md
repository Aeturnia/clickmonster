# Backlog

Planned work that is not yet scheduled into a phase. Each item names what it builds on.

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
