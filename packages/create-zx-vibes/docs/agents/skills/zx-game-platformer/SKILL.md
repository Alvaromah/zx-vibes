---
name: zx-game-platformer
description: Build or extend ZX Spectrum 48K platform games in Z80 assembly using zx-vibes starters, recipes, and the zxs feedback loop.
---

# ZX Game Platformer

Use this skill when the user asks for a ZX Spectrum platformer, jumper, room
platform game, Manic Miner-style movement, ladders, hazards, collectibles,
tile collisions, gravity, jumping, or a platformer starter extension.

## Key Rules

- Start from the platformer starter patterns before inventing structure. In a
  generated project, use local `src/`, `lib/`, `tests/`, and
  `AGENT_PLAYBOOK.md`; in a repository checkout, compare against
  `starters/platformer/` or `packages/toolkit/templates/platformer/`.
- Keep the main loop HALT-synced: `EI` once, then `HALT`, input, erase old
  sprite, update physics/collisions, draw new sprite, repeat.
- Prefer cell-aligned movement and collision at first. Store player position,
  flags, and test-visible state in explicit RAM bytes, as the starter does with
  `XPOS`, `YPOS`, `ONGROUND`, `JUMPED`, and `INPUT`.
- Model physics as small deterministic steps: horizontal clamp, jump impulse,
  gravity, landing, then hazards/collectibles. Avoid subpixel systems until the
  basic transcript is verified.
- Use XOR sprites for simple cell-aligned actors. If masked sprites are needed,
  also design a background restore/dirty-cell path; drawing a masked sprite
  twice does not erase it.
- Design around attribute clash. Use room or platform colour zones, mono moving
  sprites, or cell-aligned attribute writes rather than trying to give every
  overlapping object independent colours.
- Keep every routine's in/out/clobber contract documented and preserve stack
  balance on every branch.

## Load First

- In generated projects: `AGENT_PLAYBOOK.md`, `src/main.asm`,
  `tests/smoke.test.json`, `lib/screen.asm`, and `lib/keys.asm`.
- In a repository checkout: `starters/platformer/*` has the source starter, and
  `packages/toolkit/templates/platformer/*` has the packaged template copy.

## Local References And Recipes

- `docs/reference/interrupts-and-timing.md` for the 50Hz loop and frame budget.
- `docs/reference/keyboard-input.md` for active-low keyboard input and scheduled
  key testing.
- `docs/reference/screen-layout.md` for cell and pixel address rules.
- `docs/reference/attributes-and-colour.md` for platformer colour design.
- `docs/reference/common-bugs.md` when hangs, trails, ROM jumps, or stack drift
  appear.

Repository-only recipe references:

- `packages/toolkit/recipes/04-sprite-xor-8x8/recipe.asm`
- `packages/toolkit/recipes/05-sprite-masked-16x16/recipe.asm`
- `packages/toolkit/recipes/06-keyboard-qaop/recipe.asm`
- `packages/toolkit/recipes/07-game-loop/recipe.asm`
- `packages/toolkit/recipes/12-attr-effects/recipe.asm`

## Routing

- For starter or generated-project layout changes, include scaffolding context.
- For gameplay code in generated projects, work in that project first and use
  the root starter only as reference.
- For new reusable primitives, check the recipe set before adding another copy.
- For assembler syntax or macro issues, load the Z80 assembler guidance and
  `docs/reference/sjasmplus-cheatsheet.md`.

## Validation

After every source change, run and inspect the result:

```bash
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
zxs screen --text
```

Read the JSON. `status` must be `"ok"` and `loop.haltSynced` must be `true`.
Use scheduled input to prove movement and jumping, for example:

```bash
zxs run --bin build/main.bin --org 0x8000 --frames 120 --fresh --keys "10:P*60,20:SPACE*5" --json
```

Finish with `zxs verify`. Add or update a JSON test that catches the mechanic:
screen changed, expected nonblank cells, player position bytes, jump/ground
flags, score/inventory counters, or a victory/death state byte.
