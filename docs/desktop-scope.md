# Desktop layout: scope

The scoping step for the backlog items "Desktop layout" and "Layout choice: desktop or mobile" (`docs/backlog.md`). It works the way the Phase 0 audit did: evidence, findings, the owner's direction, constraints, acceptance criteria and phasing. The owner's decisions are recorded in section 4. Implementation follows in phases D-1 to D-3, each reviewed separately.

> **Guiding principle (owner):** design the desktop interface for simultaneous awareness, not simply more visible controls. Gameplay remains dominant; quests, location, and conversation provide persistent context without interrupting it.

## 1. Method and limits

- **Sizes:**
  - 1024×768 (small laptop, and an iPad in landscape);
  - 1280×800;
  - 1366×768 and 1536×864 (common Windows laptops with display scaling);
  - 1440×900;
  - 1920×1080;
  - 2560×1440.
- **Setup:** Chromium (Playwright 1.63.0), the UI test harness's fake backend, a level 12 hero, and Bramblebrook Meadows (8 monsters). Not tested: Firefox, Safari, real devices, browser zoom, text scaling, and touch screens at these widths.
- **Screens:** `tools/ui-shots.mjs` captured 13 game screens at each of the 7 sizes, 91 captures in all, in `docs/ui-audit/desktop/before-*.png`. Axe-core 4.10.2, at all impacts, found **0 violations on all 91** (`axe-before.json`).
- **Metrics:** `tools/desktop-metrics.mjs`, whose definitions are at the top of the file. The raw data is in `metrics-before.json`. Later phases can rerun it with `UI_PUBLIC_DIR` to measure a change the same way.
  - Explore is measured standing in the village.
  - Battle is measured at the start of a fight. The log grows as a fight goes on, so the distance from the log to the action buttons is at its largest at that point.
  - Monster-row counts are left out: the test zone has only 8 monsters, so they measure the fixture, not the space.
- Admin pages are out of scope; the console has its own desktop layout from Phase 4.

## 2. Current desktop layout

From 900px wide (`style.css:489`), the game uses the Phase 2 two-column grid:

```
#app (max-width 1280px, centred)
+---------------------------------------+----------------------+
| #main  the screen (Explore, Battle,   | #top   hero bar      |
|        Hero, Gear, Map); its blocks   |                      |
|        are capped at 760px and        |   (empty)            |
|        left-aligned                   |                      |
|                                       | #chatbar latest line |
|                                       | #dock  actions/arrows|
|                                       | #nav   4 screen tabs |
+---------------------------------------+----------------------+
#sheet and #chat are modal dialogs above everything.
```

The DOM, reading and tab order is: hero, screen, chat line, actions, tabs. The arrow keys move the hero on the Explore screen (`main.js:1445`), and the map has its own arrow-key navigation.

| Size | App width (share of window) | Content width | Gap from content to side column | Empty height in the side column | Empty space below Explore content | Battle: log to actions |
|---|---|---|---|---|---|---|
| 1024×768 | 1024 (100%) | 622 | 17 | 504 | 66 | 613 |
| 1280×800 | 1280 (100%) | 760 | 104 | 536 | 98 | 724 |
| 1366×768 | 1280 (94%) | 760 | 104 | 504 | 66 | 703 |
| 1440×900 | 1280 (89%) | 760 | 104 | 636 | 198 | 793 |
| 1536×864 | 1280 (83%) | 760 | 104 | 600 | 162 | 768 |
| 1920×1080 | 1280 (67%) | 760 | 104 | 816 | 378 | 932 |
| 2560×1440 | 1280 (50%) | 760 | 104 | 1,176 | 738 | 1,243 |

All values are in CSS pixels. Body text is 16px at every size. The content widths were corrected by 1px during D-1: the first version of the tool counted the screen-reader-only heading.

## 3. Findings

- **D1. The side column is mostly empty.**
  - The hero bar sits at the top and the chat line, actions and tabs at the bottom, with 504–1,176px of nothing between them.
  - The space grows with the screen: it is 2.3× larger at 2560×1440 than at 1366×768.
