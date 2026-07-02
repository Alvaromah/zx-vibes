// Screen-read primitive — the shared "cheap eyes" view of the machine display.
//
// This slice implements ONLY the minimal `screen` field the `run` envelope mandates
// (CLI-PROD-OUT-RUN-001): the captured 6912-byte screen image plus a couple of
// scalar facts. The full screenshot encoders (text OCR / PNG / base64) and the
// standalone `screen` command are Slice 7 — they EXTEND this module (the 6912-byte
// image is exactly the `.scr` layout and the input to the framebuffer renderer,
// screen-render.md SCREEN-FRAMEBUFFER-001), so nothing here needs to change.

import { attributeAddress, displayByteAddress, type Machine } from '@zx-vibes/machine';
import { DISPLAY_FILE_BASE, flashPhase, pixelColorIndex } from '@zx-vibes/ula';
import { romBootMemory } from '../runtime/rom.js';

/** Base address of the screen image (the display file + attribute file). */
export const SCREEN_BASE = 0x4000;
/** Display file size (256×192 1bpp bitmap, interleaved thirds). */
export const DISPLAY_FILE_SIZE = 6144;
/** Attribute file size (32×24 cells). */
export const ATTR_FILE_SIZE = 768;
/** The captured screen image size = `.scr` layout (FMT-SCR-LAYOUT-001). */
export const SCREEN_IMAGE_SIZE = DISPLAY_FILE_SIZE + ATTR_FILE_SIZE;
/** The default (cleared) attribute byte: ink 0 / paper 7 / no bright/flash. */
export const DEFAULT_ATTR = 0x38;

/** The minimal `screen` field of the run envelope (CLI-PROD-OUT-RUN-001). */
export interface ScreenSummary {
  /** The ULA border colour in effect (0..7). */
  border: number;
  /** Count of 8×8 character cells with ≥ 1 bitmap pixel set (ASSERT-PROD-CELLS-001). */
  nonBlankCells: number;
  /** Count of attribute cells whose byte differs from the default 0x38 (ASSERT-PROD-ATTR-001). */
  attrNonBlank: number;
  /** A stable content hash of the 6912-byte image (screen-change detection). */
  hash: string;
}

/** Capture the 6912-byte screen image (display file + attribute file) from memory. */
export function readScreenImage(machine: Machine): Uint8Array {
  return machine.memory.slice(SCREEN_BASE, SCREEN_BASE + SCREEN_IMAGE_SIZE);
}

/** Count 8×8 character cells with at least one set bitmap pixel (uses the interleaved decode). */
export function nonBlankCells(machine: Machine): number {
  let count = 0;
  for (let cellY = 0; cellY < 24; cellY += 1) {
    for (let cellX = 0; cellX < 32; cellX += 1) {
      let any = false;
      for (let row = 0; row < 8 && !any; row += 1) {
        const addr = displayByteAddress(cellX * 8, cellY * 8 + row);
        if (machine.memory[addr] !== 0) any = true;
      }
      if (any) count += 1;
    }
  }
  return count;
}

/** Count attribute cells whose byte differs from the cleared default (0x38). */
export function attrNonBlankCount(image: Uint8Array): number {
  let count = 0;
  for (let i = DISPLAY_FILE_SIZE; i < SCREEN_IMAGE_SIZE; i += 1) {
    if (image[i] !== DEFAULT_ATTR) count += 1;
  }
  return count;
}

/** A 32-bit FNV-1a hash of a byte buffer, as an 8-hex-digit string. */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Build the run envelope's minimal `screen` summary. */
export function summarizeScreen(machine: Machine, border: number): ScreenSummary {
  const image = readScreenImage(machine);
  return {
    border,
    nonBlankCells: nonBlankCells(machine),
    attrNonBlank: attrNonBlankCount(image),
    hash: hashBytes(image),
  };
}

// ===========================================================================
// Framebuffer renderer — screen-render.md SCREEN-FRAMEBUFFER-001 / SCREEN-PALETTE-001
// (decision:ADR-0022), shared with palette.yaml. This is the host-visible split: the
// `@zx-vibes/ula` decode produces the palette INDEX 0..15 (hardware truth); this module
// maps index → RGB triple (render policy) and assembles the canvas. The `screenDiff`
// assertion (ASSERT-PROD-SCREENDIFF-001) renders here; Slice 7's `screen` text/png/base64
// command + `run --screenshot` build on `renderRgbaImage`/`ocrScreenRows` with no rework.
// ===========================================================================

