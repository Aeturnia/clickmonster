# MR-B2: homepage and navigation, report

**Status: merged as PR #56 (`1679855`, 2026-11-19) after its independent review approved `d6134ed`, and published by Netlify.**
- **A routing problem found after deployment:** `/guide`, `/leaderboard` and `/contact` answered with a 301, not 200.
- **Its correction (section 7)** is a follow-up PR at its own review gate. Nothing in it is merged or deployed.
- **Contract:** `docs/monstra-regna-scope.md`, section 4 (MR-B2), with D7 to D11 and the owner's answers in section 10.
- **Authorization:** the owner authorized MR-B2 on 2026-11-19 ("Authorization granted for MR-B2, email is good and no permanent discord yet").
  - **D8:** mail to `support@monstraregna.com` reaches a monitored inbox, so Contact ships.
  - **D9:** there is no permanent Discord invite yet, so Discord doesn't.
- **Branch:** `claude/mr-b2`, based on `main` at `e1ffa43`.
- **Deployment:** Netlify only, on merge: the site, its static pages and the news edge function. No Supabase function, database or auth setting is touched.

## 1. What changed

| Where | Change |
|---|---|
| `public/index.html` | **Removed:** the kicker, the subtitle and "The realm". The title is "Monstra Regna" alone. **Added:** "Skip to sign in" (first), the site menu, a comment marking where MR-S1's status line goes, and the footer. `<meta name="description">` stays |
| `public/css/entry.css` | **The grid** has the areas `id`, `nav`, `status`, `news`, `gate` and `foot`. On desktop (52em and up), the title, menu, status and news are on the left, the gate on the right, and the footer across. **Rows are spaced by each item's margin, not the grid's gap,** so the empty `status` area (and the news, while hidden) takes no room. **Also:** the skip link, shown on focus; the shared `.site-nav` and `.site-foot` styles, used by every public page; the menu's gap scaled so it stays one line on a 320px phone. **Removed:** the kicker, subtitle and "The realm" rules |
| `public/css/entry-news.css` | No longer rewrites the grid: `news` is a permanent area in `entry.css` |
| `public/js/entry.js` | **The skip link goes to what the sign-in panel shows:** the heading while a saved session is restored, otherwise its first usable control (the email field, the reset panel's first control, or Try again). Without script, it is a plain link to the email field |
| `public/js/site.js` | **The menu and footer, defined once:** `MENU`, `COPYRIGHT_HTML`, `CONTACT_EMAIL`, `menuHtml(current)`, `footerHtml()` |
| `netlify/edge-functions/news.js` | **The news pages** draw the site menu and footer from `site.js`. Their own "All news" link stays in the header; "Enter the realm" goes, since Home replaces it |
| `public/guide/`, `public/leaderboard/`, `public/contact/` | **Three static pages:** plain HTML with no script, styled like the news pages, each with the menu (itself current) and the footer. Guide and Leaderboard are short, true placeholders; Contact gives `support@monstraregna.com` |
| `netlify.toml` | Each static page is served at `/guide`, `/leaderboard` and `/contact` by a rewrite, not a redirect, with the news pages' no-script Content Security Policy |
| `public/css/news.css` | The menu in the header row, the footer's spacing, and the static pages' text and link style |
| `public/js/main.js` | **Hero → Settings gains an "About" group** with the same copyright. There is no footer in the game |
| `tests/entrance-budget.test.mjs` | **LAC-2's hard limit becomes MR-B2's contract (4.5):** a 48,000-byte tripwire that fails CI, and a 40,000-byte review threshold that is reported, not failed. The figure is always reported |
| `tools/entry-metrics.mjs` | **Also reports, in its throttled runs:** LCP, CLS (2 s after the form, so the news is included) and a scripted interaction (focusing the email field, to the next frame). Medians of 3 |

**Not done, as the scope requires:**
- **No Discord:** waiting for a permanent invite (D9).
- **No Privacy or Terms links:** they wait for the legal milestone (D7).
- **No status element:** that is MR-S1.
- **No player rankings:** the leaderboard page is a placeholder.

## 2. Acceptance criteria (scope, 4.6)

**The tests:**
- `tests/ui/homepage.test.mjs`: 18 browser tests.
- `tests/site-pages.test.mjs`: 5 file checks.
- The B2-6 byte check in `tests/entrance-budget.test.mjs`.

**On `main`:** the browser tests were run against `e1ffa43` (`UI_PUBLIC_DIR`). **15 of 18 fail there; 3 pass,** explained below.

| ID | Status | On `e1ffa43` |
|---|---|---|
| B2-1 | **Met** at 320×640, 390×844, 768×1024, 1024×768 and 1440×900, with news:<br>- the reading order is title, menu, gate, news, footer;<br>- the kicker, subtitle and "The realm" are gone, and the title stands alone;<br>- no sideways scroll;<br>- the empty status area adds no space (the gap above the panel is the ordinary 20px on one column);<br>- on desktop the news sits beside the panel, under the menu.<br>**At 320×640:** Sign in is on screen, and the menu is one line | **All 6 fail** |
| B2-2 | **Met.** "Skip to sign in" is the first Tab stop, out of sight until focused, then on screen. Enter reaches:<br>- the email field;<br>- the heading (`#gate-h`) while a saved session is restored;<br>- the reset panel's first control during a password reset | **The first two fail.** The reset case passes there too: without a skip link, Tab and Enter happened to land in the panel |
| B2-3 | **Met.** The menu is Home, Guide, Leaderboard and Contact: real links, Home `aria-current`, each answering 200. The file check confirms the exact markup on every page, and no Discord | **Fails** |
| B2-4 | **Met.** The footer is on the entrance, the news list, an article and each static page: "© 2026 Aeturnis Development Labs, LLC" with Contact. Every link resolves, and there is no Privacy or Terms. **In the game:** no footer, and the copyright under Hero → Settings, "About" | **Fails** |
| B2-5 | **Met.** `/guide`, `/leaderboard` and `/contact` answer 200, each with the menu (itself current), the footer and no script, at 320, 390 and 1440. `netlify.toml` rewrites each and gives it the news pages' no-script policy (file check). Contact links `mailto:support@monstraregna.com` | **Fail:** the pages don't exist |
| B2-6 | **Met.** See section 3 | **Hard checks pass there too, as guards.** They hold what already held. The browser test counts, from the browser's own timing, what started before the first contentful paint |
| B2-7 | **Met:** axe at all impacts, 0 violations, at 320, 390 and 1440:<br>- the entrance with news, with "Skip to sign in" focused, while restoring a session, and during a reset;<br>- each static page;<br>- the entry tool's screens at six sizes | **Fails at 320 while restoring a session** (`scrollable-region-focusable`, serious; see section 4). Passes at 390 and 1440 |
| B2-8 | **Met.** The entrance, news, password recovery, layout and sign-out suites pass, apart from the four assertions in section 4. News loading and its failure isolation, sign-in, sign-up, the interface choice and recovery are unchanged | — |

## 3. The performance contract (scope 4.5)

**The hard checks:**
- **At most 3 requests before the form, besides the icon and manifest:** 3 (the document, `entry.css` and `entry.js`), before and after.
- **No game modules, `style.css` or supabase-js for an anonymous visitor** who hasn't used the form: none, also checked after 1.5 s.
- **The news after the first paint, failure-isolated:** unchanged. It still loads from `entry-news.js` after the paint (L-4's tests, which pass).
- **First-paint decoded bytes: 35,620** (33,960 on `e1ffa43`: +1,660), under the 48,000 tripwire and the 40,000 review threshold, so no explanation is required.
  - **`index.html`:** 5,356 bytes (−293; the removed section outweighs the menu and footer).
  - **`entry.css`:** 11,929 (+1,464; the grid, skip link, menu and footer styles).
  - **`entry.js`:** 18,335 (+489; the skip link's handler).

**Measured with `tools/entry-metrics.mjs`,** on the fake backend under its throttled phone profile (150 ms latency, 1.6 Mbit/s, 4× CPU, 390×844); medians of 3, measured the same way on both:

| Measure | Target | Before (`e1ffa43`) | After |
|---|---|---|---|
| Time to the form | ≤ 0.8 s | 689 ms | 704 ms |
| LCP (lab) | ≤ 2.5 s | 608 ms | 624 ms |
| CLS (lab) | ≤ 0.1, reported | 0 | 0 |
| Focusing the email field, to the next frame | reported | 11 ms | 11 ms |
| Requests before the first paint | — | 3 | 3 |

**The differences are within run-to-run noise:** the after runs were 703 to 725 ms, the before runs 674 to 712. These are lab figures under this profile only, not field figures.

**Not made blocking:** CLS stays reported until it has proved stable across repeated CI runs, as the scope says.

**Evidence:** `docs/ui-audit/mr-b2/before/` and `after/`.
- **Each contains:** `entry-metrics.json`; the sign-in screen at 320×640, 390×844, 844×390, 1024×768, 1440×900 and 1920×1080, each with 0 axe violations; and the entrance with news at 390 and 1440.
- **After only:** the three static pages and a news article, at 390 and 1440.

## 4. Deviations and notes

1. **Spacing by margins, not the grid's gap.** An empty grid row still takes a gap above and below it, so the reserved `status` area (and the hidden news) would have shown as empty space. Each item now carries its own bottom margin (1.25rem, and 1.75rem on desktop), which looks the same and lets an empty area take nothing.
2. **The static pages are directories** (`public/guide/index.html`), served at `/guide` by a rewrite in `netlify.toml`. The test server maps a directory to its `index.html` in the same way.
3. **The menu's gap scales with the screen** (0.75rem on a 320px phone, up to 1.25rem), so the menu stays one line at 320px, as the scope asks. On a phone with wider system fonts, it may wrap, as allowed.
4. **The news pages keep their own "All news" link** in the header, beside the site menu: the menu has no News item, and the article pages rely on that link. Their "Enter the realm" link is replaced by Home.
5. **An existing accessibility violation fixed in passing.**
   - **On `main`:** at 320×640, while a saved session is restored, the entrance's scroll area overflows with nothing focusable in it (`scrollable-region-focusable`, serious). Earlier axe sweeps didn't cover that state at 320px.
   - **Now:** the menu's links are focusable, so it passes.
6. **Four existing assertions updated** (B2-8), each with its reason in the test:
   - **`tests/ui/entrance.test.mjs` LAC-7:** the first Tab stop is now "Skip to sign in", and Enter on it reaches the email field.
   - **`tests/ui/news-public.test.mjs` LAC-15 and Q5:** the same, with the news and the maintenance line shown.
   - **`tests/ui/layout-choice.test.mjs` LAC-9:** it measures the menu and footer in place of the removed "The realm".

   No other assertion changed.
7. **B2-6's browser check counts by the first contentful paint,** not by when Playwright notices the form. A first version raced with the news, which deliberately starts after the paint, and failed on `main` for that reason, not because of the contract.
8. **The copyright year is fixed text,** in `site.js` and the files that copy it. Updating it is a yearly task (`CLAUDE.md`).

## 5. Runs and CI

**Local, on `aaba8b2`** (the code and tests as pushed; later commits change documentation only), on the owner's Windows laptop:

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 70 of 70 | 306 of 306 |
| 2 | 70 of 70 | 306 of 306 |
| 3 | 70 of 70 | 306 of 306 |

- **The counts:** engine 70 (65 before, plus the 5 file checks); browser 306 (288 before, plus the 18 homepage tests).
- **The database suite** is unaffected; CI runs it.
- **CI:** recorded on the PR once its run completes.

## 6. Not verified

- **Netlify itself:** the static pages' rewrites and headers are checked from `netlify.toml`, not on Netlify. After deployment, a read-only check should confirm that `/guide`, `/leaderboard` and `/contact` answer 200 with the policy, and that the entrance and news pages show the menu and footer.
- **Real phones:** the menu on a 320px screen with the phone's own fonts, and the skip link with a screen reader. The suites run in Chromium only.
- **Screen readers.**
- **Field performance:** the figures are lab measurements under one profile.

## 7. After deployment: the static pages were redirected (B2-R1), and the correction

### 7.1 What the live check found

**After PR #56 was merged** (`1679855`), Netlify published the site in about 30 s.

**Read-only checks of the live site** (first responses, no redirect followed; the full output is in `docs/ui-audit/mr-b2/live-1679855-check.txt`):

| Address | Result |
|---|---|
| `/` | 200; the menu (Home current), the footer, the skip link; the removed sections gone |
| `/news`, `/news/under-construction` | 200; the no-script policy, the canonical address, the menu and the footer |
| **`/guide`, `/leaderboard`, `/contact`** | **301, `Location: /guide/`** (and so on). Not the page: no policy, no canonical address, no menu or footer |
| `/guide/`, `/leaderboard/`, `/contact/` | 200, the no-script policy, the canonical address, the menu and the footer |

**For visitors,** the pages worked, after one redirect each. **But:**
- B2-5's "answer 200 at their addresses, rewritten, not redirected" did not hold;
- every menu click cost an extra round trip;
- each page's canonical address pointed at a redirect.

### 7.2 The cause

**Each page was a directory with an `index.html`** (`public/guide/index.html`). Netlify answers a directory's address without its trailing slash with a 301 to the slash form, before any rewrite in `netlify.toml` applies, so the 200 rewrites never ran. The owner's review confirmed this against Netlify's documentation and support guidance: a standalone `/guide.html` is served at `/guide`, while `/guide/index.html` redirects `/guide` to `/guide/`. The live 301s match.

**Why the tests passed:** the test server served a directory's address directly, unlike Netlify. That is a gap in the test environment's fidelity, not in the homepage's design.

### 7.3 The correction (option A, decided by the owner; a follow-up PR)

**The pages and the rewrites:**
- **Single files:** `public/guide.html`, `public/leaderboard.html` and `public/contact.html`, moved without change apart from a comment.
- **The 200 rewrites** in `netlify.toml` point at them: `/guide` to `/guide.html`, and so on.
- **The slash forms** (`/guide/`) are rewritten to the same file, so earlier links keep working, with no redirect.
- **Unchanged:** the menu links, the slashless canonical addresses and the headers (`/guide*` covers all three forms).
- **Not touched:** Netlify's site-wide "Pretty URLs" setting.

**The test server now serves as Netlify does,** in Netlify's order:
1. a file at the address;
2. a directory's address without its slash: a 301 to the slash form;
3. `netlify.toml`'s 200 rewrites, read from the checkout being served;
4. a directory's `index.html`, or `x.html` for `/x`.

With it, the tests reproduce the production 301s on `1679855`.

**New regression checks:**
- **Browser:** `/guide`, `/leaderboard` and `/contact`, and their slash forms, answer 200 on the first response, with no redirect followed, and are the page itself (its slashless canonical address).
- **Tightened:** the menu test and the static-page tests also refuse a redirect.
- **File check:** no public page is a directory with an `index.html`; each menu page is `public/<name>.html` with a 200 rewrite to it. It also covers pages still to come (Privacy, Terms).
- **`tools/public-pages-check.mjs`:** the read-only live check, reusable. It reads first responses only and exits 1 on any difference. It is what showed the problem above.

**Against `1679855`** (`UI_PUBLIC_DIR`, with that checkout's own `netlify.toml`): the five routing-related browser tests fail there, with the 301s, and pass here.

**What Netlify should do after the merge:**
- `/guide`, `/leaderboard` and `/contact` answer 200 directly, through the rewrites, with no directory left to trigger the slash redirect;
- `/guide/` and the other slash forms answer 200 through their own rewrites;
- `/guide.html` answers 200 (it is a file);
- every one of them has the no-script policy.

`tools/public-pages-check.mjs` confirms this, read-only, after the merge.

### 7.4 Runs and CI for the correction

**Local, on `d913056`** (the correction's code and tests as pushed), on the owner's Windows laptop:

| Run | Engine and file tests | Browser |
|---|---|---|
| 1 | 71 of 71 | 307 of 307 |
| 2 | 71 of 71 | 307 of 307 |
| 3 | 71 of 71 | 307 of 307 |

- **The counts:** engine 71 (70, plus the directory-index check); browser 307 (306, plus the first-response test).
- **The test server's Netlify behaviour** (a directory's address without its slash redirected) broke no existing test.
- **CI on the PR's own base** (run `44596307837`, head `4033a94`, merge commit `207b111`):
  - **Attempt 1:** engine and database passed. Browser failed 1 of 307: `PR-4a a second tab with the saved session also shows the form` timed out.
  - **The cause, from the trace:** a race in that test's setup, not this correction and not the runner. It is recorded on the PR and in `docs/backlog.md`.
  - **Attempt 2,** the one authorized re-run: browser passed 307 of 307.
- **The race was corrected separately,** test only, in PR #58 (`0029aea`), approved and merged first.
- **Combined with PR #58:** the branch was brought up to date with `main` (`0029aea`); the routing change is unchanged. Browser total 308: 306, plus this correction's first-response test, plus PR #58's proof test.
- **Combined CI:** recorded on the PR once its run completes.

