# ClickMonster

A text-based fantasy RPG for mobile browsers. Create a hero, explore gridded zones,
fight turn-based battles, collect gold and gems, and build your stats however you like.

## Current status: Phase 2 (online multiplayer)

Sign in with email + password. Your hero lives on the server (Supabase), so it follows you
across devices, and other players in the same zone cell show up under **Players**.

- **6 races**, each with a specialty: Human (swords), Elf (frost), Dwarf (axes and armor),
  Orc (maces), Gnome (fire), Halfling (daggers).
- **Masteries** for every weapon type, element and armor grow as you fight and boost damage,
  accuracy and crits. Races start ahead in their specialty and have per-mastery caps.
- **5 stats**, no caps: Strength (melee damage), Dexterity (hit & dodge), Intelligence (spell damage),
  Wisdom (cast chance & spell resist), Vitality (health).
- **Leveling**: each level gives 10 points — all into one stat, or +2 into every stat.
- **World**: 6 starter zones (10×10), locked to the Overworld until level 20; a 7×7 Overworld
  leading to 5 adventure zones (levels 22–75), two of them flagged PvP.
  Every cell in a zone shares the zone's monster list; towns, paths and boss lairs sit on specific cells.
- **Gear**: shared by all races, Class I–X, with stat requirements and gem sockets. Different towns sell different gear.
- **Monsters drop gold, gems and (rarely) relic gear.** Ten gem kinds in five grades: stat
  percentages, bonus gold, bonus XP, life steal, critical chance and armor.
- **Elite variants**: about 1 in 10 fights is a Gilded, Mighty, Ancient (etc.) monster with its own rewards.
- **Bank**: dying or losing a duel costs all carried gold (and some XP, never a level). Banked gold is safe.
- **Quest board**: six quests posted every hour, each lasting three hours. First player to finish claims it.
  Public news feed announces quest wins, duels and rare finds.

## Chat

A slide-up drawer available on every screen (a slim bar above the controls shows the latest
message and unread counts). Channels: **Global**, **Zone** (players in your zone) and **Whispers**.
News (quest wins, boss kills, duels, announcements) appears in Global.

- Level 5 to send; anyone can read. 200 characters, one message per 2 seconds, no repeats, no links.
- Tap a message to whisper, ignore or report the sender. Ignored players' messages are hidden and
  their whispers are refused.
- Muted players can't send. Staff names carry a Mod/Admin tag and staff can remove messages in game.
- Admin console → Chat: report queue and 14 days of searchable history (removed messages keep their
  original text for staff).
- Messages are written only by the game server; row-level security limits Zone messages to that
  zone and whispers to the two people involved, including over Supabase Realtime.

## Multiplayer architecture

- **Supabase Auth** for accounts (email + password).
- **`characters` table**, one row per account (`supabase/migrations/`). Row-level security lets
  signed-in players read only public columns (name, race, level, location); nobody can write from the browser.
- **`game` edge function** (`supabase/functions/game/index.ts`) performs every action: it loads
  the hero, runs the shared engine (`public/js/engine/`, symlinked as `supabase/functions/game/js`),
  and saves with optimistic locking. The server rolls every hit, drop and gold change.
- **Players here**: players whose last action was in your cell within the last 10 minutes.
- **PvP**: in PvP zones (not in towns) you can attack players at most 10 levels below you.
  The duel auto-resolves; the loser drops 10% gold to the winner and wakes up in town.

## Admin console

`/admin` (public/admin.html) is the staff console, backed by the `admin` edge function, which checks
the `staff` table on every request and records every action in `admin_log`.

- **Moderators**: dashboard, player search and profiles, warn/mute/jail/ban up to 7 days,
  announcements, audit log.
- **Admins**: everything above, plus permanent sanctions, the hero editor (level, XP, gold, bank,
  stats, masteries, location, items, gems), player emails, deleting news, and managing staff.
- Jailed heroes can look around but not act; banned heroes can't play. Both see the reason.
- **World** (admins): base multipliers for XP, gold, drops, elite chance and mastery gain, plus timed
  events (e.g. double XP for 24 hours) that stack on top. Players see a banner while one runs.
- **Hunts** (admins): world bosses with one shared health pool in a zone. Damage is scaled by level so
  everyone can contribute; rewards are split by damage (2% minimum) and the killing blow adds a relic.
  Rewards are delivered through `pending_rewards`, so offline hunters get them next time they play.
- **Zones** (admins): create, edit, delete or restore zones: size, level gates, town and shop
  stock, monsters, boss and lairs, extra paths, and placement on the Overworld (paths in and out are
  generated). Live map preview and validation. Changes apply to the game immediately; heroes in a
  removed area are moved somewhere safe.
- **Economy**: a daily ledger of gold created (loot, quests, hunts, selling, admin edits) and removed
  (shops, healer, jeweler, deaths).

## Project layout

```
public/              ← deployed site (Netlify publishes this folder)
  index.html
  css/style.css
  js/main.js         ← UI: rendering and button handling
  js/net.js          ← Supabase client: auth, game API, players list
  js/config.js       ← Supabase URL + publishable key (public by design)
  js/engine/         ← game rules (combat, leveling, world, inventory) — no DOM
  js/data/           ← content: races, zones, monsters, items, gems
supabase/
  migrations/        ← database schema
  functions/game/    ← game server (edge function)
  functions/admin/   ← staff API (edge function)
tests/               ← engine tests (node --test)
tools/sim.mjs        ← balance simulator
```

## Development

No build step and no runtime dependencies. Requires Node 18+ for tests. The UI tests need the dev
dependencies (`npm install`) and a Playwright Chromium (`npx playwright install chromium`). They never
contact the live Supabase project: every request is answered by a fake backend in
`tests/ui/harness.mjs` built on the real game engine, and any unexpected request fails the test.

```
npm test        # run engine tests
npm run sim     # print balance tables (win rates, fight length by build/level)
npm run test:ui            # browser UI tests (Playwright + axe-core) against a fake backend
node tools/ui-metrics.mjs out.json   # responsive layout measurements (UI_PUBLIC_DIR=<dir> to measure another checkout)
node tools/ui-shots.mjs out 320,844x390   # screenshots plus an axe summary
npm run deploy:functions   # deploy the game and admin servers (needs SUPABASE_ACCESS_TOKEN)
npx serve public   # or any static server, then open http://localhost:3000
```

Zones live in the database (`zones` table) and are edited in the admin console. The built-in zones in
`public/js/data/zones.js` seed it (`node tools/seed-zones.mjs`) and are the fallback if it can't be
loaded. Gear tiers are in `public/js/data/items.js`.

## Deploying

Netlify: connect the repo, and `netlify.toml` handles the rest (publish dir `public`, no build).

**Important:** the game server runs the engine too. After changing anything in `public/js/engine/`
or `public/js/data/`, redeploy the function (`npm run deploy:functions`) so server and client agree.
Database changes go in a new file under `supabase/migrations/` (`supabase db push` or the SQL editor).
