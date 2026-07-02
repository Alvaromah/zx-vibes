// `zxs mem` — read / dump session memory (cli.md CLI-PROD-MEM-001,
// RT-PROD-OBSERVE-001).
//
// Slice 7a implements the READ-ONLY half: `mem read <addr> [--len n]` and
// `mem dump --range <from-to> [--out <file>]`. Both source a machine (built entry /
// `--bin` / fresh) and read its address space — a classic hexdump view (raw bytes +
// 2-hex + printable-ASCII). The mutating half — `mem load <addr> --bin <file>` and
// `mem write <addr> <hexBytes>` — writes the session and lands with the persistent-debug
// cluster (Slice 7b); invoking it now is recognized and rejected, not silently ignored
// (ERR-PROD-NOSILENT-001).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseAddress, parseNumber, parseRange } from '../util/address.js';
import { openSession } from '../state/persist.js';
import { hashBytes } from './screen.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
} from './source.js';

/** Default `mem read` length when `--len` is omitted (one hexdump row). */
export const DEFAULT_MEM_LEN = 16;

type MemReport = {
  stage: 'mem';
  boot?: ObserveBoot;
  op: 'read' | 'dump' | 'write' | 'load';
  /** Read/write/load start address. */
  addr?: number;
  /** Dumped range (`dump`). */
  range?: { from: number; to: number };
  len: number;
  /** The bytes, inline (omitted for a `dump --out`, which writes them to a file instead). */
  bytes?: number[];
  /** Space-separated 2-hex bytes, inline (omitted for a `dump --out`). */
  hex?: string;
  /** Printable-ASCII rendering (non-printables as `.`), inline (omitted for a `dump --out`). */
  ascii?: string;
  /** Written dump path (`dump --out`) / loaded source file (`load`). */
  out?: string;
  file?: string;
  /** FNV-1a hash of the dumped bytes (`dump --out`, for change detection). */
  hash?: string;
  /** True iff a `write`/`load` mutation was persisted to a `--state` session. */
  persisted?: boolean;
};

export type MemEnvelope = MemReport & { ok: true };

/** Space-separated uppercase 2-hex rendering of a byte buffer. */
export function hexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Printable-ASCII rendering (0x20..0x7E verbatim, everything else `.`). */
export function asciiBytes(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
  return out;
}

export interface MemReadOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  addr: string;
  len?: string | undefined;
}

export interface MemDumpOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  range: string;
  out?: string | undefined;
}

function source(options: {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
}): {
  machine: Machine;
  boot: ObserveBoot;
} {
  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    state: options.state,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'mem',
  });
  return { machine, boot };
}

/** `mem read <addr> [--len n]` — read `len` bytes from `addr` (clamped to the 64K end). */
export function runMemRead(options: MemReadOptions): MemEnvelope {
  const addr = parseAddress(options.addr, 'mem');
  const len = options.len !== undefined ? parseLen(options.len) : DEFAULT_MEM_LEN;
  const { machine, boot } = source(options);
  const end = Math.min(addr + len, 0x10000);
  const bytes = machine.memory.slice(addr, end);
  return {
    ok: true,
    stage: 'mem',
    boot,
    op: 'read',
    addr,
    len: bytes.length,
    bytes: Array.from(bytes),
    hex: hexBytes(bytes),
    ascii: asciiBytes(bytes),
  };
}

/** `mem dump --range <from-to> [--out <file>]` — dump an inclusive range (to file or inline). */
export function runMemDump(options: MemDumpOptions): MemEnvelope {
  const range = parseRange(options.range, 'mem');
  const { machine, boot } = source(options);
  const bytes = machine.memory.slice(range.from, range.to + 1);
  if (options.out !== undefined) {
    const out = resolve(options.cwd ?? process.cwd(), options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    return {
      ok: true,
      stage: 'mem',
      boot,
      op: 'dump',
      range,
      len: bytes.length,
      out: options.out,
      hash: hashBytes(bytes),
    };
  }
  return {
    ok: true,
    stage: 'mem',
    boot,
    op: 'dump',
    range,
    len: bytes.length,
    bytes: Array.from(bytes),
    hex: hexBytes(bytes),
    ascii: asciiBytes(bytes),
  };
}

function parseLen(input: string): number {
  const n = parseNumber(input);
  if (n === undefined || n < 1) {
    throw userError(`Invalid --len: "${input}" (expected a positive integer)`, 'mem');
  }
  return n;
}

/** Parse `<hexBytes>` for `mem write` — accepts `3E 01 C9` or `3E01C9` (whitespace ignored). */
export function parseHexBytes(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, '');
  if (compact === '' || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) {
    throw userError(
      `Invalid hex bytes: "${input}" (expected an even-length hex string, e.g. "3E 01 C9")`,
      'mem',
    );
  }
  const out = new Uint8Array(compact.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Bounds-check a write of `length` bytes at `addr` (a poke past 0xFFFF is a USER_ERROR). */
function requireFits(addr: number, length: number): void {
  if (addr + length > 0x10000) {
    throw userError(
      `Write does not fit memory: ${length} byte(s) at 0x${addr
        .toString(16)
        .toUpperCase()} overruns 0xFFFF`,
      'mem',
    );
  }
}

export interface MemWriteOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  noSave?: boolean | undefined;
  addr: string;
  hex: string;
}

/** `mem write <addr> <hexBytes>` — poke bytes into the session at `addr`, then persist (CLI-PROD-MEM-001). */
export function runMemWrite(options: MemWriteOptions): MemEnvelope {
  const addr = parseAddress(options.addr, 'mem');
  const bytes = parseHexBytes(options.hex);
  requireFits(addr, bytes.length);
  const session = openSession({ cwd: options.cwd, state: options.state, noSave: options.noSave, stage: 'mem' });
  session.machine.memory.set(bytes, addr);
  session.save();
  return {
    ok: true,
    stage: 'mem',
    op: 'write',
    addr,
    len: bytes.length,
    bytes: Array.from(bytes),
    hex: hexBytes(bytes),
    persisted: session.persistent && options.noSave !== true,
  };
}

export interface MemLoadOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  noSave?: boolean | undefined;
  addr: string;
  /** The payload file whose bytes load at `addr` (`mem load <addr> --bin <file>`). */
  file: string;
}

