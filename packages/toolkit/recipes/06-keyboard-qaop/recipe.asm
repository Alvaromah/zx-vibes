; ── recipe: QAOP+Space input ─────────────────────────────────────────
; Reads the classic control keys into one byte. Remember: the keyboard
; matrix is ACTIVE-LOW — this routine already does the CPL for you.

; read_qaop — current state of Q/A/O/P/SPACE
; out:      A = bit 0: P (right) · bit 1: O (left) · bit 2: A (down)
;               bit 3: Q (up)    · bit 4: SPACE (fire)
;           Z flag set if nothing is pressed
; clobbers: AF, BC, D
read_qaop:
    ld bc, 0xDFFE           ; P,O,I,U,Y half-row
    in a, (c)
    cpl
    and 0x03                ; bit0 = P, bit1 = O
    ld d, a
    ld b, 0xFD              ; A,S,D,F,G half-row
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca                    ; → bit 2 (down)
    or d
    ld d, a
    ld b, 0xFB              ; Q,W,E,R,T half-row
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca
    rlca                    ; → bit 3 (up)
    or d
    ld d, a
    ld b, 0x7F              ; SPACE,SYM,M,N,B half-row
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca
    rlca
    rlca                    ; → bit 4 (fire)
    or d                    ; final OR sets Z when nothing pressed
    ret
