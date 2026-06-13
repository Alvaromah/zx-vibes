; Demo: seed 0xACE1, take 16 values, store each low byte at 0x9000+.
; The expected bytes in test.json were computed independently from the
; algorithm — the Z80 and the model must agree exactly.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

buffer    EQU 0x9000
prng_seed EQU 0x9010

start:
    ld hl, 0xACE1
    ld (prng_seed), hl
    ld de, buffer
    ld b, 16
.fill:
    push bc
    push de
    call prng
    ld a, l
    pop de
    pop bc
    ld (de), a
    inc de
    djnz .fill

    ei
idle:
    halt
    jr idle

    INCLUDE "recipe.asm"
