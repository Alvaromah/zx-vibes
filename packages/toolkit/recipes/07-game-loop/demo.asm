; Demo: the full loop — a ship moved by QAOP with edge clamping,
; XOR-drawn with no trails, HALT-synced, acting every 2nd frame.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

XPOS equ 0xBF00
YPOS equ 0xBF01

start:
    ld a, 0x38
    call clear_screen
    ld a, 15
    ld (XPOS), a
    ld a, 12
    ld (YPOS), a
    call draw_player        ; first draw
    ei

main_loop:
    halt
    halt                    ; act every 2 frames (25Hz movement)
    call read_qaop
    or a
    jr z, main_loop         ; nothing pressed → keep waiting
    push af
    call draw_player        ; XOR at CURRENT position = erase
    pop af
    call move_player
    call draw_player        ; XOR at NEW position = draw
    jr main_loop

; move_player — apply QAOP bits in A with edge clamping
; clobbers: AF, B
move_player:
    ld b, a
    ld a, (XPOS)
    bit 0, b                ; right (P)
    jr z, .no_right
    cp 31
    jr nc, .no_right
    inc a
.no_right:
    bit 1, b                ; left (O)
    jr z, .no_left
    or a
    jr z, .no_left
    dec a
.no_left:
    ld (XPOS), a
    ld a, (YPOS)
    bit 2, b                ; down (A)
    jr z, .no_down
    cp 23
    jr nc, .no_down
    inc a
.no_down:
    bit 3, b                ; up (Q)
    jr z, .no_up
    or a
    jr z, .no_up
    dec a
.no_up:
    ld (YPOS), a
    ret

draw_player:
    ld a, (YPOS)
    ld b, a
    ld a, (XPOS)
    ld c, a
    ld de, ship
    jp sprite_xor_8x8

ship:
    db 0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18

    INCLUDE "../01-clear-screen/recipe.asm"
    INCLUDE "../04-sprite-xor-8x8/recipe.asm"
    INCLUDE "../06-keyboard-qaop/recipe.asm"
