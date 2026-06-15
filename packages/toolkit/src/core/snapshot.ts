import { basename, extname } from 'node:path';
import { Machine, type RegistersFull } from './machine.js';
import { applySna } from './state.js';

export type SnapshotFormat = 'z80' | 'sna';

export interface SnapshotRamPage {
  name: string;
  address: number;
  length: number;
  compressed?: boolean;
}

export interface SnapshotInfo {
  ok: true;
  format: SnapshotFormat;
  file?: string;
  version: string;
  supported: boolean;
  compression: 'none' | 'rle' | 'unknown';
  hardwareMode: string;
  registers: RegistersFull;
  interrupt: {
    im: number;
    iff1: boolean;
    iff2: boolean;
  };
  borderColor: number;
  ramPages: SnapshotRamPage[];
  notes: string[];
}

export function detectSnapshotFormat(file: string, data: Uint8Array): SnapshotFormat {
  const ext = extname(file).toLowerCase();
  if (ext === '.sna') return 'sna';
  if (ext === '.z80') return 'z80';
  if (data.length === 27 + 49152) return 'sna';
  return 'z80';
}

export function snapshotInfo(file: string, data: Uint8Array): SnapshotInfo {
  const format = detectSnapshotFormat(file, data);
  return format === 'sna' ? snaInfo(file, data) : z80Info(file, data);
}

export function snapshotRam(file: string, data: Uint8Array): Uint8Array {
  const format = detectSnapshotFormat(file, data);
  return format === 'sna' ? snaRam(data) : z80Ram(data);
}

export function loadSnapshotMachine(file: string, data: Uint8Array): Machine {
  const m = Machine.boot();
  const format = detectSnapshotFormat(file, data);
  if (format === 'sna') {
    m.loadSna(data);
  } else {
    m.loadZ80(data);
  }
  return m;
}

function z80Info(file: string, data: Uint8Array): SnapshotInfo {
  if (data.length < 30) throw new Error(`Not a .z80 snapshot: ${basename(file)} is too small`);
  const h = data.subarray(0, 30);
  const pc = word(h[6]!, h[7]!);
  const flags1 = h[12] === 0xff ? 1 : h[12]!;
  const compressed = (flags1 & 0x20) !== 0;
  const version = pc === 0 ? extendedZ80Version(data) : '1';
  const supported = version === '1';
  const regs = registersFromZ80Header(h, flags1);
  return {
    ok: true,
    format: 'z80',
    file,
    version,
    supported,
    compression: compressed ? 'rle' : 'none',
    hardwareMode: supported ? '48K' : 'extended/unknown',
    registers: regs,
    interrupt: { im: regs.im, iff1: regs.iff1, iff2: regs.iff2 },
    borderColor: (flags1 >> 1) & 0x07,
    ramPages: [
      {
        name: '48k-ram',
        address: 0x4000,
        length: 49152,
        compressed,
      },
    ],
    notes: supported
      ? ['.z80 v1 48K snapshots are supported for load and RAM export']
      : ['.z80 v2/v3 extended headers are detected but not decoded yet'],
  };
}

function z80Ram(data: Uint8Array): Uint8Array {
  if (data.length < 30) throw new Error('Not a .z80 snapshot: file is too small');
  const h = data.subarray(0, 30);
  const pc = word(h[6]!, h[7]!);
  if (pc === 0) {
    throw new Error('Unsupported .z80 v2/v3 snapshot: extended page layout is not implemented yet');
  }
  const flags1 = h[12] === 0xff ? 1 : h[12]!;
  const compressed = (flags1 & 0x20) !== 0;
  return compressed ? decompressZ80Rle(data.subarray(30)) : copyFixed(data.subarray(30), 49152);
}

