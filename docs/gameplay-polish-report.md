# Gameplay polish GP-1: report

**Status: implemented; at the independent implementation review gate.** Nothing is deployed.
- **The F2 town rule needs its own production step.** It is in the shared engine, so the live server enforces it only after the `game` function is redeployed. That redeploy is **not** authorized here; under the scope's section 7, its authorization is obtained before the merge is scheduled.
- **Contract:** `docs/gameplay-polish-scope.md`, accepted at `9882a02` and merged as PR #50 (`cc736b5`).
- **Authorization:** the owner authorized GP-1 implementation on 2026-11-18 ("GP-1 authorized.").
- **Branch:** `claude/gp-1`, based on `main` at `cc736b5`.

## 1. What changed

| Item | Change | Where |
|---|---|---|
| **A. The XP cue plays once** | The hero bar is painted as three regions (identity and gold, HP, XP), so a regeneration tick that changes HP no longer recreates the XP meter or the gold, and their cues don't restart. `render()` still runs in full on each tick, so every HP display stays in step. | `main.js`: `HUD_SHELL`, `viewTop()` and `render()` |
| **B. Numbers on the bars** | Each meter is a taller bar, sized in rem, with its label and numbers on it, in white with a dark edge. The fills are darker (`--hp-bar`, `--xp-bar`, `--foe-bar`) so the white text meets 4.5:1 on the fill and on the track. When the full numbers don't fit, the short form shows (12,345 becomes 12.3K); with very large text in a narrow column, the label goes above the numbers on a taller bar. Screen readers always get the full numbers ("1,234,567 of 2,000,000"). The two hero-bar meters stack when each would be under 8.5rem, and the two battle sides wrap when each would be under 7rem (both only happen with large text on a phone). | `main.js`: `meter()`, `meterShort()` and `fitMeters()`; `style.css` |
| **C. Only the current round** | The log shows the current round. Earlier rounds are in a collapsed native `<details>`, **Earlier rounds (N)**, which stays open or closed for the rest of the fight and starts closed in a new one. The opening lines belong to the first round. After a reload, the lines already in the log go in **Before this page loaded (N lines)**: counted as lines, never presented as rounds. If the fight is still on, the current area says "Fight in progress, turn N." The stored log is never changed. | `log-view.js`: `logGroups()`; `main.js`: `logHtml()` and `trackChanges()` |
| **D. The outcome once** | Once a fight is over, the visible last round leaves out the reward and loss lines its card lists: the gold drop, gems, relics, masteries, XP and level for a victory; "You wake up in town, having lost …" for a defeat; the gold line for a duel. The narrative lines stay ("Victory! … has been slain!", "You have been defeated by …", and a duel's). A world boss's lines are never moved (a hunt's victory has no card, and its defeat line also says your damage still counts). A finished fight restored after a reload has no known last round, so nothing is hidden. | `log-view.js`: `cardLine()` |
| **E. A mastery gain, once** | The gain is stored with the round it happened in, and shows under that round only. When it moves into Earlier rounds, it stays under its round. A gain on the killing blow is listed in the Victory card instead. | `trackChanges()` and `logHtml()` |
| **F1. A native drop-down** | The tile's monsters are a labelled `<select>` ("Monster"), with options such as "Lv 9 Bog Hag, Trivial, Shadow", and a Fight button. Choosing starts nothing; only Fight does. The choice is kept across redraws, and defaults to the last monster fought on that tile. World-boss hunts stay as rows above it. The drop-down is never replaced while the monsters offered are the same (`data-keep` and `keepInPlace()` in `paint()`), so an open picker stays open and keeps focus. The arrow keys no longer move the hero while the drop-down has focus. On a phone, Fight goes under a full-width drop-down. | `main.js`: `monsterRows()`, `keepInPlace()` and the `fight` action; `style.css` |
| **F2. No roaming monsters in town** | `monstersHere()` offers no ordinary monsters on a zone's town tile. A lair boss on the same tile is still offered. `startBattle()` keeps its one `monstersHere()` check, so a valid lair boss in town is accepted, and gives "No roaming monsters can be fought in town. Move to another tile to hunt." only for an ordinary monster. World-boss hunts, duels and quests are unchanged. The town's screen shows the same message. | `engine/world.js` and `engine/battle.js`: shared with the server |

**Not changed:**
- the stored battle data and the engine's log text;
- the database, the API contracts and the entrance (the startup budget stays at 33,989 of 34,000);
- the Phase 1 to 4 accessibility work. The log stays `role="log"`, announcements are unchanged, and focus is kept across redraws (`focusKey`). The two new summaries have ids so they keep focus too.

## 2. Acceptance criteria (scope, section 8)

Each test was run against the old code where the scope asks for it.

| ID | Status | Test |
|---|---|---|
| GP-A1 | **Met.** One `xp-glow` and one `delta` start after a victory; the XP meter element survives an HP tick. Fails on `main`: the meter is replaced. | `tests/ui/gameplay-polish.test.mjs` |
| GP-A2 | **Met.** The bar's HP and the Heal price change on the same tick; at full HP, Heal is "Full health" and disabled. A guard against the A fix: **it passes on `main` too** (that code already kept them in step). | same |
| GP-B1 | **Met** at 320, 390, 1024 and 1440, explore and battle, with seven-digit HP and XP: nothing overflows, is cut off or wraps. On `main` the numbers wrap at 320 (section 3). | same |
| GP-B2 | **Met** at 320 and 390 with 200% text. | same |
| GP-B3 | **Met.** White on the fills: HP 6.34:1, XP 6.03:1, foe 6.45:1; on the track 19.76:1 (computed from the page's colours). | same |
| GP-B4 | **Met.** At 320, the XP meter shows the short form, its full numbers are in screen-reader text, and both visible forms are `aria-hidden`. | same |
| GP-B5 | **Met.** With reduced motion, the chips and the XP bar don't animate. | same |
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

**Runs:** three full runs of each suite, results in section 6.

## 5. Deviations from the scope

1. **B: `fitMeters()` measures in JS.** The scope proposed a container query and no JS measuring. Whether the numbers fit depends on their length and the label's, not only on the bar's width, so a container query would need guessed thresholds. `fitMeters()` measures after each render and on resize: a few reads per meter. It only toggles classes, so the XP meter isn't recreated (A holds).
2. **B: two layout fallbacks for very large text,** found by GP-B2:
   - the hero-bar meters stack when each would be under 8.5rem;
   - the battle sides wrap when each would be under 7rem.

   At normal text sizes the layout is unchanged (two meters, two sides, side by side, at 320 and up). There is also a third fit, `.stack`, with the label above the numbers on a taller bar.
3. **C: wording.** The scope's "Fight in progress, turn N." is used when turn N is known; at turn 0 it says "Fight in progress." The opening lines are part of Turn 1, not a separate group.
4. **F1: the phone layout.** Fight sits under a full-width drop-down when the drop-down would have less than 16rem; at 320 the side-by-side layout cut the monster's name.
5. **F1: arrow keys.** The game's arrow-key movement now ignores a focused `<select>`. Found by GP-F1: choosing with the arrows also moved the hero.
6. **GP-F2b: the update sources.** The players list refreshes only while it is the list on screen (`refreshPlayers()`), so it never redraws the drop-down. The test uses the updates that do: hunts, world events, regeneration and chat.
7. **One commit per item wasn't kept.** A, B, C, D, E and F1 all change `main.js` in interleaved places. The commits are instead: the F2 engine rule and its tests; the client changes; the test updates; the evidence and this report.
8. **GP-A2 passes on `main` too.** It guards the A fix against a regression (section 2), rather than detecting an old defect.

## 6. Runs and CI

Filled in below once the runs are complete.

## 7. Not verified

- Real phones and tablets, and the native picker on iOS and Android (the harness emulates touch in Chromium only).
- Screen readers. The announcement test reads the polite region's text; it doesn't listen with a screen reader.
- Firefox and Safari.
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
