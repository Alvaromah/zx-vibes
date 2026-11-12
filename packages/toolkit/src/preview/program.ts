// Preview program resolution — cli.md CLI-PROD-PREVIEW-002, toolkit-runtime.md
// RT-PROD-PREVIEW-001 / RT-PROD-FORMATS-001.
//
// `preview` has three modes (CLI-PROD-PREVIEW-002): the DEFAULT serves the built project,
// `--blank` serves a clean 48K boot screen (legacy `boot`), and `<file>` serves a
// `.z80`/`.tap`/`.tzx` image (legacy `play`). This module resolves the requested mode into
// a `PreviewProgram` payload — a format-tagged byte blob the bundled player loads — and is
// the ONE place that decides which bytes the server hands the browser.
//
// `.sna` BOUNDARY (tracked core-codec gap): CLI-PROD-PREVIEW-002 lists `.sna` among the
// `<file>` types, but `@zx-vibes/machine` ships NO `.sna` codec (no `readSna`). We do NOT
// invent one: `preview <file.sna>` FAILS LOUD with a clear error naming the missing core
// codec (errors.md ERR-PROD-NOSILENT-001) rather than silently mis-loading.
//
// Every program is decoded here exactly as the browser player will decode it
// (`bootPreviewProgram`, the shared ./player-boot.ts): a corrupt `.z80`/`.tap`/`.tzx`,
// an empty tape, or an image that does not fit RAM is a USER_ERROR before anything is
// served — not a page stuck on "loading…".

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { resolveConfig } from '../config/config.js';
import { userError } from '../output/envelope.js';
import { parseAddress } from '../util/address.js';
import { buildProject, type BuildDiagnostic } from '../build/build.js';
import { loadRom } from '../runtime/rom.js';
import { programLoadOrigin } from '../runtime/session.js';
import { bootPreviewProgram } from './player-boot.js';

/** How many build errors a preview failure quotes (the rest: `zxs build`). */
const QUOTED_BUILD_ERRORS = 5;

/** The program a preview server serves to the bundled player. */
export interface PreviewProgram {
  /** The requested preview mode. */
  mode: 'project' | 'blank' | 'file';
  /** The player-side load strategy. `blank` carries no bytes. */
  kind: 'blank' | 'bin' | 'z80' | 'tap' | 'tzx';
  /** The program bytes (empty for `blank`): the built `.bin`, or the `<file>` image bytes. */
  bytes: Uint8Array;
  /** Load origin for a raw `bin` image (its first ORG, else the configured `org`); 0 otherwise. */
  org: number;
  /** A short human label for the served program (Incidental). */
  label: string;
}

/** The JSON metadata the player fetches at `/program.json` (the bytes ride `/program.bin`). */
export interface PreviewProgramMeta {
  mode: PreviewProgram['mode'];
  kind: PreviewProgram['kind'];
  org: number;
  label: string;
  byteLength: number;
}

/** Project the payload's metadata (no bytes) for `/program.json`. */
export function programMeta(program: PreviewProgram): PreviewProgramMeta {
  return {
    mode: program.mode,
    kind: program.kind,
    org: program.org,
    label: program.label,
    byteLength: program.bytes.length,
  };
}

export interface ResolveProgramOptions {
  /** Project root (defaults to `process.cwd()`). */
  cwd?: string | undefined;
  /** `--blank` mode. */
  blank?: boolean | undefined;
  /** `<file>` positional (a `.z80`/`.tap`/`.tzx` image). */
  file?: string | undefined;
}

/**
 * Resolve the preview program for the requested mode (CLI-PROD-PREVIEW-002). The default
 * (no `--blank`, no file) BUILDS the project and serves the produced `.bin` at its load
 * origin (CLI-PROD-CONV-ORIGIN-001); `--blank` serves a clean boot screen; a `<file>`
 * serves its image.
 * A build failure, a missing file, an `.sna` (the tracked gap), or an unknown extension is
 * a USER_ERROR (exit 1) — never a silent mis-load.
 */