- **D2. Large screens use a shrinking share of the width.** `#app` stops at 1280px. At 1920 the game uses 67% of the width, and at 2560 only 50%.
- **D3. The screen's content floats left in its column.**
  - Blocks are capped at 760px for readable lines, but they are left-aligned.
  - That leaves a 104px gap before the side column at every width from 1280. At 2560 there is also 738px of empty space below the Explore content.
- **D4. In battle, the actions are far from the fight.**
  - The log and the result are top-left, and Melee, Cast and Flee (or Fight again and Continue) are bottom-right.
  - The distance at the start of a fight is 613px at 1024 and 703–932px at laptop and desktop sizes, rising to 1,243px at 2560.
  - On a phone the actions sit right under the log.
- **D5. Text doesn't scale.** Body text is 16px from 1024 to 2560 wide.
- **D6. Chat is a modal drawer on every screen size.** While chat is open the game is inert. You can't watch a fight, move or check your gear while reading or typing.
- **D7. The screen tabs are in the bottom-right corner.** That suits a thumb on a phone, but it is an unexpected place for a desktop's main navigation.
- **D8. The map is a separate screen.** Seeing where you are means switching to Map and back.
- **D9. Sheets stay phone-sized.** Shop, bank, quests and items open as a modal about 560px wide, and the shop is a single column of long rows.
- **D10. Keyboard play is partial and hidden.**
  - Arrow keys move on Explore only. There are no keys for battle actions, for switching screens or for opening chat.
  - Nothing on screen says the arrow keys work.
- **D11. The desktop rules are shared with phone landscape.**
  - The two-column grid applies at `min-width: 900px` *or* on short landscape phones (`style.css:489`). Editing that block changes the Phase 2 landscape layout.
  - The 1024-wide layout also serves an iPad held sideways, which is a touch device.

## 4. Owner direction (decided 2026-11-12)

| Decision | Selection |
|---|---|
| Side column | Hero summary, zone minimap and chat, in that order of hierarchy, with chat taking the flexible remaining height |
| Chat | A persistent, non-modal panel from 1280px. From 1200 to 1279px the desktop layout keeps the chat drawer |
| Large monitors | A cap of about 1600px, centred. Type steps up modestly to 17–18px on larger displays, with no added density |
| Where desktop starts | 1200px or wider **and** a fine pointer (mouse or trackpad). Touch tablets keep the Phase 2 two-column layout |
| Navigation | Directly below the hero bar, above the gameplay screen. Movement and battle actions stay next to their content, not attached to the navigation |
| Keyboard shortcuts | On by default on desktop, with a setting to turn them off. Built in D-3, after the frame and chat have settled |
| Layout picker | After this milestone. The `data-layout` support is built now, but no picker is shown |
| Wider sheets | Later, separately. The shop, bank and inventory dialogs aren't redesigned in this milestone |
| Name | "Monstra Regna" is the working title. The implementation keeps "ClickMonster"; a rename (title, repository, app metadata, domain and trademark checks) would be a separate, approved PR |

### Composition

This is a structural wireframe, not a visual specification:

```
+--------------------------------------------------------------------------+
| Hero bar: identity · HP · XP · Gold · Gems                               |
+------------------------------------------------+-------------------------+
| Navigation: Explore · Hero · Gear · Map        | Quests and world events |
+------------------------------------------------+   current objective,    |
| Gameplay screen                                |   event timers          |
|   Explore, battles, inventory, map             +-------------------------+
|                                                | Zone minimap            |
|   Movement actions directly after the          +-------------------------+
|   explore content; Melee / Cast / Flee         | Chat                    |
|   directly under the fight and its log         |   Global / Zone /       |
|                                                |   Whisper               |
|                                                |   messages (flexible    |
|                                                |   height)               |
|                                                |   [Write a message…]    |
+------------------------------------------------+-------------------------+
        gameplay column (dominant)                 side column, ~340–400px
```

### Layout rules

