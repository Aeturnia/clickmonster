# MR-B1: identity and domain (report)

**Status (2026-11-22): the redirect is complete; MR-B1's cutover stays open.**

| Criterion or step | Disposition |
| --- | --- |
| Step 5: the redirect | **Complete.** PR #70 (`a468ee0`), the host rule; PR #72 (`543a844`), the news edge function's fallback |
| B1-4b: the old host redirects | **Passed, with a documented encoding exception** (section 8): accepted by the owner, 2026-11-22 |
| B1-4c: a sign-in link issued before the move | **Not performed:** no such link was available |
| Step 6: verification | **Partly complete:** B1-4c is outstanding |
| Step 7: remove the old origin from the Supabase Auth allow-list | **Not authorized** |

*Earlier status, as recorded at the time:* **cutover step 1 complete** (2026-11-18). Authorized by the owner on 2026-11-18; independently reviewed at `2eaae3e` and approved to merge after green CI; merged as PR #48 (`ea2e4a4`).
- **Step 3: the applicable checks passed** under the current production authentication configuration (owner-reported, 2026-11-18): session restore and the password-reset link on `monstraregna.com`. **Sign-up confirmation was not performed:** email confirmation is off in production, and the check is deferred until email confirmation and delivery are separately authorized and configured.
- **Step 4 passed** (2026-11-18): the public pages, checked by the owner in a browser and independently by Claude with authorized read-only requests (section 3). **QB-2, the announcement, was waived** by the owner on 2026-11-21: there are no public players, or any other players, yet. **The redirect PR (step 5) was opened** on the owner's instruction (2026-11-21), for review; merging needs the owner's authorization. The redirect (step 5) and removing the Netlify origin from the allow-list (step 7) are **not** done and not authorized here. MR-B2 and MR-S1 are not started.
- **Unchanged:** public password-reset requests stay off (`RECOVERY_REQUESTS = false`).
- **Scope:** `docs/monstra-regna-scope.md`, section 3, with the owner's decisions (section 1, D1–D3) and answers (section 10, QB-1).
- **Base:** `main` at `9a9887f` (PR #47).
- **Step 1's implementation is PR #48** (merged as `ea2e4a4`): the rename and `SITE_ORIGIN`, **without** the old-address redirect. Both addresses keep serving the site.
- **PR #49 records the cutover evidence after it:** the merge and CI results, and steps 2–4.
- **The redirect (step 5)** is prepared as its own commit on `claude/mr-b1-redirect` (`b00a5c7`). It has no PR yet and is not to be merged until steps 1–4 are verified (section 4).
- **PR #48 made no production reads or changes,** and no gameplay change. The only production access since is step 4's authorized read-only requests (section 3).

## 1. What changed

| File | Before | After |
|---|---|---|
| `public/index.html` | `<title>` and `<h1 class="e-title">`: ClickMonster | Monstra Regna |
| `public/js/main.js` | the intro and character-creation headings: ClickMonster | Monstra Regna |
| `public/admin.html` | `<title>`: ClickMonster Admin | Monstra Regna Admin |
| `public/js/admin.js` | four headings: ClickMonster Admin | Monstra Regna Admin |
| `public/manifest.webmanifest` | `name`, `short_name`: ClickMonster | Monstra Regna, both (QB-1: truncation on some home screens accepted) |
| `public/js/site.js` | `SITE_NAME = 'ClickMonster'`; `SITE_ORIGIN = 'https://clickmonsters.netlify.app'` | `'Monstra Regna'`; `'https://monstraregna.com'` |
| `public/css/style.css` | the opening comment | Monstra Regna |
| `README.md`, `CLAUDE.md` | ClickMonster | "Monstra Regna (formerly ClickMonster)", with the identifiers that keep the old name and why |

**What follows from `SITE_NAME` and `SITE_ORIGIN`:** the news pages (`netlify/edge-functions/news.js`) now title themselves "… · Monstra Regna", give `og:site_name` "Monstra Regna", and use `https://monstraregna.com/news/…` as their canonical and `og:url` addresses, whichever host serves them.

**Unchanged on purpose (D2).** These are the only remaining uses of the old name in anything that ships, and `tests/identity.test.mjs` fails on any other:
- the browser storage keys `clickmonster.auth`, `clickmonster.prefs`, `clickmonster.recovery` and `clickmonster.seenAnnouncement`;
- `window.clickmonster`, the read-only hook the browser tests use.

**Also unchanged, outside the shipped files:** the repository, the Supabase project, the `game`/`admin` function names, the Netlify site (`clickmonsters.netlify.app`), and the package name. The email templates were already Monstra Regna.

**Startup budget (LAC-2):** 33,987 → **33,989** of 34,000 decoded bytes. "Monstra Regna" is one character longer than "ClickMonster", in the entrance's title and heading. 11 bytes of room remain until MR-B2's revised contract (D11).

## 2. Acceptance criteria

| ID | Criterion | Status |
|---|---|---|
| B1-1 | No "ClickMonster" in anything players see; the remaining uses are technical identifiers only, listed | **Met.** `tests/identity.test.mjs` searches `public/` (except `public/vendor/`), `netlify/` and `supabase/templates/` for any spelling of the old name (`click[\s_-]*monsters?`, any case), allowing only the five identifiers in section 1, and fails if that list changes. A second test checks the new name where players see one. **On `main` it fails**, listing the 14 old names this PR removes (including the old host in `site.js`) |
| B1-2 | News pages give `https://monstraregna.com` as canonical and `og:url`, never the request's host | **Met.** `tests/news-pages.test.mjs`: the literal is updated (`SITE_ORIGIN === 'https://monstraregna.com'`); the check that `Host`, `X-Forwarded-Host` and `Forwarded` are ignored is kept unchanged. Title and `og:site_name` assertions updated to the new name |
| B1-3 | Storage keys unchanged | **Met.** `tests/identity.test.mjs` reads each key where it's defined (`net.js`, `entry.js`, `main.js`) and the first-paint check in `index.html` |
| B1-4a | Before the redirect merges: the rule is valid and a deploy preview isn't redirected | **Later,** on the redirect's own PR (section 4) |
| B1-4b | After the authorized deployment, on the real old host: 301, path and query kept, no loop, previews reachable | **After step 5,** read-only requests |
| B1-4c | Authentication links issued before the move arrive on the new domain with their fragment, and R-1's guard handles them | **After step 5** |
| B1-5 | Cutover steps 2–7 recorded with their results | **Started:** section 3. Completed in a later docs PR |
| B1-6 | Every suite green, no gameplay change | **Met.** **Local** (head `2eaae3e`): engine and file tests 51 of 51 (48 before, plus the 3 identity tests); browser 208 of 208 in each of 3 consecutive full runs. **CI** run `44326706062`, head `2eaae3e`, tested merge commit `8429bc7`: `engine` 51 of 51; `database` 42 of 42 pgTAP and 12 of 12 API, function and recovery tests; `browser` (Windows Chromium) 208 of 208. Counts read from the job logs. No gameplay files changed except the two headings in `main.js` |

## 3. Cutover record (section 3.2 of the scope)

| Step | Who | Status |
|---|---|---|
| 1. Merge the rename, without the redirect | Owner merges this PR | **Done, 2026-11-18:** PR #48 merged as `ea2e4a4` after independent review (approved at `2eaae3e`) and green required checks (CI run `44326706062`: engine, database and browser all passed on the merge commit `8429bc7`) |
| 2. Supabase Auth: Site URL `https://monstraregna.com`; allow-list `https://monstraregna.com/**`, keeping the Netlify origin until step 7; no preview wildcard | Owner | **Done early by the owner, 2026-11-17** (scope, section 11), and treated as completed configuration. Not read or independently inspected by Claude; its behaviour is tested by the owner in step 3 |
| 3. On the new domain: sign-up confirmation lands on `monstraregna.com`; sign-in and session restore; a reset email from the dashboard opens "Choose a new password", not the game, with "Forgot your password?" still off | Owner | **The applicable checks passed under the current production authentication configuration, 2026-11-18, as reported by the owner** (not independently inspected):<br>- **Session:** sign-in on `monstraregna.com` stayed signed in.<br>- **Reset link:** a dashboard reset email to the owner's own account worked end to end on `monstraregna.com`, with "Forgot your password?" still off.<br>**Not performed: the sign-up confirmation check.** A new account on `monstraregna.com` went straight to character creation and into the game, with no confirmation email, because "Confirm email" was switched off in the dashboard at the project's first setup (there was no email provider then). The check is **deferred** until email confirmation and delivery are separately authorized and configured; Supabase's built-in sender only reaches organization members, so real players couldn't confirm. Email confirmation was **not** enabled as part of this record. The current setting was not read by Claude. |
| 4. Public pages on the new domain: `/news` and `/news/<slug>` with canonical and `og:url` on `monstraregna.com`; the manifest and titles | Owner, or read-only requests by Claude if authorized | **Passed, 2026-11-18.** Checked by the owner in a browser, then by Claude with read-only GET requests (authorized; no credentials, nothing sent):<br>- `https://monstraregna.com/`: 200, `<title>Monstra Regna</title>`, heading "Monstra Regna"; byte-identical to `main`'s `public/index.html`.<br>- `/news`: 200, title "News · Monstra Regna", canonical and `og:url` `https://monstraregna.com/news`, `og:site_name` "Monstra Regna".<br>- `/news/under-construction`: 200, `no-store`, title "Under Construction · Monstra Regna", canonical and `og:url` `https://monstraregna.com/news/under-construction`.<br>- `/manifest.webmanifest`: 200, `name` and `short_name` "Monstra Regna".<br>- `/admin.html`: 200, title "Monstra Regna Admin".<br>- **The old host, before the redirect:** `https://clickmonsters.netlify.app/` serves the same `index.html` (200), and its `/news/under-construction` also gives `https://monstraregna.com/...` as canonical and `og:url` (B1-2, live). |
| QB-2. Publish the announcement article (the move, the new address, the possible one-time sign-in) | Owner, in the admin console | **Waived** by the owner, 2026-11-21: no players yet |
| 5. Turn on the redirect | Owner merges the redirect PR | **Done, 2026-11-21:** PR #70 merged as `a468ee0`; live within about 20 s |
| 6. Verify the redirect (B1-4b, B1-4c) | Read-only requests, if authorized; the owner's own old email if one exists | **B1-4b: passed, with a documented encoding exception** (sections 6 to 8; after the news fallback, PR #72). **B1-4c: not performed** |
| 7. Remove the Netlify origin from the Supabase allow-list | Owner | **Not authorized** (B1-4c is outstanding) |

**What players notice after this PR merges:** the name, on both addresses. Nobody is signed out: the storage keys are unchanged, and each address keeps its own saved session. A player moves address only when the redirect turns on (step 5), and then signs in once on `monstraregna.com`, as the announcement will say.

## 4. The redirect (step 5), prepared separately

- **Branch** `claude/mr-b1-redirect`, commit `b00a5c7`, on top of this PR. It adds one rule at the top of `netlify.toml`:
  `from = "https://clickmonsters.netlify.app/*"`, `to = "https://monstraregna.com/:splat"`, `status = 301`, `force = true`.
- **Host-based,** so `deploy-preview-<n>--clickmonsters.netlify.app` is a different host and isn't matched. Netlify passes the query string through on redirects.
- **When to open its PR:** after steps 3 and 4 pass, so its deploy preview gives B1-4a's evidence (the configuration deploys, and the preview isn't redirected) without the rule being live.
- **A risk for B1-4b to settle, not assumed either way:** `/news` and `/news/*` are served by a Netlify Edge Function. If Netlify runs the edge function before redirect rules on the old host, old news links would be served there instead of redirected, still with the correct canonical address (B1-2), but without the 301.
  - **The check:** B1-4b's `/news/<slug>?x=1` on the old host.
  - **The fallback if it fails,** for review then: a host check at the top of `news.js` that answers a 301 to `SITE_ORIGIN` for the old host, with a Node test.

