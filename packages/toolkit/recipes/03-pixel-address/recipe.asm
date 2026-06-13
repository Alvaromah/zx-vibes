; ── recipe: pixel addressing ─────────────────────────────────────────
; The interleaved-bitmap address calculation, as code.

; pixel_addr — screen address + bit mask for pixel (x, y)
; in:       B = y (0-191), C = x (0-255)
; out:      HL = screen byte address, A = pixel mask (bit set)
; clobbers: AF, B
pixel_addr:
    ld a, b
    and 0xC0                ; which third (0/64/128)
    rrca
    rrca
    rrca
    or 0x40
    ld h, a
    ld a, b
    and 0x07                ; pixel line within the cell
    or h
    ld h, a                 ; H = 0x40 | third>>3 | (y&7)
    ld a, b
    and 0x38                ; char row within the third
    rlca
    rlca                    ; ×4 → (y&0x38)<<2
    ld l, a
    ld a, c
    rrca
    rrca
    rrca
    and 0x1F                ; x>>3 = byte within the line
    or l
    ld l, a
    ld a, c
    and 0x07                ; bit within the byte (sets Z for x%8==0)
    ld b, a
    ld a, 0x80
    ret z
.shift:
    rrca
    djnz .shift
    ret

; plot_pixel — set pixel (x, y)
; in:       B = y, C = x
; clobbers: AF, B, HL
plot_pixel:
    call pixel_addr
    or (hl)
    ld (hl), a
    ret
