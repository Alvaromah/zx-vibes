# scroll-row-left — byte-granular horizontal scroll of one character row

Scrolls an 8-pixel-line region of the display file left by one byte (8 px) per
pass with `LDIR`, clearing the vacated seam byte — the workhorse move behind
marquees, conveyor belts and full-screen horizontal scrollers. See the
[scrolling skill](../../skills/scrolling.md) for the cost model and variants.

## The routine

`scroll_row_left` shifts one character row (8 pixel lines, 32 columns) one byte
left. `D` carries the line's high byte; consecutive pixel lines within a
character row are `+0x100` apart, so `INC D` steps to the next line — no
interleave arithmetic needed inside a row.

```
; scroll_row_left — one character row, one byte (8 px) left.
; in: D = high byte of the row's first pixel line (e.g. 0x48 for y=64)
scroll_row_left:
    ld b, 8
.line:
    push bc
    push de
    ld h, d              ; HL = src = line base + 1
    ld l, 1
    ld e, 0              ; DE = dst = line base
    ld bc, 31
    ldir
    xor a
    ld (de), a           ; LDIR left DE at the vacated rightmost byte
    pop de
    inc d                ; next pixel line (+0x100 within the row)
    pop bc
    djnz .line
    ret
```

## The demo (`demo.asm`)

Draws a solid 8x8 block at the top-right of character row y=64 (`0x481F`),
scrolls the row four times (32 px), stores a `0x2A` completion sentinel at
`0x9000`, then settles into a HALT-synced idle loop.

## The proof (`test.json`)

- the run completes HALT-synced (`status ok`, `haltSynced true`);
- the block ARRIVED: pixel (216, 64) is set — 4 passes x 8 px left of x=248;
- the seam is CLEAN: pixel (248, 64) is clear;
- the sentinel confirms the code path ran to completion (`memEquals 0x9000 = 2A`).