## 5. Not verified

- **The database suite,** locally (no Docker daemon in this environment). CI runs it.
- **The production Supabase Auth settings** (step 2): reported by the owner, not read.
- **How "Monstra Regna" displays** as an installed app's name on real home screens (QB-1).
- **Everything in steps 3–7,** which happens after the merge. (Later: steps 3 to 5 are recorded above. Step 6 is partly complete, with B1-4c not performed, and step 7 is not authorized. See the status at the top and section 8.)

## 6. After the redirect went live: B1-4b and B1-4c (2026-11-21)

**PR #70 merged** as `a468ee0` at 18:08 UTC. The old host's `/` answered 200 at 18:08:31 and **301** at 18:08:46.

**B1-4b** (read-only requests to `https://clickmonsters.netlify.app`, each first response, then the chain followed):

| Address on the old host | First response | Chain |
| --- | --- | --- |
| `/`, `/?x=1&y=two` | **301** to `https://monstraregna.com/…`, path and query kept | 301 > 200 |
| `/guide`, `/guide?ref=a%20b`, `/leaderboard`, `/contact` | **301**, path and query kept | 301 > 200 |
| `/js/site.js`, `/manifest.webmanifest`, `/admin.html` | **301** | 301 > 200 |
| `/does-not-exist?q=1` | **301**, path and query kept | 301 > 404 (missing on the new domain too) |
| **`/news`, `/news?page=2`, `/news/<slug>`, `/news/<slug>?x=1`** | **200, not redirected** | 200 |

