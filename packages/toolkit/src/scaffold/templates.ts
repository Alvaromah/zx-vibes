// packages/toolkit/src/scaffold/templates.ts — GENERATED, DO NOT EDIT BY HAND.
//
// Byte-faithful scaffold template content backing `zxs new` (scaffold.ts). Generated from
// starters/ by `pnpm run gen:scaffold-templates` and pinned by `pnpm run check:templates`
// (part of check:drift). The npm package ships only bin/dist/assets, so template content
// must be embedded here rather than read from starters/ at runtime.
//
// Source of truth is starters/: edit the starter, then regenerate. `__NAME__` in a
// main.asm header is substituted with the project name by the scaffold.

export const LIB_SCREEN_ASM = `; lib/screen.asm — screen primitives (from the Spectral recipes, CI-tested)

; clear_screen — clear the bitmap and flood the attributes
; in:       A = attribute byte (e.g. 0x38 = black ink on white paper)
; clobbers: AF, BC, DE, HL
clear_screen:
    push af
    ld hl, 0x4000
    ld de, 0x4001
    ld bc, 0x17FF
    ld (hl), 0
    ldir
    pop af
    ld hl, 0x5800
    ld de, 0x5801
    ld bc, 0x02FF
    ld (hl), a
    ldir
    ret

; cell_addr — screen address of character cell (row, col), first pixel line
; in:       B = row (0-23), C = col (0-31)
; out:      HL = screen address
; clobbers: AF
cell_addr:
    ld a, b
    and 0x18
    or 0x40
    ld h, a
    ld a, b
    and 0x07
    rrca
    rrca
    rrca
    or c
    ld l, a
    ret

; sprite_xor_8x8 — XOR an 8x8 sprite onto cell (row, col).
; XOR twice at the same spot = erase. Movement: XOR(old), update, XOR(new).
; in:       B = row, C = col, DE = sprite (8 bytes)
; clobbers: AF, B, DE, HL
sprite_xor_8x8:
    call cell_addr
    ld b, 8
.lines:
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc h
    djnz .lines
    ret

; attr_addr — attribute address of cell (row, col)
; in:       B = row, C = col
; out:      HL
; clobbers: AF
attr_addr:
    ld a, b
    rrca
    rrca
    rrca                    ; row*32 across H/L
    ld l, a
    and 0x03
    or 0x58
    ld h, a
    ld a, l
    and 0xE0
    or c
    ld l, a
    ret
`;

export const LIB_KEYS_ASM = `; lib/keys.asm — input (from the Spectral recipes, CI-tested)

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
`;

export const GAME_MAIN_ASM = `; __NAME__ — ZX Spectrum 48K
; A working skeleton: ship moves with QAOP, HALT-synced, no trails.
; Edit running code — after EVERY change: zxs build src/main.asm && zxs run
    DEVICE ZXSPECTRUM48
    ORG 0x8000

XPOS equ 0xBF00             ; player column, in character cells (0-24; sprite is 8 cells wide)
YPOS equ 0xBF01             ; player row, in character cells (0-16; sprite is 8 cells tall)

start:
    ld a, 0x38              ; black ink on white paper
    call clear_screen
    ld a, 12                ; centered: (32-8)/2
    ld (XPOS), a
    ld a, 8                 ; centered: (24-8)/2
    ld (YPOS), a
    call draw_player
    ei                      ; interrupts ON before any HALT

main_loop:
    halt                    ; frame sync (50Hz)
    halt                    ; act every 2nd frame (25Hz movement)
    call read_qaop          ; A = input bits, Z if nothing pressed
    or a
    jr z, main_loop
    push af
    call draw_player        ; XOR at current position = erase
    pop af
    call move_player
    call draw_player        ; XOR at new position = draw
    jr main_loop

; move_player — apply QAOP bits in A, clamped to the screen edges
; (the ship is 8x8 cells, so XPOS/YPOS max out 8 cells short of the screen edge)
; clobbers: AF, B
move_player:
    ld b, a
    ld a, (XPOS)
    bit 0, b                ; P = right
    jr z, .no_right
    cp 24
    jr nc, .no_right
    inc a
.no_right:
    bit 1, b                ; O = left
    jr z, .no_left
    or a
    jr z, .no_left
    dec a
.no_left:
    ld (XPOS), a
    ld a, (YPOS)
    bit 2, b                ; A = down
    jr z, .no_down
    cp 16
    jr nc, .no_down
    inc a
.no_down:
    bit 3, b                ; Q = up
    jr z, .no_up
    or a
    jr z, .no_up
    dec a
.no_up:
    ld (YPOS), a
    ret

; draw_player — XOR the 64x64 (8x8-cell) ship at (XPOS,YPOS)
draw_player:
    ld de, ship_gfx
    jp sprite_xor_64x64

; sprite_xor_64x64 — XOR an 8x8-cell (64x64 px) sprite at cell (YPOS,XPOS).
; in:       DE = sprite data, 64 scanlines x 8 bytes, top to bottom.
; Fast enough to erase + redraw well within one 69888-T frame (a draw that
; straddles the frame boundary is visible as flicker: the display refresh
; catches the sprite half-drawn — on real hardware and in the preview alike).
; One cell_addr per cell row; within a scanline the 8 bytes are consecutive
; (INC L never carries: the column bits live in L's low 5 bits and X <= 24+7).
; clobbers: AF, BC, DE, HL
sprite_xor_64x64:
    ld a, (YPOS)
    ld b, a                 ; B = current cell row
.row_loop:
    ld a, (XPOS)
    ld c, a                 ; C = leftmost cell column
    push bc
    call cell_addr          ; HL = screen address of (B,C), pixel line 0
    ld b, 8                 ; 8 scanlines per cell row
.line_loop:
    push hl
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    inc l
    ld a, (de)
    xor (hl)
    ld (hl), a
    inc de
    pop hl
    inc h                   ; next scanline within the cell row
    djnz .line_loop
    pop bc
    inc b                   ; next cell row
    ld a, (YPOS)
    add a, 8
    cp b
    jr nz, .row_loop
    ret

ship_gfx:
; 64x64 ship, scaled 8x from the original 8x8 diamond: 64 scanlines x 8 bytes.
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 0
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 1
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 2
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 3
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 4
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 5
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 6
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 7
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 8
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 9
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 10
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 11
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 12
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 13
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 14
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 15
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 16
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 17
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 18
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 19
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 20
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 21
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 22
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 23
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 24
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 25
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 26
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 27
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 28
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 29
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 30
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 31
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 32
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 33
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 34
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 35
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 36
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 37
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 38
    db 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  ; line 39
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 40
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 41
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 42
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 43
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 44
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 45
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 46
    db 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00  ; line 47
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 48
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 49
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 50
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 51
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 52
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 53
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 54
    db 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00  ; line 55
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 56
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 57
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 58
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 59
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 60
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 61
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 62
    db 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00  ; line 63

    INCLUDE "../lib/screen.asm"
    INCLUDE "../lib/keys.asm"
`;

