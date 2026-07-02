# Memory Map & Screen Addressing (48K ZX Spectrum)

The normative reference for the 48K ZX Spectrum **address space** (`0x0000`–
`0xFFFF`) and the **display-file addressing** the ULA and any renderer use to map
a screen pixel to the byte that holds it. It answers two questions a regenerated
emulator must get right to render a correct screen:

1. Where do ROM, the contended RAM bank, the display file, and the attribute file
   live in the 16-bit address space?
2. Given a pixel `(x, y)`, which display-file byte holds it, and which attribute
   byte colours its 8×8 cell?

This is distinct from [`ula-timing.md`](ula-timing.md), which specifies *when* the
ULA fetches display data and the contention it imposes; this file specifies *where*
that data lives and how a pixel coordinate decodes to an address. It is the domain
oracle for the emulator's screen-addressing rows (`dna/conformance/screen/`).

It is authored from documented ZX Spectrum hardware behavior (the Sinclair/Amstrad
48K memory layout and the ULA's display-file address generation), self-contained per
constraint C2 — no normative claim depends on an external document. The legacy
emulator is not an authority here (ADR-0002).

## Scope

W10.1 authored the **address space layout** and the **screen-address decode** — the
pure mapping from a pixel/cell coordinate to a byte address. W10.2 (ADR-0022) adds the
**attribute byte → palette-index decode**: how the attribute byte's INK/PAPER/BRIGHT/
FLASH bit fields, the FLASH phase, and a pixel's bitmap bit combine into a palette
**index `0..15`**. That index is hardware truth (hue, the BRIGHT bit, the FLASH ink/
paper swap) and lives here, at the emulator boundary.

Still *not* here: the bitmap byte → individual-pixel-bit extraction and the
`256 × 192` framebuffer assembly (W10.3), and the index → **RGB triple** mapping,
which is gallery render policy ([`../product/screen-render.md`](../product/screen-render.md)
+ [`../product/palette.yaml`](../product/palette.yaml), `decision:ADR-0022`). The 16K
ROM is an opaque artifact (ADR-0024); no ROM routine addresses are specified here.

## Address space (48K)

The 48K machine has a flat, non-paged 16-bit address space: a 16K ROM in the low
quarter and 48K of RAM above it. The lower 16K of that RAM (`0x4000`–`0x7FFF`) is
the bank the ULA shares, so it holds the screen and is the contended region.

<!-- provenance: hardware -->
- [id: MM-LAYOUT-001] The 48K address space is: ROM at `0x0000`–`0x3FFF` (16384
  bytes), and RAM at `0x4000`–`0xFFFF` (49152 bytes). The screen lives at the bottom
  of RAM: the **display file** occupies `0x4000`–`0x57FF` and the **attribute file**
  `0x5800`–`0x5AFF`. The lower 16K of RAM, `0x4000`–`0x7FFF`, is the ULA-shared
  (contended) bank (see [`ula-timing.md`](ula-timing.md) `ULA-TIME-CONTENDED-ADDR-001`);
  the upper 32K, `0x8000`–`0xFFFF`, is uncontended.

Above the attribute file, RAM from `0x5B00` upward is general-purpose: on a running
machine the ROM firmware lays out its printer buffer, system variables, and the
BASIC program/working area there, but those boundaries are a firmware convention,
not a hardware fact, and the ROM is opaque (ADR-0024), so they are out of scope.
Only the ROM/RAM split, the contended bank, and the screen regions above are pinned.

### The 16K ROM as an opaque artifact

The `0x0000`–`0x3FFF` quarter holds the firmware ROM. The DNA treats it as an
**opaque blob**: it pins *which* ROM (so any regeneration loads byte-identical
firmware) but specifies **no** ROM-routine behaviour — there is deliberately no
`rom-entry-points.md`, and the machine simply maps and executes the bytes.

<!-- provenance: decision:ADR-0024 -->
- [id: MM-ROM-ARTIFACT-001] The canonical 48K ROM is a **16384-byte opaque artifact**
  mapped at `0x0000`–`0x3FFF`, whose identity is pinned by
  [`../conformance/rom/spectrum-48k-rom.manifest.json`](../conformance/rom/spectrum-48k-rom.manifest.json)
  (size + sha256 + license/source); the conformed blob is vendored DNA-side at
  `dna/conformance/rom/spectrum-48k.rom`. The DNA specifies **no** ROM-routine
  semantics (the ROM is opaque, `decision:ADR-0024`); the **only** referenced entry
  point is **`LD-BYTES` at `0x0556`**, consumed by the tape edge-load model (roadmap
  W10.10, `TAPE-EDGE-LOAD-001`). A regeneration MUST load a ROM whose bytes match the
  manifest; loading a different or modified ROM is non-conformant. The ROM is copyright
  Amstrad plc, redistributed by their kind permission (notice retained in the
  manifest). (The region/size split itself is `MM-LAYOUT-001`, `hardware`; this claim
  pins the specific *artifact* and its opaque treatment.)

## Display file — the "thirds" layout

The display file is a `256 × 192` pixel bitmap, 1 bit per pixel, packed 8 pixels to
a byte (the most-significant bit is the leftmost pixel). Each pixel line is `256 / 8
= 32` bytes, and `192 × 32 = 6144` bytes fill `0x4000`–`0x57FF`.

The lines are **not** stored sequentially. The display file is split into three
equal `2048`-byte **thirds** — lines `0`–`63`, `64`–`127`, and `128`–`191` (the top,
middle, and bottom of the screen). Within a third the line order is interleaved by
the pixel-row-within-character-cell: all 8 character rows' top pixel lines come
first, then all their second pixel lines, and so on. This is the consequence of the
ULA's address generation, expressed exactly by the bit layout below.

<!-- provenance: hardware -->
- [id: MM-SCREEN-DISPLAY-FILE-001] The display file is `0x4000`–`0x57FF` (6144
  bytes): a `256 × 192` 1-bpp bitmap, `32` bytes per pixel line, the byte's bit `7`
  the leftmost of its 8 pixels. It is organised as three `2048`-byte thirds covering
  pixel lines `0`–`63`, `64`–`127`, `128`–`191`; within a third, lines are interleaved
  by pixel-row-within-cell (the byte holding pixel line `y` is **not** at
  `0x4000 + y·32`).

### Screen-address bit layout

For a pixel at column `x` (`0`–`255`) and line `y` (`0`–`191`), write the 8-bit line
number as bits `y7 y6 y5 y4 y3 y2 y1 y0` (with `0 ≤ y ≤ 191`, so `y7 y6` is `0`, `1`,
or `2` — the third) and the byte column `x >> 3` (`0`–`31`) as `x4 x3 x2 x1 x0`. The
16-bit display-file address has this layout:

```text
bit:  15 14 13 12 11 10  9  8   7  6  5  4  3  2  1  0
       0  1  0  y7 y6 y2 y1 y0  y5 y4 y3 x4 x3 x2 x1 x0
```

That is: the constant `010` prefix places the file at `0x4000`; `y7 y6` (bits 11–12)
select the third; `y2 y1 y0` (bits 8–10) select the pixel row within the cell;
`y5 y4 y3` (bits 5–7) select the character row within the third; and `x4..x0`
(bits 0–4) select the byte column.

<!-- provenance: hardware -->
- [id: MM-SCREEN-ADDR-001] The display-file byte holding pixel `(x, y)`
  (`0 ≤ x ≤ 255`, `0 ≤ y ≤ 191`) is at absolute address
  `displayByteAddress(x, y) = 0x4000 + ((y & 0xC0) << 5) + ((y & 0x07) << 8) +
  ((y & 0x38) << 2) + (x >> 3)`. Equivalently `0x4000 + third·0x800 + pixelRow·0x100
  + charRow·0x20 + col`, where `third = y >> 6`, `pixelRow = y & 7`,
  `charRow = (y >> 3) & 7`, `col = x >> 3`. Worked points: `(0,0)=0x4000`,
  `(0,1)=0x4100`, `(0,8)=0x4020`, `(0,64)=0x4800`, `(0,128)=0x5000`,
  `(255,0)=0x401F`, `(0,191)=0x57E0`, `(255,191)=0x57FF`.

<!-- provenance: hardware -->
- [id: MM-SCREEN-LINE-ADDR-001] The first byte (column `0`) of pixel line `y` is at
  `displayLineAddress(y) = displayByteAddress(0, y)`; the 32 bytes of a pixel line
  are contiguous (`col` occupies the low 5 address bits), so line `y` spans
  `displayLineAddress(y)`..`displayLineAddress(y) + 31`.

## Attribute file

Colour is stored separately, one byte per `8 × 8` character cell. There are `32 × 24
= 768` cells, so the attribute file is `768` bytes at `0x5800`–`0x5AFF`, laid out
linearly in reading order (left-to-right, top-to-bottom). Unlike the bitmap, the
attribute file is **not** interleaved.

<!-- provenance: hardware -->
- [id: MM-ATTR-FILE-001] The attribute file is `0x5800`–`0x5AFF` (768 bytes): one
  byte per `8 × 8` character cell, `32` columns × `24` rows, stored linearly in
  reading order (row-major, no thirds interleave). One attribute byte colours all
  64 pixels of its cell. (The byte's INK/PAPER/BRIGHT/FLASH bit fields are decoded
  below, "Attribute & colour decode".)

<!-- provenance: hardware -->
- [id: MM-ATTR-ADDR-001] The attribute byte for pixel `(x, y)` (`0 ≤ x ≤ 255`,
  `0 ≤ y ≤ 191`) is at `attributeAddress(x, y) = 0x5800 + (y >> 3) * 32 + (x >> 3)`,
  where `y >> 3` is the character row (`0`–`23`) and `x >> 3` the character column
  (`0`–`31`). Worked points: `(0,0)=0x5800`, `(255,0)=0x581F`, `(0,8)=0x5820`,
  `(0,191)=0x5AE0`, `(255,191)=0x5AFF`.

## Attribute & colour decode

Each attribute byte (above) carries the colour of its `8 × 8` cell in four bit
fields. Decoding a byte yields a palette **index `0..15`**: a base colour `0..7`
plus the BRIGHT level. Combined with a pixel's bitmap bit (set = INK, clear =
PAPER) and the current FLASH phase, this gives the final palette index of every
pixel. This is hardware truth — the index, not the RGB triple; the index → RGB
mapping is gallery render policy (ADR-0022,
[`../product/screen-render.md`](../product/screen-render.md)).

