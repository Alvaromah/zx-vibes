# Quickstart: tu primer juego — un Arkanoid desde cero

> Tutorial paso a paso con Spectral. **Todo el código de esta guía se
> construyó y verificó en vivo antes de escribirla** — el resultado final
> está en `examples/arkanoid-quickstart/` (2/2 tests en CI) y se puede
> jugar en la galería. Tiempo estimado: una tarde tranquila.

---

## ¿Ensamblador o BASIC?

**Ensamblador Z80.** El Spectrum traía BASIC de serie, pero es interpretado
y lento: un BASIC mueve *decenas* de operaciones por fotograma; un juego de
acción necesita *miles*. Todos los juegos comerciales de la época eran
ensamblador, y Spectral está construido para eso: el compilador (`sjasmplus`
por defecto, backend embebido `spectral` para el flujo starter/recetas), el
depurador, las recetas y el watchdog hablan Z80.

¿Y si nunca has escrito ensamblador? Para eso existe este tutorial — y la
trampa final: puedes pedirle al agente que lo escriba él (sección 9).

---

## Paso 0 — Requisitos

```bash
git clone https://github.com/Alvaromah/spectral && cd spectral
npm install && npm run build
node dist/cli/index.js doctor        # ¿Node, ROM y backend de ensamblador ok?
```

`zxs doctor` te dice qué falta. En macOS, sjasmplus se compila desde fuente
(no hay fórmula de brew); el README explica cómo. Para trabajar sin binario
externo en el flujo actual de starters/recetas, usa
`ZXS_ASSEMBLER=spectral node dist/cli/index.js doctor`. En cuanto el doctor dé
verde, opcionalmente enlaza el binario para escribir `zxs` a secas:
`npm link` (o usa `node dist/cli/index.js` donde aquí ponga `zxs`).

---

## Paso 1 — El proyecto y el bucle sagrado

```bash
zxs new arkanoid && cd arkanoid
```

Esto crea un juego *que ya funciona* (una nave que se mueve con QAOP), con:

- `src/main.asm` — el código
- `lib/` — rutinas probadas (limpiar pantalla, sprites XOR, teclado)
- `tests/` — tests declarativos para `zxs test`
- `CLAUDE.md` / `AGENTS.md` — el manual si lo va a pilotar un agente

Y este es **el bucle sagrado**, el gesto que repetirás cien veces:

```bash
zxs build src/main.asm                                  # 1. compila
zxs run --bin build/main.bin --org 0x8000 --frames 300  # 2. ejecuta
zxs screen --text                                       # 3. MIRA
```

Compilar → ejecutar → mirar. El JSON de `zxs run` te dice si el programa
está sano (`status: "ok"`, `haltSynced: true`); `zxs screen` te enseña qué
hay en pantalla. **Nunca asumas que algo funciona sin mirar.**

Vamos a sustituir `src/main.asm` por nuestro Arkanoid, por etapas.

---

## Paso 2 — El escenario (marcador + pala)

Necesitamos imprimir por ROM, así que copia la receta a tu lib:

```bash
cp ../recipes/02-print-rom/recipe.asm lib/print.asm
```

Sustituye `src/main.asm` entero por esto:

```asm
; Arkanoid — paso 1: el escenario
    DEVICE ZXSPECTRUM48
    ORG 0x8000

PADX   equ 0xBF00           ; columna izquierda de la pala (0-29)

start:
    ld a, 0x38              ; tinta negra sobre papel blanco
    call clear_screen
    call print_init
    ld b, 0                 ; AT 0,0 — por registro: un operando 0 dentro
    ld c, 0                 ; de la cadena la terminaria (¡el bug del Pong!)
    call print_at
    ld hl, hud
    call print_string

    ld a, 14                ; pala centrada
    ld (PADX), a
    call draw_paddle

    ei
main_loop:
    halt
    jr main_loop

; draw_paddle — pinta la pala (3 celdas solidas) en la fila 22
; clobbers: AF, BC, E, HL
draw_paddle:
    ld a, (PADX)
    ld c, a
    ld b, 22
    ld e, 0xFF
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
    db "SCORE 000000      LIVES 3", 0

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
```

Ideas clave:

- **La pantalla se direcciona por celdas** de 8×8 píxeles (32 columnas ×
  24 filas). `cell_addr` (de la lib) convierte (fila, columna) en dirección
  de memoria; `fill_cell` escribe un byte en sus 8 líneas.