/** `mem load <addr> --bin <file>` — load a file's bytes into the session at `addr`, then persist. */
export function runMemLoad(options: MemLoadOptions): MemEnvelope {
  const addr = parseAddress(options.addr, 'mem');
  const path = resolve(options.cwd ?? process.cwd(), options.file);
  let payload: Uint8Array;
  try {
    payload = readFileSync(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot read --bin "${options.file}": ${reason}`, 'mem');
  }
  requireFits(addr, payload.length);
  const session = openSession({ cwd: options.cwd, state: options.state, noSave: options.noSave, stage: 'mem' });
  session.machine.memory.set(payload, addr);
  session.save();
  return {
    ok: true,
    stage: 'mem',
    op: 'load',
    addr,
    len: payload.length,
    file: options.file,
    persisted: session.persistent && options.noSave !== true,
  };
}

/** Map the CLI context onto the `mem` read/dump/write/load services. */
export function memCommand(context: CommandContext): MemEnvelope {
  const sub = context.args[0];
  const options = context.options as Record<string, unknown>;
  const state = options.state as string | undefined;
  const noSave = options.save === false || options.readOnly === true;
  const common = {
    cwd: process.cwd(),
    state,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
  };

  // `mem write <addr> <hexBytes>` — mutate the session at an address.
  if (sub === 'write') {
    const addr = context.args[1];
    const hex = context.args.slice(2).join(' ');
    if (addr === undefined || hex.trim() === '') {
      throw userError('mem write requires <addr> <hexBytes>, e.g. `mem write 0x8000 3E 01 C9`', 'mem');
    }
    return runMemWrite({ cwd: process.cwd(), state, noSave, addr, hex });
  }
  // `mem load <addr> --bin <file>` — load a file's bytes into the session.
  if (sub === 'load') {
    const addr = context.args[1];
    const file = options.bin as string | undefined;
    if (addr === undefined) {
      throw userError('mem load requires <addr> --bin <file>', 'mem');
    }
    if (file === undefined) {
      throw userError('mem load requires --bin <file> (the payload to load at <addr>)', 'mem');
    }
    return runMemLoad({ cwd: process.cwd(), state, noSave, addr, file });
  }
  if (sub === 'dump') {
    if (options.range === undefined) {
      throw userError('mem dump requires --range <from-to>', 'mem');
    }
    return runMemDump({ ...common, range: options.range as string, out: options.out as string | undefined });
  }
  // `mem read <addr>` (or the shorthand `mem <addr>`).
  const addr = sub === 'read' ? context.args[1] : sub;
  if (addr === undefined || parseNumber(addr) === undefined) {
    throw userError('mem read requires an address, e.g. `mem read 0x4000 --len 32`', 'mem');
  }
  return runMemRead({ ...common, addr, len: options.len as string | undefined });
}

/** Declare the `mem` command's arguments / flags (CLI-PROD-MEM-001). */
export function configureMemCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Read / dump / write / load session memory')
    .argument('[args...]', '`read <addr>`, `dump`, `write <addr> <hexBytes>`, or `load <addr>`')
    .option('--state <file>', 'read/write an opt-in persistent session (.zxstate)')
    .option('--bin <file>', 'source binary for read/dump, or the payload file for `mem load`')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--len <n>', `bytes to read for \`mem read\` (default ${DEFAULT_MEM_LEN})`)
    .option('--range <from-to>', 'inclusive address range for `mem dump`')
    .option('--out <file>', 'write the `mem dump` bytes to this file')
    .option('--no-save', 'do not persist the mutation (when --state is active)')
    .option('--read-only', 'do not persist the mutation (when --state is active)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
