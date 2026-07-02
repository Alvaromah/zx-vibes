# Screen Render — palette index → RGB + framebuffer assembly (gallery)

The normative reference for the **gallery's screen rendering**. It covers two render
steps the emulator decode leaves to the gallery: (1) mapping a palette **index
`0..15`** — the hardware-truth output of the emulator's attribute decode
([`../domain/memory-map.md`](../domain/memory-map.md) `MM-ATTR-COLOUR-INDEX-001` /
`MM-PIXEL-COLOUR-001`) — to a concrete **RGB triple**, and (2) assembling a captured
6912-byte screen image into the visible `256 × 192` **framebuffer** (the bitmap-bit
extraction + the address/colour decode + the palette, composed). It is the
screen-content sibling of [`raster-border.md`](raster-border.md) (which renders the
*border*); both share one palette table.

Per ADR-0022 this is the **host-visible split** for screen content
(`decision:ADR-0022`, refining ADR-0016): the emulator boundary produces the palette
index (hue, the BRIGHT bit, the FLASH ink/paper swap — hardware truth); the gallery
chooses the **RGB triple** for each index and assembles the canvas (render policy). It
is the domain oracle for `dna/conformance/screen/screen-palette.json`
(`SCREEN-PALETTE-001`) and `screen-framebuffer.json` (`SCREEN-FRAMEBUFFER-001`).

## The shared palette table

The single palette lives in [`palette.yaml`](palette.yaml): 8 base hues × 2 BRIGHT
levels = 16 entries, indexed `0..15`. It is shared by the **border** (which only ever
uses indices `0..7`, `RASTER-PALETTE-001`) and the **screen** (which uses all 16).
The base-colour bits are the documented ZX Spectrum order — bit 0 blue, bit 1 red,
bit 2 green — so index `0..7` is black, blue, red, magenta, green, cyan, yellow,
white.

The exact RGB **level** is a rendering choice, not hardware truth (emulators disagree:
0xCD/0xD7/0xFF). This palette uses **205** for a lit channel at the non-bright level
and **255** at the BRIGHT level. The non-bright 205 keeps the green W8 raster border
fixtures byte-identical (red `(205,0,0)`, cyan `(0,205,205)`); the BRIGHT 255 is full
intensity. A different level changes only this slice's (and `raster-border.md`'s)
gallery fixtures — never the emulator decode.

<!-- provenance: decision:ADR-0022 -->
- [id: SCREEN-PALETTE-001] A palette index `0..15` renders to the RGB triple in
  [`palette.yaml`](palette.yaml). The base colour is `index & 0x07`
  (`0` black `(0,0,0)`, `1` blue, `2` red, `3` magenta, `4` green, `5` cyan,
  `6` yellow, `7` white) and BRIGHT is `index >= 8`. A lit channel is **205** for a
  non-bright index and **255** for a bright index; an unlit channel is `0`. Worked
  points: `0` → `(0,0,0)`, `1` → `(0,0,205)`, `2` → `(205,0,0)`, `5` → `(0,205,205)`,
  `7` → `(205,205,205)`, `8` (bright black) → `(0,0,0)`, `9` → `(0,0,255)`,
  `10` → `(255,0,0)`, `13` → `(0,255,255)`, `15` → `(255,255,255)`. Indices `2`/`5`
  match the border red/cyan of `RASTER-PALETTE-001` (the shared table, level 205).

## Framebuffer assembly (256 × 192)

The gallery renders a captured screen into the visible `256 × 192` canvas. The input
is the 6912-byte image of `0x4000`–`0x5AFF` — the 6144-byte display file followed by
the 768-byte attribute file, exactly the bytes a real machine holds — plus a frame
counter (which drives FLASH). The output is a palette-index frame (`0..15` per pixel)
and, through the palette above, an RGB frame. This 6912-byte image is byte-identical to
the `.scr` screen-dump format ([`../domain/file-formats.md`](../domain/file-formats.md)
`FMT-SCR-LAYOUT-001`), so a loaded `.scr` renders directly through this row.

This is the **integration** of four already-pinned facts: the non-linear display-file
address decode ([`../domain/memory-map.md`](../domain/memory-map.md) `MM-SCREEN-ADDR-001`),
the attribute address + the attribute → palette-index decode (`MM-ATTR-ADDR-001` /
`MM-PIXEL-COLOUR-001`), and the index → RGB mapping (`SCREEN-PALETTE-001` above). It
adds one render step the per-decode rows do not perform: extracting a pixel's bitmap
bit from its display byte.

A display byte packs 8 horizontal pixels, the most-significant bit leftmost
(`MM-SCREEN-DISPLAY-FILE-001`). So pixel column `x`'s bit *within its byte* is
`7 − (x & 7)`: column `0` is bit `7`, column `7` is bit `0`. The render holds no state
beyond the screen image and the frame counter; it is a pure function of both.

