# Screen bitmap layout (the famous interleave)

Read this before writing ANY pixel code. The Spectrum bitmap is not linear —
this is the #1 source of "garbage stripes" bugs.

## The mental model

256×192 pixels = 6144 bytes at `0x4000`, one bit per pixel (1 = INK colour).
Each byte covers 8 horizontal pixels, MSB leftmost. The screen is split into
**three thirds** of 64 lines; within a third, lines are stored **character row
first, then pixel line** — interleaved.

## The address formula

For pixel (x 0-255, y 0-191):

```
addr = 0x4000 | ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x >> 3)
bit  = 7 - (x & 7)
```

In register terms: `H = 0x40 | (y>>3 & 0x18) | (y & 7)` and
`L = (y<<2 & 0xE0) | (x>>3)`. Working routine: recipes/03-pixel-address.

## The two facts that save you

1. **Next pixel line within a character cell = `INC H`** (NOT `+32`!).
   Drawing an 8×8 cell is: write byte, `INC H`, ×8. (recipes/04-sprite-xor-8x8)
2. **Next character row = recompute** (or add 32 to L with carry into the
   weird bits). Crossing a third boundary (y=63→64, 127→128) jumps the
   address by 0x0800-0x07E0 — naive `+32` code breaks exactly there.

## Cell-aligned addressing (easy mode)

For character cell (row 0-23, col 0-31), first pixel line:

```asm
; B=row, C=col → HL; clobbers A
cell_addr:
    ld a, b
    and 0x18        ; which third
    or 0x40
    ld h, a
    ld a, b
    and 0x07        ; row within third
    rrca
    rrca
    rrca            ; ×32 → high bits of L
    or c
    ld l, a
    ret
```

The `rrca`×3 rotates the 3-bit row-within-third into the top of L, packing
`(row&7)*32 + col` (row=1, col=0 → L=0x20). Then walk the 8 pixel lines of
the cell with `INC H`.

## Attribute address for a pixel/cell

```
attr = 0x5800 + (row * 32) + col          ; row = y>>3, col = x>>3
```
In asm: `H = 0x58 + (y >> 6)`, `L = (y<<2 & 0xE0) | (x>>3)` — same L as the
bitmap address. Attributes ARE linear (no interleave).

## Gotchas

- `+32` to get the next pixel line: **wrong** — that's the next character
  row's same line. Stripes that repeat every 8 lines = this bug.
- Drawing at y≥192 or computing addresses past 0x57FF corrupts attributes
  (0x5800+) and then system variables. Clamp y to 0-191.
- The interleave applies per-THIRD: test your sprite code around y=63/64,
  not just at the top of the screen.
- X is in BYTES on screen (x>>3): a sprite at arbitrary x needs pre-shifted
  data or runtime shifting. Start cell-aligned (x multiple of 8); it's 90%
  of the visual result for 10% of the code.
