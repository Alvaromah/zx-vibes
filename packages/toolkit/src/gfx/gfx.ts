// `zxs gfx` — decode the agent's OWN Spectrum graphics data to PNG (cli.md
// CLI-PROD-GFX-001/002/003; toolkit-runtime.md RT-PROD-OBSERVE-001). The "cheap
// eyes" view of sprite/tile/attribute bytes: it READS a region of the sourced
// machine's memory and ENCODES a PNG (Spectrum bytes -> PNG), the same direction as
// `screen --png` — there is ONE screenshot encoder (`observe/screenshot.ts`), never a
// second one, and `gfx` writes through it (CLI-PROD-RULE-SCREENSHOT-001).
//
// Core sub-commands (CLI-PROD-GFX-001), each REQUIRING `--out <png>`:
//   - `gfx linear` decodes a LINEAR 1bpp bitmap region (`--addr`, `--width`, `--height`):
//     1 byte = 8 horizontal pixels, MSB-leftmost, rows CONSECUTIVE in memory (the simple
//     linear layout — NOT the interleaved screen-thirds layout). The legacy
//     `gfx sheet`/`gfx font` fold into named layout PRESETS (`--preset sheet|font`,
//     CLI-PROD-GFX-002): a preset re-reads the SAME region as a sequence of fixed-size
//     cells (cell-major) tiled into a grid. A linear region carries no attributes, so the
//     render is monochrome (default ink/paper, overridable). The preset GEOMETRY (cell
//     sizes, default columns) is Incidental degrees-of-freedom — the DNA does not pin it
//     and the output is a visual PNG, not a conformance byte format (CLI-PROD-FREE-001).
//   - `gfx attrs` decodes an ATTRIBUTE region (default the 768-byte attribute file at
//     0x5800) to a colour grid: one block per attribute byte, paper fill + ink border,
//     coloured through the gallery palette (BRIGHT-aware) per screen-render.md /
//     palette.yaml. FLASH is temporal and not applied to a static grid.
//
// `gfx screen` is intentionally absent — subsumed by `screen --png` (the one screenshot
// path, CLI-PROD-GFX-001). The reverse-engineering `gfx find` / `gfx blit-linear`
// (CLI-PROD-GFX-003) inspect THIRD-PARTY games and are the optional add-on (Slice 11b);
// here they fail loud (exit 1), never silently absent (ERR-PROD-NOSILENT-001).

import { resolve } from 'node:path';
import type { Command } from 'commander';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseAddress, parseNumber } from '../util/address.js';
import { paletteRgb, type RgbaImage } from '../observe/screen.js';
import { scaleRgba, writePng } from '../observe/screenshot.js';
import { resolveObserveMachine, type ObserveBoot } from '../observe/source.js';
import { getRevengGfxHandler, type RevengGfxEnvelope } from './reveng-hook.js';

/** The base address of the 48K attribute file (display file base + 6144). */
export const ATTR_FILE_ADDR = 0x5800;
/** Default attribute-grid dimensions (the full 32×24 attribute file). */
export const ATTR_COLS = 32;
export const ATTR_ROWS = 24;
/** Default per-cell pixel size for the `gfx attrs` colour grid (8 → a 256×192 PNG). */
export const DEFAULT_ATTR_CELL_PX = 8;
/** Default monochrome ink / paper palette indices for `gfx linear` (black ink on white paper). */
export const DEFAULT_INK = 0;
export const DEFAULT_PAPER = 7;
/** Upper bound on a rendered PNG dimension (guards against an accidental huge region). */
export const MAX_GFX_DIM = 8192;

/** Named layout presets for `gfx linear` (CLI-PROD-GFX-002; geometry is Incidental). */
export interface PresetGeometry {
  cellWidth: number;
  cellHeight: number;
  cols: number;
}
export const GFX_PRESETS: Record<'sheet' | 'font', PresetGeometry> = {
  // A character font: 8×8 glyphs, laid 16 across (so the 96 ROM glyphs fill a 16×6 grid).
  font: { cellWidth: 8, cellHeight: 8, cols: 16 },
  // A sprite sheet: 16×16 tiles, laid 8 across.
  sheet: { cellWidth: 16, cellHeight: 16, cols: 8 },
};

