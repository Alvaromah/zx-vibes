; Arkanoid — paso 1: el escenario
    DEVICE ZXSPECTRUM48
    ORG 0x8000

PADX   equ 0xBF00           ; columna izquierda de la pala (0-29)
BALLX  equ 0xBF01           ; columna de la bola (0-31)
BALLY  equ 0xBF02           ; fila de la bola (1-23)
BALLDX equ 0xBF03           ; +1 o -1 (0xFF)
BALLDY equ 0xBF04
LIVES  equ 0xBF05
FRAME  equ 0xBF06           ; contador de frames
BRICKS equ 0xBF07           ; ladrillos restantes
score  equ 0xBF10           ; 3 bytes BCD (lo usa lib/score.asm)

start:
    ld sp, 0xBF00           ; pila propia: reiniciar con SPACE no la ensucia
    ld a, 0x38              ; tinta negra sobre papel blanco
    call clear_screen
    xor a
    ld (score), a
    ld (score+1), a
    ld (score+2), a
    call print_init
    ld b, 0                 ; AT 0,0 — por registro: un operando 0 dentro
    ld c, 0                 ; de la cadena la terminaria (¡el bug del Pong!)
    call print_at
    ld hl, hud
    call print_string

    ld a, 14                ; pala centrada
    ld (PADX), a
    call draw_paddle
    ld a, 3
    ld (LIVES), a
    call print_lives
    call draw_bricks
    call serve_ball

    ei
main_loop:
    halt
    ld a, (FRAME)
    inc a
    ld (FRAME), a
    call read_qaop          ; A = bits de teclado (O/P/Q/A/SPACE)
    call move_paddle
    ld a, (FRAME)
    and 3                   ; la bola se mueve cada 4 frames (12.5 celdas/s)
    call z, move_ball
    jr main_loop

; serve_ball — bola al centro, sirviendo hacia abajo-derecha
serve_ball:
    ld a, 15
    ld (BALLX), a
    ld a, 11
    ld (BALLY), a
    ld a, 1
    ld (BALLDX), a
    ld a, 0xFF              ; sirve hacia ARRIBA, contra los ladrillos
    ld (BALLDY), a
    ; cae en xor_ball: la dibuja

; xor_ball — XOR de la bola en su posicion actual (dibuja o borra)
; clobbers: AF, BC, DE, HL
xor_ball:
    ld a, (BALLY)
    ld b, a
    ld a, (BALLX)
    ld c, a
    ld de, ball_gfx
    jp sprite_xor_8x8

; move_ball — un paso de la bola: paredes, pala, suelo
; clobbers: AF, BC, HL, DE
move_ball:
    call xor_ball           ; borrar en la posicion vieja
    ; ── eje X: rebote en las paredes ──
    ld a, (BALLDX)
    ld b, a
    ld a, (BALLX)
    add a, b
    cp 32                   ; valido 0-31; 255 (-1) y 32 son pared
    jr c, .x_ok
    ld a, b
    neg
    ld (BALLDX), a
    ld b, a
    ld a, (BALLX)
    add a, b
.x_ok:
    ld (BALLX), a
    ; ── eje Y: techo, pala, suelo ──
    ld a, (BALLDY)
    ld b, a
    ld a, (BALLY)
    add a, b
    cp 1                    ; fila 1 = techo (la 0 es el marcador)
    jr z, .bounce_top
    cp 22                   ; fila de la pala
    jr z, .paddle_row
    cp 23                   ; debajo de la pala: vida perdida
    jr z, .die
    jr .check_brick
.bounce_top:
    ld a, 1
    ld (BALLDY), a          ; ahora baja
    jr .y_ok                ; A sigue siendo 1 (fila del techo)
.paddle_row:
    ld a, (BALLX)
    ld hl, PADX
    sub (hl)
    cp 3                    ; ¿BALLX en [PADX, PADX+2]?
    ld a, 22
    jr nc, .y_ok            ; no: sigue cayendo
    ld a, 0xFF
    ld (BALLDY), a          ; si: rebota hacia arriba
    ld a, 21
    jr .y_ok
.check_brick:
    cp 3                    ; los ladrillos viven en las filas 3-7
    jr c, .y_ok
    cp 8
    jr nc, .y_ok
    push af
    ld b, a                 ; ¿hay ladrillo en (fila ny, col BALLX)?
    ld a, (BALLX)
    ld c, a
    call cell_addr
    inc h                   ; linea 1: la 0 del ladrillo esta vacia
    ld a, (hl)
    or a
    jr z, .no_brick
    pop af
    call hit_brick          ; borra, puntua, descuenta (B,C siguen validos)
    ld a, (BALLDY)
    neg
    ld (BALLDY), a          ; rebote vertical
    ld a, (BALLY)           ; sin entrar en la celda del ladrillo
    jr .y_ok
.no_brick:
    pop af
.y_ok:
    ld (BALLY), a
    jp xor_ball             ; dibujar en la nueva posicion
.die:
    ld a, (LIVES)
    dec a
    ld (LIVES), a
    call print_lives
    ld a, (LIVES)
    or a
    jp nz, serve_ball       ; quedan vidas: a servir
    ; cae en game_over

