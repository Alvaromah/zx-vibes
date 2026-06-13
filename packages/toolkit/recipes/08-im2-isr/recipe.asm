; ── recipe: IM2 interrupt setup ──────────────────────────────────────
; The full IM2 ritual. ALL pieces are required — any one missing means
; random crashes at the next frame interrupt
; (docs/reference/interrupts-and-timing.md):
;   · 257-byte vector table, page-aligned, uniformly filled
;   · I = table page, IM 2
;   · the two bytes at the vector address hold the ISR address
;   · the ISR preserves every register it touches and ends EI + RETI
;
; This recipe builds the table at run time: page 0xFE filled with 0xFD,
; so every possible bus value vectors through 0xFDFD, where a JP to your
; `isr` label is planted. Keep 0xFD00-0xFF00 free of code and data.

; im2_init — install the vector table for `isr` (defined by YOU), IM 2 + EI
; clobbers: AF, BC, DE, HL
im2_init:
    di
    ld hl, 0xFE00
    ld de, 0xFE01
    ld bc, 256
    ld (hl), 0xFD
    ldir                    ; 257 bytes of 0xFD: 0xFE00-0xFF00 inclusive
    ld a, 0xC3              ; JP opcode
    ld (0xFDFD), a
    ld hl, isr
    ld (0xFDFE), hl
    ld a, 0xFE
    ld i, a
    im 2
    ei
    ret

; Skeleton for your ISR (copy into your code):
;
; isr:
;     push af                 ; save EVERYTHING you touch
;     push hl
;     ; ... your once-per-frame work (music, timers, input sampling) ...
;     pop hl
;     pop af
;     ei                      ; re-arm before returning
;     reti
