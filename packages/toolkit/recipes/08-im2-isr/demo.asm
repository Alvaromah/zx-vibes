; Demo: IM2 ISR counts frames into a 16-bit counter at 0x9000 while the
; main loop just HALTs — proof the ISR runs exactly once per frame.
; After an N-frame run the counter reads N-1: zxs stops right after the
; Nth interrupt is ACCEPTED, before the ISR body has run.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

frame_count EQU 0x9000

start:
    ld hl, 0
    ld (frame_count), hl
    call im2_init
main:
    halt
    jr main

isr:
    push af
    push hl
    ld hl, (frame_count)
    inc hl
    ld (frame_count), hl
    pop hl
    pop af
    ei
    reti

    INCLUDE "recipe.asm"