game_over:
    ld hl, msg_over
    jr end_screen
you_win:
    ld hl, msg_win
end_screen:
    push hl
    ld b, 11
    ld c, 7
    call print_at
    pop hl
    call print_string
.wait:
    halt
    call read_qaop
    bit 4, a                ; SPACE = reiniciar
    jr z, .wait
    jp start

; draw_bricks — el muro: 5 filas x 28 columnas, un color por fila
; clobbers: AF, BC, DE, HL
draw_bricks:
    ld a, 140
    ld (BRICKS), a
    ld b, 3
.rows:
    ld c, 2
.cols:
    call draw_brick_cell
    inc c
    ld a, c
    cp 30
    jr nz, .cols
    inc b
    ld a, b
    cp 8
    jr nz, .rows
    ret

; draw_brick_cell — un ladrillo en (B=fila, C=col): pixels + color
; clobbers: AF, DE, HL (preserva B, C)
draw_brick_cell:
    push bc
    call cell_addr
    inc h                   ; lineas 1-6 (huecos arriba y abajo)
    ld a, 0x7E              ; 01111110: hueco a los lados
    ld d, 6
.lines:
    ld (hl), a
    inc h
    dec d
    jr nz, .lines
    pop bc
    push bc
    ld a, b                 ; color de la fila: indice = fila - 3
    sub 3
    ld e, a
    ld d, 0
    ld hl, brick_colors
    add hl, de
    ld e, (hl)              ; E = attr del ladrillo
    call attr_addr
    ld (hl), e
    pop bc
    ret

; hit_brick — borra el ladrillo (B=fila, C=col), +10 puntos, ¿victoria?
; clobbers: AF, DE, HL (preserva B, C via pila)
hit_brick:
    push bc
    ld e, 0
    call fill_cell          ; pixels fuera
    call attr_addr
    ld (hl), 0x38           ; color de fondo
    ld a, 0x10              ; +10 (BCD)
    call score_add
    call print_score
    pop bc
    ld a, (BRICKS)
    dec a
    ld (BRICKS), a
    jp z, you_win
    ret

; print_score — repinta los 6 digitos del marcador
print_score:
    push bc
    ld b, 0
    ld c, 6
    call print_at
    call score_print
    pop bc
    ret

; print_lives — pinta el digito de vidas en el marcador
; clobbers: AF, BC (+ROM)
print_lives:
    ld b, 0
    ld c, 24
    call print_at
    ld a, (LIVES)
    add a, '0'
    rst 0x10
    ret

; move_paddle — aplica O (izquierda) / P (derecha) con redibujado limpio
; in: A = bits de read_qaop · clobbers: AF, BC, DE, HL
move_paddle:
    ld b, a
    ld a, (PADX)
    ld c, a                 ; C = posicion vieja
    bit 0, b                ; bit 0 = P = derecha
    jr z, .no_right
    cp 29                   ; tope: la pala ocupa PADX..PADX+2
    jr nc, .no_right
    inc a
.no_right:
    bit 1, b                ; bit 1 = O = izquierda
    jr z, .no_left
    or a
    jr z, .no_left
    dec a
.no_left:
    cp c
    ret z                   ; no se ha movido: no toques la pantalla
    push af
    ld e, 0                 ; borra la pala vieja...
    call paint_paddle
    pop af
    ld (PADX), a            ; ...y pinta en la nueva posicion
    ; cae en draw_paddle

draw_paddle:
    ld e, 0xFF
    ; cae en paint_paddle

; paint_paddle — escribe el byte E en las 3 celdas de la pala (fila 22)
; clobbers: AF, BC, HL (preserva E)
paint_paddle:
    ld a, (PADX)
    ld c, a
    ld b, 22
    call fill_cell
    inc c
    call fill_cell
    inc c
    ; cae en fill_cell: tercera celda y ret al llamante

; fill_cell — llena la celda (B=fila, C=col) con el byte E
; clobbers: AF, HL (preserva B, C, E)
fill_cell:
    push bc
    call cell_addr
    ld b, 8
.lines:
    ld (hl), e
    inc h
    djnz .lines
    pop bc
    ret

hud:
    db "SCORE 000000      LIVES", 0
msg_over:
    db "GAME OVER - SPACE", 0
msg_win:
    db " YOU WIN! - SPACE", 0
brick_colors:
    db 0x10, 0x30, 0x20, 0x28, 0x18 ; rojo amarillo verde cyan magenta
ball_gfx:
    db 0x3C, 0x7E, 0xFF, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C

; print_at — cursor a (B=fila, C=col) mandando el AT por registro,
; inmune al problema del 0-terminador
; clobbers: AF (+ROM)
print_at:
    ld a, 22
    rst 0x10
    ld a, b
    rst 0x10
    ld a, c
    rst 0x10
    ret

    INCLUDE "../lib/screen.asm"
    INCLUDE "../lib/keys.asm"
    INCLUDE "../lib/print.asm"
    INCLUDE "../lib/score.asm"
