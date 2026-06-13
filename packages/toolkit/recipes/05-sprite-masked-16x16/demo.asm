; Demo: paint a striped background, then draw a masked sprite on top.
; The mask cuts a clean halo: background survives outside, disappears
; in the halo, and the sprite body is solid — no XOR transparency.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 0x38
    call clear_screen

    ; striped background: cells rows 4-7, cols 4-7 filled with 0xAA
    ld d, 4                 ; cell row
.bg_rows:
    push de
    ld b, d
    ld c, 4
    call cell_addr
    ld b, 8
.bg_lines:
    ld a, 0xAA
    ld (hl), a
    inc l
    ld (hl), a
    inc l
    ld (hl), a
    inc l
    ld (hl), a
    dec l
    dec l
    dec l
    inc h
    djnz .bg_lines
    pop de
    inc d
    ld a, d
    cp 8
    jr nz, .bg_rows

    ld b, 5                 ; sprite block: cells (5-6, 5-6) = pixels 40-55
    ld c, 5
    ld de, box
    call sprite_masked_16x16

    ei
idle:
    halt
    jr idle

; 8x8 solid box centered in the 16x16 frame, mask cuts a 10x10 hole:
; lines 0-2 and 13-15 keep the screen; lines 3-12 keep only the outer
; 3 pixels each side. Per line: maskL, dataL, maskR, dataR.
box:
    db 0xFF, 0x00, 0xFF, 0x00   ; line 0
    db 0xFF, 0x00, 0xFF, 0x00   ; line 1
    db 0xFF, 0x00, 0xFF, 0x00   ; line 2
    db 0xE0, 0x00, 0x07, 0x00   ; line 3  (halo only)
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 4  ┐
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 5  │
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 6  │
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 7  │ solid 8x8 body
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 8  │
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 9  │
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 10 │
    db 0xE0, 0x0F, 0x07, 0xF0   ; line 11 ┘
    db 0xE0, 0x00, 0x07, 0x00   ; line 12 (halo only)
    db 0xFF, 0x00, 0xFF, 0x00   ; line 13
    db 0xFF, 0x00, 0xFF, 0x00   ; line 14
    db 0xFF, 0x00, 0xFF, 0x00   ; line 15

    INCLUDE "recipe.asm"
    INCLUDE "../01-clear-screen/recipe.asm"
    INCLUDE "../04-sprite-xor-8x8/recipe.asm"   ; for cell_addr
