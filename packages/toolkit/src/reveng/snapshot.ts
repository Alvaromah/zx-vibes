// `zxs snapshot` — inspect a THIRD-PARTY snapshot (cli.md CLI-PROD-REVENG-001, ADR-0027 D5).
//
// The optional reverse-engineering add-on's snapshot inspector, with three sub-commands:
//   - `snapshot info <file>` : report the snapshot metadata. The LEGACY JSON shape is
//     PRESERVED here (CLI-PROD-REVENG-001 names it exactly): `{ format, version,
//     hardwareMode, … }`. `format`/`version`/`hardwareMode` are the pinned keys; the rest
//     (border, a register summary) is Incidental (CLI-PROD-FREE-001) — no fixture pins it.
//   - `snapshot mem <file> <addr> [--len n]` : read `n` bytes at `addr` (a bounded hexdump).
//   - `snapshot ram <file> [--range from-to] [--out file]` : dump a memory region (default
//     the whole 48K RAM 0x4000-0xFFFF) to a file (+ hash) or inline (bounded).
//
// The toolkit is 48K-only (CLI-PROD-SCOPE-001) and `readZ80` decodes only the 48K variant,
// so `hardwareMode` is always `"48K"` for a loadable snapshot. `.sna` fails loud (W4-GAP-03).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { hashBytes } from '../observe/screen.js';
import { asciiBytes, hexBytes } from '../observe/memory.js';
import { parseAddress, parseNumber, parseRange } from '../util/address.js';
import { loadSnapshotFile } from './snapshot-source.js';

/** Default `snapshot mem` read length (one hexdump row), mirroring core `mem read`. */
export const DEFAULT_SNAPSHOT_MEM_LEN = 16;
/** Inline-dump cap for `snapshot ram` without `--out` (larger regions require `--out`). */
export const SNAPSHOT_RAM_INLINE_CAP = 2048;
/** The 48K RAM window (`snapshot ram`'s default range). */
export const RAM_FROM = 0x4000;
export const RAM_TO = 0xffff;

/** The `snapshot info` metadata report — LEGACY shape (CLI-PROD-REVENG-001). */
export type SnapshotInfoEnvelope = {
  ok: true;
  stage: 'snapshot';
  op: 'info';
  /** Pinned: the snapshot container format. */
  format: 'z80';
  /** Pinned: the snapshot version (1/2/3) from `readZ80`. */
  version: number;
  /** Pinned: the hardware mode (always "48K" for a loadable snapshot; the toolkit is 48K-only). */
  hardwareMode: string;
  /** Incidental: border colour 0..7. */
  border: number;
  /** Incidental: a compact register summary (PC/SP + interrupt state). */
  registers: { pc: number; sp: number; i: number; im: number; iff1: number };
  /** Incidental: the file path as given (normalizable). */
  file: string;
};

export type SnapshotDumpEnvelope = {
  ok: true;
  stage: 'snapshot';
  op: 'mem' | 'ram';
  file: string;
  addr?: number;
  range?: { from: number; to: number };
  len: number;
  bytes?: number[];
  hex?: string;
  ascii?: string;
  out?: string;
  hash?: string;
};

export type SnapshotEnvelope = SnapshotInfoEnvelope | SnapshotDumpEnvelope;

const REG = (registers: Record<string, number>, name: string): number => (registers[name] ?? 0) & 0xff;
const REG16 = (registers: Record<string, number>, name: string): number => (registers[name] ?? 0) & 0xffff;

export interface SnapshotInfoOptions {
  cwd?: string | undefined;
  file: string;
}

/** `snapshot info <file>` — the LEGACY `{ format, version, hardwareMode, … }` report. */
export function runSnapshotInfo(options: SnapshotInfoOptions): SnapshotInfoEnvelope {
  const image = loadSnapshotFile(options.file, options.cwd ?? process.cwd(), 'snapshot');
  const r = image.registers;
  return {
    ok: true,
    stage: 'snapshot',
    op: 'info',
    format: 'z80',
    version: image.source.version ?? 0,
    hardwareMode: '48K',
    border: image.border ?? 0,
    registers: {
      pc: REG16(r, 'pc'),
      sp: REG16(r, 'sp'),
      i: REG(r, 'i'),
      im: (r.im ?? 0) & 0x03,
      iff1: r.iff1 ? 1 : 0,
    },
    file: options.file,
  };
}

export interface SnapshotMemOptions {
  cwd?: string | undefined;
  file: string;
  addr: string;
  len?: string | undefined;
}

