# Recipes — tested, copyable Z80 building blocks

Every recipe is **executable documentation**: `recipe.asm` is the includable
routine (documented in/out/clobbers), `demo.asm` builds standalone, and
`test.json` asserts its behavior in CI via `zxs test recipes`. If it's here,
it works.

| Recipe | Gives you |
|---|---|
| `01-clear-screen` | `clear_screen` — bitmap + attributes in one call |
| `02-print-rom` | `print_init` + `print_string` — ROM printing with AT/INK codes |
| `03-pixel-address` | `pixel_addr` + `plot_pixel` — the interleave formula as code |
| `04-sprite-xor-8x8` | `cell_addr` + `sprite_xor_8x8` — no-trails XOR sprites |
| `05-sprite-masked-16x16` | `sprite_masked_16x16` — background-preserving sprites with a halo mask |
| `06-keyboard-qaop` | `read_qaop` — QAOP+Space into one byte (CPL done for you) |
| `07-game-loop` | The HALT-synced loop structure, demoed with all of the above |
| `08-im2-isr` | `im2_init` — the full IM2 ritual (table, I, vector, ISR skeleton) |
| `09-beeper-fx` | `beep` + `fx_zap` — border-safe square waves and a pitch sweep |
| `10-score-bcd` | `score_add` + `score_print` — DAA decimal score, no division |
| `11-prng` | `prng` — Metcalf 16-bit xorshift, period 65535, replayable |
| `12-attr-effects` | `attr_addr` + `attr_fill_rect` + `attr_rotate_row` — color animation for free |

Usage from your game: `INCLUDE "path/to/recipe.asm"` (labels are global —
include each recipe once).
