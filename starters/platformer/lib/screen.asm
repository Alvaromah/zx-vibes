; lib/screen.asm — screen primitives (from the Spectral recipes, CI-tested)

; clear_screen — clear the bitmap and flood the attributes
; in:       A = attribute byte (e.g. 0x38 = black ink on white paper)
; clobbers: AF, BC, DE, HL
clear_screen:
    push af
    ld hl, 0x4000
    ld de, 0x4001
    ld bc, 0x17FF
    ld (hl), 0
    ldir
    pop af
    ld hl, 0x5800
    ld de, 0x5801
    ld bc, 0x02FF
    ld (hl), a
    ldir
    ret

; cell_addr — screen address of character cell (row, col), first pixel line
; in:       B = row (0-23), C = col (0-31)
; out:      HL = screen address
; clobbers: AF
cell_addr:
    ld a, b
    and 0x18
    or 0x40
    ld h, a
    ld a, b
    and 0x07
    rrca
    rrca
    rrca
    or c
    ld l, a
    ret

; sprite_xor_8x8 — XOR an 8x8 sprite onto cell (row, col).
; XOR twice at the same spot = erase. Movement: XOR(old), update, XOR(new).
; in:       B = row, C = col, DE = sprite (8 bytes)
; clobbers: AF, B, DE, HL
sprite_xor_8x8:
    call cell_addr
    ld b, 8
.lines:
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc h
    djnz .lines
    ret

; attr_addr — attribute address of cell (row, col)
; in:       B = row, C = col
; out:      HL
; clobbers: AF
attr_addr:
    ld a, b
    rrca
    rrca
    rrca                    ; row*32 across H/L
    ld l, a
    and 0x03
    or 0x58
    ld h, a
    ld a, l
    and 0xE0
    or c
    ld l, a
    ret
