# Monstra Regna: identity, homepage and realm status (scope)

**Status: accepted in review (2026-11-17), with the owner's answers in section 10.**
- **Cutover step 2** (the Supabase URL settings) was done by the owner ahead of the planned order (section 11).
- **No implementation is authorized:** MR-B1, MR-B2 and MR-S1 each need their own authorization.
- **No production reads or changes by Claude.**
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
| D8 | **The contact address is `support@monstraregna.com`** (the owner, 2026-11-17). It is published, with the Contact link and page, only once the owner has **verified that its mail reaches a monitored inbox.** Forwarding is enough. Incoming mail stays separate from Resend, which only sends automated mail |
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
  - **A deploy preview proves only that previews stay reachable and that the configuration is valid.** It runs under a different host, so it says nothing about how the real `clickmonsters.netlify.app` host behaves. That is verified on the real old host after the authorized deployment (B1-4b).

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
   - **Authentication links issued before the move:** confirmation and reset emails sent earlier still return to the old host. They go through Supabase's verify step to `clickmonsters.netlify.app/#access_token=…` or `#error…`.
     - **Browsers keep a URL fragment across a redirect** whose target has none, so such a link should arrive on `monstraregna.com` with its fragment. That origin then holds the session, and R-1's guard shows "Choose a new password" for a reset link.
     - **This is verified, not assumed** (B1-4c).
7. **Remove the Netlify origin** from the Supabase allow-list.

### 3.3 Acceptance criteria

| ID | Criterion | How it's shown |
|---|---|---|
| B1-1 | No "ClickMonster" is left in anything players see; the remaining uses are technical identifiers only (listed) | A test that searches `public/` (except the vendored library and the storage keys), plus the report's list |
| B1-2 | News pages give `https://monstraregna.com` as their canonical and `og:url` address, never the request's host | `tests/news-pages.test.mjs` (updated literal; the forwarded-host check kept) |
| B1-3 | The storage keys are unchanged, so signing in on one address keeps working there | A file test |
| B1-4a | **Before the redirect merges:** the `netlify.toml` rule is valid, and a deploy preview stays reachable and isn't redirected | The preview, with read-only requests |
| B1-4b | **After the authorized deployment, on the real old host:**<br>- a **301** to `https://monstraregna.com`;<br>- the **path and query string** kept (for example `/news/<slug>?x=1`);<br>- **no redirect loop** (the new domain answers 200, not another redirect);<br>- deploy previews still reachable | Read-only requests to the live hosts |
| B1-4c | **Authentication links issued before the move:** a link to `clickmonsters.netlify.app/#…type=recovery…` arrives on `monstraregna.com` **with its fragment.** A real but old or used reset link shows R-1's "Reset link not valid", and a test fragment shows the matching panel; neither starts the game | A browser following the redirect after step 5, with test fragments that hold no real tokens, plus the owner's own old email if one exists |
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
4. **the status line:** MR-B2 reserves its place in the layout (a named grid area, and a note in the HTML where MR-S1 will add the element), but **adds no element and shows no empty space.** An area with no element collapses. MR-S1 adds the element there without disturbing the layout;
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
| B2-2 | **"Skip to sign in"** is the first Tab stop and is visible on focus. It moves focus into whatever the sign-in panel is showing:<br>- the email field on the normal form;<br>- the panel's heading (`#gate-h`) while a saved session is being restored ("Returning to the realm");<br>- the first control of the password-recovery panel while a reset is under way.<br>Each of the three states is tested |
| B2-3 | **The menu:** real links only; `aria-current` on Home; Contact and Discord appear only when their conditions hold |
| B2-4 | **The footer** on every public page (entrance, news, static pages), with the copyright line and no dead links. The same copyright appears in the game's Settings |
| B2-5 | **The static pages** answer 200 with the menu and footer, no script, and the agreed headers |
| B2-6 | **The performance contract (4.5):** the hard checks pass, the size is reported (and explained if over 40,000), and the measured figures are reported against the baseline |
| B2-7 | **axe at all impacts:** 0 violations on the entrance (each state) and on every new page, at 320, 390 and 1440 |
| B2-8 | **Unchanged:** news loading and failure isolation, sign-in, sign-up, the interface choice, and recovery |

## 5. MR-S1: realm status and presence

**Goal:** a small, truthful status line on the homepage, such as "Realm Online · 24 Players Online". "Online" must mean the game can actually be entered and played. The count must be distinct accounts with a verified, recent presence (D4, D5), published only as an aggregate.