1. **Gameplay stays dominant.** The gameplay column takes the remaining width. The side column provides context and never competes with it.
2. **Conventional desktop order.** The hero bar is at the top, the navigation directly below it, and the gameplay beneath that. Actions belong to their content: Melee, Cast and Flee sit directly under the fight and its log, not at the bottom of a tall column (D4).
3. **No duplicated hero bar.** The hero's identity, HP, XP, gold and gems appear once, in the top bar. The side column's summary shows only what the bar doesn't: unspent levels, active quests and their progress, and world events and hunts with their time left. It is compact and shrinks when there is little to show.
4. **Chat comes before the minimap.**
   - On shorter laptop screens the minimap collapses to a compact text summary, for example "Square 5, 4. Town 1 south.", or disappears. Chat keeps a useful message area.
   - Sending a message never requires scrolling the page.
5. **Chat is genuinely non-modal on desktop.**
   - You can type, inspect equipment, fight and receive messages without closing anything.
   - Incoming messages never move focus or interrupt typing or game controls.
6. **From 1200 to 1279px:** the desktop composition with the chat drawer. **From 1280px:** the persistent chat panel takes the side column's remaining height.
7. **Usable space decides, not width alone.** At 200% text scaling, panels reflow or collapse instead of squeezing three regions into too little room.
8. **About 1600px at most, centred.** The gameplay column can grow without becoming too wide, and the chat column stays about 340–400px. At 1920 there is breathing room, and at 2560 the game is centred, not stretched.
9. **Larger type, not more density.** On larger displays the type steps up to about 17–18px. The extra space is not used to show more at once.

## 5. Constraints

- **Phones stay exactly as they are.**
  - Phone portrait and landscape are out of scope: 320, 390, 844×390, and the Phase 2 landscape rules.
  - Touch tablets keep the Phase 2 layout.
  - The desktop rules get their own condition, separate from the shared block in D11. The Phase 1–3 phone and landscape tests must keep passing unchanged.
- **Phase 2 desktop criteria still hold.** AC-6 at 1024 and 1440 requires at least 8 rows and at least 400px of battle-log room with the actions on screen. Changing those tests needs the owner's approval.
  - **Decided (2026-11-12, during D-1):**
    - At 1024×768, AC-6 is unchanged.
    - Under the desktop layout, the log's room is the height it can grow to before it scrolls, with Melee and Cast on screen. The 400px minimum is unchanged. The old measure (from the top of the log to the bottom of the screen area) can't apply once the screen is only as tall as its content.
    - A touch (coarse-pointer) run at 1440×900 keeps the Phase 2 two-column layout covered at that size with the original measure.
- **Breakpoints in `em`, validated by behaviour (rule 7).**
  - Media queries measured in `em` follow the browser's text-size setting, not the page's root font size. MDN recommends them for respecting text-size preferences.
    - Desktop starts at `min-width: 75em` (1200px at the default size), and the chat panel at `80em` (1280px).
    - With text at 200% those need 2400 and 2560 CSS pixels, so a laptop falls back.
    - Height thresholds for collapsing the minimap are in `em` too.
    - The 17–18px type step changes the root font size, so it does not move the breakpoints.
  - **Browsers and text-enlargement methods may not all behave alike, so the calculation is not taken on trust.** Tests set 200% browser text size (a 32px default font) and 200% zoom, then check the resulting `data-layout` state and geometry: which layout, whether chat is mounted, no clipping, no sideways scroll.
- **One source for the layout state.**
  - JS sets `data-layout` on `#app` (`mobile`, `wide` for the Phase 2 two-column layout, or `desktop`), plus a flag for whether the chat panel is mounted.
  - It uses `matchMedia` with the same conditions as the CSS, and updates on resize and on changes in pointer and text size.
  - CSS keys off that state, so the later picker can force a layout without fighting the media queries.
  - A forced Desktop still falls back when there isn't room (rule 7).
- **Reading and tab order matches the visual order.**
  - The order is: hero bar, navigation, gameplay screen and its actions, then the side column (summary, minimap, chat).
  - The DOM is arranged to give that order on desktop, not just the CSS grid. Phones keep their current DOM order.
  - The chat panel is a landmark (`aside`, "Chat"). Its message list keeps the existing roving focus.
