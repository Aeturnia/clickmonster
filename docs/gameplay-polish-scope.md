# Gameplay polish: scope

**Status: scope accepted (2026-11-18) and merged as PR #50 (`cc736b5`).** The final independent scope review accepted the reviewed commit `9882a02`, after the corrections from the review of `8e82297` (section 13). All three required CI jobs passed on it (run `44364332056`), and on the merged head `2cef100` (run `44368408591`; its browser job passed on its one re-run after a timeout in `PR-4a a second tab…`, a test this documentation change doesn't touch). GP-1 implementation was then authorized by the owner; see `docs/gameplay-polish-report.md`.
- **Not authorized by this acceptance:** implementing GP-1, or deploying the functions. Each needs its own owner authorization; the F2 redeploy's is obtained before the implementation merge is scheduled (section 7).
- **How to read GP-F5 and GP-F5b together:** GP-F5 forbids Fight controls on an ordinary town tile; GP-F5b allows the lair boss's Fight control on a tile that is both town and lair.

**What it covers:** six problems the owner found in play-testing (2026-11-18), A to F below. They all affect how combat is presented and how a fight is started. The owner asked to fix these before any new features and to keep the milestone to these six, not to turn it into a wider gameplay redesign.

**Base:** `main` at `9827ce1`. Every file and line reference below is from that commit.

## 1. Method and limits

- **Source:** the owner's play-testing on the live site, on the mobile and desktop layouts. I then read the code at `9827ce1` to find the cause of each problem. Section 2 gives the cause.
- **Not yet measured:** nothing has been run or captured for this scope. The before screenshots and the metrics are part of the implementation phase (section 10), taken the same way as the after ones.
- **Not covered:** the admin console, chat, the map, the entrance and the news pages.

## 2. Findings

### A. The XP animation plays twice

- **What the owner saw:** when XP is gained, the "+XP" chip and the glow on the XP bar play, then play again. This happens on both layouts.
- **Cause:**
  - **The regeneration tick:** a one-second timer (`main.js:1635`) runs `applyRegen()` and calls `render()` whenever HP changed.
  - **The repaint:** `render()` paints the whole hero bar as one region, `paint('top', viewTop())`. `paint()` replaces the region's `innerHTML` whenever its HTML string changes (`main.js:1047`).
  - **What restarts:** one changed HP number is enough to recreate the XP meter's elements. That restarts its CSS animations: `.delta` (`style.css:698`) and `.meter.xp.gain .meter-track` (`style.css:703`).
  - **When:** the "+XP" chip stays in the bar for `DELTA_MS` (2.6 s), so it replays on every regeneration tick in that time. After a fight HP is usually below full, so it typically replays at least once.
- **Also affected:** the gold chip (`deltaChip(d.gold)`), in the same region, for the same reason.

### B. XP numbers overflow the bar on phones

- **Cause:** each meter puts its text on a line above the bar (`meter()`, `main.js:115`). For XP that is a label ("Lv 12" plus the "+1.2k XP" chip) and "current / needed" in full digits. On a 320px phone, two meters share the hero bar's width, so each line is about 140px. At five-digit XP, "10,000 / 12,345" plus the label no longer fits.
- **The other meters:**
  - **The two sides in battle** (`main.js:608`, `621`) are wider, but they use the same pattern and overflow at larger numbers.
  - **The world boss's "Shared HP"** (`main.js:600`) does too.

### C. Every round stays in the battle log

- **Cause:** `logHtml()` (`main.js:545`) draws every round, dims the earlier ones and highlights the current one (Phase 3). The log grows with each action.
- **Where the rounds come from:** the round boundaries exist only on the client. `trackChanges()` records where each action's lines start (`ui.turnLog.marks`, `main.js:1176`), because the server's log has no turn markers.
- **After a reload in the middle of a fight,** there are no marks. `logHtml()` then falls back to showing "the last four lines bright", which is not a round.

