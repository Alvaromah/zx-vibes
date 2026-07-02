// Reverse-engineering `gfx` sub-commands (cli.md CLI-PROD-GFX-003 / CLI-PROD-REVENG-001,
// ADR-0027 D5) — the optional add-on's THIRD-PARTY graphics tools:
//   - `gfx find` : search a snapshot for graphics-LIKE data — score fixed-size windows by
//     how "bitmap-shaped" they look (bytes that are neither blank 0x00 nor solid 0xFF) and
//     report the strongest candidate regions. Answers "where are this game's sprites?".
//   - `gfx blit-linear` : render a FOUND linear 1bpp region of the snapshot to a PNG — the
//     same 1bpp decode as core `gfx linear`, but sourced from a loaded snapshot. It writes
//     through the ONE screenshot encoder (`observe/screenshot.ts` `writePng`/`scaleRgba`)
//     and the shared palette (`observe/screen.ts` `paletteRgb`), never a second PNG path
//     (CLI-PROD-RULE-SCREENSHOT-001).
//
// These are routed here from the CORE `gfx` command via the `reveng-hook` seam (so core
// never imports the add-on); when the add-on is absent, core `gfx find`/`blit-linear` fail
// loud instead (ERR-PROD-NOSILENT-001).

import { resolve } from 'node:path';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import type { RevengGfxHandler } from '../gfx/reveng-hook.js';
import { paletteRgb, type RgbaImage } from '../observe/screen.js';
import { scaleRgba, writePng } from '../observe/screenshot.js';
import { parseAddress, parseNumber, parseRange, type AddressRange } from '../util/address.js';
import { loadRevengImage, type RevengImage, type RevengSource, type RevengSourceOptions } from './snapshot-source.js';

/** `gfx find` defaults (all Incidental — a heuristic search, not a byte contract). */
export const FIND_DEFAULT_WINDOW = 32;
export const FIND_DEFAULT_STRIDE = 8;
export const FIND_DEFAULT_TOP = 16;
export const FIND_DEFAULT_MIN_SCORE = 0.5;
export const FIND_FROM = 0x4000;
export const FIND_TO = 0xffff;
/** Monochrome default palette for `gfx blit-linear` (matches core `gfx linear`). */
export const DEFAULT_INK = 0;
export const DEFAULT_PAPER = 7;
/** Upper bound on a rendered PNG dimension (matches core `gfx`). */
export const MAX_GFX_DIM = 8192;

// --- gfx find ---------------------------------------------------------------

/** One graphics-like candidate region. */
export interface GfxFindCandidate {
  addr: number;
  /** Graphics-likeness score in [0,1] (fraction of non-blank / non-solid bytes). */
  score: number;
  /** Window length in bytes. */
  length: number;
}

export type GfxFindEnvelope = {
  ok: true;
  stage: 'gfx';
  op: 'find';
  source: RevengSource;
  range: AddressRange;
  window: number;
  stride: number;
  candidates: GfxFindCandidate[];
  count: number;
};

/**
 * Graphics-likeness of a window: the fraction of bytes that are neither 0x00 (blank) nor
 * 0xFF (solid). Real bitmap data is a spread of partial bit patterns, so it scores high;
 * zeroed RAM, filled RAM, and constant runs score ~0. A deterministic, monotone heuristic
 * (Incidental — the DNA pins no scoring formula).
 */
export function graphicsScore(memory: Uint8Array, addr: number, window: number): number {
  let interesting = 0;
  for (let i = 0; i < window; i += 1) {
    const b = memory[addr + i] ?? 0;
    if (b !== 0x00 && b !== 0xff) interesting += 1;
  }
  return interesting / window;
}

export interface GfxFindOptions extends RevengSourceOptions {
  range?: string | undefined;
  window?: string | undefined;
  stride?: string | undefined;
  top?: string | undefined;
  minScore?: string | undefined;
}

/** `gfx find` — locate graphics-like regions in a snapshot (CLI-PROD-GFX-003). */
export function runGfxFind(options: GfxFindOptions): GfxFindEnvelope {
  const image = loadRevengImage({ ...options, stage: 'gfx' });
  const range =
    options.range !== undefined ? parseRange(options.range, 'gfx') : { from: FIND_FROM, to: FIND_TO };
  const window = positiveInt(options.window, '--window') ?? FIND_DEFAULT_WINDOW;
  const stride = positiveInt(options.stride, '--stride') ?? FIND_DEFAULT_STRIDE;
  const top = positiveInt(options.top, '--top') ?? FIND_DEFAULT_TOP;
  const minScore = fraction(options.minScore, FIND_DEFAULT_MIN_SCORE);

  const found: GfxFindCandidate[] = [];
  const last = range.to - window + 1;
  for (let addr = range.from; addr <= last; addr += stride) {
    const score = graphicsScore(image.memory, addr, window);
    if (score >= minScore) found.push({ addr, score, length: window });
  }
  // Strongest first; ties broken by lower address (deterministic).
  found.sort((a, b) => (b.score - a.score) || (a.addr - b.addr));
  const candidates = found.slice(0, top);
  return {
    ok: true,
    stage: 'gfx',
    op: 'find',
    source: image.source,
    range,
    window,
    stride,
    candidates,
    count: candidates.length,
  };
}

// --- gfx blit-linear --------------------------------------------------------

