# UI modernization — Phase 3 report: interaction feedback

Branch `claude/ui-phase-3-feedback`, based on `main` at f3fad5d (Phase 2 merged).
Scope is the six approved Phase 3 items.
It keeps the vanilla JS architecture, the design language, the game rules, the API contracts and the Phase 1–2 accessibility work.
No server code, database or production dependency changed.

## Summary

| Item | Result |
|---|---|
| 1. Standard states | **Pending:** one pattern (`.pending` + `aria-busy="true"` on the pressed control, `data-busy` on `#app`). It now survives re-renders and no longer fails contrast. **Empty and loading:** one component (statement, then what to do; loading carries `aria-busy`). **Disabled:** controls state their reason. **Success:** the toast. **Info:** a new neutral toast kind. **Errors:** the Phase 1 persistent alerts and inline field messages. |
| 2. Battle double-tap guard | A tap that isn't acted on now says so. While an action is running: "Still working on your last action." Within 250ms of the previous action: "Second tap ignored, so you only acted once." The control gets a small nudge (an outline with reduced motion). Nothing extra is sent. |
| 3. Combat log | Lines are grouped by turn ("Turn 3"). The current turn is a highlighted block and earlier turns step back. The fight ends with an outcome block next to the actions: Victory with reward chips (XP, gold, gem, relic, mastery, level), Defeated with formatted losses, or "You got away". |
| 4. XP, gold, mastery cues | After an action, the HUD briefly shows `+32` beside gold and `+63 XP` in the XP meter, and the XP bar glows. Mastery gains show inside the current turn ("Armor mastery 1"). With reduced motion nothing moves; the cues still appear, then go. |
| 5. `confirm()` and `prompt()` replaced | All 16 browser `confirm()`/`prompt()` calls (game, chat, admin, zone editor) are replaced by one accessible `<dialog role="alertdialog">` component, `public/js/confirm.js`. **No native dialog appears in any test.** |
| 6. Consistent confirmation rules | Four tiers, below. Two copy defects were fixed: the PvP stakes and the zone-delete consequences. Selling an item with socketed gems now asks first. Server safeguards are unchanged. |

## Confirmation rules

Every confirmation names the thing and lists the consequences. Cancelling (button, Escape, or a tap outside) sends nothing and returns focus to the control that asked. The server still enforces its own checks; a confirmation is only a chance to change your mind.

| Tier | When | How it asks | Actions |
|---|---|---|---|
| **1. Irreversible and severe** | Permanently removes a hero, a player's access, or a zone | Danger dialog; **the name must be typed** (any letter case) before the confirm button unlocks | Delete hero; permanent ban (admin); delete zone (admin) |
| **2. Destructive or risky** | Loses something, risks gold, or affects another player | Danger dialog; **focus starts on the safe choice** | Attack a player; abandon a quest; sell an item with socketed gems; remove a chat message (moderator, game or admin); timed mute, jail or ban, warn; remove an item from a hero; delete news; end an event; cancel a hunt; remove staff; restore a built-in zone |
| **3. Deliberate, recoverable or creating** | Worth a moment's thought but easily undone or additive | Normal dialog; focus starts on the confirm button | Ignore a player (undo from the ignore list); report a message (optional reason, replacing `prompt()`); lift sanctions; start a hunt |
| **4. Cost shown on the control** | A trade at a price you can already see | **No dialog**: the price is on the button and in the result message | Heal, buy, sell (no gems), extract a gem, travel, deposit or withdraw, spend level points |

A delete the server would refuse is explained, not asked about. The zone editor runs the same `deleteBlockers()` check the server uses, so a blocked delete shows the reason (for example "Elf heroes start here.") instead of opening a confirmation.

### Copy defects found and fixed

- **PvP stakes were understated.** The old prompt said "The loser drops 10% of their gold." The engine (`duel()` and `deathPenalty()`, unchanged) makes the loser drop **all carried gold** and up to 20% of a level's experience. The new dialog computes the real figures with the same `deathPenalty()` rule on a copy of the hero. For example: "If you lose, you drop all 4,321 gold you carry, lose 500 experience and wake up in town."
- **Zone delete.** The old prompt said heroes "will be moved somewhere safe." That is true, but it happens the next time they act. It also didn't mention that active world-boss hunts in the zone are cancelled. Both are now stated.

## Interaction states

- **Pending.** `runRemote` records the pressed control's key, and `markPending()` re-applies `.pending` and `aria-busy="true"` after every render. Before, the class was lost whenever the screen re-rendered, for example on the regeneration tick every second.
  - The indicator is a running bar along the bottom edge, still with reduced motion. The old opacity pulse dropped the label to 55% opacity, and **axe reported `color-contrast` (serious) on the pending state** (`docs/ui-audit/phase-3/axe-states-before.json`). The text now keeps full contrast.
  - Map squares and list rows get the same treatment.
