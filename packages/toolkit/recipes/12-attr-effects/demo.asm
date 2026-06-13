; Demo: a 16-cell marquee bar at row 10. The bar is red paper with one
; cyan "runner" cell that circles it, one cell per frame — pure attribute
; writes, the bitmap never changes.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 0x38
    call clear_screen

    ld b, 10                ; the bar: row 10, cols 8-23
    ld c, 8
    ld d, 1
    ld e, 16
    ld a, 0x50              ; red paper, black ink
    call attr_fill_rect

    ld b, 10                ; the runner starts at the left end
    ld c, 8
    call attr_addr
    ld (hl), 0x68           ; bright cyan paper

    ei
loop:
    halt
    ld b, 10
    ld c, 8
    ld e, 16
    call attr_rotate_row
    jr loop

    INCLUDE "recipe.asm"
    INCLUDE "../01-clear-screen/recipe.asm"
