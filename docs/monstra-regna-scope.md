# Monstra Regna: identity, homepage and realm status (scope)

**Status: draft for review (2026-11-17). Scope only: no code, and no production reads or changes.**
- **Three milestones are scoped together,** so their shared parts are agreed once. Each is implemented and reviewed on its own, starting with MR-B1, and each needs its own authorization:
  - **MR-B1, identity and domain;**
  - **MR-B2, homepage and navigation;**
  - **MR-S1, realm status and presence.**
- **No gameplay changes** in any of them.

## 1. Decisions already made (the owner, 2026-11-17)

| # | Decision |
|---|---|
| D1 | **The canonical domain is `https://monstraregna.com`, the bare domain.** `www` already redirects to it |
| D2 | **Canonical identity vs operational hosting.** Netlify stays the host, and its site address stays as infrastructure. The custom domain is **not** permission to rename the repository, the Supabase project, storage keys (`clickmonster.*`) or deploy identifiers |
| D3 | **The public name is "Monstra Regna"** everywhere players see a name. Technical identifiers may keep "ClickMonster" |
| D4 | **A public player count is approved,** and it **supersedes** the landing-page direction of 2026-11-13, which had no live counts before sign-in. **Only an aggregate number** may be shown: no player identities, names or locations |
| D5 | **One online player is one distinct authenticated account.** Several tabs, characters or connections of the same account count once. "Online" means a **recently verified authenticated presence**, not "has signed in" or "a character updated in the last ten minutes" |
| D6 | **The interface label is "Players Online"** |
| D7 | **Legal documents** (Privacy Policy, Terms of Service) are **their own reviewed milestone,** with real documents that accurately describe the game's services and data. **No empty placeholders** stand in for them |
| D8 | **The contact address** (for example `support@monstraregna.com`) is published only once the owner has arranged for its mail to reach a monitored inbox. Forwarding is enough. Incoming mail stays separate from Resend, which only sends automated mail |
| D9 | **Discord** appears only once there's a permanent invite. No dead link |
| D10 | **The homepage has a "Skip to sign in" link,** visible on focus, so the menu can come before the form |
| D11 | **The performance contract replaces the 34,000-byte hard limit** (section 4.5): a 48,000-byte CI tripwire, a 40,000-byte review threshold, and separate structural and measured requirements |
| D12 | **Copyright line:** "© 2026 Aeturnis Development Labs, LLC", with a documented way to update the year |

## 2. What exists (evidence, 2026-11-17)

**Domain behaviour,** checked with plain public requests:
- `https://monstraregna.com/` answers 200 with **exactly** `main`'s `index.html`;
- `https://www.monstraregna.com/` answers 301 to `https://monstraregna.com/`;
- `https://clickmonsters.netlify.app/` still answers 200, with **no redirect**.

**"ClickMonster" in what players see** (outside the vendored library):

| File | Where |
|---|---|
| `public/index.html` | `<title>`, and `<h1 class="e-title">` |
| `public/manifest.webmanifest` | `name`, `short_name` |
| `public/js/site.js` | `SITE_NAME`, used by the news pages' titles and link previews |
| `public/js/main.js` | the in-game intro and character-creation headings (lines 371, 382) |
| `public/admin.html`, `public/js/admin.js` | "ClickMonster Admin" (the title and four headings) |
| `public/css/style.css` | a comment only |

**The canonical address:**
- **Defined in** `public/js/site.js`: `SITE_ORIGIN = 'https://clickmonsters.netlify.app'`.
- **Used by** the news edge function (`netlify/edge-functions/news.js`) for canonical and `og:url` addresses.
- **Checked by** `tests/news-pages.test.mjs`, which asserts the literal value (line 82).

**Already Monstra Regna:**
- the local email drafts (`supabase/templates/`);
- new password-recovery UI strings, which are nameless.

**Supabase Auth:**
- **The production Site URL and redirect allow-list** are not in the repo and weren't read.
- **The reset link** (R-1) returns to `location.origin`. On the new domain it will land there only once the allow-list includes it; otherwise it falls back to the Site URL.

