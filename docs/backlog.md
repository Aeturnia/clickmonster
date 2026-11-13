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

**The entrance (landing L-1)** was tested in Chromium against the fake backend only:
- **The vendored supabase-js 2.45.4** has never talked to the live project. Check sign-in, sign-up with a real confirmation email, session restore, token refresh, a revoked session, edge functions and Realtime chat on the live site.
- **Netlify:** check that `/vendor/supabase-js@2.45.4/` is served, with its long `immutable` cache header.
- **Real phones on mobile networks:** time to the sign-in form. The harness timing (0.67 s) is an underestimate.
- **Password managers and browser autofill** on the new form, and the reload-on-retry after a failed game download in browsers other than Chromium.

**The interface choice (landing L-2)** was tested in Chromium only:
- forced Desktop on a real touch tablet;
- browser zoom with Desktop forced (200% text size and resizing were tested);
- how screen readers announce the radio group and the polite note;
- other browsers.

## Follow-ups (not blocking)

- **The entrance's startup budget** (landing LAC-2: at most 30 KB decoded before the sign-in form) is at 29.8 KB after L-2.
  - L-4's news list will need room.
  - About half of `index.html`, `entry.css` and `entry.js` is comments, which could be trimmed. Otherwise, revisit the budget with the owner.

- **Queued battle effects across an account change** (from the L-1 final review).
  - `playEffects()` in `main.js` schedules battle animations with `setTimeout`. The timers aren't tied to the game session (`gameGen`).
  - If a battle ends and the account changes at once, a remaining animation could run on the next account's screen. It can't change hero or server state; it would be a brief visual glitch.
  - Fix by checking `live(g)` in the callbacks, or clearing the timers in `stop()`.
  - Add a test that signs out while effects are queued.

## Desktop layout (done)

Built in phases D-1 to D-3 and merged on 2026-11-13. See `docs/desktop-scope.md` and the three D reports. The layout picker from that scope was built as landing phase L-2. Still not approved: wider desktop sheets, and the possible rename to "Monstra Regna".

## Layout choice: desktop or mobile (done)

Built in landing phase L-2 and merged as PR #27 on 2026-11-13. See `docs/landing-l2-report.md`. Its checks still owed are in the pre-release list above.

## Password recovery

Raised in the landing-page scope review (2026-11-13, Q14). It is tracked separately from that milestone, as a higher-priority account-reliability item, and is not yet scheduled.

- **Today:** there is no way to reset a forgotten password. A player who forgets it loses access to their hero.
- **Needs:**
  - a "Forgot password" request from the entrance;
  - Supabase's reset email, with its redirect URL and email template configured;
  - a page to set the new password;
  - tests on the fake backend.
- **Fits with the entrance** (L-1), but isn't part of it unless the owner schedules it.

## News and updates on the sign-in page

Now scoped as phases L-3 and L-4 of the landing page: see `docs/landing-scope.md` (not yet authorized). The notes below are the original backlog entry.

- The sign-in page (`viewAuth`) shows recent news and game updates before signing in.
- Today's announcements (`world_config`) and world events (`events`) are readable only by signed-in players (row-level security `to authenticated`). Options:
  1. a new `news` table (title, body, published_at, author) with a public read policy for published rows, edited from the admin console; or
  2. a narrow anonymous read policy on announcements only.
  Option 1 keeps player-facing events private and gives staff a proper editor; it is the recommended one.
- Admin console: a News section to write, preview, publish and unpublish posts, logged in `admin_log`.
- Keep the sign-in form first in the reading order on phones; news follows it (or sits beside it on desktop).
- Plain text with paragraphs, no links, consistent with the chat link policy. No external images.
