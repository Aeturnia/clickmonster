# UI modernization: Phase 1 report (foundation and accessibility)

Branch: `claude/ui-phase-1-foundation`. Scope as approved in the Phase 0 review, with decisions 1 to 4 applied. There are no server, API, data-shape or game-rule changes.

## What changed

| Area | Change | Audit findings |
|---|---|---|
| Design tokens | Colour, type scale, spacing, radius, sizing and motion tokens in `:root`. All 57 `font-size: Npx` declarations in `style.css` and every `px` font size in `admin.html` are now `rem`, at the same rendered size with a default 16 px root. | A8, V1 (partly) |
| Contrast | `--faint` changed from `#6f6355` to `#9a8b79`: 4.72:1 or better on every surface, up from 2.67 to 3.38. New `--line-strong` (`#806f5c`, 3.24:1 or better) for the borders of inputs, segmented controls, chips and secondary buttons. Difficulty grey and the "vs" label were raised so they pass even during the victory flash, and the flash was softened. | A1, A2 |
| Battle log | Older lines stay in the dimmer (now AA) colour at 15 px. Recent lines are full text colour. The newest line is 17 px, semi-bold, with a gold left edge, so the difference comes from typography and accent rather than low contrast. | Decision 4, F3 (partly) |
| Focus | One `:focus-visible` style, a 2 px gold-soft outline with offset, inset for rows, map cells, chat lines, tabs and the log. | A10 |
| Dialogs | The bottom sheets (shop, bank, quests, item, level-up) and the chat drawer are native `<dialog>` elements opened with `showModal()`, keeping the bottom-sheet look. **Initial focus:** the sheet heading, or the chat message box. **Containment** and inert background come from the native dialog. **Escape and backdrop tap** dismiss. **On close**, focus returns to the opener, then to its re-rendered equivalent, then to the screen heading if the trigger is gone (for example after selling the item that opened the sheet). In chat, Escape closes an open message menu first. | A3, A4, decision 1 |
| Focus across re-renders | `paint()` remembers the focused control's `data-a`/`data-v`/`id`, plus the caret position for text fields, and moves focus to the replacement. If the control no longer exists: in battle focus goes to Melee; when a battle ends, to Fight again or Continue; otherwise to the screen's heading. | A5, F4 |
| Semantics | Each screen has a visually hidden `<h1>` (`#screen-title`, focusable by script). Landmarks: header, main, aside (chat bar), region (actions), nav. Tabs have `aria-current="page"`, and segmented controls and chips have `aria-pressed`. | A9, A12 |
| Battle log and announcements | The log is focusable (`tabindex=0`), `role="log"`, labelled, and not live itself (`aria-live="off"`). **Announcements are batched per action:** the new lines produced by one action (your attack, the monster's reply, and any result lines such as victory, gold and XP) are joined into one message and sent once through the polite `#sr-status` region. Lines aren't announced individually, and earlier lines aren't repeated. Floating numbers are `aria-hidden` and have a dark backing so they're readable over the bars. | A6, R7 (partly) |
| Map | Each square's accessible name says what is there, for example "You are here. Town: Bramblebrook Meadows Village. Square 5, 5" or "Road to the Overworld, requires level 20. Square 5, 10. Walk here". The current square has `aria-current="location"`, and the map is a labelled group. | A11 |
| Chat | Messages are buttons in a single-tab-stop list. Arrow keys, Home and End move between them, and Enter opens the action menu (Whisper, Ignore, Report, plus Remove for staff). Messages are 28 px tall, up from 22. Send errors appear inline under the box (`role="alert"`, `aria-invalid`) and stay until a message goes through or the player dismisses them. | A4, A15, decision 3 |
| Errors | Errors persist in a stacked region under the HUD (inside an open dialog when one is open) until dismissed or resolved. A later success of the same action clears its error, and any successful request clears connection errors. Different errors don't overwrite each other, and repeats show a count. Successes stay as brief toasts. The newest error has `role="alert"`. | A7, F2, decision 3 |
| Inline validation | The hero name is checked before sending, with the error next to the field and `aria-invalid`/`aria-describedby`, and the server's "name taken" message appears there too. The sign-in message is associated with the fields. The bank amount must be a whole number, shown inline. | Decision 3 |
| Enlarged text | Verified at a 200% root font size: text doubles (16 to 32 px). The dock now wraps, so context actions move above the arrow pad instead of under it, and the HUD wraps so the name is never squeezed to nothing. | A8, R1 (partly), R3 (partly) |
| Admin | `<main>` landmark. Section tabs wrap so none are hidden, with `aria-current` on the active one. Player and top-hero rows contain a real button. Zone rows have an Edit or View button with an accessible name. The four unlabelled editor controls are labelled, and the empty table header has text. Errors persist until dismissed. | A13, A14, R10 |
| Tests | `npm run test:ui`: Playwright plus axe-core (devDependencies, pinned) against a fake backend built on the real engine. | Decision 2 |

## Test results

- `npm test` (engine): **24 / 24 pass**, unchanged.
- `npm run test:ui`: **27 / 27 pass, three consecutive runs** (about 45 s each). There are 20 original tests and 7 added in the review corrections below. They cover:
  - axe with zero serious or critical violations on explore, shop, bank, battle, battle result, hero, gear, map and chat in the game, and on dashboard, players, player editor, zones, zone editor and chat moderation in admin
  - the visible focus ring
  - sheet dialog initial focus, containment over 30 Tab presses, Escape, backdrop, restoration, and the missing-trigger fallback
  - battle focus across re-renders, the log role, label and tab stop, and the batched announcement
  - the log's recent and older distinction without contrast failures
  - the chat dialog: keyboard open, roving messages, the menu, Escape order and restoration
  - inline chat errors persisting until success
  - arrow movement, including not while typing
  - persistent and connection errors
  - inline name validation, with nothing sent to the server
  - 200% text: doubled, no overflow, no overlapping dock controls
  - no horizontal overflow at 320, 375, 768 and 1440 px
  - map labels and keyboard walking
  - reduced motion
  - admin keyboard row navigation, tab visibility on a phone, and persistent admin errors
- **The live backend is never used.** Every test asserts `backend.unexpected` is empty: any request to an unexpected host, including the live Supabase project, is blocked and fails the test. The Realtime websocket is answered by a fake socket. The one network fetch allowed is the pinned `@supabase/supabase-js` module from jsDelivr (the app's own dependency). It's cached in `tests/ui/.cache/` after the first run, so later runs are offline.

### axe before and after

The same 48 captures (16 screens × 320, 390, 1440 px), with the same fixtures, using the WCAG 2.0, 2.1 and 2.2 A/AA rule sets:

| | Before | After |
|---|---|---|
| Captures with serious or critical violations | 39 / 48 | **0 / 48** |
| `color-contrast` (serious) | 39 captures | 0 |
| `label`, `select-name` (critical, admin editor) | 6 | 0 |
| `scrollable-region-focusable` (battle log) | 1 | 0 |

The Phase 0 audit also ran best-practice rules (`region`, `page-has-heading-one`). The CI gate here uses the WCAG rule sets only. Landmarks and headings were still added, and the remaining best-practice notices are left for later phases.

**One documented exclusion:** the floating combat numbers (`.float`) are excluded from axe. They're decorative duplicates of the log, hidden from assistive technology, and gone within a second. Measured mid-fade, their partial opacity reads as low contrast. They now have a solid dark backing.

## Before and after screenshots

These are in `docs/ui-audit/phase-1/`, captured with the same fake data, as `before-*.png` and `after-*.png`:

- `390-explore-town`, `390-battle`, `390-shop-sheet`, `390-chat-drawer`, `320-explore-town`, `390-admin-player`
- `after-390-text-200pct-explore.png` and `after-390-text-200pct-battle.png` show enlarged text.

## Manually exercised flows (scripted in Chromium)

- Keyboard only: sign in, explore, open and close every sheet, buy, start and finish a battle, change tabs, walk on the map, open chat, read and act on a message, send a whisper.
- Touch emulation at 320, 375, 390 and 430 px: the same flows by tapping, including the backdrop tap and the swipe-free close button.
- Text at 200%: explore and battle at 390 px.

## Known limitations and unverified items

**Not verified in this phase (Chromium only):**

- **Safari / iOS.**
  - `<dialog>` with `showModal()` is supported from Safari 15.4, but focus behaviour, VoiceOver announcement of the dialog and `::backdrop` taps were not tested on iOS.
  - The `100dvh`/`72dvh` sizing inside dialogs is untested on iOS.
- **On-screen keyboard.** Not emulated. With the chat dialog open, the iOS and Android keyboards may cover the message box (audit R5). That's scheduled for Phase 2 (sizing with `visualViewport`).
- **Screen readers.** No VoiceOver, TalkBack or NVDA session. Roles, names, live regions and focus order were checked from the DOM and axe, not by listening.
- **Firefox.** Not run.

**Known behaviour changes and trade-offs:**

- **Chat is now modal.** While the chat dialog is open, the game behind it is inert, as is standard for `showModal()`. Before, the drawer covered most of the screen anyway. Errors raised by other actions while chat is open stay in the error region and become visible when chat closes.
- **Vertical space on small phones.** The HUD now wraps the name onto its own line, and at 320 px the town actions stack above the arrow pad instead of overlapping it. That costs about 25 to 30 px at 375 to 390 px. At 320×640, the content area on open ground went from 351 to 276 px (224 px in town). This fixes clipped or overlapping controls and the one-letter name, but leaves less room for the monster list; Phase 2 (R3, R4) restores space.
- **Name truncation.** A name can still truncate if it's wider than the whole HUD row. The full fix, with abbreviated numbers and HUD layout, is in Phase 2 (R1).
- **Still open for Phase 2, required before the mobile modernization is complete:** landscape (R2), the 320 px dock and content area (R3, R4), short-screen chat (R5), large map cells (R6), and the full HUD fix (R1).
- **Double-tap guard.** Battle actions within 250 ms of the previous one are still silently ignored (existing behaviour). Phase 3 will make the pending state visible instead.
- **Destructive confirmations** still use `confirm()` and `prompt()`. A styled confirmation dialog is Phase 3.
- **Running the UI tests elsewhere** needs a Playwright Chromium (`npx playwright install chromium`) plus one network fetch for the supabase-js module, unless `tests/ui/.cache/` is present.

## Review corrections (PR #10, changes requested)

These were addressed in a follow-up commit on the same branch. They're limited corrections: no visual redesign, no game-rule, API, schema or production-dependency changes.

| # | Finding | Correction | Regression tests |
|---|---|---|---|
| 1 | A success toast could stay inside a sheet dialog after a successful action closed that sheet, for example Buy and equip, leaving it hidden. | One owner, `placeOverlays()` in `main.js`, decides where the toast and the problems area live: inside the open modal dialog if there is one, otherwise `<body>`. It runs when either is shown, after every render, and on the `close` event of **every** dialog, so the chat drawer is covered too. | *success message stays visible when the action closes its sheet* (Buy and equip, then the toast is visible under `<body>`, not inside the closed dialog); *success message shown in chat stays visible after chat closes* |
| 2 | Realtime chat updates replaced the chat bar, the channel tabs and the error area wholesale, so whichever had keyboard focus was destroyed. | `setHtml()` in `chat-ui.js` only replaces markup that changed, and then moves focus and the caret to the equivalent control (by `data-c`/`data-v` or `id`), with sensible fallbacks. It's used for the chat bar, channel tabs, message list (including open message-action menus) and error area. The roving tab stop follows the message that owns the focus. | *realtime: a new message keeps focus on the chat bar*; *realtime: focus survives on a channel tab, a message and a menu action*, which also checks that typing continues uninterrupted. Updates are injected through the fake Realtime socket while each control has focus. |
| 3 | The admin `render()` replaced the whole console. Section changes, asynchronous loads and opening a player record dropped keyboard focus. | `render()` now (a) honours an explicit pending focus target once it exists, (b) otherwise refocuses the same control after the re-render, including the caret in text fields, and (c) otherwise falls back to a visually hidden section heading (`#section-title`), never `<body>`. Opening a player moves focus to the record's heading after it loads, and "Back to search" returns focus to that player's link after the list reloads. | Keyboard-only: *switching sections keeps focus on the section tab through async loading*; *opening a player moves focus to the record, Back returns to the row*; *searching keeps focus and caret in the search box* |
| 4 | The report said each line was announced once; the code batches each action's lines. | Report corrected (see the Battle log row above). The behaviour is unchanged: batching gives one coherent message per turn and avoids a burst of polite announcements. | Existing battle test |

**Verification:**

- All 7 new tests were run against the uncorrected Phase 1 code and **all 7 failed**. With the corrections they pass.
- `npm test`: 24 / 24.
- `npm run test:ui`: 27 / 27 in three consecutive runs.
- The 48-capture axe sweep (`tools/ui-shots.mjs`, 320, 390 and 1440 px) has **0 serious or critical violations, and 0 violations of any impact**, on the WCAG A/AA rule sets.
- No test made a request outside the fake backend.
