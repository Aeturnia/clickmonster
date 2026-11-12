# ClickMonster UI/UX modernization: Phase 0 audit

Audit date: 2026-11-12. Commit audited: `f73486e` (main, after the chat release).

## 1. Method and limits

**What was actually run**

- **Static review** of `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/chat-ui.js`, `public/admin.html`, `public/js/admin.js` and `public/js/admin-zones.js`.
- **Contrast** computed from the CSS tokens with the WCAG 2.x relative-luminance formula.
- **Headless Chromium (Playwright) against the live Supabase backend.** I used throwaway accounts, deleted afterwards: a level-12 hero named *Bartholomew Thorne* (18 characters, the maximum) carrying 123,456,789 gold and 98,765,432 banked, and an admin account.
  - **Game:** 13 screens at **320×640, 375×812, 390×844, 430×932, 768×1024, 1024×768, 1440×900** and **844×390 (phone landscape)**, 104 captures in total. The screens were auth, level-up sheet, explore (town), shop sheet, quest sheet, explore (open ground), battle, battle result, hero, gear, item sheet, map and chat drawer.
  - **Admin:** 11 screens at 375 and 1440.
- **Each capture recorded** horizontal overflow, clipped text (`scrollWidth > clientWidth`), interactive targets smaller than 24 px, map cell size, content-area height, and **axe-core 4.10** violations (tags `wcag2a/aa`, `wcag21a/aa`, `wcag22aa`, `best-practice`).
- **Scripted keyboard checks:** tab order, focus visibility, sheet focus containment and restoration, the chat drawer, battle actions, arrow-key movement while typing, toast persistence, and a simulated enlarged text size.

**Not done (so not claimed)**

- No real devices, no iOS Safari or Firefox; Chromium only.
- No screen reader session (VoiceOver, TalkBack, NVDA). Semantics findings come from markup and axe, not from listening.
- On-screen keyboard behavior was **not** emulated. Where it matters, the finding says "unverified".
- No usability testing with players.

**How findings are classified**

- **Defect (confirmed):** reproduced in the runs above.
- **Defect (by inspection):** clear from the code but not exercised in a browser.
- **Improvement:** a clear gain, but nothing is broken today.
- **Preference:** a taste call. It's listed for discussion, not as a problem.

## 2. Current structure

### Game (`index.html`, `style.css`, `main.js`, `chat-ui.js`)

```
#app (flex column, 100dvh, max-width 560px)
  #top      HUD: name, level, race, gold, gems, HP and XP meters
  #main     scrolling content; becomes a flex column (.fill) in battle
  #chatbar  latest chat line + unread counts (chat-ui.js)
  #dock     context controls: arrow pad + Shop/Heal/Bank/Quests/Travel/quick Fight,
            or Melee/Cast/Flee in battle
  #nav      4 text tabs: Explore/Battle, Hero, Gear, Map
#sheet      bottom sheet (shop, bank, quests, item, level-up)
#chat       chat drawer (chat-ui.js)
#toast      single status message, role="status"
```

- **Rendering:** `render()` builds HTML strings per region and `paint()` skips regions whose HTML is unchanged. A changed region is replaced wholesale with `innerHTML`.
- **Events:** one delegated `click` handler reads `data-a`/`data-v`. Local actions re-render immediately. Server actions go through `api()` and mark the pressed button `.pending`.
- **Chat:** the drawer manages its own DOM and refreshes only the message list while open, so typing isn't interrupted.

**Reusable patterns already present:**

- `.btn` with variants: primary, ghost, danger, sm, block, pending.
- `.row` (list rows), `.seg` (segmented control), `.chip`, `.tag`, `.meter`, `.notice`, `.kv` (definition list), `.panel` (sheet), `.rows`.

**Tokens:** `:root` defines 18 colour tokens plus `--radius` and `--tap`. Spacing, type sizes, line heights, z-index and motion are hard-coded throughout.

- `style.css` has **57 `font-size: Npx` declarations** and almost no rem/em.
- Inline `style="…"` attributes: **30 in `main.js`, 29 in `admin.js`, 15 in `admin-zones.js`.**

### Admin (`admin.html`, `admin.js`, `admin-zones.js`)

