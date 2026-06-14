; Demo: play a zap on a blue border, then settle into a HALT-synced idle.
; Headless zxs has no audio out, but it reports beeper edges. The test asserts
; that the effect toggles sound, terminates, preserves the border, and idles.
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