type GfxReport = {
  stage: 'gfx';
  op: 'linear' | 'attrs';
  boot: ObserveBoot;
  /** Start address the region was read from. */
  addr: number;
  /** Written PNG path (as given; portable). */
  out: string;
  /** Output PNG dimensions (post-`--scale`). */
  width: number;
  height: number;
  /** Cell grid that produced the image. */
  cols: number;
  rows: number;
  /** Number of cells rendered (1 for a frame-linear bitmap). */
  cells: number;
  /** The layout preset, when one was used (`gfx linear --preset`). */
  preset?: 'sheet' | 'font';
};

export type GfxEnvelope = GfxReport & { ok: true };

// --- shared rendering -------------------------------------------------------

/** Build an `RgbaImage` (alpha 255) from a per-pixel palette-index function. */
function renderImage(
  width: number,
  height: number,
  indexAt: (x: number, y: number) => number,
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paletteRgb(indexAt(x, y));
      data[cursor] = r;
      data[cursor + 1] = g;
      data[cursor + 2] = b;
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
  return { width, height, data };
}

/** Read a memory byte, treating any out-of-range index as 0 (the cheap-eyes clamp). */
function memByte(memory: Uint8Array, index: number): number {
  return index >= 0 && index < memory.length ? (memory[index] ?? 0) : 0;
}

// --- gfx linear -------------------------------------------------------------

export interface GfxLinearOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  state?: string | undefined;
  org?: string | undefined;
  /** `--addr <addr>`: region start (required). */
  addr: string;
  /** `--width <px>`: region / cell width in pixels. */
  width?: string | undefined;
  /** `--height <px>`: region / cell height in pixels. */
  height?: string | undefined;
  /** `--out <png>`: output path (required). */
  out: string;
  /** `--preset sheet|font`: named cell-grid layout. */
  preset?: string | undefined;
  /** `--count <n>`: number of cells (preset mode). */
  count?: string | undefined;
  /** `--cols <n>`: cells per row (preset mode). */
  cols?: string | undefined;
  /** `--cell-width <px>` / `--cell-height <px>`: cell size override (preset mode). */
  cellWidth?: string | undefined;
  cellHeight?: string | undefined;
  /** `--ink <0..15>` / `--paper <0..15>`: monochrome palette indices. */
  ink?: string | undefined;
  paper?: string | undefined;
  /** `--scale <n>`: integer upscale 1..4 (default 1). */
  scale?: string | undefined;
}

/** Resolve a positive integer flag (`> 0`), or throw a USER_ERROR naming it. */
function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseNumber(value);
  if (n === undefined || n < 1 || !Number.isInteger(n)) {
    throw userError(`Invalid ${name}: "${value}" (expected a positive integer)`, 'gfx');
  }
  return n;
}

/** Resolve a palette index flag (0..15), or a fallback. */
function paletteIndex(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseNumber(value);
  if (n === undefined || n < 0 || n > 15) {
    throw userError(`Invalid palette index: "${value}" (expected 0..15)`, 'gfx');
  }
  return n;
}

function normalizePreset(value: string | undefined): 'sheet' | 'font' | undefined {
  if (value === undefined) return undefined;
  const name = value.trim().toLowerCase();
  if (name === 'sheet' || name === 'font') return name;
  throw userError(`Invalid --preset: "${value}" (expected sheet | font)`, 'gfx');
}

function normalizeScale(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = parseNumber(value);
  if (n === undefined || !Number.isInteger(n) || n < 1 || n > 4) {
    throw userError(`Invalid --scale: "${value}" (expected an integer 1..4)`, 'gfx');
  }
  return n;
}

/**
 * `gfx linear` (CLI-PROD-GFX-002): read a linear 1bpp bitmap region from the sourced
 * machine and write it to a PNG. Without a preset the region is one `--width`×`--height`
 * bitmap; with `--preset sheet|font` it is a sequence of fixed-size cells tiled into a
 * grid. Requires `--out <png>` (CLI-PROD-GFX-001).
 */
