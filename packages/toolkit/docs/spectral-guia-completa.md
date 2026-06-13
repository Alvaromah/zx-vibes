# Spectral — La guía completa: de la idea a la publicación

> Escrito el 11 de junio de 2026, al final de la sesión que publicó el proyecto.
> Este documento explica **todo** desde cero: qué construimos, qué pasó hoy,
> qué tenemos ahora mismo y qué falta. Sin asumir que recuerdas nada.

---

## 1. La idea en una frase

**Spectral es una caja de herramientas para que una IA escriba juegos de
ZX Spectrum ella sola** — los compile, los ejecute, *vea* la pantalla,
encuentre sus propios errores y los corrija, igual que lo haría una persona
delante del ordenador.

Y tiene una segunda capa que lo hace especial: el emulador sobre el que corre
todo, **zx-generation**, lo generó también una IA (es tuyo, está en tu GitHub).
Así que el resultado final es: *un emulador escrito por IA, ejecutando juegos
escritos por IA, con herramientas escritas por IA*. Esa es la historia que
queremos contar al mundo.

---

## 2. El vocabulario (las diez palabras que lo explican todo)

Si tienes claro esto, el resto del documento se lee solo:

- **ZX Spectrum 48K** — un ordenador británico de 1982. Pantalla de 256×192
  píxeles, 48 KB de memoria, procesador Z80. Los juegos se escriben en
  *ensamblador*: instrucciones directas al procesador.
- **Emulador** — un programa moderno que imita ese hardware antiguo.
  zx-generation es nuestro emulador: un ZX Spectrum que vive dentro de
  JavaScript.
- **Headless** — "sin cabeza": ejecutar el emulador *sin ventana ni pantalla*,
  solo en memoria. Así corre 132 veces más rápido que el hardware real, y una
  IA puede hacer miles de pruebas por minuto.
- **`@zx-vibes/asm`** — el ensamblador embebido: traduce el código fuente Z80
  (texto) a binario sin instalar programas externos. `sjasmplus` queda como
  backend opcional para compatibilidad avanzada.
- **`zxs` (la CLI)** — nuestra caja de herramientas de línea de comandos:
  `zxs build` compila, `zxs run` ejecuta, `zxs screen` enseña la pantalla,
  `zxs break`/`step` depuran. Es lo que usa el agente de IA en su bucle.
- **MCP** — el protocolo con el que Claude se conecta a herramientas externas.
  Nuestro servidor `zxs-mcp` le da a Claude un Spectrum vivo: puede ejecutar
  código y **ver la pantalla como imagen** directamente en la conversación.
- **Watchdog** — el "perro guardián": un detector que clasifica cuelgues.
  Cuando un juego se cuelga, no dice solo "no funciona": dice *por qué*
  ("HALT con interrupciones apagadas", "bucle infinito", "pila corrupta"...).
- **Git / GitHub / repo** — Git guarda la historia del código en *commits*
  (instantáneas con autor y mensaje). GitHub es donde se publica esa historia.
  Un *repo público* significa que cualquiera puede leerlo y usarlo.
- **CI (Integración Continua)** — un robot de GitHub que, en cada cambio,
  compila el proyecto y ejecuta todos los tests en máquinas limpias (Linux,
  macOS...). Si algo se rompe, se pone rojo y te enteras al momento.
- **PR (Pull Request)** — la forma civilizada de proponer un cambio a un
  repo: "aquí está mi mejora, revísala y si te gusta, incorpórala (*merge*)".

---

## 3. La historia hasta ayer: las cinco fases

El proyecto se construyó en fases, cada una con su commit y sus tests:

1. **Fase 0 — el esqueleto que anda.** Un Spectrum headless dentro de Node:
   arranca la ROM real, compila con el ensamblador embebido, ejecuta, saca capturas PNG.
   Rendimiento: ~6.600 fotogramas por segundo (vs 50 del hardware real).
