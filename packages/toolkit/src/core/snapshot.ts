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

const Z80_BASE_HEADER_LENGTH = 30;
const Z80_RAM_LENGTH = 49152;
const Z80_RAM_PAGE_LENGTH = 0x4000;
const Z80_EXTENDED_HEADER_LENGTH_OFFSET = 30;
const Z80_EXTENDED_HEADER_DATA_OFFSET = 32;
const Z80_48K_PAGE_MAP = new Map([
  [8, 0x4000],
  [4, 0x8000],
  [5, 0xc000],
]);
const Z80_REQUIRED_48K_PAGES = [4, 5, 8];

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
  if (data.length < Z80_BASE_HEADER_LENGTH) throw new Error(`Not a .z80 snapshot: ${basename(file)} is too small`);
  const h = data.subarray(0, Z80_BASE_HEADER_LENGTH);
  const pc = word(h[6]!, h[7]!);
  const flags1 = h[12] === 0xff ? 1 : h[12]!;
  const version = pc === 0 ? extendedZ80Version(data) : '1';
  const extended = pc === 0 ? extendedZ80Layout(data, version) : undefined;
  const compressed = extended ? extended.ramPages.some((page) => page.compressed) : (flags1 & 0x20) !== 0;
  const supported = version === '1' || Boolean(extended?.supported);
  const regs = registersFromZ80Header(h, flags1, extended?.pc ?? pc);
  return {
    ok: true,
    format: 'z80',
    file,
    version,
    supported,
    compression: compressed ? 'rle' : 'none',
    hardwareMode: version === '1' ? '48K' : (extended?.hardwareMode ?? 'extended/unknown'),
    registers: regs,
    interrupt: { im: regs.im, iff1: regs.iff1, iff2: regs.iff2 },
    borderColor: (flags1 >> 1) & 0x07,
    ramPages:
      version === '1'
        ? [
            {
              name: '48k-ram',
              address: 0x4000,
              length: Z80_RAM_LENGTH,
              compressed,
            },
          ]
        : (extended?.ramPages ?? []),
    notes: supported
      ? [version === '1' ? '.z80 v1 48K snapshots are supported for load and RAM export' : '.z80 v2/v3 48K snapshots are supported for load and RAM export']
      : ['.z80 v2/v3 extended headers are detected but not decoded yet'],
  };
}