### 5.1 Definitions, fixed before design

- **One player is one authenticated account that has a hero** (D5, and QS-5).
  - Accounts still at character creation aren't counted.
  - Neither are accounts that are banned at the time of counting.
- **Online (presence):** the account's game sent a heartbeat that the server accepted with a valid session, within the **presence window**.
  - **Initial test parameters, not settled production values (QS-1):** a heartbeat every **60 s**, and a window of **150 s**.
  - The server takes the account from the session, never from the request.
- **The realm's states.** **Online** means a server-side readiness check confirms the services needed to enter and play are available (5.2). The public endpoint merely answering is not proof.

  | State | Meaning |
  |---|---|
  | **Online** | All readiness checks pass within their limits |
  | **Degraded** | The checks pass, but with **repeated** evidence of a problem: a check failed once and then passed on its retry, or a check was over its time limit on both attempts (5.2). One slow request alone doesn't count |
  | **Offline** | A required check **failed on both attempts.** This is a server-verified fact, so the word is safe here |
  | **Maintenance** | A published maintenance notice is under way: the news table's maintenance window, the same data as the entrance's line. It is shown in place of the other three |
  | **Status unavailable** | **The browser** couldn't get a valid, fresh answer (a timeout, an error, bad data, or a stale `as_of`). The browser can't tell "the game is down" from "the status check failed", so it never says Offline itself |

- **The count is never invented:** it shows "—" when unavailable, never 0.

### 5.2 Readiness: what "Online" checks (S1-01)

**One public endpoint runs these checks server-side.** Each is read-only and side-effect free, and none exposes an authenticated game action:

| Check | What it proves | How |
|---|---|---|
| **Auth** | Players can sign in and keep a session | GoTrue's health endpoint (`/auth/v1/health`) with the publishable key |
| **Game function** | The `game` function is deployed, its worker boots, and its imports (the shared engine) load | A CORS preflight (`OPTIONS`) to `/functions/v1/game`. The function answers it before authentication, with no game code run and nothing written (`index.ts`, `Deno.serve`) |
| **Database, as the game needs it** | The reads every game request starts with work: `world_config` and the zones (`handle()` → `loadWorld()`, `loadWorldZones()`) | A `SECURITY DEFINER` SQL function that reads them and returns only `true`/`false`, plus the aggregate count below. It is granted to `anon`, and returns no rows or ids |

**Attempts and time limits.**
- **Each check runs once.** A check that fails, or is over its limit, is **retried once**, about 1 s later.
- **Online:** both attempts aren't needed.
- **Degraded:** a failure that passed on its retry, or over the limit on both attempts.
- **Offline:** failed on both attempts.
- **Time limits, initial test parameters (QS-2):**
  - Auth: 2 s;
  - database: 2 s;
  - the game function's preflight: 3 s, which allows for a cold start.

**Its limits, stated:**
- **The preflight proves the function boots, not that every action works.** A bug inside a specific action wouldn't show.
- **The retry is within one evaluation,** a few seconds, not a long-term measurement. With caching (5.4), the checks run at most about twice a minute while someone is watching, and not at all otherwise.
- **No history is kept.** That avoids a writable table the public could feed.

### 5.3 Presence: a lightweight heartbeat (S1-02)

**The server: a dedicated path in the `game` function.**
- **Where it sits:** after authentication, and **before `handle()`**, so it never runs `loadWorld()`, `loadWorldZones()` or anything else of the game's.
- **What it does:** `action: 'heartbeat'` calls one SQL function, `touch_presence(user_id)`, which only the service role may execute.
- **Write throttling, server-side:** an upsert that writes only if the stored time is older than **45 s** (`… on conflict (user_id) do update set last_seen = now() where presence.last_seen < now() - interval '45 seconds'`).
  - However many tabs or devices send, an account causes **at most one write every 45 s**.
  - One row per account (`user_id` primary key) means it's **counted once.**
- **The answer:** `204`, with nothing in the body.
- **Players without a hero** may send heartbeats, but aren't counted (5.1). Counting joins `presence` to `characters` at read time, so there's no extra query per heartbeat.

**The client (the signed-in game, `main.js`):**
- **When it sends:** once on entering the game, then every 60 s, **only while the tab is visible** (Page Visibility).
  - **Background tabs send nothing.** On becoming visible, a tab sends at once if its last send was over 45 s ago.
  - So usually only the tab in front sends.