2. **Fase 1 — el bucle de feedback.** Sesiones que sobreviven entre comandos,
   teclas programadas por fotograma ("pulsa O en el frame 60 durante 30"),
   OCR de pantalla (lee el texto de la pantalla usando la fuente de la ROM —
   ojos baratos para la IA), y el watchdog de cuelgues.
3. **Fase 2 — el depurador.** Desensamblador Z80 completo, breakpoints por
   etiqueta o línea de código fuente, watchpoints de memoria, ejecución paso
   a paso, trazado de puntos calientes.
4. **Fase 3 — el servidor MCP.** Claude ve el Spectrum: la pantalla llega
   como imagen a la conversación.
5. **Fase 4 — la capa de conocimiento.** Documentación de referencia (8 docs:
   mapa de memoria, el layout entrelazado de la pantalla, teclado, interrupciones...),
   un libro de recetas probadas en CI, y `zxs new`: un generador de proyectos
   que crea un esqueleto de juego funcional con su manual para el agente.

**El hito que validó todo:** un agente de IA, sin ayuda humana, partió del
esqueleto de `zxs new` y construyó un **Pong jugable** en ~8 ciclos de
compilar-ejecutar-mirar-corregir, 40 llamadas a herramientas, 11 minutos.
Está en `examples/pong-by-agent/` con toda su procedencia documentada.

Ese experimento dejó además una lección importante... que es donde empieza
la sesión de hoy.

---

## 4. La sesión de hoy, paso a paso

### 4.1 El punto ciego del watchdog (tarea T-03)

Cuando el agente construía el Pong, cometió un error que estrelló el programa
contra el **editor de BASIC** (la pantalla de inicio del Spectrum, la del
cursor parpadeante). El watchdog **no lo detectó**. ¿Por qué?

El editor de BASIC es un programa educado: duerme la CPU entre fotograma y
fotograma (instrucción HALT) — exactamente igual que un juego sano. Para el
watchdog, "duerme cada fotograma" = "está bien". Un coche parado en la cuneta
con el motor al ralentí parece un coche aparcado.

**El arreglo:** ahora el watchdog también vigila *desde dónde* se ejecuta el
código. Tu juego vive en la RAM (direcciones altas); el editor de BASIC vive
en la ROM (direcciones bajas). Si un programa que corría en RAM lleva más de
un segundo ejecutando *solo* ROM, veredicto: `pc-in-rom` — "tu programa ha
perdido el control y ha caído al sistema". Con su explicación y sugerencias,
como todos los veredictos.

### 4.2 El libro de recetas, completo (T-04)

Una *receta* es un bloque de código Z80 documentado, copiable, **con test
automático** — si está en el libro, funciona, y el CI lo garantiza en cada
cambio. Había 6; hoy se escribieron las 6 que faltaban:

| Receta | Qué resuelve |
|---|---|
| Sprites enmascarados 16×16 | Dibujar muñecos sin borrar el fondo |
| IM2 (interrupciones) | El ritual completo para "código que corre 50 veces/segundo" |
| Efectos de sonido | Pitidos y barridos por el altavoz sin estropear el borde |
| Marcador BCD | Sumar y pintar puntuaciones sin divisiones |
| Generador de azar | Números pseudoaleatorios reproducibles (clave para tests) |
| Efectos de color | Animación barata cambiando solo los atributos de color |

Detalle bonito: la receta del azar se verificó **dos veces** — el código Z80
en el emulador y una simulación independiente en JavaScript tienen que
producir exactamente los mismos bytes. Coincidieron.

### 4.3 La galería web (T-06)

La meta comunitaria del proyecto: una **galería de juegos hechos por IA,
jugables en el navegador, con transparencia total**. Hoy existe:

- Una página estática (sin frameworks, sin proceso de build) en `gallery/`.
- Cada juego es una ficha: captura, modelo de IA usado, **el prompt**, número
  de iteraciones, tiempo, controles, transcript/procedencia, y dos botones:
  *descargar* y **▶ Jugar**.
