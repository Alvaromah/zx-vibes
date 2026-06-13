; ── recipe: masked sprite, 16x16, cell-aligned ───────────────────────
; Masked drawing preserves the background: screen = (screen AND mask) OR data.
; Unlike XOR, drawing twice does NOT erase — to move, restore the background
; (or clear the cells) at the old position first.
;
; Sprite format: 16 lines × 4 bytes = maskL, dataL, maskR, dataR per line.
; Mask bit 1 = keep the screen, 0 = cut a hole. Make the mask cut a halo
; one pixel wider than the data so the sprite separates from the background.

; sprite_masked_16x16 — draw a masked 16x16 sprite on the 2x2 cell block
; whose top-left cell is (row, col)
; in:       B = row (0-22), C = col (0-30), DE = sprite (64 bytes)
; clobbers: AF, B, DE, HL
sprite_masked_16x16:
    call .half              ; lines 0-7 into cell (row, col)
    inc b                   ; lines 8-15 into the cell below
.half:
    push bc
    call cell_addr
    ld b, 8
.lines:
    ld a, (de)              ; left mask
    and (hl)
    ld c, a
    inc de
    ld a, (de)              ; left data
    or c
    ld (hl), a
    inc de
    inc l                   ; right column, same pixel line
    ld a, (de)              ; right mask
    and (hl)
    ld c, a
    inc de
    ld a, (de)              ; right data
    or c
    ld (hl), a
    inc de
    dec l
    inc h                   ; next pixel line within the cell
    djnz .lines
    pop bc
    ret
