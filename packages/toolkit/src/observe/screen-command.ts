// `zxs screen` — report the current machine screen WITHOUT executing
// (cli.md CLI-PROD-SCREEN-001/002/003, RT-PROD-OBSERVE-001).
//
// The standalone screen observer: it sources a machine (built entry / `--bin` / fresh)
// and reads its 6912-byte display image — it never runs the machine (CLI-PROD-SCREEN-001
// "without executing"). Every render path reuses the shared seams, not a private encoder:
//   - the ROM-font OCR grid + image facts from `observe/screen.ts`,
//   - the ONE PNG encoder / decoder / scaler from `observe/screenshot.ts`
//     (CLI-PROD-RULE-SCREENSHOT-001), behind `--png` / `--base64` / `--scale`,
//   - the `screenDiff` differ (`diffPixelCount`) + the same baseline PNG decode the
//     `screenDiff` assertion uses, behind `--diff` (CLI-PROD-SCREEN-003).
//
// `--diff` reports a visual-regression result whose metric (differing-pixel count, default
// maxDiff 0) and storage (a golden PNG) match `recipes-and-assertions.md`'s `screenDiff`;
// a regression exits 1 (USER_ERROR) carrying the full diff report, like a failing `test`.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { ExitCode, userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import {
  attrNonBlankCount,
  diffPixelCount,
  hashBytes,
  ocrScreenRows,
  readScreenImage,
  renderRgbaImage,
  nonBlankCellsImage,
  DISPLAY_FILE_SIZE,
} from './screen.js';
import { decodePng, encodePng, scaleRgba, writePng } from './screenshot.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
} from './source.js';

/** A `screen --diff` visual-regression result (CLI-PROD-SCREEN-003). */
export interface ScreenDiff {
  /** The baseline path as given (portable). */
  baseline: string;
  /** Differing-pixel count vs the baseline (`null` on a dimension mismatch). */
  diffPixels: number | null;
  /** Pass threshold (default 0). */
  maxDiff: number;
  /** `diffPixels <= maxDiff` (false on a dimension mismatch). */
  pass: boolean;
  /** True when the baseline was (re)written by `--update-baseline`. */
  updated?: boolean;
  /** True when the baseline's dimensions differ from 256×192. */
  dimensionMismatch?: boolean;
}

type ScreenReport = {
  stage: 'screen';
  boot: ObserveBoot;
  /** ROM-font OCR grid: 24 rows × 32 cols (CLI-PROD-SCREEN-001 `--text`, default on). */
  rows: string[];
  nonBlankCells: number;
  attrNonBlank: number;
  /** FNV-1a hash of the 6912-byte image (screen-change detection). */
  hash: string;
  /** Per-cell ink-colour grid (0..f hex incl. BRIGHT), only with `--attrs`. */
  attrs?: string[];
  /** Written PNG path, only with `--png`. */
  png?: string;
  /** Inline `data:image/png;base64,…` data-URI, only with `--base64` (CLI-PROD-SCREEN-002). */
  base64?: string;
  /** Visual-regression result, only with `--diff`. */
  diff?: ScreenDiff;
};

export type ScreenSuccessEnvelope = ScreenReport & { ok: true };
export type ScreenErrorEnvelope = ScreenReport & {
  ok: false;
  error: { message: string; exitCode: typeof ExitCode.USER_ERROR };
};
export type ScreenEnvelope = ScreenSuccessEnvelope | ScreenErrorEnvelope;

export interface ScreenOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  /** Include the per-cell ink-colour grid (`--attrs`). */
  attrs?: boolean | undefined;
  /** Write the screenshot PNG to this path (`--png <file>`). */
  png?: string | undefined;
  /** Emit the screenshot as an inline base64 data-URI (`--base64`). */
  base64?: boolean | undefined;
  /** Compare against this golden PNG (`--diff <baseline>`). */
  diff?: string | undefined;
  /** Allowed differing-pixel count for `--diff` (default 0). */
  maxDiff?: number | undefined;
  /** (Re)write the `--diff` baseline from the current screen. */
  updateBaseline?: boolean | undefined;
  /** Integer upscale 1..4 for `--png` / `--base64` (default 1). */
  scale?: number | undefined;
}

/**
 * Per-cell ink-colour grid: 24 rows × 32 chars, each a 0..f hex digit (ink + BRIGHT*8).
 * Exported (module-level) so the MCP `zx_screen` tool (Slice 10) reuses the exact same
 * attribute-grid renderer as `screen --attrs` — not added to the public barrel.
 */
export function attrInkRows(image: Uint8Array): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 24; row += 1) {
    let line = '';
    for (let col = 0; col < 32; col += 1) {
      const attr = image[DISPLAY_FILE_SIZE + row * 32 + col] ?? 0;
      const color = (attr & 0x07) + ((attr & 0x40) !== 0 ? 8 : 0);
      line += color.toString(16);
    }
    rows.push(line);
  }
  return rows;
}

