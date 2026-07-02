// Stateless session — toolkit-runtime.md RT-PROD-SESSION-001..003,
// RT-PROD-CONFIG-001, RT-PROD-RULE-ROMCACHE-001.
//
// A thin abstraction over `@zx-vibes/machine`. The generative loop is
// STATELESS / FRESH BY DEFAULT: every command boots a clean 48K ROM machine
// (RT-PROD-SESSION-001). Persistence/resume is an explicit opt-in via `--state`
// (RT-PROD-SESSION-003) — wired here as a seam; the on-disk resume/save codec
// lands in a later slice.
//
// The machine-source interface is designed to admit every documented source
// (fresh / z80 / sna / tap / bin / resume, RT-PROD-SESSION-002); only `fresh` is
// implemented in this slice. Unimplemented sources fail loudly rather than
// silently mis-booting (errors.md ERR-PROD-NOSILENT-001).

import { readFileSync } from 'node:fs';
import { createMachine, RESET_REGISTERS, type Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import { romBootMemory } from './rom.js';

/** Bottom of RAM — a raw binary must load at or above this (it cannot overwrite ROM). */
export const RAM_BASE = 0x4000;
/** Default raw-binary load origin as a number (config `org` default, CLI-PROD-CONV-SOURCE-001). */
export const DEFAULT_BIN_ORG = 0x8000;

/**
 * Where a session's machine comes from (RT-PROD-SESSION-002). `fresh` is the
 * stateless default; the file-backed sources are seams for later slices.
 */
export type MachineSource =
  | { kind: 'fresh' }
  | { kind: 'z80'; file: string }
  | { kind: 'sna'; file: string }
  | { kind: 'tap'; file: string }
  | { kind: 'bin'; file: string; org?: number }
  | { kind: 'resume'; file: string };

export const FRESH_SOURCE: MachineSource = { kind: 'fresh' };

export interface SessionOptions {
  /** The machine source (default: a fresh clean-ROM boot). */
  source?: MachineSource;
  /** Opt-in persistent session file (`--state`); enables save-after-mutate. */
  state?: string | undefined;
  /** Suppress persistence even when a state file is set (`--no-save`/`--read-only`). */
  noSave?: boolean;
}

/**
 * A booted session: the live machine plus its provenance and persistence intent.
 * Under the default stateless loop `persistent` is false and there is nothing to
 * save (RT-PROD-SESSION-003).
 */
export class Session {
  readonly machine: Machine;
  readonly source: MachineSource;
  /** True iff an explicit `--state` file opted into a persistent session. */
  readonly persistent: boolean;
  readonly statePath: string | undefined;
  readonly noSave: boolean;

  constructor(machine: Machine, source: MachineSource, options: SessionOptions) {
    this.machine = machine;
    this.source = source;
    this.statePath = options.state;
    this.persistent = options.state !== undefined;
    this.noSave = options.noSave ?? false;
  }

  /**
   * Persist the session to its `--state` file. Seam for the persistent-session
   * slice (Slice 7); under the stateless default there is nothing to persist, and
   * an unimplemented persistent save fails loudly rather than silently no-op'ing.
   */
  save(): void {
    if (!this.persistent || this.noSave) return;
    throw userError(
      'Persistent session save is not implemented yet (planned for the session slice)',
      'state',
    );
  }
}

/**
 * Boot a fresh, clean 48K ROM machine (the stateless default). Reuses the cached
 * ROM image for a deterministic, cheap boot (RT-PROD-RULE-ROMCACHE-001) while
 * giving each boot an independent address space (RT-PROD-SESSION-001).
 */
export function bootFreshMachine(): Machine {
  return createMachine({ memory: romBootMemory(), registers: { ...RESET_REGISTERS } });
}

/**
 * Boot a fresh clean-ROM machine and load a raw binary's bytes at `org`, with PC set
 * to `org` so the program is the entry point (RT-PROD-SESSION-002, the `bin` source;
 * CLI-PROD-CONV-SOURCE-001). The binary must fit RAM `0x4000-0xFFFF` — an origin below
 * RAM or an overrun past `0xFFFF` is a USER_ERROR, never a silent mis-load
 * (errors.md ERR-PROD-EMU-001 / ERR-PROD-NOSILENT-001).
 */
export function loadBinMachine(file: string, org: number = DEFAULT_BIN_ORG): Machine {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Cannot read binary "${file}": ${reason}`);
  }
  return loadBytesMachine(bytes, org);
}

/**
 * Boot a fresh clean-ROM machine and load already-in-memory program bytes at `org`,
 * with PC set to `org` (RT-PROD-SESSION-002, the `bin` source assembled in-memory by
 * the test runner — REC-PROD-RUN-001, "assemble `build` to a temp output"). Shares the
 * RAM-range validation with {@link loadBinMachine}: an origin below RAM or an overrun
 * past 0xFFFF is a USER_ERROR, never a silent mis-load (ERR-PROD-EMU-001 / -NOSILENT-001).
 */
export function loadBytesMachine(bytes: Uint8Array, org: number = DEFAULT_BIN_ORG): Machine {
  if (org < RAM_BASE) {
    throw userError(
      `Load origin 0x${org.toString(16).toUpperCase()} is below RAM (0x4000); a binary cannot overwrite ROM`,
    );
  }
  if (org + bytes.length > 0x10000) {
    throw userError(
      `Binary does not fit RAM: ${bytes.length} bytes at 0x${org
        .toString(16)
        .toUpperCase()} overruns 0xFFFF`,
    );
  }
  const machine = bootFreshMachine();
  machine.memory.set(bytes, org);
  machine.registers.pc = org;
  return machine;
}

/**
 * Create a session from a machine source (RT-PROD-SESSION-002). Only the fresh
 * boot is implemented in this slice; the file-backed sources are recognized but
 * deferred — they throw a USER_ERROR instead of mis-booting.
 */
export function createSession(options: SessionOptions = {}): Session {
  const source = options.source ?? FRESH_SOURCE;
  const machine = bootMachine(source, options);
  return new Session(machine, source, options);
}

function bootMachine(source: MachineSource, _options: SessionOptions): Machine {
  switch (source.kind) {
    case 'fresh':
      return bootFreshMachine();
    case 'bin':
      return loadBinMachine(source.file, source.org ?? DEFAULT_BIN_ORG);
    case 'z80':
    case 'sna':
    case 'tap':
    case 'resume':
      throw userError(
        `Machine source "${source.kind}" is not implemented yet (planned for a later slice)`,
      );
    default: {
      // Exhaustiveness guard: a new source kind must be handled explicitly.
      const exhaustive: never = source;
      throw userError(`Unknown machine source: ${JSON.stringify(exhaustive)}`);
    }
  }
}
