import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { structureDisasmLine } from '../../core/disasm-analysis.js';
import { disassemble, disassembleOne, type DisasmLine } from '../../core/disasm.js';
import type { Machine } from '../../core/machine.js';
import { SymbolTable } from '../../core/symbols.js';
import { Tracer } from '../../core/trace.js';
import { loadMachineFromSource, type MachineSourceOptions } from '../machine-source.js';
import { EXIT, emit, ensureParentDir, hex, parseAddress, parseCount, userError } from '../output.js';
import {
  loadSessionMachine,
  loadSessionMeta,
  saveSessionMachine,
  saveSessionMeta,
  type SessionMeta,
} from '../session.js';

export function loadSymbols(meta: SessionMeta): SymbolTable | undefined {
  if (!meta.symbolsPath || !existsSync(meta.symbolsPath)) return undefined;
  return SymbolTable.parse(readFileSync(meta.symbolsPath, 'utf8'));
}

function resolveSpec(spec: string, symbols: SymbolTable | undefined): number | undefined {
  if (symbols) {
    const addr = symbols.resolve(spec);
    if (addr !== undefined) return addr;
  }
  try {
    return parseAddress(spec);
  } catch {
    return undefined;
  }
}

function sym(addr: number, symbols: SymbolTable | undefined): string {
  return symbols ? symbols.symbolicate(addr) : hex(addr);
}

/* ───────────────────── break ───────────────────── */

export function breakAddCommand(spec: string, opts: { state?: string; json: boolean }): number {
  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  const addr = resolveSpec(spec, symbols);
  if (addr === undefined) {
    throw userError(
      `Cannot resolve '${spec}' to an address. Use hex (0x8000), a label, or file.asm:line` +
        (meta.symbolsPath ? '' : ' — no symbols yet: run zxs build first'),
      'break'
    );
  }
  const entry = { id: meta.nextId++, spec, addr };
  meta.breakpoints.push(entry);
  saveSessionMeta(meta, opts.state);
  const source = symbols?.addrToSource(addr);
  emit(
    {
      ok: true,
      stage: 'break',
      added: { ...entry, addr: hex(addr), ...(source ? { source } : {}) },
      next: ['zxs run --until-break'],
    },
    opts.json,
    () =>
      `breakpoint #${entry.id} at ${sym(addr, symbols)}` +
      (source ? ` (${source.file}:${source.line})` : '')
  );
  return EXIT.OK;
}

export function breakListCommand(opts: { state?: string; json: boolean }): number {
  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  emit(
    {
      ok: true,
      stage: 'break',
      breakpoints: meta.breakpoints.map((b) => ({ ...b, addr: hex(b.addr) })),
    },
    opts.json,
    () =>
      meta.breakpoints.length === 0
        ? 'no breakpoints'
        : meta.breakpoints.map((b) => `#${b.id}  ${sym(b.addr, symbols)}  (${b.spec})`).join('\n')
  );
  return EXIT.OK;
}

export function breakRmCommand(idOrAll: string, opts: { state?: string; json: boolean }): number {
  const meta = loadSessionMeta(opts.state);
  const before = meta.breakpoints.length;
  if (idOrAll === 'all') {
    meta.breakpoints = [];
  } else {
    const id = parseCount(idOrAll, 'breakpoint id');
    meta.breakpoints = meta.breakpoints.filter((b) => b.id !== id);
  }
  saveSessionMeta(meta, opts.state);
  const removed = before - meta.breakpoints.length;
  emit({ ok: true, stage: 'break', removed }, opts.json, () => `removed ${removed} breakpoint(s)`);
  return removed > 0 ? EXIT.OK : EXIT.USER_ERROR;
}

/* ───────────────────── watch ───────────────────── */

function parseRange(range: string): { from: number; to: number } {
  const parts = range.split('-');
  const from = parseAddress(parts[0]!);
  const to = parts.length > 1 ? parseAddress(parts[1]!) : from;
  if (to < from) throw new Error(`Invalid range: ${range}`);
  return { from, to };
}

export function watchAddCommand(opts: {
  read?: string;
  write?: string;
  state?: string;
  json: boolean;
}): number {
  if (!opts.read && !opts.write) {
    throw userError('Specify --read <addr[-addr]> or --write <addr[-addr]>', 'watch');
  }
  const meta = loadSessionMeta(opts.state);
  const type: 'read' | 'write' = opts.read ? 'read' : 'write';
  const { from, to } = parseRange((opts.read ?? opts.write)!);
  const entry = { id: meta.nextId++, type, from, to };
  meta.watchpoints.push(entry);
  saveSessionMeta(meta, opts.state);
  emit(
    {
      ok: true,
      stage: 'watch',
      added: { ...entry, from: hex(from), to: hex(to) },
      next: ['zxs run --until-break'],
    },
    opts.json,
    () => `watchpoint #${entry.id}: ${type} ${hex(from)}-${hex(to)}`
  );
  return EXIT.OK;
}