- **Chat outside a dialog changes its accessibility model.**
  - A modal drawer traps focus and makes the game inert; a panel does neither.
  - New messages are not announced over the game's own announcements. Unread counts update quietly, and focus never moves on arrival (rule 5).
  - The panel and the drawer share one chat state in `chat-ui.js`, so switching at 1280 keeps the draft, the channel and the unread counts.
- **Keyboard shortcuts (D-3)** come under WCAG 2.1.4, which allows character-key shortcuts only with a way to turn them off, remap them, or have them work only while focus is on the control. This milestone uses an off setting.
  - They never fire while typing in a field, while composing text with an input method (`isComposing`), while a dialog is open, or when a modifier is held (Ctrl, Alt or Meta).
  - The off setting is stored locally in `clickmonster.prefs`, with no account or server change.
- **Dialogs keep the Phase 1 and 3 behaviour:** native `<dialog>`, focus handling, `confirm.js` for anything destructive, and no `confirm()` or `prompt()`.
- **Vanilla JS, no build step and no new production dependencies.** No icons or emojis in the game UI.
- **No change to game rules, the server, the database schema or the API.**
  - The summary uses data the client already loads: the active quest (`char.quest`), world events (`world_config` through `world-config.js`) and active hunts (`ui.hunts`).

## 6. Draft acceptance criteria

These are measured with `tools/desktop-metrics.mjs` (extended as needed) and `tools/ui-shots.mjs` at the 7 sizes, plus 1280×720 as a short laptop and the owner's viewport once measured, before (`main`) and after. The phase column says which phase each criterion belongs to. A phase is never expected to meet a later phase's criterion, so nothing is added as filler to pass one early.

| AC | Phase | Criterion | Before | Draft target |
|---|---|---|---|---|
| DAC-1 | D-1 | Desktop frame: from 1200px wide with a fine pointer, the hero bar, navigation, gameplay column and side column are laid out as in section 4; the summary and minimap show real content; nothing in the side column is filler | two-column Phase 2 layout | met; compared with screenshots |
| DAC-2 | D-1 | Battle actions directly under the fight: the gap from the end of the fight (the log, or the result card once the fight is over) to the actions; the actions within the log's column and on screen, at the start and after the log has filled. Decided during D-1, replacing the draft "≤ 200px centre to centre". That distance is still reported for comparison | at the desktop sizes: gap 397–1,117px, outside the log's column (centre to centre 674–1,243px) | gap ≤ 24px, in the column, on screen, at every desktop size |
| DAC-3 | D-1 | Width and type: app width is min(window, about 1600), centred; body text 17–18px on large displays (from about 1800px); lines at most about 80 characters | 1280 cap, 67% / 50% at 1920 / 2560, 16px | about 83% / 63% at 1920 / 2560, 17–18px |
| DAC-4 | D-1 | No duplicated hero bar: nothing in the side column's summary repeats the hero bar (name, HP, XP, gold, gems); with nothing to show, the summary takes no more than one line | — | met; checked against the DOM |
| DAC-5 | D-1 | Space, not width: with 200% browser text size, and with 200% zoom, at 1366×768 and 1920×1080, the resulting `data-layout` and geometry are checked: a layout that fits, no clipped panels, no sideways scroll | — | met |
| DAC-6 | D-1 | Reading and tab order matches the visual order on desktop: hero bar, navigation, gameplay and its actions, then the side column | — | met; documented and tested |
| DAC-7 | D-1 | Phones, landscape and tablets unchanged: 320, 390 and 844×390 metrics and tests identical; a coarse-pointer 1024×768 and 1366×1024 keep the Phase 2 layout; Phase 2 AC-6 still met | met | met |
| DAC-8 | D-2 | The side column is used: on Explore from 1280×800 to 1920×1080, no empty band taller than 120px in the side column (the chat panel takes the remaining height) | 504–816px empty | ≤ 120px |
| DAC-9 | D-2 | Non-modal chat from 1280px. With the panel mounted, the game is not inert while you read or type: you can fight, change equipment and move. An incoming message (Realtime broadcast) leaves focus and caret where they were, whether that is the message box, a battle action or a gear row | game inert while chat is open | met; tested |
| DAC-10 | D-2 | Chat before minimap on short screens. At 1366×768 and 1280×720 the message box and a usable message area (at least 6 lines) are visible without scrolling the page, and the minimap shows as a compact summary or not at all | no persistent chat | met |
| DAC-11 | D-2 | 1200–1279px gets the desktop composition with the chat drawer; 1280px and wider gets the panel; switching keeps the chat draft, channel and unread counts | — | met; tested at 1240 and 1280 and across a resize |
| DAC-12 | D-3 | Keyboard play: the section 7 keys work; `?` lists them; on by default on desktop; the off setting is honoured and remembered | arrows on Explore only | met; tested |
| DAC-13 | D-3 | Shortcuts never fire while typing, composing with an input method, with a dialog open, or with a modifier key held | — | met; tested |
| DAC-14 | all | No sideways page scrolling at any measured size | none | none |
| DAC-15 | all | axe, all impacts, on every screen at the desktop sizes (chat panel mounted and not, from D-2) and at the phone sizes | 0 violations (91 captures) | 0 violations |
| DAC-16 | all | No change to game rules, the server, the schema or the API | — | none |

