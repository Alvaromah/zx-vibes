; Demo: plot a 128-pixel diagonal — crosses the y=64 third boundary,
; which is exactly where naive (non-interleaved) math breaks.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 0x38
    call clear_screen
    ld d, 0
diag:
    ld b, d                 ; y = d
    ld c, d                 ; x = d
    call plot_pixel
    inc d
    ld a, d
    cp 128
    jr nz, diag
    ei
idle:
    halt
    jr idle

    INCLUDE "recipe.asm"
    INCLUDE "../01-clear-screen/recipe.asm"