export function watchListCommand(opts: { state?: string; json: boolean }): number {
  const meta = loadSessionMeta(opts.state);
  emit(
    {
      ok: true,
      stage: 'watch',
      watchpoints: meta.watchpoints.map((w) => ({ ...w, from: hex(w.from), to: hex(w.to) })),
    },
    opts.json,
    () =>
      meta.watchpoints.length === 0
        ? 'no watchpoints'
        : meta.watchpoints
            .map((w) => `#${w.id}  ${w.type} ${hex(w.from)}-${hex(w.to)}`)
            .join('\n')
  );
  return EXIT.OK;
}

export function watchRmCommand(idOrAll: string, opts: { state?: string; json: boolean }): number {
  const meta = loadSessionMeta(opts.state);
  const before = meta.watchpoints.length;
  if (idOrAll === 'all') {
    meta.watchpoints = [];
  } else {
    const id = parseCount(idOrAll, 'watchpoint id');
    meta.watchpoints = meta.watchpoints.filter((w) => w.id !== id);
  }
  saveSessionMeta(meta, opts.state);
  const removed = before - meta.watchpoints.length;
  emit({ ok: true, stage: 'watch', removed }, opts.json, () => `removed ${removed} watchpoint(s)`);
  return removed > 0 ? EXIT.OK : EXIT.USER_ERROR;
}

export function watchClearCommand(opts: { state?: string; json: boolean }): number {
  return watchRmCommand('all', opts);
}

/* ───────────────────── step ───────────────────── */

export function stepCommand(
  count: string,
  opts: { over: boolean; state?: string; json: boolean }
): number {
  const m = loadSessionMachine(opts.state);
  if (!m) {
    throw userError('No session state found. Run `zxs run` first.', 'step');
  }
  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  const n = parseCount(count, 'instruction count');

  let stepped = 0;
  let note: string | undefined;
  if (opts.over) {
    const read = (a: number) => m.memory.read(a);
    for (let i = 0; i < n; i++) {
      const pc = m.cpu.registers.getPC();
      const instr = disassembleOne(read, pc);
      if (/^(CALL|RST)/.test(instr.text)) {
        const after = (pc + instr.bytes.length) & 0xffff;
        const outcome = m.run({ breakpoints: new Set([after]), maxFrames: 500 });
        if (outcome.reason !== 'breakpoint') {
          note = `step-over of '${instr.text}' did not return within 500 frames (stopped: ${outcome.reason})`;
          break;
        }
      } else {
        m.run({ instructions: 1 });
      }
      stepped++;
    }
  } else {
    const outcome = m.run({ instructions: n });
    stepped = outcome.reason === 'instructions' ? n : -1;
  }

  const statePath = saveSessionMachine(m, opts.state);
  const pc = m.cpu.registers.getPC();
  const next = disassemble((a) => m.memory.read(a), pc, 4).map((l) => ({
    addr: sym(l.addr, symbols),
    text: l.text,
  }));
  const regs = m.getRegisters();

  emit(
    {
      ok: true,
      stage: 'step',
      stepped,
      ...(note !== undefined ? { note } : {}),
      pc: sym(pc, symbols),
      ...(symbols?.addrToSource(pc) ? { source: symbols.addrToSource(pc) } : {}),
      registers: { af: hex(regs.af), bc: hex(regs.bc), de: hex(regs.de), hl: hex(regs.hl), sp: hex(regs.sp) },
      disasm: next,
      statePath,
    },
    opts.json,
    () =>
      [
        `stepped ${stepped} instruction(s)${note ? ` — ${note}` : ''}`,
        `PC=${sym(pc, symbols)}  AF=${hex(regs.af)} BC=${hex(regs.bc)} DE=${hex(regs.de)} HL=${hex(regs.hl)} SP=${hex(regs.sp)}`,
        ...next.map((l) => `  ${l.addr}  ${l.text}`),
      ].join('\n')
  );
  return EXIT.OK;
}

/* ───────────────────── disasm ───────────────────── */

