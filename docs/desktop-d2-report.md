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

## Review corrections (PR #19 review)

The review accepted D-2's layout and interaction design at `73be88b` and asked for two corrections to the chat state's lifecycle. Both are in `chat-ui.js` only. No server endpoint, schema, permission, dependency or new chat structure was added.

**D2-01: chat state survived sign-out.**
- *Cause:* `stop()` emptied the messages and unread counts but kept the D-2 draft fields (`draft`, `draftTo`) and older account-specific state: the whisper recipient, the open menu, the error, the channel tab, the ignore list, the role and the zone. The drawer's and panel's markup also stayed until the next paint. So after signing out and signing in as someone else in the same page, the next account could see the previous one's unsent message, whisper recipient or error.
  - Separately, a request that was still waiting at sign-out could still write when it finished. That covers a failed send, a channel load, or a menu action (ignore, report, remove).
- *Fix:*
  - `stop()` starts a new chat session. It resets the draft, recipient, menu, error, tab, ignore list, role, zone and the identity of whoever is signed in. It closes the drawer and empties both the drawer and the panel.
  - The drawer-or-panel choice and visibility belong to the layout, not the account, and are kept. Drafts still carry over between panel and drawer within a session.
  - Every awaited step checks, when it returns, that its session is still the current one: `start()` (it doesn't subscribe if you signed out meanwhile), the channel, news and meta loads, `setZone()`, `send()`, and the ignore, unignore, report and remove actions. A result from an earlier account is dropped.
- *Tests:*
  - "D2-01 signing out and in as another account in the same page keeps nothing from the first":
    - The first account is set up with a whisper draft to Musa, a failed send (so an error shows), then the Global tab with a message menu open.
    - It signs out from the Hero screen and signs in as the moderator through the form. The test checks that the page didn't reload.
    - The panel then shows Global, an empty message box, no error and no menu. The Whispers tab has an empty recipient. After narrowing to 1240, the drawer is empty too.
  - "D2-01 a send still pending at sign-out cannot touch the next account": the first account's send is held and set to fail, and the account changes. The second account types "hello", then the old send fails. Nothing comes back: no error, the text "hello" is untouched, and focus and caret stay in the second account's message box.

**D2-02: a failed send could be lost during a resize.**
- *Cause:* `send()` kept the message-box element it read before waiting for the server. If the window crossed 1280px meanwhile, `setMode()` replaced the drawer or panel. On failure, the text and focus went to the old, detached element, so the visible box stayed empty.
- *Fix:*
  - When the request fails, `send()` restores the text in the message box that is showing **now**, puts the error in the current drawer or panel, and keeps the text as the draft.
  - It puts focus and the caret (at the end) back in the box only if focus is still in chat, or nowhere. If you have gone back to the game, focus stays where you put it.
  - If chat isn't showing (the drawer is closed), the text and error wait as the draft and appear when you open it.
  - A send from an earlier session does nothing (D2-01).
  - A successful send is unchanged: the box empties and the error clears.
- *Tests:*
  - "D2-02 a failed send is restored in the drawer after the panel gave way to it": typed in the panel at 1440, sent and held, narrowed to 1240 (the drawer opens), then the send fails. The drawer's box shows "Hello world" with focus and the caret at the end, and the error is in the drawer. Axe passes, and the retry succeeds and clears the error.
  - "D2-02 … in the panel after the drawer gave way to it": the same from the drawer at 1240 to the panel at 1440. The drawer closes, and the text, error, focus and caret are in the panel. Axe passes, and the retry succeeds.
  - "D2-02 a failed send comes back without taking focus from the game": while the send is held, focus moves to a monster row. On failure the text is back in the panel and focus stays on the monster row. The retry succeeds.

### Results (corrections)

All on this laptop, Chromium, fake backend.

- **Suites:** `npm test` 24/24 and `npm run test:ui` **108/108 in each of 3 consecutive full runs**. That is the 103-test baseline plus 5 new tests.
- **New tests against the reviewed commit** (`UI_PUBLIC_DIR` set to the `73be88b` checkout): **all 5 fail, each on the defect it targets:**
  - account switch: the second account's panel shows the first account's draft "meet at the mill", its error, and an open menu;
  - pending send: the first account's failed send puts its error into the second account's chat;
  - panel to drawer: the visible box stays empty (the text went to the detached element), with the caret at 0;
  - drawer to panel: the same;
  - focus: the failed send pulls focus away from the monster row into the message box.
- **Desktop accessibility sweep** (`tools/ui-shots.mjs` at 1024×768, 1240×800, 1280×720, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080 and 2560×1440): **0 violations of any impact on 117 captures.** That includes the chat panel at the 7 sizes from 1280 and the drawer at 1024 and 1240. Raw data: `docs/ui-audit/desktop/axe-after-d2-corrections.json`.
- **The affected chat states:** a failed send restored with its error, in the drawer and in the panel, is axe-checked inside the new tests, with 0 violations. No screenshots were retaken, because the corrections don't change how anything looks.

### Not verified (corrections)

- A real Supabase sign-out and sign-in, and a real failed send. Both were exercised against the fake backend only.
- Screen readers announcing the restored error.