**The entrance (`index.html`, `css/entry.css`):**
- **The header:** a kicker, the title, a subtitle, and a gold rule (`.e-id::after`).
- **Then:** the gate (sign-in), the news section (loaded after paint, hidden while empty), and **"The realm"** (`.e-about`).
- **The grid:** `"id" "gate" "about"` on phones; from 52em, `"id gate" / "about gate"`.
- **What removing the introduction and "The realm" frees,** before any additions: about 840 bytes of HTML (the about section 685, kicker 59, subtitle 96), plus about 580 bytes of CSS rules. This is an estimate; the final figure is measured.

**The startup budget:** 33,987 of 34,000 decoded bytes after R-1. That's 13 bytes of headroom under the current rule.

**Online players:** nothing counts them globally.
- **`playersAt()` (`net.js`)** lists characters in the player's own map cell whose `updated_at` is under ten minutes old. That's a location-based "nearby" list, and doesn't meet D5.
- **Supabase Realtime is used** for chat (`chat-ui.js`).

## 3. MR-B1: identity and domain

**Goal:** Monstra Regna everywhere players see a name, `https://monstraregna.com` as the canonical address, and a controlled sign-in cutover from the Netlify address, with no gameplay change.

### 3.1 Changes

- **Names:**
  - "ClickMonster" becomes "Monstra Regna" in every place in section 2's table;
  - "ClickMonster Admin" becomes "Monstra Regna Admin";
  - the manifest's `name` is "Monstra Regna" and `short_name` is "Monstra Regna", or a shorter form if needed (QB-1);
  - the `style.css` comment.
- **`SITE_ORIGIN`** becomes `https://monstraregna.com`. News canonical and `og:url` addresses follow it. `tests/news-pages.test.mjs` is updated to the new literal; its other checks are unchanged.
- **Unchanged (D2):**
  - the storage keys `clickmonster.auth`, `.prefs` and `.recovery`, because changing them would sign everyone out a second time;
  - the repository and Supabase project;
  - the `game`/`admin` function names;
  - the Netlify site name.
- **Docs:** `README.md` and `CLAUDE.md`, with "Monstra Regna (formerly ClickMonster)" where history matters.
- **The redirect from the old address,** prepared in `netlify.toml` as a host-based permanent redirect: `https://clickmonsters.netlify.app/*` goes to `https://monstraregna.com/:splat` (301, forced).
  - **Deploy previews** (`deploy-preview-<n>--clickmonsters.netlify.app`) are different hosts and stay reachable.
  - **It goes live only in step 5 of the cutover (3.2),** not with the rename. It sits in its own commit, merged only once steps 1–4 are verified.
  - **Netlify's exact behaviour** is verified on a deploy preview before it's relied on.

### 3.2 The cutover sequence

Each production step is the owner's action, or needs the owner's explicit authorization.

1. **Merge the rename** (names and `SITE_ORIGIN`), without the redirect. Both addresses keep serving the site.
2. **The owner sets Supabase Auth:**
   - **Site URL:** `https://monstraregna.com`.
   - **Redirect allow-list:** `https://monstraregna.com/**`. The Netlify origin stays allowed until step 5 is verified, then it's removed. No preview wildcards (password-recovery scope, P-4).
3. **Verify on the new domain, owner-controlled.** With Supabase's built-in sender, mail reaches organization members, so the owner's own address works:
   - **sign-up confirmation:** the link lands on `monstraregna.com`;
   - **sign-in and session restore** on `monstraregna.com`;
   - **recovery:** a reset email sent to the owner's own account from the Supabase dashboard lands on `monstraregna.com` and **shows "Choose a new password", not the game,** with "Forgot your password?" still switched off (R-1's guard). The owner may then save a password or cancel.
4. **Verify the public pages:**
   - `/news` and `/news/<slug>` on the new domain, with canonical and `og:url` set to `monstraregna.com`;
   - the manifest and titles.
5. **Turn on the redirect** from the Netlify address.
6. **Verify the redirect:**
   - old bookmarks and news links redirect, keeping the path;
   - deploy previews still work;
   - a player with a saved session on the old address signs in again on the new one. **Browser storage belongs to each address,** so this is expected; accounts and heroes are untouched.
   - **Optional:** a news article announcing the move and the one-time sign-in.
7. **Remove the Netlify origin** from the Supabase allow-list.

### 3.3 Acceptance criteria