export function runGfxLinear(options: GfxLinearOptions): GfxEnvelope {
  const addr = parseAddress(options.addr, 'gfx');
  const preset = normalizePreset(options.preset);
  const ink = paletteIndex(options.ink, DEFAULT_INK);
  const paper = paletteIndex(options.paper, DEFAULT_PAPER);
  const scale = normalizeScale(options.scale);

  const widthPx = positiveInt(options.width, '--width');
  const heightPx = positiveInt(options.height, '--height');

  let cellWidth: number;
  let cellHeight: number;
  let cols: number;
  let count: number;

  if (preset === undefined) {
    // Frame-linear: one bitmap of the whole region (the literal CLI-PROD-GFX-002 path).
    if (widthPx === undefined || heightPx === undefined) {
      throw userError('gfx linear requires --width and --height (pixels)', 'gfx');
    }
    cellWidth = widthPx;
    cellHeight = heightPx;
    cols = 1;
    count = 1;
  } else {
    // Preset cell grid (Incidental geometry): cell size + columns from the preset,
    // overridable; the cell count is given (`--count`) or derived from the region bytes.
    const geom = GFX_PRESETS[preset];
    cellWidth = positiveInt(options.cellWidth, '--cell-width') ?? geom.cellWidth;
    cellHeight = positiveInt(options.cellHeight, '--cell-height') ?? geom.cellHeight;
    cols = positiveInt(options.cols, '--cols') ?? geom.cols;
    const explicit = positiveInt(options.count, '--count');
    if (explicit !== undefined) {
      count = explicit;
    } else if (widthPx !== undefined && heightPx !== undefined) {
      const regionBytes = Math.ceil(widthPx / 8) * heightPx;
      const bytesPerCell = Math.ceil(cellWidth / 8) * cellHeight;
      count = Math.max(1, Math.floor(regionBytes / bytesPerCell));
    } else {
      throw userError(
        'gfx linear --preset requires --count, or --width and --height to derive it',
        'gfx',
      );
    }
  }

  const rows = Math.ceil(count / cols);
  const outWidth = cols * cellWidth;
  const outHeight = rows * cellHeight;
  guardDimensions(outWidth, outHeight);

  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    state: options.state,
    org: options.org,
    stage: 'gfx',
  });
  const memory = machine.memory;
  const bytesPerCellRow = Math.ceil(cellWidth / 8);
  const bytesPerCell = bytesPerCellRow * cellHeight;

  const image = renderImage(outWidth, outHeight, (x, y) => {
    const gridX = Math.floor(x / cellWidth);
    const gridY = Math.floor(y / cellHeight);
    const cellIndex = gridY * cols + gridX;
    // A trailing partial grid row leaves empty cells beyond `count`: render as paper.
    if (cellIndex >= count) return paper;
    const cx = x % cellWidth;
    const cy = y % cellHeight;
    const byteIndex = addr + cellIndex * bytesPerCell + cy * bytesPerCellRow + (cx >> 3);
    const bit = 7 - (cx & 7);
    const pixelOn = (memByte(memory, byteIndex) >> bit) & 1;
    return pixelOn ? ink : paper;
  });

  const out = writeScaled(image, scale, options.out, options.cwd);
  const report: GfxReport = {
    stage: 'gfx',
    op: 'linear',
    boot,
    addr,
    out: options.out,
    width: out.width,
    height: out.height,
    cols,
    rows,
    cells: count,
  };
  if (preset !== undefined) report.preset = preset;
  return { ok: true, ...report };
}

// --- gfx attrs --------------------------------------------------------------

export interface GfxAttrsOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  state?: string | undefined;
  org?: string | undefined;
  /** `--addr <addr>`: attribute-region start (default the 0x5800 attribute file). */
  addr?: string | undefined;
  /** `--cols <n>` / `--rows <n>`: grid dimensions in cells (default 32×24). */
  cols?: string | undefined;
  rows?: string | undefined;
  /** `--cell <px>`: per-cell pixel size (default 8). */
  cell?: string | undefined;
  /** `--out <png>`: output path (required). */
  out: string;
  /** `--scale <n>`: integer upscale 1..4 (default 1). */
  scale?: string | undefined;
}

/** The ink palette index (BRIGHT-aware) of an attribute byte (screen-render.md). */
function attrInk(attr: number): number {
  return (attr & 0x07) + ((attr & 0x40) !== 0 ? 8 : 0);
}
/** The paper palette index (BRIGHT-aware) of an attribute byte (screen-render.md). */
function attrPaper(attr: number): number {
  return ((attr >> 3) & 0x07) + ((attr & 0x40) !== 0 ? 8 : 0);
}

