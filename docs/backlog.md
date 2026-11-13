# Backlog

Planned work that is not yet scheduled into a phase. Each item names what it builds on.

## Pre-release verification (required before a release)

The UI modernization (Phases 1–4) was tested in Chromium only, against a fake backend. These checks were not done in any phase and must be done before release. They are verification, not new features. Each item comes from a phase report's "Not verified" section.

**Real devices and other browsers** (iOS Safari, Android Chrome, desktop Firefox and Safari; Firefox was never run):
- Native `<dialog>`: focus behaviour, `::backdrop` taps, and `dvh` sizing inside dialogs (Phase 1).
- On-screen keyboards with `visualViewport`, `interactive-widget` on Android, safe-area insets on notched phones in landscape, and touch panning of the map frame (Phase 2).
- Type-to-confirm with autocorrect on phone keyboards, and haptics on refused taps (Phase 3).
- Admin console: the sticky zone save bar with the keyboard open, table cards and the phone navigation (Phase 4).

**The owner's actual browser viewport** (`innerWidth × innerHeight` and `devicePixelRatio`, measured in their normal window). Add it to the desktop measurements and screenshots; 1920×1080 has stood in for it.

**Input methods and keyboards:** the desktop shortcuts (D-3) with real input-method composition (Japanese, Chinese, Korean) and non-US keyboards such as AZERTY, on real hardware. Composition was only simulated with synthetic events.

**Screen readers** (VoiceOver, TalkBack, NVDA). Names, roles and live regions were only checked in the DOM and with axe. Also check keyboard navigation with the desktop shortcuts: in browse mode, screen readers take single-letter keys for themselves, and `aria-keyshortcuts` was only checked in the DOM.
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
- **Desktop chat (D-2):** sign out and sign in as another account in the same page with live Realtime, and check that nothing carries over: drafts, whisper recipient, unread counts, late messages, open confirmations.
  - The tests use the fake backend. Late Realtime events were simulated by calling the old subscription's callbacks, because the harness could not deliver one during `removeChannel()`.
  - Also check a failed send while the window crosses 1280px.

## Desktop layout (done)

Built in phases D-1 to D-3 and merged on 2026-11-13. See `docs/desktop-scope.md` and the three D reports. What remains from that scope is below and is not approved: the layout picker, wider desktop sheets, and the possible rename to "Monstra Regna".

## Layout choice: desktop or mobile

- **Since the desktop milestone:** the layout is already a single state, `#app[data-layout]`, set by `layout.js`, and the CSS keys off it. A picker would force that state, falling back when there isn't room. The notes below predate that.
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
