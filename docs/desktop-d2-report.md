# Desktop layout — phase D-2 report: persistent chat panel

Branch `claude/desktop-d2`, based on `main` at `f62d729`, with D-1 merged.

The scope and acceptance criteria are in `docs/desktop-scope.md`. D-2 adds the persistent chat panel. Keyboard shortcuts (D-3) are not started.

No game rules, server code, schema, API, chat permissions, moderation behaviour or dependencies changed.

## Summary

- **From 1280px (80em), on desktop, chat is a panel in the side column.**
  - It sits under the quests-and-events summary and the minimap, and takes the column's remaining height.
  - It is an `aside` landmark named by its visible heading, "Chat". It has the same channel tabs (Global, Zone, Whispers), message list, error area and message box as the drawer, with no Close button.
  - **It is non-modal.** The game is never inert: you can type, fight, change equipment and move with chat on screen.
  - **Live messages never move focus.** Focus stays on the message box (with its caret), a battle action or a gear row.
  - **Unread counts update quietly.** The channel on show counts nothing; others count on their tab. The list stays `aria-live="off"`, as in the drawer, so messages aren't announced over the game.
  - The chat line is not shown while the panel is mounted.
- **From 1200 to 1279px:** the desktop layout keeps the chat line and modal drawer, as decided.
- **One chat state, two places to show it.**
  - `chat-ui.js` draws the same controls into the drawer or the panel (`setMode()`), and its handlers act on whichever is showing.
  - What is typed (message and whisper target), the channel and the unread counts carry over between them.
  - **If you were using chat when the window crossed 1280px,** focus and the caret follow it. The drawer opens for that when narrowing, and closes when widening again.
  - **If you weren't,** the drawer stays closed and focus stays where it was.
- **Chat comes before the minimap.**
  - The panel never gets less than 18rem; the summary and minimap give way first and scroll inside themselves.
  - Below 56em tall the minimap shows as text only (from D-1).
  - At 1280×720 and 1366×768 the message box is on screen, with room for 16 and 18 lines. That still holds with 2 world events and 3 hunts in the summary. Nothing on the page needs scrolling.
- **Same message menus as the drawer:** Whisper, Ignore and Report for a player, and Remove for staff. They use the same confirmations, and Escape closes an open menu. Whisper switches the panel to Whispers with the name filled in, without opening a drawer.
- **Layout state:** `layout.js` adds `#app[data-chat="panel" | "drawer"]` beside `data-layout`. Like the desktop condition, the panel condition uses an `em` media query and the usable width in rem, so larger text falls back to the drawer.

## Acceptance criteria (D-2)

Measured with `tools/desktop-metrics.mjs` (raw data: `docs/ui-audit/desktop/metrics-after-d1.json` before, `metrics-after-d2.json` after) and the tests in `tests/ui/desktop-chat.test.mjs`. "Before" is `main` at `f62d729`.

| AC | Criterion | Before (D-1) | After |
|---|---|---|---|
| DAC-8 | The side column is used: no empty band taller than 120px on Explore from 1280×800 to 1920×1080 | 394–606px | **0px** at every size from 1280×720 to 2560×1440 (test: ≤ 120 at 1280×800 and 1920×1080) |
| DAC-9 | Non-modal chat from 1280px: the game usable while reading or typing; an incoming message leaves focus and caret on the message box, a battle action or a gear row | drawer only (game inert while open) | met (test "the game stays usable while chatting") |
| DAC-10 | Short laptops: message box on screen, at least 6 lines of messages, minimap as text or hidden, no page scroll | no persistent chat | 1280×720: 16 lines; 1366×768: 18 lines; also with 2 events and 3 hunts (test) |
| DAC-11 | 1200–1279px: desktop layout with the drawer; 1280px+: the panel; switching keeps draft, channel, unread counts, focus and caret | — | met (tests at 1240 and 1440, and across a resize both ways) |
| DAC-14 | No sideways page scrolling | none | none (screens and tests) |
| DAC-15 | axe, all impacts | 0 | **0 violations on 117 captures** (13 screens × 9 sizes: 1024×768, 1240×800, 1280×720, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440; the chat scene is the panel at the 7 sizes from 1280 and the drawer at 1024 and 1240), and the axe checks inside the new tests (panel, drawer at 1240, a busy side column at 1280×720, the summary with events and hunts) |
| DAC-16 | No game, server, schema or API change; chat permissions and moderation unchanged | — | none; the same server actions and confirmations are used |

