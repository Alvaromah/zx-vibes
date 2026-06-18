import type { Machine } from './machine.js';

/**
 * Text-mode screen reading — the agent's cheap eyes.
 *
 * Each 8x8 cell is matched against the ROM font (0x3D00-0x3FFF, chars 32-127,
 * normal and inverse video). Matching cells render as their character;
 * non-matching cells as density glyphs (░▒▓█ by pixel count). Any standard
 * ROM-font output (RST 0x10 printing) becomes machine-readable text without
 * spending vision tokens on a PNG.
 */

export interface CellAttr {
  ink: number;
  paper: number;
  bright: boolean;
  flash: boolean;
}

export interface AttrSummaryEntry extends CellAttr {
  attr: number;
  count: number;
}

export interface ScreenText {
  /** 24 rows of 32 characters. */
  rows: string[];
  nonBlankCells: number;
  borderColor: number;
  /** Distinct attribute bytes in use, most frequent first. */
  attrs: AttrSummaryEntry[];
}

const FONT_BASE = 0x3d00; // ROM offset of the 96-glyph font (chars 32..127)
const FONT_CHARS = 96;

function glyphKey(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}

/** Spectrum charset quirks: 0x60 is £, 0x7F is ©. */
function charForCode(code: number): string {
  if (code === 0x60) return '£';
  if (code === 0x7f) return '©';
  return String.fromCharCode(code);
}

/** The font table only depends on the (immutable) ROM, so cache it per ROM
 * instance instead of rebuilding all 192 glyph keys on every screenText call. */
const fontTableCache = new WeakMap<Uint8Array, Map<string, string>>();

function getFontTable(rom: Uint8Array): Map<string, string> {
  let table = fontTableCache.get(rom);
  if (table === undefined) {
    table = buildFontTable(rom);
    fontTableCache.set(rom, table);
  }
  return table;
}

function buildFontTable(rom: Uint8Array): Map<string, string> {
  const table = new Map<string, string>();
  for (let i = 0; i < FONT_CHARS; i++) {
    const bytes: number[] = [];
    const inverse: number[] = [];
    for (let l = 0; l < 8; l++) {
      const b = rom[FONT_BASE + i * 8 + l]!;
      bytes.push(b);
      inverse.push(b ^ 0xff);
    }
    const ch = charForCode(32 + i);
    table.set(glyphKey(bytes), ch);
    // Inverse video renders the same character; space's inverse (solid block)
    // stays a density glyph, which reads better in grids.
    if (32 + i !== 32) table.set(glyphKey(inverse), ch);
  }
  return table;
}

/** Screen-memory offset of line l (0-7) of cell (row, col) — the interleave. */
function cellLineOffset(row: number, col: number, l: number): number {
  const y = row * 8 + l;
  return ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | col;
}

function popcount(b: number): number {
  let n = 0;
  while (b) {
    n += b & 1;
    b >>= 1;
  }
  return n;
}

function densityGlyph(pixels: number): string {
  if (pixels === 0) return ' ';
  if (pixels < 16) return '░';
  if (pixels < 32) return '▒';
  if (pixels < 48) return '▓';
  return '█';
}

export function screenText(m: Machine): ScreenText {
  const font = getFontTable(m.memory.rom);
  const screen = m.memory.getScreenMemory();
  const attrMem = m.memory.getAttributeMemory();

  const rows: string[] = [];
  let nonBlankCells = 0;
  const attrCounts = new Map<number, number>();

  for (let row = 0; row < 24; row++) {
    let line = '';
    for (let col = 0; col < 32; col++) {
      const bytes: number[] = [];
      let pixels = 0;
      for (let l = 0; l < 8; l++) {
        const b = screen[cellLineOffset(row, col, l)]!;
        bytes.push(b);
        pixels += popcount(b);
      }
      if (pixels > 0) nonBlankCells++;

      const match = font.get(glyphKey(bytes));
      line += match ?? densityGlyph(pixels);

      const attr = attrMem[row * 32 + col]!;
      attrCounts.set(attr, (attrCounts.get(attr) ?? 0) + 1);
    }
    rows.push(line);
  }

  const attrs: AttrSummaryEntry[] = [...attrCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([attr, count]) => ({
      attr,
      count,
      ink: attr & 0x07,
      paper: (attr >> 3) & 0x07,
      bright: (attr & 0x40) !== 0,
      flash: (attr & 0x80) !== 0,
    }));

  return { rows, nonBlankCells, borderColor: m.ula.getBorderColor(), attrs };
}
