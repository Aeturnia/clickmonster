# Landing page — phase L-1 report: the entrance

**Status: implemented. Awaiting independent review.** It is on its own branch and PR. L-2 is not started and not authorized.

The contract is `docs/landing-scope.md`, approved at `37f490a` and merged as PR #23. This phase covers LAC-1 to LAC-10 (with 5a, 5b and 10a), LAC-18 to LAC-20, and LAC-21's L-1 cases.

## 1. What changed

- **`public/index.html`:** the entrance, in plain HTML.
  - It has the name, a one-line subtitle, the sign-in and create-account form, and a short description of the realm.
  - The game's regions follow it, inside `<div id="app" hidden>`.
  - A two-line inline script in `<head>` marks a saved session before the first paint, so a returning player sees "Returning to the realm" instead of the form flashing up.
- **`public/css/entry.css` (new, about 9 KB):**
  - the entrance's own layout: one column on phones, side by side from 52em;
  - the realm backdrop (gradients only);
  - the in-place status, and the arrival movement, which is transform only and off with reduced motion.
  - Every rule is scoped to `.entry` with at least two classes, so the game stylesheet can't restyle it once it loads. It never reads `data-layout`.
- **`public/js/entry.js` (new):** sign-in and the hand-over.
  - **No game code before sign-in:** supabase-js loads on the visitor's first focus or input in the form. The game's modules and `css/style.css` load only after sign-in, or at once when a saved session is found. Nothing is autofocused.
  - **The only auth listener on the game page.** It starts the game for a new user and stops it on sign-out, or when the session ends. Refreshes, user updates and repeated sign-in events for the user already playing do nothing; an account switch stops and starts once.
  - **Stale work is dropped.** Every start and stop increments a generation, and a start passes `isCurrent()` into the game, so work for an older generation is dropped when it returns. This is the reviewer's L-1 note: start-up must be cancelled if the account changes or signs out before it finishes.
  - **Messages:** separate ones for the library failing, Supabase being unreachable, the game not starting, signing out, and a session that ended.
- **`public/js/net.js`:** the one Supabase client.
  - `client()` loads the vendored library with a classic script tag and creates the client once. A failed load leaves nothing behind and can be retried.
  - `sb` stays a live binding, and `signOut()` marks a player's own sign-out.
  - Importing `net.js` loads nothing else.
- **`public/js/main.js`:** the game no longer starts itself.
  - It exports `start(session, isCurrent)`, `stop()` and `shown()`.
  - Its sign-in form, its "Loading" screen and its own auth listener are removed.
  - Hero creation is restyled into the entrance's look (Q11): the same backdrop, the title treatment and a centred column. Its fields, validation, errors and `create` call are unchanged.
- **`public/js/admin.js`:** uses `await client()`. If the library can't load, the console says so and asks for a reload.
- **`public/vendor/supabase-js@2.45.4/`:** Supabase's UMD build, its 223-byte chunk and its MIT licence, copied unmodified from the npm package.
  - `public/vendor/README.md` records the integrity hash, the SHA-256 of each file and the update steps.
  - `.gitattributes` stops git rewriting their line endings.
  - `netlify.toml` serves `/vendor/*` with a one-year immutable cache.
- **Tests:**
  - `tests/ui/entrance.test.mjs`: 21 new browser tests.
  - `tests/entrance-files.test.mjs`: 4 new file checks in the engine suite.
  - **Harness changes:**
    - no CDN, except when measuring another checkout with `UI_PUBLIC_DIR`;
    - a refresh-token grant, revocable tokens and expired-token refusal;
    - `/auth/v1/signup`;
    - `savedSession()`.
- **Tools:** `tools/entry-metrics.mjs` now also measures what an idle visitor downloads, what loads after focusing the form, the game's import depth, and failures of the vendored library as well as the CDN.
- **Docs:** `README.md` (project layout) and `CLAUDE.md` (architecture and testing notes).

## 2. Measurements

The same tool (`tools/entry-metrics.mjs`) was run on `main` at `e385e38` (`UI_PUBLIC_DIR`, a worktree) and on this branch. The data is in `docs/ui-audit/landing/l1-metrics-before.json` and `l1-metrics-after.json`.
- Counts are startup resources: everything finished by the moment measured, plus up to 300 ms after it.
- Bytes are decoded sizes as served locally.