function z80Ram(data: Uint8Array): Uint8Array {
  if (data.length < Z80_BASE_HEADER_LENGTH) throw new Error('Not a .z80 snapshot: file is too small');
  const h = data.subarray(0, Z80_BASE_HEADER_LENGTH);
  const pc = word(h[6]!, h[7]!);
  if (pc === 0) {
    return extendedZ80Ram(data);
  }
  const flags1 = h[12] === 0xff ? 1 : h[12]!;
  const compressed = (flags1 & 0x20) !== 0;
  return compressed
    ? decompressZ80Rle(data.subarray(Z80_BASE_HEADER_LENGTH), Z80_RAM_LENGTH, true)
    : copyFixed(data.subarray(Z80_BASE_HEADER_LENGTH), Z80_RAM_LENGTH);
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

function registersFromZ80Header(h: Uint8Array, flags1: number, pcOverride?: number): RegistersFull {
  const r = (h[11]! & 0x7f) | ((flags1 & 0x01) << 7);
  return {
    pc: pcOverride ?? word(h[6]!, h[7]!),
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

interface ExtendedZ80Layout {
  pc: number;
  supported: boolean;
  hardwareMode: string;
  ramPages: SnapshotRamPage[];
}

interface ExtendedZ80MemoryBlock {
  page: number;
  address: number;
  compressed: boolean;
  payload: Uint8Array;
}

function extendedZ80Layout(data: Uint8Array, version: string): ExtendedZ80Layout {
  const pc = data.length >= 34 ? word(data[32]!, data[33]!) : 0;
  const hardwareMode = data.length > 34 ? data[34]! : -1;
  const supportedHardware = is48KCompatibleZ80Hardware(version, hardwareMode);
  const blocks = supportedHardware ? extendedZ80Blocks(data, version, false) : [];
  const pages = new Set(blocks.map((block) => block.page));
  const hasRequiredPages = Z80_REQUIRED_48K_PAGES.every((page) => pages.has(page));
  return {
    pc,
    supported: supportedHardware && hasRequiredPages,
    hardwareMode: z80HardwareModeName(version, hardwareMode),
    ramPages: blocks.map((block) => ({
      name: `page-${block.page}`,
      address: block.address,
      length: Z80_RAM_PAGE_LENGTH,
      compressed: block.compressed,
    })),
  };
}

function extendedZ80Ram(data: Uint8Array): Uint8Array {
  const version = extendedZ80Version(data);
  const hardwareMode = data.length > 34 ? data[34]! : -1;
  if (!is48KCompatibleZ80Hardware(version, hardwareMode)) {
    throw new Error(`Unsupported .z80 ${version} hardware mode for 48K RAM export: ${hardwareMode}`);
  }

  const ram = new Uint8Array(Z80_RAM_LENGTH);
  const blocks = extendedZ80Blocks(data, version, true);
  const pages = new Set<number>();
  for (const block of blocks) {
    const pageData = block.compressed
      ? decompressZ80Rle(block.payload, Z80_RAM_PAGE_LENGTH, false)
      : copyFixed(block.payload, Z80_RAM_PAGE_LENGTH);
    ram.set(pageData, block.address - 0x4000);
    pages.add(block.page);
  }

  for (const page of Z80_REQUIRED_48K_PAGES) {
    if (!pages.has(page)) throw new Error(`Truncated .z80 48K snapshot: missing RAM page ${page}`);
  }

  return ram;
}

function extendedZ80Blocks(data: Uint8Array, version: string, strict: boolean): ExtendedZ80MemoryBlock[] {
  if (version !== '2' && version !== '3') {
    if (strict) throw new Error(`Unsupported .z80 extended snapshot version: ${version}`);
    return [];
  }
  if (data.length < 32) {
    if (strict) throw new Error('Unsupported .z80 extended snapshot: missing extended header length');
    return [];
  }

  const extraLen = word(data[Z80_EXTENDED_HEADER_LENGTH_OFFSET]!, data[Z80_EXTENDED_HEADER_LENGTH_OFFSET + 1]!);
  const memoryOffset = Z80_EXTENDED_HEADER_DATA_OFFSET + extraLen;
  if (data.length < memoryOffset) {
    if (strict) throw new Error('Truncated .z80 extended snapshot header');
    return [];
  }

  const blocks: ExtendedZ80MemoryBlock[] = [];
  let offset = memoryOffset;
  while (offset < data.length) {
    if (offset + 3 > data.length) {
      if (strict) throw new Error('Truncated .z80 memory block header');
      break;
    }

    const encodedLength = word(data[offset]!, data[offset + 1]!);
    const page = data[offset + 2]!;
    offset += 3;

    const payloadLength = encodedLength === 0xffff ? Z80_RAM_PAGE_LENGTH : encodedLength;
    if (offset + payloadLength > data.length) {
      if (strict) throw new Error('Truncated .z80 memory block data');
      break;
    }

    const address = Z80_48K_PAGE_MAP.get(page);
    const payload = data.subarray(offset, offset + payloadLength);
    offset += payloadLength;

    if (address === undefined) continue;
    blocks.push({ page, address, compressed: encodedLength !== 0xffff, payload });
  }

  return blocks;
}

function is48KCompatibleZ80Hardware(version: string, hardwareMode: number): boolean {
  if (hardwareMode === 0 || hardwareMode === 1) return version === '2' || version === '3';
  return version === '3' && hardwareMode === 3;
}

function z80HardwareModeName(version: string, hardwareMode: number): string {
  if (hardwareMode === 0) return '48K';
  if (hardwareMode === 1) return '48K + Interface 1';
  if (version === '3' && hardwareMode === 3) return '48K + MGT';
  return `extended hardware mode ${hardwareMode}`;
}

function decompressZ80Rle(data: Uint8Array, expectedLength: number, stopAtEndMarker: boolean): Uint8Array {
  const result = new Uint8Array(expectedLength);
  let ptr = 0;
  let i = 0;
  while (i < data.length && ptr < result.length) {
    const b = data[i++]!;
    if (
      stopAtEndMarker &&
      b === 0x00 &&
      i + 2 < data.length &&
      data[i] === 0xed &&
      data[i + 1] === 0xed &&
      data[i + 2] === 0x00
    ) {
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
