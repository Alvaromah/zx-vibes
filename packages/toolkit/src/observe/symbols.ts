// `zxs symbols` — dump the SLD symbol table as JSON (cli.md CLI-PROD-SYMBOLS-001,
// RT-PROD-OBSERVE-001 v2 addition).
//
// Assembles the configured entry (the in-memory build in `source.ts`) and reports its SLD
// label→address map as `{ ok, stage:"symbols", symbols: [{ name, addr, kind }] }` — so an
// agent can ENUMERATE labels, not just resolve a known one (the gap ADR-0027 D2 closes).
// `symbols get <name>` reports a single entry. `kind` is the SLD class: `F` (a code/label
// address) or `D` (a defined constant). The shape matches CLI-PROD-SYMBOLS-001 exactly.

import type { Command } from 'commander';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type SymbolDef,
} from './source.js';

/** One symbol-table entry (CLI-PROD-SYMBOLS-001). */
export interface SymbolEntry {
  name: string;
  addr: number;
  kind: 'F' | 'D';
}

export type SymbolsDumpEnvelope = { ok: true; stage: 'symbols'; symbols: SymbolEntry[] };
export type SymbolsGetEnvelope = { ok: true; stage: 'symbols'; symbol: SymbolEntry };
export type SymbolsEnvelope = SymbolsDumpEnvelope | SymbolsGetEnvelope;

export interface SymbolsOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  /** `symbols get <name>` — report a single entry. */
  get?: string | undefined;
}

/** Map an assembler {@link SymbolDef} to the contract symbol-entry shape. */
function toEntry(sym: SymbolDef): SymbolEntry {
  return { name: sym.name, addr: sym.value & 0xffff, kind: sym.kind };
}

/** The `symbols` service (CLI-PROD-SYMBOLS-001): assemble the entry and dump its SLD symbols. */
export function runSymbols(options: SymbolsOptions = {}): SymbolsEnvelope {
  const { symbols } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'symbols',
  });
  const entries = symbols
    .map(toEntry)
    .sort((a, b) => a.addr - b.addr || a.name.localeCompare(b.name));

  if (options.get !== undefined) {
    const found = entries.find((e) => e.name === options.get);
    if (!found) throw userError(`symbols: no symbol named "${options.get}"`, 'symbols');
    return { ok: true, stage: 'symbols', symbol: found };
  }
  return { ok: true, stage: 'symbols', symbols: entries };
}

/** Map the CLI context onto the `symbols` service. */
export function symbolsCommand(context: CommandContext): SymbolsEnvelope {
  const options = context.options as Record<string, unknown>;
  // `symbols get <name>`.
  if (context.args[0] === 'get') {
    const name = context.args[1];
    if (name === undefined) throw userError('symbols get requires a <name>', 'symbols');
    return runSymbols({
      cwd: process.cwd(),
      org: options.org as string | undefined,
      bin: options.bin as string | undefined,
      ...snapshotSourceFlags(options),
      get: name,
    });
  }
  return runSymbols({
    cwd: process.cwd(),
    org: options.org as string | undefined,
    bin: options.bin as string | undefined,
    ...snapshotSourceFlags(options),
  });
}

/** Declare the `symbols` command's argument / flags (CLI-PROD-SYMBOLS-001). */
export function configureSymbolsCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Dump the SLD symbol table as JSON (or `get <name>` for one entry)')
    .argument('[args...]', '`get <name>` to report a single symbol')
    .option('--bin <file>', 'source a raw binary loaded at --org (no SLD symbols)')
    .option('--org <addr>', 'load origin (default 0x8000)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