- **Refused taps.** `refuse(el, why)` nudges the control (`.refused`, or a dashed outline with reduced motion), gives a short vibration if enabled, and shows a neutral **info** toast. The toast is `role="status"`, so screen readers hear it too.
- **Empty and loading.** `emptyState(title, hint, { loading })` replaces 9 ad-hoc `<p class="empty">` lines in the game and chat. Each states what is or isn't there, then what to do; loading states are marked `aria-busy="true"`.
- **Disabled.** Controls say why: "Full health", "Level 30 needed", "Unequip to sell", and now "Fight again / None left here", which used to be a bare disabled button.
- **Success, info and error.**
  - Success: the toast (gold border).
  - Info: the toast (neutral).
  - Errors: the Phase 1 persistent alerts and inline field messages, unchanged.
- **No fading text.** The toast, the confirmation card and the HUD cues appear with movement only, never opacity. Text at partial opacity fails contrast. During this work, axe intermittently caught a toast mid-fade.

## Battle presentation

- **Turns.** The server log has no turn markers, and the API is unchanged. The client records where each melee, cast or flee began in the log, together with the battle's `turn` counter. After a page reload mid-fight, earlier lines show as before (last four bright) and grouping resumes from the next turn.
- **Current turn.** A raised block with a gold edge and a "Turn N" label; the newest line is the largest. Earlier turns are smaller and muted, each with its own label.
- **Outcome.**
  - Victory: reward chips from the battle's `rewards` and `masteryUps`.
  - Defeat: the losses, read from the closing log lines and formatted ("Lost 1,234,567 gold").
  - Duels: the gold taken.
  - Fleeing: "You got away".
  - The block follows the log, next to the next action.
- **Change cues.** The `+gold` and `+XP` chips are `aria-hidden`; the log, the outcome and the per-action announcement (Phase 1) already say the same. They disappear 2.6s after the action.

## Tests