- Las **variables del juego** viven en direcciones fijas (`equ 0xBF00...`).
  Ventaja enorme: los tests pueden leerlas con `zxs mem read`.
- `ei` + `halt` = el latido del juego: 50 pulsos por segundo, sincronizados
  con la pantalla.

> ### ⚠️ El bug clásico (nos mordió escribiendo este tutorial)
> La primera versión imprimía el HUD con el código de control AT *dentro*
> de la cadena: `db 22, 0, 0, "SCORE..."`. Resultado: **no imprimía nada**.
> ¿Por qué? `print_string` termina cuando ve un byte 0… y `AT 0,0` lleva
> dos ceros como operandos. La cadena se corta antes de empezar. Es
> *exactamente* el mismo bug que cometió el agente que construyó el Pong.
> Por eso `print_at` manda el AT por registros: inmune al terminador.
> Si te pasa: `zxs screen --text` muestra la pantalla vacía y
> `zxs mem read 0x5C88 --len 2` (la posición de impresión de la ROM) delata
> que la ROM se quedó esperando operandos.

Verifica:

```bash
zxs build src/main.asm && zxs run --bin build/main.bin --org 0x8000 --frames 100 --fresh
zxs screen --text
```

Debes ver `SCORE 000000      LIVES 3` arriba y `███` (la pala) en la fila 22,
con `status: "ok"` y `haltSynced: true`.

---

## Paso 3 — Mover la pala

Sustituye el bloque `ei / main_loop / draw_paddle` por:

```asm
    ei
main_loop:
    halt
    call read_qaop          ; A = bits de teclado (O/P/Q/A/SPACE)
    call move_paddle
    jr main_loop

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
```

La regla de oro del movimiento sin estelas: **borra en la posición vieja,
actualiza la variable, pinta en la nueva**. Siempre en ese orden.

¿Y cómo pruebas teclado sin teclado? **Teclas programadas**: `--keys`
pulsa por ti en fotogramas exactos. Como el emulador es determinista,
el resultado es siempre idéntico — esto convierte "jugar" en "testear":

```bash
zxs build src/main.asm && \
zxs run --bin build/main.bin --org 0x8000 --frames 120 --fresh --keys "10:P*40,70:O*20"
zxs screen --text
```

P pulsada 40 frames desde el frame 10 (la pala llega al tope derecho, 29),
luego O durante 20 (retrocede 20): la pala acaba **exactamente** en la
columna 9. Míralo en la fila 22.

---

## Paso 4 — La bola: rebotes, vidas y game over

Tres ideas antes del código:

- La bola es un **sprite XOR** (receta 04): dibujarla dos veces en el mismo
  sitio la borra. Movimiento limpio gratis.
- Se mueve **por celdas** con dirección (±1, ±1), cada 4 fotogramas
  (12,5 celdas/segundo). Estilo retro masticable — suficiente para jugar.
- El orden de cada paso: borrar → calcular rebotes → actualizar → pintar.

Añade las variables junto a `PADX`:

```asm
BALLX  equ 0xBF01           ; columna de la bola (0-31)
BALLY  equ 0xBF02           ; fila de la bola (1-23)
BALLDX equ 0xBF03           ; +1 o -1 (0xFF)
BALLDY equ 0xBF04
LIVES  equ 0xBF05
FRAME  equ 0xBF06           ; contador de frames
```

En `start`, después de `call draw_paddle`, inicializa y sirve:

```asm
    ld a, 3
    ld (LIVES), a
    call print_lives
    call serve_ball
```

El bucle principal pasa a llevar el contador y el ritmo de la bola:

```asm
main_loop:
    halt
    ld a, (FRAME)
    inc a
    ld (FRAME), a
    call read_qaop
    call move_paddle
    ld a, (FRAME)
    and 3                   ; la bola se mueve cada 4 frames
    call z, move_ball
    jr main_loop
```

Y estas son las rutinas nuevas (completas en
`examples/arkanoid-quickstart/src/main.asm`):

```asm
; serve_ball — bola al centro, sirviendo hacia arriba
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
xor_ball:
    ld a, (BALLY)
    ld b, a
    ld a, (BALLX)
    ld c, a
    ld de, ball_gfx
    jp sprite_xor_8x8

; move_ball — un paso: paredes, techo, pala, suelo
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
    jr .y_ok
.bounce_top:
    ld a, 1
    ld (BALLDY), a          ; ahora baja
    jr .y_ok
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
    ld b, 11
    ld c, 7
    call print_at
    ld hl, msg_over
    call print_string
.wait:
    halt
    call read_qaop
    bit 4, a                ; SPACE = reiniciar
    jr z, .wait
    jp start

; print_lives — pinta el digito de vidas en el marcador
print_lives:
    ld b, 0
    ld c, 24
    call print_at
    ld a, (LIVES)
    add a, '0'
    rst 0x10
    ret
```