/**
 * The `screen` service (CLI-PROD-SCREEN-001..003): source a machine, read its display
 * image, and report the requested views. Never executes the machine.
 */
export function runScreen(options: ScreenOptions = {}): ScreenEnvelope {
  const scale = normalizeScale(options.scale);
  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'screen',
  });
  const image = readScreenImage(machine);

  const report: ScreenReport = {
    stage: 'screen',
    boot,
    rows: ocrScreenRows(image),
    nonBlankCells: nonBlankCellsImage(image),
    attrNonBlank: attrNonBlankCount(image),
    hash: hashBytes(image),
  };
  if (options.attrs) report.attrs = attrInkRows(image);

  // PNG / base64 share the one encoder; `--scale` is a presentation-only zoom.
  if (options.png !== undefined || options.base64) {
    const framebuffer = scaleRgba(renderRgbaImage(image, 0), scale);
    if (options.png !== undefined) {
      const out = resolve(options.cwd ?? process.cwd(), options.png);
      writePng(out, framebuffer);
      report.png = options.png;
    }
    if (options.base64) {
      report.base64 = `data:image/png;base64,${encodePng(framebuffer).toString('base64')}`;
    }
  }

  // `--diff` always compares the native 256×192 framebuffer (scale-invariant metric).
  if (options.diff !== undefined) {
    const diff = compareBaseline(image, options);
    report.diff = diff;
    if (!diff.pass) {
      return {
        ok: false,
        ...report,
        error: {
          message:
            diff.dimensionMismatch === true
              ? `screen --diff: baseline ${options.diff} is not 256×192`
              : `screen --diff: ${diff.diffPixels} differing pixel(s) exceeds maxDiff ${diff.maxDiff} (baseline ${options.diff})`,
          exitCode: ExitCode.USER_ERROR,
        },
      };
    }
  }

  return { ok: true, ...report };
}

/** Compute the `--diff` result, writing the baseline first when `--update-baseline`. */
function compareBaseline(image: Uint8Array, options: ScreenOptions): ScreenDiff {
  const maxDiff = options.maxDiff ?? 0;
  const baselineRel = options.diff!;
  const baselineAbs = resolve(options.cwd ?? process.cwd(), baselineRel);
  const native = renderRgbaImage(image, 0);

  if (options.updateBaseline) {
    writePng(baselineAbs, native);
    return { baseline: baselineRel, diffPixels: 0, maxDiff, pass: true, updated: true };
  }
  if (!existsSync(baselineAbs)) {
    throw userError(
      `screen --diff: baseline not found: ${baselineRel} (create it with --update-baseline)`,
      'screen',
    );
  }
  const base = decodePng(baselineAbs);
  if (!base) {
    throw userError(`screen --diff: cannot decode baseline PNG: ${baselineRel}`, 'screen');
  }
  const diff = diffPixelCount(native, base);
  if (!Number.isFinite(diff)) {
    return { baseline: baselineRel, diffPixels: null, maxDiff, pass: false, dimensionMismatch: true };
  }
  return { baseline: baselineRel, diffPixels: diff, maxDiff, pass: diff <= maxDiff };
}

function normalizeScale(scale: number | undefined): number {
  if (scale === undefined) return 1;
  if (!Number.isInteger(scale) || scale < 1 || scale > 4) {
    throw userError(`Invalid --scale: ${scale} (expected an integer 1..4)`, 'screen');
  }
  return scale;
}

/** Map the CLI context onto the `screen` service. */
export function screenCommand(context: CommandContext): ScreenEnvelope {
  const options = context.options as Record<string, unknown>;
  return runScreen({
    cwd: process.cwd(),
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
    attrs: options.attrs as boolean | undefined,
    png: options.png as string | undefined,
    base64: options.base64 as boolean | undefined,
    diff: options.diff as string | undefined,
    maxDiff: options.maxDiff !== undefined ? Number(options.maxDiff) : undefined,
    updateBaseline: options.updateBaseline as boolean | undefined,
    scale: options.scale !== undefined ? Number(options.scale) : undefined,
  });
}

/** Declare the `screen` command's flags (CLI-PROD-SCREEN-001..003). */
export function configureScreenCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Report the current machine screen without executing')
    .option('--bin <file>', 'read the screen from a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--text', 'ROM-font OCR grid (default on)')
    .option('--attrs', 'also include the per-cell ink-colour grid')
    .option('--png <file>', 'write the screenshot to a PNG file (the one encoder)')
    .option('--base64', 'emit the PNG inline as a base64 data-URI in the envelope')
    .option('--diff <baseline>', 'compare against a golden PNG (visual regression)')
    .option('--max-diff <n>', 'allowed differing pixels for --diff (default 0)')
    .option('--update-baseline', 'write/refresh the --diff baseline from the current screen')
    .option('--scale <n>', 'integer upscale 1..4 for --png/--base64 (default 1)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
