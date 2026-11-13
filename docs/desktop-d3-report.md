# Desktop layout — phase D-3 report: keyboard shortcuts

Branch `claude/desktop-d3`, based on `main` at `672a81a` (D-2 merged).

The scope is `docs/desktop-scope.md` (sections 4, 5 and 7). D-3 is the last phase of the desktop milestone.

No game rules, server code, schema, API or dependencies changed. Phones, phones on their side and tablets are unchanged.

## Summary

- **On the desktop layout** (1200px+ with a mouse or trackpad), in a game, the keyboard shortcuts from the scope work:

  | Key | Action |
  |---|---|
  | `1` `2` `3` `4` | Explore (Battle during a fight), Hero, Gear, Map |
  | `M` `C` `F` | Melee, Cast and Flee (Fall back from a world boss), in a fight |
  | `Enter` | Fight again (Attack again for a world boss), when no other button is selected |
  | `/` | The chat message box: the panel from 1280px, or the drawer opened as usual below that |
  | `?` | The list of shortcuts |
  | `Escape` | Leave the chat message box (focus goes back to where it was before `/`, else to the screen's heading), or close a window |

- **A shortcut presses the existing button.**
  - The same pending state, double-tap guard and disabled states apply. For example, Fight again is disabled when no monsters are left, and the key then does nothing.
  - When the button isn't on screen, the key does nothing.
  - The buttons carry `aria-keyshortcuts` while shortcuts are on: the four tabs, Melee, Cast, Flee and Fight again. No visible hint was added, so accessible names and labels are unchanged.
- **On by default, with an off setting.**
  - Hero, Settings has "Keyboard shortcuts On/Off" and "Show keyboard shortcuts". Both rows appear on the desktop layout only.
  - The setting is stored locally in `clickmonster.prefs`, with no account or server change.
  - Settings saved before D-3 have no entry for it, so shortcuts are on for those players.
- **Never fire:**
  - while typing in a field;
  - while composing with an input method (`isComposing`, or key code 229);
  - while a key is held down (repeat);
  - with Ctrl, Alt, Meta or AltGr;
  - with Shift on a letter (Shift+M is not M);
  - while any dialog is open: a sheet, a confirmation, the chat drawer or the list itself;
  - outside a game (sign-in, hero creation, banned);
  - off the desktop layout, on phones, tablets and windows under 1200px.
- **The list (`?`)** is an ordinary sheet titled "Keyboard shortcuts", with a table. It is drawn from the same table the handler uses, so the two can't disagree. It says whether shortcuts are on, where to change that, and when they don't work.
- **The arrow keys and Escape are not character-key shortcuts** (WCAG 2.1.4 is about character keys). They work as before whatever the setting, and the list marks them "Always on". The arrow keys still move the hero on Explore, on every layout, as before D-3.

### Found and fixed during D-3: arrow keys in the chat panel moved the hero (a D-2 defect)

- **On `main` (D-2):** focusing a message in the chat panel and pressing ArrowUp moved focus to the previous message *and* moved the hero one square north.
- **Cause:** the panel's arrow handler called `preventDefault()`, but the game's document-level handler didn't check for that, and only skipped `INPUT` targets and open dialogs.
- **Fix:** the document handler now returns for an event already handled (`defaultPrevented`). The hero's arrow keys also ignore presses from inside the chat panel. The new shortcuts need the same check, for Escape in chat.
- **Test:** "D-3 arrow keys in the chat panel move between messages, not the hero". It fails on `main` because the hero moves.

## Acceptance criteria (D-3)

| AC | Criterion | Before | After |
|---|---|---|---|
| DAC-12 | Keyboard play: the section 7 keys work; `?` lists them; on by default on desktop; the off setting is honoured and remembered | arrows on Explore only | met (tests below) |
| DAC-13 | Shortcuts never fire while typing, composing with an input method, with a dialog open, or with a modifier key held | — | met (tests below; each guard was also broken on purpose to check the test catches it) |
| DAC-14 | No sideways page scrolling | none | none (sweep and tests) |
| DAC-15 | axe, all impacts | 0 | **0 violations on 117 captures** (13 screens × 9 sizes, 1024×768 to 2560×1440), on 6 more of the list, the settings and a battle with its keys (1280×720 and 1920×1080), and on the axe checks inside the new tests |
| DAC-16 | No game, server, schema or API change | — | none |

**The mapping is as provisionally adopted in the scope, with two clarifications:**
- **Enter** only fights again when no other button is selected. On a focused button, such as Continue, Enter presses that button, as browsers always do.
- **Digits, `/` and `?` match the character typed,** so they work on keyboards where those need Shift. Letters must be typed without Shift, but Caps Lock doesn't matter.

## Tests

`tests/ui/desktop-keys.test.mjs`, 9 new tests:
- number keys switch screens, and the tabs announce their keys;
- M, C and F press Melee, Cast and Flee, the buttons announce their keys, and axe passes;
- Enter fights again with nothing selected, but on a focused Continue it presses Continue;
- `/` goes to the empty message box in the panel (1440) and in the drawer (1240), and Escape returns to the monster row;
- `?` lists all 12 rows (axe passes); Settings shows the switch and the list;
- the never-fire cases:
  - typing "m2/?" in chat types it;
  - composing (both forms), a held key, Ctrl, Alt or Meta with a digit or M, and Shift+M press nothing;
  - nothing works behind an open dialog;
  - then M works;
- the off setting:
  - 4 does nothing and no keys are announced;
  - still off after a reload;
  - the arrow keys still move;
  - settings saved before D-3 keep shortcuts on;
- phone (390×844), tablet (1024×768) and a 1150px mouse window: no shortcuts, no list, no announced keys, no setting;
- the D-2 arrow-key defect.

**Against `main`** (`UI_PUBLIC_DIR` set to the `672a81a` checkout): 8 of the 9 fail.
- **The arrow-key test fails on the defect:** the hero moves.
- **The feature tests fail** because nothing exists there.
- **The never-fire and off-setting tests** also check, at the end, that the shortcut works when nothing is in the way, so they fail on `main` too.
- **The phones-and-tablets test passes on `main`,** where there are no shortcuts at all.

**Each guard, broken on purpose.** In a scratch copy of this branch's `public/`, each guard was removed one at a time and its test run:

| Guard removed | Test |
|---|---|
| composing and held keys | fails |
| Ctrl, Alt and Meta | fails |
| Shift on letters | fails |
| a dialog open | fails |
| the off setting | fails |
| desktop layout only | fails |
| Enter on a focused control | fails |
| `/` not typed into the box (`preventDefault`) | fails |
| the event already handled (`defaultPrevented`) | passes |

- **The last row passes because the fix has two overlapping guards.** The hero's arrow keys also ignore presses from inside the chat panel, so either guard alone stops the defect. With both removed, as on `main`, the test fails.
- **The typing guard for text areas and editable regions** isn't separately caught for the same kind of reason: the handler's existing early return for `INPUT` targets handles the chat box first.

**Full suites** (this laptop, Chromium, fake backend): `npm test` 24/24 and `npm run test:ui` **119/119 in each of 3 consecutive full runs**: 110 earlier tests plus 9 new, run after the last code change.

## Evidence

All on this laptop, Chromium, fake backend.

- **Phones, phone landscape and tablets are unchanged.**
  - The HTML of the hero bar, screen, actions, navigation and side column is **byte-for-byte identical** before and after, on Explore, Hero and in battle, at 390×844, 844×390 and 1024×768 (touch).
  - The first comparison found a stray newline left in the Hero settings markup by the desktop-only rows, and that was fixed.
  - `tools/ui-metrics.mjs` gives identical results before and after at all 7 of its sizes.
- **The desktop layout's geometry is unchanged:** `tools/desktop-metrics.mjs` gives identical results before and after at all 9 sizes.
- **Accessibility:** `tools/ui-shots.mjs` at 9 sizes found 0 violations of any impact on 117 captures (`docs/ui-audit/desktop/axe-after-d3.json`).
- **Shortcut screenshots:** `docs/ui-audit/desktop/after-d3-{1280x720,1920x1080}-{shortcuts-list,hero-settings,battle-keys}.png`, with axe results in `axe-after-d3-shortcuts.json`: 0 violations.

## What changed

- **`public/js/main.js`:**
  - the `SHORTCUTS` table, `shortcut()`, `goToChat()`, `leaveChat()`, `markShortcuts()` (`aria-keyshortcuts`, run after every render) and `sheetKeys()`;
  - the `keys` preference;
  - the Settings rows, on desktop only;
  - the keydown handler, which checks `defaultPrevented` first, then shortcuts, then the arrow keys (which skip the chat panel).
- **`public/js/chat-ui.js`:**
  - `focusInput()`, for `/`;
  - Escape in the panel: it closes an open message menu first, as before, and otherwise calls `onLeave` (focus back to the game).
- **`public/css/style.css`:** the list table and `kbd` keys.

## Not verified

- **Real input methods:** Japanese, Chinese or Korean composition on real hardware. Composition was simulated with synthetic `keydown` events (`isComposing`, key code 229).
- **Keyboards other than US English** on real hardware, for example AZERTY digits and `?`. Matching is by the character typed, which should cover them, but this wasn't tried on a real keyboard.
- **Screen readers:** in browse mode they take single-letter keys for their own navigation, so the shortcuts work in focus mode only. `aria-keyshortcuts` announcements were checked in the DOM only.
- **Other browsers** (Firefox, Safari), and the owner's own viewport.