### D. The end of a fight repeats itself

- **Victory:** the engine's last lines (`engine/battle.js:149`–`184`) are:
  - "Victory! … has been slain!";
  - "… dropped N gold.";
  - any gem or relic found;
  - each "… mastery is now N.";
  - "You gain N experience.";
  - "You reached level N!".

  The Victory card (`outcomeHtml()`, `main.js:566`) then lists the same rewards again: XP, gold, gem, relic, level and masteries.
- **Defeat:** the last lines, "You have been defeated by …" and "You wake up in town, having lost … Gold in the bank is safe." (`battle.js:194`–`196`), repeat what the Defeated card says.
- **A duel** (`engine/pvp.js:73`) ends with "Victory! … has been defeated!" or the defeat line, plus a "You take …" gold line that the card repeats.
- **Must be kept:** the card reads these lines.
  - **A duel's gold** comes from the "You take" line.
  - **A defeat's losses** come from the "having lost …" line after a reload (`main.js:585`).

### E. A mastery gain is shown again in later rounds

- **Cause:** the "Sword mastery 12" line (`.turn-gain`, `main.js:558`) is drawn under whichever round is current, for `DELTA_MS` after the gain. It isn't tied to the round where the gain happened.
- **Result:** if the player acts again within 2.6 s, the next round becomes current and draws the same line, so it appears to move from round to round until the time runs out.

### F. The monster list, and fighting on the town tile

- **F1, the list:** `monsterRows()` (`main.js:475`) draws every monster on the tile as a full-width button row. World-boss hunts are rows above them.
- **F2, the town tile:** `monstersHere()` (`engine/world.js:24`) returns the zone's monsters on every tile, the town included.
  - **On the server,** `startBattle()` (`engine/battle.js:22`) checks the requested monster against `monstersHere()`, so the server already enforces whatever that function returns.
  - **Duels in town** are already refused (`engine/pvp.js:14`, "Towns are safe").
  - **The Explore screen** already describes the town as a place with "shop, healer, bank and quests" (`main.js:804`).

## 3. Owner decisions (2026-11-18)

| Item | Decision |
|---|---|
| C | Show only the current round by default. Keep the earlier rounds behind a collapsed **Earlier rounds** control. |
| D | Remove the repeated rewards and losses for both victories and defeats. |
| F1 | Use a native drop-down list (`<select>`). Keep world-boss hunts separate. Keep the last-fought monster selected while it is still valid. |
| F2 | Approved: ordinary monsters can't be fought on a town tile, enforced by the server. World-boss hunts, lair bosses and the existing PvP rules are unchanged. The function redeploy that follows needs its own authorization. |

**Further requirements from the owner (R-1 to R-7):**

1. **R-1:** keep the full server-authoritative battle log. Removing the repeated rewards and losses changes only what's displayed; nothing is deleted.
2. **R-2:** define how the current round and the earlier rounds behave after a reload in the middle of a fight, since the round boundaries are client-side (section 6).
3. **R-3:** screen readers keep accurate announcements, with no rewards or losses announced twice and none left out.
4. **R-4:** a regeneration tick updates every display and control that depends on HP, and doesn't restart the XP animations.
5. **R-5:** test the new bars with large numbers, larger text, reduced motion and both layouts.
6. **R-6:** the drop-down's selection survives unrelated redraws, and a keyboard user can choose a monster and start the fight as separate steps.
7. **R-7:** a deployment-order plan for the town rule (section 7).

## 4. Constraints

These come from `CLAUDE.md` and apply to every item:

- **Code:**
  - vanilla JS, no build step, and no new dependencies;
  - no emojis or icons in the game UI.
- **Game rules:** unchanged except F2. No change to the database schema, the API contracts or the battle data's shape.
  - **F2** is one engine rule, used by both client and server.
  - **The engine's log text** is unchanged.