| Measure | Before | After |
|---|---|---|
| Visitor, until the form is visible: requests | 36 | **3** (document, `entry.css`, `entry.js`) |
| Visitor, until the form is visible: decoded bytes | 415 KB | **25 KB** |
| Visitor: game modules / supabase-js by then | 24 / yes | **0 / no** |
| Visitor after 10 s without touching the form | 36 requests; game and library loaded | **3 requests; no game, no library** |
| Visitor 1.5 s after focusing the email field | the same | 6 requests, 141 KB: the library only, **0 game modules** |
| Static import chain from the page's entry module | 7 (`main.js`) | **1** (`entry.js`; the game's own chain is still 7, loaded after sign-in) |
| Throttled time to a visible form (underestimate, section 1 of the scope) | 2.6 s (2579–2616 ms) | **0.67 s** (672–690 ms) |
| supabase-js unreachable: does the form appear? | **no**, a blank page | **yes**, and sending it explains the failure |
| `zones` read failing: does the form appear? | yes | yes (the entrance no longer reads zones) |
| Returning player, until the hero bar: startup requests | 55 | 43 |
| Returning player, until the hero bar: decoded bytes | 416 KB | 422 KB |

**Run-to-run variation.** The returning player's "before" count was 52, then 53 (the committed baseline), and 55 in this run. The 300 ms window makes it vary. The returning player still loads the whole game, as intended; the difference is that loading starts at once and needs no second screen.

**Screens** are in `docs/ui-audit/landing/`:
- `after-auth-*.png`: the entrance at 320×640, 390×844, 844×390, 1024×768, 1440×900 and 1920×1080, against the `before-auth-*.png` baseline;
- `after-create-390x844.png` and `after-create-1440x900.png`: hero creation.

Axe at all impacts found 0 violations on all six entrance captures.

## 3. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| LAC-1 | Met | Scripts off: name, form and a "needs JavaScript" note are visible. The form posts (never a GET with the email in the address), and its button is disabled without scripts. Test `LAC-1` |
| LAC-2 | Met | 3 requests, 25 KB, no game module and no supabase-js (target: at most 3, at most 30 KB). Tool and test `LAC-2 / LAC-5a` |
| LAC-3 | Met | 0.67 s, against 2.6 s (target at most 0.8 s, same method; still an underestimate) |
| LAC-4 | Met | Every request in the sign-in-to-hero test goes to our own site or Supabase. The harness allows no CDN. Hashes, licence, the single chunk and the absence of other URLs are checked in `tests/entrance-files.test.mjs` |
| LAC-5 | Met | A saved session shows "Returning to the realm" from the first paint. The form is never visible in any frame (checked every animation frame). `main.js` is requested before the library itself. Test `LAC-5 / LAC-5b` |
| LAC-5a | Met | Idle 10 s: nothing beyond the 3 requests. After focus: the library only. Game modules only after sign-in. Tool and test |
| LAC-5b | Met | **One client and one listener**, counted in the page by wrapping `createClient` and `onAuthStateChange`. **Refresh and repeated sign-in:** no second `state` call. **Account switch:** exactly one more start. **Saved sessions:** valid, expired-and-refreshed (a `refresh_token` grant), expired-and-refused (the form, a message, no `state` call), and malformed (two cases: not JSON, and the wrong shape). **A library load that failed and was retried:** still one client. **The reviewer's L-1 note, tested directly:** signing out, or switching account, while the first start is still held never shows the stale game, and only the second account's hero appears. Signing out after the hero is drawn but before chat has started leaves no error (section 5) |
| LAC-6 | Met | During sign-in the form gives way to "Entering the realm" in the same panel. The game is laid out but `visibility: hidden` and `inert` until its first draw, then rises into place. Focus moves to the screen heading (`#screen-title`). With reduced motion, no `arriving` class is ever set |
| LAC-7 | Met | Tab goes to the email field first, with no autofocus. The whole form, through Sign in, is on screen at 320×640 and 390×844. At 844×390 the whole form fits too (the target was the email field). No sideways scrolling |
| LAC-8 | Met | Sign out from Hero: the entrance returns with no reload (a marker on `window` survives). "You have signed out." Focus is on the gate heading, the password is cleared, and the game's regions are empty. A session revoked during play gives "Your session has ended. Please sign in again." Chat's account reset is covered by the existing D2-01 and D2-03 tests, which pass unchanged |
| LAC-9 | Met for L-1 | `entry.css` has no `data-layout` or `data-chat` selectors (comments aside), checked in `tests/entrance-files.test.mjs`. The check with each forced choice belongs to L-2 |
| LAC-10 | Met | The form keeps its labels, `autocomplete` (current-password or new-password by mode), inline errors with `aria-invalid` and `aria-describedby`, alert or status roles, and create account with the confirmation message. The ids `#authform`, `#email`, `#password` and `#auth-msg` are kept, so the existing sign-in helper and the D-2 account-switch tests work unchanged |
| LAC-10a | Met | Hero creation: the same `#name` validation (nothing sent for an invalid name), `#name-error`, race buttons, race details and the `create` call. The existing creation tests pass unchanged |
| LAC-18 | Met | No sideways scrolling on the entrance at the six sizes. The existing layout tests are unchanged |
| LAC-19 | Met | 0 axe violations at all impacts. **Entrance:** six sizes, create-account mode, an error, the returning status, and the game-could-not-start state. **Also:** hero creation, the game after sign-in, and the entrance after signing out |
| LAC-20 | Met | No change to game rules, the `game` or `admin` functions, the schema or the API. `netlify.toml` gains only a cache header |
| LAC-21 (L-1 cases) | Met | **The vendored library fails:** the entrance stays, with a persistent alert, and the form can be sent again. **Supabase unreachable:** "Can't reach the sign-in service"; with a saved session, Try again and Sign out, and Try again recovers once it is back. **First `state` call fails:** Try again starts the game, and Sign out returns to the form. **Game code fails to load:** the entrance stays, and Try again recovers (section 4, deviation 2) |