- It reuses `style.css` plus a **45-line inline `<style>`** in `admin.html`.
- There's one scrolling page with a chip-row tab bar of 11 entries (10 tabs plus an "Open game" link).
- Content is in `.box` cards, `<table>`s with clickable `tr.click` rows, and `.form-grid` forms.
- The zone editor uses `data-f` paths and refreshes its preview in place.

## 3. Findings

Severity: **High** blocks or seriously degrades a task for some users; **Medium** is noticeable friction or partial failure; **Low** is polish.

### 3.1 Accessibility

| ID | Finding | Evidence | Type | Severity |
|---|---|---|---|---|
| A1 | **`--faint` text fails AA.** It measures 2.67 to 3.38:1 against every surface (4.5:1 needed). It's used for timestamps, older battle-log lines, hints, empty states and disabled labels. | Computed contrast. axe `color-contrast`: 240 nodes across 12 of 13 game screens, plus 1 to 13 nodes on 5 admin screens. | Defect (confirmed) | High |
| A2 | **Component boundaries are too faint.** `--line` borders are 1.46:1 on `--bg` and 1.35:1 on `--surface` (3:1 needed for UI components, WCAG 1.4.11). Text inputs, segmented controls and cards are hard to tell apart. | Computed contrast. Visible in the screenshots. | Defect (confirmed) | Medium |
| A3 | **Bottom sheets aren't dialogs.** They have no `role="dialog"`, `aria-modal` or label. Focus stays on the trigger when a sheet opens. **13 of 40 Tab presses left the open shop sheet.** Focus doesn't return to the trigger on close. Escape and backdrop-tap do close it. | Keyboard script at 390 px. | Defect (confirmed) | High |
| A4 | **Chat drawer keyboard support.** Opening it doesn't move focus into it (focus went to `<body>`). **Escape doesn't close it.** It has no dialog role or label. **Chat lines aren't focusable** (`tabIndex -1`), so Whisper, Ignore, Report and Remove are unreachable by keyboard. | Keyboard script. | Defect (confirmed) | High |
| A5 | **Focus is lost when the main region re-renders.** Starting a battle from the keyboard dropped focus to `<body>`. The same happens on tab changes and after most actions, because the pressed button's HTML is replaced. | Keyboard script: after Fight, `activeElement = body`. | Defect (confirmed) | High |
| A6 | **The battle log isn't keyboard-scrollable or announced.** `#log` scrolls but can't take focus (axe `scrollable-region-focusable`). It has no live region, so screen-reader users get no feedback for attacks. | axe on the battle and result screens. Markup. | Defect (confirmed) | High |
| A7 | **Error messages vanish after 2.4 s and leave no record.** Long messages (mutes, jail and ban reasons, server errors) can't be reread. The toast uses `role="status"` (polite) even for errors. | Keyboard script: an error toast was hidden after 3 s. | Defect (confirmed) | Medium |
| A8 | **Enlarged text is ignored.** Every type size is in px, so a browser or OS "larger text" setting doesn't scale the game. Setting the root font size to 200% left text at 16 px. | Keyboard script. | Defect (confirmed) | High |
| A9 | **Tabs have no current-state semantics.** The active tab is shown only by colour and a top border; there's no `aria-current`. The segmented controls (Monsters/Players, chat tabs, shop slots) have no `aria-pressed` or `aria-selected`. | Markup and keyboard script. | Defect (confirmed) | Medium |
| A10 | **The focus indicator is the browser default.** A 1 px auto ring in near-white. It's visible on the dark surfaces but thin and inconsistent with the gold accent, and it's absent on the custom chip and segment styles in some states. | Computed `outline: auto 1px rgb(238,238,238)`. | Improvement | Medium |
| A11 | **Map cells say nothing about what's there.** Each `aria-label` is coordinates only ("3, 5"). Towns, paths, locked paths, lairs and "You" are communicated only by a letter and colour. | Markup check. | Defect (confirmed) | Medium |
| A12 | **Landmark and heading structure.** The game has no `<h1>` on in-game screens (axe `page-has-heading-one`, 64 nodes). Sheets and the chat drawer sit outside landmarks (axe `region`, 590 nodes). Admin has no `<main>` landmark (`landmark-one-main` on every admin screen). | axe. | Defect (confirmed) | Low |
| A13 | **Admin rows can't be reached by keyboard.** `tr.click` rows (players, top heroes, zones, 12 on the zones list) aren't focusable. Tabbing 25 times on Players never reached one, so **a keyboard user can't open a player or a zone**. | Admin keyboard script. | Defect (confirmed) | High |
| A14 | **Admin form labels.** The hero editor has 3 `<select>`s and 1 input with no accessible name (axe `select-name`, `label`). The zones table has an empty header cell. | axe at 375 and 1440. | Defect (confirmed) | Medium |
| A15 | **Small targets.** Chat lines are 22 px tall (WCAG 2.5.8 asks for 24 px minimum). Map cells are 21 px on a 12×12 zone at 320 px. | Measured. | Defect (confirmed) | Medium |
| A16 | **Destructive actions use `confirm()` and `prompt()`.** These work, but they're unstyled, block the thread and give no context about consequences. This covers delete hero, attack player, abandon quest, admin sanctions, zone delete and item removal. Server safeguards exist. | Code. | Improvement | Low |

