import { disassembleOne } from '../../core/disasm.js';
import { structureDisasmLine } from '../../core/disasm-analysis.js';
import { loadMachineFromSource, type MachineSourceOptions } from '../machine-source.js';
import { EXIT, emit, hex, parseAddress, userError } from '../output.js';

interface ScanOptions extends MachineSourceOptions {
  opcode?: string;
  immRange?: string;
  json: boolean;
}

type ScanHit =
  | { kind: 'opcode'; addr: string; detail: string }
  | { kind: 'imm16'; addr: string; value: string; detail: string };

interface XrefHit {
  addr: string;
  bytes: string;
  text: string;
  targets: { addr: string; kind: string; symbol?: string; note?: string }[];
}

export function scanCommand(opts: ScanOptions): number {
  if (!opts.opcode && !opts.immRange) {
    throw userError('Specify --opcode "ED B0" or --imm-range 0x4000-0x5aff', 'scan');
  }
  const loaded = loadMachineFromSource(opts, 'scan');
  const hits: ScanHit[] = [
    ...(opts.opcode ? scanOpcode(loaded.machine.readMemory(0, 0x10000), parseOpcode(opts.opcode)) : []),
    ...(opts.immRange ? scanImmediateRange(loaded.machine.readMemory(0, 0x10000), parseRange(opts.immRange)) : []),
  ];
  emit(
    { ok: true, stage: 'scan', hits, source: loaded.source },
    opts.json,
    () => (hits.length === 0 ? 'no hits' : hits.map((h) => `${h.addr} ${h.kind} ${h.detail}`).join('\n'))
  );
  return EXIT.OK;
}

export function xrefCommand(addr: string, opts: MachineSourceOptions & { json: boolean }): number {
  const target = parseAddress(addr);
  const loaded = loadMachineFromSource(opts, 'xref');
  const read = (a: number) => loaded.machine.memory.read(a);
  const hits: XrefHit[] = [];
  for (let pc = 0x4000; pc < 0x10000; pc++) {
    const line = disassembleOne(read, pc);
    const structured = structureDisasmLine(line);
    if (structured.targets.some((t) => t.addr === target)) {
      hits.push({
        addr: hex(pc),
        bytes: line.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
        text: line.text,
        targets: structured.targets.map((t) => ({ ...t, addr: hex(t.addr) })),
      });
    }
  }
  emit(
    { ok: true, stage: 'xref', target: hex(target), hits, source: loaded.source },
    opts.json,
    () => (hits.length === 0 ? `no xrefs to ${hex(target)}` : hits.map((h) => `${h.addr} ${h.text}`).join('\n'))
  );
  return EXIT.OK;
}

function scanOpcode(mem: Uint8Array, pattern: Uint8Array): ScanHit[] {
  const hits: ScanHit[] = [];
  for (let i = 0; i <= mem.length - pattern.length; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (mem[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ kind: 'opcode', addr: hex(i), detail: Buffer.from(pattern).toString('hex') });
  }
  return hits;
}

function scanImmediateRange(mem: Uint8Array, range: { from: number; to: number }): ScanHit[] {
  const hits: ScanHit[] = [];
  for (let i = 0; i < mem.length - 1; i++) {
    const value = mem[i]! | (mem[i + 1]! << 8);
    if (value >= range.from && value <= range.to) {
      hits.push({ kind: 'imm16', addr: hex(i), value: hex(value), detail: `word ${hex(value)}` });
    }
  }
  return hits;
}

function parseOpcode(value: string): Uint8Array {
  const clean = value.replace(/[\s,]/g, '');
  if (!/^([0-9a-fA-F]{2})+$/.test(clean)) {
    throw userError(`Invalid opcode byte pattern '${value}'`, 'scan');
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

function parseRange(range: string): { from: number; to: number } {
  const parts = range.split('-');
  if (parts.length !== 2) throw userError(`Invalid range '${range}'`, 'scan');
  const from = parseAddress(parts[0]!);
  const to = parseAddress(parts[1]!);
  if (to < from) throw userError(`Invalid range '${range}'`, 'scan');
  return { from, to };
}
