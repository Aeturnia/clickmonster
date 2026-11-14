# Landing page — phase L-4 report: public news

**Status: implemented. Awaiting independent review.**
- **Authorized:** on 2026-11-13, after L-3's production results were approved. On its own branch and PR.
- **No database, migration or `admin` function change.**
- **The new piece:** a Netlify Edge Function, which goes live only when Netlify deploys `main` after the merge.

The contract is `docs/landing-scope.md`: Q1 (decided), Q5, Q9, Q10, Q13, section 6 ("News reading (L-4)"), and criteria LAC-15 to LAC-21.

## 1. What changed

- **`netlify/edge-functions/news.js`:** the public news pages (Q1).
  - **Routes:** `/news` lists the published articles, newest first. `/news/<slug>` shows one article as readable HTML.
  - **Data:** it reads published articles through Supabase's public REST API with the publishable key, so row-level security decides what is visible. It asks for the article columns only; the list leaves out the bodies.
  - **Article metadata:**
    - the title, and the summary as the description;
    - a canonical URL;
    - Open Graph: type, site name, title, description, URL, and the published and modified times;
    - a Twitter text card (Q13: no image).
  - **The canonical URL and `og:url`** come from `SITE_ORIGIN`, never from the request.
  - **The body** goes through the shared `newsBodyHtml()`: paragraphs and bullet lists, escaped (Q4).
  - **Maintenance** articles show their window in UTC.
  - **Unknown and unpublished addresses** get the same 404, "This update isn't available", with links to News and the game (Q9).
  - **An address that isn't a valid slug** gets that 404 without any query.
  - **A 503 page,** "News is unavailable right now", whenever the read fails: no connection, a 4-second timeout, any non-2xx status, a body that isn't JSON or isn't a list, or a malformed row.
  - **Every response** is `text/html; charset=utf-8` with `Cache-Control: no-store`, so unpublishing takes effect on the next request.
  - **A strict Content-Security-Policy:** no script at all, styles only from the site, no framing.
  - **Methods:** HEAD is answered without a body; other methods get 405.
- **`public/css/news.css`:** the pages' layout. They also load `entry.css` for the colours, type and the realm backdrop: the entrance's design, with no script and no game code.
- **`public/js/site.js`:** `SITE_NAME` and `SITE_ORIGIN` (`https://clickmonsters.netlify.app`, given by the owner). This is the single name constant that L-1 deferred to L-4.
- **The entrance** (`index.html`, `js/entry.js`):
  - **A hidden "Latest news" section** after the sign-in panel, and a hidden maintenance line under the form.
  - **`entry.js` imports `js/entry-news.js`** only after the page has loaded **and** the browser reports its first contentful paint. A background tab, which never paints, falls back to 1.5 s.
- **`public/js/entry-news.js` and `public/css/entry-news.css`:** the entrance's news.
  - **Two public reads,** each with a 4-second timeout and without supabase-js: the latest three articles, and recent maintenance notices.
  - **Shows:**
    - the three latest published articles, with title, date and summary, each linked, plus "All news" (Q10);
    - one line for scheduled maintenance that is upcoming or under way, linked to its article. An ended notice disappears by itself (Q5).
  - **Its stylesheet** loads only when there is something to show. Content is shown once the styles apply.
  - **Any failure shows nothing:** no error and no empty box.
- **Tests:**
  - **`tests/news-pages.test.mjs`:** 8 tests of the handler in Node, with the network replaced.
  - **`tests/ui/news-public.test.mjs`:** 8 browser tests.
  - **`tests/entrance-files.test.mjs`:** the new files are now in its third-party-host check.
  - **The harness** routes `/news` pages through the real handler, fed by the fake backend's public read (L-3 tested that it answers like the real API). `backend.newsPagesDown` simulates Supabase down. A `bypassCSP` page option exists only so axe can be injected into the script-free pages.
- **`tools/entry-metrics.mjs`** now also reports `visitor.beforePaint`: what the browser started before its first contentful paint, from its own Resource Timing.

