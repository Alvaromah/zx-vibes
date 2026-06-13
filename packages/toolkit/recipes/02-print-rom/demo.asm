; Demo: print a score line at row 2, column 4 via ROM routines.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    call print_init
    ld hl, msg
    call print_string
    ei
idle:
    halt
    jr idle

msg:
    db 22, 2, 4             ; AT 2,4
    db "SCORE 0100", 0

    INCLUDE "recipe.asm"