- **Sign-out:** heartbeats stop, and **nothing is deleted.** The row expires at the end of the window (150 s).
  - **Why:** the row belongs to the account, not the device. A player signed in on a computer and a phone who signs out on the phone must stay counted while the computer plays (D5).
  - **Leaving immediately** would need per-session presence. That is out of scope for MR-S1, and can be considered later if immediate departures matter.
- **A closed tab, a lost connection, or a sleeping device:** no heartbeats, so the account stops counting at the end of the window.
- **Failures** are ignored silently. A heartbeat never shows an error to the player or affects play.
- **Account changes:** heartbeats belong to the game session (`gameGen`), so a stale timer never sends for the previous account (L-1's isolation rule).

**Retention (privacy):**
- **The table holds only** `user_id` and the latest `last_seen`, with no history.
- **Rows are deleted** once they are older than **1 hour**, so nothing lingers about accounts that have left.
  - **Where it runs:** inside **`touch_presence`**, the authenticated, throttled write path. Each accepted write also removes a bounded number of rows older than an hour (`delete … where last_seen < now() - interval '1 hour'`, limited per call).
  - **Not in the public status path:** an anonymous status request never triggers database maintenance. The public aggregate is **read-only.**
  - **If nobody plays for a while,** old rows wait until the next heartbeat. They are at most one row per account, with no history.
- **RLS:** no direct reads or writes for `anon` or `authenticated`.

### 5.4 The public answer, privileges and caching (S1-03)

**The endpoint:** a **Netlify Edge Function at `/api/status`** on `monstraregna.com`, built like the news pages (`netlify/edge-functions/news.js`).
- **The checks:** it runs the readiness checks (5.2), and reads the maintenance window from the public news table.
- **The key:** it uses **only the publishable key**, never a service-role or other privileged key.
- **Same origin:** the entrance's request goes to the site's own address, with no cross-origin setup.
- **No new Supabase function deploy is needed:** the production steps are the migration and the `game` function's heartbeat path.

**Privileges:**
- the readiness and count SQL function is granted to `anon` and returns only the readiness booleans and the count;
- `touch_presence` is executable by `service_role` only, so only the `game` function can call it;
- the `presence` table has RLS with no policies for `anon` or `authenticated`.
- **Direct calls** to the anon function (bypassing the cache) return the same aggregate and cost one indexed count. That's accepted.

**The response,** exact and validated on both ends:

```json
{ "state": "online" | "degraded" | "offline" | "maintenance", "players_online": 0..n | null, "as_of": "<ISO-8601 server time>" }
```

- **No other fields:** no ids, names, emails, zones or check details. Details go only to the server log.
- **`players_online` is `null`** if the count couldn't be read. The page then shows "—".
- **The endpoint's own failure** (an exception, or Supabase unreachable from the edge): `503` with the same shape, `state` `"offline"` only if the checks themselves showed it, and otherwise no body. The page then shows "Status unavailable".
- **The page rejects** any response off this shape, or with `as_of` older than **120 s** (cache plus slack), as "Status unavailable".

**Caching, target 30 s (QS-4), to be proved rather than assumed:**
- **The design:** Netlify's CDN cache for edge-function responses, set in the edge function (Netlify's documented response caching, with a 30 s shared lifetime). Whether it is truly shared across visitors, and its exact headers, is **verified in implementation.**
- **The tests:**
  - repeated requests within 30 s return the **same `as_of`**, and the upstream checks are recorded as running once;
  - after 30 s, a fresh `as_of`;
  - a failed evaluation isn't cached for long (`503` cached 10 s at most, QS-4).
- **If Netlify can't provide a shared cache this way,** the implementation reports it and proposes the alternative. It doesn't claim the 30 s figure.

**On the entrance:**
- **Loading:** after the first paint (like the news), with a plain `fetch('/api/status')`. **supabase-js is never loaded** for anonymous visitors.
- **Refresh:** every 60 s while the page is visible, and none while hidden.
- **Display:** "Realm Online · 24 Players Online", in the area MR-B2 reserved.
- **Announcements:** state changes are announced politely; count changes aren't.
- **Failure:** "Status unavailable · —", with nothing else affected (LAC-21). Shown in place, not as an empty box before the first answer.
- **Small counts:** an exact count, even 1. It reveals that someone is online, not who.

