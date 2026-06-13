; ── recipe: BCD score ────────────────────────────────────────────────
; Keep the score in BCD — two decimal digits per byte. ADD + DAA does the
; decimal carry, printing is a nibble split: no division anywhere.
;
; You define the storage (3 bytes little-endian = 6 digits, 000000-999999):
;     score: db 0, 0, 0
; Amounts are written in hex that LOOKS decimal: 0x25 adds 25 points.

; score_add — add a BCD amount to the 6-digit score
; in:       A = amount, BCD 0x00-0x99
; clobbers: AF, B, HL
score_add:
    ld hl, score
    add a, (hl)
    daa                     ; decimal-adjust, sets carry past 99
    ld (hl), a
    ld b, 2
.carry:
    inc hl
    ld a, (hl)
    adc a, 0                ; ripple the decimal carry up
    daa
    ld (hl), a
    djnz .carry             ; DJNZ preserves the carry flag
    ret

; score_print — print the 6 digits at the current print position
; (position with an AT control code first; needs print_init from
; 02-print-rom once at startup)
; in:       none (reads `score`)
; clobbers: AF, BC, HL (+ROM clobbers)
score_print:
    ld hl, score+2          ; most significant byte first
    ld b, 3
.bytes:
    ld a, (hl)
    push bc
    push hl
    push af
    rrca
    rrca
    rrca
    rrca
    call .digit             ; high nibble
    pop af
    call .digit             ; low nibble
    pop hl
    pop bc
    dec hl
    djnz .bytes
    ret
.digit:
    and 0x0F
    add a, '0'
    rst 0x10                ; PRINT-A
    ret
