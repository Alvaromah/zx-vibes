# Scrolling — moving screen regions as blocks

The 48K display file is a flat byte array with an interleaved line order
([memory-map.md](../reference/memory-map.md)); scrolling is block-moving those
bytes. What varies is the axis and the granularity — pick the cheapest one the
game reads well at.

Recipe (CI-tested, copy from it): [`recipes/scroll-row-left/`](../recipes/scroll-row-left/README.md).

## Horizontal, byte granularity (8 px) — the workhorse

Per pixel line: shift 31 bytes left with `LDIR`, clear the seam byte.

```
; one pixel line, one byte left: HL = line+1 (src), DE = line (dst)
    ld h, d             ; D = line high byte
    ld l, 1
    ld e, 0
    ld bc, 31
    ldir
    xor a
    ld (de), a          ; LDIR left DE at the vacated rightmost byte
```

Cost: ~21 T-states per byte moved. A full 256-wide, 8-line character row is
8 x 31 LDIR bytes ≈ 5.5k T-states — you can scroll a handful of rows per frame
inside the 69,888 T-state budget ([ula-timing.md](../reference/ula-timing.md)).
Attributes scroll the same way over the linear `0x5800` file when colour must
travel with the tiles.

## Horizontal, pixel granularity — smooth but 4x the work

`RL (HL)` / `RR (HL)` walk each line, carrying a bit between bytes
(~4x the T-states of the byte scroll — [z80-opcodes.md](../reference/z80-opcodes.md)).
The classic compromise is pre-shifted tile/sprite phases (render at 2- or
4-pixel steps from copies shifted at build time) — pay memory, not T-states.

## Vertical

Within a character row, consecutive pixel lines are `+0x100` apart — a one-line
vertical scroll inside a row is 32-byte `LDIR`s between adjacent `+0x100` pages.
Crossing character-row boundaries brings the interleave into play: compute both
line addresses (or walk a 192-entry line-address table, built once at startup)
rather than deriving the "next line" with arithmetic tricks you will get wrong.
Scrolling by a whole character row (8 lines at once) sidesteps the interleave
entirely: the three 2K thirds are each linear per line, and attributes move with
a single 32-byte-per-row `LDIR`.

## Rules

- Scroll during the frame you own — after `HALT`, before the raster catches the
  region — or tearing shows ([machine-execution.md](../reference/machine-execution.md)
  for the frame model; [seeing-and-proving.md](seeing-and-proving.md) to check a
  capture honestly).
- Feed the seam (the vacated column/row) from the map in the same pass; a
  separate "draw the new edge" pass costs a second walk over the region.
- Budget first: count bytes moved x 21 T-states and check it fits BEFORE
  building the feature around it.
