---
name: zx-colour-attributes
description: Use for ZX Spectrum attribute bytes, ink/paper/bright/flash, border color, and attribute clash design.
---

# ZX Colour Attributes Skill

## When to Use

Use this skill when setting colors, clearing attributes, drawing colored
sprites, changing border color, debugging invisible text, or designing around
attribute clash.

## Key Rules

- Attribute memory is linear: 768 bytes at `0x5800`, one byte per 8x8 cell.
  Address is `0x5800 + row * 32 + col`, where row is `y >> 3` and col is
  `x >> 3`.
- Attribute byte layout is:
  bit 7 `FLASH`, bit 6 `BRIGHT`, bits 5-3 `PAPER`, bits 2-0 `INK`.
- Colors are `0`-`7`: black, blue, red, magenta, green, cyan, yellow, white.
  Set bitmap pixels show INK; clear pixels show PAPER.
- Keep bitmap and attribute responsibilities separate. Clearing pixels does
  not clear colors, and clearing attributes does not clear pixels.
- Attribute clash is hardware behavior, not a bug to patch away. Design moving
  objects around shared 8x8 cells, mono sprites, cell-aligned movement, or
  background-zone colors.
- Clamp row to `0`-`23` and col to `0`-`31` before writing attributes.
  Writes past `0x5AFF` hit system variables.
- Border writes use `OUT (0xFE),A` with bits 0-2 as color. Bit 4 is the beeper;
  keep it intentional so sound code does not flicker the border.
- ROM text uses `ATTR-P` (`0x5C8D`) for print attributes. After custom clears,
  either set ROM attributes deliberately or write attributes yourself.

## Local Docs and Recipes to Load

- `docs/reference/attributes-and-colour.md`
- `docs/reference/screen-layout.md`
- `docs/reference/rom-routines.md`
- In a repository checkout: `packages/toolkit/recipes/01-clear-screen/recipe.asm`
  and `packages/toolkit/recipes/09-beeper-fx/recipe.asm`.

External cross-checks, when local docs are insufficient: World of Spectrum 48K
reference and Nocash ZX specs for ULA attribute and border behavior.

## Validation Expectations

- Validate attribute writes separately from bitmap writes. Inspect screenshots
  for correct cell colors and use memory assertions for `0x5800`-`0x5AFF`
  when a test can pin exact bytes.
- Include cases for visible text/sprites: avoid INK and PAPER being equal
  unless invisibility is the feature.
- Test edge cells, especially row 23 and col 31, to catch off-by-one writes
  into system variables.
- If sound code is involved, verify the border color remains stable while bit
  4 is toggled for the beeper.
- For frame loops, HALT before large attribute updates to avoid visible tearing
  and confirm `haltSynced: true` when a test covers the loop.