/** `snapshot mem <file> <addr> [--len n]` — read `n` bytes at `addr` (a bounded hexdump). */
export function runSnapshotMem(options: SnapshotMemOptions): SnapshotDumpEnvelope {
  const addr = parseAddress(options.addr, 'snapshot');
  const len = options.len !== undefined ? parseLen(options.len) : DEFAULT_SNAPSHOT_MEM_LEN;
  const image = loadSnapshotFile(options.file, options.cwd ?? process.cwd(), 'snapshot');
  const end = Math.min(addr + len, 0x10000);
  const bytes = image.memory.slice(addr, end);
  return {
    ok: true,
    stage: 'snapshot',
    op: 'mem',
    file: options.file,
    addr,
    len: bytes.length,
    bytes: Array.from(bytes),
    hex: hexBytes(bytes),
    ascii: asciiBytes(bytes),
  };
}

export interface SnapshotRamOptions {
  cwd?: string | undefined;
  file: string;
  range?: string | undefined;
  out?: string | undefined;
}

/** `snapshot ram <file> [--range from-to] [--out file]` — dump a region (default whole 48K RAM). */
export function runSnapshotRam(options: SnapshotRamOptions): SnapshotDumpEnvelope {
  const range =
    options.range !== undefined
      ? parseRange(options.range, 'snapshot')
      : { from: RAM_FROM, to: RAM_TO };
  const image = loadSnapshotFile(options.file, options.cwd ?? process.cwd(), 'snapshot');
  const bytes = image.memory.slice(range.from, range.to + 1);
  if (options.out !== undefined) {
    const out = resolve(options.cwd ?? process.cwd(), options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    return {
      ok: true,
      stage: 'snapshot',
      op: 'ram',
      file: options.file,
      range,
      len: bytes.length,
      out: options.out,
      hash: hashBytes(bytes),
    };
  }
  if (bytes.length > SNAPSHOT_RAM_INLINE_CAP) {
    throw userError(
      `snapshot ram region is ${bytes.length} bytes (> ${SNAPSHOT_RAM_INLINE_CAP} inline cap); ` +
        'narrow it with --range <from-to> or write it with --out <file>',
      'snapshot',
    );
  }
  return {
    ok: true,
    stage: 'snapshot',
    op: 'ram',
    file: options.file,
    range,
    len: bytes.length,
    bytes: Array.from(bytes),
    hex: hexBytes(bytes),
    ascii: asciiBytes(bytes),
    hash: hashBytes(bytes),
  };
}

function parseLen(input: string): number {
  const n = parseNumber(input);
  if (n === undefined || n < 1) {
    throw userError(`Invalid --len: "${input}" (expected a positive integer)`, 'snapshot');
  }
  return n;
}

/** Map the CLI context onto the `snapshot` sub-commands. */
export function snapshotCommand(context: CommandContext): SnapshotEnvelope {
  const sub = context.args[0];
  const options = context.options as Record<string, unknown>;
  const cwd = process.cwd();
  if (sub === undefined) {
    throw userError('snapshot requires a sub-command: `info` | `mem` | `ram`', 'snapshot');
  }
  if (sub === 'info') {
    const file = requireFile(context.args[1], 'snapshot info <file.z80>');
    return runSnapshotInfo({ cwd, file });
  }
  if (sub === 'mem') {
    const file = requireFile(context.args[1], 'snapshot mem <file.z80> <addr> [--len n]');
    const addr = context.args[2];
    if (addr === undefined) {
      throw userError('snapshot mem requires <addr>, e.g. `snapshot mem game.z80 0x8000 --len 32`', 'snapshot');
    }
    return runSnapshotMem({ cwd, file, addr, len: options.len as string | undefined });
  }
  if (sub === 'ram') {
    const file = requireFile(context.args[1], 'snapshot ram <file.z80> [--range from-to]');
    return runSnapshotRam({
      cwd,
      file,
      range: options.range as string | undefined,
      out: options.out as string | undefined,
    });
  }
  throw userError(`Unknown snapshot sub-command: "${sub}" (expected info | mem | ram)`, 'snapshot');
}

function requireFile(file: string | undefined, usage: string): string {
  if (file === undefined) {
    throw userError(`${usage} requires a snapshot file`, 'snapshot');
  }
  return file;
}

/** Declare the `snapshot` command's arguments / flags (CLI-PROD-REVENG-001). */
export function configureSnapshotCommand(command: Command): void {
  command
    .description('[reveng add-on] Inspect a third-party snapshot (info | mem | ram)')
    .argument('[args...]', '`info <file>`, `mem <file> <addr>`, or `ram <file>`')
    .option('--len <n>', `bytes to read for \`snapshot mem\` (default ${DEFAULT_SNAPSHOT_MEM_LEN})`)
    .option('--range <from-to>', 'inclusive region for `snapshot ram` (default the 48K RAM)')
    .option('--out <file>', 'write the `snapshot ram` bytes to this file')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