### 3.2 Responsive layout and information architecture

| ID | Finding | Evidence | Type | Severity |
|---|---|---|---|---|
| R1 | **The HUD truncates the hero name.** It's clipped at every phone width (320, 375, 390, 430). At **320 px with a 9-digit gold value the name shrinks to a single letter ("B")**. In battle the name is clipped up to 390 px. | Clip measurement on every screen. `docs/ui-audit/320-explore-town.png`. | Defect (confirmed) | High |
| R2 | **Phone landscape is unusable.** At 844×390 the scrolling area is **106 px on Explore and 88 px in battle**. The HUD, chat bar, dock and nav take the rest, the monster list and battle log are effectively hidden, and nothing adapts to landscape. | `844x390-landscape-*.png`. | Defect (confirmed) | High |
| R3 | **The town dock overflows at 320 px.** The 2×2 Shop, Heal, Bank and Quests grid beside the arrow pad doesn't fit: "Quests" is cut to "Que" under the W button, and the bank amount wraps to 3 lines. | `320-explore-town.png`. | Defect (confirmed) | High |
| R4 | **Explore content area at 320×640 is very small.** The location header plus the Monsters/Players switch fill it, so about one monster row shows before scrolling. At 375 and up it's adequate (528 px). | Measured content height of 351 px. Screenshot. | Defect (confirmed) | Medium |
| R5 | **The chat drawer is cut off on short screens.** At 320×640 the 72dvh drawer's message box sits partly below the bottom edge. Behavior with the phone's on-screen keyboard open is **unverified**, but it's likely worse because the drawer is fixed-position. | `320-chat-drawer.png`. | Defect (confirmed, keyboard part unverified) | High |
| R6 | **Large maps shrink without limit.** Cells fit the width: 26 px for 10×10 and 21 px for 12×12 at 320 px. A 40×40 zone, which the editor allows, would be about 6 px. There's no scrolling or panning, and only the zone editor shows the current square's surroundings. | Measured. `320-map-12x12.png`. | Defect (confirmed for 12×12, by inspection for 40×40) | Medium |
| R7 | **Floating damage numbers overlap labels.** They overlap the "HP" label and the foe's level and difficulty at all phone widths. | `320-battle.png`. | Defect (confirmed) | Low |
| R8 | **Desktop and tablet use a 560 px column.** At 768 to 1440 px the game stays a phone column with empty sides. It works, but tablets get no benefit; for example, the battle log and the monster list can't be visible together. | `1440-explore-open.png`. | Improvement | Low |
| R9 | **Explore density.** Location text, nearby places, notices, the quest line, announcements and events all stack above the monster list, which pushes the primary action (Fight) down. The most-used content isn't first on short screens. | Screenshots at 320 and 375. | Improvement | Medium |
| R10 | **Admin tab bar.** 11 chips scroll horizontally with the scrollbar hidden. At 375 px most tabs are off-screen with nothing showing that more exist. At 1440 the row measured a few px of overflow but all chips were visible. | Admin measurement and screenshot. | Defect (confirmed at 375) | Medium |
| R11 | **No horizontal page overflow** at any tested width, game or admin. This is a positive baseline worth keeping. | Measured. | — | — |

