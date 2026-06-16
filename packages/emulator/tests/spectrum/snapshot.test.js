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

function makeExtendedSnapshot({ extraLength = 54, pc = 0x8890, hardwareMode = 0, blocks = [] } = {}) {
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

function uncompressedPage(fill = 0) {
    return new Uint8Array(0x4000).fill(fill);
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
        it('loads v3 48K page blocks into the 48K memory map', () => {
            const page8 = uncompressedPage();
            page8[0] = 0x18;
            const page4 = uncompressedPage();
            page4[0] = 0x42;
            const page5 = uncompressedPage();
            page5[0x3fff] = 0x99;

            loader.load(
                makeExtendedSnapshot({
                    pc: 0x8890,
                    blocks: [
                        { page: 4, compressed: false, payload: page4 },
                        { page: 5, compressed: false, payload: page5 },
                        { page: 8, compressed: false, payload: page8 },
                    ],
                })
            );

            expect(cpu.registers.get16('PC')).toBe(0x8890);
            expect(memory.read(0x4000)).toBe(0x18);
            expect(memory.read(0x8000)).toBe(0x42);
            expect(memory.read(0xffff)).toBe(0x99);
        });

        it('loads compressed v3 48K page blocks without requiring a v1 end marker', () => {
            loader.load(
                makeExtendedSnapshot({
                    blocks: [
                        { page: 8, compressed: true, payload: new Uint8Array([0xed, 0xed, 0x02, 0x11]) },
                        { page: 4, compressed: true, payload: new Uint8Array([0xed, 0xed, 0x03, 0x22, 0x33]) },
                        { page: 5, compressed: true, payload: new Uint8Array([0x44]) },
                    ],
                })
            );

            expect(memory.read(0x4000)).toBe(0x11);
            expect(memory.read(0x4001)).toBe(0x11);
            expect(memory.read(0x8000)).toBe(0x22);
            expect(memory.read(0x8002)).toBe(0x22);
            expect(memory.read(0x8003)).toBe(0x33);
            expect(memory.read(0xc000)).toBe(0x44);
        });

        it('rejects extended snapshots that are not 48K-compatible', () => {
            expect(() =>
                loader.load(
                    makeExtendedSnapshot({
                        hardwareMode: 4,
                        blocks: [
                            { page: 4, compressed: false, payload: uncompressedPage() },
                            { page: 5, compressed: false, payload: uncompressedPage() },
                            { page: 8, compressed: false, payload: uncompressedPage() },
                        ],
                    })
                )
            ).toThrow(/hardware mode/);
        });
    });
});
