// The ONE machine file-source loader — cli.md CLI-PROD-CONV-SOURCE-001 (the machine
// source-selection convention), CLI-PROD-RUN-001 (`run` boots from a `--bin`/`--z80`/
// `--tap`/`--sna` source), MCP-PROD-TOOL-RUN-001 (`zx_run` z80/tap/sna params).
//
// `run`, the observe cluster (`src/observe/source.ts`), and the MCP `zx_run` tool all
// select their machine from the SAME file-image sources, so the source contract is
// defined ONCE here rather than re-derived per surface (no drift). This mirrors the
// exact load the bundled preview player performs (`packages/toolkit/player/main.js`):
//   - `--bin`  : raw bytes loaded at `--org` (default 0x8000) into a fresh 48K ROM boot.
//   - `--z80`  : decoded via `@zx-vibes/machine` `readZ80` (v1/v2/v3) → registers + 64 KB
//     memory + border, mapped onto a fresh ROM machine (RAM overlaid, ROM preserved).
//   - `--tap`  : parsed via `parseTap`, then each CODE block instant-loaded to its declared
//     address via `instantLoad` (the exact codecs `state export --tap`/`build --tap`
//     round-trip and the player uses); PC enters the first CODE block.
//   - `--sna`  : FAILS LOUD — `@zx-vibes/machine` ships no `.sna` reader (the tracked
//     core-codec gap W4-GAP-03). We never invent a codec (errors.md ERR-PROD-NOSILENT-001).
//
// Nothing here runs the machine; the caller (run / observe / MCP) decides that.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { instantLoad, parseTap, readZ80, type Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import { parseAddress } from '../util/address.js';
import { TAPE_TYPE_CODE } from '../build/formats.js';
import { DEFAULT_BORDER } from './io-device.js';
import {
  bootFreshMachine,
  loadBytesMachine,
  DEFAULT_BIN_ORG,
  RAM_BASE,
} from './session.js';

/** The concrete file-image source kinds (CLI-PROD-CONV-SOURCE-001). */
export type FileSourceKind = 'bin' | 'z80' | 'tap' | 'sna';

/** The file-source flags every surface (run / observe / MCP) shares. */
export interface MachineSourceOptions {
  cwd?: string | undefined;
  /** Command name, so a sourcing failure carries the command's stage in its envelope. */
  stage?: string | undefined;
  /** `--bin <file>` — raw memory image loaded at `--org`. */
  bin?: string | undefined;
  /** `--z80 <file>` — a `.z80` v1/v2/v3 snapshot. */
  z80?: string | undefined;
  /** `--tap <file>` — a `.tap` tape image (CODE blocks instant-loaded). */
  tap?: string | undefined;
  /** `--sna <file>` — a `.sna` snapshot (FAILS LOUD: no core codec, W4-GAP-03). */
  sna?: string | undefined;
  /** `--org <addr>` — load origin for `--bin` (default 0x8000). */
  org?: string | undefined;
}

/** How a file source booted the machine (the `boot` descriptor it reports). */
export interface LoadedMachineBoot {
  source: 'bin' | 'z80' | 'tap';
  /** The reported load origin (PC): the `--org` for `--bin`, else the snapshot/tape entry. */
  org: number;
  /** The source file as given (portable / normalizable across machines). */
  file: string;
  /** Snapshot version (1/2/3) reported by `readZ80` (`.z80` only). */
  version?: number;
}

/** A loaded, NON-running machine plus its provenance. */
export interface LoadedMachine {
  machine: Machine;
  /** Entry / load origin (also the machine's PC). */
  org: number;
  /**
   * The RAM floor the hang heuristics treat as the program's RAM base: `--bin` uses
   * its load origin (a bin program lives at `org`); a snapshot / tape lives across RAM
   * so its floor is `RAM_BASE` (a PC in ROM is still suspicious).
   */
  ramFloor: number;
  /** The border colour (snapshot border for `.z80`, else the boot default). */
  border: number;
  boot: LoadedMachineBoot;
  /** Loaded program length in bytes (0 for a whole-image `.z80` snapshot). */
  length: number;
}