### 3.3 Interaction feedback

| ID | Finding | Evidence | Type | Severity |
|---|---|---|---|---|
| F1 | **Pending feedback is uneven.** The pressed button pulses, but other controls stay enabled and only a global `ui.busy` flag guards against double actions. Map-square walking and sheet buttons give no pending state. | Code and screenshots. | Improvement | Low |
| F2 | **There's no persistent error or status surface.** Everything goes through one toast (see A7). Confirmations like "Equipped." disappear the same way. | Code. | Improvement | Medium |
| F3 | **Battle log hierarchy.** Recent lines are bright and older ones faint, which works visually, but the faint lines fail contrast (A1). The victory or defeat summary sits above the log, while the action that caused it is at the bottom. | Screenshots. | Improvement | Medium |
| F4 | **Scroll position.** `#main` resets to the top on view change, which is correct. In-place updates such as regen ticks and players-list refreshes replace the whole region, which can move the scroll and focus (see A5). | Code (`paint`). | Defect (by inspection) | Medium |
| F5 | **Reduced motion is respected.** A global `prefers-reduced-motion` rule shortens animations and floats only fade. | Code. | — (keep) | — |
| F6 | **Destructive confirmations are inconsistent.** Some are confirmed (delete hero, attack, abandon, zone delete, item removal); some aren't (selling an item with socketed gems only shows a warning line; extracting a gem has a cost but no confirm). | Code. | Improvement | Low |

### 3.4 Visual consistency and maintainability

| ID | Finding | Type |
|---|---|---|
| V1 | Spacing, radius and type sizes are hard-coded per rule, with 74 inline `style` attributes across the JS views. That makes consistent changes slow and invites drift. | Improvement |
| V2 | Admin styles live in an inline `<style>` in `admin.html` and partly redefine game components (`.box` versus `.card` versus `.notice`). | Improvement |
| V3 | Two card patterns exist (`.notice`, `.box`) plus a legacy `.card` rule that is no longer used by the game views. | Improvement |
| V4 | Preference: the serif headings (Georgia) next to system-ui body text work well for the fantasy tone and should stay. | Preference (keep) |

## 4. Responsive summary

| Width | Overflow | Name clipped | Notable |
|---|---|---|---|
| 320×640 | none | yes (to 1 letter with large gold) | Town dock overflows (R3), about 1 monster row visible (R4), chat input cut (R5), 12×12 map cells 21 px |
| 375×812 | none | yes | Usable. HUD name truncation is the main issue |
| 390×844 | none | yes (HUD and battle) | Usable |
| 430×932 | none | yes (HUD) | Usable |
| 768×1024 | none | no | 560 px column, wide margins (R8) |
| 1024×768 | none | no | Same |
| 1440×900 | none | no | Same. Admin is fine at this width |
| 844×390 landscape | none | no | **Unusable**: 88 to 106 px content area (R2) |

## 5. Proposed implementation plan

Each phase gets its own branch and pull request, with before/after screenshots, axe results, `npm test`, and the new UI tests. Server code, Supabase calls, action names and data shapes stay unchanged throughout.

### Phase 1: Foundation and accessibility (fixes A1 to A15, F2, V1 partly)

1. **Tokens.** Add spacing, type-scale, radius, z-index, motion and focus tokens in `:root`. Convert type sizes to `rem`, keeping today's rendered sizes at a default 16 px, which fixes A8.
   - Raise `--faint` to at least 4.5:1, around `#8c7f70`.
   - Add a `--line-strong` at 3:1 or more for input and control borders (A1, A2).
   - Keep the palette, gold accent and serif headings.
2. **Focus.** One `:focus-visible` style: a 2 px gold outline with offset on all controls, chips, rows, map cells and chat lines (A10).
3. **Native `<dialog>` for sheets and the chat drawer.** Use `showModal()` for focus containment, Escape and inert background. Move initial focus to the heading or first control, and restore focus to the trigger on close. Keep the bottom-sheet look and backdrop-tap close (A3, A4).
4. **Focus preservation across re-renders.** Before `paint()` replaces a region, remember the focused element's `data-a`/`data-v` key and restore focus to the matching new element afterwards (A5, F4). This is small and local; no virtual DOM.
5. **Semantics.**
   - `aria-current="page"` on the active tab.
   - `aria-pressed` or `aria-selected` on segmented controls.
   - A visually hidden `<h1>` per screen, and landmarks.
   - A focusable battle log with a polite live region that announces only new lines.
   - Map cells labelled with their contents, for example "Town, Fogwatch, 4, 4" or "You are here" (A6, A9, A11, A12).
