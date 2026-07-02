// Read-only machine sourcing for the observe commands — cli.md
// CLI-PROD-CONV-SOURCE-001, toolkit-runtime.md RT-PROD-OBSERVE-001
// ("over the same machine source-selection").
//
// Every observe command (`screen`/`regs`/`mem`/`disasm`/`step`/`trace`/`symbols`/
// `coverage`) sources a machine the SAME way `run` does — a `--bin` raw binary, the
// configured entry assembled fresh, or a clean ROM boot — so the read-only cluster
// shares one resolver instead of re-deriving the source per command. It composes the
// session seams (`loadBinMachine`/`loadBytesMachine`/`bootFreshMachine`) and the sole
// embedded assembler (`@zx-vibes/asm`, ADR-0027 D3); nothing here runs the machine, so
// the observe commands are pure reads of the sourced state (no persistence, Slice 7a).
//
// Unlike `run` (which writes a `.bin` then loads it), the built-entry path assembles
// IN MEMORY: that yields the SLD `symbols` + `sourceMap` the debug cluster needs
// (`disasm` label/`file.asm:line` resolution, `symbols`, `coverage` routines) with no
// disk artifact. The program is loaded at the assembler's own ORIGIN so the symbol
// addresses line up with the loaded bytes.

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
import { bootFreshMachine, loadBytesMachine } from '../runtime/session.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { loadMachineFromSource, selectedFileSource } from '../runtime/machine-source.js';
import { deserializeZxState } from '../state/zxstate.js';

/** How an observe command's machine was sourced (the `boot` descriptor it reports). */
export interface ObserveBoot {
  source: 'bin' | 'z80' | 'tap' | 'build' | 'fresh' | 'state';
  org: number;
  file?: string;
  entry?: string;
  /** Snapshot version (1/2/3) when the source is a `.z80`. */
  version?: number;
}

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
}

/** A sourced, NON-running machine plus its provenance and (when built) its SLD debug data. */
export interface ObserveSource {
  machine: Machine;
  /** The load origin (and PC) of the sourced program. */
  org: number;
  boot: ObserveBoot;
  /** The border colour in effect (snapshot border for `.z80`/`--state`, else the boot default). */
  border: number;
  /** Loaded program length in bytes (0 for a fresh boot) — bounds `coverage`'s executed-set. */
  length: number;
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
  // precedence (an explicit session beats any boot source). It carries no SLD, so
  // label/`file:line` specs still need a build (CLI-PROD-EDGE-002).
  if (options.state !== undefined) {
    const file = resolve(cwd, options.state);
    if (!existsSync(file)) {
      throw userError(
        `No session at "${options.state}" (run \`zxs state save\` to create one first)`,
        stage,
      );
    }
    const session = deserializeZxState(readFileSync(file, 'utf8'), options.state);
    const pc = session.machine.registers.pc & 0xffff;
    return {
      machine: session.machine,
      org: pc,
      boot: { source: 'state', org: pc, file: options.state },
      border: session.border,
      length: 0,
      symbols: [],
      sourceMap: [],
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
    const machine = loadBytesMachine(result.bytes, result.origin);
    return {
      machine,
      org: result.origin,
      boot: { source: 'build', org: result.origin, entry: resolved.entry },
      border: DEFAULT_BORDER,
      length: result.bytes.length,
      symbols: result.symbols,
      sourceMap: result.sourceMap,
    };
  }

  // 3. No source configured — a clean ROM boot (read-only inspection of the boot machine).
  return {
    machine: bootFreshMachine(),
    org,
    boot: { source: 'fresh', org },
    border: DEFAULT_BORDER,
    length: 0,
    symbols: [],
    sourceMap: [],
  };
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