- **No loops:** every chain ends within two responses.
- **Unaffected:** the deploy preview isn't redirected, and `https://monstraregna.com/` answers 200.

**The deviation:** section 4's open risk happened. On the old host, Netlify runs the news edge function for `/news` and `/news/*` before the redirect rules, so those addresses are served there. What those pages carry:
- the canonical address and `og:url` on `monstraregna.com` (B1-2);
- the no-script policy and `no-store`.

So search engines and link previews already point at the new domain. A visitor following an old news link stays on the old host for that page; the menu's links from there redirect. The owner chose to correct it rather than accept it (section 7).

**B1-4c: not performed.** No sign-in link issued before the move was available, and none was made up for this check.

**Step 7** (removing the old origin from the Supabase Auth allow-list) is untouched, and separately gated.

## 7. The news fallback (authorized by the owner, 2026-11-21; its own PR)

**In `netlify/edge-functions/news.js`:**
- **The constant:** `LEGACY_HOST = 'clickmonsters.netlify.app'`.
- **The check:** after the existing method check (other methods still get 405), a request whose URL host is exactly `LEGACY_HOST` gets a **301** to `SITE_ORIGIN` plus its path and query. That happens before any Supabase request, with `cache-control: no-store` and no body.
- **Nothing from headers:** no `Host`, `Forwarded` or `X-Forwarded-Host` header is read, so none can trigger the redirect or change its destination. The destination is built only from `SITE_ORIGIN`.
- **Unchanged hosts:** the canonical domain and deploy previews (other hosts) are served as before. An unknown article on the old host is redirected, and the canonical domain answers its 404.