### 5.5 Acceptance criteria

| ID | Criterion |
|---|---|
| S1-1 | **Several tabs or devices of one account count once;** two accounts count two. An account without a hero, or a banned one, isn't counted. An account stops counting once its heartbeat is older than the window |
| S1-2 | **The heartbeat needs a valid session,** takes the account from it, and ignores any account named in the request. It runs **no game initialization** (shown by a test that fails if `loadWorld` is reached) |
| S1-3 | **Writes are throttled:** at most one write per account per 45 s, whatever the number of tabs (a local-stack test sending many heartbeats) |
| S1-4 | **The client sends** only while visible, sends at once when it becomes visible, stops on sign-out **without deleting anything,** and never sends for a previous account after a switch. A player signed out on one device but playing on another stays counted |
| S1-5 | **Readiness (5.2):** each state is produced by the right evidence. Online: all pass. Degraded: a failure that passed on retry, or slow twice. Offline: failed twice. Maintenance: a notice under way, which takes precedence. Each check's failure is simulated locally. A single slow attempt alone isn't Degraded |
| S1-6 | **The public answer** matches the schema exactly, with no identities, locations or check details. The page rejects off-schema or stale answers as "Status unavailable", with "—" for the count |
| S1-7 | **Privileges:** only the publishable key at the edge; `touch_presence` callable by `service_role` only; `presence` unreadable to `anon` and `authenticated` |
| S1-8 | **Caching is proved:** the same `as_of` within 30 s, the upstream checks run once per window, fresh after expiry, failures cached briefly. If a shared cache isn't available, that's reported, not claimed |
| S1-9 | **Retention:** rows older than 1 hour are deleted by `touch_presence` (the authenticated write path), never by the public status request. The public aggregate is read-only. No history is kept |
| S1-10 | **The entrance:** after first paint, no supabase-js for visitors, about one refresh a minute while visible and none while hidden, state changes announced, and a status failure never delaying sign-in. The performance contract (4.5) holds |
| S1-11 | **Local stack tests** cover the migration, RLS, the functions, throttling, the window boundary and the readiness states. The production migration and the `game` function deploy each need their own authorization, as in L-3 |

### 5.6 Alternatives considered

- **Supabase Realtime Presence:** a public total would need a server-side subscriber to aggregate it, and anonymous visitors mustn't join the channel. That adds moving parts; it stays an option if heartbeats prove costly.
- **The heartbeat through `handle()`:** rejected. It would load the world and zones every minute for every player (S1-02).
- **A Supabase `status` edge function:** a possible host for 5.4. A Netlify edge function is preferred because it is same-origin, has the news pages' existing pattern, needs no new Supabase deploy, and can use Netlify's cache.
- **A probe-history table for "Degraded":** rejected for now. It would need public writes or a privileged key; the retry within an evaluation is used instead.
- **`updated_at` on characters:** it doesn't meet D5.

## 6. Phasing and gates

1. **This scope:** review, then the owner's answers to section 7.
2. **MR-B1:** implementation PR, then review and merge (the rename, without the redirect). Then cutover steps 2–7, each owner-controlled or authorized, recorded in a docs PR.
3. **MR-B2:** implementation PR (after authorization), then review and merge. Each conditional link appears only when its condition holds.
4. **MR-S1:** implementation PR on the local stack (after authorization), then review.
   - **Production, each step authorized:** the migration (the `presence` table and the two functions), then the `game` function deploy (the heartbeat path), then the merge. The merge deploys `/api/status` with the site.
   - **Then:** live checks, read-only.
5. **The legal milestone (D7)** is scoped separately; it can run alongside.

## 7. Open questions for the owner

