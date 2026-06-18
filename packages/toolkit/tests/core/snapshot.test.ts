import { describe, expect, it } from 'vitest';
import { loadSnapshotMachine, snapshotInfo, snapshotRam } from '../../src/core/snapshot.js';

function makeExtendedZ80Snapshot({
  extraLength = 54,
  pc = 0x8890,
  hardwareMode = 0,
  blocks = [],
}: {
  extraLength?: number;
  pc?: number;
  hardwareMode?: number;
  blocks?: Array<{ page: number; compressed: boolean; payload: Uint8Array }>;
} = {}): Uint8Array {
  const headerLength = 32 + extraLength;
  const size = headerLength + blocks.reduce((sum, block) => sum + 3 + block.payload.length, 0);
  const data = new Uint8Array(size);
  data[30] = extraLength & 0xff;
  data[31] = extraLength >> 8;
  data[32] = pc & 0xff;
  data[33] = pc >> 8;
  data[34] = hardwareMode;

  let offset = headerLength;
  for (const block of blocks) {
    const length = block.compressed ? block.payload.length : 0xffff;
    data[offset] = length & 0xff;
    data[offset + 1] = length >> 8;
    data[offset + 2] = block.page;
    data.set(block.payload, offset + 3);
    offset += 3 + block.payload.length;
  }

  return data;
}

describe('.z80 snapshot inspection', () => {
  it('loads and inspects compressed v3 48K extended snapshots', () => {
    const snapshot = makeExtendedZ80Snapshot({
      blocks: [
        { page: 8, compressed: true, payload: new Uint8Array([0xed, 0xed, 0x02, 0x11]) },
        { page: 4, compressed: true, payload: new Uint8Array([0xed, 0xed, 0x03, 0x22, 0x33]) },
        { page: 5, compressed: true, payload: new Uint8Array([0x44]) },
      ],
    });

    const info = snapshotInfo('game.z80', snapshot);
    expect(info.version).toBe('3');
    expect(info.supported).toBe(true);
    expect(info.compression).toBe('rle');
    expect(info.hardwareMode).toBe('48K');
    expect(info.registers.pc).toBe(0x8890);
    expect(info.ramPages).toEqual([
      { name: 'page-8', address: 0x4000, length: 0x4000, compressed: true },
      { name: 'page-4', address: 0x8000, length: 0x4000, compressed: true },
      { name: 'page-5', address: 0xc000, length: 0x4000, compressed: true },
    ]);

    const ram = snapshotRam('game.z80', snapshot);
    expect(ram[0]).toBe(0x11);
    expect(ram[1]).toBe(0x11);
    expect(ram[0x4000]).toBe(0x22);
    expect(ram[0x4002]).toBe(0x22);
    expect(ram[0x4003]).toBe(0x33);
    expect(ram[0x8000]).toBe(0x44);

    const machine = loadSnapshotMachine('game.z80', snapshot);
    expect(machine.getRegisters().pc).toBe(0x8890);
    expect(machine.readMemory(0x8000, 4)).toEqual(new Uint8Array([0x22, 0x22, 0x22, 0x33]));
  });

  it('tolerates a truncated compressed v1 stream without throwing or over-reading', () => {
    const header = new Uint8Array(30);
    header[7] = 0x80; // PC = 0x8000 → v1 (not extended)
    header[12] = 0x20; // compression flag set
    // Compressed body ends mid-end-marker (00 ED ED <missing 00>).
    const body = new Uint8Array([0xaa, 0x00, 0xed, 0xed]);
    const data = new Uint8Array(header.length + body.length);
    data.set(header, 0);
    data.set(body, header.length);

    let ram!: Uint8Array;
    expect(() => {
      ram = snapshotRam('game.z80', data);
    }).not.toThrow();
    expect(ram.length).toBe(49152);
    expect(ram[0]).toBe(0xaa);
  });
});

