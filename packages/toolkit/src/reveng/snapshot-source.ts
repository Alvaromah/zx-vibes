// Reverse-engineering snapshot / memory source (cli.md CLI-PROD-REVENG-001, ADR-0027 D5).
//
// The add-on inspects THIRD-PARTY games, which arrive as snapshots — so unlike the core
// observe cluster (which sources the agent's OWN build / `--bin` / fresh boot), the reveng
// commands load a `.z80` snapshot into a 64 KB memory image and expose it read-only.
//
// SOURCES (matching CLI-PROD-CONV-SOURCE-001's `--z80` / `--sna` / `--bin` list):
//   - `--z80 <file>` : decoded via `@zx-vibes/machine` `readZ80` (the SOLE .z80 codec) →
//     registers + 64 KB memory + border + snapshot version.
//   - `--sna <file>` : FAILS LOUD — `@zx-vibes/machine` ships no `.sna` reader (the tracked
//     core-codec gap W4-GAP-03). We never invent a codec (ERR-PROD-NOSILENT-001).
//   - `--bin <file>` : a raw memory dump loaded at `--org` (default 0x8000) into a zeroed
//     64 KB image — the RE case where only a code/data blob is available.
//
// This is the one loader behind `snapshot` / `scan` / `xref` / reveng `gfx`; each reads the
// resulting `memory` (never runs it), so the add-on is a pure static-analysis layer.

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { readZ80 } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import { parseAddress } from '../util/address.js';

/** Default load origin for a raw `--bin` memory dump (matches core `--bin` / CLI-PROD-CONV-SOURCE-001). */
export const DEFAULT_BIN_ORG = 0x8000;

/** How a reveng command sourced its 64 KB memory image (the provenance it reports). */
export interface RevengSource {
  kind: 'z80' | 'bin';
  /** The file path as given (portable / normalizable across machines). */
  file: string;
  /** Snapshot container format (`z80` for a `.z80`; absent for a raw `--bin`). */
  format?: 'z80';
  /** Snapshot version (1/2/3) reported by `readZ80` (`.z80` only). */
  version?: number;
  /** Load origin of a raw `--bin` dump. */
  org?: number;
}

/** A loaded, NON-running snapshot: a full 64 KB image plus its register file + provenance. */
export interface RevengImage {
  /** The 64 KB memory image (`readZ80`'s memory, or a raw `--bin` loaded at `org`). */
  memory: Uint8Array;
  /** The snapshot register file (empty for a raw `--bin`, which carries no registers). */
  registers: Record<string, number>;
  /** The border colour (0..7) from a `.z80`; `undefined` for a raw `--bin`. */
  border?: number;
  source: RevengSource;
}

export interface RevengSourceOptions {
  cwd?: string | undefined;
  /** `--z80 <file>` — a `.z80` snapshot (the primary reveng source). */
  z80?: string | undefined;
  /** `--sna <file>` — a `.sna` snapshot (FAILS LOUD: no core codec, W4-GAP-03). */
  sna?: string | undefined;
  /** `--bin <file>` — a raw memory dump. */
  bin?: string | undefined;
  /** `--org <addr>` — load origin for `--bin` (default 0x8000). */
  org?: string | undefined;
  /** Command name, so a sourcing failure carries the command's stage in its envelope. */
  stage?: string | undefined;
}

/** The fail-loud message for `.sna` (no `@zx-vibes/machine` codec — W4-GAP-03). */
export function snaUnsupported(file: string, stage: string): never {
  throw userError(
    `Cannot load "${file}": @zx-vibes/machine ships no .sna codec (a tracked core-codec gap, ` +
      'W4-GAP-03 — the core needs a .sna reader). Use a .z80 snapshot instead.',
    stage,
  );
}

/** Read + decode a `.z80` file into a `RevengImage` via the sole `readZ80` codec. */
function loadZ80(given: string, cwd: string, stage: string): RevengImage {
  const abs = resolve(cwd, given);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot read .z80 snapshot "${given}": ${reason}`, stage);
  }
  const snap = readZ80(bytes);
  return {
    memory: snap.memory,
    registers: snap.registers,
    border: snap.border,
    source: { kind: 'z80', file: given, format: 'z80', version: snap.version },
  };
}

/** Load a raw `--bin` dump into a zeroed 64 KB image at `org`. */
function loadBin(given: string, org: number, cwd: string, stage: string): RevengImage {
  const abs = resolve(cwd, given);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot read --bin "${given}": ${reason}`, stage);
  }
  const memory = new Uint8Array(0x10000);
  memory.set(bytes.subarray(0, 0x10000 - org), org);
  return {
    memory,
    registers: {},
    source: { kind: 'bin', file: given, org },
  };
}

/**
 * Source a read-only 64 KB image for a reveng command (`scan` / `xref` / `gfx`). Exactly
 * one of `--z80` / `--sna` / `--bin` selects it; `--sna` fails loud (W4-GAP-03), and giving
 * none is a USER_ERROR naming the required flags (never a silent empty machine).
 */
export function loadRevengImage(options: RevengSourceOptions): RevengImage {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? 'reveng';
  if (options.sna !== undefined) snaUnsupported(options.sna, stage);
  if (options.z80 !== undefined) return loadZ80(options.z80, cwd, stage);
  if (options.bin !== undefined) {
    const org = options.org !== undefined ? parseAddress(options.org, stage) : DEFAULT_BIN_ORG;
    return loadBin(options.bin, org, cwd, stage);
  }
  throw userError(
    `${stage} requires a source: --z80 <file> (a snapshot) or --bin <file> (a raw memory dump)`,
    stage,
  );
}

/**
 * Load the positional `<file>` of the `snapshot` command, dispatching by extension:
 * `.z80` → `readZ80`; `.sna` → fail loud (W4-GAP-03); anything else is an unsupported
 * snapshot type (never guessed). `snapshot` is specifically a *snapshot* inspector, so a
 * raw `--bin` is not one of its inputs (use `scan --bin` / `xref --bin` for a raw dump).
 */
export function loadSnapshotFile(given: string, cwd: string, stage: string): RevengImage {
  const ext = extname(given).toLowerCase();
  if (ext === '.z80') return loadZ80(given, resolve(cwd), stage);
  if (ext === '.sna') snaUnsupported(given, stage);
  throw userError(
    `Unsupported snapshot "${given}" (extension "${ext || '(none)'}"). ` +
      'Supported: .z80 (a .sna reader is a tracked core gap, W4-GAP-03).',
    stage,
  );
}
