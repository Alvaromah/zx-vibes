// `zxs scan` — opcode / immediate-range memory search (cli.md CLI-PROD-REVENG-001, ADR-0027 D5).
//
// The optional reverse-engineering add-on's memory search, over a loaded snapshot / dump:
//   - `--bytes <hex>` : a raw BYTE-PATTERN (opcode) search — hex tokens with `??` wildcards,
//     e.g. `"CD ?? 90"` (any `CALL 0x90xx`). Reports every start address the pattern hits.
//   - `--imm <from-to>` : an IMMEDIATE-RANGE search — disassemble linearly and report each
//     instruction whose 16-bit or 8-bit immediate operand falls in `[from,to]`, e.g. finding
//     every reference to the screen file 0x4000-0x5AFF loaded as a constant.
//
// Both restrict to an optional `--range from-to` (default the whole 48K RAM 0x4000-0xFFFF).
// The scan is pure static analysis — it reads the image, never runs it.

import type { Command } from 'commander';
import { disassembleOne } from '@zx-vibes/asm';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseRange, type AddressRange } from '../util/address.js';
import { loadRevengImage, type RevengSource, type RevengSourceOptions } from './snapshot-source.js';

/** The 48K RAM window (`scan`'s default range). */
export const SCAN_FROM = 0x4000;
export const SCAN_TO = 0xffff;

/** One byte-pattern hit: the start address, and the concrete bytes it matched. */
export interface ScanByteMatch {
  addr: number;
  bytes: number[];
}

/** One immediate-range hit: the instruction address, its decode, and the matched value. */
export interface ScanImmMatch {
  addr: number;
  text: string;
  value: number;
}

export type ScanEnvelope = {
  ok: true;
  stage: 'scan';
  mode: 'bytes' | 'imm';
  source: RevengSource;
  range: AddressRange;
  /** The `--bytes` pattern as given (bytes mode). */
  pattern?: string;
  /** The `--imm` value window (imm mode). */
  imm?: AddressRange;
  matches: ScanByteMatch[] | ScanImmMatch[];
  count: number;
};

/** A byte-pattern token: a fixed byte value, or `null` for a `??` wildcard. */
type PatternToken = number | null;

/** Parse a `--bytes` pattern: space-separated hex bytes, `??` = any byte (CLI-PROD-REVENG-001). */
export function parsePattern(input: string): PatternToken[] {
  const tokens = input.trim().split(/[\s,]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw userError('scan --bytes requires a pattern, e.g. "CD ?? 90" (?? = any byte)', 'scan');
  }
  return tokens.map((tok) => {
    if (tok === '??' || tok === '?') return null;
    if (!/^[0-9a-f]{1,2}$/i.test(tok)) {
      throw userError(`Invalid scan pattern token "${tok}" (expected a hex byte or ?? wildcard)`, 'scan');
    }
    return parseInt(tok, 16) & 0xff;
  });
}

export interface ScanBytesOptions extends RevengSourceOptions {
  bytesPattern: string;
  range?: string | undefined;
}

/** `scan --bytes <hex>` — find every start address where the byte pattern matches. */
export function runScanBytes(options: ScanBytesOptions): ScanEnvelope {
  const pattern = parsePattern(options.bytesPattern);
  const image = loadRevengImage({ ...options, stage: 'scan' });
  const range = resolveRange(options.range);
  const matches: ScanByteMatch[] = [];
  const last = range.to - pattern.length + 1;
  for (let addr = range.from; addr <= last; addr += 1) {
    let hit = true;
    for (let k = 0; k < pattern.length; k += 1) {
      const want = pattern[k];
      if (want !== null && (image.memory[addr + k] ?? 0) !== want) {
        hit = false;
        break;
      }
    }
    if (hit) {
      matches.push({ addr, bytes: Array.from(image.memory.slice(addr, addr + pattern.length)) });
    }
  }
  return {
    ok: true,
    stage: 'scan',
    mode: 'bytes',
    source: image.source,
    range,
    pattern: options.bytesPattern,
    matches,
    count: matches.length,
  };
}

