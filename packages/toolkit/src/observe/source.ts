// Read-only machine sourcing for the observe commands — cli.md
// CLI-PROD-CONV-SOURCE-001, toolkit-runtime.md RT-PROD-OBSERVE-001
// ("over the same machine source-selection").
//
// Every observe command (`screen`/`regs`/`mem`/`disasm`/`step`/`trace`/`symbols`/
// `coverage`) sources a machine the SAME way `run` does — an opt-in `--state` session, a
// `--bin`/`--z80`/`--tap` image, the configured entry assembled fresh, or a clean ROM
// boot — so the cluster shares one resolver instead of re-deriving the source per
// command. It composes the session seams (`loadBinMachine`/`loadBytesMachine`/
// `bootFreshMachine`) and the sole embedded assembler (`@zx-vibes/asm`, ADR-0027 D3).
// Nothing here runs the machine; the executing verbs (`step`/`trace`/`coverage`) save an
// advanced `--state` session back themselves (`persistStateSession`, state/persist.ts).
//
// Unlike `run` (which writes a `.bin` then loads it), the built-entry path assembles
// IN MEMORY: that yields the SLD `symbols` + `sourceMap` the debug cluster needs
// (`disasm` label/`file.asm:line` resolution, `symbols`, `coverage` routines) with no
// disk artifact. The program is loaded at the assembler's own ORIGIN (CLI-PROD-CONV-
// ORIGIN-001, shared with `run`/`verify`) so the symbol addresses line up with the bytes.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { assembleFile, type AssembleResult } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';

// `@zx-vibes/asm` exposes the SLD symbol/source-map element types only through the public
// `AssembleResult`; derive them here so the observe cluster has a single named handle on
// each without reaching past the package's public API.
/** One SLD symbol-table entry: `{ name, value, kind:'F'|'D', file, line }`. */
export type SymbolDef = AssembleResult['symbols'][number];
/** One SLD source-map entry: `{ file, line, addr }`. */
export type SourceMapEntry = AssembleResult['sourceMap'][number];
import { resolveConfig } from '../config/config.js';
import { userError } from '../output/envelope.js';
import { parseAddress } from '../util/address.js';
import {
  bootFreshMachine,
  loadBytesMachine,
  programLoadOrigin,
  RAM_BASE,
} from '../runtime/session.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { loadMachineFromSource, selectedFileSource } from '../runtime/machine-source.js';
import { deserializeZxState } from '../state/zxstate.js';

/** How an observe command's machine was sourced (the `boot` descriptor it reports). */
export interface ObserveBoot {
  source: 'bin' | 'z80' | 'tap' | 'build' | 'fresh' | 'state';
  /**
   * The program's load origin, for a source that has one (`build`, `bin`, `tap`;
   * cli.md CLI-PROD-CONV-BOOT-001). A snapshot, a session or a fresh boot has no known
   * origin and reports `pc` instead.
   */
  org?: number;
  /** `z80`/`state`/`fresh`: the PC the machine starts this command at. */
  pc?: number;
  file?: string;
  /**
   * The configured entry: the program that was assembled and loaded (`build`), or — for a
   * `--state` session — the entry whose SLD symbols label the session's code.
   */
  entry?: string;
  /** Snapshot version (1/2/3) when the source is a `.z80`. */
  version?: number;
}

/** A half-open address range `[from, to)`. */
export interface AddressExtent {
  from: number;
  to: number;
}

/**
 * Where a source's program lives when the image does not say: anywhere in RAM. A `.z80`
 * snapshot or a resumed session carries a whole 48K image, so only the ROM is excluded.
 */
export const RAM_EXTENT: AddressExtent = Object.freeze({ from: RAM_BASE, to: 0x10000 });
/** No program loaded (a clean ROM boot). */
const EMPTY_EXTENT: AddressExtent = Object.freeze({ from: 0, to: 0 });

export interface ObserveSourceOptions {
  /** Project root (defaults to `process.cwd()`). */
  cwd?: string | undefined;
  /**
   * `--state <file>`: resume an opt-in persistent session (CLI-PROD-CONV-SOURCE-001).
   * Highest precedence — a resumed session has no SLD symbols (label specs require a build).
   */
  state?: string | undefined;
  /** `--bin <file>`: load a raw binary at `--org` (no symbols). */
  bin?: string | undefined;
  /** `--z80 <file>`: source a `.z80` snapshot (v1/v2/v3, no symbols). */
  z80?: string | undefined;
  /** `--tap <file>`: source a `.tap` tape (CODE blocks instant-loaded, no symbols). */
  tap?: string | undefined;
  /** `--sna <file>`: source a `.sna` snapshot (FAILS LOUD: no core codec, W4-GAP-03). */
  sna?: string | undefined;
  /** `--org <addr>` override for the `--bin` load origin / fresh-boot default. */
  org?: string | undefined;
  /** Command name, so a sourcing failure carries the command's stage in its envelope. */
  stage?: string | undefined;
  /**
   * A `--state` session carries no SLD of its own. A command that names code by label or
   * reports routines asks for the configured entry's symbols (the same SLD `break add`
   * resolves labels against, CLI-PROD-EDGE-002): `required` fails loud when the entry does
   * not assemble; `best-effort` (label annotations only) goes without. Omitted: no symbols.
   */
  stateSymbols?: 'required' | 'best-effort' | undefined;
}