| ID | Criterion | How it's shown |
|---|---|---|
| B1-1 | No "ClickMonster" is left in anything players see; the remaining uses are technical identifiers only (listed) | A test that searches `public/` (except the vendored library and the storage keys), plus the report's list |
| B1-2 | News pages give `https://monstraregna.com` as their canonical and `og:url` address, never the request's host | `tests/news-pages.test.mjs` (updated literal; the forwarded-host check kept) |
| B1-3 | The storage keys are unchanged, so signing in on one address keeps working there | A file test |
| B1-4 | The redirect sends the old host, with its path, to the new domain, and leaves deploy previews alone | Checked on a deploy preview, then live after step 5 (read-only requests) |
| B1-5 | Cutover steps 2–7 are recorded with their results, including the recovery link on the new domain showing the password form with the request switched off | The report, from the owner's checks and read-only requests |
| B1-6 | Every suite stays green, with no gameplay change | CI and local runs |

## 4. MR-B2: homepage and navigation

**Goal:**
- **Removed:** the promotional text.
- **Added:** a small site menu, a sitewide public footer, and simple static pages.
- **The news feed** takes "The realm"'s place.
- **The performance contract** is revised (4.5).

### 4.1 Layout

**On phones,** in reading order:
1. **"Skip to sign in"** (D10), visible on focus, moving focus to the email field;
2. the title, **"Monstra Regna"**, with no kicker or subtitle;
3. **the menu** (4.2);
4. **the status line,** a slot that MR-S1 fills; B2 adds no status markup;
5. **the sign-in panel,** unchanged;
6. **Latest News,** unchanged loading (after paint, failure-isolated) and hidden while empty;
7. **the footer** (4.3).

**On desktop (52em and wider):** the side-by-side layout stays.
- **Left column:** the title, the menu and the status, then the news, which takes the area "The realm" used.
- **Right column:** the sign-in panel.
- **The footer** runs full width.
- **The grid's named areas change with the HTML** (`about` becomes `news`, and `nav` and `foot` are added).

**Removed:**
- `.e-kicker`, `.e-sub` and `.e-about`, with their CSS;
- `<meta name="description">` stays: it's for search and link previews, not on-page text.

**Tests that reference the removed elements are updated** (for example `layout-choice.test.mjs:235` measures `#entry .e-id` and neighbours). Each change is listed with its reason, and no other assertion changes.

**The sign-in panel stays above the fold at 320×640:** the menu is one compact line, wrapping only if it must.

### 4.2 The menu

- **Markup:** `<nav aria-label="Site">`. Every item is a real link to a real page:
  - **Home** (`/`), with `aria-current="page"` on the homepage;
  - **Guide** (`/guide`);
  - **Leaderboard** (`/leaderboard`);
  - **Contact** (`/contact`), only once D8 holds (QB-3);
  - **Discord:** only once the invite exists (D9).
- **Discord specifics:**
  - an icon from a **separate SVG file**, loaded so it adds no request before the form appears (lazily, or after paint);
  - the accessible name "Discord";
  - it opens in a new tab (`rel="noopener"`);
  - it follows Discord's brand-asset guidelines.

### 4.3 The footer (sitewide, public pages)

