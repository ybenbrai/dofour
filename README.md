# Emberfall Tactics

A small, original Dofus-inspired tactical RPG prototype. Two teams of fighters trade
turns on an isometric 14×14 grid: spend action points on spells, movement points on
positioning, and use range, line of sight, pushes, poison and shields to win.

No game assets are required — every tile, character and effect is drawn with Canvas
and flat colors.

**Live demo:** <https://ybenbrai.github.io/dofour/>

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>). No install is required for
players once the game is built and hosted.

Production build:

```bash
npm run build
npm run preview
```

## How to play

You control a party of three:

| Fighter | Class | Role |
| --- | --- | --- |
| Boldur | Iop | Melee bruiser — Cleave, Intimidation (push), Leap, Wrath |
| Aelina | Cra | Ranged damage — Precise Shot, Poison Arrow, Repelling Arrow, Explosive Arrow |
| Mira | Eniripsa | Support — Healing Word, Painful Word, Protective Word |

The enemies are a Tofu, a Goblin Scout, a Goblin Brute and a Bwork. Defeat all of them to win;
lose if your whole party falls.

### Controls

- **Click a highlighted tile** to move the active fighter (costs MP per tile).
- **Click a spell card** (or press **1–4**) to select it, then click a highlighted target.
- **Right-click** or **Esc** cancels the selected spell.
- **End Turn** or **Enter** ends your turn and lets the enemy team act.
- Hover a tile to preview the movement path and MP cost; hover a spell to see its tooltip.

### Rules at a glance

- Initiative decides turn order; the timeline at the top shows the next fighters.
- Each fighter has AP (actions) and MP (movement), refilled at the start of their turn.
- Spells cost AP and have a minimum/maximum range measured in grid steps.
- Obstacles block line of sight for ranged attacks but not for Leap.
- Shields absorb damage before HP; poison ticks at the start of the victim's turn.
- Pushes move a target away from the caster and stop at obstacles or the arena edge.
- The arena is a 14×14 grid with 4-directional movement.

## Project layout

```
index.html          HUD markup and favicon
src/main.ts         bootstrap, input handling, enemy turn loop
src/game/           combat rules, spells/data, grid math, shared types
src/render/         isometric canvas renderer and effects
src/ui.ts           HUD: turn order, fighter panel, spell cards, log, banner
src/style.css       visual theme and responsive layout
scripts/            browser-based logic and smoke tests
```

## Tests

The tests drive the real game in headless Chrome through Puppeteer and need the dev
server running:

```bash
# terminal 1
npm run dev

# terminal 2
npm run test:logic   # mechanics: movement, spells, statuses, LOS, AI, win/lose
npm run test:smoke   # end-to-end: move, cast, end turn, autopilot win, restart
```

By default the tests use Google Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Point them at another
Chromium build with `CHROME=/path/to/chrome npm run test:logic`. Use `URL=...` to test a
different host.

`npm run test:smoke` writes screenshots to `test/` (ignored by git).

## Status

Prototype / vertical slice. Combat, enemy AI, HUD and effects are playable; there is no
persistence, progression, map exploration or multiplayer yet.