/** A sourced, NON-running machine plus its provenance and (when built) its SLD debug data. */
export interface ObserveSource {
  machine: Machine;
  /** The load origin (and PC) of the sourced program. */
  org: number;
  boot: ObserveBoot;
  /** The border colour in effect (snapshot border for `.z80`/`--state`, else the boot default). */
  border: number;
  /** Loaded program length in bytes (0 for a fresh boot, a `.z80`, or a session). */
  length: number;
  /**
   * The program's address range — bounds `coverage`'s executed set and `trace --profile`'s
   * label attribution (the user's code, not incidental ROM). A source with no known image
   * bounds (a `.z80`, a `--state` session) spans RAM; a clean ROM boot spans nothing.
   */
  extent: AddressExtent;
  /** SLD symbols from the assembled entry (empty for `--bin` / fresh). */
  symbols: SymbolDef[];
  /** Source map from the assembled entry (empty for `--bin` / fresh) — backs `disasm file.asm:line`. */
  sourceMap: SourceMapEntry[];
}

/**
 * Source a read-only machine for an observe command (RT-PROD-OBSERVE-001). Precedence:
 * an explicit `--bin` raw binary, else the configured project `entry` assembled fresh,
 * else a clean 48K ROM boot (so `zxs regs`/`zxs screen` work with no project, inspecting
 * the boot machine). A build failure is a USER_ERROR carrying the command's stage — it is
 * never a silent mis-source (ERR-PROD-NOSILENT-001).
 */
export function resolveObserveMachine(options: ObserveSourceOptions = {}): ObserveSource {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? 'observe';
  const resolved = resolveConfig({ cwd, flags: { org: options.org } });
  const org = parseAddress(resolved.org, stage);

  // 0. Opt-in persistent session (`--state`) — resume the saved machine. Highest
  // precedence (an explicit session beats any boot source). It carries no SLD of its
  // own; a command that needs labels borrows the configured entry's (CLI-PROD-EDGE-002).
  if (options.state !== undefined) {
    const file = resolve(cwd, options.state);
    if (!existsSync(file)) {
      throw userError(
        `No session at "${options.state}" (run \`zxs state reset\` or \`zxs state save\` to create one first)`,
        stage,
      );
    }
    const session = deserializeZxState(readFileSync(file, 'utf8'), options.state);
    const pc = session.machine.registers.pc & 0xffff;
    const entry = resolved.entry;
    const debug =
      options.stateSymbols !== undefined && entry
        ? entryDebugData(entry, cwd, stage, options.stateSymbols)
        : undefined;
    return {
      machine: session.machine,
      org: pc,
      boot: {
        source: 'state',
        pc,
        file: options.state,
        ...(debug !== undefined && entry ? { entry } : {}),
      },
      border: session.border,
      length: 0,
      extent: RAM_EXTENT,
      symbols: debug?.symbols ?? [],
      sourceMap: debug?.sourceMap ?? [],
    };
  }

  // 1. An explicit file-image source (`--bin` / `--z80` / `--tap` / `--sna`) — bytes only, no
  // symbols. Routed through the ONE shared loader (CLI-PROD-CONV-SOURCE-001) so observe, `run`,
  // and MCP agree on the source contract; `--sna` fails loud (W4-GAP-03), never a silent boot.
  if (selectedFileSource({ bin: options.bin, z80: options.z80, tap: options.tap, sna: options.sna }) !== undefined) {
    const loaded = loadMachineFromSource({
      cwd,
      stage,
      bin: options.bin,
      z80: options.z80,
      tap: options.tap,
      sna: options.sna,
      org: options.org,
    });
    return {
      machine: loaded.machine,
      org: loaded.org,
      boot: loaded.boot,
      border: loaded.border,
      length: loaded.length,
      extent:
        loaded.length > 0 ? { from: loaded.org, to: loaded.org + loaded.length } : RAM_EXTENT,
      symbols: [],
      sourceMap: [],
    };
  }

  // 2. The configured entry — assembled in memory for its SLD symbols + source map.
  if (resolved.entry) {
    const result = assembleFile(resolved.entry, { cwd, sandbox: true });
    if (!result.ok) {
      throw userError(
        `Cannot observe: build failed with ${result.errors.length} error(s) in ${resolved.entry} ` +
          '(run `zxs build` for details)',
        stage,
      );
    }
    // Load where it was assembled to run: its ORG, else the configured `org`
    // (CLI-PROD-CONV-ORIGIN-001 — the same address `run`/`verify` use).
    const loadOrigin = programLoadOrigin(result.origin, org);
    const machine = loadBytesMachine(result.bytes, loadOrigin);
    return {
      machine,
      org: loadOrigin,
      boot: { source: 'build', org: loadOrigin, entry: resolved.entry },
      border: DEFAULT_BORDER,
      length: result.bytes.length,
      extent: { from: loadOrigin, to: loadOrigin + result.bytes.length },
      symbols: result.symbols,
      sourceMap: result.sourceMap,
    };
  }

  // 3. No source configured — a clean ROM boot (read-only inspection of the boot machine).
  // Nothing is loaded, so there is no origin to report: the machine sits at its reset PC.
  const fresh = bootFreshMachine();
  return {
    machine: fresh,
    org,
    boot: { source: 'fresh', pc: fresh.registers.pc & 0xffff },
    border: DEFAULT_BORDER,
    length: 0,
    extent: EMPTY_EXTENT,
    symbols: [],
    sourceMap: [],
  };
}

