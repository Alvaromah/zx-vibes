; pong — ZX Spectrum 48K (Spectral toolkit)
; Cell-aligned Pong: left paddle Q/A, right paddle simple AI, ROM-printed score.
; Loop shape: EI once -> HALT x3 (move every 3rd frame) -> input -> update ->
; XOR erase/draw. All drawing is XOR-based, no trails.
    DEVICE ZXSPECTRUM48
    ORG 0x8000

; --- variables (high RAM scratch) ---
SCORE_P equ 0xBF00          ; player score 0-9
SCORE_A equ 0xBF01          ; AI score 0-9
LPAD_R  equ 0xBF02          ; left paddle top row (1-21), col 1, 3 cells tall
RPAD_R  equ 0xBF03          ; right paddle top row (1-21), col 30
BALL_R  equ 0xBF04          ; ball row (1-23)
BALL_C  equ 0xBF05          ; ball col (1-30)
BALL_DR equ 0xBF06          ; ball row delta: 0x01 down / 0xFF up
BALL_DC equ 0xBF07          ; ball col delta: 0x01 right / 0xFF left

start:
    ld a, 0x38              ; black ink on white paper
    call clear_screen
    ei                      ; interrupts ON before HALT and before ROM calls
    ld a, 2
    call 0x1601             ; CHAN-OPEN: route RST 0x10 to the main screen

    xor a
    ld (SCORE_P), a
    ld (SCORE_A), a
    ld a, 11                ; paddles centered (rows 11-13)
    ld (LPAD_R), a
    ld (RPAD_R), a
    ld a, 12                ; ball at center
    ld (BALL_R), a
    ld a, 16
    ld (BALL_C), a
    ld a, 1                 ; moving down-right
    ld (BALL_DR), a
    ld (BALL_DC), a

    call print_score
    ld a, (LPAD_R)
    ld c, 1
    call draw_paddle
    ld a, (RPAD_R)
    ld c, 30
    call draw_paddle
    call draw_ball

main_loop:
    halt                    ; frame sync (50Hz)
    halt
    halt                    ; act every 3rd frame (~16.7Hz steps)
    call read_qaop          ; A = input bits
    call move_lpad
    call move_rpad
    call move_ball
    jr main_loop

; move_lpad — player paddle: Q = up, A = down, top row clamped to 1..21
; in:       A = QAOP bits (bit 3 = Q, bit 2 = A)
; clobbers: AF, BC, DE, HL
move_lpad:
    ld b, a
    ld a, (LPAD_R)
    ld d, a                 ; D = old top row
    bit 3, b                ; Q = up
    jr z, .no_up
    cp 2
    jr c, .no_up            ; already at row 1
    dec a
.no_up:
    bit 2, b                ; A = down
    jr z, .no_down
    cp 21
    jr nc, .no_down         ; already at row 21 (bottom cell on 23)
    inc a
.no_down:
    cp d
    ret z                   ; unchanged: nothing to redraw
    push af
    ld a, d
    ld c, 1
    call draw_paddle        ; XOR at old position = erase
    pop af
    ld (LPAD_R), a
    ld c, 1
    jp draw_paddle          ; XOR at new position = draw

; move_rpad — AI paddle: move 1 cell per step toward the ball's row
; clobbers: AF, BC, DE, HL
move_rpad:
    ld a, (RPAD_R)
    ld d, a                 ; D = old top row
    inc a                   ; paddle center row = top + 1
    ld hl, BALL_R
    cp (hl)
    ret z                   ; centered on the ball: stay
    jr c, .down             ; center < ball row: move down
    ld a, d                 ; move up
    cp 2
    ret c                   ; clamp at row 1
    dec a
    jr .apply
.down:
    ld a, d
    cp 21
    ret nc                  ; clamp at row 21
    inc a
.apply:
    push af
    ld a, d
    ld c, 30
    call draw_paddle        ; erase old
    pop af
    ld (RPAD_R), a
    ld c, 30
    jp draw_paddle          ; draw new

; move_ball — one diagonal step; bounce on rows 1/23 and on paddle-adjacent
; columns (2/29) when the paddle covers the row; score + reset on exit (col
; 0/31), ball restarting toward the scorer.
; clobbers: AF, BC, DE, HL
move_ball:
    call draw_ball          ; XOR at current position = erase
    ; --- vertical ---
    ld a, (BALL_DR)
    ld b, a
    ld a, (BALL_R)
    add a, b                ; candidate row
    cp 1
    jr c, .vflip            ; hit row 0: bounce
    cp 24
    jr c, .vok              ; 1..23 fine