/** Visible framebuffer dimensions (screen-render.md model contract). */
export const FRAME_WIDTH = 256;
export const FRAME_HEIGHT = 192;
/** Visible pixel count (256×192). */
export const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT;

/**
 * The 16-entry ZX Spectrum palette: index `0..15` → RGB triple, embedded from
 * `dna/product/palette.yaml` (SCREEN-PALETTE-001, the normative source shared with
 * the border). Base colour bits b0 blue / b1 red / b2 green; a lit channel is 205 at
 * the non-bright level (indices 0..7) and 255 at BRIGHT (indices 8..15), an unlit
 * channel 0. The level is a render choice (decision:ADR-0022); 205 keeps the green
 * raster-border fixtures byte-identical.
 */
export const PALETTE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // 0 black
  [0, 0, 205], // 1 blue
  [205, 0, 0], // 2 red
  [205, 0, 205], // 3 magenta
  [0, 205, 0], // 4 green
  [0, 205, 205], // 5 cyan
  [205, 205, 0], // 6 yellow
  [205, 205, 205], // 7 white
  [0, 0, 0], // 8 bright black
  [0, 0, 255], // 9 bright blue
  [255, 0, 0], // 10 bright red
  [255, 0, 255], // 11 bright magenta
  [0, 255, 0], // 12 bright green
  [0, 255, 255], // 13 bright cyan
  [255, 255, 0], // 14 bright yellow
  [255, 255, 255], // 15 bright white
];

/** RGB triple `[r,g,b]` of a palette index `0..15` (SCREEN-PALETTE-001). */
export function paletteRgb(index: number): readonly [number, number, number] {
  return PALETTE_RGB[index & 0x0f]!;
}

/**
 * Whether the bitmap pixel `(x,y)` is set in a 6912-byte screen image (image offset 0
 * = address 0x4000). A display byte packs 8 horizontal pixels MSB-leftmost, so the bit
 * within its byte is `7 − (x & 7)` (screen-render.md). Backs `pixelAt`
 * (ASSERT-PROD-PIXEL-001), independent of colour/FLASH.
 */
export function framePixelOn(image: Uint8Array, x: number, y: number): boolean {
  const byte = image[displayByteAddress(x, y) - DISPLAY_FILE_BASE] ?? 0;
  return ((byte >> (7 - (x & 7))) & 1) === 1;
}

/**
 * Palette index `0..15` of pixel `(x,y)` at frame counter `frame` (SCREEN-FRAMEBUFFER-001):
 * the bitmap bit selects INK/PAPER of the cell's attribute, through the `@zx-vibes/ula`
 * decode and the FLASH phase of `frame`.
 */
export function framePixelIndex(image: Uint8Array, x: number, y: number, frame: number): number {
  const displayByte = image[displayByteAddress(x, y) - DISPLAY_FILE_BASE] ?? 0;
  const pixelOn = (displayByte >> (7 - (x & 7))) & 1;
  const attributeByte = image[attributeAddress(x, y) - DISPLAY_FILE_BASE] ?? 0;
  return pixelColorIndex(attributeByte, pixelOn, flashPhase(frame));
}

/** RGB triple of pixel `(x,y)` at `frame` — the index through the palette. */
export function framePixelRgb(
  image: Uint8Array,
  x: number,
  y: number,
  frame: number,
): readonly [number, number, number] {
  return paletteRgb(framePixelIndex(image, x, y, frame));
}

/** The whole canvas as a length-49152 palette-index array, row-major (y then x). */
export function renderIndexFrame(image: Uint8Array, frame: number): Uint8Array {
  const out = new Uint8Array(FRAME_SIZE);
  let cursor = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      out[cursor] = framePixelIndex(image, x, y, frame);
      cursor += 1;
    }
  }
  return out;
}

/** An RGBA framebuffer: `width × height` pixels, `data` a flat `r,g,b,a` byte array. */
export interface RgbaImage {
  width: number;
  height: number;
  /** Length `width * height * 4`; alpha is always 255 (opaque). */
  data: Uint8Array;
}

/**
 * Render a 6912-byte screen image into a 256×192 **RGBA** framebuffer (alpha 255) — the
 * single shared renderer behind `screenDiff` (here) and Slice 7's `screen --png`/`--base64`
 * + `run --screenshot` (CLI-PROD-RULE-SCREENSHOT-001, the one screenshot encoder). `frame`
 * drives FLASH and defaults to `0` (phase 0, no INK/PAPER swap): a deterministic,
 * FLASH-stable screenshot so a `screenDiff` baseline and the post-run frame compare exactly.
 */
