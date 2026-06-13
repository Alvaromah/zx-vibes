; ── recipe: XOR sprite, 8x8, cell-aligned ────────────────────────────
; XOR drawing: drawing the same sprite at the same position ERASES it.
; The no-trails movement contract: XOR(old pos) → update pos → XOR(new pos).

; cell_addr — screen address of character cell (row, col), first pixel line
; in:       B = row (0-23), C = col (0-31)
; out:      HL = screen address
; clobbers: AF
cell_addr:
    ld a, b
    and 0x18                ; which third
    or 0x40
    ld h, a
    ld a, b
    and 0x07                ; row within third
    rrca
    rrca
    rrca                    ; ×32 into the top of L
    or c
    ld l, a
    ret

; sprite_xor_8x8 — XOR an 8x8 sprite onto cell (row, col)
; in:       B = row (0-23), C = col (0-31), DE = sprite (8 bytes)
; clobbers: AF, B, DE, HL
sprite_xor_8x8:
    call cell_addr
    ld b, 8
.lines:
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc h                   ; next pixel line within the cell
    djnz .lines
    ret
