; Demo: draw at (5,5), erase by XOR-ing again, redraw at (5,10).
; Result: sprite visible ONLY at the new position — no trails.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 0x38
    call clear_screen

    ld b, 5
    ld c, 5
    ld de, ball
    call sprite_xor_8x8     ; draw at (5,5)

    ld b, 5
    ld c, 5
    ld de, ball
    call sprite_xor_8x8     ; XOR again = erase

    ld b, 5
    ld c, 10
    ld de, ball
    call sprite_xor_8x8     ; draw at the new position

    ei
idle:
    halt
    jr idle

ball:
    db 0x3C, 0x7E, 0xFF, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C

    INCLUDE "recipe.asm"
    INCLUDE "../01-clear-screen/recipe.asm"
