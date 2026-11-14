# Landing page: scope

**Status: scope approved (2026-11-13). Stage 1 (L-1 and L-2) and L-3 are complete. L-4 is merged and checked live, awaiting its completion review.**
- **L-3, publication:**
  - **Code:** approved at `736a524` and merged as PR #29 (`724807b`).
  - **Production:** the migration was applied (with only its own history entry), the `admin` function deployed as version 8, and the public check passed 21 of 21.
  - **See:** `docs/landing-l3-report.md`, section 12.
- **L-1, the entrance:** complete, merged as PR #25 (`b911a79`). See `docs/landing-l1-report.md`. Its gate, the vendored Supabase UMD build, was verified against the fake backend (report section 7). Running against the live project is a pre-release item.
- **L-2, the interface picker:** complete, merged as PR #27 (`4c9d049`) after review with no corrections. See `docs/landing-l2-report.md`.
- **Regression baseline** on `main` at `4c9d049`: engine 29/29 and browser 156/156, in each of 3 runs.
- **L-3's production results** were reviewed and approved; their record was merged as PR #30 (`eccbcc3`).
- **L-4, public news:** approved in its final review at `888434d` and merged as PR #32 (`d754dad`, 2026-11-14). The read-only live checks passed. See `docs/landing-l4-report.md`, section 9. Awaiting the completion review.
- **LAC-2's byte target is revised to 32,000 decoded bytes** (L-4 review, 2026-11-13). This is a scoped exception, decided by the reviewer and recorded here rather than counting the original 30 KB as met.
  - **Why:** the news itself loads after the first paint, as the owner directed. Its two hooks (the hidden news markup in `index.html` and the after-paint loader in `entry.js`) bring the first paint to 31,112 bytes as served, against 29,800 after L-2.
  - **Unchanged:** the metric is still decoded bytes, measured as in L-1 and L-2, not compressed size. The other LAC-2 conditions also stand: three requests before the first paint, no game code or supabase-js for an anonymous visitor, and news loaded independently.
  - **Comments** were not stripped to fit.

The original scope status follows.
- **Approved:** in the final independent review at `37f490a`, and merged into `main` as PR #23 (`e385e38`). The merged document is identical to the reviewed head.
- **What this document is now:** the implementation contract for L-1 to L-4, each with its own review gate.
- **Decisions:** every question in section 5 is decided. The owner answered Q1–Q4 first, then Q2a and Q5–Q14 in the scope review of `350d23e`.
- **Corrections:** the review of `350d23e` asked for five, all accepted at `37f490a`. They are in section 12.
- **Not authorized:**
  - L-1, or any other phase;
  - application or server code changes;
  - migrations or function deploys;
  - the rename to Monstra Regna.

  L-1 begins only when the owner separately authorizes it.
- **Implementation gates still open.** The scope's approval does not accept their runtime behaviour:
  - **L-1** must validate the vendored Supabase UMD build before it replaces the current client.
  - **L-3** must get the local Supabase stack running and the existing migrations applying to a fresh database before any production change is considered.
- **To watch in L-1** (from the final review): asynchronous game start-up must be invalidated if the account changes, or the player signs out, before it finishes. Use the same session-generation check that chat uses (`current(s)`).

This scope covers the public entry experience: the game's first screen before sign-in, the interface picker, and public news. It works like the desktop scope (`docs/desktop-scope.md`): evidence, findings, the owner's direction, decisions, constraints, acceptance criteria and phasing.

> **Owner direction:** the landing page is the game's own first screen. It is not a separate website or a promotional layer. It should feel like the entrance to a fantasy realm, not a SaaS dashboard, while keeping sign-in fast and simple.

## 1. Method and limits

- **Tool:** `tools/entry-metrics.mjs`, with its definitions at the top of the file.
  - It runs on the UI test harness: files are served locally and the fake backend answers Supabase. The raw data is in `docs/ui-audit/landing/metrics-before.json`.
  - Later phases can rerun it with `UI_PUBLIC_DIR` to measure a change the same way.
- **Screens:** the sign-in screen at 320×640, 390×844, 844×390, 1024×768, 1440×900 and 1920×1080, in `docs/ui-audit/landing/before-auth-*.png`. Axe-core 4.10.2 at all impacts found **0 violations on all 6**.
- **Bytes are decoded sizes** as served locally, not the compressed sizes Netlify and the CDN send.
- **Startup requests, not render-blocking dependencies.**
  - The request and byte counts include everything that finished by the moment measured, plus up to 300 ms after it. So they are startup resource counts, and they vary slightly between runs.
  - What actually blocks the form is measured separately, by making one dependency fail at a time (`formBlockedBy`, the second table in section 2).
- **The throttled timing:**
  - It uses Chrome's network throttling (150ms latency, 1.6 Mbit/s down) and a 4× CPU slowdown, taking the median of 3 runs.
  - The supabase-js CDN module is answered from the harness's cache and may not be throttled, so the figure is an **underestimate**.
  - It is useful for before and after comparison only. It is not a real-phone timing.
- **Not measured:** real phones, real networks, the live Netlify site and Supabase, Firefox, Safari, and screen readers.

## 2. The current entry

`index.html` contains empty regions and one script, `js/main.js`. Everything the player sees is drawn by that module:

1. **Before any script runs:** the page is blank (the dark background only).
2. **Loading:** `main.js` statically imports the whole game: the engine, data, chat, confirmations, layout and `net.js`. `net.js` imports supabase-js from `cdn.jsdelivr.net`. Nothing runs until all of them have loaded.
3. **"ClickMonster / Loading"** (`viewLoading()`) shows until supabase-js reports whether a session is saved.
4. **No session:** the sign-in form (`viewAuth()`) shows: the title, one line ("A shared world of monsters, gold and glory."), email, password, Sign in, and "New here? Create an account".
5. **After sign-in:** "Loading" shows again, then character creation for a new account, or the game.

Measured (`metrics-before.json`):

