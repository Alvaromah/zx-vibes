; scroll-row-left demo — draw a block at the right edge of row y=64, scroll the
; row left 4 times (32 px), then idle HALT-synced. Proven by test.json.
    ORG 0x8000

start:
    ld sp, 0xFF00
    ld a, 2
    out (0xFE), a           ; observable border write

    ; draw a solid 8x8 block at pixel (248, 64): display file 0x481F, 8 lines
    ld hl, 0x481F
    ld b, 8
draw:
    ld (hl), 0xFF
    inc h                   ; +0x100 = next pixel line within the row
    djnz draw

    ; scroll the row left by one byte, four times
    ld c, 4
pass:
    ld d, 0x48              ; the row's first pixel line (y = 64)
    call scroll_row_left
    dec c
    jr nz, pass

    ld a, 0x2A              ; completion sentinel for the test
    ld (0x9000), a

    im 1
    ei
idle:
    halt
    jr idle

; scroll_row_left — one character row (8 lines, 32 cols), one byte (8 px) left.
; in: D = high byte of the row's first pixel line. Clobbers AF, BC, DE, HL.
scroll_row_left:
    ld b, 8
line:
    push bc
    push de
    ld h, d                 ; HL = src = line base + 1
    ld l, 1
    ld e, 0                 ; DE = dst = line base
    ld bc, 31
    ldir
    xor a
    ld (de), a              ; clear the vacated rightmost byte
    pop de
    inc d                   ; next pixel line
    pop bc
    djnz line
    ret