- **Kept from Phases 1–4:**
  - **The battle log:** it stays `role="log"` with polite announcements.
  - **Focus:** kept across redraws (`paint()` and `focusKey`).
  - **Native dialogs:** unchanged.
  - **The 250 ms double-tap guard on battle actions:** unchanged.
  - **Reduced motion:** honoured.
  - **The desktop shortcuts:** they keep working. Enter is still "Fight again".
- **New async code:** none is expected. If any is added, it records `gameGen` and checks `live(g)`.
- **Startup budget:** the entrance isn't touched, so it stays at 33,989 of 34,000 bytes.

## 5. Proposed design

### A. One XP animation per gain (R-4)

- **The cause, not the symptom:** the hero bar is split into separate paint regions: identity and wealth, the HP meter, and the XP meter. Each region is replaced only when its own HTML changes.
  - **A regeneration tick** changes only the HP region, so the XP meter and its chip aren't recreated.
  - **The gold chip** gets its own region for the same reason.
- **`render()` still runs in full on each tick,** so every HP-dependent display stays in step with no separate update path:
  - the hero bar's HP meter;
  - the "you" HP meter in a battle;
  - the Heal button's price, and whether it's disabled (`main.js:516`, from `healCost()`);
  - the Hero screen.
- **Rejected alternative:** a tick that updates only the HP numbers in place. It would need its own list of every HP display, and would miss one the next time one is added (the owner's R-4 concern).
- **Also kept:**
  - the existing timer that clears the chip after `DELTA_MS`;
  - the gain still shows for the same time;
  - with reduced motion, the static outline stays (`style.css:707`).

### B. Numbers on the bars (R-5)

- **Which meters change:**
  - the hero bar's HP and XP meters;
  - the two sides in a battle;
  - the world boss's Shared HP.

  The mastery and stat bars on the Hero screen are not in scope and stay as they are.
- **Design:**
  - **The bar:** taller, sized in rem (about 1.25rem; 1rem on the compact hero bar), so it grows with the text size.
  - **The text inside the bar:** the label on the left, the numbers on the right, and the "+XP" chip beside the label.
  - **Width:** the fill keeps its width transition.
- **Readability over both parts of the bar:**
  - **The text:** light, with a dark outline or text shadow.
  - **The track:** stays dark.
  - **The fill colours** (`--hp`, `--xp`, `--foe`) are darkened only if they need to be.
  - **The check:** a test computes the contrast of the text colour against the fill colour and the track colour separately. Each must be at least 4.5:1 without counting the shadow. Axe alone doesn't measure text over a gradient-like split, as the owner noted.
- **Large numbers:**
  - **When the full numbers don't fit,** the meter shows them in short form ("10.2k / 12.3k", using `short()`, `main.js:96`).
  - **Which form, decided by CSS:** both forms are in the markup and a container query picks one. No measuring in JS.
  - **Screen readers** always get the full values in text, for example "XP 10,234 of 12,345".
- **Layouts:** phone (320 and 390), wide, and desktop. At 200% text, the Phase 2 and D-1 fallbacks already move the layout to the phone arrangement; the bars must stay inside their box there too.

### C. Only the current round, with earlier rounds kept (R-1, R-2)

**What's shown:**
- **During a fight,** the log shows only the current round, with its "Turn N" heading. It also shows the opening lines ("You face …", and an elite monster's description) until the first action.
- **Above it** is a native `<details>` element labelled **Earlier rounds (N)**. It is collapsed by default and holds every earlier round, each under its "Turn N" heading, exactly as the engine logged them.
  - **Its open or closed state** is kept in `ui` for the rest of that fight, so a redraw doesn't close it.
  - **At the start of each new fight,** it resets to closed.
- **After the fight,** the last round stays visible with the outcome card (D) beneath it, and Earlier rounds still holds the rest.
- **Known rounds and ungrouped lines are kept apart.** Lines whose round isn't known (after a reload, section 6) are never counted or labelled as rounds: they sit in their own group, "Before this page loaded (N lines)", above any rounds marked since.
- **The data:** `char.battle.log` isn't changed or trimmed. The client only chooses what to show.
- **A duel** is resolved in a single action, so the whole duel is one round.
- **A world-boss hunt** follows the same rules as an ordinary fight.

**Accessibility:**
- **The log stays `role="log"`.** Earlier rounds is a native disclosure, so it works by keyboard and screen readers already know it.
- **Scrolling:** the log scrolls to the latest line as it does now.
- **Announcements:** what's announced doesn't change (R-3; see D).

### D. The outcome is shown once (R-1, R-3)

**Removed from the visible last round:** once a fight is over, the last round leaves out the reward and loss details the outcome card already shows. The narrative outcome line stays (scope review, Q2): it tells what happened; the card gives the economic consequences.

| Fight | Lines hidden from the visible last round | Where they're shown instead |
|---|---|---|
| Victory over a monster | The gold drop, a gem or relic found, each "mastery is now", "You gain N experience", "You reached level N!" | The Victory card |
| Defeat by a monster | "You wake up in town, having lost …" | The Defeated card: the losses, "Back in town", "Gold in the bank is safe" |
| A duel | The "You take …" gold line | The duel's card |

**Kept as narration:** "Victory! … has been slain!", "You have been defeated by …", and a duel's "Victory! … has been defeated!" or defeat line.

**Also kept in the visible round:** everything else the card doesn't show:
- the blows, misses and the monster's attacks;
- a variant's "warm light restores your health";
- "Something rare glinted … your pack is full".

**How the lines are recognized:**
- by their `kind` and a fixed list of text patterns, in one function next to `outcomeHtml()`;
- a test feeds that function the engine's own output for each fight, so a change to the engine's wording fails a test instead of showing the line twice.

**A finished fight restored after a reload** (section 6) follows the same rule in its own way. Its lines are ungrouped, so there is no "last round" to filter. They all stay in "Before this page loaded", unfiltered and complete, and the outcome card shows beneath them as now. Only a last round marked on this page is ever filtered.

**The hidden lines are still used and still available:**
- **The card still reads them** (R-1).
- **Earlier rounds still shows the complete earlier rounds.**
- **A "Show the full log" choice?** It could restore the hidden lines, but it isn't proposed. The card is their presentation, and the stored log is unchanged.

**Announcements (R-3):**
- **What's announced:** `playEffects()` (`main.js:1255`) announces the new lines of each action, all of them, rewards included. That doesn't change, so each reward or loss is announced exactly once.
- **The card isn't a live region and doesn't become one,** so nothing is announced twice.
- **The test:** records the polite announcements for a victory with a level-up and a mastery gain, and for a defeat. It checks that each reward and loss appears exactly once.

### E. A mastery gain shown once, in its own round

- **What it records:** the gain is stored with the round it happened in (its start index in `ui.turnLog.marks`), not with whatever round is current.
- **Where it shows:** "Sword mastery 12" appears under that round only. When the next round starts, it moves into Earlier rounds with that round, still under it.
- **A gain on the killing blow** is listed once, in the Victory card.
- **The time limit:** `DELTA_MS` no longer controls where the line shows.

### F1. A native drop-down (R-6)

**What's shown:**
- **Hunts first:** world-boss hunts stay as their own rows, above the drop-down, as they are now.
- **The drop-down:** a labelled `<select>` ("Monster") lists the tile's monsters, with the lair boss last when you're on the lair.
  - **Each option:** for example "Lv 4 Bog Lurker, Easy, Frost", or "Lv 9 The Mire King, Hard, boss".
  - **No colours:** difficulty is shown in the text, because option colours aren't reliable across browsers.
  - **Beside it:** a "Fight" button.
- **Selecting doesn't start a fight.** Only the button does. Some browsers fire a change event as the arrow keys move through the options, so starting on change would start fights by accident.
  - **Keyboard:** Tab to the drop-down, choose with the arrows, Tab to Fight, Enter.
  - **Touch:** the native picker, then Fight.

**Which monster is selected:**
- **The default:** `ui.lastMonster`, if that monster is on this tile. Otherwise the first, lowest-level monster.
- **Remembering the choice:** a change updates `ui.selectedMonster`, and the render marks that option `selected`, so redraws (regeneration ticks, chat, the players list) keep it.
- **When you move:** the selection is kept if the monster is on the new tile too, and reset if not.

**Staying open:**
- **The risk:** if `#main` is repainted while the picker is open, the browser closes it.
- **The rule:** the explore screen's HTML must not change on unrelated ticks while the player is on a monster tile.
  - **Regeneration off town:** the explore screen has no HP-dependent content (the Heal button is only in town).
  - **A town tile that is also a lair** (5F2) shows the drop-down and the Heal button together, and the Heal price changes with every regeneration tick. So the drop-down doesn't rely on the screen's HTML staying the same: it goes in its own paint region, replaced only when its own options or selection change. GP-F2b checks this on that tile too.
  - **The other ticks** (the players list, hunts, world events) are checked one by one.
  - **Either way,** the drop-down's own paint region keeps the element in place.
- **Focus is kept** by `focusKey` (the `id` on the `<select>`).

**The rest:**
- **The dock's quick "Fight …" button** (`main.js:526`) stays.
- **Nothing to fight:** with no monsters and no hunts, the existing empty state stays.

### F2. No ordinary monsters on a town tile

**The engine rule** (`engine/world.js`, used by both client and server):
- **`monstersHere()`** returns no ordinary (roaming) monsters on the zone's town tile. The lair boss is still added on a lair tile, as now, **including a lair on the town tile**. No built-in zone puts a lair on its town (checked on `9827ce1`, all 12 zones), but a zone edited in the admin console could, and the rule must not depend on that.
- **`startBattle()`** keeps its one membership check against `monstersHere()`, so a valid lair boss on a town tile is accepted. It is **not** a blanket `inTown()` refusal. Only when that check fails, the hero is in town, and the requested monster is one of the zone's ordinary monsters does it give the town message, "No roaming monsters can be fought in town. Move to another tile to hunt.", in place of the general "That monster isn't here."

**Unchanged:**
- world-boss hunts, which are started by `startHuntBattle()` in the `game` function and don't use `monstersHere()`;
- duels and the town's existing PvP safety;
- quests;
- respawning in town after a defeat.

**The client follows from the engine:**
- **The town's Explore screen** shows "No roaming monsters can be fought in town. Move to another tile to hunt.". Hunts are still listed. On a town tile that is also a lair, the drop-down is still shown, holding the lair boss only, with the town message beside it.
- **The dock's quick Fight button** is already filtered through `monstersHere()`, so it disappears in town.
- **"Fight again"** is only offered after a victory, on the tile where the fight happened, so it never appears in town.

**Zones edited in the admin console** get the same rule, since it's based on the zone's town position.

## 6. After a reload in the middle of a fight (R-2)

The round boundaries exist only in the page's memory. A reload loses them, and the stored log doesn't say where rounds began. Two ways to handle it:

**R2-a (proposed): be honest about what isn't known.** Client-only, with no change to data.
- **No round split:** after a reload, the lines already in the log aren't divided into rounds or labelled as a round.
- **Where they go:** a collapsed group labelled **Before this page loaded (N lines)**. N counts lines, which are known; it never counts rounds, which aren't. The group isn't presented as earlier rounds, and it holds the stored lines verbatim, in order.
- **Rounds marked since the reload** go in the Earlier rounds control as usual, below that group.
- **The current-round area** shows one line: "Fight in progress, turn N." N is `battle.turn`, which the server stores.
- **From the next action:** rounds are marked as usual.
- **A fight that was already over when the page loaded:**
  - **Its outcome card** shows from the stored rewards, and from the log for a defeat, as now.
  - **The log lines** go under "Before this page loaded", unfiltered: with no known last round, nothing is hidden (section 5D).
- **What's lost:** the "fall back to the last four lines" rule (`main.js:550`) is removed, because it presents an arbitrary group of lines as current.

**R2-b (an alternative, not proposed): the engine stamps each log line with its turn number.**
- **The change:** an added `t` field on each entry, which makes the rounds exact after a reload.
- **The cost:** it changes the stored battle data and the engine's log output, which are shared with the server. Old fights without `t` would still need R2-a.

**Recommendation:** R2-a, because reloading mid-fight is rare and it keeps R-1 strict. R2-b can be scoped later if players miss the round view after reloads.

## 7. Deployment order for the town rule (R-7)

The client and the functions share the engine but are deployed separately:
- **The site:** Netlify, on merge to `main`.
- **The functions:** `npm run deploy:functions`, by hand, with its own authorization.

**What happens while the two disagree:**

| | Old server (town fights allowed) | New server (town fights refused) |
|---|---|---|
| **Old client** (open tabs, before merge) | Today's behaviour | Town monsters are listed; Fight is refused with the new message, shown as the usual error. Nothing is lost. |
| **New client** | Town monsters aren't listed, so no fights are started there from the UI. A modified client could still fight in town until the redeploy. | Consistent |

**The plan:**
**F2 is not server-enforced until the function redeploy succeeds.** Until then the live server still accepts a town fight from an old or modified client, whatever the merged code says. The report states this, and the record of F2 counts from the redeploy, not the merge.

1. **Authorization first:** the owner's separate authorization for the function redeploy is obtained before the merge is scheduled, so the merge and the redeploy happen together.
2. **Merge** after review and green CI. Netlify publishes the client, so new page loads stop offering town fights.
3. **Redeploy the functions** from the merged `main` (`npm run deploy:functions`) immediately after Netlify's deploy, under that authorization. The interval is kept to minutes. It is visible to no one, because the new client offers nothing the old server refuses; it is only a window in which enforcement is missing.
4. **Verify** on the live site:
   - The town tile shows no monster list.
   - One step out, a fight starts.
   - With authorization, a read-only check of the function's version.
5. **Old tabs** pick up the client on their next load. Until then, their refused town fight shows a clear message.

**Rollback:**
- **Revert the merge**, then redeploy the functions from the reverted `main`.
- **No data migration** is involved either way.

**Why not deploy the functions first:** it would make open and freshly loaded pages offer fights the server refuses, until the merge.

## 8. Acceptance criteria and regression tests

Each criterion has a test that fails on `main` at `9827ce1`, run against the old code to show it detects the problem (`UI_PUBLIC_DIR`, as in earlier phases).

| ID | Criterion | Test |
|---|---|---|
| GP-A1 | After an XP gain, the XP meter's elements and its chip aren't replaced by later regeneration ticks; the gain animation starts once | Browser: gain XP with HP below full, keep a reference to the XP meter element, let three ticks pass; the same element is still attached, and `animationstart` fired once |
| GP-A2 | A regeneration tick updates every HP display: the hero bar, the battle's "you" meter, the Heal price and its disabled state | Browser: in town with HP below full, a tick changes the HP text in the hero bar and the Heal price together; at full HP Heal is disabled |
| GP-B1 | No meter text overflows, at 320 and 390 px, wide and desktop, with XP and HP up to 7 digits | Browser: a hero with 1,234,567 / 2,000,000 XP; every meter's content fits its box (`scrollWidth <= clientWidth`) at each size |
| GP-B2 | The same at 200% text | Browser: the same check with the root font size doubled |
| GP-B3 | The meter text is at least 4.5:1 against both the fill and the track | Test computes both contrasts from the computed colours, for HP, XP and the foe colour |
| GP-B4 | Screen readers get the full numbers when the short form shows | Browser: the meter's text content includes "1,234,567" while the short form is visible |
| GP-B5 | Reduced motion: no animation on the bars or the chips | Browser, with `reducedMotion: 'reduce'` |
| GP-C1 | During a fight, only the current round is visible; the earlier rounds are in a collapsed Earlier rounds control with the right count | Browser: three actions; one visible round, a `<details>` with 2 rounds, closed |
| GP-C2 | Opening Earlier rounds survives redraws and the next action; it resets for a new fight | Browser |
| GP-C3 | The stored log is unchanged | Browser: `window.clickmonster` shows the full `battle.log` after the fight, every line present |
| GP-C4 | After a reload mid-fight: no lines presented as a round; "Before this page loaded (N lines)" holds them all, labelled by line count; no "Turn" heading and no round count is shown for them; "Fight in progress, turn N"; the next action starts a marked round, listed apart from the ungrouped lines | Browser, with a saved session and a battle in progress |
| GP-D1 | After a victory, the reward lines appear only in the card; "Victory! … has been slain!" stays in the visible round | Browser and a Node test of the filter on the engine's own output for a victory with a gem, a level-up and a mastery gain |
| GP-D2 | The same after a defeat ("You have been defeated by …" stays; the losses line is only in the card), and after a duel either way (its narrative line stays; the gold line is only in the card) | Browser |
| GP-D5 | A finished fight restored after a reload: every stored line is in "Before this page loaded", none filtered; the outcome card shows; the stored log is unchanged | Browser, with a saved session and a finished battle |
| GP-D3 | Each reward and loss is announced exactly once | Browser: the polite announcer's text for a victory and for a defeat |
| GP-D4 | The defeat card still shows the losses after a reload | The existing Phase 3 test, kept |
| GP-E1 | A mastery gain appears under its own round only, and not under the next one however fast the next action comes | Browser: gain mastery, act again within 2.6 s; the line is under the earlier round only |
| GP-F1 | Off town, monsters are in a labelled `<select>`; choosing doesn't start a fight; Fight starts the selected one | Browser, keyboard only: arrow through the options, no `fight` call; Tab, Enter, one `fight` call for the chosen monster |
| GP-F2 | The selection survives unrelated redraws (ticks, chat, players list) and defaults to the last monster fought | Browser |
| GP-F2b | Unrelated updates don't replace the `<select>` element itself while it's in use, off town and on a town-and-lair tile (where the Heal price changes each tick): with the picker focused, a regeneration tick, a players-list refresh, a hunts refresh, a world-events refresh and a chat message each leave the same element attached (identity checked, not only its value) | Browser: keep a reference to the focused `<select>`, trigger each update, assert `el.isConnected` and that it is still `document.activeElement` |
| GP-F3 | Hunts are still separate rows and still start a hunt | Browser |
| GP-F4 | On the town tile, the engine lists no ordinary monsters and `startBattle()` refuses them with the town message; world-boss hunts are unaffected; duels in town are still refused as before | Node engine tests |
| GP-F4b | With a synthetic zone whose lair is on its town tile: `monstersHere()` there returns the lair boss only; `startBattle()` accepts the lair boss and refuses an ordinary monster with the town message | Node engine test, with the synthetic zone fixture |
| GP-F5 | On the town tile, the client shows the town message and no Fight controls | Browser |
| GP-F5b | On the synthetic town-and-lair tile, the client shows the town message and a drop-down holding the lair boss only, and Fight starts the boss fight | Browser, with the same zone fixture through `FakeBackend({ zones })` |
| GP-F6 | The API refuses a town fight with an ordinary monster | `tests/db` API test, on the local stack |
| GP-X1 | Axe: 0 violations of any impact on the changed screens, at 320, 390, 1024 and 1440 | `tools/ui-shots.mjs` |

**Tests that change because of F2:**
- **Browser tests:** every test hero starts on the town tile (`tests/ui/harness.mjs:36`), and about 60 places fight from there. The fixtures gain a start position one tile from town for those tests. The rule itself is tested by GP-F4 to GP-F6.
- **The engine victory test** (`tests/engine.test.mjs:85`) fights a new hero in town, so it moves one tile out.
- **`tools/sim.mjs`** and the measuring tools that fight, adjusted the same way.

## 9. Evidence

- **Screenshots:** before and after, captured the same way at 320, 390, 1024 and 1440:
  - the hero bar with five-digit and seven-digit XP;
  - a fight in round 3, with Earlier rounds closed and open;
  - victory, defeat, and a duel;
  - Explore off town and on the town tile;
  - 320 at 200% text.
- **Suites:** the full engine and browser suites, three runs each. The database suite runs in CI.
- **Axe:** a sweep with 0 violations of any impact.
- **A report** (`docs/gameplay-polish-report.md`) with deviations and what wasn't verified:
  - real phones;
  - screen readers;
  - the native picker on iOS and Android.

## 10. Phasing

**One phase, GP-1, in one PR.** The six items share the battle view and the hero bar, so splitting them would mean reviewing overlapping changes twice. Within the PR, there is one commit per item, A to F, so each can be reviewed alone.

**GP-1 ends at the review gate.** The function redeploy (section 7) is a separate production step with its own authorization, obtained before the merge is scheduled so that the two happen together. F2 is server-enforced only once that redeploy succeeds.

## 11. Out of scope

- New features, balance changes, and any rule other than F2.
- The battle data's shape (R2-b, unless chosen).
- The mastery and stat bars on the Hero screen.
- The admin console.
- The Linux font follow-up.
- A shortcut for the drop-down's Fight button. Enter on the button already works, and the shortcut list stays as it is.

## 12. Questions for the scope review (answered)

1. **Q1, reload behaviour:** **R2-a.** Don't invent turn boundaries; keep ungrouped lines apart from known rounds.
2. **Q2, the victory line:** **keep it.** The narrative victory, defeat and duel lines stay in the visible log; only the reward and loss details move to the cards.
3. **Q3, the town message:** **"No roaming monsters can be fought in town. Move to another tile to hunt."** It distinguishes roaming monsters from world-boss hunts and lair bosses.

## 13. Scope review corrections (review of `8e82297`)

**Disposition:** minor scope corrections requested. The six-item scope is accepted in principle. Documentation only; nothing is implemented, the shared engine is unchanged, and no function was deployed.

| # | Correction | Where |
|---|---|---|
| 1 | **The town/lair overlap.** `startBattle()` is not a blanket `inTown()` refusal: it keeps the `monstersHere()` check, so a valid lair boss on a town tile can be fought, and gives the town message only for an ordinary monster. A synthetic zone with its lair on its town tile is added to the engine and client criteria | 5F2; GP-F4b, GP-F5b |
| 2 | **The native picker stays the same element.** A test holds the focused `<select>` and checks that each unrelated update leaves that element attached and focused, not only its value | GP-F2b |
| 3 | **Server enforcement starts at the redeploy.** F2 isn't enforced by the live server until the authorized function redeploy succeeds. The redeploy authorization is obtained before the merge is scheduled, and the redeploy follows Netlify's deploy immediately; the production authorization gate is kept | Section 7 |
| 4 | **Outcome filtering after a reload.** A finished fight restored after a reload has no known last round, so nothing is filtered: every stored line is shown, ungrouped, in "Before this page loaded", with the outcome card beneath. The full log is unchanged | 5D, section 6; GP-D5 |
| Q1–Q3 | The owner's answers: R2-a, with ungrouped lines labelled by line count and never as rounds; the narrative outcome lines kept (victory, defeat and duel); the town message "No roaming monsters can be fought in town. Move to another tile to hunt." | 5C, 5D, 5F2, section 6, section 12; GP-C4, GP-D1, GP-D2 |
