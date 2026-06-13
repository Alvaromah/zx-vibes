; Demo: play a zap on a blue border, then settle into a HALT-synced idle.
; Headless zxs has no audio out — what the test asserts is the contract:
; the effect terminates, the border survives, and the loop stays healthy.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

done_flag EQU 0x9000

start:
    xor a
    ld (done_flag), a
    ld a, 1
    out (0xFE), a           ; blue border
    ld c, 1                 ; keep it blue through the effect
    call fx_zap
    ld a, 1
    ld (done_flag), a       ; the effect returned
    ei
idle:
    halt
    jr idle

    INCLUDE "recipe.asm"