export const PLATFORMER_MAIN_ASM = `; __NAME__ - ZX Spectrum 48K platformer starter
; Controls: O/P move, SPACE jumps.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

XPOS    equ 0xBF00          ; player column (0-31)
YPOS    equ 0xBF01          ; player row (0-23)
ONGROUND equ 0xBF02         ; 1 when standing on the platform
JUMPED  equ 0xBF03          ; test-visible flag set after SPACE jump
INPUT   equ 0xBF04          ; latest input bits

GROUND_ROW equ 21
PLAYER_GROUND_Y equ 18

start:
    ld a, 0x38              ; black ink on white paper
    call clear_screen
    call draw_ground
    ld a, 6
    ld (XPOS), a
    ld a, PLAYER_GROUND_Y
    ld (YPOS), a
    ld a, 1
    ld (ONGROUND), a
    xor a
    ld (JUMPED), a
    call draw_player
    ei

main_loop:
    halt
    call read_qaop          ; A bits: P,O,A,Q,SPACE
    ld (INPUT), a
    call draw_player        ; erase old player
    ld a, (INPUT)
    ld b, a
    call move_horizontal
    ld a, (INPUT)
    ld b, a
    call jump_or_gravity
    call draw_player        ; draw new player
    jr main_loop

; move_horizontal - O/P movement clamped to the screen.
; in: B = input bits
; clobbers: AF
move_horizontal:
    ld a, (XPOS)
    bit 0, b                ; P = right
    jr z, .no_right
    cp 31
    jr nc, .no_right
    inc a
.no_right:
    bit 1, b                ; O = left
    jr z, .no_left
    or a
    jr z, .no_left
    dec a
.no_left:
    ld (XPOS), a
    ret

; jump_or_gravity - simple cell-based jump arc.
; in: B = input bits
; clobbers: AF
jump_or_gravity:
    bit 4, b                ; SPACE
    jr z, .gravity
    ld a, (ONGROUND)
    or a
    jr z, .gravity
    xor a
    ld (ONGROUND), a
    ld a, 1
    ld (JUMPED), a
    ld a, (YPOS)
    sub 3
    ld (YPOS), a
    ret
.gravity:
    ld a, (ONGROUND)
    or a
    ret nz
    ld a, (YPOS)
    cp PLAYER_GROUND_Y
    jr nc, .land
    inc a
    ld (YPOS), a
    ret
.land:
    ld a, PLAYER_GROUND_Y
    ld (YPOS), a
    ld a, 1
    ld (ONGROUND), a
    ret

draw_player:
    ld a, (YPOS)
    ld b, a
    ld a, (XPOS)
    ld c, a
    ld de, player_gfx
    jp sprite_xor_8x8

draw_ground:
    ld b, GROUND_ROW
    ld c, 0
.loop:
    push bc
    ld de, ground_gfx
    call sprite_xor_8x8
    pop bc
    inc c
    ld a, c
    cp 32
    jr nz, .loop
    ret

player_gfx:
    db 0x18, 0x3C, 0x7E, 0xDB, 0xFF, 0x24, 0x66, 0xC3

ground_gfx:
    db 0xFF, 0x81, 0xBD, 0xA5, 0xA5, 0xBD, 0x81, 0xFF

    INCLUDE "../lib/screen.asm"
    INCLUDE "../lib/keys.asm"
`;

export const GAME_SMOKE_TEST_JSON = `{
  "build": "../src/main.asm",
  "frames": 150,
  "keys": "10:P*60",
  "assert": [
    { "type": "status", "equals": "ok" },
    { "type": "haltSynced", "equals": true },
    { "type": "screenChanged", "equals": true },
    { "type": "cellsNonBlank", "min": 1 },
    { "type": "pixelAt", "x": 251, "y": 99, "set": true },
    { "type": "pixelAt", "x": 123, "y": 99, "set": false }
  ]
}
`;

export const PLATFORMER_SMOKE_TEST_JSON = `{
  "build": "../src/main.asm",
  "frames": 100,
  "keys": "10:P*60,20:SPACE*5",
  "assert": [
    { "type": "status", "equals": "ok" },
    { "type": "haltSynced", "equals": true },
    { "type": "screenChanged", "equals": true },
    { "type": "cellsNonBlank", "min": 30 },
    { "type": "memEquals", "addr": "0xBF00", "hex": "1F" },
    { "type": "memEquals", "addr": "0xBF03", "hex": "01" }
  ]
}
`;