export function resolvePreviewProgram(options: ResolveProgramOptions = {}): PreviewProgram {
  const cwd = resolve(options.cwd ?? process.cwd());

  if (options.blank) {
    return { mode: 'blank', kind: 'blank', bytes: new Uint8Array(0), org: 0, label: 'blank 48K' };
  }

  if (options.file !== undefined) {
    return resolveFileProgram(options.file, cwd);
  }

  // Default mode: build the project, then serve the produced binary where it was assembled
  // to run — its first ORG, else the configured `org` — the one load-origin rule `run`,
  // `verify` and the observe commands share (cli.md CLI-PROD-CONV-ORIGIN-001).
  const resolved = resolveConfig({ cwd });
  const { envelope: build, program: built } = buildProject({ cwd, outDir: resolved.outDir });
  if (!build.ok) {
    throw userError(buildFailureMessage(build.errorCount, build.entry, build.errors), 'preview');
  }
  if (!built) throw userError('Cannot preview: the build produced no binary', 'preview');
  const org = programLoadOrigin(built.origin, () => parseAddress(resolved.org, 'preview'));
  const program: PreviewProgram = {
    mode: 'project',
    kind: 'bin',
    bytes: built.bytes,
    org,
    label: `${build.entry} @ 0x${org.toString(16).toUpperCase()}`,
  };
  checkProgramLoads(program, `the build of ${build.entry}`);
  return program;
}

/**
 * The preview message for a failed build: the count, then the first few
 * diagnostics as `file:line: message`, so `preview --watch`/`--detach` show the
 * real assembler error instead of only pointing at `zxs build`.
 */
function buildFailureMessage(errorCount: number, entry: string, errors: readonly BuildDiagnostic[]): string {
  const lines = [
    `Cannot preview: build failed with ${errorCount} error(s) in ${entry} (run \`zxs build\` for details)` +
      (errors.length > 0 ? ':' : ''),
  ];
  for (const d of errors.slice(0, QUOTED_BUILD_ERRORS)) lines.push(`  ${d.file}:${d.line}: ${d.message}`);
  if (errors.length > QUOTED_BUILD_ERRORS) lines.push(`  … and ${errors.length - QUOTED_BUILD_ERRORS} more`);
  return lines.join('\n');
}

/**
 * Decode the program the way the player will (./player-boot.ts) and turn any
 * problem into a USER_ERROR naming `what` — so a bad file fails before serving.
 */
function checkProgramLoads(program: PreviewProgram, what: string): void {
  try {
    bootPreviewProgram(program.kind, program.bytes, program.org, loadRom());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`preview: cannot load ${what}: ${reason}`, 'preview');
  }
}

/** Resolve a `<file>` program by its extension (CLI-PROD-PREVIEW-002 `play` mode). */
function resolveFileProgram(file: string, cwd: string): PreviewProgram {
  const abs = resolve(cwd, file);
  const ext = extname(file).toLowerCase();

  if (ext === '.sna') {
    // The tracked gap: `@zx-vibes/machine` ships no `.sna` codec — fail loud, never guess.
    throw userError(
      `preview of "${file}" is not supported: @zx-vibes/machine ships no .sna codec ` +
        '(a tracked core-codec gap — the core needs a .sna reader). Use a .z80 snapshot or a ' +
        '.tap/.tzx tape image instead.',
      'preview',
    );
  }

  if (ext === '.z80' || ext === '.tap' || ext === '.tzx') {
    const bytes = readProgramFile(abs);
    const kind = ext.slice(1) as 'z80' | 'tap' | 'tzx';
    const program: PreviewProgram = { mode: 'file', kind, bytes, org: 0, label: `${file} (${kind})` };
    checkProgramLoads(program, `"${file}"`);
    return program;
  }

  if (ext === '.bin') {
    // A raw binary is a friendly extra (load at the configured org); the spec lists
    // z80/sna/tap/tzx, but a `.bin` is unambiguous and matches `run --bin`.
    const resolved = resolveConfig({ cwd });
    const org = parseAddress(resolved.org, 'preview');
    const bytes = readProgramFile(abs);
    const program: PreviewProgram = {
      mode: 'file',
      kind: 'bin',
      bytes,
      org,
      label: `${file} @ 0x${org.toString(16).toUpperCase()}`,
    };
    checkProgramLoads(program, `"${file}"`);
    return program;
  }

  throw userError(
    `preview: unsupported file type "${ext || file}". Supported: .z80 snapshot, .tap/.tzx tape, ` +
      '.bin raw image. (.sna is unsupported — no core codec.)',
    'preview',
  );
}

function readProgramFile(abs: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(abs));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`preview: cannot read "${abs}": ${reason}`, 'preview');
  }
}