## 7. Keyboard shortcuts (D-3, provisional)

| Key | Action |
|---|---|
| `1` / `2` / `3` / `4` | Explore / Hero / Gear / Map |
| `M` / `C` / `F` | Melee / Cast / Flee, during battle only |
| `Enter` | Fight again, when it is offered |
| `/` | Focus the chat message box, opening the drawer if needed |
| `Escape` | Leave the chat message box, or close an open dialog |
| `?` | Show the keyboard shortcuts |

- Battle is a state of play, not one of the four screens, so it has no number.
- The arrow keys keep moving the hero on Explore, as today.
- The mapping is confirmed when D-3 starts, against the controls as D-1 and D-2 leave them.

## 8. Still to measure

- **The owner's browser viewport:** `innerWidth × innerHeight` (CSS pixels) and `devicePixelRatio`. Add it to the measured sizes and screenshots once known; use the viewport, not the screen's advertised resolution.
- **Known so far,** read on the owner's laptop through the Chrome extension on 2026-11-12:
  - a 1920×1080 screen at `devicePixelRatio` 1, with 1920×1032 available above the taskbar;
  - a fine pointer;
  - the default 16px text size.
- **The viewport itself is still unknown.** The extension's window reported 2552×1308, larger than the screen, from a minimized window (outer size 160×28), so it was not used. A maximized browser window on this screen will be 1920 wide and somewhat under 1032 tall; the exact height comes from running the snippet in the owner's normal window. Until then, 1920×1080 stands in for it.

## 9. Phasing

One branch and PR per phase, each stopping at an independent review gate.

- **D-1. Desktop frame:**
  - the desktop condition and the `data-layout` state;
  - the hero bar at the top and the navigation below it;
  - the gameplay column, with movement after the explore content and battle actions under the fight;
  - the side column's summary and minimap, with the minimap's short-screen collapse;
  - the 1600 cap and the type step;
  - the chat drawer, unchanged.
  - Criteria: DAC-1 to 7 and 14 to 16.
- **D-2. Persistent chat panel:**
  - the panel from 1280px, non-modal, with no focus stealing;
  - the switch to and from the drawer;
  - chat priority on short screens.
  - Criteria: DAC-8 to 11 and 14 to 16.
- **D-3. Keyboard shortcuts:** the section 7 keys, the help list and the off setting. Criteria: DAC-12 to 16.
- **After this milestone, each separate:** the layout picker, wider sheets, and the possible rename to Monstra Regna.

## 10. Out of scope

- Sign-in page news. This is backlog item 3 and needs a schema change.
- The admin console.
- Phone layouts.
- The layout picker UI, wider sheets and the rename, which come after this milestone (section 9).
- Game rules, the server, the schema and the API.
- New dependencies or a build step.
- The pre-release verification in `docs/backlog.md` (real devices, screen readers, live staging). It still applies before any release that includes this work.