/** The fail-loud message for a `.sna` source (no `@zx-vibes/machine` codec — W4-GAP-03). */
export function snaUnsupportedMessage(file: string): string {
  return (
    `Cannot load "${file}": @zx-vibes/machine ships no .sna codec (a tracked core-codec gap, ` +
    'W4-GAP-03 — the core needs a .sna reader). Use a .z80 snapshot or a .tap/.tzx tape image instead.'
  );
}

/** Fail loud on a `.sna` source (the SAME honest missing-codec verdict `preview <file.sna>` uses). */
export function failSnaUnsupported(file: string, stage: string): never {
  throw userError(snaUnsupportedMessage(file), stage);
}

/**
 * Which single file source (if any) the options select. Exactly one may be given; more
 * than one is a USER_ERROR (never a silent last-one-wins mis-source, ERR-PROD-NOSILENT-001).
 */
export function selectedFileSource(options: MachineSourceOptions): FileSourceKind | undefined {
  const present: FileSourceKind[] = [];
  if (options.bin !== undefined) present.push('bin');
  if (options.z80 !== undefined) present.push('z80');
  if (options.tap !== undefined) present.push('tap');
  if (options.sna !== undefined) present.push('sna');
  if (present.length === 0) return undefined;
  if (present.length > 1) {
    throw userError(
      `Multiple machine sources given (${present.map((k) => `--${k}`).join(', ')}); choose exactly one.`,
      options.stage ?? 'run',
    );
  }
  return present[0];
}

/**
 * Load a NON-running machine from a file-image source (CLI-PROD-CONV-SOURCE-001). Exactly
 * one of `--bin` / `--z80` / `--tap` / `--sna` selects it; `--sna` fails loud (W4-GAP-03).
 * Throws if no file source is present (the caller guards with {@link selectedFileSource}).
 */
export function loadMachineFromSource(options: MachineSourceOptions): LoadedMachine {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? 'run';
  const kind = selectedFileSource(options);
  if (kind === undefined) {
    throw userError(
      'No machine source given (expected one of --bin / --z80 / --tap / --sna)',
      stage,
    );
  }
  switch (kind) {
    case 'bin':
      return loadBin(options.bin!, options.org, cwd, stage);
    case 'z80':
      return loadZ80(options.z80!, cwd, stage);
    case 'tap':
      return loadTap(options.tap!, cwd, stage);
    case 'sna':
      // No core `.sna` codec (W4-GAP-03) — fail loud (returns `never`).
      return failSnaUnsupported(options.sna!, stage);
  }
}

/** Read + decode a `.z80` snapshot onto a fresh ROM machine (RAM overlaid, ROM preserved). */
function loadZ80(given: string, cwd: string, stage: string): LoadedMachine {
  const bytes = readSourceFile(given, cwd, stage, '.z80 snapshot');
  const snap = readZ80(bytes);
  const machine = bootFreshMachine();
  // The `.z80` memory image carries the 48K RAM (0x4000–0xFFFF); the ROM region it omits
  // (0x0000–0x3FFF) stays the fresh-boot ROM (the same overlay the preview player does).
  machine.memory.set(snap.memory.subarray(0x4000, 0x10000), 0x4000);
  Object.assign(machine.registers, snap.registers);
  const org = (machine.registers.pc ?? 0) & 0xffff;
  return {
    machine,
    org,
    ramFloor: RAM_BASE,
    border: (snap.border ?? DEFAULT_BORDER) & 0x07,
    boot: { source: 'z80', org, file: given, version: snap.version },
    length: 0,
  };
}