| Measure (startup resources, section 1) | Fresh visitor, until the sign-in form is visible | Returning player, until the hero bar is drawn |
|---|---|---|
| Startup requests | 36 | 53 (an earlier, uncommitted run gave 52; the committed data prevails) |
| Decoded bytes | 415 KB | 416 KB |
| Own JS modules (`/js/`) | 26 (213 KB) | 26 |
| supabase-js from the CDN | 7 requests (128 KB) | 7 |
| Stylesheet | 1 (60 KB, the whole game's CSS) | 1 |
| Longest static import chain from `main.js` | 7 levels | 7 |
| Time to the form, throttled (underestimate) | 2.6 s (unthrottled: about 0.2 s) | not measured |

Render-blocking dependencies: what happens when one fails, measured in separate runs:

| Failure | Sign-in form appears? | What the visitor sees |
|---|---|---|
| The supabase-js CDN is unreachable | **No** (waited 8 s) | A blank page with no text and no message |
| The `zones` read fails (HTTP 500) | Yes | The normal sign-in form |

Netlify serves `/js/*` with `Cache-Control: public, max-age=0, must-revalidate` (`netlify.toml`). On every visit, each of the 26 modules is revalidated with the server before it can run. That is fine on a fast connection, but it costs a round trip per level of the import chain on a slow one. This was read from the configuration and was not measured against the live site.

## 3. Findings

- **E1. The first screen depends on the whole game.**
  - The sign-in form is drawn only after 26 game modules, supabase-js and the 60 KB game stylesheet have loaded: 36 requests and 415 KB decoded.
  - None of the engine, data or chat code is needed to show a form.
- **E2. A third-party CDN outage is a blank page.**
  - If `cdn.jsdelivr.net` can't be reached, the visitor sees nothing: no name, no form, no message.
  - This breaks the requirement that entering the game never depends on anything it doesn't need. Sign-in itself does need supabase-js, but showing the entrance and explaining the problem does not.
- **E3. Nothing is in the HTML.** Before scripts run the page is empty, so the first meaningful paint waits for the full module chain.
- **E4. There is a separate launch screen, twice.** "Loading" appears before the form and again after signing in. The owner's requirement is a continuous entrance with no second launch screen.
- **E5. The entrance doesn't introduce the game.** It has one line of text, no setting, no news and no sense of place. At 1440 and 1920 the form stretches to 760px across a mostly empty dark page.
- **E6. At 844×390 (a phone on its side),** the Sign in button is below the fold.
- **E7. The entry's layout comes from the game's layout rules.**
  - The sign-in screen is drawn inside `#app`. The Phase 2 wide rules (`style.css:489`) and the desktop rules apply to it, with special cases such as `#app:has(#top:empty)`.
  - Once a picker can force a layout, the entrance would change with it. The owner requires the entrance to be independent of that preference.
- **E8. Returning players wait for the same chain,** then for the session check, before the game starts loading their hero. Nothing is started early, even though a saved session is visible synchronously in `localStorage['clickmonster.auth']`.
- **E9. No public news exists.**
  - Announcements and world events (`events`, `world_config`) are readable only by signed-in players (row-level security `to authenticated`).
  - They are game data, not development news.
- **E10. The layout picker has no forcing path yet.**
  - `layout.js` decides `data-layout` from the media queries alone.
  - The Phase 2 wide rules are still plain media queries (`style.css:489` and `:514`), not keyed off `data-layout`. A forced Mobile on a large screen would still get the two-column layout.
- **E11. The sign-in screen's accessibility is sound and must stay so.** It has labels, `autocomplete`, inline errors with `aria-invalid` and `aria-describedby`, and an alert or status for messages. Axe found 0 violations at all 6 sizes.

## 4. Owner direction (given 2026-11-13)

| Topic | Direction |
|---|---|
| What it is | The game's own first screen. Sign-in is one part of entering the realm |
| What it does before sign-in | Introduces the game (identity and fantasy setting, without reading as an advertisement), shows what's happening (development updates, announcements, maintenance), and lets players in (sign in, create an account, choose the interface) |
| Sketch | "MONSTRA REGNA / Monsters & Kingdoms / A persistent fantasy world of exploration, combat, and adventure", then Enter the Realm (sign-in), Latest News and Interface Preference. Illustrative only; it must reflow for phones |
| Stages | One cohesive design, reviewed in two stages: the interface picker, and public news |
| Public content, first version | Conservative: explain the game, show updates, offer the interface choice, sign in or sign up. No live player counts, player identities or boss activity |
| What may be public | Development updates, patch notes, release announcements and scheduled maintenance; possibly curated world announcements. Live world events and hunts are not public; an article may announce an event, but the event itself stays in the game |
| News | Its own table, separate from in-game world events. Explicit publication: Draft, Published, Unpublished. The public can only ever read published entries |
| Name | Still undecided. "Monstra Regna" is the favoured working title; the rename is a separate decision (repository, metadata, domain, trademark checks). The design must not depend on the name |

Requirements the owner set:

1. **Public content is never a dependency for entering the game.**
   - Sign-in works when the news service is down.
   - A returning player with an active session resumes without waiting for announcements.
   - A visitor reading an update doesn't download or start the gameplay app.
2. **Linkable news:** stable URLs, readable HTML and link-preview metadata, in the same app and design.
3. **Mobile performance:** the first screen renders fast, and game systems start only when they are needed.
4. **Sign-in first:** returning players see how to sign in immediately. The introduction and news never get in the way.
5. **The entry layout is independent of the gameplay layout preference.** It responds to the space available, whatever Automatic, Desktop or Mobile says.
6. **A continuous experience:** after sign-in, the entrance turns into the player's character and world. There is no second launch screen and no change of design language.
7. **Independent failure handling** (added with the Q1–Q4 decisions). Authentication, public news and gameplay start-up each fail on their own:
   - The entrance renders without waiting for the game engine or Supabase.
   - News failing never prevents sign-in.
   - A valid returning session goes into the game without waiting for articles.
   - An article request never starts the gameplay application.

   The continuous experience comes from this separation, not from making every part depend on every other part.

## 5. Decisions

### Decided by the owner (2026-11-13)

These are scope decisions, not authorization to start implementation.

| Question | Decision |
|---|---|
| Q1. Article pages | **Netlify Edge Function.** `/news/<slug>` is served as real HTML with article metadata, on the same domain as the game. The function reads only published articles through Supabase's public API, under RLS. Drafts and unpublished articles must never be reachable through any public query. **Caching:** Netlify doesn't cache dynamic Edge Function responses on its own, and none is added at first. Article HTML is sent uncached (`Cache-Control: no-store`). A short explicit TTL, or cache invalidation, comes later, once publishing and unpublishing have been verified live |
| Q2. supabase-js | **Host a pinned copy in `public/vendor/`.** This removes the third-party CDN from the sign-in path. Rendering the entrance first only fixes the blank screen; players still couldn't sign in with jsDelivr down. Conditions: the vendored artifact must be verified self-contained, keep its licence notices, and have its version and update procedure documented. The entrance still renders, and reports a useful error, if Supabase itself is unavailable |
| Q3. Phasing | **Four PRs, each with its own review gate:** L-1 the entrance and its loading, L-2 the interface picker, L-3 the publication backend and admin console, L-4 the public news list and article pages. Publication permissions and public-read security (L-3) must be accepted before news is exposed on the landing page (L-4) |
| Q4. Article body | **Paragraphs and bullet lists** in the first version. Both are rendered safely without arbitrary HTML or a Markdown engine. Embedded links and images wait until there is a demonstrated editorial need; each article already has its own shareable URL |

The owner also added requirement 7 (section 4): independent failure handling for authentication, public news and gameplay start-up.

### Decided by the owner in the scope review (2026-11-13)

| Question | Decision |
|---|---|
| Q2a. Vendored artifact | **Supabase's official UMD browser build,** `dist/umd/supabase.js` of the pinned version, with its auxiliary chunk, its licence, SHA-256 hashes and update instructions. Supabase supports loading the client as a browser script that exposes a `supabase` global. L-1 must verify that the exact pinned artifact works before it replaces the current client. The entrance and the game share **one** initialized client (section 6, "One Supabase client") |
| Q5. Maintenance notices | Accepted: optional start and end times, shown near sign-in, never blocking authentication |
| Q6. Publishing | Accepted: administrators only, for the first release |
| Q7. Byline | Accepted: published under the game's identity; no staff email or identity exposed |
| Q8. Editing | Accepted: the slug is immutable after first publication; the original publication date is kept, and the updated date is shown. Fixing a typo must never break a shared link |
| Q9. Unavailable URLs | Accepted: the same 404 for unknown and unavailable articles |
| Q10. Entrance news | Accepted: the 3 latest published articles, with summary and date, and All news |
| Q11. Character creation | Accepted: visually integrated into the entrance, with no change to its mechanics |
| Q12. Layout choices | Accepted: Automatic, Desktop and Mobile, with a visible explanation when falling back. **The stored preference stays Desktop** while the game temporarily falls back for lack of space; a fallback never overwrites the player's choice |
| Q13. Share image | Accepted: text-only previews at first; no image asset is required |
| Q14. Extras | RSS and in-game notification are deferred. **Password recovery** is tracked separately, as a higher-priority account-reliability item (`docs/backlog.md`), not as part of this milestone |

### The options as they were put

**Q1. How article pages get readable HTML and link previews.** Link-preview crawlers generally don't run JavaScript, so `/news/<slug>` needs HTML from a server.

| Option | How | Trade-offs |
|---|---|---|
| **A. Netlify Edge Function (chosen)** | `netlify/edge-functions/news.js` handles `/news` and `/news/*`. It reads published entries from Supabase's REST API with the public key, so RLS still decides what is visible. It returns HTML with the meta tags | Plain JS with no project build step; Netlify bundles it on deploy. Same site, same domain and the same stylesheet. It is a new server-side piece on Netlify, so it needs tests that call its handler directly. The draft said "a short CDN cache, about a minute"; that was corrected in the decision (no caching at first) |
| B. Supabase edge function behind a Netlify rewrite | `/news/*` proxied to a Supabase function that returns HTML | Supabase has blocked HTML responses on the default `supabase.co` domain since October 2024; it needs a custom domain (a paid add-on). Not recommended |
| C. Static pages generated on publish | Publishing triggers a Netlify build hook, and a script writes `public/news/*.html` | Introduces a build step and a deploy per publish (a minute or more). Unpublishing needs a deploy too. Conflicts with "no build" |
| D. Client-rendered only | `index.html` draws the article with JS | No link previews and no readable HTML without JS. Fails requirement 2 |

**Q2. supabase-js on the sign-in path.** The entrance itself will no longer need it (section 6), but submitting the form does.
- Recommended in the draft: keep the pinned CDN module, loaded after the first paint, with a persistent error and Try again if it fails.
- **Chosen:** vendor a pinned copy into `public/vendor/`, so sign-in depends only on our own site and Supabase. Section 6 covers the artifact.

**Q3. Phasing.** The owner set two stages. The entrance shell (static first paint, game loaded on demand, continuous transition) has to land first, because both stages build on it. **Chosen:** four PRs in two stages (section 9).

**Q4. Article body format.** These are separate questions: an article being linkable, and an article containing links.
- **Chosen:** plain text with paragraphs and simple bullet lists (lines starting with `- `), for patch notes. No HTML, no links and no images in the first version, consistent with the chat link policy. The server escapes everything.
- Not chosen: links to the game's own site, which wait for a demonstrated need.

### Recommendations as they were put (all decided above)

**Q2a. Which vendored artifact.** The owner asked for the "vendored ESM artifact" to be verified as self-contained. The ESM build the game uses today is not self-contained (section 6), so the choice is between these:

| Option | For | Against |
|---|---|---|
| **The package's own browser build, `dist/umd/supabase.js` (recommended, a deviation from "ESM"; chosen)** | Byte-identical to what Supabase published, and checkable against its hash. One file, plus a 223-byte stub chunk | Not an ES module. It is a classic script that sets a global, `supabase`. It must load before `net.js` runs, and `net.js` reads `createClient` from the global |
| The seven `+esm` modules, with their absolute `/npm/` imports rewritten to relative paths | Stays ESM; `net.js` keeps a normal `import` | Our copies are no longer byte-identical to the published files. Seven files to update by hand, and each update repeats the rewrite |

**Q5. Maintenance notices.**
- **Recommended:** a news kind, `maintenance`, with an optional start and end time.
  - While it is upcoming or under way, the entrance shows one line near the form, with a link to the article.
  - It disappears on its own after the end time. It never blocks sign-in.

**Q6. Who writes and publishes.** **Recommended:** admins only, in the first version, for drafting, publishing, unpublishing and deleting. Alternative: moderators can draft, and admins publish.

**Q7. Byline.** **Recommended:** no individual author is shown publicly; articles are from the game. Staff email addresses are never exposed (column grants, section 7). Alternative: a staff display name, which needs a new field.

**Q8. Changing published entries.**
- **Recommended:**
  - A published entry can be edited, and then shows "Updated <date>".
  - Its URL slug is frozen when it is first published.
  - Published entries can't be deleted, only unpublished. Drafts and unpublished entries can be deleted, with a confirmation.

**Q9. Unpublished and unknown URLs.** **Recommended:** both return 404 with a page in the same design: "This update isn't available", with links to News and the game. The public role can't see unpublished rows, so it can't tell the two apart, and that is intended.

**Q10. News on the entrance.** **Recommended:** the latest 3 published entries, each with its title, date and one-line summary, linking to its article, plus "All news" linking to `/news`.

**Q11. Character creation.** **Recommended:** restyle it into the entrance's design language in L-1 ("Who are you?" as the last step of entering the realm), with the same fields and behaviour. Alternative: leave it as it is for now.

**Q12. What the picker's choices mean.**
- **Recommended:**
  - **Automatic** is today's behaviour: phone, Phase 2 wide or desktop, by space and pointer.
  - **Desktop** forces the desktop layout whenever the usable width allows it (75rem), whatever the pointer. It falls back to Automatic, and says so, when there isn't room.
  - **Mobile** forces the phone column, centred, at any size.

**Q13. Share image.** **Recommended:** none in the first version (`summary` link cards with title and description). Alternative: one static image in the repo, used for every article.

**Q14. Out of scope unless the owner adds them:** a "Forgot password" link (it needs Supabase redirect and email-template configuration), an RSS feed, and per-player notification of news after sign-in.

## 6. Proposed architecture

```
/                 index.html: the entrance, in the HTML itself
                  entry.css (small)  +  entry.js (small module)
                    |  first paint: identity, sign-in form, interface picker; no game code
                    |  after paint:  news list (plain fetch, with a timeout, failing quietly)
                    |  sign-in begins (the form is used): load supabase-js, nothing else
                    |  saved session found (synchronously): load supabase-js and the game
                    v
                  net.js: the one Supabase client and the one auth listener
                    |  signed in (new user): start the game
                    |  signed out or session ended: stop the game, show the entrance
                    v
                  game (main.js and the rest), loaded only after sign-in or with a session;
                  the entrance gives way to the hero and world in place
/news, /news/*    Netlify Edge Function: server-rendered HTML in the entrance's design,
                  published rows only, no game code
/admin            unchanged, plus a News section (L-3)
```

- **Static first paint.**
  - `index.html` holds the entrance: the name, the subtitle, a short introduction, the sign-in and create-account form, and (from L-2) the interface picker.
  - A small `entry.css` styles it. The 60 KB game stylesheet is not render-blocking for the entrance.
  - The form is a real HTML form, so it is visible and focusable before any script runs.
- **The vendored supabase-js (Q2).**
  - **Not self-contained today.** The jsDelivr module the game imports now is not self-contained. `supabase-js@2.45.4/+esm` imports six more modules by absolute `/npm/` paths: `auth-js`, `functions-js`, `node-fetch`, `postgrest-js`, `realtime-js` and `storage-js`. That is the 7 CDN requests in section 2, so a copy of that one file would not work offline from the CDN.
  - **Candidate artifacts:**
    - **Chosen (Q2a):** the package's own browser build, `dist/umd/supabase.js` of the same pinned version (111 KB, minified as published), copied unmodified from the published package. It is loaded as a classic script and exposes `supabase.createClient`, and `net.js` reads it from there.
      - It is nearly self-contained. It has one lazily loaded chunk, `dist/umd/591.supabase.js` (223 bytes): a stub that throws "ws does not work in the browser". Realtime loads it only where there is no native `WebSocket`.
      - The chunk is vendored beside the main file, so even that path makes no third-party request.
      - The package's MIT `LICENSE` file is kept beside them.
      - This was read from the package listing and files on 2026-11-13, not yet run.
    - Or: the seven ES modules, with their absolute import paths rewritten to relative ones. This keeps ES modules, but our copies would no longer be byte-identical to what was published.
    - **The admin console uses it too.** `admin.js` imports `sb` from `net.js`, so it moves to the vendored copy in the same change. With the UMD build, `admin.html` loads the same classic script before `admin.js`.
    - **The edge functions are not affected.** They import `npm:@supabase/supabase-js@2.45.4` themselves and don't use `net.js`.
    - Bundling it ourselves would add a bundler as a dev dependency, and it isn't proposed.
  - **L-1 verifies the chosen artifact before it replaces the current client:**
    - sign-in, sign-up, session restore, token refresh, functions calls, table reads and Realtime chat all work with it on the harness;
    - it makes no network request except to Supabase;
    - the test harness's CDN allowance is removed, so any third-party request fails a test, in the admin tests as well;
    - the package's `LICENSE` is kept beside it.
  - **`public/vendor/README.md`** records the package, version, source URL, SHA-256 of each file, and the update steps.
  - **The version is in the directory:** for example `public/vendor/supabase-js@2.45.4/`. Copied unmodified, the file is just `supabase.js`.
    - The webpack chunk resolves relative to the main script, so it sits in the same directory.
    - Because the path changes with every version, L-1 adds a `/vendor/*` rule to `netlify.toml` with a long, immutable cache.
- **`entry.js` is small and imports no game code.**
  - **Returning players:**
    - It checks `localStorage['clickmonster.auth']` synchronously.
    - If a saved session is there, it loads supabase-js and the game at once, and shows an in-place status on the entrance ("Returning to the realm"), not a separate screen. It does not wait for news.
    - That check is only a hint for starting early; the client's own session restore decides (section 6, "One Supabase client").
  - **Anonymous visitors download no gameplay code.**
    - Reading the entrance, or its news, fetches no game module and no supabase-js.
    - supabase-js loads when sign-in begins: the first focus or input that the visitor makes in the sign-in or create-account form, or its submission.
    - The entrance doesn't autofocus the form, so loading the page alone never starts it. Sign-in is first in the reading and tab order, and visible without scrolling, instead.
    - The game's modules load only after sign-in succeeds, or when a saved session is being restored.
    - This removes the 26-module download from anonymous visits; it doesn't move it into the background.
    - Idle prefetching of the game is not part of L-1. If it is proposed later, it is justified and measured separately.
  - **On submit,** it signs in through the shared client. If supabase-js is still loading, the button shows its pending state until it is ready.
  - **If the vendored library can't load, or Supabase can't be reached,** the form shows a persistent, useful error with Try again. The entrance itself stays usable.
  - It reads and writes `clickmonster.prefs` itself for the picker, and doesn't import `main.js`.
- **One Supabase client, one owner** (review correction 2).
  - **`net.js` owns the client.** It is the only code that calls `createClient`, and it does so once per page.
    - It loads the vendored script if it isn't loaded, creates the client, and returns the same instance to every caller: `entry.js`, the game (`main.js`, `chat-ui.js`) and the admin console.
    - If loading fails, the error is returned, and a retry loads again. A failed attempt never leaves a half-made client, and a retry never creates a second one.
  - **One auth listener.** The entrance's session controller is the only `onAuthStateChange` subscriber on the game page, and it drives every transition:
    - **Signed in with a new user:** start the game.
    - **Signed out, or the session ended or failed to refresh:** stop the game and show the entrance.
    - **Token refreshes, user updates, and repeated sign-in events for the user already playing:** no transition. The browser can repeat sign-in events, for example when a tab regains focus, and today's `wasSignedIn` check guards against them.
    - **A different user** (an account switch): stop, then start, using the chat session rule (`current(s)`) that already guards Realtime callbacks.
    - `main.js` no longer subscribes itself.
  - **Token refresh** comes from that single client's `autoRefreshToken`, so nothing refreshes twice.
  - **The admin console** keeps its own page and listener, using the same `net.js` client code.
  - **Saved sessions.** The synchronous check is only a hint:
    - **valid:** the game starts, with no form shown in between;
    - **expired, with a working refresh token:** the session is refreshed and the game starts;
    - **expired and not refreshable,** or **revoked:** the entrance shows the form with "Your session has ended. Please sign in again." The game is not started and no `state` call is made;
    - **malformed** (not JSON, or the wrong shape): treated as no session. The entrance works, no error escapes to the console, and the bad entry doesn't block a fresh sign-in.
    - In every case the in-place status resolves; it never hangs.
- **The game becomes something the entrance starts.**
  - `main.js` stops being the page's entry point and drawing the sign-in form.
  - It exposes start and stop functions, which the session controller calls with the shared client and the session. Starting is idempotent for the same session.
  - **Signing out, or an expired session,** hands back to the entrance without a reload. `chat.stop()` and the existing account-reset rules still apply.
  - **If the game can't start** (its modules fail to load, or the first `state` call fails), the entrance stays. It shows a persistent error with Try again and a way to sign out, not a blank page or a half-drawn game.
  - **The handover is in place:** the entrance keeps showing until the hero and world are ready to draw, then gives way to them. The movement is transform and opacity only, and none with reduced motion. Focus lands at a defined place and the change is announced.
- **The entrance has its own layout rules.**
  - Its CSS responds to the available space (media or container queries in `em`), never to `#app[data-layout]`. The picker can't change it.
  - On phones the order is identity, sign-in, picker, then news. Side by side on wide screens, sign-in stays first in the reading order.
- **The picker (L-2).**
  - `layout.js` accepts a preference (`auto`, `desktop` or `mobile`) with the fallback rules in Q12.
  - The Phase 2 wide rules are re-keyed from media queries to `#app[data-layout="wide"]`, so a forced layout is honoured completely.
  - Automatic must give exactly today's results; all existing layout tests stay unchanged.
- **News reading (L-4) never runs the game.**
  - The entrance's list is a plain `fetch` to Supabase REST with the public key, with a timeout of a few seconds and no supabase-js.
  - Article pages are HTML from the edge function, using `entry.css` and no game modules.
  - **No caching at first:** article HTML is sent with `Cache-Control: no-store`, so unpublishing takes effect on the next request. A short TTL or invalidation is a later, separate change, made after publishing and unpublishing have been verified live (Q1).
  - **If Supabase is down,** an article page returns 503 with a short page in the same design ("News is unavailable right now") and a link to the game.
- **News publishing (L-3).**
  - A new `news` table and an admin console section. Writes go only through the `admin` edge function (section 7).
- **The name.** It appears in `index.html` (title and heading), the manifest, and one JS constant shared by `entry.js` and the edge function. The future rename is a change to those few places, which the L-1 report lists.

## 7. Constraints

- **Vanilla JS and no project build step.**
  - The Netlify Edge Function (Q1) is plain JS that Netlify bundles on deploy. It is a new server-side piece, approved through this scope.
  - **supabase-js** is already a production dependency, loaded from the CDN. Vendoring it (Q2) moves the same pinned version onto our own site; it adds no new dependency. Its version and update procedure are documented in `public/vendor/README.md`.
  - Dev dependencies stay pinned.
- **No third-party host on the entry path.** The entrance, sign-in and the game load only from our own site and Supabase.
- **Phase 1–4 accessibility stays intact:**
  - native `<dialog>` and focus handling;
  - persistent errors and inline validation (`aria-invalid`, `aria-describedby`);
  - `autocomplete` on the form;
  - polite announcements;
  - `confirm.js` for destructive admin actions;
  - no `confirm()` or `prompt()`.
- **The sign-in form is first:** first in the reading and tab order on phones, and on screen without scrolling on phones in portrait.
- **No emojis or icons in the game UI**, the entrance and the article pages included.
- **The in-game layouts are unchanged by L-1.** The phone, Phase 2 wide and desktop game layouts and their tests stay identical. L-2 changes only what a forced choice selects.
- **Public data boundary.** The only data readable without signing in is the `zones` table, as today, plus published news (L-3).
  - No player names, counts, events, hunts or chat are public.
  - Column grants mean the public can read only the article fields: id, slug, kind, title, summary, body, published and updated times, and the maintenance window. Never the status of hidden rows, staff ids or emails.
- **Security of publishing (L-3):**
  - **Row-level security** on `news`: `anon` and `authenticated` may select only where `status = 'published'` and the publication time has passed. No client writes are granted.
  - **Drafts** are read and previewed only through the `admin` function, which checks the staff role on the server.
  - **Every create, edit, publish, unpublish and delete** is written to `admin_log`.
  - **The admin console's rules apply:**
    - single-flight requests through `st.pendingForms`;
    - inline validation;
    - `confirm.js` tiers: unpublish is tier 2, with focus on Cancel; deleting a draft is tier 2; deleting an unpublished entry is tier 1, type the title.
  - **The edge function** uses only the public key and escapes every field. Article bodies are rendered from plain text (Q4), never stored HTML.
- **Server changes are limited to L-3 and L-4:**
  - a new migration;
  - new `admin` function actions;
  - the Netlify Edge Function.
  - Game rules, the `game` function and the existing tables don't change. The migration and the function deploy happen only with the owner's go-ahead.
- **Tests:**
  - **The fake backend** gains anonymous REST reads of `news` (published only) and the admin news actions, kept in step with the real function.
  - **Failure tests** use `failNext` and route aborts to prove sign-in works with news down, and that the form explains a supabase-js failure.
  - **Session tests** need the fake backend to model token refresh (`grant_type=refresh_token`), including a refresh that fails. Saved sessions are seeded valid, expired-and-refreshable, expired-and-refused, and malformed.
  - **The edge function's handler** is tested directly in Node with a fake `fetch`. The harness may route `/news/*` to it for browser tests.
- **RLS can't be tested on the fake backend.** L-3 therefore adds a local database (review correction 3):
  - **Local stack:** the Supabase CLI, pinned as a dev dependency. It is justified by this and only this: it runs a local Postgres, PostgREST and Auth in Docker.
    - `supabase start` applies every migration in `supabase/migrations/` to a fresh local database.
    - **What was checked on 2026-11-13:**
      - The Docker client (29.7.2) is installed on the owner's laptop.
      - `docker info` could not reach the Docker daemon: Docker Desktop's engine wasn't running. Whether it runs on this machine (on Windows Home it needs WSL 2) has not been checked.
      - The Supabase CLI is not installed, and nothing has been run.
    - **L-3 starts by checking** that the local stack runs, and that the existing migrations apply cleanly to a fresh local database. If the local stack can't run on this laptop, L-3 stops and the owner decides how to proceed.
  - **Database tests:** pgTAP files in `supabase/tests/`, run with `supabase test db`, as `anon`, as `authenticated`, and with the service role:
    - published rows are readable;
    - drafts, unpublished rows, and rows with a future publication time are not;
    - ungranted columns can't be selected;
    - insert, update and delete are refused for `anon` and `authenticated`.
  - **Local REST tests:** a Node test calls the local stack's REST API with its anonymous key, making the same checks over HTTP. They include `select=*`, selecting an ungranted column, filtering on hidden fields, and every write method.
  - **No production change without explicit authorization.** Approving the L-3 PR does not authorize the migration. Applying it to production and deploying the `admin` function each need the owner's explicit go-ahead. Before asking, the L-3 report documents the rollback: a migration that drops the table and its grants.
  - **After the migration is applied:** `tools/news-public-check.mjs` calls the production REST API with the publishable (anonymous) key, not only the SQL editor. It checks:
    - published reads;
    - that hidden rows stay hidden;
    - the column restrictions;
    - that writes are denied.
  - **The write checks use an identifiable payload** (for example the slug `rls-check-<timestamp>`). If a write succeeds:
    - the gate has failed;
    - the row is recorded in the report and removed;
    - L-4 stays blocked until the policy is fixed and checked again.
  - **A published row is needed for the read check.** It is an entry the owner approves for publication, or a clearly marked test entry, which is unpublished and deleted afterwards. The report records which.
  - The results go in the L-3 report. L-4 does not start until they have been reviewed.

## 8. Draft acceptance criteria

These are measured with `tools/entry-metrics.mjs` (extended as needed) at the six sizes in section 1, before (`main`) and after. No phase is expected to meet a later phase's criterion.

| AC | Phase | Criterion | Before | Draft target |
|---|---|---|---|---|
| LAC-1 | L-1 | The identity and sign-in form are in the HTML, visible with scripts disabled (with a note that signing in needs JavaScript) | blank page | met |
| LAC-2 | L-1 | Startup requests and decoded bytes by the time the sign-in form is visible, counted as the tool does (section 1). Render-blocking dependencies are checked separately by failure runs (LAC-21) | 36 requests, 415 KB, 26 game modules, import chain of 7 | at most 3 requests besides the icon and manifest (document, entry CSS, entry JS), at most 30 KB decoded; **revised to 32,000 decoded bytes for the completed entrance** in the L-4 review (see the status at the top), no game module and no supabase-js |
| LAC-3 | L-1 | Throttled time to a visible form, same method | 2.6 s (underestimate) | at most 0.8 s, same method |
| LAC-4 | L-1 | No third-party host on the path: from the first request through sign-in to the drawn hero, every request goes to our own site or to Supabase (the harness allows no CDN). The vendored supabase-js is verified self-contained, its licence notice kept, and its version and update steps documented | 7 requests to `cdn.jsdelivr.net`; with them failing, a blank page | met; tested |
| LAC-5 | L-1 | Returning player: with a saved session, the game starts loading immediately, with no "Loading" screen; the entrance shows its in-place status until the hero is drawn | separate Loading screen, then the game | met; tested |
| LAC-5a | L-1 | **No gameplay download for anonymous visitors:**<br>- a visitor who stays 10 s on the entrance without using the form has fetched no game module and no supabase-js;<br>- the entrance doesn't autofocus a form field;<br>- after the visitor focuses or types in the form, supabase-js only;<br>- game modules only after a successful sign-in, or with a saved session | 26 game modules and supabase-js before the form | met; measured with `entry-metrics.mjs` (extended) and tested |
| LAC-5b | L-1 | **One Supabase client:**<br>- `createClient` runs once per page load, and the entrance, game, chat and admin use that instance;<br>- one `onAuthStateChange` subscriber on the game page;<br>- token refresh, user updates and repeated sign-in events for the same user cause no transition and no second `state` call;<br>- an account switch stops and restarts once;<br>- saved sessions that are valid, expired but refreshable, expired and refused, and malformed each behave as in section 6;<br>- a failed library load retried successfully still gives one client | one client, created on import | met; tested (calls counted in the page; fake backend models refresh) |
| LAC-6 | L-1 | Continuity: after sign-in, no screen between the entrance and the game or character creation; focus lands at a defined place and the change is announced; no motion with reduced motion | Loading screen in between | met; tested |
| LAC-7 | L-1 | Sign-in first: the email field is the first form control in the reading and tab order on phones; the whole form, through the Sign in button, is on screen without scrolling at 320×640 and 390×844; the email field is on screen at 844×390 | form in view in portrait; button below the fold at 844×390 | met |
| LAC-8 | L-1 | Signing out, and an expired session, return to the entrance without a reload; chat's account state is reset | form redrawn in `#app` | met; tested |
| LAC-9 | L-1 | The entrance's CSS has no `data-layout` selectors, and its geometry is identical under every value of `data-layout` | — | met; tested in L-2 with each forced choice |
| LAC-10 | L-1 | Sign-in behaviour kept: labels, `autocomplete`, inline errors, alert and status messages, create account | met | met; existing tests unchanged in intent |
| LAC-10a | L-1 | Character creation restyled with **no change to its mechanics** (Q11): the same fields, name validation and server errors (`aria-invalid`, `role="alert"`), race choice and details, and the same `create` call. The existing creation tests pass with the same intent | met | met; tested |
| LAC-11 | L-2 | The picker: native radio buttons in a labelled group, on the entrance and in Hero, Settings; keyboard reachable; default Automatic; saved in `clickmonster.prefs`; the active layout, and any fallback, is stated next to it | — | met; tested |
| LAC-12 | L-2 | Forced Desktop gives the desktop layout where the usable width allows, with a coarse pointer too, and falls back otherwise. **A fallback never changes the stored choice** (Q12): after it, `prefs.layout` is still `desktop`, and widening the window restores the desktop layout without the player choosing again. Forced Mobile gives the phone column at 1024, 1440 and 1920 with no sideways scroll. Automatic matches today's results exactly | — | met; tested at a phone and a desktop size for each choice, and across a narrowing and widening resize |
| LAC-13 | L-3 | Publication states: draft, published and unpublished, with the Q8 rules; admin only (Q6); every change in `admin_log`; single-flight; confirmation tiers as in section 7 | — | met; tested on the fake backend |
| LAC-14 | L-3 | **Public-read security, before production:** on the local stack, pgTAP and REST tests prove:<br>- published rows are readable;<br>- drafts, unpublished and future rows are hidden;<br>- ungranted columns are refused;<br>- all writes are denied, for `anon` and `authenticated`.<br>**After the owner explicitly authorizes the migration,** `tools/news-public-check.mjs` repeats the REST checks against production with the publishable key, and the results go in the L-3 report | — | met locally before the L-3 review; production checks recorded before L-4 starts |
| LAC-15 | L-4 | The entrance's news: the latest 3 published entries after the form, fetched after the first paint with a timeout; with news failing or slow, sign-in and the returning-player path are unaffected and nothing broken shows | — | met; tested with news failing and held |
| LAC-16 | L-4 | Article pages: `/news/<slug>` returns 200 HTML with a title, description, canonical URL and Open Graph and Twitter card tags, readable without JS, in the entrance's design; unknown and unpublished slugs return 404 (Q9); `/news` lists published entries; responses are sent `Cache-Control: no-store`, so an unpublished article is gone on the next request; with Supabase down, a 503 page in the same design | — | met; handler and browser tests |
| LAC-16a | L-4 | **Escaping, canonical URL and failure responses** (handler tests):<br>- article fields with hostile content (`<script>`, `</title>`, quotes, `&`, newlines, very long text) are escaped correctly in the body and in every metadata attribute (`<title>`, description, Open Graph, Twitter);<br>- the canonical and `og:url` come from a trusted site origin constant, never from the request's `Host` or forwarded headers;<br>- slugs that don't match the slug pattern return 404 without querying Supabase;<br>- Supabase errors, timeouts and malformed responses give the 503 page;<br>- every response is `text/html; charset=utf-8` with `Cache-Control: no-store` | — | met; tested |
| LAC-17 | L-4 | An article page downloads no game modules and no supabase-js | — | 0 `/js/` game modules; measured |
| LAC-18 | all | No sideways scrolling at any measured size | none | none |
| LAC-19 | all | axe, all impacts, on the entrance (and, by phase, the picker, the news list, article pages and the admin News section) at the measured sizes | 0 violations (6 captures) | 0 violations |
| LAC-20 | all | No change to game rules or the `game` function; server and schema changes only as listed in section 7 | — | met |
| LAC-21 | L-1, L-4 | **Independent failures** (requirement 7), each tested by making one part fail:<br>- **the vendored library fails to load:** the entrance is visible, and sign-in shows a persistent error with Try again;<br>- **Supabase unreachable:** the entrance is visible; signing in and the returning-player path show a useful error;<br>- **game modules or the first `state` call fail:** the entrance stays, with an error, Try again and Sign out;<br>- **from L-4, news failing or held:** sign-in works and a returning session reaches the game without waiting;<br>- **an article page:** loads no game module and no supabase-js | blank page when the CDN fails | met; tested |

## 9. Phasing

One branch and PR per phase, each stopping at an independent review gate. The owner's two stages map onto them like this:

**Stage 1: entrance and interface (client only)**

- **L-1. The entrance:**
  - the static entrance in `index.html`, with `entry.css` and `entry.js`;
  - the game started on demand, the returning-player fast path, the in-place transition, and signing out back to the entrance;
  - the vendored supabase-js (Q2), with its README, and the harness's CDN allowance removed;
  - the failure handling of requirement 7 for sign-in and game start-up;
  - character creation in the entrance's style (Q11).
  - The news region is not built yet; there is no placeholder. Criteria: LAC-1 to 10 (with 5a, 5b and 10a), 18 to 20, and LAC-21's L-1 cases.
- **L-2. The interface picker:**
  - the preference in `layout.js` with the fallbacks, and the Phase 2 rules re-keyed to `data-layout`;
  - the control on the entrance and in Hero, Settings.
  - Criteria: LAC-9 (with each choice), 11, 12 and 18 to 20.

**Stage 2: public news**

- **L-3. Publication:**
  - the `news` migration (table, constraints, grants, RLS) and its rollback migration;
  - the local Supabase stack (pinned CLI), with pgTAP and local REST tests;
  - the `admin` function's news actions;
  - the admin console's News section with preview;
  - the fake backend's support;
  - `tools/news-public-check.mjs`.
  - Criteria: LAC-13, 14 and 18 to 20.
  - **The order:**
    1. The local database tests pass, and the L-3 PR is reviewed and approved.
    2. The owner explicitly authorizes applying the migration to production and deploying the `admin` function. This is separate from approving the PR. The migration is applied, and the function deployed.
    3. **Only then is the PR merged.** Netlify publishes `public/` on merge, so the admin console's News section goes live only once the deployed function supports its actions. It is admin-only.
    4. The anonymous-key REST checks run against production. The published row the read check needs is created by the owner in the admin console. Their results are added to the L-3 report.
    5. Those results are reviewed.
  - **L-4 does not start until step 5.**
  - **There is no staging project,** so the migration is a production change. The REST API is public, so a new table is reachable as soon as it exists. Its security rests on the grants and policies verified in step 1 and checked again in step 3, not on nothing reading it yet.
- **L-4. Public reading:**
  - the entrance's news list and the maintenance line (Q5);
  - the Netlify Edge Function for `/news` and `/news/<slug>`, with link-preview metadata, uncached at first.
  - Criteria: LAC-15 to 21, with 16a.

## 10. Out of scope

- The rename to Monstra Regna (title, repository, metadata, domain, trademark checks). It is a separate decision; this work keeps "ClickMonster" and keeps the name in a few listed places.
- Q14's items: RSS and in-game news notification (deferred). Password recovery is a separate, higher-priority account-reliability item in `docs/backlog.md`.
- Live public data: player counts, player names, world events, hunts and chat.
- The admin console's own sign-in page and design. Only its supabase-js source moves to the vendored copy, with `net.js` (Q2).
- Gameplay, the `game` function and the existing tables.
- Wider desktop sheets, which are still a separate backlog item.
- The pre-release verification in `docs/backlog.md` (real devices, other browsers, screen readers, live staging). It still applies before any release that includes this work. For this milestone it also includes real-phone timing on a mobile network, and checking link previews in real apps.

## 11. Still to measure

- **Real-phone timing on the live site,** before and after: for example a mid-range Android phone on a mobile network, or a lab test against the deployed site. The harness timing is an underestimate (section 1).
- **The compressed transfer sizes** from Netlify and the CDN, against the decoded sizes here.
- **The owner's browser viewport,** still owed from the desktop scope.
- **After L-4 is live:** that publishing and unpublishing behave as specified on the real site. Only then is a cache TTL or invalidation considered (Q1).

## 12. Scope review corrections (review of `350d23e`)

The disposition was changes requested, for documentation only. The baseline, the entrance direction, the four phases, the independent-failure requirements and the publication architecture were accepted in principle.

| # | Correction | Where |
|---|---|---|
| 1 | Anonymous visitors download no gameplay code. supabase-js loads when sign-in begins, and the game only after sign-in or with a saved session. Idle prefetching would need separate justification and measurement | Section 6, "`entry.js`"; LAC-5a |
| 2 | One Supabase client, owned by `net.js`, and one auth listener, the entrance's session controller. Transitions are defined for sign-in, sign-out, refresh, repeated events and account switches. Tests cover valid, expired (refreshable and refused) and malformed saved sessions | Section 6, "One Supabase client"; section 7, tests; LAC-5b |
| 3 | The L-3 security gate: local pgTAP and REST tests before any production change; explicit authorization to apply the migration; the PR merged only after the function supports the console; then anonymous-key REST checks against production, with identifiable write probes, before L-4. The claim that the production migration is harmless is removed | Section 7; section 9, L-3; LAC-14 |
| 4 | The returning-player baseline is 53 requests, as in the committed data. Counts are labelled as startup resources, distinct from render-blocking dependencies | Sections 1 and 2; LAC-2 |
| 5 | L-4 criteria for escaping in the body and metadata, a trusted canonical origin, slug validation, and failure responses | LAC-16a |

The owner's answers to Q2a and Q5–Q14 are recorded in section 5. Two of them also have their own criteria: Q11 (LAC-10a) and Q12's stored preference (LAC-12).