| Q | Question | Recommendation |
|---|---|---|
| QB-1 | **Manifest `short_name`:** "Monstra Regna" (13 characters), or shorter for home-screen icons? | "Monstra Regna". Most platforms show about 12 characters before truncating, so check on your phone |
| QB-2 | **An announcement article** for the domain move and the one-time sign-in? | Yes, published **before** the redirect is switched on (between steps 4 and 5) |
| QB-3 | **The contact address and its delivery** (D8). Until it works, B2 ships without the Contact link and page | Tell us when `support@monstraregna.com`, or another address, reaches you |
| QB-4 | **The Discord invite** (D9) | Send it when ready; the link waits until then |
| QS-1 | **The presence window:** a 60 s heartbeat and a 150 s window, with the 45 s write throttle? | Yes, as **initial test parameters,** reviewed with local and live measurements before being treated as final |
| QS-2 | **Readiness rules and time limits** (5.2): Auth 2 s, database 2 s, game preflight 3 s; one retry; Degraded only on repeated evidence | As proposed, as initial test parameters |
| QS-3 | **Where things run:** the heartbeat as a dedicated path in `game` (before `handle()`), and the public answer from a Netlify edge function at `/api/status` | As proposed (5.3, 5.4) |
| QS-4 | **Caching:** 30 s for good answers, at most 10 s for failures, proved in implementation | Yes |
| QS-5 | **Who counts:** accounts with a hero that aren't banned, or every signed-in account? | Accounts with a hero that aren't banned, since "Players Online" means people in the world |

## 8. Not verified by this scope

- **The production Supabase Auth settings:** none were read.
- **Netlify's host redirect:** a preview shows only that previews are unaffected. The real old host is verified after deployment (B1-4b, B1-4c).
- **Netlify's shared response caching for edge functions:** to be proved in MR-S1 (S1-8).
- **How "Monstra Regna" displays** as an installed app's name on real phones (QB-1).
- **All performance figures for B2:** they're estimates until measured.

## 9. Scope review corrections (review of `a873e9d`)

**The review accepted:**
- the three-milestone structure;
- D1–D12;
- the revised performance contract;
- the production authorization boundaries.

MR-B1 and MR-B2 were accepted in principle. MR-S1 needed a tighter contract.

**B1, redirect evidence.**
- **What a deploy preview proves:** only that previews stay reachable and the configuration is valid. B1-4 is split:
  - **B1-4a:** before the merge;
  - **B1-4b:** the real old host after the authorized deployment, covering the 301, the path and query string, no loop, and previews;
  - **B1-4c:** authentication links issued before the move, with their fragment kept across the redirect and R-1's guard on the new domain.
- **The seven-step order is kept.** The announcement (QB-2) is now before the redirect.

**B2.**
- **The status area:** reserved as a named grid area and a note in the HTML, with **no element and no empty space** until MR-S1.
- **The skip link** is tested in three states: the normal form, a saved session being restored, and a password reset under way.

**S1-01, real availability (5.2).**
- **"Online"** is now a server-side readiness check of Auth (health), the `game` function (a preflight, proving it boots, run before authentication and side-effect free), and the database reads every game request starts with. A working status endpoint alone is no longer enough.
- **Degraded** needs repeated evidence: a failure that passed on retry, or slow on both attempts. **Offline** means failed on both, verified server-side.
- **The limits are stated:** the preflight doesn't prove every action, and no history is kept.

**S1-02, the heartbeat (5.3).**
- **A dedicated authenticated path before `handle()`,** so there's no world or zone loading.
- **Server-side throttle:** one write per account per 45 s.
- **One row per account,** so it's counted once.
- **Defined behaviour** for:
  - visible-only sending;
  - background tabs;
  - sign-out (heartbeats stop, and the row expires; changed in section 10);
  - lost connections;
  - account switches (`gameGen`);
  - accounts without a hero (not counted, QS-5);
  - banned accounts (not counted).
- **60 s / 150 s** are initial test parameters.

**S1-03, the public answer and caching (5.4).**
- **The exact response schema,** validated at both ends, with stale results rejected.
- **The endpoint:** Netlify `/api/status`, using only the publishable key.
- **Privileges:** the anon function returns only booleans and the count; `touch_presence` is service-role only; RLS locks the table.
- **The 30 s cache** must be **proved** (the same `as_of` and one upstream run per window, then fresh, with failures cached briefly), or the gap reported.
- **Retention:** rows older than 1 hour are deleted; no history.

**The answers recommended in the review** are reflected in section 7, as recommendations for the owner: QB-1 to QB-4, and QS-1 to QS-5.

## 10. The owner's answers to section 7 (2026-11-17)