export function disasmCommand(
  spec: string,
  opts: { count: string; state?: string; json: boolean } & MachineSourceOptions
): number {
  const loaded = loadMachineFromSource(opts, 'disasm');
  const m = loaded.machine;
  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  const range = parseAddressRange(spec);
  const addr =
    range?.from ?? (spec.toUpperCase() === 'PC' ? m.cpu.registers.getPC() : resolveSpec(spec, symbols));
  if (addr === undefined) {
    throw userError(`Cannot resolve '${spec}' to an address`, 'disasm');
  }

  const count = parseCount(opts.count, 'instruction count');
  // Mask to 16 bits: a multi-byte instruction near 0xFFFF reads operand bytes
  // past the top of memory; wrap them instead of reading out of the backing store.
  const read = (a: number) => m.memory.read(a & 0xffff);
  const rawLines = range
    ? disassembleRange(read, range.from, range.to)
    : disassemble(read, addr, count);
  const lines = rawLines.map((l) => {
    const structured = structureDisasmLine(l);
    return {
      addr: sym(l.addr, symbols),
      address: hex(l.addr),
      endAddress: hex(structured.endAddress),
      bytes: l.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      byteValues: l.bytes,
      text: l.text,
      mnemonic: structured.mnemonic,
      operands: structured.operands,
      targets: structured.targets.map((t) => ({ ...t, addr: hex(t.addr) })),
      ...(symbols?.addrToSource(l.addr) ? { source: symbols.addrToSource(l.addr) } : {}),
    };
  });

  emit({ ok: true, stage: 'disasm', source: loaded.source, lines }, opts.json, () =>
    lines.map((l) => `${l.addr.padEnd(24)} ${l.bytes.padEnd(12)} ${l.text}`).join('\n')
  );
  return EXIT.OK;
}

/* ───────────────────── trace ───────────────────── */

export function traceCommand(opts: {
  frames: string;
  top: string;
  last: string;
  out?: string;
  save?: boolean;
  state?: string;
  json: boolean;
} & MachineSourceOptions): number {
  const loaded = loadMachineFromSource(opts, 'trace');
  const m = loaded.machine;
  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  const last = parseCount(opts.last, 'recent instruction count');
  const frames = parseCount(opts.frames, 'frames');
  const top = parseCount(opts.top, 'hot address count');
  const tracer = new Tracer(last);

  const outcome = m.run({
    frames,
    onInstruction: (pc) => tracer.onInstruction(pc),
  });
  const saveState = opts.save !== false && !loaded.readOnly;
  const statePath = saveState ? saveSessionMachine(m, opts.state) : undefined;

  const read = (a: number) => m.memory.read(a);
  const hot = tracer.topHot(top).map((h) => ({
    pc: sym(h.pc, symbols),
    count: h.count,
    text: disassembleOne(read, h.pc).text,
  }));
  const recent = tracer.lastPCs(last).map((pc) => ({
    pc: sym(pc, symbols),
    text: disassembleOne(read, pc).text,
  }));

  const report = {
    ok: true,
    stage: 'trace',
    source: loaded.source,
    framesRun: outcome.framesRun,
    instructions: tracer.instructionCount,
    hot,
    recent: recent.slice(-20),
    ...(statePath ? { statePath } : { readOnly: true }),
  };
  if (opts.out) {
    ensureParentDir(opts.out);
    writeFileSync(opts.out, JSON.stringify({ ...report, recent }, null, 2));
  }

  emit(report, opts.json, () =>
    [
      `traced ${tracer.instructionCount} instructions over ${outcome.framesRun} frames`,
      'hot spots:',
      ...hot.map((h) => `  ${String(h.count).padStart(8)}×  ${h.pc.padEnd(24)} ${h.text}`),
      ...(opts.out ? [`full report: ${opts.out}`] : []),
    ].join('\n')
  );
  return EXIT.OK;
}

export type { Machine };

function parseAddressRange(spec: string): { from: number; to: number } | undefined {
  if (!spec.includes('-')) return undefined;
  const parts = spec.split('-');
  if (parts.length !== 2) return undefined;
  const from = parseAddress(parts[0]!.trim());
  const to = parseAddress(parts[1]!.trim());
  if (to < from) throw userError(`Invalid disassembly range: ${spec}`, 'disasm');
  return { from, to };
}

function disassembleRange(read: (addr: number) => number, from: number, to: number): DisasmLine[] {
  const lines: DisasmLine[] = [];
  let addr = from;
  while (addr <= to) {
    const line = disassembleOne(read, addr);
    lines.push(line);
    addr += Math.max(1, line.bytes.length);
  }
  return lines;
}