/**
 * The configured entry's SLD symbols + source map, assembled in memory to label a
 * `--state` session (see {@link ObserveSourceOptions.stateSymbols}). A build failure is a
 * USER_ERROR for `required` (never a silently empty symbol table) and `undefined` for
 * `best-effort`.
 */
function entryDebugData(
  entry: string,
  cwd: string,
  stage: string,
  mode: 'required' | 'best-effort',
): { symbols: SymbolDef[]; sourceMap: SourceMapEntry[] } | undefined {
  let result: AssembleResult | undefined;
  let reason: string | undefined;
  try {
    result = assembleFile(entry, { cwd, sandbox: true });
    if (!result.ok) reason = `build failed with ${result.errors.length} error(s) in ${entry}`;
  } catch (error) {
    reason = `cannot assemble ${entry}: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (result?.ok && reason === undefined) {
    return { symbols: result.symbols, sourceMap: result.sourceMap };
  }
  if (mode === 'best-effort') return undefined;
  throw userError(
    `Cannot label the session with symbols: ${reason ?? 'the build failed'} (run \`zxs build\` for details)`,
    stage,
  );
}

/** The snapshot/tape source flags shared by every observe command (CLI-PROD-CONV-SOURCE-001). */
export interface SnapshotSourceFlags {
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
}

/**
 * Declare the `--z80` / `--tap` / `--sna` file-source flags on an observe command
 * (CLI-PROD-CONV-SOURCE-001). Every observe verb shares this so the source contract is
 * declared once; `--sna` is recognized but fails loud at load time (W4-GAP-03).
 */
export function addSnapshotSourceFlags(command: Command): Command {
  return command
    .option('--z80 <file>', 'source a .z80 snapshot (v1/v2/v3)')
    .option('--tap <file>', 'source a .tap tape (instant-loads its CODE block)')
    .option(
      '--sna <file>',
      'source a .sna snapshot (unsupported: no core codec, W4-GAP-03 — fails loud)',
    );
}

/** Read the shared `--z80` / `--tap` / `--sna` flags out of a parsed CLI option bag. */
export function snapshotSourceFlags(options: Record<string, unknown>): SnapshotSourceFlags {
  return {
    z80: options.z80 as string | undefined,
    tap: options.tap as string | undefined,
    sna: options.sna as string | undefined,
  };
}

/** The opt-in session flags shared by the observe verbs (CLI-PROD-CONV-SOURCE-001). */
export interface StateSessionFlags {
  /** `--state <file>`: the session to observe (and, for an executing verb, to advance). */
  state?: string | undefined;
  /** `--no-save` / `--read-only`: leave the session file as it was. */
  noSave: boolean;
}

/**
 * Declare `--state <file>` plus `--no-save` / `--read-only` on an observe verb
 * (CLI-PROD-CONV-SOURCE-001, CLI-PROD-RULE-SESSION-001). A verb that `executes` (step,
 * trace, coverage) saves the advanced session back like `run --state` unless told not to;
 * a read-only verb (screen, disasm, symbols) accepts the two flags and never writes.
 */
export function addStateSessionFlags(command: Command, mode: 'read' | 'execute'): Command {
  return command
    .option(
      '--state <file>',
      mode === 'execute'
        ? 'resume an opt-in persistent session (.zxstate) and save it back afterwards'
        : 'read an opt-in persistent session (.zxstate) instead of booting fresh',
    )
    .option(
      '--no-save',
      mode === 'execute'
        ? 'do not save the advanced session back to --state'
        : 'accepted for symmetry; this command never writes the session',
    )
    .option(
      '--read-only',
      mode === 'execute'
        ? 'do not save the advanced session back to --state'
        : 'accepted for symmetry; this command never writes the session',
    );
}

/** Read the shared session flags out of a parsed CLI option bag. */
export function stateSessionFlags(options: Record<string, unknown>): StateSessionFlags {
  return {
    state: options.state as string | undefined,
    noSave: options.save === false || options.readOnly === true,
  };
}
