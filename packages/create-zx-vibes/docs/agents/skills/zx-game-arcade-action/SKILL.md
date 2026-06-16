---
name: zx-game-arcade-action
description: Build or extend fast ZX Spectrum 48K arcade/action games in Z80 assembly with HALT-synced loops, input, sprites, score, PRNG, and zxs verification.
---

# ZX Game Arcade Action

Use this skill when the user asks for an arcade/action game: shooter, maze
chase, paddle game, breakout, dodge game, arena action, score attack, enemies,
projectiles, pickups, lives, waves, collision, sound effects, or a generic
real-time ZX Spectrum game.

## Key Rules

- Use the starter game loop as the default architecture: `EI`, one or more
  `HALT`s for speed control, read input, update state, erase/draw sprites, and
  jump back.
- Keep all action deterministic. Use fixed seeds for `prng_seed` unless the
  user explicitly wants variable seeding; deterministic runs make `zxs verify`
  and transcripts reliable.
- Read QAOP+Space with the local keyboard routine before writing custom input.
  The matrix is active-low; the recipe already handles `CPL` and bit packing.
- Prefer cell-aligned or byte-aligned sprites. Use XOR sprites for fast moving
  objects with the no-trails contract: erase old position, update, draw new
  position. Use masked sprites only when background preservation is worth the
  extra state.
- Track score in BCD and print it through the ROM print recipe or a small
  fixed-width HUD. Avoid division for decimal conversion.
- Keep expensive work out of the 50Hz critical path. Full-screen clears,
  large `LDIR`s, and ROM beeps can consume multiple frames; use dirty cells,
  small sprite updates, attr effects, and short nonblocking SFX.
- Store lives, score, wave, PRNG seed, and actor state in explicit RAM labels
  so tests can assert behavior.

## Load First

- In generated projects: `AGENT_PLAYBOOK.md`, `src/main.asm`,
  `tests/smoke.test.json`, `lib/screen.asm`, and `lib/keys.asm`.
- In a repository checkout: `starters/game/*` has the source starter, and
  `packages/toolkit/templates/game/*` has the packaged template copy.
- Repository-only examples: `packages/toolkit/examples/pong-by-agent/main.asm`
  for score, ball/paddle, ROM print, and debug-loop patterns; and
  `packages/toolkit/examples/arkanoid-quickstart/src/main.asm` for
  brick/paddle/collision patterns.

If those repository-only examples are absent in a generated project, use the
local starter files and reference docs first.

## Local References And Recipes

- `docs/reference/interrupts-and-timing.md` for 50Hz timing, `HALT`, and the
  69,888 T-state frame budget.
- `docs/reference/keyboard-input.md` for QAOP+Space and scheduled key tests.
- `docs/reference/screen-layout.md` and `docs/reference/attributes-and-colour.md`
  for sprite placement and colour clash tradeoffs.
- `docs/reference/rom-routines.md` for `RST 0x10`, `CHAN-OPEN`, and ROM call
  constraints.
- `docs/reference/common-bugs.md` for watchdog triage.

Repository-only recipe references:

- `packages/toolkit/recipes/04-sprite-xor-8x8/recipe.asm`
- `packages/toolkit/recipes/05-sprite-masked-16x16/recipe.asm`
- `packages/toolkit/recipes/06-keyboard-qaop/recipe.asm`
- `packages/toolkit/recipes/07-game-loop/recipe.asm`
- `packages/toolkit/recipes/09-beeper-fx/recipe.asm`
- `packages/toolkit/recipes/10-score-bcd/recipe.asm`
- `packages/toolkit/recipes/11-prng/recipe.asm`
- `packages/toolkit/recipes/12-attr-effects/recipe.asm`

## Routing

- For generic arcade games, start with the `game` starter, not `platformer`.
- For breakout/brick games in a repository checkout, inspect
  `packages/toolkit/examples/arkanoid-quickstart/` before designing collision
  or scoring from scratch.
- For pong/paddle games in a repository checkout, inspect
  `packages/toolkit/examples/pong-by-agent/`.
- For random waves or enemy movement, load the PRNG recipe and keep seed/state
  test-visible.
- For audio, prefer the beeper SFX recipe over ROM `BEEPER` during gameplay.

## Validation

After every source change, run and inspect:

```bash
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
zxs screen --text
```

Check `status: "ok"` and `loop.haltSynced: true`. Use scheduled key input to
exercise controls, firing, or paddle movement:

```bash
zxs run --bin build/main.bin --org 0x8000 --frames 240 --fresh --keys "10:P*30,50:SPACE*8,90:O*20" --json
```

Use screenshots for visual validation, and `zxs trace --frames 5` when frame
budget or flicker is suspicious. Finish with `zxs verify`, with assertions for
screen changes, score bytes, lives, projectile/enemy state, PRNG-dependent
spawns, beeper edges, or game-over/victory flags.
