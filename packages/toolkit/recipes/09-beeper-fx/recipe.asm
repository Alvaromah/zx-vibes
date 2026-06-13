; ── recipe: beeper sound effects ─────────────────────────────────────
; Bit 4 of port 0xFE drives the speaker; bits 0-2 set the border. A tone
; is just toggling bit 4 at a steady period — and every OUT must carry
; your border color or the border flickers with the music.
; The CPU is busy for the whole effect: play SFX at moments where the
; game can stall for a frame or two (or keep them very short).

; beep — square-wave tone (busy-wait)
; in:       C = border color 0-7 (kept steady during the beep)
;           B = half-period in delay units (~13 T-states each; bigger = lower)
;           DE = number of half-periods (length; even count leaves the
;                speaker bit where it started)
; clobbers: AF, DE (B and the border bits of C are preserved)
beep:
.half:
    ld a, c
    xor 0x10                ; toggle the speaker bit...
    ld c, a
    out (0xFE), a           ; ...keeping the border bits
    push bc
.delay:
    djnz .delay
    pop bc
    dec de
    ld a, d
    or e
    jr nz, .half
    ret

; fx_zap — laser zap: fast downward pitch sweep (~1.5 frames long)
; in:       C = border color 0-7
; clobbers: AF, B, DE
fx_zap:
    ld b, 8                 ; start high (short half-period)
.step:
    push bc
    ld de, 16               ; 8 full waves per step
    call beep
    pop bc
    ld a, b
    add a, 8                ; lengthen the period = drop the pitch
    ld b, a
    cp 80
    jr c, .step
    ret
