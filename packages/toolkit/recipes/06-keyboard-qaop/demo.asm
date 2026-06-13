; Demo: border turns red while P is held, blue while O is held.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ei
loop:
    halt
    call read_qaop
    bit 0, a                ; P = right
    jr z, check_left
    ld a, 2                 ; red border
    out (0xFE), a
    jr loop
check_left:
    bit 1, a                ; O = left
    jr z, loop
    ld a, 1                 ; blue border
    out (0xFE), a
    jr loop

    INCLUDE "recipe.asm"