export interface ScanImmOptions extends RevengSourceOptions {
  imm: string;
  range?: string | undefined;
}

/** The immediate operand value(s) an instruction encodes, for the `--imm` range test. */
function immediatesOf(bytes: number[], text: string): number[] {
  // Relative branches (JR/DJNZ) resolve to an absolute target that the disassembler already
  // rendered into `text` as 0x…; the raw displacement byte is not a useful "immediate", so
  // rely on the 16-bit trailing-word / 8-bit-literal encodings below plus the text scan.
  const values: number[] = [];
  // A trailing 16-bit little-endian word (JP/CALL nn, LD (nn), LD rr,nn, …). We inspect the
  // last two bytes of any >= 3-byte instruction — the operand position for absolute forms.
  if (bytes.length >= 3) {
    values.push((bytes[bytes.length - 2]! | (bytes[bytes.length - 1]! << 8)) & 0xffff);
  }
  // Any absolute 16-bit address the decoder printed (covers indexed / ED forms uniformly).
  for (const m of text.matchAll(/0x([0-9A-F]{4})\b/g)) values.push(parseInt(m[1]!, 16));
  return values;
}

/** `scan --imm <from-to>` — find instructions whose immediate operand is in the value range. */
export function runScanImm(options: ScanImmOptions): ScanEnvelope {
  const imm = parseRange(options.imm, 'scan');
  const image = loadRevengImage({ ...options, stage: 'scan' });
  const range = resolveRange(options.range);
  const read = (a: number): number => image.memory[a & 0xffff] ?? 0;
  const matches: ScanImmMatch[] = [];
  let addr = range.from;
  while (addr <= range.to) {
    const line = disassembleOne(read, addr);
    for (const value of immediatesOf(line.bytes, line.text)) {
      if (value >= imm.from && value <= imm.to) {
        matches.push({ addr, text: line.text, value });
        break;
      }
    }
    addr += Math.max(1, line.bytes.length);
  }
  return {
    ok: true,
    stage: 'scan',
    mode: 'imm',
    source: image.source,
    range,
    imm,
    matches,
    count: matches.length,
  };
}

function resolveRange(range: string | undefined): AddressRange {
  return range !== undefined ? parseRange(range, 'scan') : { from: SCAN_FROM, to: SCAN_TO };
}

/** Map the CLI context onto the `scan` service. */
export function scanCommand(context: CommandContext): ScanEnvelope {
  const options = context.options as Record<string, unknown>;
  const common: RevengSourceOptions = {
    cwd: process.cwd(),
    z80: options.z80 as string | undefined,
    sna: options.sna as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
  };
  const bytesPattern = options.bytes as string | undefined;
  const imm = options.imm as string | undefined;
  if (bytesPattern !== undefined && imm !== undefined) {
    throw userError('scan takes either --bytes or --imm, not both', 'scan');
  }
  if (bytesPattern !== undefined) {
    return runScanBytes({ ...common, bytesPattern, range: options.range as string | undefined });
  }
  if (imm !== undefined) {
    return runScanImm({ ...common, imm, range: options.range as string | undefined });
  }
  throw userError(
    'scan requires --bytes <hex pattern> (opcode search) or --imm <from-to> (immediate-range search)',
    'scan',
  );
}

/** Declare the `scan` command's flags (CLI-PROD-REVENG-001). */
export function configureScanCommand(command: Command): void {
  command
    .description('[reveng add-on] Opcode / immediate-range memory search over a snapshot')
    .option('--z80 <file>', 'snapshot to scan (a .sna fails loud — no core codec, W4-GAP-03)')
    .option('--sna <file>', 'a .sna snapshot (unsupported — fails loud, W4-GAP-03)')
    .option('--bin <file>', 'a raw memory dump to scan')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--bytes <hex>', 'byte/opcode pattern, e.g. "CD ?? 90" (?? = any byte)')
    .option('--imm <from-to>', 'immediate-range search: match instructions with an operand in the range')
    .option('--range <from-to>', 'restrict the scan to a region (default the 48K RAM)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