/**
 * Read + instant-load a `.tap` tape onto a fresh ROM machine. Each standard CODE header
 * (flag 0x00, type 3) with a following data block is instant-loaded to the header's declared
 * load address (`param1`) via `instantLoad`; PC enters the FIRST CODE block. A tape with no
 * CODE block (a BASIC-loader tape) fails loud, pointing at `preview` (which drives the ROM
 * `LOAD ""` autoload in the player) — never a silent mis-boot.
 */
function loadTap(given: string, cwd: string, stage: string): LoadedMachine {
  const bytes = readSourceFile(given, cwd, stage, '.tap tape');
  let parsed: ReturnType<typeof parseTap>;
  try {
    parsed = parseTap(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot parse .tap tape "${given}": ${reason}`, stage);
  }
  // Raw block bodies `[flag, ...data, checksum]` — the `instantLoad` input shape.
  const blocks = parsed.map((b) => Uint8Array.of(b.flag & 0xff, ...b.data, b.checksum & 0xff));
  const machine = bootFreshMachine();

  let entry: number | undefined;
  let loadedTotal = 0;
  for (let i = 0; i < blocks.length; ) {
    const header = parseStandardHeader(blocks[i]!);
    if (header && header.type === TAPE_TYPE_CODE && i + 1 < blocks.length) {
      const data = blocks[i + 1]!;
      const dest = header.param1 & 0xffff;
      instantLoad(machine, data, { ix: dest, de: header.length & 0xffff, flag: 0xff, load: true });
      if (entry === undefined) entry = dest;
      loadedTotal += header.length & 0xffff;
      i += 2;
    } else {
      i += 1;
    }
  }
  if (entry === undefined) {
    throw userError(
      `Cannot boot .tap "${given}": no CODE block found. The run/observe tape loader ` +
        'instant-loads CODE tapes (as `build --tap` / `state export --tap` produce). For a ' +
        'BASIC-loader tape, use `zxs preview <file.tap>` to autoload it in the player.',
      stage,
    );
  }
  machine.registers.pc = entry;
  return {
    machine,
    org: entry,
    ramFloor: RAM_BASE,
    border: DEFAULT_BORDER,
    boot: { source: 'tap', org: entry, file: given },
    length: loadedTotal,
  };
}

/** Read + load a raw `--bin` image at `org` into a fresh ROM machine (shares the RAM guard). */
function loadBin(given: string, orgFlag: string | undefined, cwd: string, stage: string): LoadedMachine {
  const org = orgFlag !== undefined ? parseAddress(orgFlag, stage) : DEFAULT_BIN_ORG;
  const bytes = readSourceFile(given, cwd, stage, 'binary');
  const machine = loadBytesMachine(bytes, org);
  return {
    machine,
    org,
    ramFloor: org,
    border: DEFAULT_BORDER,
    boot: { source: 'bin', org, file: given },
    length: bytes.length,
  };
}

/** Read a source file's bytes, mapping an I/O failure to a staged USER_ERROR. */
function readSourceFile(given: string, cwd: string, stage: string, label: string): Uint8Array {
  const abs = resolve(cwd, given);
  try {
    return new Uint8Array(readFileSync(abs));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot read ${label} "${given}": ${reason}`, stage);
  }
}

/**
 * Parse a standard 17-byte ZX tape header from a block body into `{ type, length, param1 }`
 * (file-formats FMT-TAP / `tapeCodeHeader`). The body is `[flag(0x00)][17 header bytes]
 * [checksum]` = 19 bytes; a non-header block (flag ≠ 0x00) or a short body returns `null`.
 */
function parseStandardHeader(
  body: Uint8Array,
): { type: number; length: number; param1: number } | null {
  if (body.length < 19 || (body[0]! & 0xff) !== 0x00) return null;
  const d = body.subarray(1); // the 17 header data bytes
  return {
    type: d[0]! & 0xff,
    length: (d[11]! & 0xff) | ((d[12]! & 0xff) << 8),
    param1: (d[13]! & 0xff) | ((d[14]! & 0xff) << 8),
  };
}