Más los datos, junto a `hud`:

```asm
msg_over:
    db "GAME OVER - SPACE", 0
ball_gfx:
    db 0x3C, 0x7E, 0xFF, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C
```

Verifica el ciclo de vida completo — sin pulsar nada la bola acaba
perdiendo las 3 vidas:

```bash
zxs run --bin build/main.bin --org 0x8000 --frames 1000 --fresh
zxs screen --text          # → "GAME OVER - SPACE", LIVES 0
zxs run --frames 100 --keys "5:SPACE*10"
zxs screen --text          # → partida nueva en marcha
```

Fíjate en el detalle de `start`: añade `ld sp, 0xBF00` como primera
instrucción. Cada reinicio con SPACE llega vía `jp start` sin limpiar la
pila; darle al juego una pila propia evita que crezca partida a partida.

---

## Paso 5 — Ladrillos, puntuación y victoria

Última etapa. La pantalla **es** el modelo de datos: no hay array de
ladrillos — un ladrillo existe si su celda tiene píxeles. Para puntuar
usamos la receta 10 (BCD):

```bash
cp ../recipes/10-score-bcd/recipe.asm lib/score.asm
```

Variables nuevas (y el `INCLUDE "../lib/score.asm"` al final del fichero):

```asm
BRICKS equ 0xBF07           ; ladrillos restantes
score  equ 0xBF10           ; 3 bytes BCD (lo usa lib/score.asm)
```

En `start`: pon el marcador a cero (`xor a` + tres `ld (score+n), a`) y
llama a `draw_bricks` antes de `serve_ball`. El muro: 5 filas × 28
columnas, un color por fila vía atributos:

```asm
; draw_bricks — el muro: 5 filas x 28 columnas, un color por fila
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
```

La colisión se engancha en `move_ball`: donde el eje Y decía `jr .y_ok`
tras los casos especiales, ahora pasa por `.check_brick` — si la fila
destino está en 3-7 y la celda tiene píxeles, hay ladrillo:

```asm
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
```

Y las piezas que faltan:

```asm
; hit_brick — borra el ladrillo (B=fila, C=col), +10 puntos, ¿victoria?
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
```

`game_over` se generaliza para compartir el final con la victoria:

```asm
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
    bit 4, a
    jr z, .wait
    jp start
```

Datos: `msg_win: db " YOU WIN! - SPACE", 0` y los colores
`brick_colors: db 0x10, 0x30, 0x20, 0x28, 0x18` (rojo, amarillo, verde,
cian, magenta — el byte de atributo es `papel*8 + tinta`).

Verifica — y aquí el determinismo brilla: la bola sirve hacia arriba y
golpea su primer ladrillo *siempre* en la fila 7, columna 19, hacia el
fotograma 20:

```bash
zxs build src/main.asm && zxs run --bin build/main.bin --org 0x8000 --frames 60 --fresh
zxs screen --text     # → SCORE 000010, y el hueco en el muro
```

> ### 🔬 El truco del depurador: probar la victoria sin jugar 140 ladrillos
> ¿Cómo verificas la pantalla de victoria sin una partida perfecta?
> Escribiendo en la memoria viva: deja la sesión tras unos frames y haz
> `zxs mem write 0xBF07 01` (BRICKS = 1). El siguiente ladrillo que caiga
> dispara `you_win`. Ejecuta 60 frames más y `zxs screen --text` muestra
> "YOU WIN! - SPACE". El emulador es tuyo: tócalo por dentro.

---

## Paso 6 — Tests automáticos

Un juego sin tests se rompe en silencio. `zxs test` ejecuta especificaciones
JSON declarativas. Crea `tests/arkanoid.test.json`:

```json
{
  "build": "../src/main.asm",
  "frames": 60,
  "assert": [
    { "type": "status", "equals": "ok" },
    { "type": "haltSynced", "equals": true },
    { "type": "screenIncludes", "text": "SCORE 000010" },
    { "type": "screenIncludes", "text": "LIVES 3" },
    { "type": "pixelAt", "x": 156, "y": 59, "set": false },
    { "type": "pixelAt", "x": 148, "y": 59, "set": true },
    { "type": "pixelAt", "x": 120, "y": 180, "set": true }
  ]
}
```

