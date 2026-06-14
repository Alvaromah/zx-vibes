---
name: zx-rendering-patterns
description: Use when implementing or reviewing ZX Spectrum bitmap, sprite, redraw, attribute-effect, or game-loop rendering code in zx-vibes projects.
---

# ZX Rendering Patterns

Use this skill when the task touches ZX Spectrum 48K rendering behavior: pixel
addressing, sprite drawing, erase/redraw loops, attribute animation, flicker,
screen clearing, or proposals for double buffering.

## Routing

Start from local, tested project material. Load only what matches the task:

- Pixel addressing or arbitrary pixel plotting:
  `docs/reference/screen-layout.md`,
  `packages/toolkit/recipes/03-pixel-address/recipe.asm`, and
  `packages/toolkit/recipes/03-pixel-address/test.json`.
- 8x8 moving objects, bullets, cursors, simple enemies, or no-trails movement:
  `packages/toolkit/recipes/04-sprite-xor-8x8/recipe.asm`,
  `packages/toolkit/recipes/04-sprite-xor-8x8/demo.asm`, and
  `packages/toolkit/recipes/04-sprite-xor-8x8/test.json`.
- Background-preserving 16x16 sprites, actors with outlines, or sprites over
  patterned bitmap backgrounds:
  `packages/toolkit/recipes/05-sprite-masked-16x16/recipe.asm`,
  `packages/toolkit/recipes/05-sprite-masked-16x16/demo.asm`, and
  `packages/toolkit/recipes/05-sprite-masked-16x16/test.json`.
- Frame pacing, flicker, keyboard-to-update-to-render ordering, or movement
  cadence:
  `docs/reference/interrupts-and-timing.md`,
  `packages/toolkit/recipes/07-game-loop/recipe.asm`,
  `packages/toolkit/recipes/07-game-loop/demo.asm`, and
  `packages/toolkit/recipes/07-game-loop/test.json`.
- Color, attribute clash, flash/pulse/marquee effects, or cheap animation:
  `docs/reference/attributes-and-colour.md`,
  `packages/toolkit/recipes/12-attr-effects/recipe.asm`,
  `packages/toolkit/recipes/12-attr-effects/demo.asm`, and
  `packages/toolkit/recipes/12-attr-effects/test.json`.

If generated starter code has local `lib/screen.asm` or copied recipe files,
compare it with the current toolkit recipe before changing behavior. Recipes
are executable documentation and are the source of truth when comments drift.

## Rules

- Prefer dirty redraw over full-screen redraw. Erase and redraw only objects or
  cells that changed since the previous frame.
- Prefer cell-aligned rendering first. X in the bitmap is byte-oriented
  (`x >> 3`), so 8-pixel horizontal steps avoid runtime shifting and most
  address bugs.
- For simple moving 8x8 objects, use XOR first:
  `XOR(old position) -> update state -> XOR(new position)`. Drawing the same
  XOR sprite twice at the same cell restores the previous pixels.
- Do not use XOR when overlapping sprites must merge correctly, when sprite
  pixels must have a stable silhouette over detailed backgrounds, or when a
  second draw should not erase. Use masked sprites or explicit background
  restore for those cases.
- For background-preserving actors, use masked sprites:
  `screen = (screen AND mask) OR data`. The recipe format is 16 lines of
  `maskL, dataL, maskR, dataR`; mask bit 1 keeps the screen and bit 0 cuts the
  hole. A one-pixel halo mask is often worth the bytes because it separates the
  sprite from the background.
- Treat attributes as the cheapest animation surface. Attribute memory is only
  768 bytes and linear at `0x5800`; use it for pulses, bars, flashes, room
  recolors, and UI effects before touching the 6144-byte bitmap.
- Keep the loop HALT-synced unless the task explicitly requires another timing
  model. The stable shape is `ei`, `halt`, input, update, redraw, jump back.
- Keep all work between two HALTs inside the frame budget. A 48K Spectrum frame
  is 69,888 T-states; `LDIR` copying a full 6144-byte bitmap already costs
  about two frames, and copying all 6912 display bytes is worse.
- Do not clear or copy the whole display every frame unless there is a measured
  reason. Full 6912-byte double buffering consumes a large chunk of 48K RAM and
  is expensive to present. Recommend it only for scenes that truly need broad
  redraw composition and can afford the memory, copy time, and reduced game
  logic budget.
- When double buffering is justified, be explicit about whether the shadow
  buffer is bitmap-only (6144 bytes) or bitmap plus attributes (6912 bytes), and
  account for where it lives in memory.
- Recompute screen addresses across character rows or thirds. Within one 8x8
  cell, the next pixel line is `INC H`; naive `+32` creates stripe bugs and
  breaks at third boundaries.
- Clamp drawing to valid ranges. Bitmap bytes are `0x4000-0x57FF`; attribute
  bytes are `0x5800-0x5AFF`. Out-of-range rendering corrupts attributes or
  system memory.

## External Context

Use external tutorials as supporting context only, never ahead of local
recipes:

- Chuntey's double-buffering tutorial shows the classic 48K approach: draw into
  a shadow screen and copy 6912 bytes to `0x4000`. Treat it as a tradeoff, not
  the default: https://chuntey.wordpress.com/tag/double-buffering/
- Old Machinery's XOR sprite write-up matches the project recipe contract:
  XOR drawing and erasing are the same operation at the same position:
  https://oldmachinery.blogspot.com/2017/07/xorin-in-free-world.html
- The Ghosts'n Goblins graphics routine notes are useful precedent for
  specialized routines: static sprites can be ORed, while many moving sprites
  use masks for visual separation:
  https://www.emix8.org/ggdisasm/

## Validation

Before finishing a rendering change, validate the smallest relevant surface:

- For recipe behavior, run `zxs test recipes` or the package equivalent used by
  the repo. The recipe tests assert status, key pixels, nonblank cell counts,
  HALT sync, and memory bytes for attribute effects.
- For changed game code, run the project's normal build/test command and add a
  focused `zxs test` case when the behavior can be asserted with `pixelAt`,
  `cellsNonBlank`, `screenChanged`, `haltSynced`, or `memEquals`.
- Always test screen-addressing code around `y=63/64` and `y=127/128`, not just
  at the top of the screen.
- For XOR movement, assert that the old cell is blank/restored and only the new
  cell remains nonblank after movement.
- For masked sprites, assert that sprite data appears, mask-cut pixels are
  clear, and surrounding background pixels survive.
- For attribute effects, assert memory under `0x5800-0x5AFF` directly with
  `memEquals` when possible.
- For timing-sensitive changes, assert or inspect `haltSynced: true` and verify
  that redraw code does not grow into a full-frame clear/copy unless justified.
