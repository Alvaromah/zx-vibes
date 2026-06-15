import { readFileSync, writeFileSync } from 'node:fs';
import { loadMachineFromSource, type MachineSourceOptions } from '../machine-source.js';
import { EXIT, emit, ensureParentDir, hex, parseAddress, parseCount, parseInteger, userError } from '../output.js';
import { loadSessionMachine, saveSessionMachine } from '../session.js';

function requireSession(state?: string) {
  const m = loadSessionMachine(state);
  if (!m) {
    throw userError('No session state found. Run `zxs run` first.', 'session');
  }
  return m;
}

export function memReadCommand(
  addr: string,
  opts: { len: string; state?: string; json: boolean } & MachineSourceOptions
): number {
  const loaded = loadMachineFromSource(opts, 'mem');
  const m = loaded.machine;
  const start = parseAddress(addr);
  const len = parseCount(opts.len, 'length', 0x10000);
  const data = m.readMemory(start, len);

  const lines: string[] = [];
  for (let off = 0; off < len; off += 16) {
    const chunk = [...data.subarray(off, off + 16)];
    const hexPart = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(
      `${(start + off).toString(16).toUpperCase().padStart(4, '0')}: ${hexPart.padEnd(47)} |${ascii}|`
    );
  }

  emit(
    {
      ok: true,
      stage: 'mem',
      addr: hex(start),
      len,
      hex: Buffer.from(data).toString('hex'),
      dump: lines,
      source: loaded.source,
    },
    opts.json,
    () => lines.join('\n')
  );
  return EXIT.OK;
}

export function memDumpCommand(opts: {
  range: string;
  out: string;
  json: boolean;
} & MachineSourceOptions): number {
  const loaded = loadMachineFromSource(opts, 'mem');
  const { from, to } = parseRange(opts.range);
  const data = loaded.machine.readMemory(from, to - from + 1);
  ensureParentDir(opts.out);
  writeFileSync(opts.out, data);
  emit(
    {
      ok: true,
      stage: 'mem',
      dumped: opts.out,
      range: { from: hex(from), to: hex(to), len: data.length },
      source: loaded.source,
    },
    opts.json,
    () => `dumped ${data.length} bytes from ${hex(from)}-${hex(to)} to ${opts.out}`
  );
  return EXIT.OK;
}

export function memLoadCommand(
  addr: string,
  opts: { bin: string; state?: string; json: boolean }
): number {
  const m = requireSession(opts.state);
  const start = parseAddress(addr);
  const data = new Uint8Array(readFileSync(opts.bin));
  m.writeMemory(start, data);
  const statePath = saveSessionMachine(m, opts.state);
  emit(
    { ok: true, stage: 'mem', loaded: opts.bin, addr: hex(start), wrote: data.length, statePath },
    opts.json,
    () => `loaded ${data.length} bytes from ${opts.bin} at ${hex(start)}`
  );
  return EXIT.OK;
}

export function memWriteCommand(
  addr: string,
  bytes: string,
  opts: { state?: string; json: boolean }
): number {
  const m = requireSession(opts.state);
  if (!m) return EXIT.USER_ERROR;
  const start = parseAddress(addr);
  const clean = bytes.replace(/[\s,]/g, '');
  if (!/^([0-9a-fA-F]{2})+$/.test(clean)) {
    throw userError(`Invalid hex byte string: '${bytes}' (use e.g. "3E42" or "3e 42")`, 'mem');
  }
  const data = Uint8Array.from(Buffer.from(clean, 'hex'));
  m.writeMemory(start, data);
  const statePath = saveSessionMachine(m, opts.state);

  emit(
    { ok: true, stage: 'mem', addr: hex(start), wrote: data.length, statePath },
    opts.json,
    () => `wrote ${data.length} bytes at ${hex(start)}`
  );
  return EXIT.OK;
}

const REG16 = new Set(['AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY']);
const REG8 = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R']);

export function regsCommand(opts: { state?: string; json: boolean } & MachineSourceOptions): number {
  const loaded = loadMachineFromSource(opts, 'regs');
  const m = loaded.machine;
  const r = m.getRegisters();
  const flags = decodeFlags(r.af & 0xff);

  emit(
    {
      ok: true,
      stage: 'regs',
      pc: hex(r.pc),
      sp: hex(r.sp),
      af: hex(r.af),
      bc: hex(r.bc),
      de: hex(r.de),
      hl: hex(r.hl),
      afPrime: hex(r.afPrime),
      bcPrime: hex(r.bcPrime),
      dePrime: hex(r.dePrime),
      hlPrime: hex(r.hlPrime),
      ix: hex(r.ix),
      iy: hex(r.iy),
      i: hex(r.i, 2),
      r: hex(r.r, 2),
      im: r.im,
      iff1: r.iff1,
      halted: r.halted,
      flags,
      source: loaded.source,
    },
    opts.json,
    () =>
      [
        `PC=${hex(r.pc)}  SP=${hex(r.sp)}  IM${r.im}  iff1=${r.iff1}  halted=${r.halted}`,
        `AF=${hex(r.af)} [${flags}]  BC=${hex(r.bc)}  DE=${hex(r.de)}  HL=${hex(r.hl)}`,
        `AF'=${hex(r.afPrime)}  BC'=${hex(r.bcPrime)}  DE'=${hex(r.dePrime)}  HL'=${hex(r.hlPrime)}`,
        `IX=${hex(r.ix)}  IY=${hex(r.iy)}  I=${hex(r.i, 2)}  R=${hex(r.r, 2)}`,
      ].join('\n')
  );
  return EXIT.OK;
}

function parseRange(range: string): { from: number; to: number } {
  const parts = range.split('-');
  const from = parseAddress(parts[0]!);
  const to = parts.length > 1 ? parseAddress(parts[1]!) : from;
  if (to < from) throw userError(`Invalid range: ${range}`, 'mem');
  return { from, to };
}

export function regsSetCommand(
  reg: string,
  value: string,
  opts: { state?: string; json: boolean }
): number {
  const m = requireSession(opts.state);
  if (!m) return EXIT.USER_ERROR;
  const name = reg.toUpperCase();
  let v: number;

  if (name === 'PC') {
    v = parseAddress(value);
    m.cpu.registers.setPC(v);
  } else if (REG16.has(name)) {
    v = parseAddress(value);
    m.cpu.registers.set16(name, v);
  } else if (REG8.has(name)) {
    v = parseInteger(value, `${name} value`, { min: 0, max: 0xff });
    m.cpu.registers.set(name, v);
  } else if (name === 'IM') {
    v = parseInteger(value, 'IM value', { min: 0, max: 2 });
    m.cpu.interruptMode = v;
  } else {
    throw userError(`Unknown register '${reg}' (use A,F,B..L,I,R, AF,BC,DE,HL,SP,IX,IY, PC, IM)`, 'regs');
  }
  const statePath = saveSessionMachine(m, opts.state);
  emit(
    { ok: true, stage: 'regs', set: { [name]: hex(v) }, statePath },
    opts.json,
    () => `${name} = ${hex(v)}`
  );
  return EXIT.OK;
}

function decodeFlags(f: number): string {
  const names = ['S', 'Z', 'F5', 'H', 'F3', 'PV', 'N', 'C'];
  const set: string[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    if (f & (1 << bit)) set.push(names[7 - bit]!);
  }
  return set.join(' ');
}
