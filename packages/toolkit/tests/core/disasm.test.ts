import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from '../../src/build/sjasmplus.js';
import { disassemble, disassembleOne } from '../../src/core/disasm.js';
import { loadRom } from '../../src/core/rom.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function readerFor(bin: Uint8Array, org: number) {
  return (addr: number) => bin[addr - org] ?? 0;
}

function decode(bytes: number[]): string {
  return disassembleOne((a) => bytes[a] ?? 0, 0).text;
}

describe('disassembleOne', () => {
  it('decodes the 48K ROM entry point', () => {
    const rom = loadRom();
    const lines = disassemble((a) => rom[a]!, 0, 4);
    expect(lines.map((l) => l.text)).toEqual([
      'DI',
      'XOR A',
      'LD DE,0xFFFF',
      'JP 0x11CB',
    ]);
  });

  it('decodes tricky prefixed forms', () => {
    expect(decode([0xdd, 0xcb, 0x05, 0x06])).toBe('RLC (IX+0x05)');
    expect(decode([0xdd, 0xcb, 0xfb, 0x46])).toBe('BIT 0,(IX-0x05)');
    expect(decode([0xfd, 0xcb, 0x02, 0xc1])).toBe('SET 0,(IY+0x02),C');
    expect(decode([0xed, 0xb0])).toBe('LDIR');
    expect(decode([0xdd, 0x7e, 0x05])).toBe('LD A,(IX+0x05)');
    expect(decode([0xdd, 0x66, 0x05])).toBe('LD H,(IX+0x05)'); // memory op: plain H
    expect(decode([0xdd, 0x26, 0x12])).toBe('LD IXH,0x12'); // no memory op: IXH
    expect(decode([0xed, 0x70])).toBe('IN (C)');
    expect(decode([0xed, 0x71])).toBe('OUT (C),0');
    expect(decode([0xcb, 0x30])).toBe('SLL B');
    expect(decode([0x10, 0xfe])).toBe('DJNZ 0x0000'); // self-loop at addr 0
    expect(decode([0xed, 0x4c])).toBe('NEG'); // undocumented NEG alias decodes...
  });

  it('falls back to DB for invalid ED opcodes', () => {
    expect(decode([0xed, 0x00])).toBe('DB 0xED,0x00');
    expect(decode([0xed, 0x77])).toBe('DB 0xED,0x77');
  });
});

describe('round-trip: assemble → disassemble → reassemble', () => {
  it('reproduces the corpus byte-for-byte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxs-disasm-'));
    const first = await build(join(fixtures, 'corpus.asm'), { outDir: dir });
    expect(first.ok, JSON.stringify(first.errors)).toBe(true);
    const bin = new Uint8Array(readFileSync(first.outputs.bin!));

    // Disassemble the full binary.
    const read = readerFor(bin, 0x8000);
    const lines: string[] = [];
    let addr = 0x8000;
    while (addr < 0x8000 + bin.length) {
      const line = disassembleOne(read, addr);
      lines.push(`    ${line.text}`);
      addr += line.bytes.length;
    }

    // Reassemble the disassembly and compare bytes.
    const regenPath = join(dir, 'regen.asm');
    writeFileSync(
      regenPath,
      ['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', ...lines, ''].join('\n')
    );
    const second = await build(regenPath, { outDir: join(dir, 'out2') });
    expect(second.ok, JSON.stringify(second.errors)).toBe(true);
    const bin2 = new Uint8Array(readFileSync(second.outputs.bin!));

    expect(Buffer.from(bin2).equals(Buffer.from(bin))).toBe(true);
  });
});