<!-- provenance: decision:ADR-0022 -->
- [id: SCREEN-FRAMEBUFFER-001] Given a 6912-byte `screen` image (offset `0` =
  address `0x4000`; the display file at offsets `0`–`6143`, the attribute file at
  `6144`–`6911`) and a frame counter `frame`, the palette index of pixel `(x, y)`
  (`0 ≤ x ≤ 255`, `0 ≤ y ≤ 191`) is `framePixelIndex(screen, x, y, frame)`: read the
  display byte `b = screen[displayByteAddress(x, y) − 0x4000]`; the pixel is on iff
  bit `7 − (x & 7)` of `b` is set, `pixelOn = (b >> (7 − (x & 7))) & 1`; read the
  attribute byte `a = screen[attributeAddress(x, y) − 0x4000]`; the index is
  `pixelColorIndex(a, pixelOn, flashPhase(frame))` (`MM-PIXEL-COLOUR-001`), in `0..15`.
  The pixel's RGB triple is
  `framePixelRgb(screen, x, y, frame) = paletteRgb(framePixelIndex(…))`
  (`SCREEN-PALETTE-001`). The whole canvas is `renderIndexFrame(screen, frame)` (a
  length-`49152` index array, row-major over `y = 0..191` then `x = 0..255`) and
  `renderRgbFrame(screen, frame)` (a length-`147456` flat `r, g, b` array). Worked
  points, a screen with display byte `0x80` at the byte holding pixel `(0, y)` and the
  named attribute at that cell: with attribute `0x38` (ink `0` black / paper `7` white)
  — `(0, 0)` on → index `0`, RGB `(0,0,0)`; `(1, 0)` off → index `7`, RGB
  `(205,205,205)`; `(7, 0)` off (bit `0` of `0x80` is clear) → index `7`. With
  attribute `0x02` (ink `2` red) — `(0, 64)` on → index `2`, RGB `(205,0,0)`. With
  attribute `0xC7` (flash, bright, ink `7` / paper `0`) — `(0, 128)` on at `frame 0`
  (phase `0`) → index `15`, RGB `(255,255,255)`; at `frame 16` (phase `1`, swapped) →
  index `8`, RGB `(0,0,0)`.

### Why a separate row (the integration the per-decode rows miss)

`SCREEN-ADDR-001` pins the address decode and `SCREEN-ATTR-DECODE-001` the per-byte
colour decode, each in isolation. A renderer can pass both yet still assemble the frame
wrong — addressing the bitmap **linearly** (ignoring the thirds, smearing the screen),
extracting the pixel bit **LSB-first** (mirroring each byte's 8 pixels), or colouring
every pixel from **one** attribute byte (a single-colour screen). This row exercises the
three together over a constructed screen, so the gate catches a *broken screen* — the W8
/ consumer symptom (`SAVE "pp"` passed the core gate yet rendered wrong) — not just a
broken formula.

The model contract (the regeneration target) is:

```text
export const FRAME_WIDTH = 256, FRAME_HEIGHT = 192, FRAME_SIZE = 49152
export const SCREEN_IMAGE_SIZE = 6912
export function framePixelIndex(screen, x, y, frame) -> int       // 0..15
export function framePixelRgb(screen, x, y, frame)   -> [r, g, b]
export function renderIndexFrame(screen, frame) -> index[]  (length 49152, row-major)
export function renderRgbFrame(screen, frame)   -> rgb[]    (length 147456, flat r,g,b)
```

## Acceptance criteria

A gallery screen renderer satisfies this policy iff, through the screen conformance
runners:

- `screen-palette.json` (SCREEN-PALETTE-001) via
  `dna/conformance/screen/run-palette-fixtures.mjs` against
  `screen-palette-model.mjs` (which reads `palette.yaml`) — `paletteRgb(index)`
  returns the RGB triple of each of the 16 indices, including the bright/non-bright
  level split and the border-matching red/cyan. The self-test rejects a palette that
  drops BRIGHT (bright indices collapse to the non-bright RGB) or uses the wrong
  non-bright level (e.g. 215 instead of 205, which would also desync the border
  fixtures).
- `screen-framebuffer.json` (SCREEN-FRAMEBUFFER-001) via
  `dna/conformance/screen/run-framebuffer-fixtures.mjs` against
  `screen-framebuffer-model.mjs` (which composes the `@zx-vibes/ula` decode with
  `palette.yaml`) — `framePixelIndex` / `framePixelRgb` at sampled pixels spanning the
  three thirds, multiple attribute cells, an interleave-sensitive line, both FLASH
  phases, and the byte's leftmost/rightmost pixel bits, plus the frame dimensions. The
  self-test rejects a renderer that addresses the bitmap linearly (ignores the thirds),
  extracts the pixel bit LSB-first, colours the whole screen from one attribute byte,
  or ignores the FLASH phase.
