# Gameplay polish GP-1: report

**Status: implemented, with the correction pass for scope amendment 1 (section 9); at the independent implementation review gate.** Nothing is deployed.
- **Amendment 1's acceptance gate:** the owner's check on the affected iPhone (scope 14.7), after this push. Its result is recorded in section 9.6 when reported.
- **The F2 town rule needs its own production step.** It is in the shared engine, so the live server enforces it only after the `game` function is redeployed. That redeploy is **not** authorized here; under the scope's section 7, its authorization is obtained before the merge is scheduled.
- **Contract:** `docs/gameplay-polish-scope.md`, accepted at `9882a02` and merged as PR #50 (`cc736b5`); amendment 1 (its section 14) accepted at `74dc4da` and merged as PR #52 (`99357cb`).
- **Authorization:** the owner authorized GP-1 implementation on 2026-11-18 ("GP-1 authorized."), and the correction pass for amendment 1 the same day ("Merge PR #52, then start the GP-1 correction pass").
- **Branch:** `claude/gp-1`, based on `main` at `cc736b5`.

## 1. What changed

| Item | Change | Where |
|---|---|---|
| **A. The XP cue plays once** | The hero bar is painted as three regions (identity and gold, HP, XP), so a regeneration tick that changes HP no longer recreates the XP meter or the gold, and their cues don't restart. `render()` still runs in full on each tick, so every HP display stays in step. | `main.js`: `HUD_SHELL`, `viewTop()` and `render()` |
| **B. Numbers on the bars** | Each meter is a taller bar, sized in rem, with its label and numbers on it, in white with a dark edge. The fills are darker (`--hp-bar`, `--xp-bar`, `--foe-bar`) so the white text meets 4.5:1 on the fill and on the track. When the full numbers don't fit, the short form shows (12,345 becomes 12.3K); with very large text in a narrow column, the label goes above the numbers on a taller bar. Screen readers always get the full numbers ("1,234,567 of 2,000,000"). The two hero-bar meters stack when each would be under 8.5rem, and the two battle sides wrap when each would be under 7rem (both only happen with large text on a phone). | `main.js`: `meter()`, `meterShort()` and `fitMeters()`; `style.css` |
| **C. Only the current round** | The log shows the current round. Earlier rounds are in a collapsed native `<details>`, **Earlier rounds (N)**, which stays open or closed for the rest of the fight and starts closed in a new one. The opening lines belong to the first round. After a reload, the lines already in the log go in **Before this page loaded (N lines)**: counted as lines, never presented as rounds. If the fight is still on, the current area says "Fight in progress, turn N." The stored log is never changed. | `log-view.js`: `logGroups()`; `main.js`: `logHtml()` and `trackChanges()` |
| **D. The outcome once** | Once a fight is over, the visible last round leaves out the reward and loss lines its card lists: the gold drop, gems, relics, masteries, XP and level for a victory; "You wake up in town, having lost …" for a defeat; the gold line for a duel. The narrative lines stay ("Victory! … has been slain!", "You have been defeated by …", and a duel's). A world boss's lines are never moved (a hunt's victory has no card, and its defeat line also says your damage still counts). A finished fight restored after a reload has no known last round, so nothing is hidden. | `log-view.js`: `cardLine()` |
| **E. A mastery gain, once** | The gain is stored with the round it happened in, and shows under that round only. When it moves into Earlier rounds, it stays under its round. A gain on the killing blow is listed in the Victory card instead. | `trackChanges()` and `logHtml()` |
| **F1. A native drop-down** | The tile's monsters are a labelled `<select>` ("Monster"), with options such as "Lv 9 Bog Hag, Trivial, Shadow", and a Fight button. Choosing starts nothing; only Fight does. The choice is kept across redraws, and defaults to the last monster fought on that tile. World-boss hunts stay as rows above it. The drop-down is never replaced while the monsters offered are the same (`data-keep` and `keepInPlace()` in `paint()`), so an open picker stays open and keeps focus. The arrow keys no longer move the hero while the drop-down has focus. | `main.js`: `monsterRows()`, `keepInPlace()` and the `fight` action; `style.css` |
| **F2. No roaming monsters in town** | `monstersHere()` offers no ordinary monsters on a zone's town tile. A lair boss on the same tile is still offered. `startBattle()` keeps its one `monstersHere()` check, so a valid lair boss in town is accepted, and gives "No roaming monsters can be fought in town. Move to another tile to hunt." only for an ordinary monster. World-boss hunts, duels and quests are unchanged. The town's screen shows the same message. | `engine/world.js` and `engine/battle.js`: shared with the server |

**Not changed:**
- the stored battle data and the engine's log text;
- the database, the API contracts and the entrance (the startup budget stays at 33,989 of 34,000);
- the Phase 1 to 4 accessibility work. The log stays `role="log"`, announcements are unchanged, and focus is kept across redraws (`focusKey`). The two new summaries have ids so they keep focus too.

## 2. Acceptance criteria (scope, section 8)

Each test was run against the old code where the scope asks for it.

| ID | Status | Test |
|---|---|---|
| GP-A1 | **Met.** One `xp-glow` starts after a victory; the XP meter element survives an HP tick. Fails on `main`: the meter is replaced. The "+XP" chip it also checked is now a floating cue, checked by GP-B7 (section 9). | `tests/ui/gameplay-polish.test.mjs` |
| GP-A2 | **Met.** The bar's HP and the Heal price change on the same tick; at full HP, Heal is "Full health" and disabled. A guard against the A fix: **it passes on `main` too** (that code already kept them in step). | same |
| GP-B1 | **Met** at 320, 390, 1024 and 1440, explore and a world-boss hunt (the only fight with a bar since amendment 1), with seven-digit HP and XP: nothing overflows, is cut off or wraps. On `main` the numbers wrap at 320 (section 3). | same |
| GP-B2 | **Met** at 320 and 390 with 200% text, explore and a world-boss hunt. | same |
| GP-B3 | **Met.** White on the fills: HP 6.34:1, XP 6.03:1, foe 6.45:1 (now on the world boss's Shared HP bar); on the track 19.76:1 (computed from the page's colours). | same |
| GP-B4 | **Met.** At 320, the XP meter shows the short form, its full numbers are in screen-reader text, and both visible forms are `aria-hidden`. | same |
| GP-B5 | **Met.** With reduced motion, the floating cues and the XP bar don't animate, and the cues stay for the same 1.6 s. | same |
| GP-C1 | **Met.** After three actions, one round is visible; "Earlier rounds (2)" is closed and holds Turns 1 and 2. | same |
| GP-C2 | **Met.** Open stays open through a tick and the next action; a new fight starts it closed. | same |
| GP-C3 | **Met.** The page's log equals the server's, reward lines included. | same |
| GP-C4 | **Met.** After a reload mid-fight, "Before this page loaded (N lines)" holds all N lines with no turn labels. The page says "Fight in progress, turn 2." The next action is Turn 3, and no earlier rounds are invented. | same |
| GP-D1 | **Met** in the browser, and in Node on 400 real engine victories: every reward line is recognized (gold, mastery, XP, gem, level). Relics were too rare to appear in those runs, so they are covered by the rule test only. | same, and `tests/log-view.test.mjs` |
| GP-D2 | **Met** for a defeat and a duel won or lost, in the browser and in Node on the engine's own output. World-boss lines are never moved. | same |
| GP-D3 | **Met.** In the polite announcements, each reward and loss line appears once. | `tests/ui/gameplay-polish.test.mjs` |
| GP-D4 | **Met.** The Phase 3 defeat and duel tests still pass, including the duel's losses. | `tests/ui/feedback.test.mjs` |
| GP-D5 | **Met.** A finished fight after a reload shows every stored line, in order, unfiltered, with its card. | `tests/ui/gameplay-polish.test.mjs` |
| GP-E1 | **Met.** A gain raised mid-fight is under its own round, not the next one, even with the next action inside the old 2.6 s window. | same |
| GP-F1 | **Met.** By keyboard: the arrow keys choose (no `fight` call and the hero doesn't move); Tab to Fight and Enter fights the chosen monster. | same |
| GP-F2 | **Met.** The choice survives a regeneration tick and switching lists; after a fight it returns to the monster fought. | same |
| GP-F2b | **Met** off town and on a town-and-lair tile. The clock is moved on 31 seconds, so the hunts and world events refresh and change the screen, with regeneration ticks and a chat message alongside. The focused `<select>` is the same element, still focused, with its value. On the town-and-lair tile the Heal price changed meanwhile. | same |
| GP-F3 | **Met.** Hunts are rows above the drop-down and still start a hunt (the fake backend now answers `hunt`). | same |
| GP-F4 | **Met.** In every built-in zone's town, no monsters are offered and fights are refused with the town message; one step out they're back. Unchanged: the lair boss off town, a hunt started in town, and duels refused in town. | `tests/town-rule.test.mjs` |
| GP-F4b | **Met.** A synthetic zone with its lair on its town tile offers only the boss there, accepts the boss, and refuses an ordinary monster with the town message. | same |
| GP-F5 | **Met.** On an ordinary town tile: the message, and no drop-down or Fight control. | `tests/ui/gameplay-polish.test.mjs` |
| GP-F5b | **Met.** On the town-and-lair tile: the message, a drop-down with only "Lv 5 The Undercroft King, Trivial, boss", and Fight starts the boss fight. | same |
| GP-F6 | **Written; runs in CI's `database` job only** (no Docker here). The real `game` function on the local stack refuses a town fight with the message and allows one a step out. | `tests/db/town-rule-api.test.mjs` |
| GP-X1 | **Met.** Axe at all impacts: 0 violations on the evidence's 27 after screens (section 3), and in the GP-1 tests at 320 and 1440. | `tools/gp-evidence.mjs` and the tests |

## 3. Evidence, before and after

`tools/gp-evidence.mjs` measured both versions the same way, on the fake backend: `main` at `9827ce1` (through `UI_PUBLIC_DIR`), and this branch. The screenshots and `summary.json` are in `docs/ui-audit/gameplay-polish/before/` and `after/`.

| Measure | Before | After |
|---|---|---|
| A: XP glow starts after one victory, with regeneration running | 2 | 1 |
| A: "+XP" chip starts | 2 | 1 |
| A: XP meter element replaced by a regeneration tick | yes | no |
| B: meters cut, overflowing or wrapped, 320, seven-digit numbers (explore / battle) | 2 / 3 | 0 / 0 |
| B: the same, 320 just after a victory at five-digit XP (the owner's case, with the "+1 XP" chip) | 1 | 0 |
| B: the same at 200% text (320 / 390) | 2 / 2 | 0 / 0 |
| B: every other size (390, 1024, 1440; five and seven digits) | 0 | 0 |
| C: rounds visible after three actions (390 / 1440) | 3 / 3 | 1 / 1 |
| D: visible lines repeating the Victory card (390 / 1440) | 3 / 3 | 0 / 0 |
| D: repeating the Defeated card (390 / 1440) | 1 / 1 | 0 / 0 |
| D: repeating a lost duel's card | 1 | 0 |
| F: Fight controls on the town tile (320, 390, 1440) | 8 | 0 |
| F: Fight controls one step out | 8 (one per row) | 1 (the drop-down's Fight) |
| Axe violations, any impact (25 screens before; 27 after, with Earlier rounds open, which the old version doesn't have) | 0 | 0 |

**The overflow measure was corrected before use.** Its first version counted 0 on the old code, so I checked the screenshot rather than trust it. The old numbers didn't run off sideways; they **wrapped** ("HP1,999,086 /" then "2,000,320", and "Lv" above "60"). The measure now also counts a label or number broken across lines, and finds the old defect. Its five-digit case first levelled the hero up and hid the bar behind the level-up sheet. It now uses level 33, where 10,234 XP stays five digits, and reproduces the owner's report: "990 / 9,743" wrapping beside the "+1 XP" chip at 320.

## 4. Tests

- **Engine and file tests: 63** (51 before):
  - the town rule, 5 (`tests/town-rule.test.mjs`);
  - the log presentation rules, 7 (`tests/log-view.test.mjs`);
  - two engine tests that fought a new hero in town now step out first.
- **Browser: 238** (208 before):
  - 30 new GP-1 tests (`tests/ui/gameplay-polish.test.mjs`).
  - Existing tests updated where the change requires it:
    - **The hero's position:** tests that fight start one step out of town, or step out first (desktop, desktop keys, desktop chat, game, entrance, feedback). Each place says why.
    - **Choosing a monster:** tests that chose one from the rows use the drop-down.
    - **Phase 2's "monster rows in view" metrics** (responsive AC-1, 2, 3, 6 and 7) now check that the drop-down and Fight are in view, and that the town shows its message (`PAGE_METRICS` gains `pickVisible` and `calmVisible`).
    - **D-1's long fight** opens Earlier rounds so the log still fills and scrolls.
    - **Two Phase 3 log tests** open Earlier rounds, or skip a mastery-gain line, to find the earlier rounds' lines.
- **Database:** pgTAP 42, plus API 13 (12 before; GP-F6). CI only.
- **The harness:**
  - `townLairZone()`, a fixture;
  - a `hunt` action in `FakeBackend`, mirroring `startHuntBattle`.

  The fake backend runs the real engine, so it now refuses town fights as the redeployed server will.
- **Tools:** `tools/desktop-metrics.mjs` starts its fight one step north of the village; its explore numbers are still measured in the village. `tools/ui-states.mjs` uses the drop-down.

**Runs:** three full runs of each suite; the results are in section 6.

## 5. Deviations from the scope

1. **B: `fitMeters()` measures in JS.** The scope proposed a container query and no JS measuring. Whether the numbers fit depends on their length and the label's, not only on the bar's width, so a container query would need guessed thresholds. `fitMeters()` measures after each render and on resize: a few reads per meter. It only toggles classes, so the XP meter isn't recreated (A holds).
2. **B: two layout fallbacks for very large text,** found by GP-B2:
   - the hero-bar meters stack when each would be under 8.5rem;
   - the battle sides wrap when each would be under 7rem. **Kept after amendment 1** (section 9.4): the sides no longer hold HP bars, but the names still need the room at 200% text, and a world boss's side holds its Shared HP bar, which GP-B2 checks at 200%.

   At normal text sizes the layout is unchanged (two meters, two sides, side by side, at 320 and up). There is also a third fit, `.stack`, with the label above the numbers on a taller bar.
3. **C: wording.** The scope's "Fight in progress, turn N." is used when turn N is known; at turn 0 it says "Fight in progress." The opening lines are part of Turn 1, not a separate group.
4. **F1: the phone layout.** Fight sits beside the drop-down at every width. A first version put Fight under a full-width drop-down on phones, so names showed in full; that made the picker 150px tall, and on Windows Chromium it no longer fit in view at 320x640 (CI, responsive AC-1). With one row it is 98px tall. At 320px a long entry is clipped in the closed drop-down; the open list and screen readers give it in full.
5. **F1: arrow keys.** The game's arrow-key movement now ignores a focused `<select>`. Found by GP-F1: choosing with the arrows also moved the hero.
6. **GP-F2b: the update sources.** The players list refreshes only while it is the list on screen (`refreshPlayers()`), so it never redraws the drop-down. The test uses the updates that do: hunts, world events, regeneration and chat.
7. **One commit per item wasn't kept.** A, B, C, D, E and F1 all change `main.js` in interleaved places. The commits are instead: the F2 engine rule and its tests; the client changes; the test updates; the evidence and this report.
8. **GP-A2 passes on `main` too.** It guards the A fix against a regression (section 2), rather than detecting an old defect.

## 6. Runs and CI

**Local:** three full runs on `0dcfb5a`, in this Linux container.

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 63 of 63 | 238 of 238 |
| 2 | 63 of 63 | 237 of 238: `PR-4a a second tab with the saved session also shows the form` timed out (see below) |
| 3 | 63 of 63 | 238 of 238 |

**The run 2 failure isn't GP-1's, but its cause isn't established.**
- **The failure:** the password-recovery test's second tab waited 15 s for "Choose a new password", and timed out.
- **Not GP-1's:** GP-1 doesn't touch the entrance or the recovery code. The same test timed out on PR #50's docs-only commit too (CI run `44368408591`, which passed on its one re-run).
- **Not dismissed as a flake:** it is recorded as a follow-up in `docs/backlog.md`, and the test is unchanged.
- **Every GP-1 test passed in all three runs.**

**CI:** run `44376183579`, head `0dcfb5a`, tested merge commit `16ea0cd`. These counts come from the job logs.
- `engine`: 63 of 63.
- `database`: 42 of 42 pgTAP, and 13 of 13 API tests, including GP-F6 against the real `game` function.
- `browser` (Windows Chromium): 238 of 238.

**The earlier head, `a060d0b`** (run `44373672791`), failed responsive AC-1 on Windows: the wrapped picker was out of view at 320x640. That was fixed in `0dcfb5a` (deviation 4).

**Later runs, after `main` was merged in** (PR #52, scope amendment 1; no code change):
- **`b60c6ae`** (run `44410857655`): `R1-02 an expired link (error_code only)…` failed.
  - **The cause, from `diag.json`:** the request for `/js/data/items.js` failed with `net::ERR_NO_BUFFER_SPACE`, a Windows socket-buffer error on the runner.
  - **Not GP-1's:** GP-1 doesn't touch that file. It is recorded in `docs/backlog.md`.
- **`ff8581a`** (run `44412658529`): **GP-A1 failed, a timing gap in that test, not in the fix.**
  - **What happened:** the test held the XP meter, then waited for the next HP regeneration tick. Regeneration ticks every 3 s, but the "+XP" chip is removed after 2.6 s, and removing it is itself a change to the XP meter (it is redrawn, with no cue). On the Windows runner the chip's removal came before the HP tick, so the test saw a new meter.
  - **The correction:**
    - while the chip shows, any HP change must leave the meter in place, and the cue must start once;
    - then, with the chip gone, a fresh hold of the meter must survive the next HP tick.
  - **Results:** the corrected test passed 3 of 3 runs locally. Against `main` (through `UI_PUBLIC_DIR`) it still fails: "an HP change while the chip showed did not recreate the XP meter". To make that old-code run possible, the test's fight helper now also drives the old monster rows.

## 7. Not verified

- Real phones and tablets, and the native picker on iOS and Android (the harness emulates touch in Chromium only). **Amendment 1's iPhone check** is the owner's, after this push (section 9.6).
- Screen readers. The announcement test reads the polite region's text; it doesn't listen with a screen reader.
- Firefox and Safari. The WebKit behaviour amendment 1 fixes can't be reproduced in Chromium (section 9.6).
- **The live server's enforcement of F2.** It begins only after the authorized function redeploy (scope, section 7). Until then, the live server still accepts a town fight from an old or modified page.
- GP-F6 locally (no Docker here); CI's `database` job runs it.

## 8. Deployment, when authorized (scope, section 7)

1. **Before the merge is scheduled:** obtain the owner's authorization for the function redeploy.
2. **Merge.** Netlify publishes the client.
3. **Right after Netlify's deploy:** run `npm run deploy:functions` from the merged `main` (needs `SUPABASE_ACCESS_TOKEN`).
4. **Verify on the live site:**
   - no monster drop-down on a town tile;
   - a fight starts one step out.
5. **Rollback:** revert the merge, then redeploy the functions from the reverted `main`. No data is involved.

## 9. Review corrections: scope amendment 1

**What started it:** the owner's iPhone testing of this PR's deploy preview found the XP bar's label cut off after a win. The cause was measured on the phone: WebKit keeps a meter label's one-line width after `fitMeters()` switches the bar to two lines (scope, 14.1 and 14.2). The owner then decided G1 to G3 (scope, 14.3), and the amendment was accepted at `74dc4da` and merged as PR #52 (`99357cb`). This branch took it by merging `main` (`5b48991`), with no rebase.

### 9.1 What changed

| Item | Change | Where |
|---|---|---|
| **G1. Floating cues** | The "+XP" and gold cues are no longer in the hero bar's text. Each change floats over what it changed: "+767 XP" centred over the XP bar, and a gold change over the gold amount, aligned to its right edge. Gold goes both ways, as before: a gain in light green ("+244"), a loss or spend in the muted colour ("-120"). A cue is created once per change, directly in `#top`, which redraws never replace, so a regeneration tick can't restart it. It rises 0.5rem without fading and is removed after 1.6 s (`CUE_MS`); with reduced motion it stays still for the same time. It is `aria-hidden`, as the chips were. The XP bar's glow keeps its own timing (`DELTA_MS`, 2.6 s, for a 1.2 s glow). The XP meter's label is now only "Lv N". | `main.js`: `showCues()`, `floatCue()`, `viewTop()`, `trackChanges()`; `style.css`: `.cue` |
| **Fix A. Two-line meters** | On two lines (`.stack`), the label and the numbers each take the bar's full width (`align-self: stretch`), right-aligned on a world boss's bar. `fitMeters()` measures each part by its text's own width (a `Range` for the label, the visible number form's box for the numbers) rather than `scrollWidth`, which a box kept from the previous layout could inflate. | `main.js`: `fitMeters()`, `textWidth()`; `style.css` |
| **G2 and G3. The fight screen** | No HP bars on the fight screen: neither yours (ordinary fights, duels and hunts) nor the monster's. The world boss's Shared HP bar stays. Each side keeps its name and sub-line, and a strip (`.side-fx`) below them where the damage numbers, critical hits and misses float. A world boss's strip holds the Shared HP bar at its foot. The battle data is unchanged; the monster's HP is still sent by the server and only not shown. | `main.js`: `viewBattle()`, `viewHuntBattle()`, `floatText()`; `style.css`: `.side-fx`, `.float` |

### 9.2 Acceptance criteria (scope, 14.6)

The new tests were run against this PR's previous head, `59da88f`, through `UI_PUBLIC_DIR`: every new one fails there, and passes here.

| ID | Status | Fails on `59da88f` because |
|---|---|---|
| GP-B6 | **Met.** In the owner's case (level 62, 23,516 XP, a win in Cinderspire Caldera), just after the win the XP meter's label is "Lv 62"; while the cue shows, the meter's fit is the same as after it has gone, and the cue isn't inside the meter. | the label just after the win is "Lv 62+71 XP": the chip is in it |
| GP-B7 | **Met.** The next one-second tick is made to regenerate HP as soon as the cue appears; when it repaints the HP meter, the cue is still attached, its animation has started once, and its opacity is 1. It is removed 1.5 to 3 s after it appeared (1.6 s, with room for a slow runner's timers), and two more ticks don't bring it back. | there is no floating cue to hold (the old chip's single start was GP-A1's) |
| GP-B8 | **Met** for a gain (a win) and a spend (a Heal): "+N" in the light green and "-N" in the muted colour, each at least 4.5:1 on its backing over the hero bar; the gold line is the same width just after the change as once it's over. | the chip widened the gold line: 140 px just after a win and 143 px after a Heal, against 119 px later |
| GP-B9 | **Met.** With the hero bar's columns narrowed to force two lines, each two-line meter's label and numbers are as wide as the bar's text area. | the label's box was its text's width (27 px on a 76 px bar) |
| GP-H1 | **Met.** An ordinary fight has no meter in the fight area; each side has its strip; over three rounds, damage numbers and misses float on both sides, all in their strips. | both HP bars are there |
| GP-H2 | **Met.** A world-boss hunt shows only "Shared HP", in the boss's strip, and nothing on your side. | your HP bar is there |
| GP-H3 | **Met.** A duel shows no meters. | your HP bar is there |
| GP-H4 | **Met** at 390, and at 320 with 200% text: a critical hit ("1,234!"), a miss and a damage number, placed in each side's strip and held at the start and the end of their rise, don't touch the name or the sub-line and stay inside the strip and the fight area. | there is no strip |

**Changed:**
- **GP-A1, GP-B1, GP-B2, GP-B3, GP-B5:** as in section 2.
- **GP-A1 also takes the correction made in parallel on this branch** (`05c9665`, section 6: on the Windows runner, the chip's removal at 2.6 s redrew the XP meter before the next HP tick). With the chip gone, the same gap is the glow's: removing the `gain` class at 2.6 s redraws the meter. So the test now watches the meter through any HP change while the bar glows, then holds a fresh meter across the next HP tick. It still fails on `main` at `9827ce1` ("an HP change while the bar glowed did not recreate the XP meter"). The merged branch's test file passed 40 of 40 in each of three runs.
- **GP-A2:** its test never read the fight's HP bar, so it is unchanged. As the scope asks, your HP during a fight is now checked in the hero bar: GP-H1 checks it shows your current HP after the rounds. HP doesn't regenerate during a fight, so it changes with the hits taken.
- **The Phase 3 feedback test** reads the floating cues through the harness's new `watchCues()` instead of the chips, and its reduced-motion check uses a `.cue`.

**The harness:** `watchCues(page)` records each cue as it is added to the hero bar: its text, classes and computed style, the XP meter and gold line at that moment, how many times its animation started, and when it was added and removed. A cue lives 1.6 s, so tests read the record instead of racing to find it.

### 9.3 Evidence

`tools/gp-evidence.mjs` measured this PR's previous head, `59da88f` (through `UI_PUBLIC_DIR`), and this pass the same way, on the fake backend. It gained amendment 1's measures: the owner's case after a win at 390 and 1440, an ordinary fight, a world-boss hunt and a duel won. The screenshots and `summary.json` are in `docs/ui-audit/gameplay-polish/amendment-before/` and `amendment-after/`.

| Measure | Before (`59da88f`) | After |
|---|---|---|
| G1: cues inside the hero bar's text just after the owner's win (390 / 1440) | 2 / 2 | 0 / 0 |
| G1: the XP meter's label then (390 and 1440) | "Lv 62+71 XP" | "Lv 62" |
| A: the XP glow, and the "+XP" cue (chip before, floating after), starts after one victory with regeneration running | 1 and 1 | 1 and 1 |
| A: XP meter element replaced by a regeneration tick | no | no |
| G2: bars on an ordinary fight screen | 2 | 0 |
| G2: bars on a world-boss hunt screen | 2 (HP, Shared HP) | 1 (Shared HP) |
| G2: bars on a duel screen | 1 | 0 |
| Every earlier measure (B, C, D and F, section 3) | the same value in both runs; every B count is 0 | the same |
| Axe violations, any impact (30 screens each) | 0 | 0 |

**What the screenshots show:**
- **`390-victory-owner-case-cues`:** "+71 XP" floats over the XP bar and "+244" over the gold, each on its dark backing; the bar's label is "Lv 62". Before, the chip sat in the label.
- **`390-fight-no-bars`:** the two sides with their names and sub-lines, and the damage numbers in their strips.
- **`390-hunt`:** the Shared HP bar at the foot of the boss's strip, and nothing on your side.

The fake backend's win gives +71 XP, not the +767 the owner saw live, so the cue is shorter here than on the phone.

### 9.4 Deviations

9. **GP-B9 forces two lines with narrow columns,** not with 200% text at 320 as the scope's test column says. At 320 with 200% text, the hero bar stacks its two meters at full width, and both fit on one line, so no meter goes onto two lines there (checked with the default hero and with seven-digit numbers). The test narrows the hero bar's columns to 5.5rem with a test stylesheet instead.
10. **The strip is 2.25rem, not about 1.5rem.** The review asked for room for the largest indicator without clipping or overlap. A critical hit is 1.75rem text, set at line-height 1, and rises 0.5rem, so it needs 2.25rem. Scaled in rem, it holds at 200% text (GP-H4).
11. **The damage numbers rise 0.5rem instead of 26px,** so they stay in their strip. They still fade out as before (unchanged in amendment 1; `aria-hidden`, and excluded from axe as before).
12. **The battle sides' wrap rule is kept** (deviation 2): the names still need room at 200% text, and a world boss's side holds its Shared HP bar.
13. **GP-B5 and GP-B7 depend on real time.** They check that a cue is removed 1.5 to 3 s after it appears (1.6 s by design), and GP-B7 needs the regeneration tick, at most a second away, to come while the cue shows. The page's fake clock wasn't used: it would also freeze the 250 ms double-tap guard the fights rely on. The upper bound leaves room for a slow runner; the lower bound still catches a cue removed early.

### 9.5 Runs and CI

**Local:** three full runs on `8bb120f`, on the owner's Windows laptop. The merge of the parallel commits that followed changed only GP-A1 and the test file's fight helper, and that file was run three more times on the merge (40 of 40 each); CI runs the full suites on the pushed head.

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 63 of 63 | 248 of 248 |
| 2 | 63 of 63 | 248 of 248 |
| 3 | 63 of 63 | 248 of 248 |

**The browser count is now 248** (238 in section 4): GP-B6, GP-B7, GP-B8 twice, GP-B9, GP-H1, GP-H2, GP-H3 and GP-H4 twice. The engine tests are unchanged.

**CI:** recorded on PR #51 once the run on this push completes.

### 9.6 Not verified

- **The iPhone.** CI and the local suites run in Chromium, where the old code also measures correctly. GP-B9 checks fix A's effect in Chromium; it can't show WebKit's behaviour. The owner's check on the same iPhone (scope 14.7) is the acceptance gate:
  1. the check page, version 3, with this pass's `meter()`, `fitMeters()` and meter CSS;
  2. on this PR's deploy preview: a win (the cue floats; nothing in the bar is cut off), a fight (no HP bars; the damage numbers float), and turning the phone to landscape and back.

  The check page copies the code at `60160a9` (this pass's client commit), and its results will name the version. **Result:** pending; recorded here when the owner reports it.
- **Android,** other iPhone sizes, and Safari outside the Claude app's browser.
- **Damage numbers over a world boss's Shared HP bar.** In a hunt they float in the boss's strip, over the bar at its foot, as they floated over it before. GP-H4 checks an ordinary fight's strips, not a hunt's.
- **A cue's position if the layout changes while it shows** (for example turning the phone mid-cue): it is placed once, when it appears, and is gone 1.6 s later.
- **Screen readers:** unchanged behaviour (the cues are `aria-hidden`, as the chips were); not listened to.

