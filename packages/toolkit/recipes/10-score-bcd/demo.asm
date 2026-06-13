; Demo: 25 + 99 + 99 = 223 points, printed as SCORE 000223.
; The two DAA carries (25+99 → 124 → +99 → 223) cross the byte boundary.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    call print_init
    ld hl, msg
    call print_string

    xor a
    ld (score), a
    ld (score+1), a
    ld (score+2), a
    ld a, 0x25
    call score_add
    ld a, 0x99
    call score_add
    ld a, 0x99
    call score_add
    call score_print

    ei
idle:
    halt
    jr idle

msg:
    db 22, 2, 4             ; AT 2,4
    db "SCORE ", 0

score EQU 0x9000            ; fixed address so the test can inspect it
                            ; (in a game: `score: db 0,0,0` works the same)

    INCLUDE "recipe.asm"
    INCLUDE "../02-print-rom/recipe.asm"
