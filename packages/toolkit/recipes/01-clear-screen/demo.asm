; Demo: clear the screen to cyan paper, then idle HALT-synced.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 0x28              ; ink 0, paper 5 (cyan)
    call clear_screen
    ei
idle:
    halt
    jr idle

    INCLUDE "recipe.asm"