**Where:** the entrance, the news pages (the edge function's layout) and the new static pages.

**Contents:**
- "© 2026 Aeturnis Development Labs, LLC";
- links to **Privacy** and **Terms** only once the legal milestone delivers them (D7);
- **Contact** once D8 holds.

**Until then,** the footer shows the copyright line and whatever links exist. **No dead legal links.**

**The year** is fixed text in each page, with no script. Updating it is a one-line change per footer, listed in `CLAUDE.md` as a yearly task.

**Inside the game,** there's no footer, which would cost screen space on phones. The copyright line and, once they exist, the legal links go in Hero → Settings (an "About" group).

### 4.4 Static pages

**`/guide`, `/leaderboard` and `/contact`:**
- **How they're built:** plain HTML in `public/`, with no build step, styled like the news pages (`css/news.css`), with the menu and footer, no script, and the news pages' security headers where they apply.
- **What they say:**
  - **Guide:** a short, true placeholder ("The guide is being written") that links to news and Home.
  - **Leaderboard:** a placeholder. **Showing ranked players is a separate decision** (player visibility and ranking rules), not part of B2.
  - **Contact:** the address (D8), and Discord when available. **Published only once D8 holds** (QB-3).

### 4.5 The performance contract (replacing LAC-2's hard byte limit, D11)

**Hard checks** (deterministic, failing CI):
- at most **3 requests** before the sign-in form is visible, besides the icon and manifest;
- **no game modules, `style.css` or supabase-js** for an anonymous visitor before they use the form;
- **news, status and the player count load after the first paint,** and their failures can't block sign-in or the returning-player path (LAC-21);
- **first-paint decoded bytes ≤ 48,000** (the tripwire). The test always reports the figure.

**The review threshold:** above **40,000** bytes, the milestone report must explain the increase. It is not a CI failure.

**Measured, locally, under a fixed throttled mobile profile** (`tools/entry-metrics.mjs`), reported against the accepted baseline:
- **time to the form,** with the existing target of at most 0.8 s;
- **LCP (lab),** target at most 2.5 s;
- **CLS (lab),** target at most 0.1, **reported first.** It becomes a blocking CI check only after it proves stable across repeated CI runs;
- **response time of scripted interactions** (focusing and typing in the form). **This is not INP,** which is a field metric that isn't collected.

All of these are lab figures under our profile, not Google's 75th-percentile field figures.

**Not done:** stripping comments to meet a number.

### 4.6 Acceptance criteria

| ID | Criterion |
|---|---|
| B2-1 | The layout as in 4.1 at 320, 390, 768, 1024 and 1440. The sign-in panel is above the fold at 320×640. The removed sections are gone; the news takes their area on desktop |
| B2-2 | **"Skip to sign in"** is the first Tab stop and moves focus to the email field. It is visible on focus |
| B2-3 | **The menu:** real links only; `aria-current` on Home; Contact and Discord appear only when their conditions hold |
| B2-4 | **The footer** on every public page (entrance, news, static pages), with the copyright line and no dead links. The same copyright appears in the game's Settings |
| B2-5 | **The static pages** answer 200 with the menu and footer, no script, and the agreed headers |
| B2-6 | **The performance contract (4.5):** the hard checks pass, the size is reported (and explained if over 40,000), and the measured figures are reported against the baseline |
| B2-7 | **axe at all impacts:** 0 violations on the entrance (each state) and on every new page, at 320, 390 and 1440 |
| B2-8 | **Unchanged:** news loading and failure isolation, sign-in, sign-up, the interface choice, and recovery |

## 5. MR-S1: realm status and presence

**Goal:** a small, truthful status line on the homepage, such as "Realm Online · 24 Players Online". It's backed by a verified, privacy-safe count of distinct online accounts (D4, D5).

### 5.1 Definitions, fixed before design

- **One player is one authenticated account** (D5).
- **Online:** the account's client has sent a verified presence signal within the **presence window**. The proposal is a heartbeat every **60 s** and a window of **150 s** (QS-1). It's verified because the heartbeat is accepted only with a valid session; the server takes the account from the session, never from the request.
- **Statuses shown:**

  | State | Meaning |
  |---|---|
  | **Online** | The status service answered normally, within its time limit |
  | **Degraded** | It answered, but reported a problem, for example a slow database (threshold, QS-2) |
  | **Maintenance** | A published maintenance notice is under way. This reuses the news table's maintenance window, the same data as the entrance's maintenance line |
  | **Status unavailable** | The browser couldn't get an answer (a timeout, an error or bad data) |

  **"Offline" isn't shown as a guess.** If the browser can't reach the service, it can't tell "the game is down" from "the status check failed", so it says "Status unavailable".
- **The count is never invented:** if unavailable, it shows "—", never 0.

### 5.2 Proposed design (for review; alternatives in 5.4)

- **Presence:**
  - **Where:** a small table, `presence(user_id primary key, last_seen timestamptz)`.
  - **What writes it:** the signed-in game sends the heartbeat through the existing `game` function, as a new action, or through a narrowly granted database function (QS-3).
  - **Rules:**
    - one row per account, so several tabs collapse to one;
    - the server sets `last_seen = now()`;
    - RLS: no direct reads or writes for `anon` or `authenticated`.
- **The public aggregate:**
  - **What:** a function that returns **only** `{ state, players_online, as_of }`, counting rows with `last_seen` inside the window.
  - **Where:** a `SECURITY DEFINER` SQL function granted to `anon`, or a public `status` edge function (QS-3). The edge function would also measure the database's response time for "Degraded".
  - **Leaks nothing else:** no ids, names, zones or emails.
- **Caching:** the public answer may be cached for about 30 s (QS-4), so a busy homepage costs at most a few queries a minute.
- **On the entrance:**
  - **when it loads:** after the first paint, like the news;
  - **how:** with plain `fetch` and the publishable key, **never loading supabase-js** for an anonymous visitor;
  - **refresh:** every 60 s while the page is visible (Page Visibility), and none while hidden;
  - **announcements:** status changes are announced politely; minute-by-minute count changes are not;
  - **failure:** "Status unavailable" and "—", with nothing else affected.
- **Small counts:** an exact count is shown, even 1. It reveals that someone is online, but not who.

### 5.3 Acceptance criteria

| ID | Criterion |
|---|---|
| S1-1 | **Several tabs or devices of one account count once.** Two accounts count two. An account stops counting once its heartbeat is older than the window |
| S1-2 | **The heartbeat needs a valid session.** The account is taken from the session, and a request naming another account has no effect |
| S1-3 | **The public answer contains only state, count and time,** with no identities or locations. `anon` can't read the presence table |
| S1-4 | **Each state is shown correctly:** Online, Degraded, Maintenance (a notice under way) and Status unavailable (timeout, error or bad data). The count shows "—" when unavailable |
| S1-5 | **It loads after first paint, with no supabase-js for anonymous visitors.** A status failure never delays or blocks sign-in (LAC-21) |
| S1-6 | **Refresh** about once a minute while visible and none while hidden. Status changes are announced; counts are not |
| S1-7 | **Local stack tests:** the migration, RLS, the aggregate, the heartbeat's account binding, and the window boundary. The production migration and deploy each need their own authorization, as in L-3 |
| S1-8 | **The performance contract (4.5) still holds** |

### 5.4 Alternatives considered

- **Supabase Realtime Presence:** it tracks connections, but a public total would need a server-side subscriber to aggregate it, because anonymous visitors mustn't join the presence channel themselves. That adds moving parts. It stays an option if the heartbeat proves costly (QS-3).
- **`updated_at` on characters:** it doesn't meet D5. It measures activity, not presence, and is per character.

## 6. Phasing and gates

1. **This scope:** review, then the owner's answers to section 7.
2. **MR-B1:** implementation PR, then review and merge (the rename, without the redirect). Then cutover steps 2–7, each owner-controlled or authorized, recorded in a docs PR.
3. **MR-B2:** implementation PR (after authorization), then review and merge. Each conditional link appears only when its condition holds.
4. **MR-S1:** implementation PR on the local stack (after authorization), then review. The production migration, then the function deploy (each authorized), then the merge, then live checks.
5. **The legal milestone (D7)** is scoped separately; it can run alongside.

## 7. Open questions for the owner

| Q | Question | Recommendation |
|---|---|---|
| QB-1 | **Manifest `short_name`:** "Monstra Regna" (13 characters), or shorter for home-screen icons? | "Monstra Regna". Most platforms show about 12 characters before truncating, so check on your phone |
| QB-2 | **An announcement article** for the domain move and the one-time sign-in? | Yes, a short news post at step 5 |
| QB-3 | **The contact address and its delivery** (D8). Until it works, B2 ships without the Contact link and page | Tell us when `support@monstraregna.com`, or another address, reaches you |
| QB-4 | **The Discord invite** (D9) | Send it when ready; the link waits until then |
| QS-1 | **The presence window:** a 60 s heartbeat and a 150 s window? | Yes. Shorter windows cost more requests; longer ones count leavers longer |
| QS-2 | **The "Degraded" threshold**, for example a database response over 1 s | 1 s, measured by the status function |
| QS-3 | **Heartbeat and aggregate:** through the `game` function and a SQL function, or a new public `status` edge function? | A `game` action for the heartbeat, which already authenticates, and a public `status` edge function for the aggregate, which can time the database for "Degraded" |
| QS-4 | **Cache the public status** for about 30 s? | Yes |

## 8. Not verified by this scope

- **The production Supabase Auth settings:** none were read.
- **Netlify's host redirect, and its interaction with deploy previews:** to be verified on a preview in B1.
- **How "Monstra Regna" displays** as an installed app's name on real phones (QB-1).
- **All performance figures for B2:** they're estimates until measured.