- "Jugar" funciona así: cuando el Pong estaba corriendo en el emulador, le
  hicimos una *foto congelada de toda su memoria* (un snapshot `.z80`, el
  formato estándar del mundillo). La página web carga zx-generation —tu
  emulador, que también corre en navegador— y le inyecta esa foto. El juego
  revive en el punto exacto donde estaba.
- Se verificó con un Chrome automatizado: la página renderiza y el Pong corre.

### 4.4 La publicación en GitHub (T-01)

Decidiste: repo **público**, y commits firmados con tu email **noreply** de
GitHub (`16006835+Alvaromah@users.noreply.github.com` — enlaza los commits a
tu cuenta sin exponer tu correo personal). Así que:

1. Se reescribió la historia completa (15 commits) con esa identidad — se
   hace *antes* de publicar precisamente porque después ya no se puede.
2. Se creó `github.com/Alvaromah/spectral` y se subió todo.
3. El robot de CI se estrenó... **y cazó un bug real al primer intento**: el
   fichero `.gitignore` (la lista de "cosas que Git debe ignorar") tenía la
   regla `build/` para ignorar los binarios compilados — pero esa regla
   también se tragaba las carpetas de *código fuente* llamadas `src/build/` y
   `tests/build/`. Resultado: el primer push subió el proyecto **sin el
   módulo que habla con el ensamblador**. En tu máquina todo funcionaba
   (los ficheros existían, solo que Git no los veía); en la máquina limpia
   del CI, no. *Para esto exactamente existe el CI.* Arreglado y verificado.
4. También se activó **GitHub Pages** (hosting web gratuito que sirve ficheros
   del repo): la galería quedó online.

### 4.5 Los cuatro regalos a zx-generation (T-02)

Construyendo Spectral encontramos cuatro problemas en tu emulador. Hoy se
convirtieron en cuatro PRs — cuatro propuestas de mejora formales, cada una
con sus propios tests nuevos:

1. **El cargador de snapshots leía mal el color del borde.** El formato `.z80`
   guarda el borde en los bits 1-3 de un byte; el código leía los bits 0-2.
   También recuperaba mal un bit del registro R y mezclaba flags en el modo
   de interrupción. (Nos afecta directamente: la galería carga snapshots.)
2. **Guardar y restaurar el estado de la CPU perdía los "registros sombra".**
   El Z80 tiene un juego de registros de repuesto (AF', BC', DE', HL') que
   casi todos los juegos usan. La función de guardado los olvidaba — como una
   partida guardada que pierde la mitad del inventario. Spectral lo sufría y
   tenía un apaño interno; ahora está arreglado en origen.
3. **El emulador no arrancaba fuera del navegador.** Pedía cosas que solo
   existen en un navegador (canvas, document...) incluso cuando no las iba a
   usar. Ahora se puede construir y ejecutar headless en Node — que es
   justo lo que Spectral hace a todas horas.
4. **Una puerta de entrada oficial.** Antes, para usar las piezas internas
   (CPU, memoria...) había que importar rutas de ficheros internos "por la
   ventana". Ahora hay un `index.js` público y un mapa de exports — "por la
   puerta". Se verificó que las rutas viejas siguen funcionando, porque
   Spectral las usa hoy.

### 4.6 La "arqueología": el CI de zx-generation nunca había estado verde

Al abrir los PRs, sus checks salieron **rojos**. Investigando el porqué
apareció la sorpresa: no eran los cambios — **el robot de CI de zx-generation
llevaba roto desde siempre**. Nunca, en toda la historia del repo, había
pasado en verde. Capas de problemas, como una excavación:

- **Capa 1:** GitHub retiró una pieza que usaban los workflows
  (`upload-artifact@v3`). Desde entonces, todo run moría al arrancar, antes
  de ejecutar un solo test.
- **Capa 2:** debajo, el job de "calidad" tenía pasos que no podían funcionar:
  comprobaba el tamaño de un fichero con un nombre que no existe, y leía la
  cobertura de tests de una salida que jest no imprime.
- **Capa 3:** exigía un 80% de cobertura de tests cuando la real es ~47% — un
  listón decorativo que garantizaba el rojo eterno.