## 4. Deviations and decisions made during L-1

1. **The single name constant is deferred to L-4.**
   - The scope (section 6) proposed one JS constant shared by `entry.js` and the edge function. `entry.js` doesn't need the name, and the edge function arrives in L-4, so the constant comes with it.
   - The name "ClickMonster" currently appears in:
     - `index.html` (`<title>`, the heading);
     - `admin.html` (`<title>`);
     - `manifest.webmanifest` (name and short name);
     - `main.js` (the banned screen's and hero creation's headings);
     - `admin.js` (its header and messages);
     - a comment at the top of `style.css`.
2. **"Try again" after the game's code failed to load reloads the page.**
   - Browsers keep a failed module load for the rest of the page, so a second `import()` fails the same way. I confirmed this: the in-place retry never recovered.
   - A reload goes straight back in through the saved session. Server failures (`state`) are still retried in place.
3. **A two-line inline script in `<head>`.**
   - It marks a saved session before the first paint, so a returning player never sees the form flash up before the status.
   - It only reads whether the storage key exists. `entry.js` then checks the session's shape, and the client's own restore decides.
4. **The Sign in button is disabled in the HTML** until `entry.js` runs, and the form posts. Without scripts, nothing can be sent, and an email address never ends up in a URL.
5. **The admin console has no in-place retry** if the library fails to load. It shows a message asking for a reload. Its sign-in page is otherwise out of scope.
6. **`public/vendor/README.md` is served** at `/vendor/README.md`. It holds documentation only; nothing secret.
7. **One existing test was changed:** `D-1 screens without a game use the full width` (`tests/ui/desktop.test.mjs`).
   - It measured the old sign-in form inside `#app`. Sign-in is now the entrance, outside `#app`, with its own layout and tests.
   - It now measures the other screen without a game, hero creation, at 1440×900: full width, no side column, no axe violations.
   - This is the only change to an existing test's intent.
8. **Not changed:** the thin line near the top of the 1440×900 creation screen was already there before L-1 (`before-auth-1440x900.png`). It comes from the desktop frame.

## 5. Regression evidence

The first 19 new browser tests were run against `main` (`e385e38`, via `UI_PUBLIC_DIR`):
- **16 fail,** as they should.
- **3 pass.** They describe behaviour the old code already had and L-1 keeps: no movement with reduced motion, an expired session refreshed, and a malformed session counted as none.

