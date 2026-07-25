; tile-collision demo — a walker steps right through a one-row cell map and must
; stop flush against the wall cell, proving the probe-before-step pattern.
    ORG 0x8000

LEVELMAP EQU 0xA000         ; 32 cells, one byte each: 0 = empty, 1 = solid
WALL_COL EQU 20

start:
    ld sp, 0xFF00
    ld a, 2
    out (0xFE), a           ; observable border write

    ; build the map: 32 empty cells, then plant the wall
    ld hl, LEVELMAP
    ld b, 32
    xor a
clr:
    ld (hl), a
    inc hl
    djnz clr
    ld a, 1
    ld (LEVELMAP+WALL_COL), a

    ; paint the wall cell red at attribute row 8 (0x5800 + 8*32 + col)
    ld a, 0x12              ; red paper, red ink
    ld (0x5800 + 8*32 + WALL_COL), a

    ; walker: start at column 2, step right while the NEXT cell is empty
    ld a, 2
    ld (0x9001), a
walk:
    ld a, (0x9001)
    inc a                   ; candidate column
    ld c, a
    call map_solid
    jr nz, blocked          ; next cell solid -> stay put
    ld a, (0x9001)
    inc a
    ld (0x9001), a
    jr walk

blocked:
    ; paint the walker's final cell cyan on the same row
    ld a, (0x9001)
    ld l, a
    ld h, 0
    ld de, 0x5800 + 8*32
    add hl, de
    ld (hl), 0x28           ; cyan paper

    ld a, 0x2A              ; completion sentinel for the test
    ld (0x9000), a

    im 1
    ei
idle:
    halt
    jr idle

; map_solid — is map cell C (0..31) solid?  NZ = solid, Z = empty.
; in: C = column. Clobbers A, HL, DE.
map_solid:
    ld l, c
    ld h, 0
    ld de, LEVELMAP
    add hl, de
    ld a, (hl)
    or a
    ret