### Attribute bit fields

```text
bit:  7      6       5  4  3    2  1  0
      FLASH  BRIGHT  PAPER      INK
```

<!-- provenance: hardware -->
- [id: MM-ATTR-BITS-001] An attribute byte has four fields: **INK** = bits `2..0`
  (`byte & 0x07`), a base colour `0..7`; **PAPER** = bits `5..3`
  (`(byte >> 3) & 0x07`), a base colour `0..7`; **BRIGHT** = bit `6`
  (`(byte >> 6) & 1`); **FLASH** = bit `7` (`(byte >> 7) & 1`). The eight base
  colours are `0` black, `1` blue, `2` red, `3` magenta, `4` green, `5` cyan,
  `6` yellow, `7` white. Worked points: `0x38` → INK `0` (black), PAPER `7`
  (white), BRIGHT `0`, FLASH `0` (the boot default); `0x47` → INK `7`, PAPER `0`,
  BRIGHT `1`, FLASH `0`; `0xC7` → INK `7`, PAPER `0`, BRIGHT `1`, FLASH `1`.

### Palette index (base colour + BRIGHT)

The palette index `0..15` is the base colour `0..7` plus `8` when BRIGHT is set.
BRIGHT raises the whole cell — both INK and PAPER — by the same level; it is *not*
a separate hue.

