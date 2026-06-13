import { Z80SnapshotLoader } from '../../src/spectrum/snapshot.js';
import { SpectrumMemory } from '../../src/spectrum/memory.js';
import { Registers } from '../../src/core/registers.js';

/**
 * Build a minimal uncompressed .z80 v1 image: 30-byte header + 48K RAM.
 */
function makeSnapshot(headerOverrides = {}) {
    const header = new Uint8Array(30);
    header[6] = 0x00;
    header[7] = 0x80; // PC = 0x8000, original v1 header shape.
    for (const [index, value] of Object.entries(headerOverrides)) {
        header[Number(index)] = value;
    }
    const data = new Uint8Array(30 + 49152);
    data.set(header, 0);
    return data;
}

describe('Z80SnapshotLoader', () => {
    let memory;
    let cpu;
    let ula;
    let loader;

    beforeEach(() => {
        memory = new SpectrumMemory();
        cpu = {
            registers: new Registers(),
            iff1: false,
            iff2: false,
            interruptMode: 0,
        };
        ula = { setBorderColor: jest.fn() };
        loader = new Z80SnapshotLoader(memory, cpu, ula);
    });

    describe('header byte 12 (flags1)', () => {
        it('reads the border color from bits 1-3', () => {
            // border 4 (green) lives at bits 1-3 → 0b0000_1000
            loader.load(makeSnapshot({ 12: 4 << 1 }));
            expect(ula.setBorderColor).toHaveBeenCalledWith(4);
        });

        it('does not misread bit 0 (R bit 7) as part of the border', () => {
            // R7 set + border 0 → border must be 0, not 1
            loader.load(makeSnapshot({ 12: 0x01 }));
            expect(ula.setBorderColor).toHaveBeenCalledWith(0);
        });

        it('restores bit 7 of R from bit 0 of flags1', () => {
            loader.load(makeSnapshot({ 11: 0x12, 12: 0x01 }));
            expect(cpu.registers.data.R).toBe(0x92);
        });

        it('treats flags1 = 255 as 1 (spec compatibility rule)', () => {
            loader.load(makeSnapshot({ 12: 0xff }));
            expect(ula.setBorderColor).toHaveBeenCalledWith(0); // not 7
            expect(cpu.registers.data.R & 0x80).toBe(0x80); // R7 from bit 0
        });
    });

    describe('header byte 29 (interrupt mode)', () => {
        it('masks the interrupt mode to bits 0-1', () => {
            // 0x41 = IM 1 plus an unrelated high flag bit
            loader.load(makeSnapshot({ 29: 0x41 }));
            expect(cpu.interruptMode).toBe(1);
        });
    });

    describe('uncompressed RAM', () => {
        it('writes the 48K block to 0x4000-0xFFFF', () => {
            const data = makeSnapshot({});
            data[30] = 0xaa; // first RAM byte → 0x4000
            data[30 + 49151] = 0x55; // last RAM byte → 0xFFFF
            loader.load(data);
            expect(memory.read(0x4000)).toBe(0xaa);
            expect(memory.read(0xffff)).toBe(0x55);
        });
    });

    describe('compressed RAM', () => {
        it('consumes zero-length RLE runs and stops at the end marker', () => {
            const header = makeSnapshot({ 12: 0x20 }).subarray(0, 30);
            const compressed = new Uint8Array([
                0xaa,
                0xed, 0xed, 0x00, 0xff,
                0xbb,
                0x00, 0xed, 0xed, 0x00,
                0xcc,
            ]);
            const data = new Uint8Array(header.length + compressed.length);
            data.set(header, 0);
            data.set(compressed, header.length);

            loader.load(data);

            expect(memory.read(0x4000)).toBe(0xaa);
            expect(memory.read(0x4001)).toBe(0xbb);
            expect(memory.read(0x4002)).not.toBe(0xcc);
        });
    });

    describe('extended .z80 snapshots', () => {
        it('rejects v2/v3 extended headers explicitly', () => {
            expect(() => loader.load(makeSnapshot({ 6: 0x00, 7: 0x00 }))).toThrow(/v2\/v3/);
        });
    });
});