**Identity check:** `tests/identity.test.mjs` allows the exact host name as a technical routing identifier, in `news.js` only. It's listed with the other technical identifiers, and a new test requires it to appear once, as that constant, and in no other shipped file. The old name stays forbidden everywhere else, in any spelling.

**Tests** (`tests/news-pages.test.mjs`, five new; `tests/identity.test.mjs`, one new):
- **The old host:** `/news`, `/news/`, a query, an article, its slash form, an article with a query and an unknown article each get a 301 to the same path on `SITE_ORIGIN`, for GET and HEAD, with no Supabase request and no body.
- **Other methods** on the old host still get 405.
- **Unchanged elsewhere:** the canonical domain, `deploy-preview-70--…` and `main--…` each serve the pages, with one read.
- **Forged headers** naming the old host don't redirect a canonical request. Headers naming another host don't move the old host's destination.
- **Exact matching:** look-alike hosts aren't redirected; the old host in capitals is.

**What the tests caught:** against the old function, with only the constant added, the redirect tests fail (three of the five; the other two guard unchanged behaviour). The old identity test rejects the new constant. The host name added to any other shipped file fails both identity tests.

**After an authorized merge (B1-4b again):** read-only requests to the old host's `/news`, `/news/<slug>` and their query forms should answer 301 to `monstraregna.com`, and the canonical pages 200, with no loop. If the function still answers there, the evidence is recorded and work stops.

## 8. B1-4b after the news fallback: passed, with a documented encoding exception (2026-11-22)

