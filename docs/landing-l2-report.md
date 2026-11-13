# Landing page — phase L-2 report: the interface choice

**Status: implemented. Awaiting independent review.**
- **Authorized:** on 2026-11-13, after L-1 merged (PR #25, `b911a79`) and passed its integration checks.
- **Branch:** its own branch and PR.
- **Not started and not authorized:** L-3 and L-4. No database change or function deploy.

The contract is `docs/landing-scope.md`: Q12 (decided), and section 6, "The picker (L-2)". Criteria: LAC-9 (with each choice), LAC-11, LAC-12 and LAC-18 to LAC-20.

## 1. What changed

- **`public/js/layout.js`:** the player's choice.
  - **`setLayoutPreference(choice)`** sets it. Unknown values count as Automatic.
  - **`resolveLayout()`:**
    - **Automatic** is the old rule, unchanged.
    - **Desktop** gives the desktop layout whenever the usable width allows it (`min-width: 75em` and at least 75rem), whatever the pointer. Otherwise it gives Automatic's result with `fallback: true`. The choice itself is never changed.
    - **Mobile** always gives the phone layout.
  - **`layoutStatus()`** reports the choice, the layout in use and the fallback.
  - The watcher now also reacts to the choice, to the fallback starting or ending, and to the 75em width condition on its own.
- **`public/css/style.css`:**
  - **The Phase 2 two-column rules are keyed off the layout state** (`#app:is([data-layout="wide"], [data-layout="desktop"])`), not the media query. A forced Mobile on a large screen now gets the phone column, and a forced Desktop on a touch tablet gets the desktop frame.
  - **Under Automatic, `layout.js` sets "wide" or "desktop" exactly when the old media condition held,** so nothing moves (section 3).
  - The 760px reading width keeps its 900px media condition and now also requires the two-column layout.
  - The picker's styles are new.
- **`public/js/main.js`:**
  - **The choice is a device setting,** `prefs.layout`, kept with the others in `clickmonster.prefs`.
  - **Hero, Settings has an "Interface" group** of native radio buttons, with a note saying what is in use and why.
  - **A change applies at once.** It is saved, the layout re-applies, focus stays on the radio button, and the note is announced politely.
  - **`start()` re-reads the setting,** because the entrance may have changed it while the game was loaded but signed out.
- **The entrance** (`index.html`, `css/entry.css`, `js/entry.js`):
  - **The same three choices,** under the sign-in form inside the gate panel. The scope's reading order on phones is sign-in, then the choice.
  - **A note explaining each choice.** For Desktop it says, against the current window, whether it will fit or fall back. It updates as the window changes.
  - **Saving** merges into the stored settings without disturbing the others.
  - **After signing out,** the entrance shows any change made in the game.
  - **Hidden** while returning or entering, and while the game can't start.
  - **The entrance's own layout never reads the choice** (LAC-9).
  - **The Desktop rule's numbers are copied** from `layout.js`, so the entrance needs no game code. `tests/entrance-files.test.mjs` checks they match.
- **Tests:**
  - `tests/ui/layout-choice.test.mjs`: 10 new browser tests.
  - 1 new file check in `tests/entrance-files.test.mjs`.

## 2. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| LAC-11 | Met | **Entrance:** a `fieldset` with the legend "Interface" and three labelled radio buttons, Automatic by default, described by its note. Tab reaches it after the form, and the arrow keys choose. It is saved in `clickmonster.prefs` with the other settings kept. **Hero, Settings:** the same group, applied at once, with focus kept on the radio button and the active layout and any fallback stated. Axe found 0 violations in both places, at 390 and 1440 |
| LAC-12 | Met | **Desktop:** a touch tablet (1366×1024) gets desktop. At 1024×768 it falls back to the two-column layout, and the note says so. The choice is still Desktop, on screen and in storage. Widening to 1440 brings Desktop back without choosing again, and narrowing falls back again.
- **On a touch tablet,** where Automatic never gives desktop, narrowing to 1100 falls back, and widening to 1366 restores desktop with the choice unchanged. This proves the choice, not Automatic, brought it back.
- **Under 200% text at 1920×1080,** both browser text size (32px) and page text size (200%), Desktop falls back. The Settings note says why, and the choice is kept. With the browser text size, the entrance's note says Desktop won't fit.
- **On a phone** it falls back to the phone layout. **Mobile:** at 1024, 1440 and 1920 it gives the phone column, at most 560px wide and centred, with no side column, the phone reading order, tabs at the bottom, 16px text, no sideways scrolling and 0 axe violations. **Automatic:** chosen, unset, or an unreadable value all give the same layout as before at six sizes and pointers. The whole game measured unchanged, section 3 |
| LAC-9 | Met | For each choice, at 390 and 1440, the entrance was measured on a fresh load and again after signing in (so the game has set `data-layout`) and out. It is the same: identity, gate, form, the choice and the description of the realm. The identity block and the form are also in the same place under all three choices. `entry.css` still has no `data-layout` selectors |
| LAC-18 | Met | No sideways scrolling under any forced layout tested |
| LAC-19 | Met | 0 axe violations: the entrance at six sizes (now with the picker), Hero, Settings, forced Mobile at three sizes, and forced Desktop on a touch tablet. Also all 102 game captures, section 3 |
| LAC-20 | Met | No change to game rules, the server, the schema or the API |

The entrance's L-1 budget (LAC-2, at most 30 KB decoded before the form) still holds, but only just. It is now **29.8 KB** (25.3 KB before the picker), and the throttled time to the form is 0.70 s (target at most 0.8 s). Figures are in `docs/ui-audit/landing/l2-metrics-after.json`. L-4's news list will need room: the files are about half comments, which could be trimmed, or the budget revisited with the owner. This is a risk for L-4, not an L-2 failure.

## 3. Automatic is unchanged

Measured on `main` (`b911a79`, worktree) and on this branch with the same tools:

- **`tools/ui-metrics.mjs`** (the Phase 2 numbers): **identical**.
- **`tools/desktop-metrics.mjs`** (the D-1 and D-2 desktop geometry): **identical**.
- **`tools/ui-shots.mjs`:** 17 screens at 320, 390, 844×390, 1024×768, 1440 and 1920×1080, 102 captures per version, each version captured twice to separate noise.
  - 36 captures varied run to run on each version, leaving 64 stable on both.
  - **Of the 64, only the sign-in screen at its six sizes differs,** because it now has the picker. Every stable game screen is pixel-identical.
  - **Axe:** 0 violations on all 102 captures on this branch.

## 4. Regression evidence

The 10 new browser tests were run against `main` (`b911a79`, via `UI_PUBLIC_DIR`):
- **8 fail,** as they should.
- **2 pass:** "Desktop on a phone falls back to the phone layout" and "Automatic … gives the same layouts as before". They describe behaviour that must not change, and `main` already has it.

## 5. Screens

In `docs/ui-audit/landing/`:

| File | Shows |
|---|---|
| `l2-auth-*.png` | The entrance with the picker at six sizes |
| `l2-settings-390x844.png`, `l2-settings-1440x900.png` | Hero, Settings with the picker |
| `l2-mobile-1440x900.png` | Forced Mobile on a desktop screen: the centred phone column |
| `l2-desktop-touch-1366x1024.png` | Forced Desktop on a touch tablet |
| `l2-desktop-fallback-1024x768.png` | Desktop chosen but not fitting: the two-column layout, with the explanation |

## 6. Deviations and decisions

1. **The entrance shows the choice inside the gate panel,** under the sign-in form, not as a separate section. Sign-in stays first, and the choice sits where a returning player sees it, without a third column on wide screens.
2. **The entrance's Desktop rule is a copy** (75em and 75rem). It isn't imported from `layout.js`, so the entrance loads no game code (LAC-5a). A file test keeps the two in step.
3. **A forced Desktop on a touch screen** gets the desktop layout. The keyboard shortcuts follow the desktop layout as before (`prefs.keys`), so they are on there too; they need a keyboard to do anything.
4. **The slim battle dock for short landscape screens** (`max-height: 540px`) stays a media query. It is about height, not layout, so it also applies to a forced Mobile on a phone held sideways.
5. **Before scripts run, the entrance's radio buttons show Automatic** for a moment, until `entry.js` reads the saved choice. It is cosmetic, and nothing is applied before the game starts.
6. **The entrance explains the choice; Hero, Settings states the layout in use.**
   - LAC-11 asks for the active layout and any fallback to be stated next to the control.
   - Before sign-in no game layout is active, so the entrance's note describes each choice instead. For Desktop it says whether it will fit the current window or fall back.
   - Hero, Settings names the layout actually in use and any fallback.
   - Stating "what this screen would get under Automatic" on the entrance would mean copying the rest of `layout.js`'s rule (pointer, two-column width, the landscape case) into the entrance. I chose not to.
7. **The entrance's Desktop note follows the browser text size and window size, not a page-level font change made after load.** It is recalculated on resize and on the 75em media change. Settings (`layout.js`, with its 1rem probe) handles both.

## 7. Test runs

The engine suite has **29** tests (28 before, plus 1 file check) and the browser suite **156** (146 before, plus 10). Both were run three times on this branch, on the final code: engine 29/29 and browser 156/156 in each run.

## 8. Not verified

- **Real tablets and phones, other browsers, and screen readers.** That includes how a forced Desktop feels on a real touch tablet, and how the radio group and the polite note are announced.
- **Browser zoom (as opposed to text size) with a forced Desktop.** Text size at 200% and resizing were tested; zoom changes the viewport width in CSS pixels, which resizing stands in for.
- **The live site.** As for L-1, everything ran against the fake backend in Chromium.