## 2. Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| LAC-15 | Met | The latest three published articles appear after the sign-in panel, newest first, with no draft or future article, each linked, plus "All news". The email field is still the first stop. The news module starts only after the browser's first contentful paint and the load event (checked against Resource Timing in 5 of 5 runs). **News failing** (refused), **answering 500** or **never answering:** nothing is shown, and its styles aren't even loaded. Sign-in, and a returning player's saved session, reach the game regardless |
| LAC-16 | Met | **Articles:** 200 HTML with a title, description, canonical URL and Open Graph and Twitter tags, readable without script, in the entrance's design. **Unknown, draft and future addresses:** 404 with the same page. **`/news`:** every published article, newest first. **No caching:** `no-store`, and an article unpublished in the fake backend is a 404 on the next request. **Supabase down:** the 503 page. Handler and browser tests |
| LAC-16a | Met | **Escaping:** hostile text (`"><script>…`, `</title>`, quotes, `&`, `<b>`) is escaped in the body, in `<title>` and in every metadata attribute; no markup survives. **Canonical address:** with `Host`, `X-Forwarded-Host` and `Forwarded` set to another host, the page still uses `https://clickmonsters.netlify.app`. **Slugs:** eight malformed ones give 404 with no query. **Failures:** refused, 500, 401, not JSON, not a list, a malformed row and a timeout each give 503. **Headers:** `text/html; charset=utf-8` and `no-store` on every response |
| LAC-17 | Met | An article page requests itself and two stylesheets, plus the icon. No `/js/`, no supabase-js, no `<script>` element, and the policy forbids script. Measured at 390 and 1440 |
| LAC-18 | Met | No sideways scrolling: the entrance with news, and the article pages at 390 and 1440 |
| LAC-19 | Met | 0 axe violations at all impacts. **Entrance:** with news (390, 1440) and with the maintenance line (upcoming, under way, no window). **Pages:** the article (390, 1440), the list, the 404 and the 503 |
| LAC-20 | Met | No change to game rules, the `game` or `admin` functions, the schema or the API |
| LAC-21 (L-4 cases) | Met | News failing or held: sign-in works, and a returning session reaches the game without waiting (above). An article page loads no game module and no supabase-js (LAC-17) |

## 3. The entrance's startup budget (LAC-2)

The news itself adds nothing before the first paint; it loads afterwards, as the owner directed. But the two hooks it needs in the critical files make the first paint about 1.3 KB larger, measured as Netlify serves them (the LF bytes in git):

| What the first paint needs | `main` (after L-3) | L-4 |
|---|---|---|
| Requests (Resource Timing, started before first contentful paint) | 3 | **3** (the page, `entry.css`, `entry.js`) |
| `index.html` | 5,200 | 5,510 (+310: the hidden news section and maintenance line) |
| `entry.css` | 10,465 | 10,465 |
| `entry.js` | 14,135 | 15,137 (+1,002: the after-paint loader, about half of it comments) |
| **Total, decoded** | **29,800** | **31,112** (target at most 30,000: **1,112 over**) |
| Total, gzip (for comparison) | 10,170 | 10,652 |

- **The tool reported 31,314 decoded bytes.** The other 202 bytes are line endings that exist only in this Windows checkout (`entry.css` checks out with CRLF; Netlify serves LF). The table uses the served bytes.
- **The throttled time to the form is 0.74 s** (target at most 0.8 s, same method). It was 0.70 s after L-2.
- **The tool's 300 ms window** now catches the news loading right after the paint: 7 requests, including the news module and the two reads, but still no game module and no supabase-js.

**This is a decision for the owner, not something I trimmed to fit.** On the L-2 record you asked me not to remove comments to meet the budget, and to keep news loading independently after the entrance renders. Both are done; the remaining options are:
- **Raise the target to about 32 KB decoded,** or state it as compressed bytes (about 10.7 KB today).
- **Keep 30 KB,** and move the news markup from `index.html` into `entry-news.js`. That saves 310 bytes, but is still about 800 over, so code or comments would also have to go.

## 4. Changed existing tests

`LAC-2 / LAC-5a an anonymous visitor downloads no game code…` (`tests/ui/entrance.test.mjs`) said that, after 10 s idle, a visitor's page had made exactly three requests. Since L-4 the entrance also loads its news after the first paint. The test now says:
- **First:** the same three requests, the page, `entry.css` and `entry.js`;
- **Then:** only the news module, the public config and the public news reads;
- **Never:** any game module or supabase-js.

Its helper also counts `entry-news.js` as an entrance module. The guarantee it stands for is unchanged.

## 5. Regression evidence

