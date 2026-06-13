; ── recipe: ROM printing ─────────────────────────────────────────────
; Prints via the ROM: needs IY = 0x5C3A (true unless you clobbered it)
; and benefits from interrupts enabled.

; print_init — route RST 0x10 output to the main screen. Call ONCE at start.
; clobbers: AF (+ROM internals)
print_init:
    ld a, 2                 ; channel 2 = upper screen
    call 0x1601             ; CHAN-OPEN
    ret

; print_string — print a zero-terminated string. Strings may embed control
; codes: 22,y,x = AT · 16,n = INK · 17,n = PAPER · 19,1 = BRIGHT · 13 = CR
; in:       HL = string address
; clobbers: AF, HL (+ROM clobbers)
print_string:
.loop:
    ld a, (hl)
    or a
    ret z
    push hl
    rst 0x10                ; PRINT-A
    pop hl
    inc hl
    jr .loop
