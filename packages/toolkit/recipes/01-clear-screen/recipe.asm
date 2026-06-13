; ── recipe: clear_screen ─────────────────────────────────────────────
; Clears the pixel bitmap and floods every attribute cell.
; in:       A = attribute byte (e.g. 0x38 = black ink on white paper)
; clobbers: AF, BC, DE, HL
clear_screen:
    push af
    ld hl, 0x4000
    ld de, 0x4001
    ld bc, 0x17FF
    ld (hl), 0
    ldir                    ; bitmap: 6144 bytes of 0
    pop af
    ld hl, 0x5800
    ld de, 0x5801
    ld bc, 0x02FF
    ld (hl), a
    ldir                    ; attributes: 768 bytes of A
    ret