The 8 browser tests were run against `main` (`e196b57`, via `UI_PUBLIC_DIR`):
- **5 fail:** all five entrance tests, because `main` has no news on the entrance.
- **3 pass:** the public-page tests.
  - **Why they pass there:** the harness runs the edge function from `netlify/`, which `UI_PUBLIC_DIR` doesn't swap, so those tests exercise the new handler either way.
  - **What shows `main` lacks them:** the live site, which serves `main`, answers `/news/testing2` with Netlify's plain 404 today (section 8). The handler's own Node tests cover it in detail.

## 6. Screens

In `docs/ui-audit/landing/`:

| File | Shows |
|---|---|
| `l4-entrance-390x844.png`, `l4-entrance-1440x900.png` | The entrance with three articles and an upcoming maintenance line |
| `l4-article-390x844.png`, `l4-article-1440x900.png` | An article with a bullet list and an "updated" date |
| `l4-list-1440x900.png` | `/news` |
| `l4-404-390x844.png`, `l4-503-390x844.png` | The not-available and unavailable pages |
| `l4-auth-*.png` | The entrance at six sizes with no news (the fake backend has none by default) |

Entry measurements are in `l4-metrics-after.json`.

## 7. Test runs

| Suite | Tests | Result |
|---|---|---|
| Engine (`npm test`) | 47: 39 before, plus 8 page-handler tests | 47/47 in each of 3 runs |
| Browser (`npm run test:ui`) | 174: 166 before, plus 8 | 174/174 in each of 3 runs |

The local Supabase suite (`npm run test:db`) wasn't rerun: L-4 changes no database object or function.

## 8. Checked on Netlify's deploy preview, against the live data

Netlify built a deploy preview of this PR at `https://deploy-preview-32--clickmonsters.netlify.app` (commit `f3dc037`). Its edge function runs on Netlify's real runtime and reads the live project's public API. I checked it with plain reads, no sign-in and no writes:

| Request | Result |
|---|---|
| `/news/testing2` (the owner's published test article) | **200**, `text/html; charset=utf-8`, `no-store`, the no-script policy. Title "testing2 · ClickMonster"; canonical and `og:url` `https://clickmonsters.netlify.app/news/testing2`, **not the preview's host**, so the request's host is ignored as intended. No `<script>` |
| `/news/this-is-a-test` (the owner's draft) | **404**, "This update isn't available", the same page as for an unknown address |
| `/news/no-such-thing` | 404, the same page |
| `/news/Bad_Slug` | 404 |
| `/news` | 200, the list, with canonical `https://clickmonsters.netlify.app/news` |
| `HEAD /news/testing2` / `POST /news/testing2` | 200 / 405 |
| `/js/entry-news.js`, `/css/entry-news.css`, `/css/news.css`, `/js/site.js` | all 200 |

**In a real browser** (Chromium, at 390 and 1440, no test harness):
- the preview's entrance showed "Latest news" with the one published article, linked to `/news/testing2`;
- it loaded no game code and no supabase-js;
- there were no console or policy errors;
- the article page opened with status 200.

Screens: `l4-preview-entrance-390x844.png` and `l4-preview-entrance-1440x900.png`.

This confirms what the Node and harness tests could only stand in for: Netlify bundles the function and its relative imports, the Deno runtime runs it, and the live row-level security answers as the handler expects.

## 9. After the merge

**Netlify deploys the edge function from `main` when this PR merges.** Today the live site serves `/news` as Netlify's plain 404. If bundling failed, Netlify would keep the previous deploy live. The same plain reads are then repeated on the live site:
1. `/news/testing2` returns 200.
2. `/news/this-is-a-test` returns the 404 page.
3. `/news` lists the articles.
4. The entrance shows the news.

**Netlify deploys the edge function from `main` when this PR merges.** Before that, nothing serves `/news` on the live site; today it is Netlify's plain 404. Netlify bundles the function and its relative imports (`public/js/config.js`, `data/news.js`, `site.js`) on deploy. If the bundle failed, Netlify would keep the previous deploy live; the site wouldn't break.

**After the merge, checked by plain reads of the live site** (no sign-in, no writes):
## 10. Not verified

- **The production deploy itself:** expected to match the preview (section 8), and checked after the merge (section 9).
- **Real link previews** (Discord, Slack, iMessage and others) reading the metadata.
- **Real devices, other browsers and screen readers.** For example, whether a screen reader announces the late-arriving news section; it appears silently, after the form, without moving focus.
- **Dates on the entrance** use the visitor's own locale and time zone; the article pages use UTC. That was checked only in this browser's en-US locale.