export type GfxBlitEnvelope = {
  ok: true;
  stage: 'gfx';
  op: 'blit-linear';
  source: RevengSource;
  addr: number;
  out: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: number;
};

export interface GfxBlitOptions extends RevengSourceOptions {
  addr: string;
  width?: string | undefined;
  height?: string | undefined;
  out: string;
  ink?: string | undefined;
  paper?: string | undefined;
  scale?: string | undefined;
}

/**
 * Render a linear 1bpp region (1 byte = 8 horizontal px, MSB-left, rows consecutive) from
 * a snapshot image to an `RgbaImage` — the identical decode to core `gfx linear`, so a found
 * region renders the same whether sourced from a build or a snapshot.
 */
function renderLinear(
  memory: Uint8Array,
  addr: number,
  widthPx: number,
  heightPx: number,
  ink: number,
  paper: number,
): RgbaImage {
  const bytesPerRow = Math.ceil(widthPx / 8);
  const data = new Uint8Array(widthPx * heightPx * 4);
  let cursor = 0;
  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const byteIndex = addr + y * bytesPerRow + (x >> 3);
      const bit = 7 - (x & 7);
      const on = ((memory[byteIndex] ?? 0) >> bit) & 1;
      const [r, g, b] = paletteRgb(on ? ink : paper);
      data[cursor] = r;
      data[cursor + 1] = g;
      data[cursor + 2] = b;
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
  return { width: widthPx, height: heightPx, data };
}

/** `gfx blit-linear` — render a snapshot's linear region to a PNG (CLI-PROD-GFX-003). */
export function runGfxBlitLinear(options: GfxBlitOptions): GfxBlitEnvelope {
  const addr = parseAddress(options.addr, 'gfx');
  const widthPx = positiveInt(options.width, '--width');
  const heightPx = positiveInt(options.height, '--height');
  if (widthPx === undefined || heightPx === undefined) {
    throw userError('gfx blit-linear requires --width and --height (pixels)', 'gfx');
  }
  if (widthPx > MAX_GFX_DIM || heightPx > MAX_GFX_DIM) {
    throw userError(
      `gfx: the requested image is too large (${widthPx}×${heightPx}, max ${MAX_GFX_DIM} per side)`,
      'gfx',
    );
  }
  const ink = paletteIndex(options.ink, DEFAULT_INK);
  const paper = paletteIndex(options.paper, DEFAULT_PAPER);
  const scale = normalizeScale(options.scale);

  const image: RevengImage = loadRevengImage({ ...options, stage: 'gfx' });
  const rgba = renderLinear(image.memory, addr, widthPx, heightPx, ink, paper);
  const scaled = scaleRgba(rgba, scale);
  const abs = resolve(options.cwd ?? process.cwd(), options.out);
  writePng(abs, scaled);
  return {
    ok: true,
    stage: 'gfx',
    op: 'blit-linear',
    source: image.source,
    addr,
    out: options.out,
    width: scaled.width,
    height: scaled.height,
    cols: 1,
    rows: 1,
    cells: 1,
  };
}

// --- flag parsing (mirrors core gfx) ----------------------------------------

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseNumber(value);
  if (n === undefined || n < 1 || !Number.isInteger(n)) {
    throw userError(`Invalid ${name}: "${value}" (expected a positive integer)`, 'gfx');
  }
  return n;
}

function paletteIndex(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseNumber(value);
  if (n === undefined || n < 0 || n > 15) {
    throw userError(`Invalid palette index: "${value}" (expected 0..15)`, 'gfx');
  }
  return n;
}

function normalizeScale(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = parseNumber(value);
  if (n === undefined || !Number.isInteger(n) || n < 1 || n > 4) {
    throw userError(`Invalid --scale: "${value}" (expected an integer 1..4)`, 'gfx');
  }
  return n;
}

function fraction(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw userError(`Invalid --min-score: "${value}" (expected a fraction 0..1)`, 'gfx');
  }
  return n;
}

// --- the handler the add-on installs into the core gfx hook -----------------

function sourceOptions(context: CommandContext): RevengSourceOptions {
  const options = context.options as Record<string, unknown>;
  return {
    cwd: process.cwd(),
    z80: options.z80 as string | undefined,
    sna: options.sna as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
  };
}

/** The reveng `gfx` handler (installed into `reveng-hook`): routes `find` / `blit-linear`. */
export const revengGfxHandler: RevengGfxHandler = {
  run(sub, context) {
    const options = context.options as Record<string, unknown>;
    const str = (key: string): string | undefined => options[key] as string | undefined;
    if (sub === 'find') {
      return runGfxFind({
        ...sourceOptions(context),
        range: str('range'),
        window: str('window'),
        stride: str('stride'),
        top: str('top'),
        minScore: str('minScore'),
      });
    }
    if (sub === 'blit-linear' || sub === 'blit') {
      const out = str('out');
      if (out === undefined) throw userError('gfx blit-linear requires --out <png>', 'gfx');
      const addr = str('addr');
      if (addr === undefined) throw userError('gfx blit-linear requires --addr <addr>', 'gfx');
      return runGfxBlitLinear({
        ...sourceOptions(context),
        addr,
        width: str('width'),
        height: str('height'),
        out,
        ink: str('ink'),
        paper: str('paper'),
        scale: str('scale'),
      });
    }
    throw userError(`Unknown reveng gfx sub-command: "${sub}" (expected find | blit-linear)`, 'gfx');
  },
};
