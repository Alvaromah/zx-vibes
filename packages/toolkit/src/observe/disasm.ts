// `zxs disasm <spec>` — disassemble from an address / label / `file.asm:line` / PC
// (cli.md CLI-PROD-DISASM-001, RT-PROD-OBSERVE-001).
//
// Sources a machine (built entry / `--bin` / fresh), resolves the start `<spec>`, and
// decodes `--count` instructions (default 16) through the SOLE embedded disassembler
// (`@zx-vibes/asm` `disassemble`, the same decoder behind the assembler round-trip), then
// annotates each line with the SLD label that lands on it. Label / `file.asm:line`
// resolution comes from the in-memory assemble of the configured entry (`source.ts`):
// `--bin`/fresh have no symbols, so only numeric / `PC` specs resolve there.

import type { Command } from 'commander';
import { disassemble, type DisasmLine } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseNumber } from '../util/address.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
  type SourceMapEntry,
  type SymbolDef,
} from './source.js';

/** Default instruction count when `--count` is omitted (CLI-PROD-DISASM-001). */
export const DEFAULT_DISASM_COUNT = 16;

/** One decoded line, with the SLD label that starts at it (when any). */
export interface DisasmEntry {
  addr: number;
  bytes: number[];
  text: string;
  label?: string;
}

export type DisasmEnvelope = {
  ok: true;
  stage: 'disasm';
  boot: ObserveBoot;
  /** The `<spec>` as given. */
  spec: string;
  /** The resolved start address. */
  addr: number;
  count: number;
  instructions: DisasmEntry[];
};

export interface DisasmOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  spec: string;
  count?: string | undefined;
}

/** Resolve a `disasm` start spec to an address (CLI-PROD-DISASM-001). */
export function resolveDisasmSpec(
  spec: string,
  machine: Machine,
  symbols: SymbolDef[],
  sourceMap: SourceMapEntry[],
): number {
  const s = spec.trim();
  // `PC` — the live program counter.
  if (s.toUpperCase() === 'PC') return machine.registers.pc & 0xffff;
  // A label from the SLD symbol table.
  const sym = symbols.find((x) => x.name === s);
  if (sym) return sym.value & 0xffff;
  // `file.asm:line` — a source location from the SLD source map.
  const colon = s.lastIndexOf(':');
  if (colon > 0) {
    const file = s.slice(0, colon);
    const line = parseNumber(s.slice(colon + 1));
    if (line !== undefined) {
      const entry = sourceMap.find((e) => sameFile(e.file, file) && e.line === line);
      if (entry) return entry.addr & 0xffff;
      throw userError(`disasm: no code at ${s}`, 'disasm');
    }
  }
  // A numeric address in any documented form.
  const n = parseNumber(s);
  if (n !== undefined && n >= 0 && n <= 0xffff) return n;
  throw userError(
    `disasm: cannot resolve "${spec}" (use an address, a label, file.asm:line, or PC)`,
    'disasm',
  );
}

/** Whether a source-map file path matches a user-given (possibly bare) file name. */
function sameFile(mapped: string, given: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const m = norm(mapped);
  const g = norm(given);
  return m === g || m.endsWith(`/${g}`) || m.split('/').pop() === g.split('/').pop();
}

/** The `disasm` service (CLI-PROD-DISASM-001). */
export function runDisasm(options: DisasmOptions): DisasmEnvelope {
  const count = options.count !== undefined ? parseCount(options.count) : DEFAULT_DISASM_COUNT;
  const { machine, boot, symbols, sourceMap } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'disasm',
  });
  const addr = resolveDisasmSpec(options.spec, machine, symbols, sourceMap);

  const labelAt = new Map<number, string>();
  for (const sym of symbols) if (!labelAt.has(sym.value & 0xffff)) labelAt.set(sym.value & 0xffff, sym.name);

  const read = (a: number): number => machine.memory[a & 0xffff] ?? 0;
  const lines: DisasmLine[] = disassemble(read, addr, count);
  const instructions: DisasmEntry[] = lines.map((line) => {
    const label = labelAt.get(line.addr & 0xffff);
    return label !== undefined
      ? { addr: line.addr, bytes: line.bytes, text: line.text, label }
      : { addr: line.addr, bytes: line.bytes, text: line.text };
  });

  return { ok: true, stage: 'disasm', boot, spec: options.spec, addr, count, instructions };
}

function parseCount(input: string): number {
  const n = parseNumber(input);
  if (n === undefined || n < 1) {
    throw userError(`Invalid --count: "${input}" (expected a positive integer)`, 'disasm');
  }
  return n;
}

/** Map the CLI context onto the `disasm` service. */
export function disasmCommand(context: CommandContext): DisasmEnvelope {
  const spec = context.args[0];
  if (spec === undefined) {
    throw userError('disasm requires a <spec> (an address, a label, file.asm:line, or PC)', 'disasm');
  }
  const options = context.options as Record<string, unknown>;
  return runDisasm({
    cwd: process.cwd(),
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
    spec,
    count: options.count as string | undefined,
  });
}

/** Declare the `disasm` command's argument / flags (CLI-PROD-DISASM-001). */
export function configureDisasmCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Disassemble from an address / label / file.asm:line / PC')
    .argument('[spec]', 'start: an address, a label, file.asm:line, or PC')
    .option('--bin <file>', 'disassemble a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--count <n>', `instructions to decode (default ${DEFAULT_DISASM_COUNT})`)
    .option('--json', 'emit a single machine-readable JSON envelope');
}
