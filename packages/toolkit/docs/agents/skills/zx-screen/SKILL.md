---
name: zx-screen
description: Use for ZX Spectrum bitmap drawing, sprite placement, pixel address math, screen clearing, and display corruption triage.
---

# ZX Screen Skill

## When to Use

Use this skill when changing or reviewing code that writes to the ZX Spectrum
bitmap at `0x4000`-`0x57FF`, draws pixels or sprites, clears the display, or
debugs striped, wrapped, or corrupted screen output.

## Key Rules

- The bitmap is 256x192 pixels, 6144 bytes from `0x4000`, one bit per pixel.
  Each byte is 8 horizontal pixels; the MSB is the leftmost pixel.
- The bitmap is interleaved. For pixel `(x,y)`:
  `addr = 0x4000 | ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x >> 3)`.
  The bit is `7 - (x & 7)`.
- Keep the x distinction explicit: pixel x is `0`-`255`; screen byte x is
  `x >> 3`, `0`-`31`. Cell-aligned sprites use byte x, not pixel x.
- To draw the next pixel row inside an 8x8 cell, use `INC H`. Do not add 32.
  Adding 32 moves to the same pixel line in the next character row.
- Recompute addresses, or use a proven helper, when crossing character rows or
  screen thirds. Test around y `63/64` and `127/128`.
- Clamp all coordinates before address calculation. y must stay `0`-`191`;
  x must stay `0`-`255`; byte x must stay `0`-`31`. Writes past `0x57FF`
  corrupt attributes and then system variables.
- Avoid full-screen clears in a frame loop. A bitmap `LDIR` costs more than a
  frame; erase and redraw dirty cells or moved objects instead.

## Local Docs and Recipes to Load

- `docs/reference/screen-layout.md`
- `docs/reference/attributes-and-colour.md`
- `docs/reference/common-bugs.md`
- `packages/toolkit/recipes/01-clear-screen/recipe.asm`
- `packages/toolkit/templates/game/lib/screen.asm`
- `packages/toolkit/templates/platformer/lib/screen.asm`
- For copied starter projects, compare the same files under
  `packages/create-zx-vibes/` and root `starters/`.

External cross-checks, when local docs are insufficient: World of Spectrum 48K
reference and Nocash ZX specs for screen memory layout.

## Validation Expectations

- Build with the repo-supported command for the project under test, usually
  `zxs build` or the relevant package test.
- Run under `zxs run --frames <n> --screenshot screen.png` and inspect the
  screenshot for stripes, third-boundary jumps, or clipped sprites.
- Use `zxs screen --text` only for ROM/text-mode confirmation; bitmap sprites
  need screenshot or memory inspection.
- Add or update recipe/test assertions when the behavior is reusable. At
  minimum, exercise top, middle, bottom, and third-boundary positions.
- If animation slows or flickers after screen changes, run `zxs trace` and
  check whether full clears or excessive redraws are consuming the frame.
