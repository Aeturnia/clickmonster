# MR-B1: identity and domain (report)

**Status: cutover step 1 implemented, for review.** Authorized by the owner on 2026-11-18.
- **Scope:** `docs/monstra-regna-scope.md`, section 3, with the owner's decisions (section 1, D1–D3) and answers (section 10, QB-1).
- **Base:** `main` at `9a9887f` (PR #47).
- **This PR is step 1 only:** the rename and `SITE_ORIGIN`, **without** the old-address redirect. Both addresses keep serving the site after it merges.
- **The redirect (step 5)** is prepared as its own commit on `claude/mr-b1-redirect` (`b00a5c7`). It has no PR yet and is not to be merged until steps 1–4 are verified (section 4).
- **No production reads or changes by Claude,** and no gameplay change.

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
| B1-6 | Every suite green, no gameplay change | **Local:** engine and file tests 51 of 51 (48 before, plus the 3 identity tests); browser 208 of 208 in each of 3 consecutive full runs. **Database:** not run here (no Docker in this environment); CI's `database` job runs it on the PR. No gameplay files changed except the two headings in `main.js` |

## 3. Cutover record (section 3.2 of the scope)

| Step | Who | Status |
|---|---|---|
| 1. Merge the rename, without the redirect | Owner merges this PR | **This PR** |
| 2. Supabase Auth: Site URL `https://monstraregna.com`; allow-list `https://monstraregna.com/**`, keeping the Netlify origin until step 7; no preview wildcard | Owner | **Done early by the owner, 2026-11-17** (scope, section 11). Not read or verified by Claude |
| 3. On the new domain: sign-up confirmation lands on `monstraregna.com`; sign-in and session restore; a reset email from the dashboard opens "Choose a new password", not the game, with "Forgot your password?" still off | Owner | After the merge |
| 4. Public pages on the new domain: `/news` and `/news/<slug>` with canonical and `og:url` on `monstraregna.com`; the manifest and titles | Owner, or read-only requests by Claude if authorized | After the merge |
| QB-2. Publish the announcement article (the move, the new address, the possible one-time sign-in) | Owner, in the admin console | Between steps 4 and 5 |
| 5. Turn on the redirect | Owner merges the redirect PR | Prepared (`b00a5c7`), not opened |
| 6. Verify the redirect (B1-4b, B1-4c) | Read-only requests, if authorized; the owner's own old email if one exists | After step 5 |
| 7. Remove the Netlify origin from the Supabase allow-list | Owner | After step 6 |

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
- **Everything in steps 3–7,** which happens after the merge.