/**
 * `gfx attrs` (CLI-PROD-GFX-001): read an attribute region and write a colour grid PNG —
 * one block per attribute byte, paper fill with a 1-pixel ink border (so both colours
 * show), coloured through the palette per screen-render.md / palette.yaml. Defaults to the
 * 32×24 attribute file at 0x5800. FLASH (temporal) is not applied to a static grid.
 * Requires `--out <png>` (CLI-PROD-GFX-001).
 */
export function runGfxAttrs(options: GfxAttrsOptions): GfxEnvelope {
  const addr = options.addr !== undefined ? parseAddress(options.addr, 'gfx') : ATTR_FILE_ADDR;
  const cols = positiveInt(options.cols, '--cols') ?? ATTR_COLS;
  const rows = positiveInt(options.rows, '--rows') ?? ATTR_ROWS;
  const cell = positiveInt(options.cell, '--cell') ?? DEFAULT_ATTR_CELL_PX;
  const scale = normalizeScale(options.scale);

  const outWidth = cols * cell;
  const outHeight = rows * cell;
  guardDimensions(outWidth, outHeight);

  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    state: options.state,
    org: options.org,
    stage: 'gfx',
  });
  const memory = machine.memory;

  const image = renderImage(outWidth, outHeight, (x, y) => {
    const gridX = Math.floor(x / cell);
    const gridY = Math.floor(y / cell);
    const attr = memByte(memory, addr + gridY * cols + gridX);
    const cx = x % cell;
    const cy = y % cell;
    // A 1-pixel ink border around a paper fill shows both cell colours.
    const onBorder = cx === 0 || cy === 0 || cx === cell - 1 || cy === cell - 1;
    return onBorder ? attrInk(attr) : attrPaper(attr);
  });

  const out = writeScaled(image, scale, options.out, options.cwd);
  return {
    ok: true,
    stage: 'gfx',
    op: 'attrs',
    boot,
    addr,
    out: options.out,
    width: out.width,
    height: out.height,
    cols,
    rows,
    cells: cols * rows,
  };
}

// --- shared helpers ---------------------------------------------------------

function guardDimensions(width: number, height: number): void {
  if (width < 1 || height < 1) {
    throw userError('gfx: the requested region is empty (zero width or height)', 'gfx');
  }
  if (width > MAX_GFX_DIM || height > MAX_GFX_DIM) {
    throw userError(
      `gfx: the requested image is too large (${width}×${height}, max ${MAX_GFX_DIM} per side)`,
      'gfx',
    );
  }
}

/** Apply `--scale` and write the PNG through the ONE encoder; returns the written dimensions. */
function writeScaled(
  image: RgbaImage,
  scale: number,
  out: string,
  cwd: string | undefined,
): { width: number; height: number } {
  const scaled = scaleRgba(image, scale);
  const abs = resolve(cwd ?? process.cwd(), out);
  writePng(abs, scaled);
  return { width: scaled.width, height: scaled.height };
}

// --- CLI wiring -------------------------------------------------------------

/** The reverse-engineering sub-commands demoted to the Slice 11b add-on (CLI-PROD-GFX-003). */
const REVENG_SUBCOMMANDS = new Set(['find', 'blit-linear', 'blit']);