<!-- provenance: hardware -->
- [id: MM-ATTR-COLOUR-INDEX-001] The INK palette index is
  `inkColorIndex(byte) = (byte & 0x07) + ((byte >> 6) & 1) * 8` and the PAPER
  palette index is `paperColorIndex(byte) = ((byte >> 3) & 0x07) + ((byte >> 6) & 1) * 8`,
  each in `0..15`. Worked points: `0x38` → INK `0`, PAPER `7`; `0x47` → INK `15`
  (bright white), PAPER `8` (bright black); `0x4F` → INK `15`, PAPER `9` (bright
  blue); `0x2A` → INK `2` (red), PAPER `5` (cyan).

### FLASH phase

FLASH animates by swapping INK and PAPER. The ULA generates the phase from the
frame counter, inverting every **16 frames** (a 32-frame period: 16 frames normal,
16 frames swapped). A cell only flashes when its FLASH bit is set; otherwise the
phase is irrelevant.

<!-- provenance: hardware -->
- [id: MM-ATTR-FLASH-001] The FLASH phase of frame `f` (`f ≥ 0`) is
  `flashPhase(f) = floor(f / 16) & 1`, where `FLASH_FRAMES = 16`. Phase `0` is the
  normal (un-swapped) state; phase `1` is the swapped state. Worked points: frames
  `0..15` → `0`, `16..31` → `1`, `32` → `0`, `48` → `1`.

