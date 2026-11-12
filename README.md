# ClickMonster

A text-based fantasy RPG for mobile browsers. Create a hero, explore gridded zones,
fight turn-based battles, collect gold and gems, and build your stats however you like.

## Current status: Phase 1 (single player)

Playable in any browser. Your hero is saved on your device (localStorage).

- **6 races**, each with a weapon or magic-element proficiency (+25% damage, +5% hit):
  Human (swords), Elf (frost), Dwarf (axes + armor), Orc (maces), Gnome (fire), Halfling (daggers).
- **5 stats**, no caps: Strength (melee damage), Dexterity (hit & dodge), Intelligence (spell damage),
  Wisdom (cast chance & spell resist), Vitality (health).
- **Leveling**: each level gives 10 points — all into one stat, or +2 into every stat.
- **World**: 6 starter zones (10×10), locked to the Overworld until level 20; a 7×7 Overworld
  leading to 5 adventure zones (levels 22–75), two of them flagged PvP.
  Every cell in a zone shares the zone's monster list; towns, paths and boss lairs sit on specific cells.
- **Gear**: shared by all races, Class I–X, with stat requirements and gem sockets. Different towns sell different gear.
- **Monsters drop gold and gems only.** Gems socket into gear for stat bonuses.

## Phase 2 (planned): multiplayer

Accounts, a shared persistent world, a "Players here" list per cell, and PvP in flagged zones.
The plan is a hosted backend (e.g. Supabase) so there's no server to run. All game rules in
`public/js/engine/` are pure functions with no browser dependencies, so they can move to the server
as-is and the server becomes the authority on every roll.

## Project layout

```
public/              ← deployed site (Netlify publishes this folder)
  index.html
  css/style.css
  js/main.js         ← UI: rendering and button handling
  js/engine/         ← game rules (combat, leveling, world, inventory) — no DOM
  js/data/           ← content: races, zones, monsters, items, gems
tests/               ← engine tests (node --test)
tools/sim.mjs        ← balance simulator
```

## Development

No build step and no dependencies. Requires Node 18+ for tests.

```
npm test        # run engine tests
npm run sim     # print balance tables (win rates, fight length by build/level)
npx serve public   # or any static server, then open http://localhost:3000
```

Adding content is mostly data entry: new monsters and zones go in `public/js/data/zones.js`,
gear tiers in `public/js/data/items.js`.

## Deploying

Netlify: connect the repo, and `netlify.toml` handles the rest (publish dir `public`, no build).