/** Map the CLI context onto the `gfx` sub-commands. */
export function gfxCommand(context: CommandContext): GfxEnvelope | RevengGfxEnvelope {
  const sub = context.args[0];
  const options = context.options as Record<string, unknown>;
  const str = (key: string): string | undefined => options[key] as string | undefined;

  if (sub === undefined) {
    throw userError('gfx requires a sub-command: `gfx linear` or `gfx attrs`', 'gfx');
  }
  if (REVENG_SUBCOMMANDS.has(sub)) {
    // `gfx find` / `gfx blit-linear` are the reverse-engineering add-on (CLI-PROD-GFX-003).
    // Core never imports the add-on; it consults the reveng hook. Installed → delegate;
    // absent → fail loud (never silently absent, ERR-PROD-NOSILENT-001).
    const handler = getRevengGfxHandler();
    if (handler === undefined) {
      throw userError(
        `gfx ${sub} is provided by the reverse-engineering add-on (CLI-PROD-GFX-003), which is not ` +
          'installed; core gfx is `gfx linear` / `gfx attrs`',
        'gfx',
      );
    }
    return handler.run(sub, context);
  }
  if (sub === 'screen') {
    throw userError('gfx screen is subsumed by `zxs screen --png` (the one screenshot path)', 'gfx');
  }

  if (sub === 'linear') {
    const out = str('out');
    if (out === undefined) {
      throw userError('gfx linear requires --out <png>', 'gfx');
    }
    const addr = str('addr');
    if (addr === undefined) {
      throw userError('gfx linear requires --addr <addr>', 'gfx');
    }
    return runGfxLinear({
      cwd: process.cwd(),
      bin: str('bin'),
      z80: str('z80'),
      tap: str('tap'),
      sna: str('sna'),
      state: str('state'),
      org: str('org'),
      addr,
      width: str('width'),
      height: str('height'),
      out,
      preset: str('preset'),
      count: str('count'),
      cols: str('cols'),
      cellWidth: str('cellWidth'),
      cellHeight: str('cellHeight'),
      ink: str('ink'),
      paper: str('paper'),
      scale: str('scale'),
    });
  }

  if (sub === 'attrs') {
    const out = str('out');
    if (out === undefined) {
      throw userError('gfx attrs requires --out <png>', 'gfx');
    }
    return runGfxAttrs({
      cwd: process.cwd(),
      bin: str('bin'),
      z80: str('z80'),
      tap: str('tap'),
      sna: str('sna'),
      state: str('state'),
      org: str('org'),
      addr: str('addr'),
      cols: str('cols'),
      rows: str('rows'),
      cell: str('cell'),
      out,
      scale: str('scale'),
    });
  }

  throw userError(`Unknown gfx sub-command: "${sub}" (expected linear | attrs)`, 'gfx');
}

/** Declare the `gfx` command's arguments / flags (CLI-PROD-GFX-001/002). */
export function configureGfxCommand(command: Command): void {
  command
    .description('Decode the agent\'s own Spectrum graphics data to PNG (linear | attrs)')
    .argument('[args...]', '`linear` or `attrs` (reveng `find`/`blit-linear` = Slice 11b add-on)')
    .option('--bin <file>', 'source binary loaded at --org (else the configured entry / fresh boot)')
    .option('--state <file>', 'read from an opt-in persistent session (.zxstate)')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--addr <addr>', 'region start address (gfx attrs defaults to the 0x5800 attr file)')
    .option('--width <px>', 'region/cell width in pixels (gfx linear)')
    .option('--height <px>', 'region/cell height in pixels (gfx linear)')
    .option('--preset <name>', 'linear layout preset: sheet | font (gfx linear)')
    .option('--count <n>', 'number of cells for a preset (gfx linear)')
    .option('--cols <n>', 'cells per row (preset / attrs grid)')
    .option('--rows <n>', 'attribute grid rows (gfx attrs; default 24)')
    .option('--cell-width <px>', 'preset cell width override (gfx linear)')
    .option('--cell-height <px>', 'preset cell height override (gfx linear)')
    .option('--cell <px>', 'attribute cell pixel size (gfx attrs; default 8)')
    .option('--ink <0..15>', 'monochrome ink palette index (gfx linear; default 0)')
    .option('--paper <0..15>', 'monochrome paper palette index (gfx linear; default 7)')
    .option('--out <png>', 'output PNG path (REQUIRED)')
    .option('--scale <n>', 'integer upscale 1..4 (default 1)')
    // Reverse-engineering add-on sub-command flags (`gfx find` / `gfx blit-linear`,
    // CLI-PROD-GFX-003). `--z80`/`--sna` are the snapshot source-selection cli.md
    // CLI-PROD-CONV-SOURCE-001 lists for `gfx`; the rest are the find heuristic knobs
    // (Incidental). Core `gfx linear`/`attrs` ignore them; when the add-on is not mounted,
    // `gfx find`/`blit-linear` fail loud regardless.
    .option('--z80 <file>', 'source a .z80 snapshot (core gfx + reveng `gfx find`/`blit-linear`)')
    .option('--tap <file>', 'source a .tap tape (core gfx; instant-loads its CODE block)')
    .option('--sna <file>', 'a .sna snapshot (unsupported — fails loud, W4-GAP-03)')
    .option('--window <n>', 'reveng `gfx find` window size in bytes (default 32)')
    .option('--stride <n>', 'reveng `gfx find` scan stride in bytes (default 8)')
    .option('--top <n>', 'reveng `gfx find` max candidates (default 16)')
    .option('--min-score <f>', 'reveng `gfx find` minimum score 0..1 (default 0.5)')
    .option('--range <from-to>', 'reveng `gfx find` scan region (default the 48K RAM)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