Two more tests cover the reviewer's note about start-up being overtaken. They can't run on `main`, which has no hand-over, so they were checked against this branch with one guard removed:
- **"Signing out after the hero loads but before chat has started leaves no error behind"** fails without the guard on the chat continuation in `main.start()`, with "Cannot read properties of null (reading 'loc')". It passes with it. That guard was added during this phase, after the hazard was spotted in review of my own work.
- **"An account change while the game is starting leaves nothing of the first start behind"** is covered by the generation check, so it passes either way. It stays as the direct test of the note.

## 6. The game layouts are unchanged

`entry.css` now loads under the whole game, so the game was measured with the earlier phases' tools on `main` (`e385e38`, worktree) and on this branch:

- **`tools/ui-metrics.mjs`** (the Phase 2 layout numbers): **identical** output.
- **`tools/desktop-metrics.mjs`** (the D-1 and D-2 desktop geometry): **identical** output.
- **`tools/ui-shots.mjs`:** 17 screens at 320, 390, 844×390, 1024×768, 1440 and 1920×1080, 102 captures per version.
  - Each version was captured twice to separate run-to-run noise (timers, animations) from real change.
    - 47 of `main`'s captures differ between its own two runs, and 34 of the branch's.
    - 54 captures are stable on both versions.
  - Of those 54, 8 differ between `main` and the branch:
    - **the sign-in screen at all six sizes,** which is the entrance, as intended;
    - **the level-up sheet at 320 and 390,** by one colour level on 31 and 211 pixels (for example 15,12,10 against 16,12,10). That is colour rounding, not a layout change.
  - **Axe at all impacts on the branch:** 0 violations on all 102 captures.

## 7. The Q2a gate: the vendored build, verified before it replaced the client

The scope requires L-1 to verify Supabase's UMD build before it replaces the CDN module. Every capability the game uses was exercised through the vendored file. Since this branch there is no other copy, and the harness refuses the CDN. All of it ran against the fake backend:

| Capability | Exercised by |
|---|---|
| Sign in with a password | the shared `signIn` helper, so every signed-in browser test |
| Sign up (confirmation required) | `the entrance: create-account mode…` |
| Session restore from storage | `LAC-5 / LAC-5b a saved session goes straight in…` |
| Token refresh | `…an expired session with a working refresh token…`; `refreshSession()` in the one-client test |
| A refused refresh (revocation) | `…the server refuses…`; `…a session that ends during play…` |
| Sign out | `LAC-8 signing out…`; the D-2 account-switch tests |
| Edge functions (`functions.invoke`) | every game action, including `state` and `create`; the admin console's tests (`admin`) |
| Table reads and RPC | `zones`, `characters`, `world_config`, `hunts`, `events`, `chat_messages` and `my_character`, in the existing game, chat and admin tests |
| Realtime (`postgres_changes` over the WebSocket) | the existing chat and D-2 tests, through the harness's fake socket |
| The lazily loaded chunk `591.supabase.js` | **not exercised:** Chromium has `WebSocket`, so it is never requested. Its presence, its hash and that it is the only chunk are checked in `tests/entrance-files.test.mjs` |

## 8. Test runs

The engine suite has **28** tests (24 before, plus 4 file checks) and the browser suite **140** (119 before, plus 21). Both were run three times on this branch, on the final code: all passed in each of 3 runs (engine 28/28, browser 140/140, three times).

## 9. Not verified

- **Real phones and networks, Firefox, Safari, and screen readers.** The timing is the harness's throttled underestimate. Real-phone timing on the live site is still owed (scope, section 11).
- **The live Supabase project.** Everything in section 7 ran against the fake backend. The vendored build has never talked to the real auth server, edge functions or Realtime. It is the same version as the CDN module it replaces, but that is not the same as seeing it work. This belongs to the pre-release live-staging check.
- **The `591.supabase.js` chunk** has never been requested (section 7).
- **Netlify.** The `/vendor/*` cache header and serving the vendored files from the deployed site haven't been seen; the harness serves `public/` itself.
- **A real email-confirmation sign-up.** The fake backend imitates the confirmation-required answer.
- **Input methods, password managers and browser autofill** on the new form. The fields keep their `autocomplete` values, but no real password manager was tried.
- **A failed module load in other browsers.** The reload-on-retry rule (deviation 2) was observed in Chromium only.