function snaInfo(file: string, data: Uint8Array): SnapshotInfo {
  if (data.length !== 27 + 49152) {
    throw new Error(`Not a 48K SNA snapshot: ${data.length} bytes (expected 49179)`);
  }
  const ram = snaRam(data);
  const spRaw = word(data[23]!, data[24]!);
  const pc = read48kRam(ram, spRaw);
  const pcHi = read48kRam(ram, (spRaw + 1) & 0xffff);
  const registers: RegistersFull = {
    pc: word(pc, pcHi),
    sp: (spRaw + 2) & 0xffff,
    af: word(data[21]!, data[22]!),
    bc: word(data[13]!, data[14]!),
    de: word(data[11]!, data[12]!),
    hl: word(data[9]!, data[10]!),
    afPrime: word(data[7]!, data[8]!),
    bcPrime: word(data[5]!, data[6]!),
    dePrime: word(data[3]!, data[4]!),
    hlPrime: word(data[1]!, data[2]!),
    ix: word(data[17]!, data[18]!),
    iy: word(data[15]!, data[16]!),
    i: data[0]!,
    r: data[20]!,
    im: data[25]! & 0x03,
    iff1: (data[19]! & 0x04) !== 0,
    iff2: (data[19]! & 0x04) !== 0,
    halted: false,
  };
  return {
    ok: true,
    format: 'sna',
    file,
    version: '48K',
    supported: true,
    compression: 'none',
    hardwareMode: '48K',
    registers,
    interrupt: { im: registers.im, iff1: registers.iff1, iff2: registers.iff2 },
    borderColor: data[26]! & 0x07,
    ramPages: [{ name: '48k-ram', address: 0x4000, length: 49152 }],
    notes: ['48K .sna snapshots store PC on the stack; reported SP is after popping PC'],
  };
}

function snaRam(data: Uint8Array): Uint8Array {
  if (data.length !== 27 + 49152) {
    throw new Error(`Not a 48K SNA snapshot: ${data.length} bytes (expected 49179)`);
  }
  return new Uint8Array(data.subarray(27));
}

function registersFromZ80Header(h: Uint8Array, flags1: number): RegistersFull {
  const r = (h[11]! & 0x7f) | ((flags1 & 0x01) << 7);
  return {
    pc: word(h[6]!, h[7]!),
    sp: word(h[8]!, h[9]!),
    af: word(h[1]!, h[0]!),
    bc: word(h[2]!, h[3]!),
    de: word(h[13]!, h[14]!),
    hl: word(h[4]!, h[5]!),
    afPrime: word(h[22]!, h[21]!),
    bcPrime: word(h[15]!, h[16]!),
    dePrime: word(h[17]!, h[18]!),
    hlPrime: word(h[19]!, h[20]!),
    ix: word(h[25]!, h[26]!),
    iy: word(h[23]!, h[24]!),
    i: h[10]!,
    r,
    im: h[29]! & 0x03,
    iff1: h[27]! !== 0,
    iff2: h[28]! !== 0,
    halted: false,
  };
}

function extendedZ80Version(data: Uint8Array): string {
  if (data.length < 32) return 'extended';
  const extraLen = word(data[30]!, data[31]!);
  if (extraLen === 23) return '2';
  if (extraLen === 54 || extraLen === 55) return '3';
  return `extended(${extraLen})`;
}

function decompressZ80Rle(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(49152);
  let ptr = 0;
  let i = 0;
  while (i < data.length && ptr < result.length) {
    const b = data[i++]!;
    if (b === 0x00 && data[i] === 0xed && data[i + 1] === 0xed && data[i + 2] === 0x00) {
      break;
    }
    if (b === 0xed && i < data.length && data[i] === 0xed) {
      if (i + 2 >= data.length) break;
      const count = data[i + 1]!;
      const value = data[i + 2]!;
      i += 3;
      if (count !== 0) {
        const end = Math.min(ptr + count, result.length);
        result.fill(value, ptr, end);
        ptr = end;
      }
      continue;
    }
    result[ptr++] = b;
  }
  return result;
}

function copyFixed(data: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(data.subarray(0, length));
  return out;
}

function word(lo: number, hi: number): number {
  return (lo | (hi << 8)) & 0xffff;
}

function read48kRam(ram: Uint8Array, addr: number): number {
  if (addr < 0x4000 || addr > 0xffff) return 0;
  return ram[addr - 0x4000] ?? 0;
}

export function applySnapshotToMachine(file: string, data: Uint8Array, m: Machine): void {
  const format = detectSnapshotFormat(file, data);
  if (format === 'sna') applySna(m, data);
  else m.loadZ80(data);
}