- **Capa 4:** 27 ficheros fuera del formato oficial del propio repo, 13
  errores de lint, y avisos de seguridad en dependencias de desarrollo.

Con tu autorización se mergearon los 4 PRs (+ uno de seguridad de dependabot
que llevaba esperando desde julio) y un **PR de reparación integral**:
acciones actualizadas, pasos rotos arreglados, formato y lint saldados,
auditoría de seguridad limpia, y el listón de cobertura puesto en el valor
real **como trinquete**: ya no falla siempre — falla solo si alguien la
empeora, y se sube a medida que mejore.

**Resultado: el primer CI verde de la historia de zx-generation.** Y de
propina, su documentación quedó publicada online (Pages tampoco estaba
activado).

### 4.7 El vídeo (T-07): preparado, te toca a ti

El "money shot" del proyecto: grabar el terminal mientras un agente construye
un juego desde cero, en time-lapse, con el momento de autocorrección visible
(ahora, con `pc-in-rom`, el error sale *con nombre* en pantalla — mejor aún).
No puedo pulsar el botón de grabar por ti, pero el **guion completo** está en
`.harness/tasks/pending/T-20260611-07-video-runbook.md`: preparación,
herramienta de grabación, el prompt exacto, qué capturar y el post-procesado.

---

## 5. Dónde estamos ahora mismo

| Qué | Dónde | Estado |
|---|---|---|
| Spectral (el toolkit) | github.com/Alvaromah/spectral | Público, CI verde (Linux + macOS + canary), 71 tests |
| La galería jugable | alvaromah.github.io/spectral | Online, con el Pong del agente |
| zx-generation (el emulador) | github.com/Alvaromah/zx-generation | Mejoras mergeadas, CI verde por primera vez, 327 tests |
| Docs del emulador | alvaromah.github.io/zx-generation | Online |
| Recetas probadas | `recipes/` | 12/12 en CI |
| Ejemplo histórico | `examples/pong-by-agent/` | Con procedencia completa |
| Memoria del proyecto | `.harness/` | Estado, decisiones y cola al día |

---

## 6. Lo que falta (y quién hace cada cosa)

**Te toca a ti (son cuentas tuyas):**

1. **Publicar el paquete en npm** (T-05). npm es la tienda de paquetes de
   JavaScript: publicar `@zx-vibes/toolkit` permite a cualquiera hacer
   `npx zxs` sin clonar nada. Solo necesito que escribas `! npm login` en la
   sesión; del resto (publicar v0.1.0 y verificar la instalación limpia) me
   encargo yo.
2. **Sacar versión nueva de zx-generation.** Las mejoras están en main pero
   no publicadas. Una *release* se dispara etiquetando: `git tag v1.1.0 &&
   git push --tags` (sugiero 1.1.0 y no 1.0.2 porque hay funcionalidad nueva,
   no solo arreglos). Cuando exista, yo actualizo Spectral para usarla y
   quito los apaños.
3. **Grabar el vídeo** (T-07) — con el runbook en la mano. Yo te acompaño en
   el re-run cuando quieras.

**Cola futura (cuando toque):** carril de CI para Windows, mejorar la carga
de cintas `.tap`, más juegos para la galería, y la idea grande: jams de
juegos hechos por IA con transparencia total.

---

## 7. El cierre (por qué esto importa)

Hoy el proyecto cruzó la línea de "experimento privado" a "proyecto público
verificable": cualquiera puede clonar Spectral, ejecutar sus tests, leer cómo
se hizo cada cosa, jugar al Pong que escribió una IA y leer el prompt que lo
originó. Y la pieza de abajo del todo —el emulador— también salió ganando:
cuatro arreglos reales y su robot de calidad funcionando por primera vez.

La cadena completa es la gracia del asunto: **una IA generó el emulador, una
IA construyó las herramientas, una IA escribió el juego, y una IA arregló y
publicó el conjunto — contigo decidiendo en cada puerta.** Eso es Spectral.