**PR #72** (the news edge function's fallback, section 7) was approved and merged as `543a844` on 2026-11-22 at 01:14 UTC. The old host's `/news` answered 200 at 01:14:39 and **301** at 01:14:55. The checks below ran at 01:15 UTC, read-only. The full output is on PR #72.

**The old host, `https://clickmonsters.netlify.app`** (the first response's status and `Location`, then the chain):

| Address | Status | Location | Chain |
| --- | --- | --- | --- |
| `/news` | 301 | `https://monstraregna.com/news` | 301 > 200 |
| `/news/` | 301 | `https://monstraregna.com/news/` | 301 > 200 |
| `/news?page=2` | 301 | `https://monstraregna.com/news?page=2` | 301 > 200 |
| `/news/under-construction` | 301 | `https://monstraregna.com/news/under-construction` | 301 > 200 |
| `/news/under-construction?x=1&y=a%20b` | 301 | `https://monstraregna.com/news/under-construction?x=1&y=a+b` | 301 > 200 |
| `/news/no-such-article` | 301 | `https://monstraregna.com/news/no-such-article` | 301 > **404** |
| `/news/no-such-article?q=1` | 301 | `https://monstraregna.com/news/no-such-article?q=1` | 301 > 404 |
| `/` | 301 | `https://monstraregna.com/` | 301 > 200 |
| `/guide?ref=x` | 301 | `https://monstraregna.com/guide?ref=x` | 301 > 200 |

The site's other static routes, checked in section 6 after PR #70, answer 301 the same way.

**Recorded, as the owner set out:**
1. **The old host answers 301** for the site's static routes (section 6) and, since PR #72, its news routes.
2. **The canonical destinations answer as expected:** 200 for the pages and articles, and **404 for an unknown article**.
3. **Canonical and Open Graph addresses are correct:** on `monstraregna.com`, `/news` and `/news/under-construction` answered 200, with `<link rel="canonical">` and `og:url` equal to their own address.
4. **Deploy previews are unaffected:** `deploy-preview-72--…` `/news` and `/news/under-construction?x=1` answered 200, with no `Location`.
5. **No redirect loops:** every chain ends within two responses.
6. **Query strings are preserved semantically,** under standard form-style query decoding (`application/x-www-form-urlencoded`, as `URLSearchParams` implements it). They are **not** preserved byte for byte in one case: on the news routes, Netlify normalizes a `%20` in the query to `+` before the edge function receives the request.
7. **A literal plus encoded as `%2B` keeps its value:** it arrives as `%2B`.

**The query-encoding exception** (the news routes, through the function, compared with the host rule on `/guide`):

| Query sent | Through the news function | Through the host rule |
| --- | --- | --- |
| `?y=a%20b` | `?y=a+b` | `?y=a%20b` |
| `?q=%2B1` (a literal plus) | `?q=%2B1` | `?q=%2B1` |
| `?q=a+b` | `?q=a+b` | `?q=a+b` |
| `?q=%26x%3D1` | unchanged | unchanged |
| `?q=%C3%A9` | unchanged | unchanged |
| `?q=a%25b` | unchanged | unchanged |
| `?q=%22%3C%3E` | unchanged | unchanged |

A `%20` in the path is kept (`/news/a%20b`).

**Where it comes from:** the function passes the request URL's query through unchanged, and its unit test with `%20` keeps `%20`. The `+` comes from Netlify's edge runtime, before the function runs.

**Why it's accepted:** the owner accepted it on 2026-11-22, because the current site reads none of these query parameters, and the decoded values tested are equivalent.

**What it doesn't claim:**
- **Query preservation is not byte-exact.** The URLs are equivalent under form-style decoding but aren't byte-identical, and other systems (for example, ones that sign raw query strings) may tell them apart.
- **Future features need their own review:** any feature that relies on raw query bytes, signed query parameters or encoding-sensitive processing on these routes needs a new review.

**Still outstanding:**
- **B1-4c is not performed:** no sign-in link issued before the move was available, and none was made up.
- **Step 7** (removing the old host from the Supabase Auth allow-list) is **not authorized**.
- **No changes** were made to the edge function, the redirect rules, authentication, the database or production configuration for this record.