6. **Chat lines become buttons** (or get a per-line menu button), reachable with Tab or arrow keys. The menu opens as a small focusable group and Escape closes it (A4, A15).
7. **Messages.** Errors use `role="alert"` and stay until dismissed or replaced, with a small recent-messages history reachable from the HUD. Success toasts stay brief (A7, F2).
8. **Admin keyboard and labels.** Clickable rows get a real link or button in the first cell. Add the missing labels and the `<main>` landmark (A13, A14).
9. **Tests.** Add Playwright UI tests that run against fixture data by intercepting Supabase requests, so they never touch the live project. Cover: login, explore, a battle, sheets open, trap and close, chat drawer keyboard use, map travel and admin row navigation. Add an axe run with zero serious or critical violations as the gate. These go under `npm run test:ui` next to the existing `npm test`.

### Phase 2: Responsive layout and information architecture (R1 to R10, R7)

1. **HUD:** give the name priority. Abbreviate large numbers (123.4M), let the HUD wrap to two lines on narrow screens, and show the full name in the hero view (R1).
2. **Dock:** at 320 px or under, the town actions move into a horizontally scrollable action row above the pad, or a two-line layout. No clipping (R3).
3. **Explore order:** monster list first, with the location details collapsible. Notices and announcements become dismissible compact rows (R4, R9).
4. **Landscape:** below a height of about 500 px, use a two-column layout (content left, dock and controls right). Shrink the HUD to one line and collapse the chat bar into the nav (R2).
5. **Map:** a minimum cell size of 32 to 44 px, with the map scrolling and panning inside its container, centred on the hero, plus a "centre on me" control. Add a list view of points of interest as a fallback (R6, A15).
6. **Chat drawer:** size to the visual viewport (`visualViewport` resize). Keep the input pinned above the keyboard, and test with a reduced viewport height (R5).
7. **Battle:** move the floating numbers away from the labels, and put the result summary next to the latest log line (R7, F3).
8. **Tablet and desktop (768 px and up):** an optional two-column game layout, for example the monster list next to the battle or location panel, while the phone layout stays the default (R8).
9. **Admin:** a tab bar that wraps or becomes a menu on narrow screens (R10).

### Phase 3: Interaction feedback (F1, F3, F6, A16)

- Standard pending, disabled, success, error and empty components, with one `aria-busy` pattern.
- Clearer distinction between the current turn, earlier turns and results.
- Subtle progress cues for XP, gold and mastery gains, with reduced-motion fallbacks.
- One styled confirmation dialog, built on `<dialog>`, for every destructive action. It states the consequence, for example "You will lose 10% of your gold if you lose". Server safeguards stay as they are.

### Phase 4: Admin console

- Admin styles move into a shared stylesheet section using the same tokens.
- Navigation that is visible and grouped (Players and moderation / World / Content / Staff).
- Responsive tables with real row actions, inline form validation messages, a moderation workflow (report → message → player → sanction) with fewer hops, and zone-editor usability (a sticky preview and clearer section headers).
- Permissions and API calls stay unchanged.

## 6. Decisions requested before Phase 1

1. **Dialogs:** OK to switch sheets and the chat drawer to native `<dialog>`? It's supported in all current mobile browsers, and it's what gives reliable focus trapping.
2. **UI test approach:** OK to add `playwright` and `axe-core` as **devDependencies** and test against intercepted (fake) Supabase responses rather than the live project?
3. **Message history:** a small "recent messages" list (last 10) reachable from the HUD, or keep toasts only but make errors stay until dismissed?
4. **`--faint` change:** raising it to pass AA makes older battle-log lines and timestamps noticeably brighter. Acceptable, or should the difference between new and old lines come from weight or size instead of dimness?
