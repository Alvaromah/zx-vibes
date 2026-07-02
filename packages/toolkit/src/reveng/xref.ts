// `zxs xref` — static reference finder (cli.md CLI-PROD-REVENG-001, ADR-0027 D5).
//
// The optional reverse-engineering add-on's cross-reference tool: given a target address,
// disassemble a code region linearly and report every instruction that REFERENCES that
// address — a `CALL`/`JP`/`JR`/`DJNZ` to it, or a `LD (nn)` / `LD …,(nn)` / `LD rr,nn`
// touching it. Answers "who calls / jumps to / reads this routine?" for a third-party game.
//
// The reference test reuses the SOLE disassembler (`@zx-vibes/asm` `disassembleOne`): every
// absolute 16-bit operand — including a JR/DJNZ target the decoder already resolved — is
// rendered as `0x####`, so an exact `0x####` token match on the target is a robust, decoder-
// backed reference detector (a 4-hex token can never collide with an 8-bit `0x##` literal).
// Linear disassembly is inherently heuristic (data can mis-decode); this is standard for a
// static xref and is scoped by `--range`.

import type { Command } from 'commander';
import { disassembleOne } from '@zx-vibes/asm';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseAddress, parseRange, type AddressRange } from '../util/address.js';
import { loadRevengImage, type RevengSource, type RevengSourceOptions } from './snapshot-source.js';

/** The 48K RAM window (`xref`'s default scan range). */
export const XREF_FROM = 0x4000;
export const XREF_TO = 0xffff;

/** How an instruction references the target. */
export type XrefKind = 'call' | 'jump' | 'mem' | 'imm';

/** One reference to the target address. */
export interface XrefEntry {
  addr: number;
  text: string;
  kind: XrefKind;
}

export type XrefEnvelope = {
  ok: true;
  stage: 'xref';
  source: RevengSource;
  target: number;
  range: AddressRange;
  refs: XrefEntry[];
  count: number;
};

/** Classify how `text` references `target` (already known to contain the `0x####` token). */
function classify(text: string, targetHex: string): XrefKind {
  const head = text.split(/\s+/, 1)[0]!.toUpperCase();
  if (head === 'CALL') return 'call';
  if (head === 'JP' || head === 'JR' || head === 'DJNZ' || head === 'RST') return 'jump';
  // A parenthesised operand `(0x####)` is a memory access (LD (nn),… / LD …,(nn)).
  if (text.includes(`(${targetHex})`)) return 'mem';
  // Otherwise the address appears as a bare immediate (e.g. `LD HL,0x####`).
  return 'imm';
}

export interface XrefOptions extends RevengSourceOptions {
  target: string;
  range?: string | undefined;
}

/** `xref <target>` — find every instruction referencing `target` in the scan range. */
export function runXref(options: XrefOptions): XrefEnvelope {
  const target = parseAddress(options.target, 'xref');
  const image = loadRevengImage({ ...options, stage: 'xref' });
  const range =
    options.range !== undefined
      ? parseRange(options.range, 'xref')
      : { from: XREF_FROM, to: XREF_TO };
  const targetHex = `0x${target.toString(16).toUpperCase().padStart(4, '0')}`;
  const tokenRe = new RegExp(`(?<![0-9A-Fx])${targetHex}\\b`);
  const read = (a: number): number => image.memory[a & 0xffff] ?? 0;

  const refs: XrefEntry[] = [];
  let addr = range.from;
  while (addr <= range.to) {
    const line = disassembleOne(read, addr);
    if (tokenRe.test(line.text)) {
      refs.push({ addr, text: line.text, kind: classify(line.text, targetHex) });
    }
    addr += Math.max(1, line.bytes.length);
  }
  return { ok: true, stage: 'xref', source: image.source, target, range, refs, count: refs.length };
}

/** Map the CLI context onto the `xref` service. */
export function xrefCommand(context: CommandContext): XrefEnvelope {
  const target = context.args[0];
  if (target === undefined) {
    throw userError('xref requires a <target> address, e.g. `xref 0x8000 --z80 game.z80`', 'xref');
  }
  const options = context.options as Record<string, unknown>;
  return runXref({
    cwd: process.cwd(),
    z80: options.z80 as string | undefined,
    sna: options.sna as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    target,
    range: options.range as string | undefined,
  });
}

/** Declare the `xref` command's argument / flags (CLI-PROD-REVENG-001). */
export function configureXrefCommand(command: Command): void {
  command
    .description('[reveng add-on] Find static references to an address in a snapshot')
    .argument('[target]', 'the target address to find references to')
    .option('--z80 <file>', 'snapshot to scan (a .sna fails loud — no core codec, W4-GAP-03)')
    .option('--sna <file>', 'a .sna snapshot (unsupported — fails loud, W4-GAP-03)')
    .option('--bin <file>', 'a raw memory dump to scan')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--range <from-to>', 'restrict the code sweep to a region (default the 48K RAM)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