- `npm test` (engine): 24 of 24 pass.
- `npm run test:ui`: **52 of 52 pass**, 9 consecutive runs (see validation below).
  - The 39 Phase 1–2 tests pass. The chat-ignore test now presses Confirm in the new dialog instead of relying on the harness accepting `confirm()`.
  - **13 new tests** in `tests/ui/feedback.test.mjs`:
    - Delete hero (type the name, Escape cancels, focus restored, axe on the dialog).
    - Attack (real stakes, safe default, tap outside cancels).
    - Abandon quest (quest and reward named; the board stays open underneath).
    - Selling (asks only when gems would be destroyed; Escape closes only the question).
    - Chat report (dialog replaces `prompt()`, the reason is sent).
    - Admin sanctions (permanent ban needs the name; a timed mute doesn't; cancel sends nothing; axe).
    - Admin zones (a blocked delete is explained; restore asks).
    - Pending (busy across re-renders, no axe violations, refused tap announced, nothing extra sent).
    - Double tap (one request, message shown).
    - Battle turns and victory (groups, current turn, reward chips equal the battle's rewards, HUD cues appear and go).
    - Defeat (formatted losses).
    - Reduced motion (cues and bars hold still; refusals use an outline).
    - Empty and loading pattern.
  - **Every new test fails against `main`'s `public/`**, because the feature or message is missing there (`UI_PUBLIC_DIR=<main checkout>/public`).
- **Harness additions** (tests only):
  - `backend.hold(action)` keeps a request waiting, for deterministic pending states.
  - `page.nativeDialogs` records any `confirm()`/`prompt()`/`alert()`.
  - Fake `attack` (the real `duel()`) and `delete`.
  - `fixedQuest()`. The real quest board depends on the hour, and one test failed when the hour changed; tests that need a quest now pass a fixed one.

## Accessibility results

axe-core 4.10.2, all impacts including minor:

| Sweep | Before (`main` f3fad5d) | After |
|---|---|---|
| Interaction states (`tools/ui-states.mjs`): 13 states × 320 and 390 | **2 violations**: `color-contrast` (serious) on the pending state at both widths (the opacity pulse). **10 native dialogs** (`confirm`/`prompt`). | **0 violations, 0 native dialogs** |
| Main screens (`tools/ui-shots.mjs`): 17 screens × 320, 390, 844×390, 1024, 1440, including admin and the 40×40 map | 0 violations (the Phase 2 result) | **0 violations** (`axe-screens-after.json`) |

- The new tests also run axe on the delete-hero dialog, the admin sanction dialog and the pending battle screen: no serious or critical violations.
- Two flakiness sources were found and removed:
  - **Opacity fades on text.** About 2 in 11 full runs, axe caught a toast mid-fade. The toast, the confirmation card and the HUD cues now appear with movement only, never opacity.
  - **An hour-dependent quest fixture.** Fixed with `fixedQuest()`.
- Final validation:
  - `npm test`: 24 of 24 pass.
  - `npm run test:ui`: 52 of 52 pass in each of 9 consecutive full runs.
- Kept from Phases 1–2:
  - Focus returns to the control that opened a confirmation.
  - Escape and a tap outside cancel.
  - Escape closes only the topmost dialog (the confirmation, not the sheet or chat underneath).
  - Toasts and alerts re-home to the topmost open dialog.
  - The reduced-motion paths are covered by a test.

## Evidence

`docs/ui-audit/phase-3/` holds `before-*` (main at f3fad5d) and `after-*` captures at 320 and 390 wide from `tools/ui-states.mjs`:
- battle turns, pending, refused while busy, double tap;
- victory, defeat;
- empty players;
- each confirmation: delete hero, attack, abandon quest, sell with gems, chat report, admin permanent ban.

The "before" confirmations were native browser dialogs, which a headless browser can't screenshot. Their text is recorded in `axe-states-before.json` (`native`), and the before images show the screen underneath.

## Review corrections (PR #12 review)

The review accepted the design and the confirmation tiers, and approved not confirming ordinary transactions whose cost is shown. No percentage-of-gold threshold is added. Three findings were corrected.

**P3-01 — Focus restoration when the trigger is re-rendered.**
- *Cause:* `confirm.js` remembered only the element that opened it. A re-render during the question (for example a Realtime chat message repainting the list) replaced that element, so focus was lost on closing.
- *Fix:*
  - `ask()` also records a stable key for the trigger: its id, or its `data-a`/`data-c` plus `data-v` (the same scheme as the game's focus preservation).
  - On closing, focus goes to the original if it is still usable, else to its replacement found by key, else to a contextual fallback:
    - **Chat:** the message's line, else the message box (`fallback` on each chat question).
    - **Game:** the heading or first control of the sheet or chat still open underneath, else the screen's usual fallback (`setConfirmFallback`).
    - **Admin:** the player or section heading.
- *Test:* "P3-01 focus returns to the replacement…".
  - While a chat report question is open, a Realtime message re-renders the list (the original Report button is checked to be gone). Escape lands on the replacement Report button.
  - Then a Realtime update removes the message, so it has no Report button at all. Escape lands on the message's line, and the chat stays open.
  - Nothing is sent either time.

**P3-02 — Shared notifications destroyed with the question.**
- *Cause:* while a confirmation is open, the game moves its toast and problem list into it (so they show above the backdrop). Closing cleared the dialog with `innerHTML = ''`, which destroyed them.
- *Fix:*
  - The question lives in its own `#confirm-content`, and only that is cleared.
  - Anything else in the dialog is moved back to the page, intact, before the game re-homes it to the topmost open dialog.
- *Test:* "P3-02 an error that arrives while a confirmation is open…".
  - The quest board's refresh is held, the Abandon question is opened, then the refresh fails.
  - The error appears above the question; axe passes on this nested state (question over sheet, with an error).
  - After Escape:
    - the same toast and problem-list elements still exist;
    - the error text is intact and visible, now in the sheet underneath, and can still be dismissed;
    - nothing shared is left in the closed dialog;
    - nothing is sent, and the quest is kept.

**P3-03 — Experience lost in a duel.**
- *Cause:* a lost duel costs carried gold and experience. The engine's duel log names only the gold, and the outcome panel read the losses from the log.
- *Fix:* `trackChanges()` already snapshots the hero before each action. On a defeat it now records the measured `gold` and `xp` lost (same level before and after), tied to that battle, and the outcome panel uses those figures. The closing log lines are used only after a reload, when no measurement exists.
- No server, engine or API change.
- *Test:* "P3-03 a lost duel shows the gold and the experience actually lost". A level 35 hero carrying 4,321 gold and 300 XP attacks a much stronger player and loses. The test checks that:
  - the duel log doesn't mention experience;
  - the chips read exactly "Lost 4,321 gold", "Lost 300 XP" and "Back in town";
  - those figures match the before and after state and the engine's rule (`min(xp, 20% of a level)`);
  - axe passes on the duel result.

**Harness fix found along the way.** The fake Realtime socket sent `UPDATE` events without `old_record`. supabase-js threw on them, so no test had exercised a Realtime update before. It now sends the row's key, as Supabase does.

**Validation after the corrections:**
- All three new tests fail against the reviewed commit (2cd0553) for the reasons above, and pass now.
- `npm test`: 24 of 24 pass.
- `npm run test:ui`: CORRECTION_RUNS.
- Cancelling sends no destructive action: every confirmation test asserts zero calls for the action after Cancel, Escape or a tap outside.
- axe passes on the new nested-dialog state and the duel result (in the tests above), and on the interaction-state sweep (CORRECTION_AXE).

## Not verified

- Real devices: iOS VoiceOver and Android TalkBack with the `alertdialog`, and how `role="status"` toasts are read for refused taps.
- Haptics: the short vibration on a refused tap (`navigator.vibrate`) is not available in the test browser, and iOS Safari ignores it.
- Type-to-confirm with autocorrect on phone keyboards. The field turns off autocapitalize and spellcheck, and matching ignores letter case and surrounding spaces.

## Deferred

- Phase 4 (admin console) is not started.
- Selling without gems, healing and extracting do not ask (tier 4). The review approved this; no gold-share threshold is added.