**Decided:**
- **QB-1:** the manifest's `short_name` is **"Monstra Regna"**. Truncation on some home screens is accepted rather than inventing an abbreviation.
- **QB-2:** a news article announces the move, the new address and the possible one-time sign-in. It is published **before** the old-domain redirect (between cutover steps 4 and 5).
- **QB-3, pending setup:** the address is **`support@monstraregna.com`** (D8). The address, the Contact link and `/contact` are published only once the owner has verified that mail reaches a monitored inbox.
- **QB-4, pending:** there is **no Discord invite yet.** The icon and link are left out until a permanent invite exists (D9).
- **QS-1, approved for testing:** a 60 s heartbeat, a 150 s presence window and a 45 s server-side write throttle. **Changed:** sign-out stops heartbeats and deletes nothing; the row expires (5.3).
- **QS-2, approved for testing, explicitly provisional:** limits of 2 s for Auth, 2 s for the database and 3 s for the game preflight, with one retry.
- **QS-3, approved in principle:**
  - the heartbeat goes through the authenticated `game` function, on a dedicated path before `handle()`;
  - public reads go through a separate Netlify `/api/status`.
- **QS-4, approved:** 30 s for successful answers and at most 10 s for failures, with actual shared-cache behaviour verified.
- **QS-5, approved:** count distinct authenticated accounts that have a hero and no active ban.

**Changes these bring to MR-S1:**
- **Sign-out:** no immediate deletion (5.3, S1-4). Deleting the account's single row would drop a player who is still playing on another device, contradicting D5.
- **Clean-up moved off the public path** (5.3, S1-9):
  - stale rows are removed by `touch_presence`, the authenticated, throttled write;
  - the public status endpoint and its aggregate are read-only, so anonymous requests can't trigger database maintenance.

**Implementation order is unchanged:** MR-B1 can proceed once authorized; MR-B2's Contact and Discord items, and MR-S1, wait at their own gates.

## 11. Cutover progress (MR-B1, section 3.2)

### Step 2 was done early, by the owner (2026-11-17)

**What happened:** the owner updated the production Supabase Auth URL settings **before step 1** (the rename merge), which at that time had not yet been implemented or authorized. MR-B1 was authorized on 2026-11-18, and step 1 has since merged as PR #48 (`ea2e4a4`); see "Step 1 is complete" below. Doing step 2 first was safe: `monstraregna.com` already serves exactly the same site as the Netlify address (section 2).

**The settings applied,** as Claude described them to the owner and as the owner reports doing. They were **not read or verified by Claude,** and no credentials are involved:
- **Site URL:** `https://monstraregna.com`.
- **Redirect URLs:**
  - `https://monstraregna.com/**` added;
  - any existing `https://clickmonsters.netlify.app` entry **kept**, until step 7, so emails issued before the move still return;
  - **no** preview wildcard (`deploy-preview-*`).
- **The values before the change:** not recorded by Claude. The owner was asked to note them.

**Don't repeat this step.** MR-B1's implementation starts at step 1 (the rename, without the redirect). Then it goes on to the step 3 checks: sign-up confirmation landing on `monstraregna.com`; sign-in and session restore there; and a valid reset link opening "Choose a new password". After that come steps 4–7. Confirming the settings with a read-only inspection would need the owner's authorization.

### Step 1 is complete (2026-11-18)

- **The rename merged** as PR #48 (`ea2e4a4`), after independent review at `2eaae3e` and green required checks (CI run `44326706062`: `engine` 51/51; `database` 42/42 pgTAP and 12/12 API; `browser` 208/208, on the merge commit `8429bc7`).
- **Step 2** stays recorded as done early by the owner, not independently inspected.
- **Step 3: the applicable checks passed** under the current production authentication configuration on 2026-11-18, as reported by the owner: session kept, and a dashboard reset link worked end to end on `monstraregna.com`. **Sign-up confirmation was not performed:** "Confirm email" has been off since the first setup. The check is deferred until email confirmation and delivery are separately authorized and configured.
- **Step 4 passed** on 2026-11-18: the owner's browser check, and independently Claude's authorized read-only requests (titles, manifest, and `monstraregna.com` canonical and `og:url` on news pages, from both hosts).
- **Next:** the announcement (QB-2), then step 5. The record is `docs/monstra-regna-b1-report.md`, section 3.

### Unchanged through the migration

- **`RECOVERY_REQUESTS` stays `false`.** The migration verifies that incoming reset links work on the new domain (R-1's guard). It doesn't switch on public password-reset requests; that belongs to the separate activation milestone.
- **The support mailbox is independent of authentication email.** The DNS setup for `support@monstraregna.com` (up to 72 hours) gates only the Contact link and page (D8, QB-3). It doesn't hold up MR-B1 or the step 3 checks. Supabase's built-in sender mails the owner's existing address, as a member of the project's organization.