.vflip:
    xor a
    sub b                   ; A = -dr
    ld (BALL_DR), a
    ld b, a
    ld a, (BALL_R)
    add a, b                ; re-step with reversed delta
.vok:
    ld (BALL_R), a
    ; --- horizontal ---
    ld a, (BALL_DC)
    ld b, a
    ld a, (BALL_C)
    add a, b                ; candidate col
    ld c, a
    or a
    jr z, .score_a          ; exited left: AI scores
    cp 31
    jr z, .score_p          ; exited right: player scores
    cp 2                    ; column adjacent to left paddle?
    jr nz, .chk_right
    bit 7, b
    jr z, .place            ; moving right: no bounce
    ld a, (LPAD_R)
    ld e, a
    ld a, (BALL_R)
    sub e                   ; row - paddle top
    cp 3
    jr nc, .place           ; not covered: sail past
    ld a, 1
    ld (BALL_DC), a         ; bounce right
    jr .place
.chk_right:
    cp 29                   ; column adjacent to right paddle?
    jr nz, .place
    bit 7, b
    jr nz, .place           ; moving left: no bounce
    ld a, (RPAD_R)
    ld e, a
    ld a, (BALL_R)
    sub e
    cp 3
    jr nc, .place
    ld a, 0xFF
    ld (BALL_DC), a         ; bounce left
.place:
    ld a, c
    ld (BALL_C), a
    jp draw_ball            ; XOR at new position = draw
.score_a:                   ; ball exited left
    ld a, (SCORE_A)
    cp 9
    jr nc, .serve_a         ; clamp at 9 (single digit)
    inc a
    ld (SCORE_A), a
.serve_a:
    ld a, 1                 ; serve toward the scorer (right)
    ld (BALL_DC), a
    jr .reset
.score_p:                   ; ball exited right
    ld a, (SCORE_P)
    cp 9
    jr nc, .serve_p
    inc a
    ld (SCORE_P), a
.serve_p:
    ld a, 0xFF              ; serve toward the scorer (left)
    ld (BALL_DC), a
.reset:
    ld a, 12                ; back to center
    ld (BALL_R), a
    ld a, 16
    ld (BALL_C), a
    call print_score        ; score changed: redraw the status row
    jp draw_ball

; draw_ball — XOR the ball sprite at (BALL_R, BALL_C)
; clobbers: AF, B, DE, HL
draw_ball:
    ld a, (BALL_R)
    ld b, a
    ld a, (BALL_C)
    ld c, a
    ld de, ball_gfx
    jp sprite_xor_8x8

; draw_paddle — XOR a 3-cell-tall paddle
; in:       A = top row, C = column
; clobbers: AF, B, DE, HL (C preserved)
draw_paddle:
    ld b, a
    push bc
    ld de, pad_gfx
    call sprite_xor_8x8
    pop bc
    inc b
    push bc
    ld de, pad_gfx
    call sprite_xor_8x8
    pop bc
    inc b
    ld de, pad_gfx
    jp sprite_xor_8x8

; print_score — patch digits, print the status row via RST 0x10 (AT 0,3),
; then flood row 0 attrs (white ink on bright blue).
; clobbers: AF, BC, DE, HL
print_score:
    ld a, (SCORE_P)
    add a, '0'
    ld (score_p_char), a
    ld a, (SCORE_A)
    add a, '0'
    ld (score_a_char), a
    ld hl, score_msg
.next:
    ld a, (hl)
    cp 0xFF                 ; 0xFF terminator (string embeds a literal 0x00
    jr z, .attrs            ; as the AT row operand, so 0 can't terminate)
    push hl
    rst 0x10                ; ROM print one char (clobbers freely)
    pop hl
    inc hl
    jr .next
.attrs:
    ld hl, 0x5800           ; attr row 0
    ld a, 0x4F              ; bright, blue paper, white ink
    ld b, 32
.fill:
    ld (hl), a
    inc hl
    djnz .fill
    ret

; --- data ---
score_msg:
    db 22, 0, 3             ; AT row 0, col 3
    db "P "
score_p_char:
    db "0   SPECTRAL PONG   A "
score_a_char:
    db "0", 0xFF

ball_gfx:
    db 0x3C, 0x7E, 0xFF, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C

pad_gfx:
    db 0x7E, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E

    INCLUDE "lib/screen.asm"
    INCLUDE "lib/keys.asm"
