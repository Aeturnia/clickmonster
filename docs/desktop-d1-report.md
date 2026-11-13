# Desktop layout — phase D-1 report: desktop frame

Branch `claude/desktop-d1`, stacked on `claude/desktop-scope` (PR #17), because it uses that PR's `tools/desktop-metrics.mjs` and baseline.

The scope, the owner's decisions and the acceptance criteria are in `docs/desktop-scope.md`. D-1 is the desktop frame. The persistent chat panel is D-2, and keyboard shortcuts are D-3.

No game rules, server code, schema, API or dependencies changed. The phone, phone-landscape and tablet layouts are unchanged.

## Summary

From 1200px wide (75em) with a mouse or trackpad, the game has a desktop layout:
- **Hero bar:** across the top, showing identity, gold, gems, HP and XP once.
- **Navigation:** directly under the hero bar, aligned with the screen's content.
- **Gameplay column:** the screen at a 47.5rem reading width, centred. Its actions follow its content directly: the movement pad and town buttons after the Explore list, and Melee, Cast and Flee (or Fight again and Continue) directly under the fight. The column is only as tall as its content, and once the content fills the window, the battle log scrolls rather than the page.
- **Side column (340–400px):**
  - **Quests and events:** levels to spend, the active quest, world events and world-boss hunts, with time left. On desktop, the quest and events move here from the Explore screen. With nothing to show it is one line, and nothing in it repeats the hero bar.
  - **Minimap:** a picture of the current zone in the Map screen's colours, hidden from screen readers. A text version says what is near and in which direction, and a link opens the full map. On screens under 56em tall (896px at the default text size) only the text shows, leaving room for chat in D-2.
  - **The chat line and drawer:** unchanged. The persistent panel arrives in D-2.
- **Width and type:** the app is at most 1600px wide, centred. Text steps up to 106.25% (17px) from 1800px wide and to 112.5% (18px) from 2400px. Both are relative to the browser's own text size.
- **Layout state:**
  - `layout.js` sets `#app[data-layout]` to `mobile`, `wide` (the Phase 2 two-column layout) or `desktop`, and the CSS keys off it. This is ready for a layout picker later.
  - Desktop needs the `em` media query and a fine pointer. It also checks the usable width in rem, so larger text falls back whichever way it is enlarged; a 1rem probe catches root size changes that happen without a resize.
  - The regions are reordered in the DOM only when the layout changes, so the reading and tab order match the visual order. Focus and the caret are kept across the move.
- **Screens without a game** (sign-in, hero creation, banned) use the full width, with no empty side column.

## Acceptance criteria (D-1)

Measured with `tools/desktop-metrics.mjs` (raw data: `docs/ui-audit/desktop/metrics-before.json` and `metrics-after-d1.json`) and the tests in `tests/ui/desktop.test.mjs`. "Before" is `main` at `76c5f8e`.

| AC | Criterion | Before | After |
|---|---|---|---|
| DAC-1 | Desktop frame as in the scope (section 4): hero bar, navigation, gameplay column with its actions, side column with summary and minimap; no filler | Phase 2 two columns | met (test "D-1 frame"); screenshots `after-d1-*` |
| DAC-2 | Battle actions directly under the fight, at the start and after the log has filled: gap from the end of the fight to the actions, actions in the log's column, on screen; the log scrolls, not the page | at the desktop sizes (1280×720 to 2560×1440): gap 397–1,117px, outside the log's column (centre-to-centre 674–1,243px) | gap 10px, in the column, at every desktop size; still so after a long fight (centre-to-centre 192–216px; see "Owner decisions") |
| DAC-3 | App width min(window, 1600), centred; text 17–18px on large displays; reading width 47.5rem | 1280 cap: 67% / 50% at 1920 / 2560; 16px | 83% / 63% at 1920 / 2560; 16 / 17 / 18px at 1440 / 1920 / 2560; reading width 760 / 808 / 855px |
| DAC-4 | The summary repeats nothing from the hero bar; one line when empty | — | met (test "D-1 summary") |
| DAC-5 | Space, not width: 32px browser text at 1920×1080 and 1366×768, 200% page text at 1920×1080, and 200% zoom at 1366×768 all fall back (not desktop), with no sideways scroll and the actions on screen | — | met (test "D-1 larger text and zoom") |
| DAC-6 | Tab order matches the visual order: navigation, screen, actions, side column | — | met (test "D-1 reading and tab order") |
| DAC-7 | Phones, landscape and tablets unchanged; Phase 2 AC-6 still met | — | `tools/ui-metrics.mjs` results are identical before and after at 320, 375, 390, 430, 844×390 and 1024×768. Touch 1024×768 and 1366×1024 and a 1150px mouse window keep the Phase 2 layout and order (test). Phase 2 AC-6 met as decided (below) |
| DAC-14 | No sideways page scrolling | none | none at the 8 measured sizes (screens and tests) |
| DAC-15 | axe, all impacts | 0 (91 captures) | **0 violations on 104 captures** (13 screens × 8 sizes: 1024×768, 1280×720, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440), and on the axe checks inside the new tests |
| DAC-16 | No game, server, schema or API change | — | none |

The side column's empty height (DAC-8) is a D-2 criterion. Its D-1 values, 394–891px on Explore from 1280×800 to 2560×1440, are recorded for D-2 and not targeted here.

### Measurement corrections

- **Content width.** The baseline overstated the content width by 1px: 761 instead of 760, and 623 instead of 622 at 1024. The screen-reader-only heading was counted as content. `tools/desktop-metrics.mjs` now leaves `.sr-only` out. `metrics-before.json` was regenerated with the corrected tool, and nothing else changed. It now also covers 1280×720. The scope's table (section 2) was corrected to match in PR #17.
- **Side-column measures.** "Gap to side column" and "empty height in the side column" were defined against the hero bar's position, which only works while the hero bar sits in the side column. They are now measured against the side column itself (`#side` on desktop, the column holding `#top` otherwise). Rerun on `main`, the redefined tool reproduces the committed baseline exactly: 0 differences across 7 sizes and 9 measures.

## Tests

- **`tests/ui/desktop.test.mjs`, 10 new tests.**
  - The frame and its region order, and the side column's width.
  - Tab order.
  - Battle at 1366×768, 1440×900 and 1920×1080, at the start and after a long fight. The hero is made to last, so the log fills and must scroll while the page and screen stay put.
  - Width, centring and type at 1440, 1920 and 2560.
  - The summary: one line when empty; with a quest and levels it repeats nothing from the hero bar, the quest is not repeated on Explore, and "levels to spend" opens Hero.
  - The minimap's picture and text, its short-screen collapse, and the link to the map.
  - The fallbacks: browser text size set through Chrome's DevTools protocol (`Page.setFontSizes`), page text size, and zoom.
  - Phones, tablets and narrow windows.
  - Resizing across 1200px with focus kept.
  - Sign-in at full width.
- **Against `main`, all 10 fail.**
  - **Four fail on the behaviour itself:** the battle actions are 445px under the log and outside its column; the width is capped at 1280; the summary and minimap don't exist.
  - **Six fail only because the new layout state or `#side` doesn't exist there:** frame, Tab order, the fallbacks, phones and tablets, resize, and sign-in. The fallback and phones-and-tablets tests are regression guards, written to pass on the old behaviour apart from that.
- **The full suites** (this laptop, Chromium, fake backend): `npm test` 24/24 and `npm run test:ui` **95/95 in each of 3 consecutive full runs** (85 earlier tests, one of them AC-6 updated as decided, plus 10 new).

## Owner decisions during D-1

Both are recorded in `docs/desktop-scope.md` (PR #17).

1. **Phase 2 AC-6 at 1440×900.**
   - The test (`responsive.test.mjs`, "AC-6 tablet and desktop") checks at least 8 visible rows on Explore, then at least 400px of battle-log room after one hit. Phase 2 measured that room from the top of the log to the bottom of `#main`.
   - **Rows:** 8 at 1440×900 after tightening the desktop padding; the first try gave 7.
   - **Log room:** under the desktop layout `#main` is only as tall as its content, so that the actions can sit under the fight. The Phase 2 measure therefore read about 167px after one hit.
   - **Decision:**
     - AC-6 is unchanged at 1024×768, which is not desktop.
     - Under the desktop layout, the room is how far the log can grow before it scrolls, with Melee and Cast on screen, still at least 400px.
     - A touch run at 1440×900 keeps the Phase 2 two-column layout covered with the original measure.
   - **The new measure was checked against a real fight.** A long fight was run until the log scrolled. It predicted 572px at 1440×900 and 440px at 1366×768, and the log was exactly 572px and 440px tall when it started scrolling.
   - The updated test passes on this branch, and on `main`, where 1440 is not desktop and the original measure applies.
2. **How DAC-2 is measured.**
   - The draft target was at most 200px centre to centre. After D-1 that is 192px at 1280–1536, 204px at 1920 and 216px at 2560. The vertical gap is 10px; the rest is horizontal, from the centre of the log to the centre of the Melee button.
   - **Decision:** the gap from the end of the fight (the log, or the result card) to the actions, at most 24px, with the actions within the log's column and on screen, at the start and after the log has filled. The centre-to-centre distance is still reported (table above).

## What changed

- **`public/js/layout.js` (new):** the layout state, the DOM order for each layout, focus and caret kept across the move, and the 1rem probe.
- **`public/index.html`:** `<div id="side">` with `#summary` and `#minimap`. It is empty and hidden outside the desktop layout.
- **`public/js/main.js`:**
  - `watchLayout()` re-renders when the layout changes;
  - `viewSummary()`, `viewMinimap()` and `eventLine()`;
  - `nearbyPlaces()` is shared by Explore and the minimap;
  - on desktop, Explore leaves the quest and events to the side column.
- **`public/css/style.css`:** a new "desktop layout (D-1)" section keyed off `#app[data-layout="desktop"]`. The Phase 2 media-query rules are not edited; the desktop rules override them by specificity.
- **`tools/desktop-metrics.mjs`:** the side-column definitions, the content-width correction, and `battle.gap` and `battle.inColumn`. These came in with PR #17, and this branch builds on them.
- **`tests/ui/responsive.test.mjs`:** AC-6 as decided. It adds a `touch` option to `open()`, a desktop log-room measure, and a touch run at 1440×900.

## Not verified

- **Real devices and other browsers:** Firefox, Safari, and real touch laptops, whose pointer type is reported differently by different systems. Only Chromium was tested.
- **Screen readers:** the reading order after the move, the summary and the minimap's text. Checked in the DOM and by axe only.
- **The owner's own viewport.** It hasn't been measured yet; 1920×1080 stands in.
- **Live data:** world events and hunts in the summary with real data. The fake backend serves no events or hunts, so those lines were only checked in code review, not on screen.
