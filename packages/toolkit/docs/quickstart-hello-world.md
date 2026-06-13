# Quickstart: "Hello World" en una máquina nueva con Claude Code

> Tu primer programa para ZX Spectrum 48K **sin clonar este repo**: instalas
> Spectral desde npm, lo conectas a Claude Code y le pides que imprima
> `HELLO WORLD`. **Todos los pasos de esta guía están verificados** — el
> ensamblador del final se construyó y ejecutó con el toolkit antes de
> escribirla. Tiempo estimado: 10 minutos.

---

## Qué vas a conseguir

En una máquina limpia, partiendo solo del paquete público
[`@zx-vibes/toolkit`](https://www.npmjs.com/package/@zx-vibes/toolkit),
harás que un agente —o tú a mano— ensamble y ejecute un programa que imprime
`HELLO WORLD` en un Spectrum 48K emulado, **viendo la pantalla** del resultado.

Esto es lo que desbloquea publicar en npm: ya no hace falta el repositorio.

---

## Paso 0 — Requisitos

Solo necesitas estas piezas instaladas:

- **Node.js ≥ 20** — compruébalo con `node --version`.
- **Un backend de ensamblador**:
  - Por defecto, Spectral usa **sjasmplus en el PATH**. La ROM del 48K ya
    viaja dentro del paquete (vía `zx-generation`), no la descargas aparte.
  - **macOS**: no hay fórmula de Homebrew; se compila desde fuente. Baja el
    `*-src.tar.xz` de las [releases](https://github.com/z00m128/sjasmplus/releases)
    y luego:
    ```bash
    tar xf sjasmplus-*-src.tar.xz && cd sjasmplus-* && make && sudo make install
    ```
  - **Linux**: `apt install sjasmplus` (o compílalo como arriba).
  - **Windows**: descarga `sjasmplus-*.win.zip` de las releases y pon el
    `.exe` en el PATH.
  - Para la ruta sin binario externo, usa el backend embebido:
    `ZXS_ASSEMBLER=spectral zxs build hello.asm`. Es un MVP compatible con el
    flujo actual de starters/recetas, no con todo el lenguaje de sjasmplus.
- **Claude Code** instalado y funcionando (`claude --version`).

---

## Paso 1 — Instala el toolkit desde npm

```bash
npm install -g @zx-vibes/toolkit
```

Esto te deja dos comandos en el PATH:

- **`zxs`** — la CLI (ensamblar, ejecutar, depurar, testear).
- **`zxs-mcp`** — el servidor MCP que conectarás a Claude Code.

> ¿No quieres instalar nada global? Puedes usar `npx -p @zx-vibes/toolkit zxs <cmd>`
> en cada llamada, pero la instalación global hace el resto del tutorial más
> cómodo.

---

## Paso 2 — Verifica el entorno

```bash
zxs doctor
```

Debe salir todo en verde:

```
✓ node: v22.x.x
✓ sjasmplus: v1.23.1
✓ @zx-vibes/asm: available
✓ 48k.rom: /.../node_modules/zx-generation/rom/48k.rom
```

Si `sjasmplus` aparece en rojo, el propio `doctor` te imprime cómo instalarlo.
Si prefieres no instalarlo y tienes disponible el backend embebido, ejecuta:

```bash
ZXS_ASSEMBLER=spectral zxs doctor
```

---

## Paso 3 — Conecta Spectral a Claude Code (MCP)

Crea una carpeta de trabajo y registra el servidor MCP:

```bash
mkdir hello-zx && cd hello-zx
claude mcp add spectral -- zxs-mcp
```

- Añade `-s user` (`claude mcp add -s user spectral -- zxs-mcp`) para tenerlo
  disponible en **todos** tus proyectos, no solo en esta carpeta.
- Comprueba el registro con `claude mcp list`.

Esto es lo que permite que Claude **vea** la pantalla del Spectrum: la
herramienta `zx_screen` devuelve el display como imagen, además de un OCR del
texto en rejilla 32×24.

---

## Paso 4 — Pídeselo a Claude Code

Lanza el agente en la carpeta:

```bash
claude
```

Y dale un prompt como:

> Crea un programa para ZX Spectrum 48K que imprima `HELLO WORLD` en pantalla
> usando la rutina de impresión de la ROM. Ensámblalo con la tool de Spectral,
> ejecútalo y enséñame la pantalla.

Claude encadenará las herramientas MCP `zx_build` → `zx_run` → `zx_screen`:
ensambla el `.asm`, arranca la máquina headless y te muestra el resultado. Si
algo no se ve como esperabas, tiene `zx_inspect` y `zx_debug` (breakpoints,
watchpoints, registros, disassembler) para depurarlo contigo.

---

## Alternativa sin agente — la CLI a mano

Si prefieres ver el bucle sin pasar por el agente, crea `hello.asm` con este
contenido (**verificado en el emulador**):

```asm
; Hello World mínimo para ZX Spectrum 48K.
; Imprime en pantalla con el restart de la ROM (RST 16).
; Sin códigos de control AT -> evita la trampa del terminador cero.

    ORG 0x8000

start:
    ld a, 2            ; canal 2 = pantalla principal (superior)
    call 0x1601       ; ROM CHAN-OPEN: selecciona el canal de A

    ld hl, msg
print_loop:
    ld a, (hl)
    or a              ; el 0 termina la cadena
    jr z, done
    rst 0x10          ; ROM PRINT-A-1: imprime el carácter de A
    inc hl
    jr print_loop

done:
    jr done           ; bucle infinito: si retornas a la ROM, BASIC repinta
                      ; y borra tu texto

msg:
    defb "HELLO WORLD", 0
```

Y ejecútalo:

```bash
zxs build hello.asm
# o: zxs build hello.asm --assembler spectral
zxs run --bin build/hello.bin --org 0x8000 --frames 50 --no-detect-hangs \
    --screenshot screen.png --text
```

Abre `screen.png` y verás `HELLO WORLD` arriba (con la línea
`© 1982 Sinclair Research Ltd` del arranque debajo).

### Dos trampas que te ahorran un rato

- El **bucle infinito** final (`done: jr done`) es imprescindible: si dejas
  que el programa haga `ret`, el control vuelve a la ROM, BASIC repinta la
  pantalla y borra tu texto.
- Por eso pasas **`--no-detect-hangs`**: ese bucle es intencional, pero el
  watchdog lo clasificaría como `tight-loop` (código de salida 2) y abortaría
  la ejecución. La captura de pantalla se hace igual al terminar el presupuesto
  de fotogramas.

> Otra trampa clásica del Spectrum, que esta guía evita a propósito: imprimir
> con códigos de control `AT y,x` dentro de una cadena terminada en cero. Si
> `y` o `x` valen 0, el byte `0` se confunde con el terminador y la cadena se
> trunca en silencio. Aquí no usamos `AT`, pero lo verás documentado en
> `docs/reference/common-bugs.md`.

---

## Siguientes pasos

- **Tu primer juego**: el tutorial [`quickstart-arkanoid.md`](quickstart-arkanoid.md)
  construye un Arkanoid jugable desde cero, paso a paso.
- **El recetario**: `recipes/` (o `zxs test recipes`) tiene 12 recetas
  verificadas — sprites, teclado, bucle de juego, interrupciones IM2, sonido…
- **La referencia**: `docs/reference/` — mapa de memoria, rutinas de la ROM,
  layout de pantalla, atributos, timing e input.
- **La galería**: juegos hechos por agentes, jugables en el navegador, en
  <https://alvaromah.github.io/spectral/>.