### Pixel → palette index

<!-- provenance: hardware -->
- [id: MM-PIXEL-COLOUR-001] For a pixel whose bitmap bit is `pixelOn` (`1` = the
  bit is set, INK; `0` = clear, PAPER), an attribute `byte`, and FLASH phase
  `phase`, the palette index is
  `pixelColorIndex(byte, pixelOn, phase)`: take INK = `byte & 0x07` and
  PAPER = `(byte >> 3) & 0x07`; if the FLASH bit is set **and** `phase` is odd,
  swap INK and PAPER; then the base colour is INK if `pixelOn` else PAPER, and the
  index is that base colour `+ ((byte >> 6) & 1) * 8` (in `0..15`). BRIGHT applies
  after any FLASH swap (it raises whichever colour is shown). Worked points (`0xC7`
  = bright, flashing, INK `7` / PAPER `0`): `(0xC7, 1, 0)` → `15`, `(0xC7, 0, 0)`
  → `8`, `(0xC7, 1, 1)` → `8` (swapped), `(0xC7, 0, 1)` → `15`; non-flashing
  `(0x38, 1, anything)` → `0`, `(0x38, 0, anything)` → `7`.

## Acceptance criteria

A regenerated address-decode model satisfies the addressing facts iff it passes
`dna/conformance/screen/screen-address.json` (`SCREEN-ADDR-001`), and the colour
decode iff it passes `dna/conformance/screen/attr-decode.json`
(`SCREEN-ATTR-DECODE-001`), both through
`dna/conformance/screen/run-screen-fixtures.mjs`, which drives the regenerated
`@zx-vibes/ula`. The model contract (the regeneration target) is:

```text
export const DISPLAY_FILE_BASE = 0x4000, DISPLAY_FILE_END = 0x57FF, DISPLAY_FILE_SIZE = 6144
export const ATTR_FILE_BASE    = 0x5800, ATTR_FILE_END    = 0x5AFF, ATTR_FILE_SIZE    = 768
export const SCREEN_WIDTH = 256, SCREEN_HEIGHT = 192, CHAR_COLS = 32, CHAR_ROWS = 24, THIRD_SIZE = 0x800
export const FLASH_FRAMES = 16
export function displayByteAddress(x, y) -> int   // x in 0..255, y in 0..191 -> 0x4000..0x57FF
export function displayLineAddress(y)    -> int   // = displayByteAddress(0, y)
export function attributeAddress(x, y)   -> int   // x in 0..255, y in 0..191 -> 0x5800..0x5AFF
export function attributeInk(byte)    -> int      // byte & 0x07          -> 0..7
export function attributePaper(byte)  -> int      // (byte >> 3) & 0x07   -> 0..7
export function attributeBright(byte) -> int      // (byte >> 6) & 1      -> 0..1
export function attributeFlash(byte)  -> int      // (byte >> 7) & 1      -> 0..1
export function inkColorIndex(byte)   -> int      // -> 0..15
export function paperColorIndex(byte) -> int      // -> 0..15
export function flashPhase(frame)     -> int      // floor(frame/16) & 1  -> 0..1
export function pixelColorIndex(byte, pixelOn, phase) -> int   // -> 0..15
```

The address fixture asserts the region constants and the two address functions at
representative points chosen to exercise the thirds interleave (pixel-row step `+0x100`,
character-row step `+0x20`, third step `+0x800`, the column low bits, and the first/last
byte of each file). A **linear** decoder (`0x4000 + y·32 + col`, ignoring the
interleave) and a decoder that swaps the pixel-row and character-row bit fields both
fail; the self-test rejects them. The colour fixture asserts the bit fields, the
bright-adjusted INK/PAPER indices, the FLASH phase, and `pixelColorIndex` across
flash phases; the self-test rejects a decoder that ignores BRIGHT, mis-handles the
FLASH swap, or swaps the INK/PAPER bit fields.
