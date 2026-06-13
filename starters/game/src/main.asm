; __NAME__ — ZX Spectrum 48K
; A working skeleton: ship moves with QAOP, HALT-synced, no trails.
; Edit running code — after EVERY change: zxs build src/main.asm && zxs run
    DEVICE ZXSPECTRUM48
    ORG 0x8000

XPOS equ 0xBF00             ; player column (0-31)
YPOS equ 0xBF01             ; player row (0-23)

start:
    ld a, 0x38              ; black ink on white paper
    call clear_screen
    ld a, 15
    ld (XPOS), a
    ld a, 12
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
; clobbers: AF, B
move_player:
    ld b, a
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
    ld a, (YPOS)
    bit 2, b                ; A = down
    jr z, .no_down
    cp 23
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

draw_player:
    ld a, (YPOS)
    ld b, a
    ld a, (XPOS)
    ld c, a
    ld de, ship_gfx
    jp sprite_xor_8x8

ship_gfx:
    db 0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18

    INCLUDE "../lib/screen.asm"
    INCLUDE "../lib/keys.asm"
