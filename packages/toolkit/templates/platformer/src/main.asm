; __NAME__ - ZX Spectrum 48K platformer starter
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
