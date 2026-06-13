; Disassembler round-trip corpus: assemble → disassemble → reassemble must
; be byte-identical. Covers every decode group with documented instructions
; (plus the common undocumented IXH/IXL and DDCB copy forms).
; Excluded by design: ED-prefixed LD (nn),HL / LD HL,(nn) (redundant long
; encodings sjasmplus never emits) and IN (C)/OUT (C),0/SLL syntax variants.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    nop
    ex af, af'
    djnz start
    jr start
    jr nz, start
    jr c, forward
forward:
    ld bc, 0x1234
    ld de, 0x5678
    ld hl, 0x9ABC
    ld sp, 0xFF00
    add hl, bc
    add hl, sp
    ld (bc), a
    ld a, (bc)
    ld (de), a
    ld a, (de)
    ld (0x9000), hl
    ld hl, (0x9000)
    ld (0x9001), a
    ld a, (0x9001)
    inc bc
    dec sp
    inc b
    dec (hl)
    ld c, 0x42
    ld (hl), 0x55
    rlca
    rrca
    rla
    rra
    daa
    cpl
    scf
    ccf
    ld b, c
    ld d, (hl)
    ld (hl), e
    halt
    add a, b
    adc a, (hl)
    sub l
    sbc a, a
    and h
    xor (hl)
    or e
    cp d
    ret nz
    ret m
    pop bc
    pop af
    ret
    exx
    jp (hl)
    ld sp, hl
    jp z, 0x8000
    jp 0x8000
    out (0xFE), a
    in a, (0xFE)
    ex (sp), hl
    ex de, hl
    di
    ei
    call pe, 0x8000
    call 0x8000
    push de
    push af
    add a, 0x12
    xor 0x34
    cp 0x56
    rst 0x00
    rst 0x38
; ── CB page ──
    rlc b
    rrc (hl)
    rl c
    rr d
    sla e
    sra h
    srl a
    bit 0, a
    bit 7, (hl)
    res 3, c
    set 6, (hl)
; ── ED page ──
    in a, (c)
    in b, (c)
    out (c), a
    out (c), d
    sbc hl, bc
    adc hl, sp
    ld (0x9002), bc
    ld de, (0x9004)
    ld (0x9006), sp
    neg
    retn
    reti
    im 0
    im 1
    im 2
    ld i, a
    ld r, a
    ld a, i
    ld a, r
    rrd
    rld
    ldi
    ldir
    cpd
    cpdr
    ini
    otir
; ── DD/FD pages ──
    ld ix, 0x1234
    ld iy, 0x5678
    add ix, bc
    add iy, sp
    inc ix
    dec iy
    ld (0x9008), ix
    ld iy, (0x900A)
    inc (ix+0x05)
    dec (iy-0x05)
    ld (ix+0x10), 0x42
    ld a, (ix+0x7F)
    ld h, (ix+0x05)
    ld (iy-0x10), b
    add a, (ix+0x01)
    cp (iy-0x01)
    ex (sp), ix
    push ix
    pop iy
    jp (ix)
    ld sp, iy
    ld ixh, 0x12
    ld ixl, 0x34
    ld a, ixh
    inc iyl
; ── DDCB/FDCB ──
    rlc (ix+0x05)
    bit 3, (ix-0x05)
    res 2, (iy+0x10)
    set 7, (iy-0x7F)
    rl (ix+0x05), b
    set 0, (iy+0x02), c
