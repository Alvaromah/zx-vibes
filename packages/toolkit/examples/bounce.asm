; bounce.asm — a cell-aligned ball bouncing around the screen.
; HALT-synced loop (healthy per the watchdog), moves every 2 frames.
; The Phase 1 demo: run it, observe with `zxs screen --text`, resume the
; session with another `zxs run` and watch the ball position change.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

XPOS    equ 0xBF00
YPOS    equ 0xBF01
DX      equ 0xBF02
DY      equ 0xBF03

start:
    di
    ; clear the pixel bitmap
    ld hl, 0x4000
    ld de, 0x4001
    ld bc, 0x17FF
    ld (hl), 0
    ldir
    ; black ink on white paper everywhere
    ld hl, 0x5800
    ld de, 0x5801
    ld bc, 0x02FF
    ld (hl), 0x38
    ldir
    ; initial position and velocity
    ld a, 5
    ld (XPOS), a
    ld a, 3
    ld (YPOS), a
    ld a, 1
    ld (DX), a
    ld (DY), a
    ei

main_loop:
    halt
    halt                    ; move every 2 frames
    call erase_ball
    call move_ball
    call draw_ball
    jr main_loop

; HL = screen address of cell (B=row 0-23, C=col 0-31), first pixel line
cell_addr:
    ld a, b
    and 0x18
    or 0x40
    ld h, a                 ; H = 0x40 | (row & 0x18)
    ld a, b
    and 0x07
    rrca
    rrca
    rrca                    ; A = (row & 7) << 5
    or c
    ld l, a
    ret

draw_ball:
    ld a, 0xFF
    jr ball_fill
erase_ball:
    xor a
ball_fill:
    ld e, a                 ; fill byte
    ld a, (YPOS)
    ld b, a
    ld a, (XPOS)
    ld c, a
    call cell_addr
    ld b, 8
fill_lines:
    ld (hl), e
    inc h                   ; next pixel line within the cell
    djnz fill_lines
    ret

move_ball:
    ; x += dx, bounce at 0 and 31
    ld a, (DX)
    ld b, a
    ld a, (XPOS)
    add a, b
    ld (XPOS), a
    or a
    jr nz, check_right
    ld a, 1
    ld (DX), a
check_right:
    ld a, (XPOS)
    cp 31
    jr nz, move_y
    ld a, 0xFF
    ld (DX), a
move_y:
    ; y += dy, bounce at 0 and 23
    ld a, (DY)
    ld b, a
    ld a, (YPOS)
    add a, b
    ld (YPOS), a
    or a
    jr nz, check_bottom
    ld a, 1
    ld (DY), a
check_bottom:
    ld a, (YPOS)
    cp 23
    jr nz, move_done
    ld a, 0xFF
    ld (DY), a
move_done:
    ret