export function renderRgbaImage(image: Uint8Array, frame = 0): RgbaImage {
  const data = new Uint8Array(FRAME_SIZE * 4);
  let cursor = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const [r, g, b] = framePixelRgb(image, x, y, frame);
      data[cursor] = r;
      data[cursor + 1] = g;
      data[cursor + 2] = b;
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data };
}

/**
 * Count differing pixels between two equal-dimension RGBA framebuffers (the
 * `screenDiff` metric, ASSERT-PROD-SCREENDIFF-001). A pixel differs if any of its R/G/B/A
 * channels differ. Returns `Infinity` when the dimensions mismatch (a wholesale
 * difference the caller reports as a failed comparison).
 */
export function diffPixelCount(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  let diff = 0;
  const pixels = a.width * a.height;
  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      diff += 1;
    }
  }
  return diff;
}

// --- image-based cell/pixel reads (the snapshot variants the test runner reads) ---

/**
 * Count 8×8 character cells with at least one set bitmap pixel, read from a captured
 * 6912-byte image (ASSERT-PROD-CELLS-001). The image-source analogue of
 * {@link nonBlankCells}, so a checkpoint snapshot evaluates without a live machine.
 */
export function nonBlankCellsImage(image: Uint8Array): number {
  let count = 0;
  for (let cellY = 0; cellY < 24; cellY += 1) {
    for (let cellX = 0; cellX < 32; cellX += 1) {
      let any = false;
      for (let row = 0; row < 8 && !any; row += 1) {
        const offset = displayByteAddress(cellX * 8, cellY * 8 + row) - DISPLAY_FILE_BASE;
        if (image[offset] !== 0) any = true;
      }
      if (any) count += 1;
    }
  }
  return count;
}

// --- ROM-font OCR (ASSERT-PROD-SCREENINC-001) ------------------------------

/** First OCR-able character code (SPACE) and the count of glyphs in the ROM font. */
const FONT_FIRST_CHAR = 0x20;
const FONT_CHAR_COUNT = 96; // 0x20..0x7F
/** CHARS system constant: glyph for code `c` is at `0x3C00 + c*8` (space → 0x3D00). */
const ROM_CHARS_BASE = 0x3c00;

let cachedFont: Uint8Array[] | undefined;

/**
 * The 96 ROM-font glyphs (codes 0x20..0x7F), each 8 bytes, read once from the clean
 * 48K ROM (`CHARS` at 0x3C00). The font is immutable hardware data, so OCR matches a
 * screen cell's bitmap against these regardless of the program under test.
 */
export function romFontGlyphs(): Uint8Array[] {
  if (cachedFont) return cachedFont;
  const rom = romBootMemory();
  const glyphs: Uint8Array[] = [];
  for (let c = 0; c < FONT_CHAR_COUNT; c += 1) {
    const base = ROM_CHARS_BASE + (FONT_FIRST_CHAR + c) * 8;
    glyphs.push(rom.slice(base, base + 8));
  }
  cachedFont = glyphs;
  return glyphs;
}

/** Read the 8 bitmap bytes of character cell `(col,row)` from a 6912-byte image. */
function cellBytes(image: Uint8Array, col: number, row: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let line = 0; line < 8; line += 1) {
    bytes[line] = image[displayByteAddress(col * 8, row * 8 + line) - DISPLAY_FILE_BASE] ?? 0;
  }
  return bytes;
}

/** Whether an 8-byte cell bitmap exactly equals a glyph. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < 8; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * ROM-font OCR of a captured screen: one string per character row (24 rows × 32 cols).
 * Each cell's bitmap is matched against the ROM font; an exact match yields that
 * character, anything else a space. Backs `screenIncludes` (ASSERT-PROD-SCREENINC-001),
 * which passes when its `text` is a substring of some row.
 */
export function ocrScreenRows(image: Uint8Array): string[] {
  const font = romFontGlyphs();
  const rows: string[] = [];
  for (let row = 0; row < 24; row += 1) {
    let line = '';
    for (let col = 0; col < 32; col += 1) {
      const cell = cellBytes(image, col, row);
      let matched = ' ';
      for (let g = 0; g < font.length; g += 1) {
        if (bytesEqual(cell, font[g]!)) {
          matched = String.fromCharCode(FONT_FIRST_CHAR + g);
          break;
        }
      }
      line += matched;
    }
    rows.push(line);
  }
  return rows;
}

/** Whether `text` appears (verbatim) on some OCR'd screen row (ASSERT-PROD-SCREENINC-001). */
export function screenIncludesText(image: Uint8Array, text: string): boolean {
  return ocrScreenRows(image).some((row) => row.includes(text));
}