**Side-summary data (requested in the D-1 review).**
- The fake backend now serves world events and world-boss hunts (`worldEvents` and `activeHunts`).
- A test checks the exact summary lines: "Harvest Moon: Experience x2, Gold x1.5. 2h …m left." and "World boss: The Ashen Colossus in Ashford Vale, 68% health. 5h …m left.". It also checks that Explore doesn't repeat the event on desktop, and still shows it on a phone.
- This covers D-1 behaviour, so the test also passes on `main`. To show it can fail, it was run against a copy with the hunt lines removed, and it did fail.

## Tests

Evidence: `docs/ui-audit/desktop/after-d2-*.png`, `axe-after-d2.json` and `metrics-after-d2.json`.

- **`tests/ui/desktop-chat.test.mjs`, new tests:**
  - the panel at 1280×800 and 1920×1080 (landmark, controls, no chat line or drawer, side column used, axe);
  - the game usable while chatting, with focus and caret kept through live messages;
  - sending and the message menus in the panel, with Escape;
  - moderators removing a message from the panel;
  - the drawer at 1240;
  - moving between panel and drawer;
  - short laptops;
  - the summary with events and hunts.
- **Against `main` (D-1):**
  - **The five panel tests fail** at setup, because there is no panel.
  - **The drawer test at 1240** fails only because the `#chatpanel` element doesn't exist there. The drawer behaviour it checks was already present; it is a regression guard.
  - **The summary test passes**, as explained above.
- **The full suites** (this laptop, Chromium, fake backend): `npm test` 24/24 and `npm run test:ui` **103/103 in each of 3 consecutive full runs** (95 earlier tests plus 8 new).

### Found and fixed during D-2

- **An empty panel took up space between 1200 and 1279px.** Measuring at 1240×800 showed it: the empty panel still claimed 18rem of the side column there. The panel's styles now apply only when it is mounted (`data-chat="panel"`) and drawn. The 1240 test checks that no panel shows.

### Tools

- **`tools/desktop-metrics.mjs`:** `sideEmpty` with the panel mounted (the space left below the side column's last block), `chatPanel`, `chatInputInView` and `chatLines`. Rerun on `main`, it reproduces the committed D-1 numbers exactly: 0 differences.
- **`tools/ui-shots.mjs`:** with the panel mounted, the chat scene captures the panel with focus in its message box (`chat-panel`), instead of opening the drawer.

## What changed

- **`public/js/chat-ui.js`:**
  - the drawer or the panel as the host (`docked()`, `showing()`, `host()`);
  - `paintChat()` replaces `paintDrawer()`;
  - `setMode()`, and the draft and whisper target kept in state;
  - Escape and arrow keys in the panel.
- **`public/js/layout.js`:** the `data-chat` state and the 80em / 80rem panel condition, passed to `main.js`.
- **`public/js/main.js`:** `watchLayout()` calls `chat.setMode()`.
- **`public/index.html`:** `<aside id="chatpanel" aria-labelledby="chatpanel-h">` in the side column.
- **`public/css/style.css`:** the panel in the side column. The summary and minimap shrink first, and the panel keeps at least 18rem.
- **`tests/ui/harness.mjs`:** the `worldEvents` and `activeHunts` options.

## Not verified

- **Screen readers:** the panel landmark, the quiet unread counts, and focus staying put when messages arrive. Checked in the DOM and by axe only.
- **Real devices and other browsers:** Firefox, Safari, and real Realtime traffic. Messages come from the fake backend's broadcast.
- **Heavy chat traffic:** many messages a second while typing. Each message is a single tested broadcast.
- **The owner's own viewport.** Still unmeasured; 1920×1080 stands in.