Lee lo que afirma: a los 60 fotogramas el marcador dice 000010 (primer
ladrillo), el píxel (156,59) está *apagado* (el hueco del ladrillo de la
columna 19), su vecino sigue *encendido*, y la pala está donde debe. Eso
solo es posible porque **mismo arranque + mismas teclas ⇒ ejecución
idéntica, siempre**. Añade un `tests/gameover.test.json` análogo (960
frames, "GAME OVER - SPACE") y:

```bash
zxs test tests        # → 2/2 passed
```

A partir de aquí, cada mecánica nueva = una aserción nueva que la protege.

---

## Paso 7 — A la galería

Tu juego, jugable en el navegador en tres comandos:

```bash
zxs run --bin build/main.bin --org 0x8000 --frames 130 --fresh \
        --keys "40:P*30" --screenshot screen.png   # un buen momento
zxs state export --z80 game.z80                    # foto congelada de la memoria
```

Crea `gallery/games/<tu-id>/` con `game.z80`, `screen.png`, un `meta.json`
(copia la forma del de `arkanoid-quickstart`: prompt, modelo, esfuerzo,
controles) y un `transcript.md` con la procedencia. Añade tu id a
`gallery/games/index.json` y listo: la página lo recoge sola. El contrato
es la transparencia: **sin procedencia no hay juego en la galería**.

> Nota curiosa: si el borde sale amarillo en el navegador en vez de blanco,
> es un bug del cargador .z80 de zx-generation 1.0.1 (lee el color de los
> bits equivocados). Ya está arreglado upstream — pendiente de la release.

---

## Paso 8 — Lo que el Arkanoid aún no es (tus deberes)

Lo construido es el corazón; te dejo la siguiente iteración como ejercicio,
de menor a mayor:

1. **Física de pala**: que el tercio izquierdo/derecho de la pala devuelva
   la bola con `dx` contrario — el control clásico del breakout.
2. **Sonido**: receta 09 — un `beep` al romper ladrillo, un `fx_zap` al
   perder vida.
3. **Niveles**: cuando ganas, redibuja el muro con otra disposición y sube
   la velocidad (mueve la bola cada 3 frames en vez de 4).
4. **Bola por píxeles**: media celda (4 px) por paso usando `pixel_addr`
   (receta 03) — movimiento más fino, colisiones más ricas.

---

## Paso 9 — La otra forma: pídeselo al agente

Todo lo que acabas de hacer a mano, un agente lo hace solo — esa es la
tesis de Spectral. En el directorio del proyecto (`zxs new` ya dejó el
manual `CLAUDE.md`/`AGENTS.md` preparado), abre Claude Code y di:

```
Build a playable Arkanoid. Follow CLAUDE.md.
```

El agente compilará, ejecutará, mirará la pantalla, se equivocará, leerá
los veredictos del watchdog y se corregirá. El Pong de la galería salió
exactamente así: ~8 ciclos, 40 herramientas, 11 minutos, cero ayuda.

---

## Chuleta de comandos

| Comando | Qué hace |
|---|---|
| `zxs new <nombre>` | Proyecto nuevo con esqueleto funcional |
| `zxs build src/main.asm` | Compila (errores JSON con línea y pista) |
| `zxs run --bin ... --org 0x8000 --frames N` | Ejecuta N fotogramas |
| `zxs run ... --keys "10:P*30,50:SPACE*5"` | Teclas programadas por frame |
| `zxs run ... --screenshot s.png` | Ejecuta y captura PNG |
| `zxs screen --text` | La pantalla como texto (OCR de la ROM) |
| `zxs mem read 0xBF00 --len 8` | Lee memoria (¡tus variables!) |
| `zxs mem write 0xBF07 01` | Escribe memoria viva |
| `zxs regs` | Registros de la CPU |
| `zxs break add <etiqueta>` + `zxs run --until-break` | Depurar parando |
| `zxs step 1` / `zxs disasm PC` | Paso a paso / desensamblar |
| `zxs test tests` | Ejecuta las especificaciones JSON |
| `zxs state export --z80 f.z80` | Snapshot para la galería |
| `zxs doctor` | Diagnóstico del entorno |

El código final completo: `examples/arkanoid-quickstart/` — clónalo,
rómpelo, y que los tests te digan qué rompiste.
