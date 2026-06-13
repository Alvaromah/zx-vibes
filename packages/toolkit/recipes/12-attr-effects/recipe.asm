; ── recipe: attribute effects ────────────────────────────────────────
; The attribute file (0x5800-0x5AFF, 32×24, linear — NOT interleaved) is
; the cheapest animation surface on the machine: one byte recolors a
; whole 8x8 cell. Bars, pulses and marquees cost almost nothing per frame.
; Attr byte: FLASH·BRIGHT·paper(3)·ink(3) — e.g. 0x38 = black on white.

; attr_addr — attribute address of cell (row, col)
; in:       B = row (0-23), C = col (0-31)
; out:      HL = attribute address
; clobbers: AF
attr_addr:
    ld a, b
    rrca
    rrca
    rrca                    ; row*32 spread across H/L
    ld l, a
    and 0x03
    or 0x58
    ld h, a
    ld a, l
    and 0xE0
    or c
    ld l, a
    ret

; attr_fill_rect — flood a rectangle of cells with one attribute
; in:       B = row, C = col, D = height (1-24), E = width (1-32), A = attr
; clobbers: AF, BC, D, HL
attr_fill_rect:
    push af
    call attr_addr
    pop af
    ld c, e                 ; C = width (row/col already consumed)
.rows:
    push hl
    ld b, c
.cols:
    ld (hl), a
    inc hl
    djnz .cols
    pop hl
    push bc
    ld bc, 32
    add hl, bc              ; next attribute row
    pop bc
    dec d
    jr nz, .rows
    ret

; attr_rotate_row — slide a row of cells one cell right, wrapping the
; last back to the first. Call once per frame for a marquee effect.
; in:       B = row, C = col, E = width (2-32)
; clobbers: AF, BC, DE, HL
attr_rotate_row:
    call attr_addr
    push hl                 ; first cell
    ld d, 0
    dec e
    add hl, de              ; HL = last cell
    ld a, (hl)              ; the byte that wraps around
    ld b, d
    ld c, e                 ; BC = width-1 cells to move
    ld d, h
    ld e, l                 ; DE = last cell
    dec hl                  ; HL = last-1
    lddr                    ; slide everything one cell right
    pop hl
    ld (hl), a              ; wrapped byte enters at the left
    ret
