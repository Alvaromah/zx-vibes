; lib/keys.asm — input (from the Spectral recipes, CI-tested)

; read_qaop — current state of Q/A/O/P/SPACE (active-low CPL already done)
; out:      A = bit 0: P (right) · bit 1: O (left) · bit 2: A (down)
;               bit 3: Q (up)    · bit 4: SPACE (fire)
;           Z flag set if nothing pressed
; clobbers: AF, BC, D
read_qaop:
    ld bc, 0xDFFE
    in a, (c)
    cpl
    and 0x03
    ld d, a
    ld b, 0xFD
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca
    or d
    ld d, a
    ld b, 0xFB
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca
    rlca
    or d
    ld d, a
    ld b, 0x7F
    in a, (c)
    cpl
    and 0x01
    rlca
    rlca
    rlca
    rlca
    or d
    ret
